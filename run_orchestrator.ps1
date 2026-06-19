# Avvio sicuro da PowerShell (anche con percorsi con spazi).
# Se lo script è bloccato:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# Uso: .\run_orchestrator.ps1      oppure: .\run_orchestrator.ps1 --eventuali-argomenti
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$python = Join-Path $root ".venv\Scripts\python.exe"
$script = Join-Path $root "data_orchestrator.py"

if (-not (Test-Path $python)) {
    Write-Error "Manca la venv: $python — creare con: python -m venv .venv e installare dipendenze"
}

& $python $script @args
