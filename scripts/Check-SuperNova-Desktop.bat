@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title SuperNova — Check avvio

echo ========================================
echo  SuperNova — check ambiente desktop
echo ========================================
echo Progetto: %CD%
echo.

set "OK=1"

if exist ".venv\Scripts\python.exe" (
  echo [OK] Python venv
) else (
  echo [!!] Manca .venv — python -m venv .venv
  set "OK=0"
)

if exist "desktop-ui\dist\index.html" (
  echo [OK] desktop-ui\dist
) else (
  echo [!!] Manca build UI — scripts\Avvia_Biotech_Desktop.bat con FORCE_UI_BUILD=1
  set "OK=0"
)

if exist "electron\node_modules\electron" (
  echo [OK] Electron npm
) else (
  echo [!!] Manca electron — cd electron ^&^& npm install
  set "OK=0"
)

if exist "assets\SuperNova_Desktop.ico" (
  echo [OK] Icona desktop
) else (
  echo [--] Icona opzionale mancante
)

echo.
echo Log ultimo avvio:
set "LOG=%LOCALAPPDATA%\SuperNova\launch.log"
if exist "%LOG%" (
  powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 8"
) else (
  echo   (nessun log ancora)
)

echo.
if "%OK%"=="1" (
  echo Check OK — avvio rapido disponibile.
  echo.
  choice /C SN /M "Avviare SuperNova ora [S]i/[N]o"
  if errorlevel 2 goto end
  if errorlevel 1 call "%~dp0Launch-SuperNova.bat"
) else (
  echo Correggi gli elementi [!!] poi riesegui questo check.
)

:end
echo.
pause
