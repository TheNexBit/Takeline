@echo off
rem ===================================================================
rem  Percorsi e controlli comuni agli script di Takeline.
rem  Se cambia qualcosa sul PC (Node, Rust, cartelle) modificalo qui.
rem  Se mancano le dipendenze npm le installa da solo.
rem ===================================================================

rem Cartella del repository (quella sopra a "script")
for %%I in ("%~dp0..") do set "REPO=%%~fI"
set "BIN=%REPO%\node_modules\.bin"

rem Dati di prova: gli script non usano mai quelli veri
rem (%APPDATA%\com.thenexbit.takeline). Takeline li legge da TAKELINE_DATI.
set "DATI_DEV=%REPO%\dev-dati\dev"

rem Installer prodotto da build.bat
set "BUNDLE=%REPO%\src-tauri\target\release\bundle\nsis"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato. Installalo con: winget install OpenJS.NodeJS.LTS
    exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Rust non trovato. Installalo con: winget install Rustlang.Rustup
    echo          poi riapri il terminale.
    exit /b 1
)

if exist "%BIN%\tauri.cmd" if exist "%BIN%\vite.cmd" exit /b 0
echo Dipendenze mancanti: eseguo npm install...
pushd "%REPO%"
call npm install --no-audit --no-fund
if errorlevel 1 (
    popd
    echo [ERRORE] npm install fallito: leggi i messaggi sopra.
    exit /b 1
)
popd
exit /b 0
