@echo off
setlocal
title SuperNova Mobile (VPS)
rem App indipendente sul telefono: apri il sito sul VPS (nessun terminale locale).
set "URL=http://91.99.15.48:8765/mobile/"
echo.
echo  SuperNova Mobile - produzione VPS
echo  %URL%
echo.
echo  Sul telefono: stesso URL, poi Aggiungi a Home / Installa app.
echo  Il PC puo restare spento: serve solo il server VPS attivo.
echo.
start "" "%URL%"
