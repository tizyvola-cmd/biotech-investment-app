# Profili refresh Biotech Investment - domenica (full) vs giorni feriali (fast).
# Uso interattivo:
#   . .\scripts\Biotech_Refresh_Profiles.ps1
#   Invoke-BiotechDailyRefresh
#   Invoke-BiotechWeeklyFull
#
# Da .bat: Profilo_Giornaliero_Refresh.bat / Profilo_Domenica_Orchestrator_Full.bat

param(
    [ValidateSet("Daily", "WeeklyFull", "SecK8Only", "AccuracyOnly")]
    [string]$Profile = "",
    [switch]$WithGuida,
    [switch]$WithGrafici,
    [switch]$ForceYfinanceFetch
)

$ErrorActionPreference = "Stop"

function Get-BiotechProjectRoot {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here "..")).Path
}

function Get-BiotechPython {
    param([string]$ProjectRoot = (Get-BiotechProjectRoot))
    $picker = Join-Path $ProjectRoot "scripts\_grafici_pick_python.bat"
    if (Test-Path $picker) {
        $lines = cmd /c "`"$picker`" && echo GRAFICI_PY=%GRAFICI_PY%"
        foreach ($line in $lines) {
            if ($line -match "^GRAFICI_PY=(.+)$") {
                $exe = $matches[1].Trim()
                if ($exe -and (Test-Path $exe)) { return $exe }
            }
        }
    }
    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd) { return "py" }
    return "python"
}

function Clear-BiotechOrchestratorEnv {
    @(
        "ORCH_FAST_RELUNCH", "ORCH_SKIP_FETCH", "ORCH_SKIP_SEC_K8",
        "ORCH_SKIP_FINANCIAL_ENRICH", "ORCH_SKIP_AUTO_DISCOVERY",
        "ORCH_SKIP_IMMUTABLE_INDEX", "ORCH_SKIP_RETROSPECTIVE",
        "ORCH_SKIP_VARIATIONS_RETRY", "ORCH_SKIP_OPTIONS_PRED",
        "ORCH_SKIP_LIQUIDITY_YF", "ACC_SIM_IR_SCREEN_FETCH", "ORCH_PERF",
        "DAILY_REFRESH_FAST", "DAILY_SKIP_ACCURACY_SHEET",
        "DAILY_ACCURACY_ENRICH_ACTIVE_ONLY", "PAST_PRED_DISK_ONLY",
        "PAST_CATALYST_SKIP_CLINICAL_EXTRA", "HISTLIB_REFRESH_ON_ENRICH",
        "ACCURACY_REFRESH_FAST", "ACC_SIM_SKIP_V5_ON_WRITE",
        "ACC_SIM_BULK_PAST_WRITE", "ACCURACY_V5_RAW_METRICS"
    ) | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}

function Set-BiotechDailyRefreshEnv {
    Clear-BiotechOrchestratorEnv | Out-Null
    $env:PYTHONUNBUFFERED = "1"
    $env:DAILY_REFRESH_FAST = "1"
    $env:PRED_CURVE_SEQ_CALIB = "1"
    $env:SEC_K8_LOOKBACK_DAYS = "180"
    $env:PRED_K8_DISPLAY_OVERLAY = "1"
    $env:REFRESH_K8_LIVE_FALLBACK = "1"
    $env:PRED_V4_CURVE_SCALE_PRECD = "1.05"
    $env:PRED_CURVE_APPLY_CAL_FACTOR = "1"
    $env:ACCURACY_REFRESH_FAST = "1"
    $env:ACC_SIM_BULK_PAST_WRITE = "1"
    $env:ACC_SIM_SKIP_V5_ON_WRITE = "1"
    $env:ACCURACY_V5_RAW_METRICS = "0"
    $env:PAST_CATALYST_SKIP_CLINICAL_EXTRA = "1"
    $env:PAST_PRED_DISK_ONLY = "1"
    $env:ORCH_SKIP_FINANCIAL_ENRICH = "1"
    $env:ORCH_SKIP_SEC_K8 = "1"
    $env:ORCH_SKIP_OPTIONS_PRED = "1"
    $env:DAILY_ACCURACY_ENRICH_ACTIVE_ONLY = "1"
    $env:DAILY_SKIP_ACCURACY_SHEET = "1"
    # Storico prezzi: pickle preservati; solo coda Yahoo se ultima barra > N gg
    $env:HISTLIB_INCREMENTAL_ONLY = "1"
    $env:HISTLIB_MIN_LAG_DAYS = "3"
    $env:HISTLIB_REFRESH_ON_ENRICH = "0"
    $env:YF_CACHE_STICKY = "1"
    $env:YF_QUOTE_REFRESH_HOURS = "4"
    $env:ORCH_SKIP_LIQUIDITY_YF = "1"
}

function Set-BiotechWeeklyFullEnv {
    param(
        [switch]$SkipYfinanceFetch,
        [switch]$FastRelaunch
    )
    Clear-BiotechOrchestratorEnv | Out-Null
    $env:PYTHONUNBUFFERED = "1"
    $env:ORCH_SKIP_SEC_K8 = "0"
    $env:ORCH_PERF = "1"
    $env:HISTLIB_INCREMENTAL_ONLY = "1"
    $env:HISTLIB_MIN_LAG_DAYS = "3"
    $env:YF_CACHE_STICKY = "1"
    $env:YF_QUOTE_REFRESH_HOURS = "4"
    $env:LIQUIDITY_YF_FORCE = "1"
    if ($SkipYfinanceFetch) {
        $env:ORCH_SKIP_FETCH = "1"
    }
    if ($FastRelaunch) {
        $env:ORCH_FAST_RELUNCH = "1"
        # Nota: fast-relaunch imposta anche ORCH_SKIP_SEC_K8=1 via setdefault -
        # per la domenica «full» non usare -FastRelaunch.
    }
}

function Test-BiotechYfJsonReady {
    param([string]$ProjectRoot = (Get-BiotechProjectRoot))
    $yf = Join-Path $ProjectRoot "data\yf.json"
    if (-not (Test-Path $yf)) { return $false }
    try {
        return ((Get-Item $yf).Length -gt 1000)
    } catch {
        return $false
    }
}

function Invoke-BiotechDailyRefresh {
    param(
        [string]$ProjectRoot = (Get-BiotechProjectRoot),
        [switch]$WithGuida,
        [switch]$WithGrafici,
        [switch]$DryRun,
        [string[]]$ExtraArgs
    )
    Set-BiotechDailyRefreshEnv
    $py = Get-BiotechPython -ProjectRoot $ProjectRoot
    Push-Location $ProjectRoot
    try {
        $args = @("-3", "-u", "refresh_fast.py")
        if ($DryRun) { $args += "--dry-run" }
        if ($WithGuida) { $args += "--with-guida" }
        if ($WithGrafici) { $args += "--with-grafici" }
        if ($ExtraArgs) { $args += $ExtraArgs }
        Write-Host "[Profilo giornaliero] $py $($args -join ' ')" -ForegroundColor Cyan
        Write-Host "  Excel: chiudi biotech_orchestrated_output.xlsx prima del salvataggio." -ForegroundColor DarkGray
        & $py @args
        if ($LASTEXITCODE -ne 0) { throw "refresh_fast exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

function Invoke-BiotechPostRefreshSteps {
    param(
        [string]$ProjectRoot = (Get-BiotechProjectRoot),
        [switch]$SkipLiveSignals
    )
    $py = Get-BiotechPython -ProjectRoot $ProjectRoot
    Push-Location $ProjectRoot
    try {
        $args = @("-3", "-u", "post_refresh_steps.py")
        if ($SkipLiveSignals) { $args += "--skip-live-signals" }
        Write-Host "[Post-refresh] KPI direzionali + cohort + live signals..." -ForegroundColor Cyan
        & $py @args
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[Post-refresh] completato con errori (exit $LASTEXITCODE) - non bloccante." -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

function Invoke-BiotechWeeklyFull {
    param(
        [string]$ProjectRoot = (Get-BiotechProjectRoot),
        [switch]$ForceYfinanceFetch,
        [string[]]$ExtraArgs
    )
    $skipFetch = -not $ForceYfinanceFetch
    if ($skipFetch -and -not (Test-BiotechYfJsonReady -ProjectRoot $ProjectRoot)) {
        Write-Host "[Profilo domenica] data/yf.json assente o troppo piccolo - fetch yfinance incluso." -ForegroundColor Yellow
        $skipFetch = $false
    }
    Set-BiotechWeeklyFullEnv -SkipYfinanceFetch:($skipFetch)
    $py = Get-BiotechPython -ProjectRoot $ProjectRoot
    Push-Location $ProjectRoot
    try {
        $args = @("-3", "-u", "data_orchestrator.py")
        if ($ExtraArgs) { $args += $ExtraArgs }
        Write-Host "[Profilo domenica - FULL] Stima: 30-90 min (SEC K-8 attivo)." -ForegroundColor Magenta
        if ($env:ORCH_SKIP_FETCH -eq "1") {
            Write-Host "  ORCH_SKIP_FETCH=1 (yf.json già presente)." -ForegroundColor DarkGray
        } else {
            Write-Host "  Fetch yfinance incluso (run più lungo)." -ForegroundColor DarkGray
        }
        Write-Host "  ORCH_SKIP_SEC_K8=0 -> foglio SEC K-8 rigenerato." -ForegroundColor DarkGray
        & $py @args
        if ($LASTEXITCODE -ne 0) { throw "data_orchestrator exit $LASTEXITCODE" }
        Invoke-BiotechPostRefreshSteps -ProjectRoot $ProjectRoot
    } finally {
        Pop-Location
    }
}

function Invoke-BiotechSecK8Only {
    param([string]$ProjectRoot = (Get-BiotechProjectRoot))
    $py = Get-BiotechPython -ProjectRoot $ProjectRoot
    Push-Location $ProjectRoot
    try {
        Write-Host "[Solo SEC K-8] Aggiorna foglio senza orchestrator completo (15-45 min tipici)." -ForegroundColor Cyan
        & $py -3 -u refresh_sec_k8_sheet.py
        if ($LASTEXITCODE -ne 0) { throw "refresh_sec_k8_sheet exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

function Invoke-BiotechAccuracyOnly {
    param([string]$ProjectRoot = (Get-BiotechProjectRoot))
    Set-BiotechDailyRefreshEnv
    $py = Get-BiotechPython -ProjectRoot $ProjectRoot
    Push-Location $ProjectRoot
    try {
        & $py -3 -u refresh_accuracy_modello.py
        if ($LASTEXITCODE -ne 0) { throw "refresh_accuracy_modello exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

if ($Profile -eq "Daily") {
    Invoke-BiotechDailyRefresh -WithGuida:$WithGuida -WithGrafici:$WithGrafici
    exit $LASTEXITCODE
}
if ($Profile -eq "WeeklyFull") {
    Invoke-BiotechWeeklyFull -ForceYfinanceFetch:$ForceYfinanceFetch
    exit $LASTEXITCODE
}
if ($Profile -eq "SecK8Only") {
    Invoke-BiotechSecK8Only
    exit $LASTEXITCODE
}
if ($Profile -eq "AccuracyOnly") {
    Invoke-BiotechAccuracyOnly
    exit $LASTEXITCODE
}
