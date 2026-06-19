@echo off

REM Profilo DOMENICA: orchestrator completo + foglio SEC K-8 (30-90+ min). Excel chiuso.

cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Biotech_Refresh_Profiles.ps1" -Profile WeeklyFull

if errorlevel 1 pause

exit /b %ERRORLEVEL%

