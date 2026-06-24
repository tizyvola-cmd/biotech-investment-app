# Recap integrazione Pred / 8-K / refresh (2026-05)

## Regola display Simulation (Δ% Pred)

| Situazione | Cosa mostra la cella Pred |
|------------|---------------------------|
| Nodo calendario **già passato** (close HistLib / seq ricalibrata / K-8) | **Dato storico** (si aggiorna a ogni refresh) |
| Nodo **futuro** o senza storico | **Modello v4** interpolato |
| Post-CD **non ancora** realizzato (es. T+4 futuro) | **Modello** (no plateau seq); default `SIMULATION_POST_CD_MODEL_DISPLAY=1` |
| Post-CD **già** realizzato | **Storico** (come gli altri nodi) |

Implementazione: `merge_pred_display_historical_and_model` in `prediction/live_recalib_sheet.py`, chiamata da `sheet_pred_pct_points` / `finalize_simulation_pred_display`.

Non tutti i nodi pre-CD hanno storico: è normale; i gap restano su modello finché il calendario o un filing 8-K non riempie il nodo.

---

## Passo 1 — Mercato reale pre-CD (senza cambiare il modello v4)

- **`PRED_CURVE_SEQ_CALIB=1`** (default): la curva sequenziale aggiorna i nodi con close Yahoo/HistLib man mano che il calendario avanza.
- **`refresh_fast.py`**: su refresh normale (senza `--no-live-sim-pred`) imposta **`ACCURACY_REFRESH_FAST=0`** e **`ACC_SIM_BULK_PAST_WRITE=0`** così Accuracy/Simulation arricchiscono Storico % e `seq_curve` sul JSON (non solo modello piatto).
- **Simulation / Accuracy (CD ≥ oggi)**: `sheet_pred_pct_points` → `live_recalib_pct_vs_m60_from_pairwise` (close reali + extrap modello sui nodi futuri).

## Passo 2 — Alleggerire compressione v4 pre-CD (nel codice)

| Env | Default | Effetto |
|-----|---------|---------|
| `PRED_FUNDAMENTAL_SHRINK` | 1 | Shrink FY/beta solo **post-CD** |
| `PRED_FUNDAMENTAL_SHRINK_PRECD` | 0 | Shrink anche `model_dm*` se `1` |
| `PRED_V4_CURVE_SCALE_PRECD` | **1.05** | Scala solo `model_dm*` |
| `PRED_V4_CURVE_SCALE` | 1.0 | Post-CD |
| `PRED_DAMP_DM60_EXTRAP` | 0 | Damp dm60 disattivo |
| `PRED_CAP_ABS_PP_PRECD` | 35 | Cap pre-CD (post = 25) |

Legacy: `PRED_V4_CURVE_SCALE=1.08` senza `PRED_V4_CURVE_SCALE_PRECD` scala tutti gli orizzonti.

## Passo 3 — Codice

- **Sell-the-news** solo post-CD.
- **`PRED_CURVE_APPLY_CAL_FACTOR=1`**: `cal_factor` v4 sulla curva **modello** in `_interp_pred_pct_vs_m60_calendar` (non sui close seq reali).
- **Damp dm60** off di default; cap pre/post separati.
- **Overlay 8-K**: `PRED_K8_DISPLAY_OVERLAY`.

---

## SEC K-8 — 6 mesi + A / B / C

### Config (`prediction/config.py`)

| Env | Default | Effetto |
|-----|---------|---------|
| `SEC_K8_LOOKBACK_DAYS` | **180** | Finestra **[CD−N, CD]** per foglio SEC K-8, merge seq, nodi display |
| `PRED_K8_DISPLAY_OVERLAY` | **1** | Interpolazione lineare 8-K sulla curva Pred |
| `ORCH_SKIP_SEC_K8` | off | Disabilita merge 8-K in seq |

### A) Finestra allargata

- Foglio **«SEC K-8»**: riscritto con `SEC_K8_LOOKBACK_DAYS` (default 6 mesi).
- **`_pred_curve_seq_merge_k8_observations_into_act`**: stessa finestra per riempire nodi seq senza close.
- Colonna Simulation: **`N° K-8 [CD−finestra SEC]`** (N da env).

### B) Nodi filing + movimento

- **`k8_recalib_knots_from_workbook`**: per ogni filing, nodo a **offset calendario = data filing − CD** con **% vs T−60** (`k8_pct_vs_m60_at_calendar_offset` + HistLib).
- Sedute +1/+2/+3 restano nodi aggiuntivi (trade date).
- **`_sec_k8_points_from_index_entries`**: punto «K-8 filing» in Grafici/ristretta.

### C) 8-K anche per CD ≥ oggi

- **`sheet_pred_pct_points`** (corrente): dopo live HistLib, **`k8_interp_pct_points_in_knot_range`** — mantiene close live, interpola 8-K sui gap.
- **Simulation**: passa `wb` a `sheet_pred_pct_points` (stesso overlay se abilitato).
- **Accuracy storico**: invariato (`past_accuracy_k8_recalib_pct_points`).

---

## Refresh rapido

```powershell
# Excel chiuso, dalla root progetto
py -3 refresh_fast.py
```

Env già impostati da `refresh_fast.py` (Passo 1 + 8-K). Per orchestrator completo + SEC K-8 sheet:

```powershell
py -3 data_orchestrator.py
```

---

## Verifica

1. Foglio **SEC K-8**: più righe per ticker/CD (filing fino a 180 gg prima del CD).
2. **Accuracy** sopra linea viola: Pred non tutta a ~0% se ci sono 8-K o close pre-CD.
3. JSON: quota `seq_curve` / `close_m60` in crescita dopo refresh non-FAST.

---

## File toccati

- `prediction/config.py` — 8-K, Passo 2/3 env
- `prediction/fundamental_shrink.py`, `prediction/curve_display.py`, `prediction/extrap_safeguards.py`
- `prediction/live_recalib_sheet.py` — nodi filing, overlay, CD≥oggi
- `data_orchestrator.py` — lookback 180, sell-the-news post-CD, merge K8, sheet SEC K-8
- `refresh_fast.py` — default Passo 1
- `prediction/seq_calib.py` — lookback merge
- `tests/prediction_core/test_*_k8*.py` — header Simulation
