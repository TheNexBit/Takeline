//! Post-produzione: una coda di lavori ffmpeg, uno alla volta.
//!
//! La coda vive nel database (sopravvive al riavvio), un thread la esegue e
//! manda l'avanzamento al frontend con l'evento `takeline://lavoro`. Un lavoro
//! si annulla fermando davvero ffmpeg. Durante una registrazione la coda va in
//! pausa: il lavoro in corso viene interrotto e rimesso in attesa, cosi' OBS
//! non perde fotogrammi per colpa di un export.
//!
//! I file originali non vengono mai modificati: ogni lavoro scrive un file
//! nuovo accanto al video e lo registra in `file_take`.

use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::sync::{ffprobe_json, num};
use crate::system::ffmpeg_command;
use crate::AppState;

pub const TIPI: &[&str] = &["remux", "tracce", "loudnorm", "export", "proxy"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lavoro {
    pub id: i64,
    pub take_id: Option<i64>,
    pub tipo: String,
    /// attesa | in-corso | fatto | errore | annullato
    pub stato: String,
    pub parametri: Value,
    pub progresso: f64,
    /// File prodotti, uno per riga.
    pub uscita: Option<String>,
    pub errore: Option<String>,
    pub creato_il: String,
    pub iniziato_il: Option<String>,
    pub finito_il: Option<String>,
}

const COLONNE: &str = "id, take_id, tipo, stato, parametri, progresso, uscita, errore, creato_il, iniziato_il, finito_il";

fn riga_lavoro(r: &Row) -> rusqlite::Result<Lavoro> {
    let parametri: String = r.get(4)?;
    Ok(Lavoro {
        id: r.get(0)?,
        take_id: r.get(1)?,
        tipo: r.get(2)?,
        stato: r.get(3)?,
        parametri: serde_json::from_str(&parametri).unwrap_or(Value::Null),
        progresso: r.get(5)?,
        uscita: r.get(6)?,
        errore: r.get(7)?,
        creato_il: r.get(8)?,
        iniziato_il: r.get(9)?,
        finito_il: r.get(10)?,
    })
}

/// Stato condiviso tra i comandi e il thread che esegue la coda.
#[derive(Default)]
pub struct Coda {
    sveglia: Condvar,
    blocco: Mutex<()>,
    pausa: AtomicBool,
    /// Lavoro in corso e il suo processo ffmpeg.
    figlio: Mutex<Option<(i64, Child)>>,
    /// Perche' il lavoro in corso e' stato interrotto.
    interruzione: Mutex<Option<Interruzione>>,
}

#[derive(Clone, Copy, PartialEq)]
enum Interruzione {
    Annullato,
    Pausa,
}

impl Coda {
    fn sveglia(&self) {
        let _g = self.blocco.lock();
        self.sveglia.notify_all();
    }

    fn interrompi(&self, id: Option<i64>, motivo: Interruzione) -> bool {
        let mut figlio = self.figlio.lock().unwrap();
        if let Some((corrente, processo)) = figlio.as_mut() {
            if id.is_none_or(|i| i == *corrente) {
                *self.interruzione.lock().unwrap() = Some(motivo);
                let _ = processo.kill();
                return true;
            }
        }
        false
    }
}

fn adesso() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn salva(app: &AppHandle, l: &Lavoro) {
    let state = app.state::<AppState>();
    if let Ok(c) = state.db.lock() {
        let _ = c.execute(
            "UPDATE lavoro SET stato = ?2, progresso = ?3, uscita = ?4, errore = ?5, iniziato_il = ?6, finito_il = ?7, parametri = ?8 WHERE id = ?1",
            params![l.id, l.stato, l.progresso, l.uscita, l.errore, l.iniziato_il, l.finito_il, l.parametri.to_string()],
        );
    }
    let _ = app.emit("takeline://lavoro", l);
}

// --- dati del take -------------------------------------------------------

struct DatiTake {
    video: String,
    /// File gia' prodotti per il take: (ruolo, percorso).
    file: Vec<(String, String)>,
}

fn dati_take(app: &AppHandle, take_id: i64) -> Result<DatiTake, String> {
    let state = app.state::<AppState>();
    let c = state.db.lock().map_err(|_| "Database non disponibile")?;
    let video: Option<String> = c
        .query_row("SELECT file_video FROM take WHERE id = ?1", [take_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let video = video.ok_or("Il take non ha un file video.")?;
    let mut st = c
        .prepare("SELECT ruolo, percorso FROM file_take WHERE take_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let file = st
        .query_map([take_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|(_, p): &(String, String)| Path::new(p).exists())
        .collect();
    Ok(DatiTake { video, file })
}

impl DatiTake {
    fn ultimo(&self, ruolo: &str) -> Option<&str> {
        self.file.iter().rev().find(|(r, _)| r == ruolo).map(|(_, p)| p.as_str())
    }

    /// Il video migliore da cui partire: quello con l'audio di Reaper allineato,
    /// poi il remux, poi l'originale.
    fn sorgente(&self, anche_normalizzato: bool) -> String {
        let candidati: &[&str] = if anche_normalizzato { &["loudnorm", "sync", "remux"] } else { &["sync", "remux"] };
        candidati
            .iter()
            .find_map(|r| self.ultimo(r))
            .map(str::to_string)
            .unwrap_or_else(|| self.video.clone())
    }
}

pub fn registra_file(app: &AppHandle, take_id: i64, ruolo: &str, percorso: &str) {
    let state = app.state::<AppState>();
    if let Ok(c) = state.db.lock() {
        let _ = c.execute(
            "INSERT OR IGNORE INTO file_take (take_id, ruolo, percorso) VALUES (?1, ?2, ?3)",
            params![take_id, ruolo, percorso],
        );
    };
}

/// Accanto al video: `<nome><suffisso>.<estensione>`.
pub fn accanto(video: &str, suffisso: &str, estensione: &str) -> String {
    let p = Path::new(video);
    let base = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "take".into());
    p.with_file_name(format!("{base}{suffisso}.{estensione}")).display().to_string()
}

// --- esecuzione di ffmpeg con avanzamento --------------------------------

fn durata(ffmpeg: &str, file: &str) -> f64 {
    ffprobe_json(ffmpeg, &["-show_entries", "format=duration"], file)
        .ok()
        .and_then(|j| num(&j["format"]["duration"]))
        .unwrap_or(0.0)
}

/// Esegue ffmpeg riportando l'avanzamento tra `da` e `a` (0..1). Restituisce
/// lo stderr, che per loudnorm contiene le misure.
fn ffmpeg_con_avanzamento(
    app: &AppHandle,
    l: &mut Lavoro,
    ffmpeg: &str,
    args: &[String],
    durata_s: f64,
    (da, a): (f64, f64),
) -> Result<String, String> {
    let coda = app.state::<Coda>();
    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args(["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut figlio = cmd.spawn().map_err(|e| format!("ffmpeg non avviato: {e}"))?;
    let stdout = figlio.stdout.take();
    let mut stderr = figlio.stderr.take();
    *coda.figlio.lock().unwrap() = Some((l.id, figlio));

    // Lo stderr va letto in parallelo, altrimenti ffmpeg si blocca a buffer pieno.
    let lettore_err = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(e) = stderr.as_mut() {
            let _ = e.read_to_string(&mut s);
        }
        s
    });

    if let Some(out) = stdout {
        let mut ultimo = 0.0;
        for riga in BufReader::new(out).lines().map_while(Result::ok) {
            if let Some(us) = riga.strip_prefix("out_time_us=").or_else(|| riga.strip_prefix("out_time_ms=")) {
                if let (Ok(us), true) = (us.trim().parse::<f64>(), durata_s > 0.0) {
                    let p = da + (a - da) * (us / 1e6 / durata_s).clamp(0.0, 1.0);
                    if p - ultimo >= 0.01 {
                        ultimo = p;
                        l.progresso = p;
                        salva(app, l);
                    }
                }
            }
        }
    }

    let stato = coda.figlio.lock().unwrap().take().map(|(_, mut f)| f.wait());
    let stderr = lettore_err.join().unwrap_or_default();
    let esito = if let Some(motivo) = coda.interruzione.lock().unwrap().take() {
        Err(if motivo == Interruzione::Pausa { "__pausa__".to_string() } else { "__annullato__".to_string() })
    } else {
        match stato {
            Some(Ok(s)) if s.success() => Ok(stderr),
            _ => {
                let riga = stderr.lines().rev().find(|r| !r.trim().is_empty()).unwrap_or("errore sconosciuto");
                Err(format!("ffmpeg: {riga}"))
            }
        }
    };
    // L'ultimo argomento e' il file in uscita: lasciato a meta' non deve sembrare buono.
    if esito.is_err() {
        if let Some(uscita) = args.last().filter(|a| a.as_str() != "-") {
            let _ = std::fs::remove_file(uscita);
        }
    }
    esito
}

fn s(x: impl Into<String>) -> String {
    x.into()
}

// --- i lavori ------------------------------------------------------------

/// Esegue ffmpeg per un lavoro: nell'app con avanzamento e annullamento, nei test direttamente.
trait Esecutore {
    fn ffmpeg(&mut self, args: &[String], durata: f64, tratto: (f64, f64)) -> Result<String, String>;
}

struct NellApp<'a> {
    app: &'a AppHandle,
    l: &'a mut Lavoro,
    ffmpeg: String,
}

impl Esecutore for NellApp<'_> {
    fn ffmpeg(&mut self, args: &[String], durata: f64, tratto: (f64, f64)) -> Result<String, String> {
        ffmpeg_con_avanzamento(self.app, self.l, &self.ffmpeg, args, durata, tratto)
    }
}

/// Esegue un lavoro della coda e restituisce i file prodotti (ruolo, percorso).
fn esegui_lavoro(app: &AppHandle, l: &mut Lavoro) -> Result<Vec<(String, String)>, String> {
    let take_id = l.take_id.ok_or("Lavoro senza take.")?;
    let ffmpeg = l.parametri["ffmpeg"].as_str().unwrap_or("").to_string();
    let d = dati_take(app, take_id)?;
    let tipo = l.tipo.clone();
    let mut parametri = l.parametri.clone();
    let esito = {
        let mut e = NellApp { app, l, ffmpeg: ffmpeg.clone() };
        lavora(&tipo, &mut parametri, &d, &ffmpeg, &mut e)
    };
    l.parametri = parametri;
    esito
}

fn lavora(tipo: &str, parametri: &mut Value, d: &DatiTake, ffmpeg: &str, e: &mut dyn Esecutore) -> Result<Vec<(String, String)>, String> {
    if !Path::new(&d.video).exists() {
        return Err(format!("Il video non c'e' piu': {}", d.video));
    }

    match tipo {
        "remux" => {
            let est = Path::new(&d.video).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if est == "mp4" {
                return Ok(vec![]); // gia' MP4: niente da fare
            }
            let uscita = accanto(&d.video, "", "mp4");
            let args = vec![s("-i"), d.video.clone(), s("-map"), s("0"), s("-c"), s("copy"), s("-movflags"), s("+faststart"), uscita.clone()];
            e.ffmpeg(&args, durata(&ffmpeg, &d.video), (0.0, 1.0))?;
            Ok(vec![(s("remux"), uscita)])
        }
        "tracce" => {
            let j = ffprobe_json(&ffmpeg, &["-select_streams", "a", "-show_entries", "stream=codec_name"], &d.video)?;
            let flussi = j["streams"].as_array().cloned().unwrap_or_default();
            if flussi.is_empty() {
                return Err("Il video non ha tracce audio.".into());
            }
            let durata_s = durata(&ffmpeg, &d.video);
            let mut prodotti = Vec::new();
            for (i, f) in flussi.iter().enumerate() {
                let n = flussi.len() as f64;
                let aac = f["codec_name"] == "aac";
                let uscita = accanto(&d.video, &format!("_traccia{}", i + 1), if aac { "m4a" } else { "wav" });
                let mut args = vec![s("-i"), d.video.clone(), s("-map"), format!("0:a:{i}"), s("-vn")];
                // AAC si copia senza perdite; gli altri formati diventano WAV a 24 bit.
                args.extend(if aac { vec![s("-c:a"), s("copy")] } else { vec![s("-c:a"), s("pcm_s24le")] });
                args.push(uscita.clone());
                e.ffmpeg(&args, durata_s, (i as f64 / n, (i + 1) as f64 / n))?;
                prodotti.push((s("traccia"), uscita));
            }
            Ok(prodotti)
        }
        "loudnorm" => {
            let lufs = parametri["lufs"].as_f64().unwrap_or(-14.0);
            let ingresso = d.sorgente(false);
            let durata_s = durata(&ffmpeg, &ingresso);
            let filtro = format!("loudnorm=I={lufs}:TP=-1.0:LRA=11");
            // Prima passata: solo misura.
            let misura = e.ffmpeg(&[s("-i"), ingresso.clone(), s("-map"), s("0:a:0"), s("-af"), format!("{filtro}:print_format=json"), s("-f"), s("null"), s("-")],
                durata_s,
                (0.0, 0.5),
            )?;
            let m = misure_loudnorm(&misura).ok_or("loudnorm: misure non trovate nella prima passata")?;
            // loudnorm scrive i numeri come stringhe JSON: vanno passati senza virgolette.
            let v = |k: &str| m[k].as_str().map(str::to_string).unwrap_or_else(|| m[k].to_string());
            let secondo = format!(
                "{filtro}:measured_I={}:measured_TP={}:measured_LRA={}:measured_thresh={}:offset={}:linear=true",
                v("input_i"),
                v("input_tp"),
                v("input_lra"),
                v("input_thresh"),
                v("target_offset")
            );
            let uscita = accanto(&d.video, &format!("_{}LUFS", lufs.abs().round() as i64), "mp4");
            if uscita == ingresso {
                return Err("Ingresso e uscita coincidono.".into());
            }
            e.ffmpeg(&[
                    s("-i"), ingresso, s("-map"), s("0:v:0"), s("-map"), s("0:a:0"), s("-c:v"), s("copy"),
                    s("-af"), secondo, s("-c:a"), s("aac"), s("-b:a"), s("320k"), s("-ar"), s("48000"),
                    s("-movflags"), s("+faststart"), uscita.clone(),
                ],
                durata_s,
                (0.5, 1.0),
            )?;
            parametri["misura"] = json!({ "integrato": m["input_i"], "picco": m["input_tp"], "lra": m["input_lra"] });
            Ok(vec![(s("loudnorm"), uscita)])
        }
        "export" => {
            let piattaforma = parametri["piattaforma"].as_str().unwrap_or("").to_lowercase();
            let (video, audio): (&[&str], &[&str]) = match piattaforma.as_str() {
                "youtube" | "vimeo" => (
                    &["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"],
                    &["-c:a", "aac", "-b:a", "320k", "-ar", "48000"],
                ),
                "facebook" => (
                    &["-vf", "scale=-2:'min(1080,ih)'", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"],
                    &["-c:a", "aac", "-b:a", "192k", "-ar", "48000"],
                ),
                "instagram" => (
                    &["-vf", "scale=-2:'min(1080,ih)'", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"],
                    &["-c:a", "aac", "-b:a", "192k", "-ar", "48000"],
                ),
                altro => return Err(format!("Piattaforma sconosciuta: \"{altro}\" (note: youtube, vimeo, facebook, instagram).")),
            };
            let ingresso = d.sorgente(true);
            let uscita = accanto(&d.video, &format!("_{piattaforma}"), "mp4");
            let mut args = vec![s("-i"), ingresso.clone(), s("-map"), s("0:v:0"), s("-map"), s("0:a:0")];
            args.extend(video.iter().map(|x| s(*x)));
            args.extend(audio.iter().map(|x| s(*x)));
            args.extend([s("-movflags"), s("+faststart"), uscita.clone()]);
            e.ffmpeg(&args, durata(&ffmpeg, &ingresso), (0.0, 1.0))?;
            Ok(vec![(s("export"), uscita)])
        }
        "proxy" => {
            let uscita = accanto(&d.video, "_proxy", "mp4");
            let args = vec![
                s("-i"), d.video.clone(), s("-map"), s("0:v:0"), s("-map"), s("0:a:0?"),
                s("-vf"), s("scale=-2:'min(720,ih)'"), s("-c:v"), s("libx264"), s("-preset"), s("veryfast"),
                s("-crf"), s("26"), s("-pix_fmt"), s("yuv420p"), s("-c:a"), s("aac"), s("-b:a"), s("128k"),
                s("-movflags"), s("+faststart"), uscita.clone(),
            ];
            e.ffmpeg(&args, durata(&ffmpeg, &d.video), (0.0, 1.0))?;
            Ok(vec![(s("proxy"), uscita)])
        }
        altro => Err(format!("Tipo di lavoro sconosciuto: {altro}")),
    }
}

/// Il blocco JSON che loudnorm stampa a fine prima passata.
fn misure_loudnorm(stderr: &str) -> Option<Value> {
    let inizio = stderr.rfind('{')?;
    let fine = stderr[inizio..].find('}')? + inizio;
    serde_json::from_str(&stderr[inizio..=fine]).ok()
}

fn prossimo(app: &AppHandle) -> Option<Lavoro> {
    let state = app.state::<AppState>();
    let c = state.db.lock().ok()?;
    c.query_row(
        &format!("SELECT {COLONNE} FROM lavoro WHERE stato = 'attesa' ORDER BY id LIMIT 1"),
        [],
        riga_lavoro,
    )
    .optional()
    .ok()
    .flatten()
}

/// Il thread della coda: aspetta, prende il prossimo lavoro, lo esegue.
pub fn avvia(app: AppHandle) {
    {
        // Lavori rimasti "in corso" da una chiusura improvvisa: si rifanno.
        let state = app.state::<AppState>();
        if let Ok(c) = state.db.lock() {
            let _ = c.execute("UPDATE lavoro SET stato = 'attesa', progresso = 0 WHERE stato = 'in-corso'", []);
        };
    }
    std::thread::spawn(move || loop {
        let coda = app.state::<Coda>();
        let lavoro = if coda.pausa.load(Ordering::SeqCst) { None } else { prossimo(&app) };
        let Some(mut l) = lavoro else {
            let g = coda.blocco.lock().unwrap();
            let _ = coda.sveglia.wait_timeout(g, std::time::Duration::from_secs(5));
            continue;
        };

        l.stato = "in-corso".into();
        l.progresso = 0.0;
        l.errore = None;
        l.iniziato_il = Some(adesso());
        salva(&app, &l);
        app.state::<AppState>().log.scrivi(None, "info", "post", &format!("lavoro {} {} (take {:?}) avviato", l.id, l.tipo, l.take_id));

        let esito = esegui_lavoro(&app, &mut l);
        let log = &app.state::<AppState>().log;
        match esito {
            Ok(prodotti) => {
                for (ruolo, p) in &prodotti {
                    registra_file(&app, l.take_id.unwrap_or_default(), ruolo, p);
                }
                l.stato = "fatto".into();
                l.progresso = 1.0;
                l.uscita = Some(prodotti.iter().map(|(_, p)| p.as_str()).collect::<Vec<_>>().join("\n"));
                log.scrivi(None, "info", "post", &format!("lavoro {} {} fatto: {:?}", l.id, l.tipo, l.uscita));
            }
            Err(e) if e == "__pausa__" => {
                l.stato = "attesa".into();
                l.progresso = 0.0;
                log.scrivi(None, "info", "post", &format!("lavoro {} {} rimesso in coda (registrazione in corso)", l.id, l.tipo));
            }
            Err(e) if e == "__annullato__" => {
                l.stato = "annullato".into();
                log.scrivi(None, "info", "post", &format!("lavoro {} {} annullato", l.id, l.tipo));
            }
            Err(e) => {
                l.stato = "errore".into();
                log.scrivi(None, "errore", "post", &format!("lavoro {} {}: {e}", l.id, l.tipo));
                l.errore = Some(e);
            }
        }
        if l.stato != "attesa" {
            l.finito_il = Some(adesso());
        }
        salva(&app, &l);
    });
}

// --- comandi -------------------------------------------------------------

#[tauri::command]
pub fn post_accoda(app: AppHandle, state: State<'_, AppState>, take_id: i64, tipo: String, parametri: Value) -> Result<Lavoro, String> {
    if !TIPI.contains(&tipo.as_str()) {
        return Err(format!("Tipo di lavoro sconosciuto: {tipo}"));
    }
    let l = {
        let c = state.db.lock().map_err(|_| "Database non disponibile")?;
        c.execute(
            "INSERT INTO lavoro (take_id, tipo, parametri) VALUES (?1, ?2, ?3)",
            params![take_id, tipo, parametri.to_string()],
        )
        .map_err(|e| e.to_string())?;
        c.query_row(&format!("SELECT {COLONNE} FROM lavoro WHERE id = ?1"), [c.last_insert_rowid()], riga_lavoro)
            .map_err(|e| e.to_string())?
    };
    let _ = app.emit("takeline://lavoro", &l);
    app.state::<Coda>().sveglia();
    Ok(l)
}

#[tauri::command]
pub fn post_elenco(state: State<'_, AppState>) -> Result<Vec<Lavoro>, String> {
    let c = state.db.lock().map_err(|_| "Database non disponibile")?;
    let mut st = c
        .prepare(&format!("SELECT {COLONNE} FROM lavoro ORDER BY id DESC LIMIT 200"))
        .map_err(|e| e.to_string())?;
    let righe = st.query_map([], riga_lavoro).map_err(|e| e.to_string())?;
    righe.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn imposta_stato(app: &AppHandle, id: i64, stato: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let l = {
        let c = state.db.lock().map_err(|_| "Database non disponibile")?;
        c.execute(
            "UPDATE lavoro SET stato = ?2, progresso = 0, errore = NULL, finito_il = NULL WHERE id = ?1",
            params![id, stato],
        )
        .map_err(|e| e.to_string())?;
        c.query_row(&format!("SELECT {COLONNE} FROM lavoro WHERE id = ?1"), [id], riga_lavoro)
            .map_err(|e| e.to_string())?
    };
    let _ = app.emit("takeline://lavoro", &l);
    Ok(())
}

/// Annulla: se e' in corso ferma ffmpeg, se e' in attesa non partira'.
#[tauri::command]
pub fn post_annulla(app: AppHandle, id: i64) -> Result<(), String> {
    if !app.state::<Coda>().interrompi(Some(id), Interruzione::Annullato) {
        imposta_stato(&app, id, "annullato")?;
    }
    Ok(())
}

#[tauri::command]
pub fn post_riprova(app: AppHandle, id: i64) -> Result<(), String> {
    imposta_stato(&app, id, "attesa")?;
    app.state::<Coda>().sveglia();
    Ok(())
}

/// In pausa durante le registrazioni: il lavoro in corso torna in attesa.
#[tauri::command]
pub fn post_pausa(app: AppHandle, pausa: bool) {
    let coda = app.state::<Coda>();
    let prima = coda.pausa.swap(pausa, Ordering::SeqCst);
    if pausa && !prima {
        coda.interrompi(None, Interruzione::Pausa);
    }
    if !pausa {
        coda.sveglia();
    }
}

/// Toglie dalla lista i lavori finiti (i file restano dove sono).
#[tauri::command]
pub fn post_pulisci(state: State<'_, AppState>) -> Result<usize, String> {
    let c = state.db.lock().map_err(|_| "Database non disponibile")?;
    c.execute("DELETE FROM lavoro WHERE stato IN ('fatto', 'annullato')", [])
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn file_registra(app: AppHandle, take_id: i64, ruolo: String, percorso: String) {
    registra_file(&app, take_id, &ruolo, &percorso);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legge_le_misure_di_loudnorm() {
        let stderr = "[Parsed_loudnorm_0 @ 000001] \n{\n\t\"input_i\" : \"-23.54\",\n\t\"input_tp\" : \"-5.10\",\n\t\"input_lra\" : \"6.20\",\n\t\"input_thresh\" : \"-33.90\",\n\t\"target_offset\" : \"0.13\"\n}\n";
        let m = misure_loudnorm(stderr).unwrap();
        assert_eq!(m["input_i"], "-23.54");
        assert_eq!(m["target_offset"], "0.13");
    }

    /// ffmpeg eseguito direttamente, senza app ne' coda.
    struct Diretto;
    impl Esecutore for Diretto {
        fn ffmpeg(&mut self, args: &[String], _: f64, _: (f64, f64)) -> Result<String, String> {
            let out = ffmpeg_command("").args(["-hide_banner", "-nostdin", "-y"]).args(args).output().map_err(|e| e.to_string())?;
            let err = String::from_utf8_lossy(&out.stderr).to_string();
            if out.status.success() { Ok(err) } else { Err(err) }
        }
    }

    /// Prova completa dei lavori su un MKV generato (serve ffmpeg). Si lancia con
    /// TAKELINE_PROVA_POST=<cartella vuota> cargo test -- --ignored
    #[test]
    #[ignore]
    fn lavori_su_file_veri() {
        let Ok(dir) = std::env::var("TAKELINE_PROVA_POST") else { return };
        let video = Path::new(&dir).join("take01.mkv").display().to_string();
        // 20 s di video con due tracce audio AAC, a volumi diversi (come in OBS con uscita avanzata).
        Diretto
            .ffmpeg(
                &[
                    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=20",
                    "-f", "lavfi", "-i", "sine=f=440:duration=20,volume=0.05",
                    "-f", "lavfi", "-i", "anoisesrc=d=20:c=pink:a=0.3",
                    "-map", "0", "-map", "1", "-map", "2", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", &video,
                ]
                .map(String::from),
                0.0,
                (0.0, 1.0),
            )
            .unwrap();
        let d = DatiTake { video: video.clone(), file: vec![] };
        for tipo in ["remux", "tracce", "loudnorm", "export", "proxy"] {
            let mut p = json!({ "lufs": -14.0, "piattaforma": "youtube" });
            let prodotti = lavora(tipo, &mut p, &d, "", &mut Diretto).unwrap_or_else(|e| panic!("{tipo}: {e}"));
            println!("{tipo}: {prodotti:?}");
            assert!(!prodotti.is_empty() && prodotti.iter().all(|(_, f)| Path::new(f).exists()), "{tipo}");
            if tipo == "tracce" {
                assert_eq!(prodotti.len(), 2);
            }
            if tipo == "loudnorm" {
                // Rimisurato, il file normalizzato deve stare attorno a -14 LUFS.
                let misura = Diretto
                    .ffmpeg(
                        &["-i", &prodotti[0].1, "-af", "loudnorm=print_format=json", "-f", "null", "-"].map(String::from),
                        0.0,
                        (0.0, 1.0),
                    )
                    .unwrap();
                let i: f64 = misure_loudnorm(&misura).unwrap()["input_i"].as_str().unwrap().parse().unwrap();
                println!("loudness rimisurato: {i} LUFS");
                assert!((i + 14.0).abs() < 1.0, "{i} LUFS");
            }
        }
    }

    #[test]
    fn nomi_accanto_al_video() {
        assert_eq!(accanto(r"C:\v\2026_take01.mkv", "", "mp4"), r"C:\v\2026_take01.mp4");
        assert_eq!(accanto(r"C:\v\a.mp4", "_14LUFS", "mp4"), r"C:\v\a_14LUFS.mp4");
    }
}
