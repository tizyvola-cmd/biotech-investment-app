# Refresh Desktop (legacy Tk)

I profili refresh sono **integrati** nell’app Electron (**tab Refresh**).

Usa **`scripts\Avvia_Biotech_Desktop.bat`** o il collegamento **SuperNova** sul Desktop.

La vecchia finestra Tk (`refresh_desktop_app.py`) resta disponibile con `scripts\Avvia_Refresh_Desktop.bat` se ti serve solo refresh senza Electron.

## Icona sul Desktop (consigliato)

**Una sola volta**, dalla cartella progetto:

1. Doppio clic su **`scripts\Installa_Refresh_Su_Desktop.bat`**
2. Sul Desktop compare **`SuperNova`** — app unificata (dashboard + fogli + refresh)

Non serve aprire la folder del progetto ogni giorno. Il collegamento punta al percorso assoluto del progetto al momento dell’installazione.

Se sposti il progetto in un’altra cartella, riesegui l’installer.

**Alternativa manuale:** tasto destro su `Biotech_Refresh_Desktop.vbs` (nella root progetto) → *Invia a* → *Desktop (crea collegamento)*.

## Avvio dalla cartella progetto

- `scripts\Avvia_Refresh_Desktop.bat`
- `py -3 refresh_desktop_app.py`

## Excel dalla dashboard

- **Apri workbook in Excel** — apre `data\biotech_orchestrated_output.xlsx`
- **Apri staged in Excel** — ultimo `*__staged_*.xlsx` (dopo refresh con file chiuso)

Chiudi Excel prima di **Giornaliero** se Autosave tiene il file bloccato.

## Profili refresh

| Pulsante | Effetto |
|----------|---------|
| **Giornaliero** | Simulation + Accuracy (`refresh_fast.py`) |
| **Solo Simulation** | Solo foglio Simulation (evoluzione predizioni nel tempo; Accuracy invariata) |
| **Solo Accuracy** | Solo foglio Accuracy |
| **SEC K-8** | Solo foglio filing 8-K |
| **Domenica full** | Orchestrator completo (PowerShell) |
| **Dry-run** | Piano senza scrivere |

## Autosave / Excel

1. **Chiudi** `data\biotech_orchestrated_output.xlsx` in Excel prima del run.
2. Se il file è bloccato, il salvataggio va su `biotech_orchestrated_output__staged_<timestamp>.xlsx`.
3. Usa **Apri ultimo staged** per aprire l’output aggiornato.
4. In OneDrive: pausa sync sulla cartella `data` durante il refresh, se possibile.

## Log e stato

- Log in finestra app
- `data\refresh_fast_status.txt` — stato ultimo refresh giornaliero
- `data\last_refresh_desktop.log` — log processo desktop
- `data\last_orchestrator_log.txt` — log domenica full

## App unificata

`scripts\Avvia_Biotech_Desktop.bat` → tab **Refresh** (stessi pulsanti di questa app Tk).
