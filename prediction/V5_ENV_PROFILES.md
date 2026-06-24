# Profili env v5

## 1. Riga «v5 raw» su Accuratezza temporale

Dopo ogni refresh Accuracy, il foglio **Accuratezza temporale** mostra per run:

| Riga | Significato |
|------|-------------|
| **v4** | Curva Pred % (display) vs Storico |
| **v5** | q50 con anchor v4 + sync su Pred % (default produzione) |
| **v5 raw** | q50 MRM+PCG **senza** anchor (`anchor_q50_v4=False`) |

Disattivare il calcolo (più veloce): `ACCURACY_V5_RAW_METRICS=0`

## 2. Profilo evaluation (confronto reale v5 vs v4)

```powershell
cd "C:\coding\Biotech_Investment app 6"
.\scripts\Load-V5Profile.ps1 -Profile evaluation -RunAccuracyRefresh
```

Oppure: `scripts\Avvia_Refresh_V5_Evaluation.bat` (Excel chiuso).

- `PRED_V5_ANCHOR_Q50_V4=0` — v5 non copia v4
- `PRED_V5_SIM_DISPLAY=v5` — Simulation usa v5
- `PRED_V5_EXCEL_FAN=0` — foglio Accuracy: **8 colonne q50** (default; q05/q95 solo in JSON / Grafici)

## 3. Profilo production (comportamento attuale)

```powershell
.\scripts\Load-V5Profile.ps1 -Profile production -RunAccuracyRefresh
```

Oppure: `scripts\Avvia_Refresh_V5_Production.bat`

- Anchor + sync → MAE v4 ≈ v5 sulla riga **v5**
- Confronta con **v5 raw** per vedere se il motore MRM+PCG migliora da solo

## 4. Caricare env senza refresh

```powershell
Get-Content config\profiles\v5_evaluation.env | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $n,$v = $_ -split '=',2; Set-Item -Path "Env:$n" -Value $v.Trim()
}
py -3 refresh_accuracy_modello.py
```

## Note

- **v5 raw** su ~3000 righe passate aggiunge tempo (Monte Carlo, default 800 path: `ACCURACY_V5_RAW_N_PATHS`).
- Dopo il refresh, controlla `data\accuracy_v4_v5_summary.json` → chiave `total.v5_raw`.
