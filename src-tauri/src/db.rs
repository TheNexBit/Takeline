//! Libreria dei take in SQLite.
//!
//! Lo schema evolve per migrazioni numerate (PRAGMA user_version): ogni
//! milestone aggiunge la sua senza toccare le precedenti.

use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::AppState;

const MIGRAZIONI: &[&str] = &[
    // v1 — sessioni, take e marker. Il take musicale e' una region dentro la
    // take lunga di Reaper: reaper_inizio_s/reaper_fine_s la delimitano,
    // offset_s e drift_ratio collegano il file video al materiale audio.
    r#"
    CREATE TABLE sessione (
        id             INTEGER PRIMARY KEY,
        preset_id      TEXT NOT NULL,
        titolo         TEXT NOT NULL DEFAULT '',
        iniziata_il    TEXT NOT NULL,
        terminata_il   TEXT,
        reaper_progetto TEXT,
        note           TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE take (
        id              INTEGER PRIMARY KEY,
        sessione_id     INTEGER NOT NULL REFERENCES sessione(id) ON DELETE CASCADE,
        numero          INTEGER NOT NULL,
        stato           TEXT NOT NULL DEFAULT 'registrato',
        file_video      TEXT,
        iniziato_il     TEXT NOT NULL,
        durata_s        REAL,
        reaper_inizio_s REAL,
        reaper_fine_s   REAL,
        offset_s        REAL,
        drift_ratio     REAL,
        sync_info       TEXT,
        UNIQUE (sessione_id, numero)
    );
    CREATE TABLE marker (
        id          INTEGER PRIMARY KEY,
        sessione_id INTEGER NOT NULL REFERENCES sessione(id) ON DELETE CASCADE,
        take_id     INTEGER REFERENCES take(id) ON DELETE CASCADE,
        tipo        TEXT NOT NULL,
        tempo_s     REAL NOT NULL,
        etichetta   TEXT NOT NULL DEFAULT '',
        creato_il   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX take_sessione ON take (sessione_id);
    CREATE INDEX marker_take ON marker (take_id);
    "#,
    // v2 — transport. Un replay salvato e' un take di tipo 'replay' nella
    // stessa numerazione. clap_s e' l'istante del clap nel file video; nei
    // marker tempo_s e' relativo al file video, reaper_s alla timeline di Reaper.
    r#"
    ALTER TABLE take ADD COLUMN tipo TEXT NOT NULL DEFAULT 'take';
    ALTER TABLE take ADD COLUMN clap_s REAL;
    ALTER TABLE marker ADD COLUMN reaper_s REAL;
    ALTER TABLE sessione ADD COLUMN scaletta TEXT NOT NULL DEFAULT '[]';
    "#,
    // v3 — file audio registrati da Reaper che contengono il take, uno per riga
    // (piu' tracce armate = piu' file). Si chiedono a Reaper via script bridge.
    r#"
    ALTER TABLE take ADD COLUMN file_audio TEXT;
    "#,
    // v4 — post-produzione e ciclo di vita. `lavoro` e' la coda di ffmpeg
    // (sopravvive al riavvio); `file_take` elenca ogni file prodotto per un
    // take, cosi' archiviare o liberare spazio sa esattamente cosa toccare.
    r#"
    CREATE TABLE lavoro (
        id          INTEGER PRIMARY KEY,
        take_id     INTEGER REFERENCES take(id) ON DELETE SET NULL,
        tipo        TEXT NOT NULL,
        stato       TEXT NOT NULL DEFAULT 'attesa',
        parametri   TEXT NOT NULL DEFAULT '{}',
        progresso   REAL NOT NULL DEFAULT 0,
        uscita      TEXT,
        errore      TEXT,
        creato_il   TEXT NOT NULL DEFAULT (datetime('now')),
        iniziato_il TEXT,
        finito_il   TEXT
    );
    CREATE INDEX lavoro_stato ON lavoro (stato);
    CREATE TABLE file_take (
        id        INTEGER PRIMARY KEY,
        take_id   INTEGER NOT NULL REFERENCES take(id) ON DELETE CASCADE,
        ruolo     TEXT NOT NULL,
        percorso  TEXT NOT NULL,
        creato_il TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (take_id, percorso)
    );
    "#,
];

pub fn open(path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    migrate(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Result<Connection, String> {
    let mut conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    migrate(&mut conn)?;
    Ok(conn)
}

fn migrate(conn: &mut Connection) -> Result<(), String> {
    let current: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if current > MIGRAZIONI.len() as i64 {
        return Err(format!(
            "Il database e' alla versione {current}, piu' recente di questa Takeline ({}). Aggiorna l'app.",
            MIGRAZIONI.len()
        ));
    }
    for (i, sql) in MIGRAZIONI.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(sql).map_err(|e| format!("Migrazione {}: {e}", i + 1))?;
        tx.pragma_update(None, "user_version", (i + 1) as i64).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub percorso: String,
    pub versione_schema: i64,
    pub take: i64,
}

#[tauri::command]
pub fn db_info(state: State<'_, AppState>) -> Result<DbInfo, String> {
    let conn = state.db.lock().map_err(|_| "Database non disponibile".to_string())?;
    let versione_schema = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let take = conn
        .query_row("SELECT COUNT(*) FROM take", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbInfo { percorso: state.paths.db_file.display().to_string(), versione_schema, take })
}

#[cfg(test)]
mod tests {
    #[test]
    fn migrazioni_idempotenti() {
        let dir = std::env::temp_dir().join(format!("takeline-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("t.db");
        drop(super::open(&file).unwrap());
        let conn = super::open(&file).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, super::MIGRAZIONI.len() as i64);
        drop(conn);
        let _ = std::fs::remove_dir_all(dir);
    }
}
