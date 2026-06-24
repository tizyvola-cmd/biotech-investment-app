@echo off
setlocal
title SuperNova v3 Host (API + PWA)
cd /d "%~dp0.."
echo.
echo  ========================================
echo   SuperNova v3 — un solo servizio
echo   HTTPS consigliato in produzione
echo  ========================================
echo.
if not exist "mobile-ui\dist\index.html" (
  echo Build PWA...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_mobile_v3.ps1"
)
set SUPERNOVA_BIND_ALL=1
set SUPERNOVA_SERVE_MOBILE=1
if "%SUPERNOVA_API_TOKEN%"=="" (
  echo ATTENZIONE: imposta SUPERNOVA_API_TOKEN per produzione.
  echo   set SUPERNOVA_API_TOKEN=la-tua-chiave-segreta
)
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe -m supernova_api
) else (
  echo ERRORE: .venv non trovato.
  pause
)
