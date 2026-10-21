@echo off
rem ===================================================================
rem  Prima installazione: controlla gli strumenti, installa le
rem  dipendenze npm e scarica i crate Rust. Va lanciato una volta sola
rem  (o dopo aver aggiornato package.json / Cargo.toml).
rem  Poi si usa dev.bat.
rem ===================================================================
setlocal
title Takeline - setup
call "%~dp0config.bat" || goto :errore

echo.
echo == Strumenti ==
for /f "delims=" %%V in ('node -v') do echo Node.js   %%V
for /f "tokens=2" %%V in ('cargo -V') do echo Rust      %%V

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo ffmpeg    NON TROVATO - serve per la post-produzione:
    echo           winget install Gyan.FFmpeg
) else (
    echo ffmpeg    presente
)

reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" >nul 2>&1
if errorlevel 1 reg query "HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" >nul 2>&1
if errorlevel 1 (
    echo WebView2  NON TROVATO: winget install Microsoft.EdgeWebView2Runtime
) else (
    echo WebView2  presente
)

echo.
echo == Dipendenze npm ==
pushd "%REPO%"
call npm install --no-audit --no-fund
if errorlevel 1 (
    popd
    goto :errore
)
popd

echo.
echo == Crate Rust ==
pushd "%REPO%\src-tauri"
cargo fetch
if errorlevel 1 (
    popd
    echo Se l'errore parla di link.exe servono i Build Tools di Visual Studio:
    echo   winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
    goto :errore
)
popd

echo.
echo Fatto. Ora avvia script\dev.bat
echo La prima compilazione Rust richiede qualche minuto.
if not "%TAKELINE_NO_PAUSA%"=="1" pause
exit /b 0

:errore
echo.
echo Interrotto per un errore.
pause
exit /b 1
