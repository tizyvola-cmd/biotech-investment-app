@echo off
setlocal EnableExtensions
rem Second SuperNova window for Andrea — Electron locale, profilo separato.
cd /d "%~dp0.."
set "ROOT=%CD%"
set "LOGDIR=%LOCALAPPDATA%\SuperNova-Andrea"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set "LOG=%LOGDIR%\launch.log"

echo === SuperNova Andrea %DATE% %TIME% ===> "%LOG%"
echo ROOT=%ROOT%>> "%LOG%"

set "ELECTRON_EXE=%ROOT%\electron\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON_EXE%" (
  echo ERRORE: manca Electron. Avvia prima scripts\Avvia_Biotech_Desktop.bat>> "%LOG%"
  echo ERRORE: manca Electron. Avvia prima scripts\Avvia_Biotech_Desktop.bat
  pause
  exit /b 1
)

if not exist "%ROOT%\desktop-ui\dist\index.html" (
  echo ERRORE: manca desktop-ui\dist>> "%LOG%"
  echo ERRORE: manca desktop-ui\dist - ricompila con npm run build:electron
  pause
  exit /b 1
)

findstr /C:"./assets/" "%ROOT%\desktop-ui\dist\index.html" >nul 2>&1
if errorlevel 1 (
  echo Dist WEB rilevato - ricompilo Electron...>> "%LOG%"
  echo Dist in formato WEB - ricompilo per Electron...
  pushd "%ROOT%\desktop-ui"
  call npm run build:electron >> "%LOG%" 2>&1
  if errorlevel 1 (
    popd
    echo Build electron fallita. Vedi %LOG%
    pause
    exit /b 1
  )
  popd
)

set "SUPERNOVA_APP_NAME=SuperNova-Andrea"
set "SUPERNOVA_APP_ICON=%ROOT%\assets\SuperNova_Andrea_Desktop.ico"
if not exist "%SUPERNOVA_APP_ICON%" set "SUPERNOVA_APP_ICON=%ROOT%\client-remote\SuperNova-Andrea.ico"

echo ELECTRON=%ELECTRON_EXE%>> "%LOG%"
echo APP_NAME=%SUPERNOVA_APP_NAME%>> "%LOG%"
echo Avvio Electron Andrea...>> "%LOG%"

cd /d "%ROOT%\electron"
start "SuperNova Andrea" /D "%ROOT%\electron" "%ELECTRON_EXE%" main-modern.cjs

echo.
echo ========================================
echo  SuperNova Andrea = app Electron LOCALE
echo  (non e il browser sul server VPS)
echo  Login: andrea.vicario1979@gmail.com
echo ========================================
echo.
exit /b 0
