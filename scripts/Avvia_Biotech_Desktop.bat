@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
if /I not "%SUPERNOVA_SILENT%"=="1" (
  title SuperNova — Desktop
  echo ========================================
  echo  SuperNova — Desktop (Electron)
  echo ========================================
  echo Progetto: %CD%
  echo.
)
if /I "%FORCE_UI_BUILD%"=="1" (
  echo [2/4] FORCE_UI_BUILD=1 — ricompilo UI...
  goto do_ui_build
)

if not exist ".venv\Scripts\python.exe" (
  echo ERRORE: crea il venv e installa le dipendenze API:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -r requirements-electron.txt
  call :sn_fail 1
)

if /I "%SUPERNOVA_FAST%"=="1" (
  if exist "desktop-ui\dist\index.html" (
    findstr /C:"./assets/" "desktop-ui\dist\index.html" >nul 2>&1
    if not errorlevel 1 goto fast_ui_ready
    echo [fast] dist e build web - serve build:electron...
  )
)
goto after_fast_check
:fast_ui_ready
echo [fast] UI dist electron OK - salto pip e rebuild
goto ui_ready
:after_fast_check

echo [1/4] Dipendenze API Python...
".venv\Scripts\python.exe" -m pip install -q -r requirements-electron.txt
if errorlevel 1 (
  echo pip install fallito.
  call :sn_fail 1
)

echo [2/4] Verifica build UI Electron...
if not exist "desktop-ui\dist\index.html" (
  echo   dist assente — prima build...
  goto do_ui_build
)

set "UI_STATE="
for /f "delims=" %%T in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-desktop-ui-stale.ps1"') do set "UI_STATE=%%T"
if /I not "%UI_STATE%"=="FRESH" (
  if "%UI_STATE%"=="" (
    echo   Controllo stale non disponibile — ricompilo per sicurezza...
  ) else (
    echo   Stato UI: %UI_STATE% — ricompilo...
  )
  goto do_ui_build
)
echo   desktop-ui\dist aggiornata ^(./assets/, sorgenti non piu' recenti^)
goto ui_ready

:do_ui_build
echo [2/4] Build UI ^(npm run build:electron^)...
cd desktop-ui
if not exist "node_modules" (
  echo   npm install...
  call npm install
  if errorlevel 1 (
    cd ..
    echo npm install fallito.
    call :sn_fail 1
  )
)
call npm run build:electron
set "BUILD_ERR=%ERRORLEVEL%"
cd ..
if not "%BUILD_ERR%"=="0" (
  echo Build desktop-ui fallita.
  call :sn_fail 1
)
findstr /C:"./assets/" "desktop-ui\dist\index.html" >nul 2>&1
if errorlevel 1 (
  echo ERRORE: dist non valida per Electron ^(manca ./assets/ in index.html^).
  echo Non usare "npm run build" — solo "npm run build:electron".
  call :sn_fail 1
)
echo   Build OK.

:ui_ready
echo [3/4] Electron...
cd electron
if not exist "node_modules\electron" (
  call npm install
  if errorlevel 1 (
    cd ..
    call :sn_fail 1
  )
)

if /I "%SUPERNOVA_SKIP_ELECTRON%"=="1" (
  cd ..
  exit /b 0
)

echo [4/4] Avvio app desktop...
echo   Per forzare rebuild UI: set FORCE_UI_BUILD=1 ^&^& scripts\Avvia_Biotech_Desktop.bat
echo.
if /I "%SUPERNOVA_SILENT%"=="1" (
  start "SuperNova" /D "%CD%" cmd /c "npx electron main-modern.cjs"
  cd ..
  exit /b 0
)
call npx electron main-modern.cjs
set ERR=%ERRORLEVEL%
cd ..
if not "%ERR%"=="0" call :sn_fail %ERR%
exit /b 0

:sn_fail
set "SN_CODE=%~1"
if "%SN_CODE%"=="" set "SN_CODE=1"
if /I "%SUPERNOVA_SILENT%"=="1" exit /b %SN_CODE%
pause
exit /b %SN_CODE%
