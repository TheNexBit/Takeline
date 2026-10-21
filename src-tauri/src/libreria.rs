//! Sessioni, take e marker. Il frontend guida il transport; qui si registra
//! cosa e' successo, cosi' nulla si perde se l'app si chiude a meta'.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use tauri::State;

use crate::AppState;

pub const STATI_TAKE: &[&str] = &["registrato", "buono", "da_tagliare", "scartato", "pubblicato", "archiviato"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sessione {
    pub id: i64,
    pub preset_id: String,
    pub titolo: String,
    pub iniziata_il: String,
    pub terminata_il: Option<String>,
    pub scaletta: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    pub id: i64,
    pub sessione_id: i64,
    pub numero: i64,
    pub tipo: String,
    pub stato: String,
    pub file_video: Option<String>,
    pub iniziato_il: String,
    pub durata_s: Option<f64>,
    pub reaper_inizio_s: Option<f64>,
    pub reaper_fine_s: Option<f64>,
    pub clap_s: Option<f64>,
    pub marker: i64,
    /// File audio di Reaper che contengono il take, uno per riga.
    pub file_audio: Option<String>,
    /// Sync misurato: istante del WAV di Reaper a t=0 del video.
    pub offset_s: Option<f64>,
    /// Secondi di audio per secondo di video.
    pub drift_ratio: Option<f64>,
    /// Dettagli della misura (JSON).
    pub sync_info: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: i64,
    pub take_id: Option<i64>,
    pub tipo: String,
    pub tempo_s: f64,
    pub reaper_s: Option<f64>,
    pub etichetta: String,
}

fn conn<'a>(state: &'a State<'_, AppState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.db.lock().map_err(|_| "Database non disponibile".to_string())
}

fn err(e: rusqlite::Error) -> String {
    format!("Database: {e}")
}

fn riga_sessione(r: &Row) -> rusqlite::Result<Sessione> {
    let scaletta: String = r.get(5)?;
    Ok(Sessione {
        id: r.get(0)?,
        preset_id: r.get(1)?,
        titolo: r.get(2)?,
        iniziata_il: r.get(3)?,
        terminata_il: r.get(4)?,
        scaletta: serde_json::from_str(&scaletta).unwrap_or_default(),
    })
}

const COLONNE_SESSIONE: &str = "id, preset_id, titolo, iniziata_il, terminata_il, scaletta";

const SELECT_TAKE: &str = "SELECT t.id, t.sessione_id, t.numero, t.tipo, t.stato, t.file_video, t.iniziato_il,
        t.durata_s, t.reaper_inizio_s, t.reaper_fine_s, t.clap_s,
        (SELECT COUNT(*) FROM marker m WHERE m.take_id = t.id), t.file_audio,
        t.offset_s, t.drift_ratio, t.sync_info
     FROM take t";

fn riga_take(r: &Row) -> rusqlite::Result<Take> {
    Ok(Take {
        id: r.get(0)?,
        sessione_id: r.get(1)?,
        numero: r.get(2)?,
        tipo: r.get(3)?,
        stato: r.get(4)?,
        file_video: r.get(5)?,
        iniziato_il: r.get(6)?,
        durata_s: r.get(7)?,
        reaper_inizio_s: r.get(8)?,
        reaper_fine_s: r.get(9)?,
        clap_s: r.get(10)?,
        marker: r.get(11)?,
        file_audio: r.get(12)?,
        offset_s: r.get(13)?,
        drift_ratio: r.get(14)?,
        sync_info: r.get(15)?,
    })
}

fn leggi_take(c: &Connection, id: i64) -> Result<Take, String> {
    c.query_row(&format!("{SELECT_TAKE} WHERE t.id = ?1"), [id], riga_take).map_err(err)
}

#[tauri::command]
pub fn sessione_apri(
    state: State<'_, AppState>,
    preset_id: String,
    titolo: String,
    scaletta: Vec<String>,
    iniziata_il: String,
) -> Result<Sessione, String> {
    let c = conn(&state)?;
    let json = serde_json::to_string(&scaletta).map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO sessione (preset_id, titolo, iniziata_il, scaletta) VALUES (?1, ?2, ?3, ?4)",
        params![preset_id, titolo, iniziata_il, json],
    )
    .map_err(err)?;
    let id = c.last_insert_rowid();
    c.query_row(&format!("SELECT {COLONNE_SESSIONE} FROM sessione WHERE id = ?1"), [id], riga_sessione)
        .map_err(err)
}

#[tauri::command]
pub fn sessione_chiudi(state: State<'_, AppState>, id: i64, terminata_il: String) -> Result<(), String> {
    conn(&state)?
        .execute(
            "UPDATE sessione SET terminata_il = ?2 WHERE id = ?1 AND terminata_il IS NULL",
            params![id, terminata_il],
        )
        .map(|_| ())
        .map_err(err)
}

/// L'ultima sessione rimasta aperta (app chiusa senza terminarla).
#[tauri::command]
pub fn sessione_aperta(state: State<'_, AppState>) -> Result<Option<Sessione>, String> {
    conn(&state)?
        .query_row(
            &format!("SELECT {COLONNE_SESSIONE} FROM sessione WHERE terminata_il IS NULL ORDER BY id DESC LIMIT 1"),
            [],
            riga_sessione,
        )
        .optional()
        .map_err(err)
}

#[tauri::command]
pub fn sessione_take(state: State<'_, AppState>, sessione_id: i64) -> Result<Vec<Take>, String> {
    let c = conn(&state)?;
    let mut st = c
        .prepare(&format!("{SELECT_TAKE} WHERE t.sessione_id = ?1 ORDER BY t.numero"))
        .map_err(err)?;
    let righe = st.query_map([sessione_id], riga_take).map_err(err)?;
    righe.collect::<Result<_, _>>().map_err(err)
}

/// Il numero e' progressivo nella sessione, condiviso tra take e replay.
#[tauri::command]
pub fn take_crea(
    state: State<'_, AppState>,
    sessione_id: i64,
    tipo: String,
    iniziato_il: String,
    reaper_inizio_s: Option<f64>,
    file_video: Option<String>,
) -> Result<Take, String> {
    if tipo != "take" && tipo != "replay" {
        return Err(format!("Tipo di take sconosciuto: {tipo}"));
    }
    let c = conn(&state)?;
    let numero: i64 = c
        .query_row(
            "SELECT COALESCE(MAX(numero), 0) + 1 FROM take WHERE sessione_id = ?1",
            [sessione_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    c.execute(
        "INSERT INTO take (sessione_id, numero, tipo, iniziato_il, reaper_inizio_s, file_video)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![sessione_id, numero, tipo, iniziato_il, reaper_inizio_s, file_video],
    )
    .map_err(err)?;
    leggi_take(&c, c.last_insert_rowid())
}

#[tauri::command]
pub fn take_chiudi(
    state: State<'_, AppState>,
    id: i64,
    file_video: Option<String>,
    durata_s: f64,
    reaper_fine_s: Option<f64>,
) -> Result<Take, String> {
    let c = conn(&state)?;
    c.execute(
        "UPDATE take SET file_video = COALESCE(?2, file_video), durata_s = ?3, reaper_fine_s = ?4 WHERE id = ?1",
        params![id, file_video, durata_s, reaper_fine_s],
    )
    .map_err(err)?;
    leggi_take(&c, id)
}

#[tauri::command]
pub fn take_stato(state: State<'_, AppState>, id: i64, stato: String) -> Result<Take, String> {
    if !STATI_TAKE.contains(&stato.as_str()) {
        return Err(format!("Stato di take sconosciuto: {stato}"));
    }
    let c = conn(&state)?;
    c.execute("UPDATE take SET stato = ?2 WHERE id = ?1", params![id, stato]).map_err(err)?;
    leggi_take(&c, id)
}

#[tauri::command]
pub fn take_audio(state: State<'_, AppState>, id: i64, file_audio: String) -> Result<Take, String> {
    let c = conn(&state)?;
    c.execute("UPDATE take SET file_audio = ?2 WHERE id = ?1", params![id, file_audio]).map_err(err)?;
    leggi_take(&c, id)
}

#[tauri::command]
pub fn take_sync(
    state: State<'_, AppState>,
    id: i64,
    offset_s: f64,
    drift_ratio: f64,
    sync_info: String,
) -> Result<Take, String> {
    let c = conn(&state)?;
    c.execute(
        "UPDATE take SET offset_s = ?2, drift_ratio = ?3, sync_info = ?4 WHERE id = ?1",
        params![id, offset_s, drift_ratio, sync_info],
    )
    .map_err(err)?;
    leggi_take(&c, id)
}

#[tauri::command]
pub fn take_clap(state: State<'_, AppState>, id: i64, clap_s: f64) -> Result<(), String> {
    conn(&state)?
        .execute("UPDATE take SET clap_s = ?2 WHERE id = ?1", params![id, clap_s])
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
pub fn marker_aggiungi(
    state: State<'_, AppState>,
    sessione_id: i64,
    take_id: Option<i64>,
    tipo: String,
    tempo_s: f64,
    reaper_s: Option<f64>,
    etichetta: String,
) -> Result<Marker, String> {
    let c = conn(&state)?;
    c.execute(
        "INSERT INTO marker (sessione_id, take_id, tipo, tempo_s, reaper_s, etichetta) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![sessione_id, take_id, tipo, tempo_s, reaper_s, etichetta],
    )
    .map_err(err)?;
    Ok(Marker { id: c.last_insert_rowid(), take_id, tipo, tempo_s, reaper_s, etichetta })
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    #[test]
    fn numerazione_condivisa_tra_take_e_replay() {
        let c = crate::db::open_in_memory().unwrap();
        c.execute(
            "INSERT INTO sessione (preset_id, titolo, iniziata_il) VALUES ('p', 't', 'ora')",
            [],
        )
        .unwrap();
        for (n, tipo) in ["take", "replay", "take"].iter().enumerate() {
            let numero: i64 = c
                .query_row("SELECT COALESCE(MAX(numero), 0) + 1 FROM take WHERE sessione_id = 1", [], |r| r.get(0))
                .unwrap();
            assert_eq!(numero, n as i64 + 1);
            c.execute(
                "INSERT INTO take (sessione_id, numero, tipo, iniziato_il) VALUES (1, ?1, ?2, 'ora')",
                params![numero, tipo],
            )
            .unwrap();
        }
        let take = c
            .query_row(&format!("{} WHERE t.numero = 2", super::SELECT_TAKE), [], super::riga_take)
            .unwrap();
        assert_eq!(take.tipo, "replay");
        assert_eq!(take.stato, "registrato");
    }
}
