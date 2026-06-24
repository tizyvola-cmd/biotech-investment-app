@echo off
REM Wrapper per eseguire MANUALMENTE il daily market refresh.
REM Identico al task scheduler, ma utile per test o run on-demand.
REM
REM Uso:
REM   scripts\Run_Daily_Market_Refresh.bat
REM   scripts\Run_Daily_Market_Refresh.bat --force            (esegui anche weekend)
REM   scripts\Run_Daily_Market_Refresh.bat --dry-run          (mostra solo cosa farebbe)
REM   scripts\Run_Daily_Market_Refresh.bat --skip-dircalib    (no KPI direzionali)

setlocal
cd /d "%~dp0.."

if exist .venv\Scripts\python.exe (
    set "PY=.venv\Scripts\python.exe"
) else (
    set "PY=py -3"
)

set "PYTHONUNBUFFERED=1"
set "PYTHONIOENCODING=utf-8"

%PY% -u scripts\daily_market_refresh.py %*

set "RC=%ERRORLEVEL%"
echo.
echo Exit code: %RC%
echo Logs: data\logs\daily_refresh_*.log
echo.
if "%~1"=="" pause
exit /b %RC%
