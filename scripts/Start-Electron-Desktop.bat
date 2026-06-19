@echo off
setlocal EnableExtensions
cd /d "%~dp0..\electron"
if not exist "%LOCALAPPDATA%\SuperNova" mkdir "%LOCALAPPDATA%\SuperNova" >nul 2>&1
set "LOG=%LOCALAPPDATA%\SuperNova\electron.log"
echo === Electron %DATE% %TIME% === >> "%LOG%"
npx electron main-modern.cjs >> "%LOG%" 2>&1
