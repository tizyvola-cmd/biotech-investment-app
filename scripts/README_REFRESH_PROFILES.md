# Profili refresh (domenica vs giorni feriali)

## VPS / Desktop Web (scheduler automatico)

Con `SUPERNOVA_SERVE_DESKTOP=1` e profilo `config/profiles/desktop_web_host.env`:

| Quando (Europe/Rome) | Script | Contenuto |
|----------------------|--------|-----------|
| **Lun–Ven 07:00** | `scripts/morning_research_refresh.py` | IPO biotech + fetch CT.gov + rigenera Simulation (+ sync SDS nuovi entranti) |
| **Lun–Ven 09:00** | `scripts/sds_cohort_refresh.py --mode full` | Ricalcolo completo coorte SDS Supernova (FMP + cluster A) |
| **Lun–Ven 16:30** | `scripts/model_lab_accuracy_refresh.py` | Fast quotes + simulation charts + **SDS light** + **EIS magnitude** (prezzi T+1/T+7 + curva calibrazione) |
| **Lun–Ven 10:00** | `scripts/eis_morning_refresh.py` | Feed clinico pre-CD + EIS + `signal_calibration.json` + popup report |
| **Lun–Ven 15:30 … 21:30** (ogni ora) | `scripts/hourly_financial_refresh.py` | Quote Yahoo → Financial JSON + live signals + **SDS light** + market context |
| **Sab 07:00 … 14:00** | `scripts/saturday_weekly_full_refresh.py` | Orchestrator **WeeklyFull** (SEC K-8 + enrich, 30–90+ min) |

Test manuale:
```bash
py -3 scripts/morning_research_refresh.py --dry-run
py -3 scripts/sds_cohort_refresh.py --dry-run
py -3 scripts/sds_cohort_refresh.py --mode light --force
py -3 scripts/eis_morning_refresh.py --dry-run
py -3 scripts/model_lab_accuracy_refresh.py --dry-run
py -3 scripts/hourly_financial_refresh.py --dry-run
py -3 scripts/saturday_weekly_full_refresh.py --dry-run
```

I **refresh per tab** nell'app (Simulation, Financial, CD scan, …) restano manuali — calcoli diversi per pagina.

---

Dopo un orchestrator completo (~70 min), **non serve ripeterlo ogni giorno**.

## Riepilogo

| Quando | Cosa | Script | Tempo tipico |
|--------|------|--------|----------------|
| **Lun–Ven 16:00** (Task Scheduler) | Fast + KPI + cohort + **live signals**; **lunedì** anche fetch clinico | `scripts/daily_market_refresh.py` | fast ~5–30 min; lunedì +1–3 h clinico |
| **Lun–Sab** | Simulation + Accuracy (fast) | `Profilo_Giornaliero_Refresh.bat` | **~15–25 min** |
| **Domenica** | Pipeline completa + foglio **SEC K-8** | `Profilo_Domenica_Orchestrator_Full.bat` | 30–90+ min |
| Opzionale | Solo foglio SEC K-8 | `Profilo_Solo_SEC_K8.bat` | 15–45 min |

**Prima di ogni run:** chiudi Excel su `data\biotech_orchestrated_output.xlsx`.

---

## Automatico giornaliero (Task Scheduler)

`scripts/Setup_Daily_Market_Refresh.ps1` registra **Lun–Ven 16:00** (ora locale):

1. **Lunedì**: `BiotechClinicalTrialDataFetcher.py` (solo società con cache scaduta, TTL 14 gg)
2. Sempre: `refresh_fast.py` → Simulation, Accuracy, snapshot desktop
3. KPI direzionali + cohort Decision Lab
4. **`refresh_live_signals.py`** (`--cd-horizon 60`) → pred5/affid + `signal_audit_log.jsonl`

Test manuale: `py -3 scripts/daily_market_refresh.py --force`  
Solo live signals: `py -3 scripts/daily_market_refresh.py --skip-fast --skip-clinical-weekly`  
Forza clinico oggi: `py -3 scripts/daily_market_refresh.py --force-clinical-weekly`

Env: `CLINICAL_WEEKLY_WEEKDAY=0` (0=lunedì), `LIVE_SIGNALS_CD_HORIZON=60`

---

## Giornaliero (feriale)

**Desktop UI (consigliato):** Impostazioni → pulsante **«Refresh giornaliero»** (richiede API: `python -m supernova_api`).

Doppio click: `scripts\Profilo_Giornaliero_Refresh.bat`

Oppure PowerShell dalla root progetto:

```powershell
. .\scripts\Biotech_Refresh_Profiles.ps1
Invoke-BiotechDailyRefresh
# con Guida + Grafici (più lento):
Invoke-BiotechDailyRefresh -WithGuida -WithGrafici
```

**Env impostate automaticamente:**

- `PRED_CURVE_SEQ_CALIB=1`
- `SEC_K8_LOOKBACK_DAYS=180`
- `PRED_K8_DISPLAY_OVERLAY=1`
- `REFRESH_K8_LIVE_FALLBACK=1` (8-K da SEC se foglio assente)
- `DAILY_REFRESH_FAST=1` (profilo feriale veloce, target <30 min)
- `ACCURACY_REFRESH_FAST=1` (skip enrich CT.gov su tutto il JSON; seq_curve solo se manca)
- `HISTLIB_REFRESH_ON_ENRICH=0` (no refresh Yahoo massivo in enrich Accuracy)
- `DAILY_ACCURACY_ENRICH_ACTIVE_ONLY=1` (enrich curve HistLib solo su CD≥oggi, non 854 righe)
- `PAST_CATALYST_SKIP_CLINICAL_EXTRA=1` (Past catalyst solo righe Simulation passate)
- `PAST_PRED_DISK_ONLY=1` (nessun ricalcolo Yahoo Past Catalyst — solo JSON)
- `ORCH_SKIP_FINANCIAL_ENRICH=1` (no fetch Yahoo/Finnhub riga-per-riga su 600+ ticker)
- `ORCH_SKIP_SEC_K8=1` (non rigenera foglio SEC K-8; usa fallback live su Simulation)
- `ORCH_SKIP_OPTIONS_PRED=1` (salta catena opzioni PCR / expected move)
- `ACCURACY_V5_RAW_METRICS=0` (no Monte Carlo v5 raw su 800+ righe storiche)
- `ACC_SIM_BULK_PAST_WRITE=1` + `ACC_SIM_SKIP_V5_ON_WRITE=1` (scrittura bulk CD passate)

**Domenica / enrich completo** (orchestrator): usa `ACCURACY_REFRESH_FAST=0`, `PAST_CATALYST_SKIP_CLINICAL_EXTRA=0`, `ACCURACY_V5_RAW_METRICS=1` se serve audit v5 raw.
- `ORCH_SKIP_LIQUIDITY_YF=1` — **no** download balance sheet su 600+ ticker (10–30 min); usa `data/enrich_cache`

Equivalente manuale:

```powershell
cd "...\Biotech_Investment app 6"
$env:PRED_CURVE_SEQ_CALIB="1"
$env:SEC_K8_LOOKBACK_DAYS="180"
$env:REFRESH_K8_LIVE_FALLBACK="1"
py -3 refresh_fast.py
```

---

## Domenica (full)

Doppio click: `scripts\Profilo_Domenica_Orchestrator_Full.bat`

```powershell
. .\scripts\Biotech_Refresh_Profiles.ps1
Invoke-BiotechWeeklyFull
# forza anche fetch yfinance (run più lungo):
Invoke-BiotechWeeklyFull -ForceYfinanceFetch
```

**Env profilo domenica:**

- `ORCH_SKIP_SEC_K8=0` → rigenera foglio **SEC K-8**
- `ORCH_PERF=1` → tempi a fine run
- `LIQUIDITY_YF_FORCE=1` → aggiorna liquidità FY da yfinance (altrimenti max 1× / 24 h)
- `ORCH_SKIP_FETCH=1` **solo se** `data\yf.json` esiste ed è non vuoto (altrimenti fetch incluso)

**Non usare** `ORCH_FAST_RELUNCH=1` sulla domenica full: salta SEC K-8.

---

## Solo SEC K-8 (metà settimana)

Se hai già fatto l’orch di domenica ma vuoi aggiornare solo i filing:

`scripts\Profilo_Solo_SEC_K8.bat` oppure `py -3 refresh_sec_k8_sheet.py`

Richiede `SEC_EDGAR_USER_AGENT` (policy SEC).

---

## Pianificazione automatica

### Desktop — sabato mattina (consigliato)

Se apri **SuperNova/Electron** il **sabato** tra le **06:00 e le 13:59** (ora locale), e l’API è raggiungibile, parte **una sola volta** l’orchestrator **WeeklyFull** (stesso profilo della domenica):

- si apre la modale refresh con messaggio dedicato;
- in top bar compare il badge con **orologio antico** 🕰️ (non la clessidra del daily);
- a fine run: export snapshot + **popup** con esito, messaggio e **tempo totale**;
- non parte la review portafoglio post-refresh del daily.

Chiave `localStorage`: `supernova_sunday_full_saturday_done` (data del sabato).

### Task Scheduler (opzionale, PC spento il sabato / app chiusa)

**Sabato (consigliato, allineato all'autostart app):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1
# default: ogni sabato 07:00 — WeeklyFull via scripts/saturday_weekly_full_refresh.py
powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Saturday_Full.ps1 -At "07:30" -RunNow
```

**VPS (API sempre accesa):** abilita in `config/profiles/desktop_web_host.env`:

```env
SUPERNOVA_SATURDAY_WEEKLY_FULL=1
SUPERNOVA_SATURDAY_WEEKLY_FULL_TIME=07:00
SUPERNOVA_SATURDAY_WEEKLY_FULL_END=14:00
```

Cron standalone (se l'API non gira 24/7): `0 7 * * 6 cd /path/to/project && python -u scripts/saturday_weekly_full_refresh.py --quiet`

**Domenica (legacy):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1
# default: ogni domenica 02:00 — WeeklyFull
powershell -ExecutionPolicy Bypass -File scripts\Setup_Weekly_Sunday_Full.ps1 -At "03:30" -RunNow
```

Daily feriale (Lun–Ven): `scripts\Setup_Daily_Market_Refresh.ps1`.  
Solo snapshot accuratezza: `scripts\Setup_Weekly_Accuracy_Snapshot.ps1` (domenica 09:00).

Imposta «Esegui anche se utente non connesso» solo se il PC è acceso; un run full può richiedere 30–90+ minuti.

---

## Quando fare cosa

- **Hai cambiato coorte / Financial / nuovi ticker** → domenica full (o orch manuale).
- **Solo prezzi, Pred, colonne K-8, Accuracy** → profilo giornaliero.
- **Solo audit filing nel foglio Excel** → Solo SEC K-8.

---

## Storico prezzi / yfinance — solo dati nuovi (default)

I profili impostano aggiornamento **incrementale** (le Simulation possono cambiare; le barre passate no):

| Cosa | Comportamento |
|------|----------------|
| **HistLib** (`data/price_cache/*_HISTCV_max_cv.pkl`) | Prima volta: download 10y. Poi: solo **tail-merge** (~14 sedute) se ultima barra > `HISTLIB_MIN_LAG_DAYS` (default 3). |
| **yf.json** (`fetch_yfinance.py`) | Metadati in cache sticky; ogni 4h aggiorna solo **prezzo/beta** (`YF_QUOTE_REFRESH_HOURS`). Simboli nuovi → download completo. |
| **Orchestrator domenica** | Con `yf.json` ok: `ORCH_SKIP_FETCH=1` salta lo step yfinance intero. |

Env utili:

```powershell
$env:HISTLIB_INCREMENTAL_ONLY="1"   # default — non cancellare pickle per refresh
$env:HISTLIB_MIN_LAG_DAYS="3"       # giorni senza barra → tail-merge
$env:HISTLIB_REFRESH_ON_ENRICH="0"  # refresh fast: non toccare Yahoo su enrich (più veloce)
$env:YF_CACHE_STICKY="1"
$env:YF_QUOTE_REFRESH_HOURS="4"
$env:ORCH_SKIP_FETCH="1"            # domenica: salta fetch_yfinance se yf.json ok
$env:ORCH_SKIP_LIQUIDITY_YF="1"    # refresh giornaliero: liquidità solo da cache
$env:LIQUIDITY_YF_FORCE="1"        # orchestrator domenica: forza passata liquidità FY
$env:LIQUIDITY_YF_MAX_AGE_HOURS="24" # default: al massimo 1 bulk yfinance liquidità / giorno
$env:YF_FORCE_FULL_REFRESH="1"      # una tantum: riscarica tutti i metadati Yahoo
$env:FORCE_HISTLIB_CV_DOWNLOAD="1"  # una tantum: riscarica tutto lo storico HistLib
```

**Forzare storico completo** (raro): `FORCE_HISTLIB_CV_DOWNLOAD=1` prima di un run, oppure cancellare un file `.pkl` in `data/price_cache/`.
