# =============================================================================
# Setup_Weekly_Accuracy_Snapshot.ps1
# Registra (o aggiorna) un task Windows che esegue ogni domenica alle 09:00
# lo snapshot del monitor «Accuratezza nel tempo».
#
# Esegui come utente normale (NON richiede Amministratore).
# Riesegui per aggiornare il task se cambia la cartella del progetto.
#
# Uso:
#   cd "C:\coding\Biotech_Investment app 6"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Accuracy_Snapshot.ps1
# =============================================================================

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python      = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Script      = Join-Path $ProjectRoot "scripts\accuracy_monitor_snapshot.py"
$TaskName    = "SuperNova - Accuracy Monitor Domenica"
$RunAt       = "09:00"

# Verifica prerequisiti
if (-not (Test-Path $Python)) {
    Write-Error "Python .venv non trovato: $Python"
    Write-Host  "Crea l'ambiente con:  python -m venv .venv  poi installa requirements.txt"
    exit 1
}
if (-not (Test-Path $Script)) {
    Write-Error "Script non trovato: $Script"
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute   $Python `
    -Argument  "`"$Script`" --trigger weekly_auto" `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $RunAt

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit       (New-TimeSpan -Hours 1) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -WakeToRun:$false

# Registra (sovrascrive se già esiste)
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action   $action `
    -Trigger  $trigger `
    -Settings $settings `
    -RunLevel Limited `
    -Force | Out-Null

Write-Host ""
Write-Host "Task registrato: '$TaskName'" -ForegroundColor Green
Write-Host "  Esecuzione: ogni domenica alle $RunAt"
Write-Host "  Python    : $Python"
Write-Host "  Script    : $Script"
Write-Host ""
Write-Host "Per eseguire subito (test):" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Per rimuovere il task:" -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
