@echo off

REM Solo foglio «SEC K-8» (senza orchestrator completo). Utile a metà settimana.

cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Biotech_Refresh_Profiles.ps1" -Profile SecK8Only

if errorlevel 1 pause

exit /b %ERRORLEVEL%

