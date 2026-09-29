@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "URL=http://91.99.15.48:8765/"
set "PROFILE=SuperNova-Andrea"
if exist "%~dp0config-andrea.txt" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%~dp0config-andrea.txt") do (
    if /i "%%A"=="URL" if not "%%B"=="" set "URL=%%B"
    if /i "%%A"=="PROFILE" if not "%%B"=="" set "PROFILE=%%B"
  )
)

for /f "tokens=* delims= " %%U in ("%URL%") do set "URL=%%U"
for /f "tokens=* delims= " %%P in ("%PROFILE%") do set "PROFILE=%%P"

set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if defined EDGE (
  start "" "%EDGE%" --profile-directory="%PROFILE%" --new-window "%URL%"
  exit /b 0
)
if defined CHROME (
  start "" "%CHROME%" --profile-directory="%PROFILE%" --new-window "%URL%"
  exit /b 0
)

rem Fallback: default browser (accounts may collide with the main shortcut)
start "" "%URL%"
exit /b 0
