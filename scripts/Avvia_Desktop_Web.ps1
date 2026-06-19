# Avvia SuperNova Desktop Web (Option B: server + browser)
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Load-WebHostProfile.ps1")

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$distIndex = Join-Path $Root "desktop-ui\dist\index.html"
if (-not $SkipBuild -and -not (Test-Path $distIndex)) {
    & (Join-Path $PSScriptRoot "build_desktop_web.ps1")
}

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "py" }

$port = if ($env:SUPERNOVA_PORT) { $env:SUPERNOVA_PORT } else { "8765" }
Write-Host "[web] http://127.0.0.1:$port/  (UI + API + /project-data/)" -ForegroundColor Cyan
if ($env:SUPERNOVA_BIND_ALL -eq "1") {
    Write-Host "[web] LAN: http://$(hostname):$port/" -ForegroundColor DarkGray
}
if ($env:SUPERNOVA_HOURLY_FINANCIAL -eq "1") {
    Write-Host "[web] Scheduler: hourly $($env:SUPERNOVA_HOURLY_FINANCIAL_START)-$($env:SUPERNOVA_HOURLY_FINANCIAL_END) ($($env:SUPERNOVA_SCHEDULE_TIMEZONE))" -ForegroundColor DarkGray
}

& $py -m supernova_api
