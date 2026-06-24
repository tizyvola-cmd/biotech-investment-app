# Libera porta 8765 bloccata e processi Electron zombie prima dell'avvio desktop.
$ErrorActionPreference = "SilentlyContinue"

function Test-ApiHealth {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/health" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Get-PidsOnPort([int]$Port) {
    $pids = @()
    # netstat -ano: EN "LISTENING", IT "IN ASCOLTO"
    $lines = netstat -ano | Select-String ":$Port\s"
    foreach ($line in $lines) {
        if ($line -match "\s(?:LISTENING|IN ASCOLTO)\s+(\d+)\s*$") {
            $pids += [int]$Matches[1]
        }
    }
    return $pids | Sort-Object -Unique
}

function Stop-SupernovaApiZombies([string]$ProjectRoot) {
    $venvPy = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object {
        $cmd = $_.CommandLine
        if (-not $cmd) { return }
        if ($cmd -notmatch "supernova_api") { return }
        $exe = $_.ExecutablePath
        if ($exe -and ($exe -ieq $venvPy)) { return }
        "kill zombie api pid=$($_.ProcessId) exe=$exe" | Add-Content $script:log
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$root = Split-Path -Parent $PSScriptRoot
$electronNeedle = Join-Path $root "electron\node_modules\electron\dist\electron.exe"
$logDir = Join-Path $env:LOCALAPPDATA "SuperNova"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "preflight-latest.txt"
$script:log = $log

"=== preflight $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Set-Content $log

Stop-SupernovaApiZombies -ProjectRoot $root

# Chiudi Electron del progetto (zombie / istanze multiple).
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
    if ($_.ExecutablePath -and ($_.ExecutablePath -ieq $electronNeedle)) {
        "kill electron pid=$($_.ProcessId)" | Add-Content $log
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 400

if (Test-ApiHealth) {
    "api ok" | Add-Content $log
    exit 0
}

foreach ($pid in Get-PidsOnPort 8765) {
    try {
        $p = Get-Process -Id $pid -ErrorAction Stop
        "port 8765 pid=$pid name=$($p.ProcessName) path=$($p.Path)" | Add-Content $log
    } catch {
        "port 8765 pid=$pid (unknown)" | Add-Content $log
    }
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    "killed pid=$pid on 8765 (health was bad)" | Add-Content $log
}

Start-Sleep -Milliseconds 500
if (Test-ApiHealth) {
    "api ok after cleanup" | Add-Content $log
} else {
    "api still down - Electron will start supernova_api" | Add-Content $log
}
exit 0
