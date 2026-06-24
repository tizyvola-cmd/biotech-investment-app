# =============================================================================
# Setup_Daily_Market_Refresh.ps1
#
# Registra (o aggiorna) il task Windows che esegue OGNI GIORNO LAVORATIVO
# (Lun-Ven) il refresh automatico di:
#   - prezzi Yahoo Finance / Finnhub  (per tab Finance)
#   - foglio Simulation               (per Decision Lab "Segnali Attivi")
#   - foglio Accuracy                 (per Diagnostica predittiva)
#   - KPI direzionali Raw/Utile/Forte (per Modelli / Accuracy)
#   - cohort Investment Decision Lab  (per "Cohort storica" tab)
#   - refresh_live_signals            (pred5/affid, audit Pre-CD)
#   - LUNEDI: BiotechClinicalTrialDataFetcher (CT.gov incrementale, cache 14 gg)
#
# NON richiede Amministratore. Riesegui per aggiornare orario o flag.
#
# Uso:
#   cd "C:\coding\Biotech_Investment app 6"
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Daily_Market_Refresh.ps1
#
#   # Orario diverso (default 16:00 ora italiana):
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Daily_Market_Refresh.ps1 -At "22:30"
#
#   # Anche weekend (sconsigliato):
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Daily_Market_Refresh.ps1 -IncludeWeekend
#
#   # Rimuovere il task:
#   powershell -ExecutionPolicy Bypass -File scripts\Setup_Daily_Market_Refresh.ps1 -Uninstall
# =============================================================================

param(
    [string]   $At = "16:00",                          # orario locale (HH:mm)
    [string[]] $DaysOfWeek = @("Monday","Tuesday","Wednesday","Thursday","Friday"),
    [switch]   $IncludeWeekend,                         # se settato, gira tutti i giorni
    [switch]   $Uninstall,                              # rimuove il task se presente
    [switch]   $RunNow                                  # esegue subito dopo registrazione (test)
)

$ErrorActionPreference = "Stop"

$TaskName = "SuperNova - Daily Market Refresh"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python      = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$Script      = Join-Path $ProjectRoot "scripts\daily_market_refresh.py"
$LogDir      = Join-Path $ProjectRoot "data\logs"

# ── Uninstall path ──
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

# ── Validazione orario ──
if (-not ($At -match '^\d{1,2}:\d{2}$')) {
    Write-Error "Formato orario non valido: '$At'. Usa HH:mm (es. 16:00, 22:30)."
    exit 1
}

# ── Validazione prerequisiti ──
if (-not (Test-Path $Python)) {
    Write-Error @"
Python venv non trovato: $Python
Crea l'ambiente con:
    cd "$ProjectRoot"
    python -m venv .venv
    .venv\Scripts\activate
    pip install -r requirements.txt
"@
    exit 1
}
if (-not (Test-Path $Script)) {
    Write-Error "Script non trovato: $Script"
    exit 1
}
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

if ($IncludeWeekend) {
    $DaysOfWeek = @("Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday")
}

# ── Action: esegui daily_market_refresh.py ──
$action = New-ScheduledTaskAction `
    -Execute          $Python `
    -Argument         "`"$Script`"" `
    -WorkingDirectory $ProjectRoot

# ── Trigger: ogni giorno (i giorni vengono filtrati lato action via Python) ──
# Nota: Windows non supporta nativamente un trigger "weekly multiple days at HH:mm"
# senza Daily duplicati; usiamo Daily + filtro in Python (gestito da is_market_day).
# Però per minimizzare wake-up inutili usiamo Weekly se DaysOfWeek != 7 giorni.
if ($DaysOfWeek.Count -eq 7) {
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
} else {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DaysOfWeek -At $At
}

# ── Settings: robust ──
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit       (New-TimeSpan -Hours 4) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -WakeToRun:$false `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 15)

# ── Principal: gira con utente corrente, non richiede admin ──
$principal = New-ScheduledTaskPrincipal `
    -UserId   "$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel  Limited

# ── Description ──
$description = @"
Refresh automatico SuperNova/Biotech.
Esegue scripts\daily_market_refresh.py che:
  - aggiorna prezzi Yahoo Finance / Finnhub
  - ricalibra le curve pre-CD (slope, run-up)
  - rigenera foglio Simulation (Segnali Attivi nel Decision Lab)
  - rigenera foglio Accuracy (Diagnostica predittiva)
  - rigenera KPI direzionali Raw/Utile/Forte
  - rigenera cohort Investment Decision Lab (per UI)

Log: $LogDir\daily_refresh_YYYYMMDD.log
Skip automatico nei festivi NYSE.
Per modifica orario / scope: riesegui questo Setup.ps1 con -At / -IncludeWeekend.
Per disabilitare: Setup_Daily_Market_Refresh.ps1 -Uninstall
"@

# Registra (sovrascrive se già esiste)
Register-ScheduledTask `
    -TaskName    $TaskName `
    -Description $description `
    -Action      $action `
    -Trigger     $trigger `
    -Settings    $settings `
    -Principal   $principal `
    -Force | Out-Null

# ── Report ──
Write-Host ""
Write-Host "Task registrato: '$TaskName'" -ForegroundColor Green
Write-Host "  Esecuzione: $($DaysOfWeek -join ', ') alle $At (ora locale)"
Write-Host "  Python    : $Python"
Write-Host "  Script    : $Script"
Write-Host "  Logs      : $LogDir\daily_refresh_<YYYYMMDD>.log"
Write-Host ""
Write-Host "Comandi utili:" -ForegroundColor Cyan
Write-Host "  Esegui subito (test):"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Vedi stato e prossima esecuzione:"
Write-Host "    Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "  Disabilita temporaneamente:"
Write-Host "    Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Riabilita:"
Write-Host "    Enable-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Rimuovi del tutto:"
Write-Host "    powershell -ExecutionPolicy Bypass -File scripts\Setup_Daily_Market_Refresh.ps1 -Uninstall"
Write-Host ""

if ($RunNow) {
    Write-Host "RunNow=TRUE → eseguo subito il task per test..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo |
        Select-Object LastRunTime, LastTaskResult, NextRunTime, State |
        Format-List
}
