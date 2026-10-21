//! Servizi di sistema: spazio disco, cartelle, ffmpeg, finestra attiva.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpace {
    /// Percorso esistente su cui e' stata fatta la misura.
    pub misurato_su: String,
    pub libero: u64,
    pub totale: u64,
}

/// Risale fino al primo antenato esistente: la cartella di output
/// potrebbe non essere ancora stata creata.
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut p = Some(path);
    while let Some(cur) = p {
        if cur.exists() {
            return Some(cur.to_path_buf());
        }
        p = cur.parent();
    }
    None
}

#[cfg(windows)]
fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn free_space(path: &Path) -> Result<(u64, u64), String> {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let w = wide(path.as_os_str());
    let (mut free, mut total, mut _all_free) = (0u64, 0u64, 0u64);
    // SAFETY: buffer terminato da zero e puntatori a variabili locali valide.
    let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut free, &mut total, &mut _all_free) };
    if ok == 0 {
        return Err(format!("{}: {}", path.display(), std::io::Error::last_os_error()));
    }
    Ok((free, total))
}

#[cfg(not(windows))]
fn free_space(_path: &Path) -> Result<(u64, u64), String> {
    Err("Misura dello spazio disco disponibile solo su Windows".into())
}

#[tauri::command]
pub fn disk_space(percorso: String) -> Result<DiskSpace, String> {
    let p = existing_ancestor(Path::new(&percorso))
        .ok_or_else(|| format!("Nessuna unita' trovata per {percorso}"))?;
    let (libero, totale) = free_space(&p)?;
    Ok(DiskSpace { misurato_su: p.display().to_string(), libero, totale })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirCheck {
    pub creata: bool,
    pub scrivibile: bool,
    pub errore: Option<String>,
}

/// Crea la cartella se manca e verifica che si possa scrivere.
#[tauri::command]
pub fn ensure_dir(percorso: String) -> DirCheck {
    let p = PathBuf::from(&percorso);
    let creata = !p.exists();
    if let Err(e) = fs::create_dir_all(&p) {
        return DirCheck { creata: false, scrivibile: false, errore: Some(format!("{percorso}: {e}")) };
    }
    let probe = p.join(".takeline-prova-scrittura");
    let res = fs::write(&probe, b"ok").and_then(|_| fs::remove_file(&probe));
    DirCheck { creata, scrivibile: res.is_ok(), errore: res.err().map(|e| format!("{percorso}: {e}")) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub trovato: bool,
    /// ffprobe nella stessa cartella: senza, sync, capitoli e post non partono.
    pub ffprobe: bool,
    pub comando: String,
    pub versione: Option<String>,
    pub errore: Option<String>,
}

pub fn ffmpeg_command(percorso: &str) -> Command {
    let exe = if percorso.trim().is_empty() { "ffmpeg" } else { percorso.trim() };
    #[allow(unused_mut)]
    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// ffprobe si cerca accanto a ffmpeg: le build complete lo portano con se',
/// quelle incluse in altri programmi (ShareX, CapCut) spesso no.
pub fn ffprobe_path(ffmpeg: &str) -> PathBuf {
    let p = ffmpeg.trim();
    if p.is_empty() {
        return PathBuf::from("ffprobe");
    }
    let f = Path::new(p);
    f.with_file_name(if f.extension().is_some() { "ffprobe.exe" } else { "ffprobe" })
}

/// ffmpeg resta esterno: qui si verifica solo che ci sia.
#[tauri::command]
pub async fn ffmpeg_info(percorso: String) -> FfmpegInfo {
    let comando = if percorso.trim().is_empty() { "ffmpeg (dal PATH)".to_string() } else { percorso.clone() };
    let accanto = ffprobe_path(&percorso).to_string_lossy().into_owned();
    let out = tauri::async_runtime::spawn_blocking(move || ffmpeg_command(&percorso).arg("-version").output())
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r.map_err(|e| e.to_string()));
    let ffprobe = tauri::async_runtime::spawn_blocking(move || ffmpeg_command(&accanto).arg("-version").output())
        .await
        .is_ok_and(|r| r.is_ok_and(|o| o.status.success()));
    match out {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout);
            let first = text.lines().next().unwrap_or_default();
            let versione = first
                .strip_prefix("ffmpeg version ")
                .and_then(|r| r.split_whitespace().next())
                .map(str::to_string);
            FfmpegInfo { trovato: true, ffprobe, comando, versione, errore: None }
        }
        Ok(o) => FfmpegInfo {
            trovato: false,
            ffprobe,
            comando,
            versione: None,
            errore: Some(format!("ffmpeg e' uscito con codice {:?}", o.status.code())),
        },
        Err(e) => FfmpegInfo {
            trovato: false,
            ffprobe,
            comando,
            versione: None,
            errore: Some(format!("ffmpeg non trovato: {e}")),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindow {
    pub titolo: String,
    /// Eseguibile del processo in primo piano (es. reaper.exe).
    pub processo: String,
}

/// Finestra in primo piano: base per la futura regia automatica.
#[cfg(windows)]
#[tauri::command]
pub fn active_window() -> Option<ActiveWindow> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    // SAFETY: chiamate Win32 con buffer locali dimensionati e handle chiuso.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let titolo = String::from_utf16_lossy(&buf[..n.max(0) as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut processo = String::new();
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !h.is_null() {
            let mut path = [0u16; 1024];
            let mut len = path.len() as u32;
            if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut len) != 0 {
                let full = String::from_utf16_lossy(&path[..len as usize]);
                processo = full.rsplit('\\').next().unwrap_or_default().to_string();
            }
            CloseHandle(h);
        }
        Some(ActiveWindow { titolo, processo })
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn active_window() -> Option<ActiveWindow> {
    None
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecente {
    pub percorso: String,
    pub modificato_ms: i64,
    pub byte: u64,
}

/// Video modificati dopo `dopo_ms` in una cartella, dal piu' vecchio: serve a
/// ritrovare il file di un take rimasto aperto (app chiusa a meta' registrazione).
#[tauri::command]
pub fn file_recenti(cartella: String, dopo_ms: i64) -> Result<Vec<FileRecente>, String> {
    let mut out = Vec::new();
    for voce in fs::read_dir(&cartella).map_err(|e| format!("{cartella}: {e}"))?.flatten() {
        let p = voce.path();
        let video = p
            .extension()
            .map(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "mp4" | "mkv" | "mov" | "flv" | "ts"))
            .unwrap_or(false);
        let Ok(meta) = voce.metadata() else { continue };
        let modificato_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as i64);
        if video && meta.is_file() && modificato_ms >= dopo_ms {
            out.push(FileRecente { percorso: p.display().to_string(), modificato_ms, byte: meta.len() });
        }
    }
    out.sort_by_key(|f| f.modificato_ms);
    Ok(out)
}
