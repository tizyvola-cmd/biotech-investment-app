# Crea sul Desktop i collegamenti SuperNova (+ opzionale Andrea, icona grigia).
# Preferisce .vbs (wscript): Windows Defender spesso blocca SuperNova.exe unsigned.
param(
    [string]$ClientDir = "",
    [switch]$SkipAndrea
)

$ErrorActionPreference = "Stop"

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ClientDir) { $ClientDir = $here }
$ClientDir = (Resolve-Path $ClientDir).Path

# Clear Mark-of-the-Web after download/unzip (helps SmartScreen).
Get-ChildItem -LiteralPath $ClientDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue } catch { }
}

function Resolve-Icon([string]$Dir, [string[]]$Candidates) {
    foreach ($c in $Candidates) {
        $p = if ([System.IO.Path]::IsPathRooted($c)) { $c } else { Join-Path $Dir $c }
        if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
    }
    return $null
}

function New-SuperNovaShortcut {
    param(
        [Parameter(Mandatory = $true)][string]$ShortcutName,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [string]$Arguments = "",
        [string]$IconPath = $null,
        [string]$Description = "SuperNova"
    )

    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnkPath = Join-Path $desktop ($ShortcutName + ".lnk")
    if (Test-Path -LiteralPath $lnkPath) {
        Remove-Item -LiteralPath $lnkPath -Force -ErrorAction SilentlyContinue
    }

    $w = New-Object -ComObject WScript.Shell
    $sc = $w.CreateShortcut($lnkPath)
    $sc.TargetPath = $TargetPath
    $sc.Arguments = if ($Arguments) { $Arguments } else { "" }
    $sc.WorkingDirectory = $ClientDir
    $sc.WindowStyle = 1
    $sc.Description = $Description
    if ($IconPath) { $sc.IconLocation = "$IconPath,0" }
    $sc.Save()

    Write-Host ("Collegamento creato: " + $lnkPath) -ForegroundColor Green
    Write-Host ("  Target: " + $TargetPath + " " + $Arguments) -ForegroundColor DarkGray
    if ($IconPath) { Write-Host ("  Icona: " + $IconPath) -ForegroundColor DarkGray }
}

# --- Main SuperNova (default browser / existing launcher) ---
$exe = Join-Path $ClientDir "SuperNova.exe"
$vbs = Join-Path $ClientDir "Avvia-SuperNova.vbs"
$cmd = Join-Path $ClientDir "Avvia-SuperNova.cmd"

$mainTarget = $null
$mainArgs = ""
if (Test-Path -LiteralPath $vbs) {
    $mainTarget = (Get-Command wscript.exe).Source
    $mainArgs = '"' + $vbs + '"'
} elseif (Test-Path -LiteralPath $exe) {
    $mainTarget = $exe
} elseif (Test-Path -LiteralPath $cmd) {
    $mainTarget = $cmd
} else {
    throw ("Nessun launcher trovato in: " + $ClientDir)
}

$mainIcon = Resolve-Icon $ClientDir @(
    "SuperNova.ico",
    "assets\SuperNova_Desktop.ico",
    "..\assets\SuperNova_Desktop.ico"
)

New-SuperNovaShortcut `
    -ShortcutName "SuperNova" `
    -TargetPath $mainTarget `
    -Arguments $mainArgs `
    -IconPath $mainIcon `
    -Description "SuperNova - tuo account (browser predefinito)"

# --- Andrea: local Electron if present, else Edge/Chrome profile + gray icon ---
if (-not $SkipAndrea) {
    $andreaLocalBat = Join-Path (Split-Path -Parent $ClientDir) "scripts\Avvia_SuperNova_Andrea.bat"
    if (-not (Test-Path -LiteralPath $andreaLocalBat)) {
        $andreaLocalBat = Join-Path $ClientDir "..\scripts\Avvia_SuperNova_Andrea.bat"
    }
    $andreaVbs = Join-Path $ClientDir "Avvia-SuperNova-Andrea.vbs"
    $andreaCmd = Join-Path $ClientDir "Avvia-SuperNova-Andrea.cmd"
    $andreaTarget = $null
    $andreaArgs = ""
    if (Test-Path -LiteralPath $andreaLocalBat) {
        # Full repo: second Electron window (same as main app, separate profile).
        $andreaTarget = (Resolve-Path -LiteralPath $andreaLocalBat).Path
        $andreaArgs = ""
    } elseif (Test-Path -LiteralPath $andreaVbs) {
        $andreaTarget = (Get-Command wscript.exe).Source
        $andreaArgs = '"' + $andreaVbs + '"'
    } elseif (Test-Path -LiteralPath $andreaCmd) {
        $andreaTarget = $andreaCmd
    } else {
        Write-Host "Avviso: launcher Andrea assente - salto scorciatoia grigia." -ForegroundColor Yellow
    }

    if ($andreaTarget) {
        $andreaIcon = Resolve-Icon $ClientDir @(
            "SuperNova-Andrea.ico",
            "..\assets\SuperNova_Andrea_Desktop.ico",
            "assets\SuperNova_Andrea_Desktop.ico"
        )
        $desc = if ($andreaTarget -like "*Avvia_SuperNova_Andrea.bat") {
            "SuperNova Andrea - Electron locale (profilo separato)"
        } else {
            "SuperNova Andrea - profilo browser separato (icona grigia)"
        }
        New-SuperNovaShortcut `
            -ShortcutName "SuperNova Andrea" `
            -TargetPath $andreaTarget `
            -Arguments $andreaArgs `
            -IconPath $andreaIcon `
            -Description $desc
    }
}

Write-Host ""
Write-Host "Fatto. Puoi aprire entrambe le scorciatoie insieme (account indipendenti)." -ForegroundColor Cyan
