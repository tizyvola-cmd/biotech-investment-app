@echo off
setlocal
title Term 1 = Biotech (API 8765)
cd /d "%~dp0.."
echo.
echo  ========================================
echo   Term 1 = Biotech
echo   API SuperNova - porta 8765
echo   Scheduler: da .env (hourly 15:30-22:00 se HOURLY=1)
echo  ========================================
echo.
echo  Lascia QUESTA finestra aperta.
echo  Per web host + scheduler VPS: scripts\Avvia_Desktop_Web.ps1
echo.
set SUPERNOVA_BIND_ALL=1
set SUPERNOVA_CORS_PERMISSIVE=1
if exist ".venv\Scripts\python.exe" (
  .venv\Scripts\python.exe -m supernova_api
) else (
  echo ERRORE: .venv non trovato.
  pause
)
