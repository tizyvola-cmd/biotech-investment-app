# Avvio SuperNova da collegamento Desktop (finestra CMD minimizzata, log + popup errori).
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$bat = Join-Path $root "scripts\Avvia_Biotech_Desktop.bat"
$errorPs1 = Join-Path $root "scripts\Show-SuperNovaLaunchError.ps1"
$logDir = Join-Path $env:LOCALAPPDATA "SuperNova"
$log = Join-Path $logDir "launch.log"

if (-not (Test-Path $bat)) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [void][System.Windows.Forms.MessageBox]::Show(
        "File non trovato:`n$bat",
        "SuperNova",
        "OK",
        "Error"
    )
    exit 1
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Add-Content -LiteralPath $log -Value "=== SuperNova launch $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

$inner = @"
@echo off
setlocal EnableExtensions
set SUPERNOVA_SILENT=1
cd /d "$root"
call "$bat" >> "$log" 2>&1
set ERR=%ERRORLEVEL%
echo === Exit code %ERR% ===>> "$log"
if not "%ERR%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "$errorPs1" -ExitCode %ERR% -LogPath "$log"
  exit /b %ERR%
)
"@

$runner = Join-Path $logDir "SuperNova-run.cmd"
Set-Content -LiteralPath $runner -Value $inner -Encoding ASCII

Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$runner`"" -WindowStyle Minimized -WorkingDirectory $root
