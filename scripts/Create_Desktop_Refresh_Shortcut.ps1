# Crea sul Desktop un collegamento "SuperNova" con icona personalizzata.
# Uso: scripts\Installa_Refresh_Su_Desktop.bat
#      .\Create_Desktop_Refresh_Shortcut.ps1 -IconPath "C:\percorso\mia_icona.ico"

param(
    [string]$ShortcutName = "SuperNova",
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
        (Join-Path $ProjectRoot "assets\SuperNova_Desktop.ico"),
        (Join-Path $ProjectRoot "assets\supernova_app_icon.ico"),
        (Join-Path $ProjectRoot "refresh_desktop\BiotechRefresh.ico"),
        (Join-Path $ProjectRoot "assets\BiotechRefresh.ico")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    $png = Join-Path $ProjectRoot "refresh_desktop\BiotechRefresh.png"
    if (Test-Path $png) {
        $ico = Join-Path $ProjectRoot "refresh_desktop\BiotechRefresh.ico"
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
            $out = & $py -3 -c $conv 2>$null
            if (Test-Path $ico) { return (Resolve-Path $ico).Path }
        } catch { }
    }
    return $null
}

$root = Get-ProjectRoot
$launcherBat = Join-Path $root "scripts\Launch-SuperNova.bat"
$launcherCmd = Join-Path $root "SuperNova.cmd"
$launcherVbs = Join-Path $root "SuperNovaLaunch.vbs"
if (-not (Test-Path $launcherBat)) {
    throw "Manca scripts\Launch-SuperNova.bat in: $root"
}
$launcherTarget = if (Test-Path $launcherCmd) { $launcherCmd } elseif (Test-Path $launcherVbs) { $launcherVbs } else { $launcherBat }

$iconFile = Resolve-ShortcutIcon -ProjectRoot $root -UserIcon $IconPath

$desktop = [Environment]::GetFolderPath("Desktop")
$lnkPath = Join-Path $desktop "$ShortcutName.lnk"

# Rimuovi collegamenti legacy (stesso target vecchio refresh Tk)
foreach ($legacyName in @("Biotech Refresh", "Biotech Refresh Desktop", "Biotech Catalyst", "SperNova")) {
    $legacy = Join-Path $desktop "$legacyName.lnk"
    if ((Test-Path $legacy) -and ($legacy -ne $lnkPath)) {
        Remove-Item -LiteralPath $legacy -Force -ErrorAction SilentlyContinue
        Write-Host "Rimosso collegamento legacy: $legacyName.lnk" -ForegroundColor DarkYellow
    }
}

# Ricrea collegamento (rimuovi prima per aggiornare icona in cache)
if (Test-Path $lnkPath) {
    Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue
}

$WshShell = New-Object -ComObject WScript.Shell
$sc = $WshShell.CreateShortcut($lnkPath)
$sc.TargetPath = $launcherTarget
$sc.WorkingDirectory = $root
$sc.WindowStyle = 1
$sc.Description = "SuperNova - analisi + refresh workbook integrati"
if ($iconFile) {
    $sc.IconLocation = "$iconFile,0"
}
$sc.Save()

# Forza refresh cache icone Windows (collegamento Desktop)
try {
  $ie4u = Join-Path ${env:Windir} "System32\ie4uinit.exe"
  if (Test-Path $ie4u) {
    Start-Process -FilePath $ie4u -ArgumentList "-show" -WindowStyle Hidden -ErrorAction SilentlyContinue
  }
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShellIconCache {
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
}
"@
  [ShellIconCache]::SHChangeNotify(0x8000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
} catch { }

Write-Host ""
Write-Host "OK - Collegamento creato:" -ForegroundColor Green
Write-Host "  $lnkPath"
if ($iconFile) {
    Write-Host "  Icona: $iconFile" -ForegroundColor Green
} else {
    Write-Host "  Icona: default (metti refresh_desktop\BiotechRefresh.ico e riesegui)" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Sul Desktop: '$ShortcutName' - doppio clic apre l'app."
Write-Host "Log avvio: $env:LOCALAPPDATA\SuperNova\launch-latest.txt (e electron.log)"
Write-Host "Se non parte: apri il log o esegui scripts\Launch-SuperNova.bat da cmd."
Write-Host ""
