# News Thermometer — Phase 0 Brief (read-only)

**Status:** Phase 0 signed off 2026-09-15 → **Phase 1 live** (3 gauges + Excel anchors + local write-back on confirm)  
**Date:** 2026-09-15 (updated)  
**Product name:** Termometro news → `EIS_clinical` + `EIS_financial` + `EIS_market_access` (−100 / +100)  
**Does not touch:** Soft BUY/SELL gates, `EIS Market` formula, CD Study Mirror / Company Memory write-path

---

## 0. One-sentence goal

Replace the opaque “EIS Clinical ≈ Σ KPI×10” story with an **explicit signed thermometer** driven by a **growing benchmark library**, producing **three independent intrinsic axes** (clinical + financial + market access) that can be confirmed/corrected by the user on the news window.

---

## 1. Locked product decisions (from design + code answers)

| # | Decision | Lock |
|---|----------|------|
| D1 | **Three axes** | `clinical` \| `financial` (incl. partnership / restructuring / M&A) \| `market_access` |
| D2 | Scale | Signed **−100 … +100**; 0 = non market-moving / purely informational |
| D3 | Independence | No cross-axis adjustment; Market EIS stays separate |
| D4 | Benchmark growth | Human **Confirm / re-score** writes a `confirmed` row into local overlay (`supernova.thermometer.benchmarks.v1`); seed JSON stays read-only; server persist later |
| D5 | Auto-promote provisional → confirmed | **No** silent promote; badge OK only after human confirm |
| D6 | Matching v1 | Taxonomy `event_id` + evidence text + Excel importance; telemetry chip ID / XLS / TXT / FB |
| D7 | Segmentation v1 | **Source / 8-K Item / taxonomy dims first**; no new LLM body-splitter unless mixed-PR pain is proven |
| D8 | Primary UI | Triple gauges on **news detail modals**; Daily News chips secondary; **ribbon F deferred** |
| D9 | Soft BUY/SELL | Unchanged |

---

## 2. Critical naming collision (must resolve in Phase 0 output)

Today UI says **“Clin”** for **two different signals**:

| Label in UI today | Real meaning | Code | Scale |
|-------------------|--------------|------|-------|
| Ribbon / banner **EIS C** | Intrinsic KPI rollup | `eis_intrinsic` = `clamp(kpi)×10` via `eisIntrinsicFromKpi` | ~±20 |
| Daily News / Top KPI chip **Clin** | Taxonomy clinical dimension | `clinical_score` via `eis_taxonomy_scoring.py` | ±3 |
| Chip **Fin** | Taxonomy financial | `financial_score` | ±3 |
| Badge **EIS +70.3** (Catalyst table) | Usually **Market** (price/vol rollup) | `EisBreakdown.score` / cumulative market | large |

**Phase 0 must recommend one naming plan** before Phase 1:

**Recommended (default for subsequent phases):**

1. Thermometer **is** the formalization of taxonomy Clin/Fin remapped to ±100 → product names `EIS_clinical` / `EIS_financial`.
2. Keep KPI×10 as a **separate** field (rename UI to e.g. “KPI intrinsic” / hide from hero) — do **not** silently overwrite ribbon “C” with thermometer Clinical.
3. Ribbon stays **M / C_kpi** until an explicit cutover ticket adds **F** (and optionally renames C → thermometer Clinical).

Alternative (only if product insists thermometer *replaces* ribbon C): Phase 1 includes a migration note + dual-run period (show both until validated).

---

## 3. What already exists (reuse map)

### 3.1 Scoring engine (closest to thermometer)

| Piece | Path | Role |
|-------|------|------|
| Taxonomy catalog | `config/eis_event_taxonomy.json` | `score_scale` −3…+3; events with `dimension`, `base_weight`, modifiers |
| Scorer | `eis_taxonomy_scoring.py` | `classify_heuristic`, `classify_with_ai`, `compute_dimension_score`, `score_article_dimensions`, `classification_to_score_fields` |
| Dimensions | same | `clinical`, `financial`, `corporate`, `market_access` |
| Desk bridge | `daily_news_desk.py` | `_dimension_scores`, `_merge_dimension_scores`, `_segment_8k_filing`, `news_kind` |
| TS aggregate | `desktop-ui/src/sheet/newsDimensionScores.ts` | `NewsDimensionScores`, `newsDimensionScoresByTicker`, `clinicalDimensionScoresByTicker` |
| Manual kind | `desktop-ui/src/sheet/manualNewsEis.ts` | `classifyManualNewsEisKind`, intrinsic helpers |

**Note on `corporate` / `market_access`:** design folds corporate into financial subtypes (`restructuring`, `m_and_a`, `partnership`). Phase 0 audit must list current taxonomy event_ids per dimension and propose a **mapping table** → thermometer axis+subtype (corporate→financial; market_access→clinical or financial case-by-case, or park as “non-thermometer” until later).

### 3.2 Market vs intrinsic (do not conflate)

| Piece | Path | Role |
|-------|------|------|
| Market EIS | `prediction/event_impact_score.py` → `compute_eis` | Price/vol formula |
| TS mirror | `desktop-ui/src/sheet/eventImpactScore.ts` | `eisIntrinsicFromKpi`, `K_INTRINSIC=10` |
| Banner dual | `desktop-ui/src/sheet/tickerImpactEvents.ts` | `resolveEisBannerDualScores`, `sumEisMarketScores`, `sumEisIntrinsicScores` |
| Ticker rollup | `desktop-ui/src/sheet/tickerEisSummary.ts` | `buildTickerEisDetail`, `summarizeTickerEis` — **no financial_score field** |

### 3.3 Matching (what is *not* available)

| Claim | Reality |
|-------|---------|
| Reusable text embeddings for news↔benchmark | **Absent** |
| Cosine similarity in repo | Price/feature polygons (`eis_pattern_research`, CD pattern) — **not prose** |
| `eisMatchesProgram` | NCT / drug substring — program filter only |
| PubMed→ticker | Query + sponsor string match |

→ Phase 1 matching = **taxonomy event_id proximity + optional subtype + seed anchors**, not vector DB.

### 3.4 UI hooks

| Surface | Path | Thermometer role |
|---------|------|------------------|
| Manual / feed detail | `ManualNewsDetailModal.tsx` | **Primary** dual gauge |
| EIS event detail | `EisEventDetailModal.tsx` | Primary / clarify Clin meaning |
| Daily News chips | `CatalystDailyNewsBox.tsx` → `RelevantScoreChips` | Compact Clin/Fin (already) |
| Dimension cell | `NewsDimensionScoreCell.tsx` | Table-level Fin-capable |
| Deep Dive ribbon | `DeepDiveKpiRibbon.tsx` | M/C today — **F deferred** (D8) |
| Impact banner | `TickerImpactEventsPanel.tsx` | Optional later Σ F |

### 3.5 Segmentation already present

- `source_type`: `ctgov`, `sec_8k`, `press_release`, `publication`, `congress`, `manual`, …
- 8-K Item → kind via `daily_news_desk._segment_8k_filing` / `_8K_ITEM_NEWS_KIND`
- Whole-article taxonomy classify (not paragraph gauges)

---

## 4. Gap analysis (Phase 0 deliverables = answers, not code)

### G1 — Embedding / semantic matching
- **Gap:** no text embedding layer.
- **Phase 0 output:** confirm v1 = taxonomy-id matching; estimate “build embeddings” as Phase 2+ only if miss-rate measured.
- **Checklist files:** `eis_taxonomy_scoring.py`, `config/eis_event_taxonomy.json`, `clinicalDevelopmentLane.ts` (`eisMatchesProgram`), `pubmed_eutils_fetch.py` (sponsor match only).

### G2 — Remap ±3 → ±100
- **Gap:** thermometer scale ≠ taxonomy scale ≠ KPI×10.
- **Phase 0 output:** choose remap policy:

| Option | Formula / approach | Pros | Cons |
|--------|-------------------|------|------|
| **A (recommended)** | `thermometer = round(taxonomy_score * (100/3))` clamp ±100 | Instant bridge; preserves relative taxonomy | Seed table (±85 etc.) must be rewritten to match taxonomy weights or taxonomy weights retuned |
| **B** | New `anchorScore` table keyed by `event_id` (design seed) **replaces** base_weight on thermometer path only | Matches design narrative; chips can stay on ±3 until cutover | Dual scoring paths until migration |
| **C** | Retune taxonomy `base_weight` to ±100 directly | Single scale | Breaks all existing Clin/Fin chip UX and stored scores |

**Recommended lock for Phase 1:** **Option B** for thermometer path + keep taxonomy ±3 in chips until cutover ticket; document `event_id → {axis, subtype, anchorScore}` seed from design tables.

### G3 — Benchmark store
- **Gap:** no `ThermometerBenchmark` persistence, no provisional/confirmed.
- **Phase 0 output:** propose store shape + path (e.g. `data/thermometer_benchmarks.json` + per-event score sidecar), confidence rules (D4/D5), weight formula for provisional (e.g. 0.35× confirmed).
- **Do not implement in Phase 0.**

### G4 — Multi-section aggregation
- Design: max-|score| leads; secondary ±15 cap; no cross-axis.
- **Gap:** taxonomy returns one score per dimension per article, not section list with markers.
- **Phase 0 output:** v1 = **one marker per axis per article** (section markers = Phase 1.5 when 8-K Item split or LLM sections exist); still store audit `{axis, subtype, score, confidence, nearestBenchmarks[]}`.

### G5 — Manual confirm / correct
- **Gap:** no correction log `{oldScore, newScore, correctedBy, correctedAt, note?}`.
- **Phase 0 output:** event schema extension proposal (additive fields only in later phase).

### G6 — Ribbon / `tickerEisSummary`
- **Gap:** no `financial` rollup on `TickerEisDetail`.
- **Phase 0 output:** ribbon decision (D8) = **no F in Phase 1**; if later, rollup via `newsDimensionScores` (or thermometer Σ), not by overloading `eis_intrinsic`.

### G7 — Naming / docs
- Deep Dive copy still describes Clinical as KPI×10 placeholder.
- **Phase 0 output:** glossary table for UI strings (EN/IT) for M / C_kpi / EIS_clinical / EIS_financial.

---

## 5. Phase 0 audit checklist (read-only tasks)

Execute as investigation notes; tick when documented:

- [ ] **A1** Dump taxonomy event_ids grouped by `dimension`; draft map → thermometer `axis` + `subtype` (clinical: trial_readout / regulatory / safety / publication; financial: financing / m_and_a / partnership / restructuring / distress).
- [ ] **A2** Sample 10 live Daily News + 10 clinical feed events: which fields carry Clin/Fin today (`clinical_score`, digests, `eis_intrinsic`, market `score`)?
- [ ] **A3** Trace one CRDL-like path from article → chip “Clin +x” → Catalyst table “EIS +70 / Clin +5.7” — which modules produce each number?
- [ ] **A4** Confirm absence of text embeddings (grep already negative; note any offline research scripts that must not be mistaken for product path).
- [ ] **A5** Inventory UI entry points that open `ManualNewsDetailModal` / `EisEventDetailModal` / Daily News expand — list props available for gauges.
- [ ] **A6** Propose seed file: ~15 clinical + ~10 financial anchors from design tables, each with `id`, `axis`, `subtype`, `label`, `anchorScore`, `confidence: "seed"`, `taxonomyEventId?`.
- [ ] **A7** Remap decision recorded: **A / B / C** (default **B**).
- [ ] **A8** Ribbon decision recorded: Phase 1 = **modals only**; Phase 1.5+ optional `EIS F` chip; rename C only with explicit ticket.
- [ ] **A9** Soft BUY/SELL touchpoints: confirm thermometer scores are **display/audit only** in Phase 1 (no gate wiring) — cite Soft BUY docs if needed.
- [ ] **A10** Out of scope stamped: Company Memory unclassified gate, Volume-vs-EIS coloring, asset tagging write-path (separate track).

---

## 6. Proposed Phase 1 slice (preview only — not this phase)

Minimal vertical slice after Phase 0 sign-off:

1. Seed benchmark JSON + loader (read-only consume).
2. Adapter: taxonomy classification → thermometer scores (Option B anchors) with `provisional` flag.
3. Persist per-event thermometer payload (additive JSON fields / sidecar).
4. Dual gauge component on `ManualNewsDetailModal` (+ confirm / drag-correct → `confirmed` + audit log).
5. Unit tests: remap, aggregation (single-section), confirm promotes confidence.
6. **No** ribbon change; **no** Soft BUY wiring; **no** embeddings.

---

## 7. Sign-off (locked 2026-09-15 — proceed Phase 1)

| # | Item | Decision |
|---|------|----------|
| S1 | Remap | **Option B** — `event_id → anchorScore` on thermometer path; legacy Clin/Fin chips stay ±3 until cutover |
| S2 | `corporate` | Fold into **financial** axis (`m_and_a` / `partnership` / `restructuring`) |
| S2b | `market_access` | Fold into **clinical** axis subtype `access` (payer/HTA adjacent to product thesis) |
| S3 | Ribbon | **C stays KPI×10**; no permanent **F** in Phase 1 (gauges on news modals only) |
| S4 | Seed numbers | Ship design-table anchors as `confidence: "seed"` (not `confirmed`); calibrate later via confirm/correct |

---


## 8. File index (Phase 0 reading list)

```
config/eis_event_taxonomy.json
eis_taxonomy_scoring.py
daily_news_desk.py
prediction/event_impact_score.py
desktop-ui/src/sheet/eventImpactScore.ts
desktop-ui/src/sheet/tickerEisSummary.ts
desktop-ui/src/sheet/tickerImpactEvents.ts
desktop-ui/src/sheet/newsDimensionScores.ts
desktop-ui/src/sheet/manualNewsEis.ts
desktop-ui/src/sheet/clinicalDevelopmentLane.ts   # eisMatchesProgram
desktop-ui/src/components/ManualNewsDetailModal.tsx
desktop-ui/src/components/EisEventDetailModal.tsx
desktop-ui/src/components/CatalystDailyNewsBox.tsx
desktop-ui/src/components/DeepDiveKpiRibbon.tsx
desktop-ui/src/components/NewsDimensionScoreCell.tsx
```

---

## 9. Exit criteria for Phase 0

Phase 0 is **done** when this brief has filled-in answers for A1–A10 (can be a short appendix or checked boxes with notes), and the four sign-offs in §7 are recorded. Then open Phase 1 ticket from §6 — still no Soft BUY / Market EIS / ribbon F unless explicitly added.
