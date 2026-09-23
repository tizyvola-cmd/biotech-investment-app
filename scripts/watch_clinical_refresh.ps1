# Poll /api/clinical-pre-cd/status until enrichment finishes, then alert.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\watch_clinical_refresh.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\watch_clinical_refresh.ps1 -IntervalSec 45

param(
    [string]$Base = "http://91.99.15.48:8765",
    [int]$IntervalSec = 30
)

function Show-DoneAlert([string]$Title, [string]$Body) {
    Write-Host ""
    Write-Host $Title -ForegroundColor Green
    Write-Host $Body
    try {
        [console]::Beep(880, 400)
        Start-Sleep -Milliseconds 120
        [console]::Beep(1100, 500)
    } catch {
        # ignore on headless shells
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($Body, $Title)
    } catch {
        Write-Host "(Popup non disponibile - leggi il messaggio sopra.)" -ForegroundColor Yellow
    }
}

Write-Host "Watching clinical pre-CD refresh on $Base (every ${IntervalSec}s)..." -ForegroundColor Cyan
Write-Host "Ctrl+C per interrompere il watcher (il job sul VPS continua)." -ForegroundColor DarkGray

while ($true) {
    try {
        $st = Invoke-RestMethod -Uri "$Base/api/clinical-pre-cd/status" -TimeoutSec 20
    } catch {
        Write-Host ("[{0}] status error: {1}" -f (Get-Date -Format "HH:mm:ss"), $_) -ForegroundColor Red
        Start-Sleep -Seconds $IntervalSec
        continue
    }

    $ts = Get-Date -Format "HH:mm:ss"
    if ($st.running) {
        $msg = $st.message
        if ([string]::IsNullOrWhiteSpace($msg)) { $msg = "(in corso)" }
        $line = "[{0}] running {1}/{2} ai_ok={3} {4}" -f $ts, $st.processed, $st.total, $st.ai_ok, $msg
        Write-Host $line
        Start-Sleep -Seconds $IntervalSec
        continue
    }

    $err = $st.error
    if ($err) {
        $errBody = "processed=$($st.processed)/$($st.total)`nai_ok=$($st.ai_ok)`nerror=$err"
        Show-DoneAlert "Clinical refresh - errore" $errBody
        exit 1
    }

    $cers = 0
    $podd = 0
    try {
        $snap = Invoke-RestMethod -Uri "$Base/api/clinical-pre-cd/snapshot" -TimeoutSec 45
        $cers = @($snap.records | Where-Object { $_.ticker -eq "CERS" }).Count
        $podd = @($snap.records | Where-Object { $_.ticker -eq "PODD" }).Count
        $body = @(
            "processed=$($st.processed)/$($st.total)"
            "ai_ok=$($st.ai_ok)"
            "CERS records=$cers"
            "PODD records=$podd"
            "updated_at=$($snap.updated_at)"
        ) -join "`n"
    } catch {
        $body = "processed=$($st.processed)/$($st.total)`nai_ok=$($st.ai_ok)`n(snapshot non letto: $_)"
    }

    Show-DoneAlert "Clinical refresh - finito" $body
    exit 0
}
