//! Documenti JSON modificabili a mano: preset e impostazioni.
//!
//! Il backend non impone lo schema (lo normalizza il frontend): si limita a
//! leggere, segnalare errori di sintassi con riga e colonna e salvare in modo
//! sicuro. Un file non valido non viene mai sovrascritto da qui.

use std::fs;

use serde_json::Value;
use tauri::State;

use crate::paths::write_atomic;
use crate::AppState;

fn doc_path(state: &AppState, nome: &str) -> Result<std::path::PathBuf, String> {
    match nome {
        "preset" => Ok(state.paths.presets_file.clone()),
        "impostazioni" => Ok(state.paths.settings_file.clone()),
        _ => Err(format!("Documento sconosciuto: {nome}")),
    }
}

/// `None` se il file non esiste ancora (primo avvio).
#[tauri::command]
pub fn doc_load(state: State<'_, AppState>, nome: String) -> Result<Option<Value>, String> {
    let path = doc_path(&state, &nome)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let text = text.trim_start_matches('\u{feff}');
    serde_json::from_str(text).map(Some).map_err(|e| {
        format!(
            "{} non e' un JSON valido (riga {}, colonna {}): {e}",
            path.display(),
            e.line(),
            e.column()
        )
    })
}

#[tauri::command]
pub fn doc_save(state: State<'_, AppState>, nome: String, valore: Value) -> Result<(), String> {
    let path = doc_path(&state, &nome)?;
    let mut text = serde_json::to_string_pretty(&valore).map_err(|e| e.to_string())?;
    text.push('\n');
    write_atomic(&path, text.as_bytes())
}

/// Esporta preset (o altro JSON) in un file scelto dall'utente.
#[tauri::command]
pub fn json_esporta(percorso: String, valore: Value) -> Result<(), String> {
    let mut text = serde_json::to_string_pretty(&valore).map_err(|e| e.to_string())?;
    text.push('\n');
    fs::write(&percorso, text).map_err(|e| format!("{percorso}: {e}"))
}

/// Legge un file JSON scelto dall'utente (importazione di preset).
#[tauri::command]
pub fn json_importa(percorso: String) -> Result<Value, String> {
    let text = fs::read_to_string(&percorso).map_err(|e| format!("{percorso}: {e}"))?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| {
        format!("{percorso} non e' un JSON valido (riga {}, colonna {}): {e}", e.line(), e.column())
    })
}
