@echo off
rem ===================================================================
rem  Build ufficiale: compila in release e crea l'installer NSIS.
rem  Lenta (diversi minuti): usala solo quando serve un installer.
rem  Per provare le modifiche basta dev.bat.
rem  Risultato in src-tauri\target\release\bundle\nsis
rem ===================================================================
setlocal
title Takeline - build
call "%~dp0config.bat" || goto :errore

pushd "%REPO%"
call npm run tauri build
set "ESITO=%ERRORLEVEL%"
popd
if not "%ESITO%"=="0" goto :errore

echo.
echo Installer pronto in:
echo   %BUNDLE%
if exist "%BUNDLE%" explorer "%BUNDLE%"
if not "%TAKELINE_NO_PAUSA%"=="1" pause
exit /b 0

:errore
echo.
echo Interrotto per un errore.
pause
exit /b 1
