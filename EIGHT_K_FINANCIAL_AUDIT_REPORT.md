# Audit: SEC 8-K → riassunto → score (tab Financial Deep Dive)

**Data:** 2026-09-19  
**Scopo:** handoff per Claude / review — come SuperNova legge gli 8-K, li riassume e li scora nella tab **Financial** del Deep Dive.  
**Nota:** non è Soft BUY/SELL. Display + taxonomy scores only.

---

## 1. Dove si vede in UI (cosa intende “tab Financial”)

| Superficie | Path | Ruolo |
|---|---|---|
| **Deep Dive → pane Financial** | `PortfolioLossAnalysisView` → `evalPane === "financial"` → `TickerFinancial8kPanel` | **Questo** è il dossier 8-K (ultimi 2 mesi, sessioni Item, score Fin) |
| Sheet **Financial** (grid YF / liquidità) | `FinancialSheetView` + `fetchFinancialSheet` | Snapshot bilanci/quote — **non** è il pipeline 8-K |
| Legacy / EIS timeline | `ticker8kFilings.ts` da `ClinicalPreCdRecord` | 8-K già migrati nel feed clinico (altra via) |

Header UI (`TickerFinancial8kPanel`):  
“8-K EDGAR ultimi 2 mesi · titolo + riassunto concettuale ≤50 parole (Gemini) · score file a destra · refresh mercoledì mattina”.

---

## 2. Pipeline end-to-end (alto livello)

```
EDGAR submissions.json (CIK)
    → lista 8-K ultimi ~62 giorni (max 12)
    → fetch primary HTML + Ex-99 (press release) se serve
    → segmentazione Item (1.01, 2.02, 5.02, 7.01, 8.01, …)
    → [A] TAXONOMY SCORE  (AI classify → pesi deterministici)
    → [B] DIGEST / SUMMARY (Gemini paragrafi ≤50 parole, fallback extractive)
    → cache JSON per ticker
    → API POST /api/desk/ticker-8k-dossier
    → TickerFinancial8kPanel (card per filing)
```

**File core**

| Layer | File |
|---|---|
| Orchestrazione dossier | `ticker_8k_dossier.py` |
| Fetch EDGAR 8-K | `catalyst_extractor.py` (`_fetch_submissions`, `_recent_8k_filings`, `_fetch_8k_bundle_text`) |
| Segment + brief + Gemini attach | `daily_news_desk.py` (`_segment_8k_filing`, `_build_sec_8k_structured_brief`, `_attach_8k_gemini_paragraphs`) |
| Score tassonomia | `eis_taxonomy_scoring.py` (`classify_8k_filing`, `compute_dimension_score`) |
| Catalogo pesi | `config/eis_event_taxonomy.json` (v8, scale **[-3, +3]**) |
| Cache | `data/ticker_8k_dossier_cache.json` |
| API | `supernova_api.py` → `POST /api/desk/ticker-8k-dossier` |
| UI | `desktop-ui/src/components/TickerFinancial8kPanel.tsx` |
| Client API types | `desktop-ui/src/api/supernova.ts` (`Ticker8kDossierFiling`, …) |
| Scheduler | `supernova_web_scheduler.py` → mercoledì ~07:15 Rome |

---

## 3. Lettura EDGAR (come si prende il testo)

### 3.1 Risoluzione ticker → CIK
`daily_news_desk._cik10_for_ticker` → CIK a 10 cifre.

### 3.2 Lista filing
`catalyst_extractor._fetch_submissions(cik)` → `data.sec.gov` submissions.  
`_recent_8k_filings` filtra form 8-K / 8-K/A.

**Lookback dossier:** `_LOOKBACK_DAYS = 62` (~2 mesi).  
**Cap:** `_MAX_FILINGS = 12` per ticker.

### 3.3 Download testo
`_fetch_8k_bundle_text(cik, accession, primary, max_chars=80_000, fetch_exhibits=True)`:

1. Primary document HTML/TXT.
2. Se il primary **non** ha già linguaggio catalyst (PDUFA / topline / 2H / Qx…) **oppure** è corto, scarica fino a **2 exhibit Ex-99.*** (press release) dall’index del filing.
3. Concatena primary + exhibit, truncate a `max_chars`.

**Perché Ex-99:** spesso gli Item 7.01/2.02 “furnish” solo l’exhibit; la sostanza (numeri, endpoint) è nel PR.

---

## 4. Segmentazione Item + brief strutturato

`daily_news_desk._build_sec_8k_structured_brief(text, ticker, …)`:

1. `_segment_8k_filing(text)` → lista Item `{item, title, body}` + metadata + body senza cover.
2. Per ogni Item: `_summarize_8k_item_extractive` (riassunto estrattivo, max ~50 parole) → `item_summaries[]`.
3. Skip cover noise (“check the appropriate box”, signature legalese).
4. Chiama **`eis_taxonomy_scoring.classify_8k_filing`** sul body (vedi §5) → scores + narrative.
5. `news_kind` da Item codes (`_news_kind_from_8k_items`) + override se taxonomy dice clinical/financial.
6. `_attach_8k_gemini_paragraphs` → sessioni Gemini (titolo concettuale + summary ≤50 parole) attaccate come `gemini_sessions`.

Poi `ticker_8k_dossier._digest_filing`:

- Preferisce `gemini_sessions` come `sessions[]` mostrate in UI (`digest_method = "gemini"`).
- Altrimenti fallback `_extractive_sessions` (Item extractive + boost da exhibit/numeri per Item 2.02/7.01/8.01/1.01 se riassunto “thin”).
- Copia `financial_score` / `clinical_score` / `corporate_score` / `eis_score` dal brief.

---

## 5. Scoring (tassonomia EIS) — come nasce il “Fin ±X”

### 5.1 Principio
**Il modello classifica solo** (`event_id` + `magnitude` + evidence).  
**I numeri sono deterministici** da `config/eis_event_taxonomy.json`.

Formula (`compute_dimension_score`):

```
score = clamp( base_weight(event_id) × Π(modifier multipliers) ,  -3.0 ,  +3.0 )
```

Dimensioni: `clinical`, `financial`, `corporate`, `market_access`  
→ campi: `clinical_score`, `financial_score`, `corporate_score`, `market_access_score` (+ aggregato `eis_score`).

### 5.2 Classificazione 8-K (`classify_8k_filing`)

1. Split body vs exhibit; `detect_8k_items`.
2. Prompt system/user da `build_8k_system_prompt` / `build_8k_user_message` (lista event_id ammessi per dimensione).
3. `ai_provider.call_ai(..., task="summary")` → JSON classifications.
4. Se AI fallisce → `heuristic_8k_classification_obj` (es. offering diluitivo).
5. `classify_8k_filing_result` → pesi.
6. `_fill_empty_dims_from_heuristic` (es. Item 7.01 che wrappa un PR clinico mentre clinical resta vuoto).
7. Narrative inglese dedicata per offering diluitivi (`format_dilutive_offering_summary`) quando `FIN_DILUTIVE_OFFERING`.

### 5.3 Cosa mostra la UI
`TickerFinancial8kPanel` badge **“Fin {score}”** = solo `filing.financial_score`  
(verde se > +0.15, rosso se < −0.15, neutro altrimenti).  
Gli altri score (`clinical`, `corporate`) sono nel payload ma non badge-ati in questa card.

---

## 6. Riassunto “da mostrare” (Gemini vs extractive)

### 6.1 Gemini (preferito, digest_version = 2)
`ticker_8k_dossier` / `daily_news_desk`:

- System: analista biotech; split Item in 1–3 paragrafi investitori; **titolo concettuale** + **summary messaggio** ≤50 parole EN; no copy-paste legalsee.
- Preferenza provider: Gemini se configurato, altrimenti default `ai_provider`.
- Output normalizzato in `sessions[]`: `{ item, item_title, title, summary }`.

### 6.2 Fallback extractive
Se Gemini assente/fallisce: frasi dall’Item body; per Item “thin” prova exhibit tail / excerpt con `$` / million / EPS.

### 6.3 Cache freshness
Entry fresca se `digest_version >= 2` **e** `updated_at >= last_wednesday_cutoff` (ultimo mercoledì 07:15 Europe/Rome).  
Altrimenti al prossimo lookup si ri-scarica EDGAR.

---

## 7. Refresh automatico / on-demand

| Trigger | Comportamento |
|---|---|
| **Mercoledì ~07:15 Rome** | `run_ticker_8k_dossier_weekly` → `refresh_watchlist_8k_dossiers(force=True)` |
| Watchlist | tickers già in cache + Catalyst desk morning + (se pochi) Simulation, **max 28** |
| **Aprire Deep Dive → Financial** | `lookupDeskTicker8kDossier({ ticker })` — usa cache se fresca, altrimenti fetch live |
| Manual force | `force: true` sul POST (bypass cache) |

Marker settimana: `_last_8k_dossier_week` in-memory nello scheduler (come altri job).

---

## 8. Contratto API / payload filing

`POST /api/desk/ticker-8k-dossier` `{ "ticker": "BBNX", "force"?: bool }`

Risposta (essenziale):

```json
{
  "ok": true,
  "cached": true,
  "updated_at": "...",
  "next_refresh": "ISO next Wednesday 07:15 Rome",
  "dossier": {
    "ticker": "BBNX",
    "lookback_days": 62,
    "filings": [
      {
        "filing_date": "2026-09-12",
        "event_date": "...",
        "form": "8-K",
        "title": "...",
        "link": "https://www.sec.gov/Archives/...",
        "items_raw": "2.02, 9.01",
        "sessions": [
          { "item": "2.02", "item_title": "...", "title": "...", "summary": "≤50 words" }
        ],
        "financial_score": -1.5,
        "clinical_score": 0.0,
        "corporate_score": 0.0,
        "eis_score": ...,
        "news_kind": "financial",
        "digest_method": "gemini"
      }
    ]
  }
}
```

UI: dismiss locale per filing (`eisNewsDismiss`) — non cancella cache server.

---

## 9. Relazioni con altri pipeline 8-K (non confondere)

| Pipeline | Uso |
|---|---|
| **Ticker 8-K dossier** (questo audit) | Deep Dive Financial pane |
| **Daily News desk** | Stesso `_build_sec_8k_structured_brief` / taxonomy per news del giorno → può migrare in EIS |
| **Catalyst calendar / guidance** | `_fetch_8k_bundle_text` per date forward (PDUFA, Q/H) — **non** è lo score Financial |
| **Universe Discovery** | Scan full-text 8-K fuori watchlist (mensile) — discovery, non dossier UI |
| **edgar_silent_money** | Form 4 / 13D / Item 5.02 per Silent Money / Exec Exit |
| **Financial sheet grid** | Yahoo / liquidità — **nessun** digest 8-K |

---

## 10. Limiti / rischi noti (domande utili per Claude)

1. **Watchlist max 28** — tickers fuori dalla lista settimanale si aggiornano solo on-demand all’apertura del pane.
2. **Score UI = solo financial_score** — un 8-K clinico forte può mostrare Fin ~0 mentre `clinical_score` è alto (non badge-ato).
3. **Doppia AI** — classify (taxonomy) + Gemini paragraphs: costi/latency; se un provider cade, classify può essere heuristic e digest extractive.
4. **digest_version** — bump forzato invalidazione cache; v2 = Gemini conceptual (non paste).
5. **Ex-99 crawl** — max 2 exhibit; filing con molti exhibit potrebbe perdere pezzi.
6. **Scheduler `_last_8k_dossier_week` in-memory** — restart mid-week può ri-lanciare o saltare a seconda del timing (non persistito su disco come il marker Calendar).
7. **Soft BUY/SELL** — esplicitamente escluso; non cambiare gate di raccomandazione partendo da questo score.

---

## 11. File di test da leggere

- `tests/test_ticker_8k_dossier.py` — digest, Gemini normalize, cache Wednesday
- `desktop-ui/src/sheet/ticker8kFilings.test.ts` — path legacy EIS timeline
- `tests/prediction_core/test_supernova_schedule.py::test_8k_dossier_weekly_wednesday_only`

---

## 12. Prompt suggerito per Claude

> Leggi l’audit `EIGHT_K_FINANCIAL_AUDIT_REPORT.md` e i file elencati in §2.  
> Obiettivo: [migliorare accuratezza score Fin | ridurre costi Gemini | unificare digest Daily News ↔ dossier | persistire marker mercoledì | mostrare anche clinical/corporate in UI | …].  
> Vincoli: non toccare Soft BUY/SELL; lookback ~2 mesi; score da `eis_event_taxonomy.json` resta deterministico dopo la classificazione.

---

*Fine report.*
