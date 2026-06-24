@echo off
setlocal
rem Avvio orchestrator da cartella dello script (percorsi con spazio OK).
cd /d "%~dp0"
"%~dp0.venv\Scripts\python.exe" -u "%~dp0data_orchestrator.py" %*
exit /b %ERRORLEVEL%
