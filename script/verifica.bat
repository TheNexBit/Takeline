@echo off
rem ===================================================================
rem  Verifica di fine milestone, senza build:
rem    1. npm run typecheck  (TypeScript)
rem    2. npm test           (transport con OBS e Reaper simulati, nomi dei file)
rem    3. cargo check        (Rust)
rem    4. cargo test         (test del backend)
rem    5. prova del sync     (solo se c'e' ffmpeg): crea un WAV "di Reaper"
rem       e un video "di OBS" con offset e drift noti, li misura, esporta
rem       l'audio allineato e controlla che risulti davvero allineato.
rem    6. prova della post-produzione (solo con ffmpeg): remux, tracce,
rem       loudness (rimisurato a -14 LUFS), export YouTube e proxy.
rem  Si ferma al primo controllo che fallisce.
rem ===================================================================
setlocal
title Takeline - verifica
call "%~dp0config.bat" || goto :errore

echo == 1/6 typecheck ==
pushd "%REPO%"
call npm run typecheck
if errorlevel 1 (
    popd
    goto :errore
)

echo.
echo == 2/6 test del frontend ==
call npm test
if errorlevel 1 (
    popd
    goto :errore
)
popd

echo.
echo == 3/6 cargo check ==
pushd "%REPO%\src-tauri"
cargo check
if errorlevel 1 (
    popd
    goto :errore
)

echo.
echo == 4/6 cargo test ==
cargo test --quiet
if errorlevel 1 (
    popd
    goto :errore
)
popd

echo.
echo == 5/6 prova del sync ==
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo ffmpeg non trovato: prova saltata.
    goto :fine
)
set "PROVA=%TEMP%\takeline-prova-sync"
if not exist "%PROVA%" mkdir "%PROVA%"
rem WAV di 70 s; traccia guida che parte a 7,25 s con un clock piu' veloce di 31,25 ppm
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=70:c=pink:r=48000:a=0.5" -af "tremolo=f=1.7:d=0.9,lowpass=7000" -c:a pcm_s24le "%PROVA%\reaper.wav" || goto :errore
ffmpeg -v error -y -ss 7.25 -i "%PROVA%\reaper.wav" -f lavfi -i "anoisesrc=d=70:c=white:r=48000:a=0.03" -filter_complex "[0:a]aresample=384000,asetrate=384012,aresample=48000,highpass=150,lowpass=3500,volume=0.6[g];[g][1:a]amix=inputs=2:duration=first[a]" -map "[a]" -t 62 "%PROVA%\guida.wav" || goto :errore
ffmpeg -v error -y -f lavfi -i "testsrc=size=640x360:rate=30" -i "%PROVA%\guida.wav" -t 60 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k "%PROVA%\video.mp4" || goto :errore
set "TAKELINE_PROVA_SYNC=%PROVA%"
pushd "%REPO%\src-tauri"
cargo test --quiet analisi_ed_export_su_file -- --ignored --nocapture
if errorlevel 1 (
    popd
    goto :errore
)
popd

echo.
echo == 6/6 prova della post-produzione ==
set "PROVA_POST=%TEMP%\takeline-prova-post"
if exist "%PROVA_POST%" rmdir /s /q "%PROVA_POST%"
mkdir "%PROVA_POST%"
set "TAKELINE_PROVA_POST=%PROVA_POST%"
pushd "%REPO%\src-tauri"
cargo test --quiet lavori_su_file_veri -- --ignored --nocapture
if errorlevel 1 (
    popd
    goto :errore
)
popd

:fine
echo.
echo Tutto a posto.
if not "%TAKELINE_NO_PAUSA%"=="1" pause
exit /b 0

:errore
echo.
echo Verifica NON superata: leggi i messaggi sopra.
if not "%TAKELINE_NO_PAUSA%"=="1" pause
exit /b 1
