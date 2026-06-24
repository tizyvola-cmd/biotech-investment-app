@echo off
title Ripara avvio SuperNova Desktop
cd /d "%~dp0.."
echo.
echo ========================================
echo  Ripara avvio SuperNova Desktop
echo ========================================
echo.
echo Chiudo Electron zombie e libero porta 8765 se bloccata...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preflight-desktop-launch.ps1"
echo.
echo Log: %LOCALAPPDATA%\SuperNova\preflight-latest.txt
echo.
echo Ora prova doppio clic su SuperNova sul Desktop.
echo.
pause
