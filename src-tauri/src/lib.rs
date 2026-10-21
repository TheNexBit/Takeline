//! Takeline — backend Tauri.
//!
//! OBS si pilota dal frontend via obs-websocket; qui stanno le cose che il
//! webview non puo' o non deve fare: HTTP verso Reaper, file system, backup
//! della configurazione di OBS, SQLite, ffmpeg e API Win32.

mod ciclo;
mod db;
mod docs;
mod libreria;
mod log;
mod obs_backup;
mod paths;
mod post;
mod reaper;
mod sync;
mod system;

use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, State};

use paths::Paths;

pub struct AppState {
    pub paths: Paths,
    pub db: Mutex<rusqlite::Connection>,
    pub http: reqwest::Client,
    pub log: log::Log,
}

#[tauri::command]
fn app_paths(state: State<'_, AppState>) -> Paths {
    state.paths.clone()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let paths = Paths::resolve(app.handle())?;
            let log = log::Log::new(paths.config_dir.join("log"));
            log.scrivi(
                None,
                "info",
                "app",
                &format!("Takeline {} avviata, dati in {}", env!("CARGO_PKG_VERSION"), paths.config_dir.display()),
            );
            let db = db::open(&paths.db_file)?;
            let http = reqwest::Client::builder()
                .timeout(Duration::from_millis(2500))
                .build()?;
            app.manage(AppState { paths, db: Mutex::new(db), http, log });
            app.manage(post::Coda::default());
            post::avvia(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_paths,
            docs::doc_load,
            docs::doc_save,
            docs::json_esporta,
            docs::json_importa,
            obs_backup::obs_backup,
            obs_backup::obs_backtrack_verticale,
            reaper::reaper_status,
            reaper::reaper_action,
            reaper::reaper_bridge,
            reaper::reaper_installa_bridge,
            reaper::reaper_progetto,
            sync::sync_analizza,
            sync::sync_esporta,
            system::disk_space,
            system::ensure_dir,
            system::ffmpeg_info,
            system::active_window,
            system::file_recenti,
            db::db_info,
            libreria::sessione_apri,
            libreria::sessione_chiudi,
            libreria::sessione_aperta,
            libreria::sessione_take,
            libreria::take_crea,
            libreria::take_chiudi,
            libreria::take_stato,
            libreria::take_clap,
            libreria::take_audio,
            libreria::take_sync,
            libreria::marker_aggiungi,
            log::log_scrivi,
            post::post_accoda,
            post::post_elenco,
            post::post_annulla,
            post::post_riprova,
            post::post_pausa,
            post::post_pulisci,
            post::file_registra,
            ciclo::libreria_take,
            ciclo::file_cestina,
            ciclo::take_archivia,
            ciclo::take_capitoli,
            ciclo::take_edl,
            log::log_cartella,
        ])
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Takeline");
}
