@echo off

REM Profilo FERIALE: Simulation + Accuracy + curve/8-K live (~minuti). Excel chiuso.

cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Biotech_Refresh_Profiles.ps1" -Profile Daily

if errorlevel 1 pause

exit /b %ERRORLEVEL%

