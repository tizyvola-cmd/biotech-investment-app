# Report: debug orchestrator e alleggerimento sistema

**Data:** 2026-07-02  
**Scope:** pipeline refresh backend (orchestrator, scheduler, post-pipeline) + script diagnostico

---

## Obiettivo

Ridurre lavoro duplicato tra scheduler (hourly, daily, model lab), refresh manuale da UI e post-pipeline Decision Lab, mantenendo dati freschi senza rilanciare step costosi già completati di recente.

---

## Cosa è stato fatto

### 1. Sistema di gate con marker (`orch_refresh_gates.py`)

Nuovo modulo leggero (nessun import di `data_orchestrator`) che persiste timestamp in `data/markers/`:

| Marker | File | Uso |
|--------|------|-----|
| `yfinance` | `yfinance_last_run.json` | Evita doppio fetch quote Yahoo |
| `sds_light` | `sds_light_last_run.json` | Evita doppio refresh SDS cohort light |
| `post_pipeline` (full) | `post_refresh_pipeline_status.json` | Evita ripetere calib direzionale + cohort + live signals |

Funzioni: `mark_run()`, `ran_within_minutes()`, `mark_post_pipeline_ok()`, `post_pipeline_ok_within()`, `gate_status()`.

### 2. Fetch Yahoo — scrittura marker

- **`fetch_yfinance.py`**: alla fine del run scrive `mark_run("yfinance")` con conteggio ticker.

### 3. Scheduler hourly (`scripts/hourly_financial_refresh.py`)

- Se `yfinance` è già stato eseguito negli ultimi **50 min** (env `HOURLY_YF_SKIP_IF_WITHIN_MIN`), salta `fetch_yfinance.py`.
- Propaga comunque quote al Financial snapshot, live signals e tail leggero di `post_refresh_steps` (SDS + market context).
- Fix: aggiunto `import os` mancante.

### 4. Scheduler Model Lab (`scripts/model_lab_accuracy_refresh.py`)

- Skip `fetch_yfinance` se recente (**50 min**, `MODEL_LAB_YF_SKIP_IF_WITHIN_MIN`).
- Skip `refresh_sds_cohort_light` se recente (**55 min**, `MODEL_LAB_SDS_SKIP_IF_WITHIN_MIN`).
- `YF_QUOTE_REFRESH_HOURS` portato a **1h** (coerente con daily) invece di 0.5h forzato.

### 5. Post-refresh condiviso (`post_refresh_steps.py`)

- **SDS light**: skip automatico se già eseguito negli ultimi **55 min** (`SDS_LIGHT_SKIP_IF_WITHIN_MIN`).
- Marker SDS scritto dopo ogni run riuscito.
- **Post-pipeline full**: se completati dircalib + cohort (senza errori), scrive `mark_post_pipeline_ok(kind="full")` — così scheduler mattutino e API condividono lo stesso stato.

### 6. API post-pipeline (`supernova_api.py`)

- `POST /api/investment/post-refresh-pipeline`: se pipeline **full** già OK negli ultimi **45 min** (`POST_PIPELINE_SKIP_IF_WITHIN_MIN`), risponde `{ skipped: true }` invece di rilanciare 5–8 min di lavoro.
- Alla fine di un run API riuscito, aggiorna lo stesso marker full.

### 7. Profilo refresh giornaliero (`refresh_desktop_app.py`)

- Confermato `ORCH_PERF=1` nel patch daily — i blocchi principali dell’orchestrator stampano tempi nel log quando si usa refresh feriale.

### 8. Script diagnostico (`scripts/debug_orchestrator_perf.py`)

Esteso con:

- Sezione **7**: snapshot gate (`gate_status()`).
- Sezione **8**: tail del log orchestrator/refresh con righe timing/skip.
- Env gate elencati in sezione 6.

**Comando:**

```powershell
cd "C:\coding\Biotech_Investment app 6"
py -3 scripts/debug_orchestrator_perf.py
```

---

## Risultati misurati (run locale 2026-07-02)

| Blocco | Tempo | Note |
|--------|-------|------|
| `ensure_calibration_state_for_empirical` | **0.0 s** | `PAST_PRED_DISK_ONLY=1` — nessun ricalcolo 9k+ studi |
| `merge_by_symbol` | **5.9 s** | Merge master + clinical + variations |
| Curve calibrazione v4 | presenti | success n=75, failure n=23, neutral n=324, control n=300 |
| `past_pred` rows | 9348 | Solo lettura disco |
| Excel Simulation emp/rel | 43/43 righe | Colonne empiriche popolate |

Gate al momento del debug:

- `yfinance` / `sds_light`: nessun marker (primo run dopo deploy)
- `post_pipeline`: ultimo OK storico (giugno) — i nuovi marker si popoleranno al prossimo scheduler/UI refresh

---

## Stima miglioramento (risparmio operativo)

### Già attivo — profilo daily fast (`daily_refresh_env_patch`)

Target **< 30 min** vs **60–90+ min** orchestrator completo, grazie a:

- `ORCH_SKIP_FINANCIAL_ENRICH` — no Yahoo/Finnhub riga-per-riga
- `ORCH_SKIP_SEC_K8` — no rebuild foglio SEC K-8
- `ORCH_SKIP_OPTIONS_PRED` — no catena opzioni
- `DAILY_SKIP_ACCURACY_SHEET` — no foglio Accuracy in feriale
- `PAST_PRED_DISK_ONLY` — no ricalcolo past_pred massivo
- `ORCH_SKIP_LIQUIDITY_YF` — liquidità solo da cache

**Risparmio strutturale:** ~**30–60 min** per refresh feriale rispetto al weekly full.

### Nuovo — dedup scheduler + UI

| Scenario | Step evitato | Risparmio stimato |
|----------|--------------|-------------------|
| Hourly dopo daily/hourly precedente | `fetch_yfinance` | **~2–5 min** |
| Model Lab 16:30 dopo hourly/daily | `fetch_yfinance` + SDS light | **~3–6 min** |
| Hourly / post_refresh tail | SDS light duplicato | **~30–90 s** |
| Refresh UI + post-pipeline dopo scheduler mattutino | dircalib + cohort + live signals | **~5–8 min** |
| Refresh UI entro 45 min da post-pipeline OK | intera post-pipeline API | **~5–8 min** |

**Totale tipico giornata feriale** (hourly ×6 + model lab + 0–1 refresh manuale):

- **Prima:** fino a **~15–25 min** di lavoro ridondante (YF + SDS ripetuti + post-pipeline doppia).
- **Dopo:** overlap eliminato dai gate → **~0 min** ridondanza quando i marker sono freschi.

In pratica: **~15–25 min/giorno** risparmiati in scenario VPS con scheduler attivo; **5–8 min** in più ogni volta che l’utente fa refresh manuale subito dopo il daily automatico.

---

## Variabili ambiente (tuning)

| Env | Default | Effetto |
|-----|---------|---------|
| `HOURLY_YF_SKIP_IF_WITHIN_MIN` | 50 | Skip YF in hourly |
| `MODEL_LAB_YF_SKIP_IF_WITHIN_MIN` | 50 | Skip YF in model lab |
| `MODEL_LAB_SDS_SKIP_IF_WITHIN_MIN` | 55 | Skip SDS in model lab |
| `SDS_LIGHT_SKIP_IF_WITHIN_MIN` | 55 | Skip SDS in post_refresh_steps |
| `POST_PIPELINE_SKIP_IF_WITHIN_MIN` | 45 | Skip post-pipeline API duplicata |
| `ORCH_PERF` | 1 (daily patch) | Log tempi blocchi orchestrator |

Per forzare un refresh completo: cancellare `data/markers/*.json` oppure impostare le soglie skip a `0`.

---

## Verifica post-deploy

1. Eseguire un daily refresh (scheduler o UI) → controllare `data/markers/yfinance_last_run.json`.
2. Entro 50 min, lanciare hourly → log deve mostrare `SKIP fetch_yfinance`.
3. Dopo post-pipeline OK, chiamare da UI refresh daily → API deve rispondere `skipped: true` su post-pipeline.
4. `py -3 scripts/debug_orchestrator_perf.py` → sezione 7 con età marker aggiornate.

---

## File modificati

- `orch_refresh_gates.py` (nuovo/esteso)
- `fetch_yfinance.py`
- `post_refresh_steps.py`
- `scripts/hourly_financial_refresh.py`
- `scripts/model_lab_accuracy_refresh.py`
- `scripts/debug_orchestrator_perf.py`
- `supernova_api.py`
- `refresh_desktop_app.py` (ORCH_PERF già presente)

---

## Prossimi passi opzionali (non implementati)

- Endpoint `GET /api/refresh/gates` per dashboard ops (oggi: solo script debug).
- Metriche Prometheus su skip/hit rate dei gate.
- Allineare `InvestmentDecisionLabView` per mostrare toast quando post-pipeline è `skipped` (comportamento già corretto lato server; UI resta su `ok` immediato).
