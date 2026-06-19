@echo off

setlocal EnableExtensions

set "CODE=%~1"

if "%CODE%"=="" set "CODE=1"

set "LOG=%LOCALAPPDATA%\SuperNova\launch-latest.txt"

if exist "%LOG%" (set /p LOG=<"%LOG%")

if not exist "%LOG%" set "LOG=%LOCALAPPDATA%\SuperNova\launch.log"

set "ELOG=%LOCALAPPDATA%\SuperNova\electron.log"

mshta "javascript:var s=new ActiveXObject('WScript.Shell'); s.Popup('Avvio SuperNova fallito (codice %CODE%).\n\nLog:\n%LOG%\n\nElectron:\n%ELOG%',0,'SuperNova',16);close()"

