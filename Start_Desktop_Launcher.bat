@echo off
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0SuperNova.cmd"
exit /b %ERRORLEVEL%
