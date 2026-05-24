@echo off
REM Avvia API Python (8765) + Vite da desktop-ui.
REM Da questa cartella:  Avvia_UI.bat   oppure   .\Avvia_UI.bat
REM NON usare scripts\Avvia_... qui: la cartella scripts e' nella root del progetto.
call "%~dp0..\scripts\Avvia_Desktop_UI_Moderna.bat" %*
