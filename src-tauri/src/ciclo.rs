//! Ciclo di vita dei file: cosa occupa ogni take, archivio, Cestino, e gli
//! export dei marker (capitoli YouTube ed EDL).
//!
//! Regola: si tocca solo cio' che appartiene al take (il video e i file in
//! `file_take`), mai i WAV di Reaper che possono contenere altre take, e
//! niente viene eliminato: si sposta nel Cestino di Windows. La conferma la
//! chiede sempre l'interfaccia prima di chiamare questi comandi.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::post::{accanto, registra_file};
use crate::sync::{ffprobe_json, frazione, num};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTake {
    /// originale | remux | traccia | loudnorm | export | proxy | sync | capitoli | edl
    pub ruolo: String,
    pub percorso: String,
    pub byte: u64,
    pub esiste: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoceLibreria {
    pub take_id: i64,
    pub sessione_id: i64,
    pub preset_id: String,
    pub titolo: String,
    pub sessione_il: String,
    pub numero: i64,
    pub tipo: String,
    pub stato: String,
    pub iniziato_il: String,
    pub durata_s: Option<f64>,
    pub sincronizzato: bool,
    pub file: Vec<FileTake>,
    pub byte: u64,
}

fn conn<'a>(state: &'a State<'_, AppState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.db.lock().map_err(|_| "Database non disponibile".to_string())
}

fn info_file(ruolo: &str, percorso: &str) -> FileTake {
    let meta = fs::metadata(percorso).ok();
    FileTake { ruolo: ruolo.into(), percorso: percorso.into(), byte: meta.as_ref().map_or(0, |m| m.len()), esiste: meta.is_some() }
}

/// Tutti i file di un take: il video originale e quelli prodotti dopo.
fn file_del_take(c: &Connection, take_id: i64) -> Result<Vec<FileTake>, String> {
    let video: Option<String> = c
        .query_row("SELECT file_video FROM take WHERE id = ?1", [take_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let mut out: Vec<FileTake> = video.iter().map(|v| info_file("originale", v)).collect();
    let mut st = c.prepare("SELECT ruolo, percorso FROM file_take WHERE take_id = ?1 ORDER BY id").map_err(|e| e.to_string())?;
    let righe = st
        .query_map([take_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for (ruolo, p) in righe.filter_map(Result::ok) {
        if !out.iter().any(|f| f.percorso == p) {
            out.push(info_file(&ruolo, &p));
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn libreria_take(state: State<'_, AppState>) -> Result<Vec<VoceLibreria>, String> {
    let c = conn(&state)?;
    let mut st = c
        .prepare(
            "SELECT t.id, t.sessione_id, s.preset_id, s.titolo, s.iniziata_il, t.numero, t.tipo, t.stato,
                    t.iniziato_il, t.durata_s, t.offset_s IS NOT NULL
             FROM take t JOIN sessione s ON s.id = t.sessione_id
             ORDER BY t.sessione_id DESC, t.numero DESC",
        )
        .map_err(|e| e.to_string())?;
    let base = st
        .query_map([], |r| {
            Ok(VoceLibreria {
                take_id: r.get(0)?,
                sessione_id: r.get(1)?,
                preset_id: r.get(2)?,
                titolo: r.get(3)?,
                sessione_il: r.get(4)?,
                numero: r.get(5)?,
                tipo: r.get(6)?,
                stato: r.get(7)?,
                iniziato_il: r.get(8)?,
                durata_s: r.get(9)?,
                sincronizzato: r.get(10)?,
                file: Vec::new(),
                byte: 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    drop(st);
    let mut voci = Vec::with_capacity(base.len());
    for mut v in base {
        v.file = file_del_take(&c, v.take_id)?;
        v.byte = v.file.iter().map(|f| f.byte).sum();
        voci.push(v);
    }
    Ok(voci)
}

/// Sposta nel Cestino di Windows i file indicati, solo se appartengono al take.
#[tauri::command]
pub fn file_cestina(state: State<'_, AppState>, take_id: i64, percorsi: Vec<String>) -> Result<usize, String> {
    let c = conn(&state)?;
    let del_take = file_del_take(&c, take_id)?;
    let mut spostati = 0;
    for p in &percorsi {
        if !del_take.iter().any(|f| &f.percorso == p) {
            return Err(format!("{p} non appartiene al take: non lo tocco."));
        }
        if !Path::new(p).exists() {
            continue;
        }
        trash::delete(p).map_err(|e| format!("{p}: non spostato nel Cestino ({e})"))?;
        spostati += 1;
        c.execute("DELETE FROM file_take WHERE take_id = ?1 AND percorso = ?2", params![take_id, p])
            .map_err(|e| e.to_string())?;
        state.log.scrivi(None, "info", "libreria", &format!("take {take_id}: nel Cestino {p}"));
    }
    Ok(spostati)
}

/// Sposta un file; tra unita' diverse copia e poi cancella l'originale.
fn sposta(da: &Path, a: &Path) -> std::io::Result<()> {
    if fs::rename(da, a).is_ok() {
        return Ok(());
    }
    fs::copy(da, a)?;
    let (n_da, n_a) = (fs::metadata(da)?.len(), fs::metadata(a)?.len());
    if n_da != n_a {
        let _ = fs::remove_file(a);
        return Err(std::io::Error::other("copia incompleta"));
    }
    fs::remove_file(da)
}

/// Archivia tutti i file del take in `cartella` (mai sovrascrivendo) e lo segna come archiviato.
#[tauri::command]
pub fn take_archivia(state: State<'_, AppState>, take_id: i64, cartella: String) -> Result<Vec<String>, String> {
    let dest = PathBuf::from(&cartella);
    fs::create_dir_all(&dest).map_err(|e| format!("{cartella}: {e}"))?;
    let c = conn(&state)?;
    let mut spostati = Vec::new();
    for f in file_del_take(&c, take_id)?.into_iter().filter(|f| f.esiste) {
        let da = PathBuf::from(&f.percorso);
        let a = dest.join(da.file_name().ok_or("nome di file non valido")?);
        if a.exists() {
            return Err(format!("{} esiste gia' nell'archivio: non lo sovrascrivo.", a.display()));
        }
        sposta(&da, &a).map_err(|e| format!("{}: {e}", da.display()))?;
        let nuovo = a.display().to_string();
        if f.ruolo == "originale" {
            c.execute("UPDATE take SET file_video = ?2 WHERE id = ?1", params![take_id, nuovo])
                .map_err(|e| e.to_string())?;
        } else {
            c.execute(
                "UPDATE file_take SET percorso = ?3 WHERE take_id = ?1 AND percorso = ?2",
                params![take_id, f.percorso, nuovo],
            )
            .map_err(|e| e.to_string())?;
        }
        state.log.scrivi(None, "info", "libreria", &format!("take {take_id}: archiviato {} -> {nuovo}", f.percorso));
        spostati.push(nuovo);
    }
    c.execute("UPDATE take SET stato = 'archiviato' WHERE id = ?1", [take_id]).map_err(|e| e.to_string())?;
    Ok(spostati)
}

// --- capitoli ed EDL -------------------------------------------------------

struct MarkerExport {
    tipo: String,
    tempo_s: f64,
    etichetta: String,
}

fn marker_del_take(c: &Connection, take_id: i64) -> Result<Vec<MarkerExport>, String> {
    let mut st = c
        .prepare("SELECT tipo, tempo_s, etichetta FROM marker WHERE take_id = ?1 ORDER BY tempo_s")
        .map_err(|e| e.to_string())?;
    let righe = st
        .query_map([take_id], |r| Ok(MarkerExport { tipo: r.get(0)?, tempo_s: r.get(1)?, etichetta: r.get(2)? }))
        .map_err(|e| e.to_string())?;
    Ok(righe.filter_map(Result::ok).collect())
}

fn tempo_youtube(s: f64) -> String {
    let s = s.max(0.0).floor() as u64;
    if s >= 3600 {
        format!("{}:{:02}:{:02}", s / 3600, s % 3600 / 60, s % 60)
    } else {
        format!("{:02}:{:02}", s / 60, s % 60)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsitoCapitoli {
    pub file: String,
    pub testo: String,
    /// Regole di YouTube non rispettate: i capitoli potrebbero non comparire.
    pub avvisi: Vec<String>,
}

/// Capitoli per la descrizione di YouTube: il primo a 00:00, almeno 3, ciascuno di almeno 10 s.
pub fn capitoli_youtube(capitoli: &[(f64, String)], durata: Option<f64>) -> (String, Vec<String>) {
    let mut voci: Vec<(f64, String)> = capitoli.to_vec();
    // Un primo capitolo nei primi secondi (dopo il clap) diventa quello a 00:00;
    // se parte piu' tardi, prima ci va un "Inizio".
    if voci.first().is_none_or(|(t, _)| *t >= 10.0) {
        voci.insert(0, (0.0, "Inizio".into()));
    } else {
        voci[0].0 = 0.0;
    }
    let mut avvisi = Vec::new();
    if voci.len() < 3 {
        avvisi.push(format!("YouTube vuole almeno 3 capitoli: qui sono {}.", voci.len()));
    }
    let fine = durata.unwrap_or(f64::MAX);
    for (i, (t, nome)) in voci.iter().enumerate() {
        let prossimo = voci.get(i + 1).map_or(fine, |v| v.0);
        if prossimo - t < 10.0 {
            avvisi.push(format!("\"{nome}\" dura meno di 10 secondi: YouTube lo ignora."));
        }
    }
    let testo = voci.iter().map(|(t, n)| format!("{} {n}", tempo_youtube(*t))).collect::<Vec<_>>().join("\n");
    (testo, avvisi)
}

fn video_del_take(c: &Connection, take_id: i64) -> Result<String, String> {
    c.query_row("SELECT file_video FROM take WHERE id = ?1", [take_id], |r| r.get::<_, Option<String>>(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten()
        .ok_or_else(|| "Il take non ha un file video.".to_string())
}

#[tauri::command]
pub fn take_capitoli(app: AppHandle, state: State<'_, AppState>, take_id: i64) -> Result<EsitoCapitoli, String> {
    let (video, marker, durata) = {
        let c = conn(&state)?;
        let durata: Option<f64> = c.query_row("SELECT durata_s FROM take WHERE id = ?1", [take_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        (video_del_take(&c, take_id)?, marker_del_take(&c, take_id)?, durata)
    };
    let capitoli: Vec<(f64, String)> = marker
        .into_iter()
        .filter(|m| m.tipo == "capitolo")
        .map(|m| (m.tempo_s, m.etichetta))
        .collect();
    if capitoli.is_empty() {
        return Err("Il take non ha capitoli: si creano con “Nuovo capitolo” durante la registrazione.".into());
    }
    let (testo, avvisi) = capitoli_youtube(&capitoli, durata);
    let file = accanto(&video, "_capitoli", "txt");
    fs::write(&file, format!("{testo}\r\n")).map_err(|e| format!("{file}: {e}"))?;
    registra_file(&app, take_id, "capitoli", &file);
    Ok(EsitoCapitoli { file, testo, avvisi })
}

/// Timecode HH:MM:SS:FF partendo da 01:00:00:00, come le timeline dei montaggi.
pub fn timecode(secondi: f64, fps: u32) -> String {
    let fotogrammi = (secondi * fps as f64).round() as u64 + 3600 * fps as u64;
    let f = fotogrammi % fps as u64;
    let s = fotogrammi / fps as u64;
    format!("{:02}:{:02}:{:02}:{:02}", s / 3600, s % 3600 / 60, s % 60, f)
}

fn colore_resolve(tipo: &str) -> &'static str {
    match tipo {
        "capitolo" => "ResolveColorBlue",
        "buono" => "ResolveColorGreen",
        "taglia" => "ResolveColorRed",
        "clap" => "ResolveColorYellow",
        _ => "ResolveColorPink",
    }
}

pub fn edl(nome: &str, file_video: &str, durata: f64, fps: u32, marker: &[(String, f64, String)]) -> (String, String) {
    let fine = timecode(durata, fps);
    let inizio = timecode(0.0, fps);
    let sorgente_fine = {
        // La sorgente parte da 00:00:00:00, la timeline da 01:00:00:00.
        let f = (durata * fps as f64).round() as u64;
        format!("{:02}:{:02}:{:02}:{:02}", f / fps as u64 / 3600, f / fps as u64 % 3600 / 60, f / fps as u64 % 60, f % fps as u64)
    };
    let nome_file = Path::new(file_video).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    // EDL del montaggio (CMX3600): la clip intera e i marker come locator.
    let mut taglio = format!(
        "TITLE: {nome}\r\nFCM: NON-DROP FRAME\r\n\r\n001  AX       V     C        00:00:00:00 {sorgente_fine} {inizio} {fine}\r\n* FROM CLIP NAME: {nome_file}\r\n"
    );
    for (tipo, t, etichetta) in marker {
        taglio.push_str(&format!("* LOC: {} {:<7} {}\r\n", timecode(*t, fps), tipo.to_uppercase(), etichetta));
    }

    // Marker per DaVinci Resolve (Timeline › Import › Timeline Markers from EDL).
    let mut marcatori = format!("TITLE: {nome} marker\r\nFCM: NON-DROP FRAME\r\n\r\n");
    for (i, (tipo, t, etichetta)) in marker.iter().enumerate() {
        let tc = timecode(*t, fps);
        let tc1 = timecode(*t + 1.0 / fps as f64, fps);
        marcatori.push_str(&format!(
            "{:03}  001      V     C        {tc} {tc1} {tc} {tc1}  \r\n |C:{} |M:{} |D:1\r\n\r\n",
            i + 1,
            colore_resolve(tipo),
            etichetta.replace('|', "/")
        ));
    }
    (taglio, marcatori)
}

#[tauri::command]
pub fn take_edl(app: AppHandle, state: State<'_, AppState>, take_id: i64, ffmpeg: String) -> Result<Vec<String>, String> {
    let (video, marker) = {
        let c = conn(&state)?;
        (video_del_take(&c, take_id)?, marker_del_take(&c, take_id)?)
    };
    let j = ffprobe_json(&ffmpeg, &["-select_streams", "v:0", "-show_entries", "stream=r_frame_rate:format=duration"], &video)?;
    let fps = frazione(&j["streams"][0]["r_frame_rate"]).unwrap_or(30.0).round().max(1.0) as u32;
    let durata = num(&j["format"]["duration"]).unwrap_or(0.0);
    let nome = Path::new(&video).file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let righe: Vec<(String, f64, String)> = marker.into_iter().map(|m| (m.tipo, m.tempo_s, m.etichetta)).collect();
    let (taglio, marcatori) = edl(&nome, &video, durata, fps, &righe);
    let (f1, f2) = (accanto(&video, "", "edl"), accanto(&video, "_marker_resolve", "edl"));
    fs::write(&f1, taglio).map_err(|e| format!("{f1}: {e}"))?;
    fs::write(&f2, marcatori).map_err(|e| format!("{f2}: {e}"))?;
    registra_file(&app, take_id, "edl", &f1);
    registra_file(&app, take_id, "edl", &f2);
    let _ = app.state::<AppState>().log.scrivi(None, "info", "libreria", &format!("take {take_id}: EDL {f1}, {f2}"));
    Ok(vec![f1, f2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capitoli_secondo_le_regole_di_youtube() {
        let (testo, avvisi) = capitoli_youtube(
            &[(3.0, "Intro".into()), (65.0, "Accordi".into()), (130.4, "Ritmica".into())],
            Some(300.0),
        );
        assert_eq!(testo, "00:00 Intro\n01:05 Accordi\n02:10 Ritmica");
        assert!(avvisi.is_empty(), "{avvisi:?}");
        let (testo, avvisi) = capitoli_youtube(&[(20.0, "Unico".into())], Some(25.0));
        assert_eq!(testo, "00:00 Inizio\n00:20 Unico");
        assert_eq!(avvisi.len(), 2); // meno di 3 capitoli, "Unico" dura 5 s
    }

    #[test]
    fn timecode_da_un_ora() {
        assert_eq!(timecode(0.0, 30), "01:00:00:00");
        assert_eq!(timecode(65.5, 30), "01:01:05:15");
    }

    #[test]
    fn edl_con_marker_per_resolve() {
        let (taglio, marcatori) = edl("take01", r"C:\v\take01.mp4", 10.0, 25, &[("capitolo".into(), 2.0, "Intro".into())]);
        assert!(taglio.contains("001  AX       V     C        00:00:00:00 00:00:10:00 01:00:00:00 01:00:10:00"));
        assert!(taglio.contains("* LOC: 01:00:02:00 CAPITOLO Intro"));
        assert!(marcatori.contains("|C:ResolveColorBlue |M:Intro |D:1"));
    }
}
