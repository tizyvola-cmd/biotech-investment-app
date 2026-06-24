param(
    [int]$ExitCode = 1,
    [string]$LogPath = ""
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$tail = @()
if ($LogPath -and (Test-Path -LiteralPath $LogPath)) {
    try {
        $tail = Get-Content -LiteralPath $LogPath -Tail 14 -ErrorAction Stop
    } catch {
        $tail = @("(impossibile leggere il log)")
    }
} else {
    $tail = @("(log non trovato)")
}

$body = @(
    "Avvio SuperNova fallito (codice $ExitCode)."
    ""
    "Ultime righe del log:"
    ($tail -join [Environment]::NewLine)
    ""
    if ($LogPath) { "Log completo:`n$LogPath" }
) -join [Environment]::NewLine

[System.Windows.Forms.MessageBox]::Show($body, "SuperNova", "OK", "Error") | Out-Null
