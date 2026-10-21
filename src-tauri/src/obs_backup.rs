//! Backup della configurazione di OBS prima di ogni cambio di contesto.
//!
//! Copia `basic/scenes` (scene collection) e `basic/profiles` (profili) dalla
//! cartella di configurazione di OBS, piu' l'istantanea letta via websocket.
//! Sono file piccoli: copiamo tutto, cosi' il ripristino e' sempre completo.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub cartella: String,
    pub file_copiati: usize,
    pub cartella_obs: String,
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<usize> {
    fs::create_dir_all(dst)?;
    let mut n = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            n += copy_tree(&entry.path(), &to)?;
        } else {
            fs::copy(entry.path(), &to)?;
            n += 1;
        }
    }
    Ok(n)
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .take(40)
        .collect()
}

pub fn obs_dir(state: &AppState, cartella_obs: Option<String>) -> PathBuf {
    match cartella_obs {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p.trim()),
        _ => state.paths.obs_config_dir.clone(),
    }
}

#[tauri::command]
pub fn obs_backup(
    state: State<'_, AppState>,
    istantanea: Value,
    motivo: String,
    cartella_obs: Option<String>,
) -> Result<BackupResult, String> {
    let obs = obs_dir(&state, cartella_obs);
    let basic = obs.join("basic");
    let scenes = basic.join("scenes");
    let profiles = basic.join("profiles");
    if !scenes.is_dir() || !profiles.is_dir() {
        return Err(format!(
            "Configurazione di OBS non trovata in {}. Se usi OBS portable o una cartella \
             diversa, impostala in Impostazioni > OBS. Senza backup il preset non viene applicato.",
            obs.display()
        ));
    }

    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let base = format!("{stamp}_{}", sanitize(&motivo));
    let mut dest = state.paths.backup_dir.join(&base);
    let mut i = 2;
    while dest.exists() {
        dest = state.paths.backup_dir.join(format!("{base}_{i}"));
        i += 1;
    }

    let fail = |e: std::io::Error| format!("Backup di OBS non riuscito ({}): {e}", dest.display());
    let mut n = copy_tree(&scenes, &dest.join("basic").join("scenes")).map_err(fail)?;
    n += copy_tree(&profiles, &dest.join("basic").join("profiles")).map_err(fail)?;
    if n == 0 {
        return Err(format!(
            "Nessun file da salvare in {}: controlla la cartella di OBS in Impostazioni.",
            basic.display()
        ));
    }

    let snap = serde_json::to_string_pretty(&istantanea).map_err(|e| e.to_string())?;
    fs::write(dest.join("istantanea-websocket.json"), snap).map_err(fail)?;
    let leggimi = format!(
        "Backup creato da Takeline prima di: {motivo}\r\n\
         Origine: {o}\r\n\r\n\
         Per ripristinare:\r\n\
         1. chiudi OBS;\r\n\
         2. copia la cartella \"basic\" di questo backup dentro {o} sovrascrivendo;\r\n\
         3. riapri OBS.\r\n\r\n\
         istantanea-websocket.json contiene collezione, profilo, scena, sorgenti e\r\n\
         parametri letti da OBS in quel momento (solo consultazione).\r\n",
        o = obs.display()
    );
    fs::write(dest.join("LEGGIMI.txt"), leggimi).map_err(fail)?;

    Ok(BackupResult {
        cartella: dest.display().to_string(),
        file_copiati: n,
        cartella_obs: obs.display().to_string(),
    })
}
