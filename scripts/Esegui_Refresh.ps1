# Refresh Simulation + Accuracy + Predizione guida + Grafici (Python di sistema).
# Uso:  cd "C:\coding\Biotech_Investment app 6"
#       powershell -ExecutionPolicy Bypass -File scripts\Esegui_Refresh.ps1
# Chiudere Excel sul workbook prima di eseguire.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$py = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    $py = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1).Trim()
}
if (-not $py -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $py = (& python -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1).Trim()
}
if (-not $py -or -not (Test-Path -LiteralPath $py)) {
    Write-Error "Nessun Python trovato. Usa: python launch_refresh_sim_accuracy_grafici.py"
}

Write-Host "[Refresh] Python: $py"
$env:PYTHONUNBUFFERED = "1"
& $py -u launch_refresh_sim_accuracy_grafici.py @args
exit $LASTEXITCODE
