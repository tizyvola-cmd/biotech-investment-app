@echo off

REM Launcher rapido nella root: solo layout Grafici + cache locale (no Yahoo, no --refresh)

cd /d "%~dp0"

call "%~dp0scripts\Avvia_Grafici_Sheet_Rapido.bat" %*

