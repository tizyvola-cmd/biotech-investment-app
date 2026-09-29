@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "URL=http://91.99.15.48:8765/"
if exist "%~dp0config.txt" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0config.txt") do (
    if /i "%%A"=="URL" if not "%%B"=="" set "URL=%%B"
  )
)

rem Trim spaces
for /f "tokens=* delims= " %%U in ("%URL%") do set "URL=%%U"

start "" "%URL%"
exit /b 0
