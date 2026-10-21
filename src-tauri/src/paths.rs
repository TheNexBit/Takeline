//! Percorsi dei dati di Takeline e scrittura sicura dei file.
//!
//! In sviluppo la variabile d'ambiente `TAKELINE_DATI` sposta tutti i dati
//! in una cartella di prova, cosi' gli script non toccano quelli veri.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    pub config_dir: PathBuf,
    pub presets_file: PathBuf,
    pub settings_file: PathBuf,
    pub backup_dir: PathBuf,
    pub db_file: PathBuf,
    /// Cartella Video dell'utente, base per le cartelle di output predefinite.
    pub video_dir: PathBuf,
    /// Cartella di configurazione di OBS rilevata (%APPDATA%\obs-studio).
    pub obs_config_dir: PathBuf,
}

impl Paths {
    pub fn resolve(app: &AppHandle) -> Result<Self, String> {
        let config_dir = match std::env::var_os("TAKELINE_DATI") {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => app
                .path()
                .app_config_dir()
                .map_err(|e| format!("Cartella di configurazione non disponibile: {e}"))?,
        };
        let backup_dir = config_dir.join("backup-obs");
        fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Impossibile creare {}: {e}", backup_dir.display()))?;

        let video_dir = dirs::video_dir()
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("C:\\"));
        let obs_config_dir = dirs::config_dir()
            .unwrap_or_default()
            .join("obs-studio");

        Ok(Self {
            presets_file: config_dir.join("presets.json"),
            settings_file: config_dir.join("impostazioni.json"),
            db_file: config_dir.join("takeline.db"),
            backup_dir,
            video_dir,
            obs_config_dir,
            config_dir,
        })
    }
}

/// Scrive passando da un file temporaneo: un crash a meta' non lascia mai
/// un file troncato. La versione precedente resta in `<nome>.bak`.
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if path.exists() {
        let bak = path.with_extension("json.bak");
        fs::copy(path, &bak).map_err(|e| format!("{}: {e}", bak.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}
