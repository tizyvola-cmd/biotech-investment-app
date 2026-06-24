# =============================================================================
# Setup_Weekly_Saturday_Full.ps1
#
# Registra (o aggiorna) un task Windows che esegue ogni SABATO
# l'orchestrator completo (profilo WeeklyFull) anche con app chiusa.
#
# Equivalente VPS: SUPERNOVA_SATURDAY_WEEKLY_FULL=1 nel profilo web host
# (scheduler integrato in supernova_api) oppure cron diretto sullo script Python.
#
# NON richiede Amministratore. Riesegui per aggiornare orario o rimuovere.
#
# Uso:
#   cd "C:\coding\Biotech_Investment app 6"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1
#
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1 -At "07:00"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1 -Uninstall
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1 -RunNow
# =============================================================================

param(
    [string] $At = "07:00",
    [switch] $Uninstall,
    [switch] $RunNow
)

$ErrorActionPreference = "Stop"

$TaskName    = "SuperNova - Weekly Saturday Full Refresh"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python      = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    $Python = (Get-Command py -ErrorAction SilentlyContinue).Source
    if ($Python) { $Python = "py" }
    else { $Python = (Get-Command python -ErrorAction SilentlyContinue).Source }
}
$Script      = Join-Path $ProjectRoot "scripts\saturday_weekly_full_refresh.py"
$LogHint     = Join-Path $ProjectRoot "data\logs\saturday_weekly_full_*.log"

if ($Uninstall) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Host "Task '$TaskName' non registrato. Nulla da rimuovere." -ForegroundColor Yellow
        exit 0
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task '$TaskName' rimosso." -ForegroundColor Green
    exit 0
}

if (-not ($At -match '^\d{1,2}:\d{2}$')) {
    Write-Error "Formato orario non valido: '$At'. Usa HH:mm (es. 07:00)."
    exit 1
}

if (-not (Test-Path $Script)) {
    Write-Error "Script non trovato: $Script"
    exit 1
}

if ($Python -eq "py") {
    $arguments = "-3 -u `"$Script`" --quiet"
    $execute = $Python
} else {
    $arguments = "-u `"$Script`" --quiet"
    $execute = $Python
}

$action = New-ScheduledTaskAction `
    -Execute          $execute `
    -Argument         $arguments `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At $At

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit       (New-TimeSpan -Hours 4) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -WakeToRun:$false `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 30)

$principal = New-ScheduledTaskPrincipal `
    -UserId   "$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel  Limited

$description = @"
Orchestrator SuperNova profilo WeeklyFull (sabato full, 30-90+ min).
Esegue scripts\saturday_weekly_full_refresh.py (Linux/VPS-safe, no PowerShell).
Log tipico: $LogHint

Su VPS: preferire SUPERNOVA_SATURDAY_WEEKLY_FULL=1 in desktop_web_host.env.
Per disabilitare questo task: Setup_Weekly_Saturday_Full.ps1 -Uninstall
"@

Register-ScheduledTask `
    -TaskName    $TaskName `
    -Description $description `
    -Action      $action `
    -Trigger     $trigger `
    -Settings    $settings `
    -Principal   $principal `
    -Force | Out-Null

Write-Host ""
Write-Host "Task registrato: '$TaskName'" -ForegroundColor Green
Write-Host "  Esecuzione: ogni sabato alle $At (ora locale)"
Write-Host "  Script    : $Script"
Write-Host "  Log       : $LogHint"
Write-Host ""
Write-Host "Nota: l'app desktop può avviare lo stesso profilo il sabato mattina" -ForegroundColor Cyan
Write-Host "      al primo avvio (06:00-13:59). Il task server/task scheduler evita di dipendere dall'app."
Write-Host ""
Write-Host "Comandi utili:" -ForegroundColor Cyan
Write-Host "  Test immediato:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Prossima run:    Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "  Rimuovi:         powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1 -Uninstall"
Write-Host ""

if ($RunNow) {
    Write-Host "RunNow=TRUE → avvio task..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
        Select-Object LastRunTime, LastTaskResult, NextRunTime, State |
        Format-List
}
