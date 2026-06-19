# =============================================================================
# Setup_Weekly_Sunday_Full.ps1
#
# Registra (o aggiorna) un task Windows che esegue ogni DOMENICA
# l'orchestrator completo (profilo WeeklyFull / «domenica full»).
#
# Alternativa consigliata in app: sabato mattina al primo avvio SuperNova
# (vedi desktop-ui/src/shared/sundayRefreshSchedule.ts) con badge 🕰️ e popup
# al termine — non richiede Task Scheduler.
#
# NON richiede Amministratore. Riesegui per aggiornare orario o rimuovere.
#
# Uso:
#   cd "C:\coding\Biotech_Investment app 6"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1
#
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1 -At "02:00"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1 -Uninstall
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1 -RunNow
# =============================================================================

param(
    [string] $At = "02:00",
    [switch] $Uninstall,
    [switch] $RunNow
)

$ErrorActionPreference = "Stop"

$TaskName    = "SuperNova - Weekly Sunday Full Refresh"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PowerShell  = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Script      = Join-Path $ProjectRoot "scripts\Biotech_Refresh_Profiles.ps1"
$LogHint     = Join-Path $ProjectRoot "data\last_orchestrator_log.txt"

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
    Write-Error "Formato orario non valido: '$At'. Usa HH:mm (es. 02:00)."
    exit 1
}

if (-not (Test-Path $Script)) {
    Write-Error "Script non trovato: $Script"
    exit 1
}

$action = New-ScheduledTaskAction `
    -Execute          $PowerShell `
    -Argument         "-NoProfile -ExecutionPolicy Bypass -File `"$Script`" -Profile WeeklyFull" `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $At

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
Orchestrator SuperNova profilo WeeklyFull (domenica full, 30-90+ min).
Esegue scripts\Biotech_Refresh_Profiles.ps1 -Profile WeeklyFull.
Log tipico: $LogHint

Per avvio automatico con UI (orologio + popup): apri l'app il sabato mattina.
Per disabilitare questo task: Setup_Weekly_Sunday_Full.ps1 -Uninstall
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
Write-Host "  Esecuzione: ogni domenica alle $At (ora locale)"
Write-Host "  Script    : $Script -Profile WeeklyFull"
Write-Host "  Log       : $LogHint"
Write-Host ""
Write-Host "Nota: l'app desktop può avviare lo stesso profilo il sabato mattina" -ForegroundColor Cyan
Write-Host "      al primo avvio (06:00-13:59), con badge orologio e popup al termine."
Write-Host ""
Write-Host "Comandi utili:" -ForegroundColor Cyan
Write-Host "  Test immediato:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Prossima run:    Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "  Rimuovi:         powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1 -Uninstall"
Write-Host ""

if ($RunNow) {
    Write-Host "RunNow=TRUE → avvio task..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
        Select-Object LastRunTime, LastTaskResult, NextRunTime, State |
        Format-List
}
