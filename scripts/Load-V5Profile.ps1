# Carica un profilo env v5 (evaluation | production) e opzionalmente lancia refresh Accuracy.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("evaluation", "production")]
    [string]$Profile,

    [switch]$RunAccuracyRefresh,
    [switch]$LiveSimPred,
    [switch]$FullJsonEnrich
)

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $Root "data_orchestrator.py"))) {
    $Root = Split-Path -Parent $PSScriptRoot
}
$EnvFile = Join-Path $Root "config\profiles\v5_$Profile.env"
if (-not (Test-Path $EnvFile)) {
    Write-Error "Profilo non trovato: $EnvFile"
    exit 1
}

Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    if ($parts.Count -ge 2) {
        Set-Item -Path "Env:$($parts[0].Trim())" -Value $parts[1].Trim()
    }
}

Write-Host "[v5 profile] Caricato: $Profile ($EnvFile)" -ForegroundColor Cyan
Get-Content $EnvFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object { Write-Host "  $_" }

if ($RunAccuracyRefresh) {
    Set-Location $Root
    $args = @("refresh_accuracy_modello.py")
    if ($LiveSimPred) { $args += "--live-sim-pred" }
    if ($FullJsonEnrich) { $args += "--full-json-enrich" }
    Write-Host "[v5 profile] py -3 $($args -join ' ')" -ForegroundColor Yellow
    & py -3 @args
    exit $LASTEXITCODE
}
