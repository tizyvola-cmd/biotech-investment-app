# Build a shareable SuperNova remote-client zip (Option A).
# Output: dist\SuperNova-Remote-Client.zip
#
# Usage:
#   .\scripts\Build-SuperNova-Remote-Client.ps1
#   .\scripts\Build-SuperNova-Remote-Client.ps1 -Url "http://91.99.15.48:8765/"

param(
    [string]$Url = "http://91.99.15.48:8765/"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$src = Join-Path $root "client-remote"
$stage = Join-Path $root "dist\SuperNova-Remote-Client"
$zip = Join-Path $root "dist\SuperNova-Remote-Client.zip"

if (-not (Test-Path $src)) { throw "Missing client-remote folder: $src" }

Write-Host "Staging client → $stage" -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item (Join-Path $src "Avvia-SuperNova.cmd") $stage
Copy-Item (Join-Path $src "Avvia-SuperNova.vbs") $stage
Copy-Item (Join-Path $src "Create-Desktop-Shortcut.ps1") $stage
Copy-Item (Join-Path $src "Installa-su-Desktop.bat") $stage
Copy-Item (Join-Path $src "LEGGIMI.txt") $stage
Copy-Item (Join-Path $src "Launcher.cs") $stage

@"
# SuperNova — client remoto (Opzione A)
# Gli aggiornamenti arrivano dal server: non serve reinstallare questo pacchetto.

URL=$Url
"@ | Set-Content -Path (Join-Path $stage "config.txt") -Encoding UTF8

$iconSrc = Join-Path $root "assets\SuperNova_Desktop.ico"
if (-not (Test-Path $iconSrc)) { $iconSrc = Join-Path $root "assets\supernova_app_icon.ico" }
if (Test-Path $iconSrc) {
    Copy-Item $iconSrc (Join-Path $stage "SuperNova.ico")
    Write-Host "Icon: $iconSrc" -ForegroundColor DarkGray
}

# Compile tiny WinForms launcher if csc is available
$exeOut = Join-Path $stage "SuperNova.exe"
$csc = $null
$cscCandidates = @(
    "${env:WINDIR}\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "${env:WINDIR}\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
foreach ($c in $cscCandidates) {
    if (Test-Path $c) { $csc = $c; break }
}

if ($csc) {
    Write-Host "Compiling SuperNova.exe with $csc" -ForegroundColor Cyan
    $cs = Join-Path $stage "Launcher.cs"
    $iconArg = @()
    $ico = Join-Path $stage "SuperNova.ico"
    if (Test-Path $ico) { $iconArg = @("/win32icon:$ico") }
    & $csc /nologo /target:winexe /platform:anycpu /optimize+ `
        /reference:System.Windows.Forms.dll `
        @iconArg `
        /out:"$exeOut" `
        "$cs"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exeOut)) {
        Write-Host "WARN: compile failed - client will use .vbs launcher (Installa-su-Desktop.bat)" -ForegroundColor Yellow
    } else {
        Write-Host "OK: $exeOut (optional; install via Installa-su-Desktop.bat prefers .vbs)" -ForegroundColor Green
    }
} else {
    Write-Host "WARN: csc.exe not found - client will use .vbs launcher" -ForegroundColor Yellow
}

# Zip
New-Item -ItemType Directory -Path (Split-Path $zip) -Force | Out-Null
if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)

Write-Host ""
Write-Host "Pacchetto pronto:" -ForegroundColor Green
Write-Host "  Cartella: $stage"
Write-Host "  Zip:      $zip"
Write-Host ""
Write-Host "Condividi lo ZIP con il nuovo utente. Istruzioni in LEGGIMI.txt" -ForegroundColor Cyan
Write-Host "Update UI/API: .\scripts\deploy_vps_update.ps1 (poi loro riaprono SuperNova)" -ForegroundColor DarkGray
