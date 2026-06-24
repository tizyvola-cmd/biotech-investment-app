# Carica config/profiles/desktop_web_host.env nel processo corrente.
# Uso:
#   . .\scripts\Load-WebHostProfile.ps1
#   python -m supernova_api
#
# Oppure: .\scripts\Avvia_Desktop_Web.ps1

function Import-SuperNovaEnvFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )
    if (-not (Test-Path $Path)) {
        Write-Warning "Env file not found: $Path"
        return $false
    }
    $count = 0
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        if ($line -match "^([^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "Env:$name" -Value $value
            $count++
        }
    }
    Write-Host "[env] Loaded $count vars from $Path" -ForegroundColor DarkGray
    return $true
}

$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-Location }
$ProfilePath = Join-Path $Root "config\profiles\desktop_web_host.env"
Import-SuperNovaEnvFile -Path $ProfilePath | Out-Null
