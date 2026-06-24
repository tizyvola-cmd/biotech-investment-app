# Crea sul Desktop un collegamento "SuperNova Mobile" con icona supernova.
# Uso: scripts\Installa_Mobile_Su_Desktop.bat
#      .\Create_Mobile_Shortcut.ps1 -IconPath "C:\percorso\mia_icona.ico"

param(
    [string]$ShortcutName = "SuperNova Mobile",
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
    $png = Join-Path $ProjectRoot "assets\supernova_mobile_icon.png"
    if (Test-Path $png) {
        $ico = Join-Path $ProjectRoot "assets\supernova_mobile_icon.ico"
        $py = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
        if (-not (Test-Path $py)) { $py = "py" }
        $conv = @"
from pathlib import Path
from PIL import Image
p = Path(r'$png')
o = Path(r'$ico')
img = Image.open(p).convert('RGBA')
img.save(o, format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])
print(o)
"@
        try {
            & $py -c $conv 2>$null | Out-Null
            if (Test-Path $ico) { return (Resolve-Path $ico).Path }
        } catch { }
    }
    return $null
}

$root = Get-ProjectRoot
$launcherBat = Join-Path $root "scripts\Avvia_Term2_Mobile.bat"
if (-not (Test-Path $launcherBat)) {
    throw "Manca scripts\Avvia_Term2_Mobile.bat in: $root"
}

$iconFile = Resolve-ShortcutIcon -ProjectRoot $root -UserIcon $IconPath

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "$ShortcutName.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$sc = $WshShell.CreateShortcut($lnkPath)
$sc.TargetPath = $launcherBat
$sc.WorkingDirectory = $root
$sc.WindowStyle = 1
$sc.Description = "SuperNova Mobile PWA - dev locale porta 5174"
if ($iconFile) {
    $sc.IconLocation = "$iconFile,0"
}
$sc.Save()

Write-Host ""
Write-Host "OK - Collegamento creato:" -ForegroundColor Green
Write-Host "  $lnkPath"
if ($iconFile) {
    Write-Host "  Icona: $iconFile" -ForegroundColor Green
} else {
    Write-Host "  Icona: default Windows" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Sul Desktop: '$ShortcutName' - doppio clic avvia Term 2 (Mobile)."
Write-Host "Ricorda anche Term 1 = Biotech (API 8765): scripts\Avvia_Term1_Biotech.bat"
Write-Host ""
