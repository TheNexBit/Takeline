//! Installazione di ffmpeg senza uscire da Takeline.
//!
//! Prima si prova winget, che e' gia' su Windows 11 e tiene aggiornato il
//! pacchetto; se manca o fallisce si scarica la build "essentials" di
//! gyan.dev e si tengono solo ffmpeg.exe e ffprobe.exe nella cartella dati.
//! In entrambi i casi si torna un percorso assoluto: il PATH di un processo
//! gia' avviato non vede le installazioni fatte dopo.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::system::{comando_nascosto, ffprobe_path};
use crate::AppState;

/// Sempre l'ultima release: gyan.dev tiene fermo questo indirizzo.
const URL_ZIP: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const EVENTO: &str = "takeline://ffmpeg-installazione";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Avanzamento {
    /// winget, scarico, estrazione, fatto.
    pub fase: String,
    /// Da 0 a 1; -1 quando non si puo' sapere (winget, server senza lunghezza).
    pub quota: f64,
    pub testo: String,
}

fn avvisa(app: &AppHandle, fase: &str, quota: f64, testo: &str) {
    let _ = app.emit(EVENTO, Avanzamento { fase: fase.into(), quota, testo: testo.into() });
}

/// Un ffmpeg serve solo se risponde e ha ffprobe accanto: le build parziali
/// incluse in altri programmi passerebbero il primo controllo e non il secondo.
fn funziona(ffmpeg: &Path) -> bool {
    let versione = |p: &str| comando_nascosto(p).arg("-version").output().is_ok_and(|o| o.status.success());
    let f = ffmpeg.to_string_lossy();
    ffmpeg.is_file() && versione(&f) && versione(&ffprobe_path(&f).to_string_lossy())
}

/// Dove winget mette gli alias dei pacchetti installati per l'utente.
fn collegamenti_winget() -> Option<PathBuf> {
    Some(dirs::data_local_dir()?.join("Microsoft").join("WinGet").join("Links").join("ffmpeg.exe"))
}

fn prova_winget(app: &AppHandle) -> Option<PathBuf> {
    avvisa(app, "winget", -1.0, "Installazione con winget…");
    let _ = comando_nascosto("winget")
        .args([
            "install",
            "--exact",
            "--id",
            "Gyan.FFmpeg",
            "--accept-source-agreements",
            "--accept-package-agreements",
            "--disable-interactivity",
        ])
        .output();
    // Non si guarda il codice di uscita: winget lo mette a errore anche solo
    // perche' il pacchetto c'era gia'. Conta se adesso l'alias funziona; se
    // winget manca o e' bloccato da policy non c'e' e si passa al download.
    collegamenti_winget().filter(|p| funziona(p))
}

async fn scarica(app: &AppHandle, destinazione: &Path) -> Result<(), String> {
    avvisa(app, "scarico", 0.0, "Scarico ffmpeg…");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| format!("rete non disponibile: {e}"))?;
    let mut risposta = client
        .get(URL_ZIP)
        .send()
        .await
        .map_err(|e| format!("scaricamento non riuscito: {e}"))?
        .error_for_status()
        .map_err(|e| format!("scaricamento non riuscito: {e}"))?;

    let totale = risposta.content_length().unwrap_or(0);
    let mut file = File::create(destinazione).map_err(|e| format!("{}: {e}", destinazione.display()))?;
    let mut fatti: u64 = 0;
    let mut ultimo = 0u64;
    while let Some(pezzo) = risposta.chunk().await.map_err(|e| format!("scaricamento interrotto: {e}"))? {
        file.write_all(&pezzo).map_err(|e| format!("{}: {e}", destinazione.display()))?;
        fatti += pezzo.len() as u64;
        // Un evento ogni mezzo mega: la barra si muove senza intasare la UI.
        if fatti - ultimo >= 512 * 1024 {
            ultimo = fatti;
            let quota = if totale > 0 { fatti as f64 / totale as f64 } else { -1.0 };
            avvisa(app, "scarico", quota, &format!("Scarico ffmpeg… {} MB", fatti / 1024 / 1024));
        }
    }
    Ok(())
}

/// Dallo zip servono due soli file, che stanno in `<build>/bin`.
fn estrai(zip: &Path, cartella: &Path) -> Result<PathBuf, String> {
    let file = File::open(zip).map_err(|e| format!("{}: {e}", zip.display()))?;
    let mut archivio = zip::ZipArchive::new(file).map_err(|e| format!("zip illeggibile: {e}"))?;
    fs::create_dir_all(cartella).map_err(|e| format!("{}: {e}", cartella.display()))?;

    let mut presi = 0;
    for i in 0..archivio.len() {
        let mut voce = archivio.by_index(i).map_err(|e| format!("zip illeggibile: {e}"))?;
        let nome = voce.name().map_err(|e| format!("zip illeggibile: {e}"))?.replace('\\', "/");
        let Some(base) = nome.rsplit('/').next() else { continue };
        if !matches!(base, "ffmpeg.exe" | "ffprobe.exe") || !nome.contains("/bin/") {
            continue;
        }
        let mut dati = Vec::new();
        voce.read_to_end(&mut dati).map_err(|e| format!("{base}: {e}"))?;
        let uscita = cartella.join(base);
        fs::write(&uscita, dati).map_err(|e| format!("{}: {e}", uscita.display()))?;
        presi += 1;
    }
    if presi < 2 {
        return Err("Nello zip mancano ffmpeg.exe o ffprobe.exe.".into());
    }
    Ok(cartella.join("ffmpeg.exe"))
}

/// Scarica (o ritrova) ffmpeg e torna il percorso da mettere nelle
/// impostazioni. Il chiamante lo salva: cosi' vale anche al riavvio.
#[tauri::command]
pub async fn ffmpeg_installa(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let cartella = state.paths.config_dir.join("ffmpeg");
    let log = |testo: &str| state.log.scrivi(None, "info", "ffmpeg", testo);

    // Gia' scaricato da una volta precedente: niente da rifare.
    let nostro = cartella.join("ffmpeg.exe");
    if funziona(&nostro) {
        log("gia' presente nella cartella dati");
        avvisa(&app, "fatto", 1.0, "ffmpeg era gia' installato.");
        return Ok(nostro.display().to_string());
    }

    let con_winget = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || prova_winget(&app)).await.unwrap_or(None)
    };
    if let Some(p) = con_winget {
        log(&format!("installato con winget: {}", p.display()));
        avvisa(&app, "fatto", 1.0, "ffmpeg installato con winget.");
        return Ok(p.display().to_string());
    }

    fs::create_dir_all(&cartella).map_err(|e| format!("{}: {e}", cartella.display()))?;
    let zip = cartella.join("ffmpeg.zip");
    scarica(&app, &zip).await?;

    avvisa(&app, "estrazione", -1.0, "Estraggo ffmpeg…");
    let zip2 = zip.clone();
    let cartella2 = cartella.clone();
    let esito = tauri::async_runtime::spawn_blocking(move || estrai(&zip2, &cartella2))
        .await
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&zip);
    let ffmpeg = esito?;

    if !funziona(&ffmpeg) {
        return Err(format!("ffmpeg scaricato in {} ma non risponde.", ffmpeg.display()));
    }
    log(&format!("scaricato in {}", ffmpeg.display()));
    avvisa(&app, "fatto", 1.0, "ffmpeg scaricato.");
    Ok(ffmpeg.display().to_string())
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn un_eseguibile_inesistente_non_funziona() {
        assert!(!funziona(Path::new("C:\\non\\esiste\\ffmpeg.exe")));
    }

    #[test]
    fn lo_zip_deve_contenere_entrambi_i_file() {
        let dir = std::env::temp_dir().join("takeline-prova-zip");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let zip = dir.join("vuoto.zip");
        // Zip valido ma senza i file che ci servono.
        let mut w = zip::ZipWriter::new(File::create(&zip).unwrap());
        w.start_file("ffmpeg-1/bin/leggimi.txt", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"niente").unwrap();
        w.finish().unwrap();
        assert!(estrai(&zip, &dir.join("uscita")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
