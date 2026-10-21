//! Log su file, uno al giorno, in `<config>\log\takeline-AAAA-MM-GG.log`.
//!
//! Scrivono sia il backend (chiamate a Reaper con tempi ed esito) sia il
//! frontend (comandi, passi del transport, eventi di OBS e MIDI, errori), cosi'
//! dopo una sessione si ricostruisce esattamente cosa e' successo e quando.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{Local, TimeZone};
use serde::Deserialize;
use tauri::State;

use crate::AppState;

pub struct Log {
    dir: PathBuf,
    /// (giorno, file aperto in append)
    corrente: Mutex<Option<(String, File)>>,
}

impl Log {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, corrente: Mutex::new(None) }
    }

    pub fn dir(&self) -> &PathBuf {
        &self.dir
    }

    /// Mai bloccante per l'app: se il log non si scrive, si va avanti lo stesso.
    pub fn scrivi(&self, quando_ms: Option<i64>, livello: &str, origine: &str, testo: &str) {
        let quando = quando_ms
            .and_then(|ms| Local.timestamp_millis_opt(ms).single())
            .unwrap_or_else(Local::now);
        let giorno = quando.format("%Y-%m-%d").to_string();
        let riga = format!(
            "{} {:<6} {:<10} {}\r\n",
            quando.format("%H:%M:%S%.3f"),
            livello.to_uppercase(),
            origine,
            testo.replace(['\r', '\n'], " ⏎ ")
        );
        let Ok(mut guard) = self.corrente.lock() else { return };
        if guard.as_ref().map(|(g, _)| g != &giorno).unwrap_or(true) {
            let _ = fs::create_dir_all(&self.dir);
            let file = self.dir.join(format!("takeline-{giorno}.log"));
            *guard = OpenOptions::new().create(true).append(true).open(file).ok().map(|f| (giorno, f));
        }
        if let Some((_, f)) = guard.as_mut() {
            let _ = f.write_all(riga.as_bytes());
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoceLog {
    pub quando: i64,
    pub livello: String,
    pub origine: String,
    pub testo: String,
}

#[tauri::command]
pub fn log_scrivi(state: State<'_, AppState>, voci: Vec<VoceLog>) {
    for v in voci {
        state.log.scrivi(Some(v.quando), &v.livello, &v.origine, &v.testo);
    }
}

/// Cartella dei log, per il pulsante "Apri log".
#[tauri::command]
pub fn log_cartella(state: State<'_, AppState>) -> String {
    state.log.dir().display().to_string()
}
