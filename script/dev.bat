@echo off
rem ===================================================================
rem  Sviluppo: avvia Takeline dai sorgenti (tauri dev), senza build.
rem  - modifichi src\        -> la pagina si aggiorna da sola
rem  - modifichi src-tauri\  -> il backend si ricompila e riparte
rem  - tasto destro > Ispeziona apre i DevTools
rem  Usa i dati di prova in dev-dati\dev, non quelli veri.
rem  Per terminare chiudi la finestra dell'app (o Ctrl+C qui).
rem ===================================================================
setlocal
title Takeline - dev
call "%~dp0config.bat" || goto :errore

set "TAKELINE_DATI=%DATI_DEV%"
echo Avvio Takeline in modalita' sviluppo...
echo Dati di prova: %TAKELINE_DATI%
echo.
pushd "%REPO%"
call npm run tauri dev
set "ESITO=%ERRORLEVEL%"
popd
if not "%ESITO%"=="0" goto :errore
exit /b 0

:errore
echo.
echo Interrotto per un errore.
pause
exit /b 1
