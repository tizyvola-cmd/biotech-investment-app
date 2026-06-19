# Ripristino `data_orchestrator.py` (file troncato)

Se `launch_refresh_fast.py` o la macro Excel falliscono con:

```text
cannot import name 'regenerate_simulation_sheet_quick' from 'data_orchestrator'
```

il file `data_orchestrator.py` ha perso la **coda** (~6.000 righe). Mancano tra l’altro:

- `regenerate_simulation_sheet_quick`
- `_run_simulation_sheet_into_workbook`
- `_write_accuracy_simulation_sheet`
- `main`

## Verifica

```powershell
cd "C:\coding\Biotech_Investment app 6"
py -3 scripts\check_orchestrator_health.py
```

Se vedi funzioni **MANCANTI**, ripristina il file prima di usare refresh fast o la macro.

## Ricerca locale (`find_orchestrator_backup.ps1`)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\find_orchestrator_backup.ps1
```

Serve una copia con **≥ 32.000 righe**. Esempio risultato senza copia completa:

| Percorso | Righe | Nota |
|----------|------:|------|
| `...\Biotech_Investment app 6\data_orchestrator.py` | ~27.886 | File attuale **troncato** |
| `C:\coding\backups\data_orchestrator.py` | ~21.165 | **Più vecchio/piccolo** — **non copiare** sul progetto |

Se compare **COPIA COMPLETA PROBABILE**, esegui il `Copy-Item` suggerito dallo script.

## Come ripristinare (scegli una)

### 1) Cronologia versioni OneDrive (se la cartella è sincronizzata con OneDrive)

1. Esplora file → `data_orchestrator.py` → tasto destro → **Cronologia versioni** / **Version history**.
2. Apri una versione **prima** del giorno in cui il refresh ha smesso di funzionare (file ~**34.000** righe, non ~27.887).
3. Ripristina o copia il contenuto sul file attuale.
4. Riesegui `py -3 scripts\check_orchestrator_health.py` finché tutto è OK.

### 1b) Versioni precedenti Windows (anche su `C:\coding` senza OneDrive)

1. Tasto destro su `data_orchestrator.py` → **Proprietà** → scheda **Versioni precedenti**.
2. Se c’è un elenco, apri una versione **più grande** (~1,4–1,8 MB, ~34k righe) → Ripristina.

### 2) Cronologia locale Cursor / VS Code

1. Apri `data_orchestrator.py` in Cursor.
2. **Timeline** / **Local History** (icona orologio o tasto destro sul file).
3. Ripristina una entry **prima** del troncamento (controlla dimensione o righe se visibili).

### 3) Backup / altra cartella del progetto

Cerca manualmente (zip, altro PC, cartelle vecchie):

- `%USERPROFILE%\OneDrive\Desktop\coding\Biotech_Investment app 5` (o `app 4`, `app 3`)
- `C:\coding\Biotech_Investment app 5`
- Download / backup zip del progetto

Copia **solo** `data_orchestrator.py` se ha **≥ 32.000 righe** (`check_orchestrator_health.py`).

### 4) Git (se il repo ha commit precedenti)

```powershell
git log -1 --oneline -- data_orchestrator.py
git checkout HEAD -- data_orchestrator.py
```

(adatta il commit se serve una versione specifica)

## Dopo il ripristino

```powershell
cd "C:\coding\Biotech_Investment app 6"
py -3 scripts\check_orchestrator_health.py
py -3 launch_refresh_fast.py
```

Poi puoi usare la macro Excel (`excel\LEGGIMI_MACRO.md`).
