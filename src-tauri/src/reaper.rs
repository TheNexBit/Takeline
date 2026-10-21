//! Reaper via interfaccia web nativa (Preferences > Control/OSC/web).
//!
//! Le chiamate partono dal backend per evitare i problemi di CORS del webview.
//! Stato: `GET /_/TRANSPORT;NTRACK;TRACK`, azioni: `GET /_/{actionId}`.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaperConn {
    pub host: String,
    pub porta: u16,
    #[serde(default)]
    pub utente: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaperTrack {
    pub numero: u32,
    pub nome: String,
    pub armata: bool,
    pub muta: bool,
    pub solo: bool,
    /// Ultimo picco in dB (Reaper lo invia in decimi di dB).
    pub picco_db: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaperStatus {
    /// 0 fermo, 1 play, 2 pausa, 5 registrazione, 6 registrazione in pausa.
    pub stato: u8,
    pub posizione: f64,
    pub posizione_testo: String,
    pub tracce: Vec<ReaperTrack>,
}

const FLAG_MUTE: u32 = 8;
const FLAG_SOLO: u32 = 16;
const FLAG_REC_ARM: u32 = 64;

/// Oltre questa durata anche le interrogazioni di stato finiscono nel log.
const LENTA_MS: u128 = 700;

/// `sempre_nel_log`: le azioni si registrano sempre; lo stato (interrogato ogni
/// secondo) solo se fallisce o se Reaper risponde lento.
async fn get(state: &AppState, c: &ReaperConn, cmd: &str, sempre_nel_log: bool) -> Result<String, String> {
    let inizio = std::time::Instant::now();
    let esito = get_senza_log(state, c, cmd).await;
    let ms = inizio.elapsed().as_millis();
    match &esito {
        Ok(text) if sempre_nel_log || ms > LENTA_MS => {
            let risposta: String = text.replace('\t', " ").lines().next().unwrap_or("").chars().take(120).collect();
            let livello = if ms > LENTA_MS { "avviso" } else { "info" };
            state.log.scrivi(None, livello, "reaper", &format!("GET {cmd} -> ok in {ms} ms | {risposta}"));
        }
        Err(e) => state.log.scrivi(None, "errore", "reaper", &format!("GET {cmd} -> {e} ({ms} ms)")),
        _ => {}
    }
    esito
}

async fn get_senza_log(state: &AppState, c: &ReaperConn, cmd: &str) -> Result<String, String> {
    let url = format!("http://{}:{}/_/{}", c.host.trim(), c.porta, cmd);
    let mut req = state.http.get(&url);
    if !c.utente.is_empty() {
        req = req.basic_auth(&c.utente, Some(&c.password));
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            format!("Reaper non ha risposto in tempo su {}:{} (timeout).", c.host, c.porta)
        } else if e.is_connect() {
            format!(
                "Reaper non risponde su {}:{}. Controlla che sia aperto e che l'interfaccia web sia attiva.",
                c.host, c.porta
            )
        } else {
            format!("Errore HTTP verso Reaper: {e}")
        }
    })?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Reaper ha rifiutato utente/password dell'interfaccia web.".into());
    }
    if !res.status().is_success() {
        return Err(format!("Reaper ha risposto {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

pub fn parse_status(text: &str) -> ReaperStatus {
    let mut st = ReaperStatus {
        stato: 0,
        posizione: 0.0,
        posizione_testo: String::new(),
        tracce: Vec::new(),
    };
    for line in text.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        match f.first().copied() {
            Some("TRANSPORT") if f.len() >= 5 => {
                st.stato = f[1].parse().unwrap_or(0);
                st.posizione = f[2].parse().unwrap_or(0.0);
                st.posizione_testo = f[4].to_string();
            }
            Some("TRACK") if f.len() >= 7 => {
                let numero: u32 = f[1].parse().unwrap_or(0);
                if numero == 0 {
                    continue; // master
                }
                let flags: u32 = f[3].parse().unwrap_or(0);
                st.tracce.push(ReaperTrack {
                    numero,
                    nome: f[2].to_string(),
                    armata: flags & FLAG_REC_ARM != 0,
                    muta: flags & FLAG_MUTE != 0,
                    solo: flags & FLAG_SOLO != 0,
                    picco_db: f[6].parse::<f64>().unwrap_or(-1500.0) / 10.0,
                });
            }
            _ => {}
        }
    }
    st
}

#[tauri::command]
pub async fn reaper_status(state: State<'_, AppState>, conn: ReaperConn) -> Result<ReaperStatus, String> {
    let text = get(&state, &conn, "TRANSPORT;NTRACK;TRACK", false).await?;
    if !text.contains("TRANSPORT") {
        return Err("La risposta non sembra dell'interfaccia web di Reaper.".into());
    }
    Ok(parse_status(&text))
}

/// Esegue un'azione (es. 1013 record, 1016 stop, 40157 marker).
#[tauri::command]
pub async fn reaper_action(state: State<'_, AppState>, conn: ReaperConn, azione: String) -> Result<(), String> {
    let valida = !azione.is_empty()
        && azione
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ';' | '/' | '.' | '-'));
    if !valida {
        return Err(format!("Azione Reaper non valida: {azione}"));
    }
    get(&state, &conn, &azione, true).await.map(|_| ())
}

const SCRIPT_BRIDGE: &str = include_str!("../reaper/takeline-bridge.lua");

/// Percent-encoding dei valori di SET/EXTSTATE (Reaper li decodifica).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Reaper codifica le risposte di GET/EXTSTATE: "\\" per la barra rovesciata,
/// "\t" e "\n" per tabulazione e a capo.
fn decodifica_extstate(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some(altro) => out.push(altro),
            None => out.push('\\'),
        }
    }
    out
}

fn leggi_extstate(text: &str, chiave: &str) -> Option<String> {
    let prefisso = format!("EXTSTATE\tTakeline\t{chiave}\t");
    text.lines().find_map(|l| l.strip_prefix(prefisso.as_str())).map(decodifica_extstate)
}

/// Esegue un comando dello script "Takeline bridge" (region e marker con
/// nome, che l'interfaccia web da sola non sa creare) e ne restituisce l'esito.
#[tauri::command]
pub async fn reaper_bridge(
    state: State<'_, AppState>,
    conn: ReaperConn,
    comando_id: String,
    campi: Vec<String>,
) -> Result<String, String> {
    let id = comando_id.trim();
    if !id.starts_with('_') || id.len() < 3 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Command ID dello script bridge non valido: deve iniziare con _RS (Impostazioni > Reaper).".into());
    }
    let payload = campi
        .iter()
        .map(|c| c.replace(['\t', '\n', '\r'], " "))
        .collect::<Vec<_>>()
        .join("\t");
    let cmd = format!(
        "SET/EXTSTATE/Takeline/ack/attesa;SET/EXTSTATE/Takeline/cmd/{};{id};GET/EXTSTATE/Takeline/ack",
        url_encode(&payload)
    );
    let text = get(&state, &conn, &cmd, true).await?;
    match leggi_extstate(&text, "ack").as_deref() {
        Some("attesa") | None => Err(
            "Lo script Takeline bridge non ha risposto: controlla di averlo caricato in Reaper e il command ID in Impostazioni."
                .into(),
        ),
        Some(esito) => Ok(esito.to_string()),
    }
}

/// Contrassegno invisibile nel progetto attivo di Reaper (ProjExtState, nessun
/// marker): dice a quale sessione di Takeline appartiene il progetto. Con
/// `valore` lo scrive, poi restituisce quello presente ("" se non c'e').
#[tauri::command]
pub async fn reaper_progetto(state: State<'_, AppState>, conn: ReaperConn, valore: Option<String>) -> Result<String, String> {
    let leggi = "GET/PROJEXTSTATE/Takeline/sessione";
    let cmd = match &valore {
        Some(v) => format!("SET/PROJEXTSTATE/Takeline/sessione/{};{leggi}", url_encode(v)),
        None => leggi.to_string(),
    };
    let text = get(&state, &conn, &cmd, valore.is_some()).await?;
    Ok(text
        .lines()
        .find_map(|l| l.strip_prefix("PROJEXTSTATE\tTakeline\tsessione\t"))
        .unwrap_or("")
        .to_string())
}

/// Copia lo script bridge nella cartella Scripts di Reaper e ne restituisce il percorso.
#[tauri::command]
pub fn reaper_installa_bridge(cartella_reaper: Option<String>) -> Result<String, String> {
    let base = match cartella_reaper {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p.trim()),
        _ => dirs::config_dir().unwrap_or_default().join("REAPER"),
    };
    if !base.join("reaper.ini").exists() && !base.join("REAPER.ini").exists() {
        return Err(format!(
            "Cartella risorse di Reaper non trovata in {}. In Reaper: Options > Show REAPER resource path, poi indicala in Impostazioni.",
            base.display()
        ));
    }
    let dir = base.join("Scripts").join("Takeline");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let file = dir.join("takeline-bridge.lua");
    std::fs::write(&file, SCRIPT_BRIDGE).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(file.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codifica_e_legge_extstate() {
        assert_eq!(url_encode("region\t1.5\tTake 01/A;x"), "region%091.5%09Take%2001%2FA%3Bx");
        let t = "EXTSTATE\tTakeline\tack\tpong 3\n";
        assert_eq!(leggi_extstate(t, "ack").as_deref(), Some("pong 3"));
        // Reaper raddoppia le barre rovesciate nella risposta.
        let file = "EXTSTATE\tTakeline\tack\tok C:\\\\Users\\\\Dony\\\\a.wav*1.5\n";
        assert_eq!(leggi_extstate(file, "ack").as_deref(), Some(r"ok C:\Users\Dony\a.wav*1.5"));
        assert_eq!(leggi_extstate("TRANSPORT\t0", "ack"), None);
    }

    #[test]
    fn legge_transport_e_tracce() {
        let t = "TRANSPORT\t5\t12.5\t0\t0:12.500\t5.1.00\nNTRACK\t2\n\
                 TRACK\t0\tMASTER\t0\t1.0\t0\t-60\t-60\t1\t0\t0\t0\t0\t0\n\
                 TRACK\t1\tChitarra DI\t64\t1.0\t0\t-123\t-130\t1\t0\t0\t0\t0\t0\n\
                 TRACK\t2\tVoce\t8\t1.0\t0\t-1500\t-1500\t1\t0\t0\t0\t0\t0\n";
        let s = parse_status(t);
        assert_eq!(s.stato, 5);
        assert_eq!(s.posizione, 12.5);
        assert_eq!(s.tracce.len(), 2);
        assert!(s.tracce[0].armata && !s.tracce[0].muta);
        assert!((s.tracce[0].picco_db + 12.3).abs() < 1e-9);
        assert!(s.tracce[1].muta && !s.tracce[1].armata);
    }
}
