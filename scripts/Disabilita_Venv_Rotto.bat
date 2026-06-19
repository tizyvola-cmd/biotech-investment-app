@echo off

REM Rinomina .venv corrotto così Windows non tenta piu' di eseguirlo (dialogo blu).

cd /d "%~dp0.."

if not exist ".venv" (

  echo Nessuna cartella .venv presente.

  pause

  exit /b 0

)

set "_BAK=.venv_disabled_%date:~-4%%date:~3,2%%date:~0,2%"

set "_BAK=%_BAK: =_%"

if exist "%_BAK%" (

  echo Esiste gia %_BAK% — elimina manualmente o rinomina .venv a mano.

  pause

  exit /b 1

)

ren ".venv" "%_BAK%"

echo OK: .venv rinominato in %_BAK%

echo I batch useranno Python di sistema (py -3 / python).

echo Per ricreare il venv:  python -m venv .venv

pause

