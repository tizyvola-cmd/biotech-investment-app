@echo off
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\Load-V5Profile.ps1" -Profile production -RunAccuracyRefresh %*
pause
