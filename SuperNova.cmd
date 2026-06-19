@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "scripts\Launch-SuperNova.bat" (
  mshta "javascript:var s=new ActiveXObject('WScript.Shell'); s.Popup('File mancante: scripts\\Launch-SuperNova.bat',0,'SuperNova',16);close()"
  exit /b 1
)

rem Collegamento Desktop consigliato: questo file (non VBS diretto).
call "%~dp0scripts\Launch-SuperNova.bat"
exit /b %ERRORLEVEL%
