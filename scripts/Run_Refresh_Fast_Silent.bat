@echo off
REM Per macro Excel: nessun pause, exit code = esito refresh.

cd /d "%~dp0.."

call "%~dp0_grafici_pick_python.bat"
if errorlevel 1 exit /b 2

set PYTHONUNBUFFERED=1
call "%~dp0Run_Refresh_Profile_Silent.bat" daily %*
exit /b %ERRORLEVEL%
