//! Sync tra video (OBS) e audio (Reaper).
//!
//! I due programmi hanno clock diversi: allineare l'inizio non basta, perche'
//! anche 20 ppm di differenza a fine brano sono di nuovo fuori sync. Quindi:
//!
//! 1. si misura dove cade un tratto della traccia guida del video dentro il
//!    WAV di Reaper, all'inizio della take e verso la fine (correlazione
//!    incrociata GCC-PHAT su audio mono a 16 kHz estratto con ffmpeg);
//! 2. dalle due misure: tempo_audio = inizio + rapporto * tempo_video;
//! 3. l'export corregge la velocita' dell'audio (asetrate + aresample), non
//!    lo sposta soltanto.
//!
//! Si verifica anche che il video sia a frame rate costante.

use std::path::{Path, PathBuf};
use std::process::Command;

use rustfft::{num_complex::Complex32, FftPlanner};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::system::ffmpeg_command;

/// Frequenza di analisi: 62,5 us per campione, con l'interpolazione si scende molto sotto.
const SR_ANALISI: u32 = 16_000;
/// Oltre questo scostamento tra i clock la misura e' quasi certamente sbagliata.
const DRIFT_MAX_PPM: f64 = 1000.0;

// --- strumenti esterni ---------------------------------------------------

pub(crate) fn ffprobe_command(ffmpeg: &str) -> Command {
    let p = ffmpeg.trim();
    let exe = if p.is_empty() {
        PathBuf::from("ffprobe")
    } else {
        let f = Path::new(p);
        f.with_file_name(if f.extension().is_some() { "ffprobe.exe" } else { "ffprobe" })
    };
    // Stessa cartella e stesse opzioni (niente finestra di console) di ffmpeg.
    let mut cmd = ffmpeg_command(&exe.to_string_lossy());
    cmd.args(["-v", "error", "-of", "json"]);
    cmd
}

pub(crate) fn esegui(mut cmd: Command, cosa: &str) -> Result<Vec<u8>, String> {
    let out = cmd.output().map_err(|e| format!("{cosa}: impossibile avviare il programma ({e})"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let riga = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("errore sconosciuto");
        return Err(format!("{cosa}: {riga}"));
    }
    Ok(out.stdout)
}

pub(crate) fn ffprobe_json(ffmpeg: &str, args: &[&str], file: &str) -> Result<Value, String> {
    let mut cmd = ffprobe_command(ffmpeg);
    cmd.args(args).arg(file);
    let out = esegui(cmd, &format!("ffprobe su {file}"))?;
    serde_json::from_slice(&out).map_err(|e| format!("ffprobe: risposta non valida ({e})"))
}

pub(crate) fn num(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str()?.parse().ok())
}

/// "60000/1001" -> 59.94
pub(crate) fn frazione(v: &Value) -> Option<f64> {
    let s = v.as_str()?;
    let (a, b) = s.split_once('/')?;
    let (a, b): (f64, f64) = (a.parse().ok()?, b.parse().ok()?);
    (b != 0.0).then(|| a / b)
}

/// Campioni mono a 16 kHz di un tratto di file (stream audio `flusso`).
fn estrai_pcm(ffmpeg: &str, file: &str, flusso: usize, inizio: f64, durata: f64) -> Result<Vec<f32>, String> {
    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args(["-v", "error", "-nostdin"])
        .args(["-ss", &format!("{:.6}", inizio.max(0.0))])
        .args(["-t", &format!("{:.6}", durata)])
        .arg("-i")
        .arg(file)
        .args(["-map", &format!("0:a:{flusso}"), "-ac", "1", "-ar", &SR_ANALISI.to_string(), "-f", "f32le", "-"]);
    let out = esegui(cmd, &format!("estrazione audio da {file}"))?;
    Ok(out.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

// --- correlazione --------------------------------------------------------

/// Dove inizia `rif` dentro `zona`, in campioni (con frazione), e quanto e'
/// netto il picco (rapporto tra il primo e il secondo picco).
///
/// GCC-PHAT: lo spettro incrociato viene normalizzato in ampiezza, cosi'
/// conta solo la fase. Il picco resta stretto anche con riverbero, rumore o
/// equalizzazioni diverse tra traccia guida e registrazione.
pub fn gcc_phat(rif: &[f32], zona: &[f32]) -> Option<(f64, f64)> {
    if rif.len() < 1024 || zona.len() < rif.len() {
        return None;
    }
    let n = (rif.len() + zona.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let avanti = planner.plan_fft_forward(n);
    let indietro = planner.plan_fft_inverse(n);

    let riempi = |x: &[f32]| {
        let mut v = vec![Complex32::new(0.0, 0.0); n];
        for (d, s) in v.iter_mut().zip(x) {
            d.re = *s;
        }
        v
    };
    let mut a = riempi(zona);
    let mut b = riempi(rif);
    avanti.process(&mut a);
    avanti.process(&mut b);

    // Solo la banda utile della musica: sotto 80 Hz rombi, sopra 6 kHz rumore.
    let bin_hz = SR_ANALISI as f32 / n as f32;
    let (basso, alto) = ((80.0 / bin_hz) as usize, (6000.0 / bin_hz) as usize);
    for (k, (x, y)) in a.iter_mut().zip(&b).enumerate() {
        let f = k.min(n - k);
        let g = *x * y.conj();
        let m = g.norm();
        *x = if f < basso || f > alto || m < 1e-20 { Complex32::new(0.0, 0.0) } else { g / m };
    }
    indietro.process(&mut a);

    // Ritardi validi: rif tutto dentro zona (niente correlazione circolare).
    let max_lag = zona.len() - rif.len();
    let r: Vec<f32> = a[..=max_lag].iter().map(|c| c.re).collect();
    let (picco, &valore) = r.iter().enumerate().max_by(|x, y| x.1.total_cmp(y.1))?;
    if valore <= 0.0 {
        return None;
    }

    // Interpolazione parabolica attorno al picco.
    let frazione = if picco > 0 && picco < max_lag {
        let (y0, y1, y2) = (r[picco - 1] as f64, r[picco] as f64, r[picco + 1] as f64);
        let d = y0 - 2.0 * y1 + y2;
        if d.abs() > 1e-12 { 0.5 * (y0 - y2) / d } else { 0.0 }
    } else {
        0.0
    };

    // Secondo picco, lontano almeno 5 ms dal primo.
    let esclusione = (SR_ANALISI / 200) as usize;
    let secondo = r
        .iter()
        .enumerate()
        .filter(|(i, _)| i.abs_diff(picco) > esclusione)
        .map(|(_, v)| *v)
        .fold(f32::MIN, f32::max)
        .max(1e-9);
    Some((picco as f64 + frazione, (valore / secondo) as f64))
}

// --- analisi -------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichiestaSync {
    /// Percorso di ffmpeg ("" = dal PATH); ffprobe si cerca nella stessa cartella.
    pub ffmpeg: String,
    pub video: String,
    /// Indice dello stream audio del video con la traccia guida (0 = il primo).
    pub flusso_guida: usize,
    /// WAV registrato da Reaper.
    pub audio: String,
    /// Stima di Takeline: istante del WAV che corrisponde all'inizio del video.
    pub inizio_stimato: f64,
    /// Quanto puo' sbagliare la stima, in secondi (piu' largo per i replay).
    #[serde(default = "margine_predefinito")]
    pub margine: f64,
}

fn margine_predefinito() -> f64 {
    2.0
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Misura {
    pub tempo_video: f64,
    pub tempo_audio: f64,
    pub confidenza: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoVideo {
    pub fps_nominale: f64,
    pub fps_medio: f64,
    pub fotogrammi: u64,
    pub attesi: u64,
    /// Frame rate costante verificato sul file.
    pub cfr: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RisultatoSync {
    /// Istante del WAV di Reaper che cade a t=0 del video.
    pub inizio_audio: f64,
    /// Secondi di audio per secondo di video (1 = clock identici).
    pub rapporto: f64,
    pub drift_ppm: f64,
    /// Quanto la misura corregge la stima fatta durante la registrazione.
    pub correzione_ms: f64,
    pub misure: Vec<Misura>,
    pub durata_video: f64,
    pub flussi_audio_video: usize,
    pub video: Option<InfoVideo>,
    pub avvisi: Vec<String>,
}

fn info_video(ffmpeg: &str, video: &str) -> Result<(f64, usize, Option<InfoVideo>), String> {
    let j = ffprobe_json(
        ffmpeg,
        &["-count_packets", "-show_entries", "stream=codec_type,r_frame_rate,avg_frame_rate,nb_read_packets:format=duration"],
        video,
    )?;
    let durata = num(&j["format"]["duration"]).ok_or("ffprobe: durata del video sconosciuta")?;
    let flussi = j["streams"].as_array().cloned().unwrap_or_default();
    let audio = flussi.iter().filter(|s| s["codec_type"] == "audio").count();
    let info = flussi.iter().find(|s| s["codec_type"] == "video").and_then(|v| {
        let nominale = frazione(&v["r_frame_rate"])?;
        let medio = frazione(&v["avg_frame_rate"]).unwrap_or(nominale);
        let fotogrammi = num(&v["nb_read_packets"]).unwrap_or(0.0) as u64;
        let attesi = (durata * nominale).round() as u64;
        // Tolleranza: mezzo per mille o 2 fotogrammi (arrotondamenti di inizio e fine).
        let scarto = fotogrammi.abs_diff(attesi) as f64;
        let cfr = (medio - nominale).abs() / nominale < 0.0005 && scarto <= (attesi as f64 * 0.0005).max(2.0);
        Some(InfoVideo { fps_nominale: nominale, fps_medio: medio, fotogrammi, attesi, cfr })
    });
    Ok((durata, audio, info))
}

fn durata_audio(ffmpeg: &str, audio: &str) -> Result<f64, String> {
    let j = ffprobe_json(ffmpeg, &["-show_entries", "format=duration"], audio)?;
    num(&j["format"]["duration"]).ok_or_else(|| format!("ffprobe: durata sconosciuta per {audio}"))
}

/// Cerca il tratto [tv, tv+finestra] del video nel WAV attorno a `centro` (+- margine).
fn misura(r: &RichiestaSync, tv: f64, finestra: f64, centro: f64, margine: f64, durata_wav: f64) -> Result<Misura, String> {
    let rif = estrai_pcm(&r.ffmpeg, &r.video, r.flusso_guida, tv, finestra)?;
    let inizio_zona = (centro - margine).max(0.0);
    let fine_zona = (centro + finestra + margine).min(durata_wav);
    if fine_zona - inizio_zona < finestra {
        return Err(format!(
            "il WAV di Reaper non copre il tratto {tv:.1}-{:.1} s del video: e' il file giusto?",
            tv + finestra
        ));
    }
    let zona = estrai_pcm(&r.ffmpeg, &r.audio, 0, inizio_zona, fine_zona - inizio_zona)?;
    if rif.iter().all(|x| x.abs() < 1e-4) {
        return Err(format!("la traccia guida e' muta nel tratto {tv:.1} s: controlla la sorgente in OBS"));
    }
    let (lag, confidenza) = gcc_phat(&rif, &zona).ok_or("correlazione non riuscita: tratto troppo corto o silenzioso")?;
    Ok(Misura { tempo_video: tv, tempo_audio: inizio_zona + lag / SR_ANALISI as f64, confidenza })
}

pub fn analizza(r: &RichiestaSync) -> Result<RisultatoSync, String> {
    let (durata, flussi_audio_video, video) = info_video(&r.ffmpeg, &r.video)?;
    if flussi_audio_video == 0 {
        return Err("Il video non ha tracce audio: in OBS serve almeno la traccia guida.".into());
    }
    if r.flusso_guida >= flussi_audio_video {
        return Err(format!(
            "Il video ha {flussi_audio_video} tracce audio: la traccia guida n. {} non c'e'.",
            r.flusso_guida + 1
        ));
    }
    if durata < 3.0 {
        return Err(format!("Take troppo corta per il sync ({durata:.1} s, ne servono almeno 3)."));
    }
    let durata_wav = durata_audio(&r.ffmpeg, &r.audio)?;
    let mut avvisi = Vec::new();

    let finestra = (durata * 0.25).clamp(2.0, 12.0);
    let tv0 = (durata * 0.05).min(0.5);
    // Prima misura larga (la stima fatta in registrazione e' entro qualche decimo).
    let m0 = misura(r, tv0, finestra, r.inizio_stimato + tv0, r.margine, durata_wav)?;
    let mut misure = vec![m0];
    let mut rapporto = 1.0;

    let tv1 = durata - finestra - 0.5;
    if tv1 - tv0 >= 20.0 {
        let a0 = misure[0].tempo_audio - tv0;
        // Sulla coda il drift sposta di pochi millisecondi: margine stretto.
        let m1 = misura(r, tv1, finestra, a0 + tv1, 0.3, durata_wav)?;
        rapporto = (m1.tempo_audio - misure[0].tempo_audio) / (tv1 - tv0);
        misure.push(m1);
    } else {
        avvisi.push(format!(
            "Take di {durata:.0} s: troppo corta per misurare il drift (servono circa 45 s), applico solo l'offset."
        ));
    }

    let ppm = (rapporto - 1.0) * 1e6;
    if ppm.abs() > DRIFT_MAX_PPM {
        avvisi.push(format!(
            "Drift misurato di {ppm:.0} ppm: troppo grande per essere reale, lo ignoro e applico solo l'offset."
        ));
        rapporto = 1.0;
        misure.truncate(1);
    }
    for m in &misure {
        if m.confidenza < 2.5 {
            avvisi.push(format!(
                "Misura a {:.1} s poco netta (confidenza {:.1}): la traccia guida assomiglia poco all'audio di Reaper.",
                m.tempo_video, m.confidenza
            ));
        }
    }
    if let Some(v) = &video {
        if !v.cfr {
            avvisi.push(format!(
                "Il video non e' a frame rate costante: {} fotogrammi invece di {} ({:.3} fps medi su {:.3}). Probabili fotogrammi persi in OBS.",
                v.fotogrammi, v.attesi, v.fps_medio, v.fps_nominale
            ));
        }
    }

    let inizio_audio = misure[0].tempo_audio - rapporto * misure[0].tempo_video;
    Ok(RisultatoSync {
        inizio_audio,
        rapporto,
        drift_ppm: (rapporto - 1.0) * 1e6,
        correzione_ms: (inizio_audio - r.inizio_stimato) * 1000.0,
        misure,
        durata_video: durata,
        flussi_audio_video,
        video,
        avvisi,
    })
}

#[tauri::command]
pub async fn sync_analizza(richiesta: RichiestaSync) -> Result<RisultatoSync, String> {
    tauri::async_runtime::spawn_blocking(move || analizza(&richiesta))
        .await
        .map_err(|e| e.to_string())?
}

// --- export allineato ----------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichiestaExport {
    pub ffmpeg: String,
    pub video: String,
    pub audio: String,
    pub inizio_audio: f64,
    pub rapporto: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsitoExport {
    pub video_sync: String,
    pub audio_sync: String,
}

/// Fattore di sovracampionamento: asetrate accetta solo frequenze intere, a
/// 48 kHz il passo sarebbe di 21 ppm; a 384 kHz scende sotto i 3 ppm.
const SOVRACCAMPIONAMENTO: f64 = 8.0;

/// Filtro che porta l'audio di Reaper sul clock del video.
pub fn filtro_rapporto(sr: f64, rapporto: f64) -> String {
    let alto = sr * SOVRACCAMPIONAMENTO;
    format!(
        "aresample={alto:.0},asetrate={:.0},aresample={sr:.0}",
        (alto * rapporto).round()
    )
}

fn accanto(video: &str, suffisso: &str, estensione: &str) -> String {
    let p = Path::new(video);
    let base = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "take".into());
    p.with_file_name(format!("{base}{suffisso}.{estensione}")).display().to_string()
}

pub fn esporta(r: &RichiestaExport) -> Result<EsitoExport, String> {
    let (durata, _, _) = info_video(&r.ffmpeg, &r.video)?;
    let j = ffprobe_json(&r.ffmpeg, &["-select_streams", "a:0", "-show_entries", "stream=sample_rate"], &r.audio)?;
    let sr = j["streams"][0]["sample_rate"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(48_000.0);

    // Se l'audio e' partito dopo il video, l'inizio va riempito di silenzio.
    let (inizio, ritardo_ms) = if r.inizio_audio >= 0.0 { (r.inizio_audio, 0.0) } else { (0.0, -r.inizio_audio * 1000.0) };
    let mut filtro = format!("[1:a]{}", filtro_rapporto(sr, r.rapporto));
    if ritardo_ms > 0.0 {
        filtro.push_str(&format!(",adelay={ritardo_ms:.3}:all=1"));
    }
    filtro.push_str(",asplit=2[av][aw]");

    let video_sync = accanto(&r.video, "_sync", "mp4");
    let audio_sync = accanto(&r.video, "_audio_sync", "wav");
    let mut cmd = ffmpeg_command(&r.ffmpeg);
    cmd.args(["-v", "error", "-nostdin", "-y", "-i"])
        .arg(&r.video)
        .args(["-ss", &format!("{inizio:.6}"), "-t", &format!("{:.6}", durata * r.rapporto + 1.0), "-i"])
        .arg(&r.audio)
        .args(["-filter_complex", &filtro])
        // MP4: video copiato senza ricodifica, audio di Reaper allineato.
        .args(["-map", "0:v:0", "-map", "[av]", "-c:v", "copy", "-c:a", "aac", "-b:a", "320k"])
        .args(["-t", &format!("{durata:.6}"), "-movflags", "+faststart"])
        .arg(&video_sync)
        // WAV a 24 bit per il montaggio, lungo esattamente quanto il video.
        .args(["-map", "[aw]", "-c:a", "pcm_s24le", "-t", &format!("{durata:.6}")])
        .arg(&audio_sync);
    esegui(cmd, "export sincronizzato")?;
    Ok(EsitoExport { video_sync, audio_sync })
}

#[tauri::command]
pub async fn sync_esporta(richiesta: RichiestaExport) -> Result<EsitoExport, String> {
    tauri::async_runtime::spawn_blocking(move || esporta(&richiesta))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rumore pseudocasuale filtrato: abbastanza simile alla musica per il test.
    fn segnale(n: usize, seme: u32) -> Vec<f32> {
        let mut x = seme;
        let mut prec = 0.0f32;
        (0..n)
            .map(|_| {
                x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let v = (x >> 8) as f32 / (1u32 << 24) as f32 - 0.5;
                prec = 0.7 * prec + v;
                prec
            })
            .collect()
    }

    #[test]
    fn trova_il_ritardo_esatto() {
        let zona = segnale(SR_ANALISI as usize * 6, 7);
        let ritardo = 23_457;
        let rif: Vec<f32> = zona[ritardo..ritardo + SR_ANALISI as usize * 2].iter().map(|x| x * 0.3).collect();
        let (lag, conf) = gcc_phat(&rif, &zona).unwrap();
        assert!((lag - ritardo as f64).abs() < 0.5, "lag {lag}");
        assert!(conf > 3.0, "confidenza {conf}");
    }

    #[test]
    fn filtro_con_passo_fine() {
        // 20 ppm a 48 kHz: 384000 * 1.00002 = 384007.68 -> 384008
        assert_eq!(filtro_rapporto(48_000.0, 1.00002), "aresample=384000,asetrate=384008,aresample=48000");
    }

    /// Prova completa su file veri (serve ffmpeg). Si lancia con
    /// TAKELINE_PROVA_SYNC=<cartella con video.mp4 e reaper.wav> cargo test -- --ignored
    #[test]
    #[ignore]
    fn analisi_ed_export_su_file() {
        let Ok(dir) = std::env::var("TAKELINE_PROVA_SYNC") else { return };
        let d = Path::new(&dir);
        let r = RichiestaSync {
            ffmpeg: String::new(),
            video: d.join("video.mp4").display().to_string(),
            flusso_guida: 0,
            audio: d.join("reaper.wav").display().to_string(),
            inizio_stimato: 7.1,
            margine: 2.0,
        };
        let s = analizza(&r).unwrap();
        println!("{s:#?}");
        assert!((s.inizio_audio - 7.25).abs() < 0.002, "inizio {}", s.inizio_audio);
        assert!((s.drift_ppm - 31.25).abs() < 2.0, "drift {} ppm", s.drift_ppm);
        let e = esporta(&RichiestaExport {
            ffmpeg: String::new(),
            video: r.video.clone(),
            audio: r.audio.clone(),
            inizio_audio: s.inizio_audio,
            rapporto: s.rapporto,
        })
        .unwrap();
        println!("{e:#?}");
        assert!(Path::new(&e.video_sync).exists() && Path::new(&e.audio_sync).exists());

        // Il WAV esportato, rimisurato contro il video, deve risultare allineato.
        let verifica = analizza(&RichiestaSync { audio: e.audio_sync.clone(), inizio_stimato: 0.0, ..r }).unwrap();
        println!("verifica: inizio {:.6} s, drift {:.2} ppm", verifica.inizio_audio, verifica.drift_ppm);
        assert!(verifica.inizio_audio.abs() < 0.002);
        assert!(verifica.drift_ppm.abs() < 3.0);
    }

    #[test]
    fn frazioni_ffprobe() {
        assert!((frazione(&Value::from("60000/1001")).unwrap() - 59.94).abs() < 0.01);
        assert_eq!(frazione(&Value::from("0/0")), None);
    }
}
