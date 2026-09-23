@echo off
setlocal EnableExtensions
rem Main SuperNova — Electron locale (non apre il browser sul VPS).
cd /d "%~dp0.."
set "ROOT=%CD%"
set "ELECTRON_EXE=%ROOT%\electron\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON_EXE%" (
  echo Electron mancante — avvio setup completo...
  call "%~dp0Avvia_Biotech_Desktop.bat"
  exit /b %ERRORLEVEL%
)

if not exist "%ROOT%\desktop-ui\dist\index.html" (
  echo Manca dist — build Electron...
  pushd "%ROOT%\desktop-ui"
  call npm run build:electron
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)

findstr /C:"./assets/" "%ROOT%\desktop-ui\dist\index.html" >nul 2>&1
if errorlevel 1 (
  echo Dist WEB — ricompilo Electron...
  pushd "%ROOT%\desktop-ui"
  call npm run build:electron
  if errorlevel 1 (
    popd
    pause
    exit /b 1
  )
  popd
)

set "SUPERNOVA_APP_NAME=SuperNova"
cd /d "%ROOT%\electron"
start "SuperNova" /D "%ROOT%\electron" "%ELECTRON_EXE%" main-modern.cjs
exit /b 0
