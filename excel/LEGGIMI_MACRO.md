# Refresh da Excel (macro + pannello)

Puoi lanciare i refresh in tre modi:

1. **SuperNova** (consigliato) — una volta `scripts\Installa_Refresh_Su_Desktop.bat` → collegamento **SuperNova** sul Desktop (vedi `refresh_desktop\README.md`)
2. **Pulsanti macro** — importa `BiotechRefreshMacros.bas` in **Personal.xlsb**
3. **Foglio «Pannello refresh»** — `py -3 scripts\write_excel_refresh_panel.py` + link VBS / macro
4. **Doppio clic** sui file `excel\Avvia_Refresh_*.vbs` (senza macro)

## Profili disponibili

| Pulsante / macro | Cosa fa | Tempo tipico |
|------------------|---------|--------------|
| **BiotechRefreshDaily** | Simulation + Accuracy, preserva Prezzo acquisto / Capitale | pochi min |
| **BiotechRefreshAccuracy** | Solo foglio Accuracy | pochi min |
| **BiotechRefreshSecK8** | Solo foglio SEC K-8 | 15–45 min |
| **BiotechRefreshSunday** | Orchestrator completo + SEC K-8 | 30–90+ min |

Alias: `BiotechRefreshFast` = `BiotechRefreshDaily` (compatibilità con macro vecchia).

## Installazione macro (una volta)

1. Excel → `Alt+F11` → **File → Importa file…** → `excel\BiotechRefreshMacros.bas`
2. Modifica se serve `PROJECT_ROOT` in cima al modulo (percorso progetto).
3. Salva **Personal.xlsb** (`Ctrl+S` nell’editor VBA).
4. Nel workbook: **Sviluppatore → Inserisci → Pulsante (moduli)**.
5. **Assegna macro** → menu **Macro in: PERSONAL.XLSB** → scegli es. `BiotechRefreshDaily`.

> Un file `.xlsx` **non** può contenere macro: il pulsante deve puntare a **PERSONAL.XLSB**, non a `biotech_orchestrated_output.xlsx!…`.

## Foglio «Pannello refresh» nel workbook

Con Excel **chiuso** sul file principale:

```powershell
cd "C:\coding\Biotech_Investment app 6"
py -3 scripts\write_excel_refresh_panel.py
```

Crea il foglio in prima posizione con tabella azioni + hyperlink ai VBS + nome macro da assegnare.

## Requisiti comuni

- Python (`py -3` o `.venv` come negli altri script).
- `data_orchestrator.py` completo (`py -3 scripts\check_orchestrator_health.py`).
- Per **giornaliero / Accuracy**: durante il run il workbook **biotech_orchestrated_output.xlsx** deve essere **chiuso** (la macro lo chiude se è quello aperto).
- Stato run: `data\refresh_fast_status.txt` (giornaliero e accuracy).

## Senza macro

```powershell
py -3 scripts\Run_Refresh_Profile_Silent.bat daily
py -3 scripts\Run_Refresh_Profile_Silent.bat accuracy
py -3 scripts\Run_Refresh_Profile_Silent.bat sec_k8
py -3 scripts\Run_Refresh_Profile_Silent.bat sunday
```

Oppure `scripts\Profilo_Giornaliero_Refresh.bat` (giornaliero).

## File legacy

- `RefreshFastMacro.bas` — sostituito da `BiotechRefreshMacros.bas` (puoi rimuoverlo da Personal.xlsb).
- `Avvia_Refresh_Fast.vbs` — usa ancora il batch vecchio; preferisci `Avvia_Refresh_Daily.vbs`.
