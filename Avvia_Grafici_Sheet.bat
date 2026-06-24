@echo off
REM Launcher nella root: delega a scripts\Avvia_Grafici_Sheet.bat
REM NON usare python su questo file.
cd /d "%~dp0"
call "%~dp0scripts\Avvia_Grafici_Sheet.bat" %*
