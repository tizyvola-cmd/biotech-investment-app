# RISK_ON regime multiplier — diagnosi + fix

## Causa radice (3 bug che si compongono)

1. **Funnel di etichettatura** — `regime_calibration.get_regime_at_date()` ignorava la data e
   restituiva sempre il regime *corrente*. Tutti gli outcome storici venivano quindi attribuiti
   al regime di oggi: 33/34 finiti in RISK_ON, mentre NEUTRAL/RISK_OFF restavano sotto la soglia
   di 8 campioni (`insufficient_data` → 1.0). Per questo si muoveva solo RISK_ON.

2. **Cliff sul campione** — `resolve_regime_outcomes_for_learning()` *commutava* la fonte dati
   (intero pool ~5500 → solo lo store dedicato) appena lo store superava 8 campioni, collassando
   la popolazione di valutazione su un sottoinsieme minuscolo e distorto. Da qui il crollo
   `n_regime` 5500→34 e il salto di MAE del 23/06.

3. **Formula dimensionalmente errata** — `multiplier = clip(1 - bias/12, 0.7, 1.3)` trasformava un
   bias *additivo* (pp) in un fattore *moltiplicativo* con divisore arbitrario `/12`.

## Impatto misurato (Fase 1, sui 33 outcome RISK_ON reali)

| | multiplier | MAE | direction |
|---|---|---|---|
| baseline (×1.0) | 1.0 | **8.224** | 39.4% |
| buggy | 1.244 | **8.866** (+0.64) | 39.4% |
| **fix** | **1.0** | **8.224** (= baseline) | 39.4% |

Il moltiplicatore amplificava un campione in cui il modello sbaglia direzione il 60% delle volte:
su previsioni col segno sbagliato, aumentare la magnitudine peggiora l'errore (bias da −2.93 → −3.04).
La regressione least-squares ottimale su quel campione è negativa (m\*=−0.46): la cosa giusta è
ridurre/azzerare, non amplificare.

`learning_history.json` conferma l'inflessione:

| settimana | n_regime | mae_before_regime | mae_after_regime | RISK_ON × |
|---|---|---|---|---|
| 15/06 | 5494 | 7.24 | 7.22 | 1.0 |
| 18/06 | 5500 | 7.21 | 7.19 | 0.982 |
| 23/06 | 34 | 7.84 | 8.39 | 1.244 |

## Fix (Fase 3)

`prediction/regime_calibration.py`:
- **`get_regime_at_date()`**: oggi → regime live; date passate → lookup in `regime_history.json`
  (seedato da `market_context.history_7d`); sconosciute → `UNKNOWN` (escluse, mai il regime corrente).
- **`record_daily_regime()`** + hook in `market_context_gate.run()`: accumula un regime/giorno così
  l'attribuzione storica diventa corretta andando avanti.
- **`resolve_regime_outcomes_for_learning()`**: unione (dedup) delle due fonti invece della commutazione
  → niente più cliff.
- **`_solve_regime_multiplier()`** sostituisce `1 - bias/12`:
  - scalare ottimo least-squares `m = Σ(pred·actual)/Σ(pred²)`, clippato a [0.7, 1.3];
  - **guardia di direzione**: se la direction accuracy del campione < 50% → resta 1.0
    (`direction_unreliable`): non si amplifica mai un campione direzionalmente rotto;
  - **guardia di miglioramento**: si applica solo se riduce davvero la MAE in-sample, altrimenti 1.0
    (`no_improvement`).

## Circuit breaker generale (Fase 2)

`prediction/calibration_circuit_breaker.py` — `evaluate_circuit_breaker(...)`, riusabile per QUALSIASI
fattore di calibrazione (regime, cluster cal_factor, ...). Blocca l'aggiornamento e congela all'ultimo
valore "buono" (emettendo un flag visibile `circuit_breaker`) quando **entrambe**:
- il valore si muove nella stessa direzione, allontanandosi da 1.0, per `CB_CONSECUTIVE_MOVES`
  aggiornamenti consecutivi (default 3), **e**
- le metriche peggiorano nello stesso periodo: `mae_after > mae_baseline + CB_MAE_DEGRADE_PP` (default 0)
  per gli ultimi `CB_DEGRADE_WINDOW` aggiornamenti (default 2).

Tutte le soglie sono costanti di modulo override-abili via env (`CB_CONSECUTIVE_MOVES`,
`CB_DEGRADE_WINDOW`, `CB_MAE_DEGRADE_PP`). Cablato in `compute_regime_multipliers` via
`_circuit_breaker_for_regime`.

## Note disciplina
- Il meccanismo **non** è disattivato: con un campione sano e direzionalmente affidabile applica una
  correzione least-squares che riduce davvero la MAE (test `test_solver_scales_and_reduces_error_on_healthy_sample`).
- I valori storici **non** sono riscritti silenziosamente: le etichette contaminate restano nello store,
  ma le guardie le neutralizzano (→ 1.0). L'attribuzione corretta arriva andando avanti via
  `record_daily_regime`.

## Correzioni aggiuntive (richieste dopo la consegna iniziale)

### #1 — Indagine segno/direzione del modello → NESSUN bug di segno
Verificato sul pool reale (`past_catalyst_predictions.json`): su **1851 outcome eligible** (6200 risolti)
la direction accuracy è **~51%** con correlazione **positiva** (+0.05), MAE ~6.4%. Il modello **non** è
direzionalmente rotto. Il <50% delle dashboard era un **artefatto di campione piccolo**: il
`resolve_regime_outcomes_for_learning` buggato usava solo le 34 righe dello scatter regime (campione
minuscolo e rumoroso, dir 41%) invece del pool grande. → Nessun fix di segno necessario.

### #2 — `REGIME_MIN_SAMPLES` 8 → 30
Un campione da 8 è dominato dal rumore (vedi #1). Alzato a 30, override via env `REGIME_MIN_SAMPLES`.

### #3 — Builder backfill `regime_history.json` (`prediction/backfill_regime_history.py`)
Riproduce lo **stesso** classificatore deterministico (`classify_regime`, stesse soglie) sui prezzi
storici XBI/TLT/VIX per ricostruire il regime di ogni giorno passato. **Non sovrascrive** i giorni già
registrati (default; `--overwrite` per ricostruire). CLI:
`python -m prediction.backfill_regime_history`.

### #4 — Circuit breaker esteso al cluster cal_factor
`compute_cluster_cal_factors` ora chiama `_circuit_breaker_for_cluster` (stesso
`evaluate_circuit_breaker` generale): se un cluster deriva monotonicamente mentre `mae_after_cluster`
supera la baseline, viene congelato all'ultimo valore buono con flag `circuit_breaker` e
`status="frozen_circuit_breaker"`.

### #5 — Formula cluster cal_factor: stesso fix del regime
La formula `current_cal × (1 − bias/10)` (correzione moltiplicativa di un bias additivo,
**accumulata** sul valore precedente ad ogni ciclo → derivava monotonicamente fino al clip) è
sostituita da `_solve_cluster_cal_factor`: scaling **least-squares** ricalcolato da zero ogni ciclo,
con **guardia di direzione** e **guardia di miglioramento**. Caso reale `phase2_oncology`
(n=1984, dir 0.500, m\* ≈ −0.06): la vecchia formula saliva al ceiling 1.3 (MAE 7.42 → **7.75**,
peggiorava); il solver trova che l'ottimo è ≤ floor e applica 0.7 **solo perché riduce la MAE**
(7.42 → **7.15**). Cioè la risposta corretta per un cohort che sovrastima/senza direzionalità è
**ridurre**, non amplificare.

## Audit tabella "All learning loops — effectiveness" (display/verdetto)
Questi problemi sono nel layer di **visualizzazione/verdetto** (`learning_lab.build_effectiveness_delta`),
non nella calibrazione: la dashboard raccontava una storia fuorviante.

### #6 — before/after disallineati nel tempo (bug principale)
Per Global/Cluster/Regime il Δ confrontava `mae_after` **live di questa settimana** con `mae_*_before`
della **settimana precedente** (`hist_prev`), mescolando l'effetto isolato del layer con la deriva
settimana-su-settimana del pool. `_verdict` segna `not_helping` appena Δ>0 → falsi "Not helping"
(è la causa delle oscillazioni Regime "Not helping +1.2" → "Improving −0.7" viste in sessione).
**Fix:** usare la coppia **dello stesso snapshot** (`mae_before_X`/`mae_after_X`, già presenti in `live`)
così il Δ = effetto isolato del layer sul pool corrente. Effetti reali misurati: Global ≈ 0.0, Cluster
−0.07, Regime −0.02 (tutti `neutral`, onesti).

### #7 — Pre-CD signal hit rate giudicato su campioni minuscoli
Confrontava due settimane consecutive (n=10 vs n=23). **Fix:** valutare il cohort consolidato `useful`
(n=34) contro una baseline casuale 50%, `min_n` 10→30. Niente più rumore settimanale.

### #8 — pulizia verdetto
Rimosso ramo morto `(dir_delta_pp or 0)/100 if dir_delta_pp else None` → `dir_delta_pp/100 if not None`.

### #9 — EIS Super Score: efficacia misurata con una metrica cieca allo scaling (bug strutturale)
Confermato con `eis_super_score_learning.json`: `mean_lift_7d = 0.0` in **tutte** le 9 entry e
`corr_super == corr_raw` sempre. Causa matematica: lo super score è `super = raw × K` con
`K = blend·cal + (1−blend)` **costante positiva per bin** (`compute_super_score`), e l'efficacia
era la **correlazione di Pearson**, che è **invariante allo scaling positivo** → `ρ(super)=ρ(raw)`
per costruzione, lift ≡ 0 qualunque sia il cal_factor. La riga era **morta per design**.
**Fix:** aggiunta una metrica **sensibile alla magnitudine** — MAE di `|score|` vs `|ΔP|`, raw vs
super (`mae_raw_7d`/`mae_super_7d`/`mae_lift_7d` in `build_correlation_timeline` ed effectiveness).
La riga in dashboard ora usa `mae_before=mean_mae_raw_7d` / `mae_after=mean_mae_super_7d` dello
**stesso snapshot** (effetto isolato) e il verdetto MAE-based, non più quello di correlazione.
Inoltre dedup dello snapshot **stesso-giorno** (prima appendeva doppioni → Δ week-over-week = 0).

### #10 — CD pattern polygon: confronto giorno-su-giorno invece di settimana
La storia dedup-a già i doppioni dello stesso giorno, ma il campo `week` usa in realtà `_today_iso()`
(snapshot **giornaliero**): la tabella confrontava due giorni adiacenti, dove la correlazione non si
muove (0.1735 → 0.1735) → "Neutral" perenne. **Fix:** `_week_over_week_baseline()` sceglie lo
snapshot più recente di **≥7 giorni** prima dell'ultimo; senza una settimana di storia mostra
"collecting" onesto invece di un falso 0.0.

### #11 — Validation feedback loop "Collecting data": loop mai eseguito in scrittura + errori silenziati
Confermato: `feedback_summary.json` / `feedback_history.json` **non esistevano**. I nomi sono corretti
(writer e reader coincidono). Cause: (a) il loop girava **solo** da `post_refresh_steps` con un gate
**di domenica**, e (b) lì gli errori erano **inghiottiti** (`log.warning(... non-fatal)`), quindi se
falliva, falliva in silenzio per sempre. Eseguito a mano `--apply`: 428 ticker, 74 cal_factor scritti,
file creati. **Fix:** (i) il loop è ora **agganciato a `run_learning_cycle`** (gira ad ogni Apply,
rispettando `dry_run`); (ii) l'errore non è più silenziato: `post_refresh_steps` logga `log.error(...)`
e il ciclo registra un `append_learning_log(kind="error")` visibile.

### #12 — Guard outlier MAE nel feedback loop
Nell'output reale `KALA` aveva `persistent_mae = 1668.6%` (dato corrotto/outlier) che gonfiava
`portfolio_avg_mae` (11.69) e distorceva tutte le soglie relative (under/over-performer). **Fix:**
`mae_outlier_cap_pp = 300`: i ticker oltre il cap sono **esclusi** dalla media di portafoglio e
**mai** usati per cambiare un cal_factor (flag `data_outlier`), così un singolo movimento assurdo
non ricalibra l'intero portafoglio.

## Test
Tutti verdi (32+): suite RISK_ON/cluster precedente + `tests/test_effectiveness_delta.py` (esteso:
EIS MAE-based, polygon week-over-week), `tests/test_eis_super_mae.py` (correlazione cieca allo
scaling ma MAE no; dedup stesso-giorno), `tests/test_feedback_outlier_guard.py` (esclusione outlier,
nessun cal change su dati corrotti).
File modificati/nuovi lint-clean (ruff). I warning ruff residui (`market_context_gate.py` DATA_DIR;
`cd_pattern_polygon_accuracy.py` `_expand_knot_series`) sono **pre-esistenti**, non introdotti dal fix.
