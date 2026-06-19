@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

set "LOG_DIR=%LOCALAPPDATA%\SuperNova"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

set "LOG=%LOG_DIR%\launch_%RANDOM%.log"
echo %LOG%> "%LOG_DIR%\launch-latest.txt"

echo === SuperNova launch %DATE% %TIME% === >> "%LOG%"
echo Progetto: %CD% >> "%LOG%"

if exist "%ProgramFiles%\nodejs\" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

if not exist ".venv\Scripts\python.exe" (
  echo ERRORE: .venv mancante >> "%LOG%"
  call "%~dp0ShowLaunchError.cmd" 10
  exit /b 10
)

where npx >nul 2>&1
if errorlevel 1 (
  echo ERRORE: npx non trovato nel PATH >> "%LOG%"
  call "%~dp0ShowLaunchError.cmd" 11
  exit /b 11
)

echo [preflight] Pulizia Electron / porta 8765... >> "%LOG%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preflight-desktop-launch.ps1" >> "%LOG%" 2>&1

set "SUPERNOVA_SILENT=1"
set "SUPERNOVA_FAST=1"
set "SUPERNOVA_SKIP_ELECTRON=1"

if not exist "desktop-ui\dist\index.html" (
  echo FAST off: dist assente >> "%LOG%"
  set "SUPERNOVA_FAST=0"
) else (
  findstr /C:"./assets/" "desktop-ui\dist\index.html" >nul 2>&1
  if errorlevel 1 (
    echo FAST off: dist non valida per Electron - build web >> "%LOG%"
    set "SUPERNOVA_FAST=0"
  )
)
if not exist "electron\node_modules\electron" (
  echo FAST off: electron npm mancante >> "%LOG%"
  set "SUPERNOVA_FAST=0"
)

echo FAST=%SUPERNOVA_FAST% SKIP_ELECTRON=1 >> "%LOG%"

call "%~dp0Avvia_Biotech_Desktop.bat" >> "%LOG%" 2>&1
set "ERR=%ERRORLEVEL%"
echo === Bootstrap exit %ERR% === >> "%LOG%"

if not "%ERR%"=="0" (
  call "%~dp0ShowLaunchError.cmd" %ERR%
  exit /b %ERR%
)

echo [4/4] Avvio Electron... >> "%LOG%"
start "SuperNova" /D "%CD%" cmd /c "%~dp0Start-Electron-Desktop.bat"
echo === Electron avviato === >> "%LOG%"
exit /b 0
