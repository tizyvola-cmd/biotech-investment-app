# Parametri v4/v5 e foglio «Parametri — test»

Documento di design (utente) — progetto Biotech Investment App 6.  
Basato su: `prediction/`, `data_orchestrator.py`, `past_catalyst_predictions.json`, `accuracy_v4_v5.py`.

---

## Contesto architetturale

| Motore | Ruolo live | Moduli principali |
|--------|------------|-------------------|
| **v4** | Direzione (ensemble v4.1) + curva precatalitica (fit polinomio/esponenziale) + calibrazioni | `direction_ensemble.py`, `curve_fit.py`, post-hoc/mag-bucket/seq in orchestrator |
| **v5** | Fan Monte Carlo MRM+PCG; **q50** su foglio Accuracy/Simulation **sempre**, indipendentemente da `PRED_ENGINE` | `v5/mrm.py`, `v5/pcg.py`, `pipeline.predict_v5_q50_offsets` |

`PRED_ENGINE=v5` aggiunge `v5_curves` ma **non** sostituisce gli output v4. Le metriche condivise sono in `prediction/accuracy_v4_v5.py` (MAE in punti percentuali, hit direzionale con banda ±5 pp).

**Attenzione — tre «beta» distinti:** (1) beta di mercato 5Y (foglio Financial), (2) beta post-hoc OLS sulla curva (`real ≈ α + β·pred`), (3) eventuale blend seq 8-K (`ACC_K8_RECALIB_BETA`). Non vanno confusi nelle analisi.

---

## A) Inventario parametri

Legenda colonne: **Sorgente** = dove viene calcolato o caricato; **v4** / **v5** = uso nel motore; **Default** = valore se assente; **Flag** = variabile d’ambiente o toggle (on = attivo con default progetto).

### A.1 Segnali tecnici e opzioni (direction ensemble v4.1)

| Parametro | Sorgente | v4 | v5 | Default | Flag |
|-----------|----------|----|----|---------|------|
| `exc_slope` / `slope` | Yahoo 45d; slope vs XBI | Pesi bull/bear in `direction_ensemble` | `xbi_slope` in MRM (`exc_slope_vs_XBI`) | — | — |
| `rsi_val` (RSI-14) | Serie prezzi | Ipercomprato/ipervenduto | — | — | — |
| `vol_ratio` | vol 5d / vol 15d | Cap 2 pt nel net score | — | — | — |
| `vol_accel` | vol 5d / vol 5d precedente | Accelerazione volume | — | — | — |
| `slope_5d`, `slope_20d` | Multi-timeframe | Allineamento TF | `slope_20d` → regime MRM | 0 | — |
| `run_up` / `run_up_30d` | % da primo close in 30 sessioni | Contrarian + reversion curva | `classify_regime`, drift | 0 | — |
| `run_up_7d` | Variante 7 giorni | Drift/spike ensemble | — | — | — |
| `ath_prox` | Vicinanza massimo 52 sett. | Segnale ensemble | — | — | — |
| `vol_px_div` | Divergenza prezzo/volume | ±1 pt | — | 0 | — |
| `pcr` (put/call) | Opzioni | Segnale direzione | — | — | `PRED_REQUIRE_OPTIONS` (errore se manca) |
| `exp_move_pct` | Opzioni (expected move) | Priced-in, giorni a T | Ancora CD in v5 (`cd_anchor_pct`) | — | — |
| `days_to_t` | Calendario | Penalità «già prezzato» | — | — | — |
| `phase` / `ph_num` | Simulation / NCT | Soglie net Fase 2 (0.75× score, net 4/5) | Metadati | — | `CLINICAL_PRED_OVERLAY` (overlay opzionale) |
| `direction_calib_multiplier` | `pred_calibration.json` → `ok_v4` | Confidence finale | — | 1.0 | — |
| Penalità confidence | Calcolate | mixed 0.72; no options 0.88; no price 0.35; Ph2 0.92 | — | — | — |
| Soglie net `_NET_MILD` / `_NET_STRONG` | Costanti | 3 / 4 (Ph2: 4 / 5) | — | 3, 4 | — |

### A.2 Curva precatalitica (fit + aggiustamenti v4)

| Parametro | Sorgente | v4 | v5 | Default | Flag |
|-----------|----------|----|----|---------|------|
| Coppie minime fit | `curve_fit` | ≥3 punti; grado 2 se ≥6; exp se ≥5 | — | 3 | — |
| Finestra fit | Coppie vs oggi | dx ∈ [-130, 0] | — | — | — |
| Nodi orizzonte | `days_to_t` + offset | `model_dm*`, `model_d*` | — | — | — |
| Cap curva `_cap` | Post-fit orchestrator | ±25% su tutti i nodi | — | ±25% | — |
| Reversion run-up `_rev` | `run_up`, giorni a T | `min(0.6, run_up/40)` (+0.15 se T≤14d) se run_up>5 | — | — | — |
| `calib_bias` d3/d5/d10/d30 | `calibration.calib_bias()` | Bias per orizzonte se n≥5 | — | 0 | `PRED_POSTHOC_REPLACE_BIAS` (sostituisce bias) |
| Post-hoc α, β | OLS su coppie (pred, actual) | `α + β·pred` per d3,d5,d10,d30 | — | α=0, β=1 | `PRED_POSTHOC_REG` (on) |
| Clamp post-hoc | `config` | β ∈ [0.25, 2], \|α\|≤20 | — | vedi config | `PRED_POSTHOC_BETA_MIN/MAX`, `PRED_POSTHOC_ALPHA_ABS_MAX` |
| `PRED_POSTHOC_MIN_N` | env | Coppie minime per fit | — | 8 | — |
| Mag-bucket | Bande \|pred\| 0–2, 2–5, 5–10, ≥10 pp | Affine per bucket | — | — | `PRED_MAG_BUCKET` (on); `PRED_MAG_BUCKET_MIN_N`=4 |
| Ordine mag vs post-hoc | env | Dopo post-hoc se entrambi on | — | dopo | `PRED_MAG_BUCKET_AFTER_POSTHOC` |
| Allineamento dir↔curva | `_align` inline | scale 0.35/0.4/0.7 | — | ε=0.5 pp | `PRED_CURVE_ALIGN_EPSILON`, `PRED_CURVE_ALIGN_MODE` (hybrid) |
| `cal_factor_v4` | `model_calibration_state.json` | Moltiplicatore affidabilità | — | 1.0 | `CALIB_REFRESH_DAYS`=30; `FORCE_CALIB_REFRESH` |
| R² fit (qualità) | Output fit | Diagnostica / stars | — | — | — |
| `seq_curve_pct_vs_m60` | `seq_calib` + 8-K | Pred v4 su Accuracy (CD≥oggi) | — | — | `PRED_CURVE_SEQ_CALIB` (on); `ORCH_SKIP_SEC_K8` (off) |
| Offset seq | `SIMULATION_PRED_CAL_OFFSETS` | -60,-30,-10,-7,-5,-3,4,7 | v5: senza -5 | — | — |
| `liquidity_score` | `financial_liquidity` (CR, QR, cash) | **Hook previsto** shrink curva | Solo metadata v5 | 1.0 se manca | `PRED_CURVE_FY_LIQ` (off; **non ancora applicato** in orchestrator) |
| `beta` (mercato 5Y) | Financial / Yahoo | Colonne display; seq hook opzionale | Solo metadata v5 | — | `ACC_K8_RECALIB_BETA`, `ACC_K8_BETA_FUTURE_ONLY` |

### A.3 Regime e simulazione v5 (MRM + PCG)

| Parametro | Sorgente | v4 | v5 | Default | Flag |
|-----------|----------|----|----|---------|------|
| `vol_20d` | Log-return 20d (non `vol_ratio`) | — | Regime high_vol / σ | 0.02 | — |
| Regime **high_vol** | `mrm.classify_regime` | — | vol≥0.045 o (vol≥0.035 e \|run_up\|≥25) | — | — |
| Regime **mean_revert** | MRM | — | run_up≥18 e slope≤0.05 | — | — |
| Regime **trend** | MRM | — | drift = slope×0.0012 + xbi×0.0004 | — | — |
| `sigma_per_day` | MRM | — | max(0.012, vol×0.85) in trend | — | — |
| `n_paths` | `predict_v5_q50_offsets` | — | Monte Carlo | 2000 | — |
| `seed` | argomento | — | Riproducibilità | None | — |
| `prior_weight` | costante PCG | — | Blend verso μ coorte | 0.22 | — |
| `anchor_weight` | costante PCG | — | Ancoraggio a CD | 0.35 | — |
| `cd_anchor_pct` | `exp_move_pct` o `model_d5_pct` | — | Ancora distribuzione | None | — |
| Quantili fan | PCG | — | q05, q50, q95 per nodo | — | — |
| `PRED_ENGINE` | env | Path principale v4 | Opz. `v5_curves` | v4 | `PRED_ENGINE` |
| `V4_ADAPTIVE` | `model_v4_adaptive.json` | Neutralizza bucket direzione deboli | — | off | `V4_ADAPTIVE`, `V4_ADAPTIVE_BAD_ACCURACY`=0.42, `V4_ADAPTIVE_MIN_BUCKET_N`=35 |

### A.4 Metriche e storage

| Elemento | Dove | Note |
|----------|------|------|
| Orizzonti Accuracy v4 | `ACCURACY_V4_DISPLAY_OFFSETS` | T−60, T−30, T−10, T−7, **T−5**, T−3, T+4, T+7 (8 colonne) |
| Orizzonti v5 q50 | `SIMULATION_V5_Q50_OFFSETS` | Stessi **senza T−5** (7 colonne) |
| MAE | `accuracy_v4_v5.py` | Media \|pred − storico\| in pp; aggregazione per trimestre completamento |
| Hit direzione | stesso modulo | Stesso segno; banda stabile ±5 pp |
| Backtest CLI | `tools/backtest_v4_baseline.py` | Passati: hit vs d3/d5, Brier, MAE T−30/T−7/CD+4/CD+7 |
| JSON storico | `data/past_catalyst_predictions.json` | Chiave `TICKER\|YYYY-MM-DD`; v5: `v5_q50_offsets` quando presente |

---

## B) Impatto sull’accuratezza — ipotesi e misura

### B.1 Ipotesi qualitative (impatto atteso sul MAE)

| Priorità | Parametro / blocco | Ipotesi | Perché |
|----------|-------------------|---------|--------|
| **Alta** | Post-hoc α, β + mag-bucket | Riduce MAE globale su d3–d30 | Calibrati esplicitamente su (pred, actual) storici |
| **Alta** | `seq_curve_pct_vs_m60` | Migliora nodi pre-CD su catalyst futuri | Ancora la curva a osservazioni sequenziali / 8-K |
| **Alta** | `exp_move_pct` / ancora v5 | Influenza q50 vicino a T (v5) | `anchor_weight`=0.35 in PCG |
| **Media** | `run_up` + reversion curva | Riduce over-shoot dopo rally | Shrink esplicito post-fit |
| **Media** | Allineamento dir↔curva | Riduce incoerenza (↑ pred, ↓ realtà) | Non sempre MAE, ma errori «strutturali» |
| **Media** | Regime MRM (`vol_20d`, `run_up_30d`, `slope_20d`) | Spiega varianza tra titoli volatili vs trend | v5 separato da v4 |
| **Media-bassa** | `vol_ratio`, `vol_accel`, RSI | Più impatto su **hit direzione** che su MAE curva | Ensemble non trasferisce linearmente sulla curva |
| **Media-bassa** | `pcr`, `phase` | Stratificazione per fase e liquidità opzioni | Fase 2 storica ~70% fail (commento codice) |
| **Bassa (oggi)** | `beta` mercato, `liquidity_score` | Quasi nullo su q50 v5 | Solo metadata; `PRED_CURVE_FY_LIQ` non wired |
| **Da verificare** | `PRED_CURVE_FY_LIQ` | Potenziale riduzione MAE su small-cap illiquide | Hook `apply_liquidity_risk_shrink` esiste ma non chiamato |

### B.2 Come misurare

1. **MAE per orizzonte** — già definito in `accuracy_v4_v5.py`; estendere al foglio Test con ΔMAE = MAE_v5 − MAE_v4 per riga e media per bucket.
2. **Correlazione parametro ↔ errore** — per ogni catalyst completato: Pearson/Spearman tra `|Err v4|` (o v5) e snapshot (`vol_ratio`, `run_up_30d`, `liquidity_score`, `R² fit`, …). Attenzione: correlazione ≠ causalità.
3. **Stratificazione** — MAE media per:
   - quartile `beta` (mercato);
   - terzile `liquidity_score`;
   - bucket `|pred|` (0–2, 2–5, … pp);
   - fase clinica (1/2/3);
   - regime MRM (high_vol / mean_revert / trend);
   - presenza opzioni (sì/no `exp_move_pct`).
4. **A/B su flag** — confrontare run orchestrator con `PRED_POSTHOC_REG=0/1`, `PRED_CURVE_SEQ_CALIB=0/1`, ecc. su **stesso** set di righe frozen (snapshot JSON).
5. **Backtest rapido** — `python tools/backtest_v4_baseline.py` per baseline v4 passati; integrare colonne v5 da `v5_q50_offsets` nello script Test.

### B.3 Metriche secondarie utili

- **Hit direzione** (±5 pp) per valutare ensemble vs curva.
- **Brier** (backtest) se si esporta `direction_confidence` / `score_v4`.
- **Incoerenza** (↑ pred, movimento CD < 0) — `backtest_v4_baseline.py`.
- **Coverage** — % righe con pred non nulla per orizzonte (dati scarsi).

---

## C) Proposta foglio «Parametri — test»

### C.1 Scopo

Un foglio (o CSV equivalente) **una riga per catalyst** (passati con outcome + futuri con predizione), per:
- vedere tutti gli input al momento della predizione;
- confrontare errori v4 vs v5 sulle stesse date calendario;
- analizzare quali parametri spiegano gli errori grandi.

### C.2 Universo righe

| Fonte | Criterio inclusione |
|-------|---------------------|
| `past_catalyst_predictions.json` | `completion_date` passata + record «completo» (`dir_v4`, d5/d10, nodi modello, close) |
| Simulation / merge Accuracy | Catalyst futuri (CD ≥ oggi) con pred v4 e v5 calcolati |
| Esclusi opzionale | `non_quotata_al_tempo`, `dati_scarsi`, `pred_dataset_incomplete` (flag in colonna) |

Chiave riga: `TICKER|YYYY-MM-DD` (allineata al JSON).

### C.3 Gruppi colonne

**1. Identità**  
`ticker`, `completion_date`, `phase`, `sponsor_match`, `row_key`, `completion_quarter`, flag qualità dati.

**2. Snapshot parametri (al momento pred)**  
Tutti i campi tecnici/opzioni/finanziari: `rsi_14`, `vol_ratio`, `vol_accel`, `slope_5d`, `slope_20d`, `run_up_30d`, `run_up_7d`, `exc_slope_vs_XBI`, `pcr`, `exp_move_pct`, `beta`, `current_ratio`, `quick_ratio`, `cash_ratio`, `liquidity_score`, `vol_20d`, regime MRM (derivato), `direction`, `score_v4`, `affidabilita`, flag attivi al run (`posthoc_on`, `seq_calib_on`, …).

**3. Qualità fit v4**  
R² (se disponibile), tipo fit (poly2/exp), `struct_*` se presenti, `cal_factor_v4`, α/β post-hoc applicati per orizzonte (da `model_calibration_state` o snapshot nel record).

**4. Predizioni e storico per orizzonte** (8 colonne v4, 7 v5)  
Per ogni offset: `Pred v4 %`, `Pred v5 q50 %`, `Storico %`, `Err v4`, `Err v5`, `|Δ| v4`, `|Δ| v5`, `Hit v4`, `Hit v5`.

**5. Sintesi riga**  
`MAE_v4_mean`, `MAE_v5_mean` (solo orizzonti con storico), `ΔMAE_v5_minus_v4`, `n_horizons_valid`.

**6. Note manuali (preservate)**  
Colonne `note_utente`, `review_flag` — **mai sovrascritte** dal refresh automatico: merge per chiave riga, scrittura solo su colonne calcolate.

### C.4 Sezione pivot opzionale (stesso foglio o foglio «Test — riepilogo»)

| Bucket | Metriche |
|--------|----------|
| Quartile beta 5Y | MAE medio v4/v5, ΔMAE, n |
| Terzile liquidity_score | idem |
| Fase clinica | idem + hit direzione |
| Regime MRM | idem |
| Presenza `exp_move_pct` | idem |

### C.5 Dati e refresh

| Aspetto | Proposta |
|---------|----------|
| **Sorgente primaria** | Ricostruzione da `past_catalyst_predictions.json` + cache live orchestrator / righe merge Accuracy (`_sim_rows_merged_for_accuracy_sheet`) |
| **Script** | `tools/build_param_test_sheet.py` (stub presente) → CSV Week 1; append foglio Excel Week 2 |
| **Refresh standalone** | `python tools/build_param_test_sheet.py --out data/param_test_export.csv` |
| **Hook orchestrator** | Dopo `write_accuracy_*` o `save_final_outputs`, se `PARAM_TEST_SHEET=1` |
| **JSON derivato opzionale** | `data/param_test_rows.json` per dashboard senza Excel |
| **Note manuali** | Leggere colonne esistenti da workbook; merge `{row_key: {note_utente: ...}}` prima del write |

### C.6 Allineamento con foglio Accuracy esistente

Il foglio **Accuracy** già espone griglia 8× pred/storico/Δ. Il foglio **Test** è **long/wide per analisi parametrica**: molte colonne di input, una riga per catalyst, errori pre-calcolati, adatto a filtri e pivot Excel — non duplicare la griglia visuale del Accuracy.

---

## D) Implementazione per fasi

### Settimana 1 — MVP export
- Definire schema colonne (§C.3 gruppi 1–5).
- Implementare `build_param_test_sheet.py`: load JSON + merge accuracy helpers da `accuracy_v4_v5`.
- Output CSV + documentazione colonne in riga 1.
- Validazione: N righe ≈ righe Accuracy «strict»; spot-check 5 ticker su MAE manuale.

### Settimana 2 — Analisi per bucket
- Foglio riepilogo pivot (§C.4) generato dallo stesso script (`--summary`).
- Grafici opzionali (non in scope Excel): export per fase/quartile beta.
- Colonne regime MRM e flag env usati al run.

### Settimana 3 — Sensibilità A/B
- Tabella run ID + env snapshot (`prediction.config` dump).
- Confronto MAE tra due export con flag diversi (stesso universo righe).
- Documentare esiti in `data/param_test_ab_results.json`.

---

## E) Cosa NON fare

1. **Non sostituire** il foglio Accuracy o il flusso live v4 con il foglio Test — è analitico, non operativo.
2. **Non sovrascrivere** note manuali o colonne revisione utente al refresh.
3. **Non confondere** i tre tipi di «beta» nelle colonne e nei pivot.
4. **Non attivare** `PRED_CURVE_FY_LIQ=1` in produzione finché l’hook non è collegato in orchestrator (rischio aspettativa senza effetto reale).
5. **Non usare** `vol_ratio` al posto di `vol_20d` per analisi v5 (il pipeline lo esclude esplicitamente).
6. **Non implementare** subito PCG full fan su Excel — il Test usa **q50** come Accuracy, salvo richiesta esplicita di q05/q95.
7. **Non fare commit automatici** di export CSV/JSON grandi in git — solo script e schema.
8. **Non duplicare** tutta la logica seq/post-hoc nello script: **leggere** snapshot già salvati nel JSON o nello stato calibrazione.
9. **Non promettere** causalità da correlazioni parametro-errore senza A/B o hold-out temporale.
10. **Non migrare** v5 a motore unico senza decisione prodotto — `PRED_ENGINE` resta v4 di default.

---

## Riferimenti codice

| Argomento | Percorso |
|-----------|----------|
| Config / flag | `prediction/config.py` |
| Ensemble v4.1 | `prediction/direction_ensemble.py` |
| Fit curva | `prediction/curve_fit.py` |
| Seq calib | `prediction/seq_calib.py` |
| MRM / PCG | `prediction/v5/mrm.py`, `pcg.py` |
| q50 API | `prediction/pipeline.py` |
| Metriche | `prediction/accuracy_v4_v5.py` |
| Backtest | `tools/backtest_v4_baseline.py` |
| JSON passati | `past_pred_io.py`, `data/past_catalyst_predictions.json` |
| Stub export | `tools/build_param_test_sheet.py` |

---

*Versione documento: 2026-05-19 — design only, implementazione foglio Excel Week 2+.*
