# EIS Pattern Research

Progetto Python di **ricerca quantitativa** per analizzare pattern legati a prezzo, volume, eventi **EIS** (Event Impact Score), liquidità di bilancio e di mercato, e performance relativa vs benchmark di settore (es. **XBI**).

## ⚠️ Disclaimer

1. Pattern trovati su **4–6 mesi** e **pochi ticker** non sono statisticamente affidabili — servono come **ipotesi** da validare su storico più lungo.
2. Correlazione passata **non garantisce** risultati futuri.
3. Questo è uno **strumento di ricerca**, non un sistema di trading pronto all'uso né un consiglio di investimento.

## Struttura

```
eis_pattern_research/
  data/raw/            # CSV grezzi (gitignored a livello repo — generati localmente)
  data/processed/      # panel feature-engineered (parquet)
  fixtures/sample_raw/ # CSV di esempio committati per smoke test
  src/
    ingestion.py       # loader pluggable multi-fonte
    features.py        # feature engineering
    eventstudy.py      # event study CAR attorno a EIS
    patterns.py        # pattern mining pre-evento
    model.py           # logistic regression walk-forward + backtest
    scanner.py         # alert similarità pattern in tempo reale
    sample_data.py     # generatore dati fittizi coerenti con lo schema
  notebooks/           # esplorazione Jupyter
  reports/             # output markdown + grafici
  run_pipeline.py      # entry point pipeline completa
```

## Quick start

```powershell
cd "c:\coding\Biotech_Investment app 6\eis_pattern_research"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Genera CSV di esempio + esegui pipeline end-to-end
python run_pipeline.py --fixtures
```

Output:
- `reports/pattern_report.md` — report principale
- `reports/event_study_car.png` — grafico CAR
- `reports/pre_event_feature_comparison.png` — confronto pre-evento vs controllo
- `data/processed/daily_features.parquet` — panel processato

## Schema dati (granularità giornaliera)

| Colonna | Descrizione |
|---------|-------------|
| `ticker`, `date` | Identificativi |
| `open`, `high`, `low`, `close`, `volume` | OHLCV |
| `benchmark_close`, `benchmark_volume` | Benchmark (XBI) |
| `eis_flag`, `eis_score` | Giorno/evento EIS |
| `liquidity_current_ratio`, `liquidity_quick_ratio`, `liquidity_cash` | Bilancio (trimestrale, forward-fill) |
| `avg_dollar_volume_20d`, `bid_ask_spread`, `float_shares` | Liquidità di mercato |

Colonne mancanti → **NaN** + warning esplicito (mai valori inventati).

## Collegare dati reali

### 1. OHLCV + benchmark

Esporta un CSV per ticker in `data/raw/{TICKER}.csv` e `data/raw/XBI.csv`, oppure un unico parquet long-format.

Alias colonne supportati: `symbol`, `adj_close`, `xbi_close`, ecc. (vedi `ingestion.py`).

### 2. Eventi EIS (SuperNova)

Quando disponibile l'export dalla piattaforma:

```python
from src.ingestion import CsvDirectoryLoader, SupernovaEisStubLoader, merge_eis_events

daily = CsvDirectoryLoader("data/raw").load()
events = SupernovaEisStubLoader("data/raw/eis_events.csv").load()
panel = merge_eis_events(daily, events)
```

Oppure includi `eis_flag` / `eis_score` direttamente nei CSV giornalieri.

### 3. Liquidità di bilancio

Trimestrale: aggiungi righe con `liquidity_*` — il pipeline fa forward-fill automatico in `features.py`.

## Moduli

| Modulo | Funzione |
|--------|----------|
| `ingestion.py` | Loader CSV/Parquet/Manual + stub SuperNova |
| `features.py` | Return, z-score volume, relative strength, beta, pre-event windows |
| `eventstudy.py` | CAR [-20,+20], t-test pre/post, bootstrap |
| `patterns.py` | Mann-Whitney pre vs control, k-means archetipi, feature importance |
| `model.py` | Target binario, walk-forward logistic, baseline casuale |
| `scanner.py` | Similarità coseno vs centroidi cluster pre-evento |

## Parametri chiave (`src/config.py`)

- `MIN_EVENTS_FOR_SIGNIFICANCE = 8` — sotto questa soglia i pattern sono marcati come non affidabili
- `PREDICTION_HORIZON_DAYS = 10` — orizzonte target predittivo
- `VOLUME_ZSCORE_SPIKE = 2.0` — soglia picco volume anomalo

## Scalabilità

Il design è pensato per **N ticker × anni di storico**. Con il campione attuale (4 titoli, ~130 sedute) il report segnala esplicitamente quando:

- p-value < 0.05 ma n eventi insufficiente (falso discovery probabile)
- metriche AUC/precision ingannose per pochi positivi assoluti

Estendere a decine di biotech e 2–3 anni prima di usare lo scanner operativamente.

## SuperNova integration

After each orchestrator refresh (post_refresh_steps), the library auto-updates from
`past_catalyst_predictions.json` + active simulation tickers:

```powershell
python scripts/refresh_catalyst_pattern_library.py
```

Outputs:
- `data/catalyst_pattern_library.json` — pattern definitions + stats + run history
- `data/catalyst_pattern_audit.md` — human-readable audit

Set `SKIP_CATALYST_PATTERN_LIBRARY=1` to disable auto-refresh.
