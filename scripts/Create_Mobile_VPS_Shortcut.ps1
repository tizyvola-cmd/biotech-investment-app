# Collegamento Desktop -> SuperNova Mobile sul VPS (produzione, indipendente dal PC locale).
param(
    [string]$ShortcutName = "SuperNova Mobile (VPS)",
    [string]$MobileUrl = "http://91.99.15.48:8765/mobile/",
    [string]$IconPath = ""
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    $here = $PSScriptRoot
    if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
    return (Resolve-Path (Join-Path $here "..")).Path
}

function Resolve-ShortcutIcon {
    param([string]$ProjectRoot, [string]$UserIcon)
    if ($UserIcon -and (Test-Path $UserIcon)) {
        return (Resolve-Path $UserIcon).Path
    }
    $candidates = @(
        (Join-Path $ProjectRoot "assets\supernova_mobile_icon.ico"),
        (Join-Path $ProjectRoot "assets\supernova_app_icon.ico")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    return $null
}

$root = Get-ProjectRoot
$iconFile = Resolve-ShortcutIcon -ProjectRoot $root -UserIcon $IconPath
$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "$ShortcutName.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$sc = $WshShell.CreateShortcut($lnkPath)
$sc.TargetPath = $MobileUrl
$sc.Description = "SuperNova Mobile PWA sul VPS - indipendente dal PC"
if ($iconFile) {
    $sc.IconLocation = "$iconFile,0"
}
$sc.Save()

Write-Host ""
Write-Host "OK - Collegamento creato:" -ForegroundColor Green
Write-Host "  $lnkPath"
Write-Host "  URL: $MobileUrl"
Write-Host ""
Write-Host "Sul telefono apri lo stesso URL e usa Aggiungi a Home / Installa app."
Write-Host ""
