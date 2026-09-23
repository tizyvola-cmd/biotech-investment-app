# Predictive model comparison — indices briefing (for Claude)

**Audience:** another Claude that must judge how SuperNova’s live indices are performing, without re-deriving the UI from scratch.  
**UI page:** Desktop → Model Lab / Models eval → **Comparison** (`ModelComparisonPanel` inside `ModelAccuracyLabView`). Title: *Predictive model comparison*.  
**Snapshot of this briefing:** 2026-09-02 ~09:37 Europe/Rome, **local Electron/desktop session** (not the VPS web copy).  
**Not this page:** the 1Y price/volume charts (`/api/market/volume-history`). This panel never reads that API.

Do **not** re-weight BUY/SELL gates from this dashboard. The page itself says the 95% CIs overlap and n is too small. Treat numbers as exploratory diagnostics.

---

## 1. What the page is answering

Five complementary scores, all plotted against **realized final P&L% of closed real-portfolio trades**:

| Card | What it is | When it is measured | Desired relationship vs P&L |
|---|---|---|---|
| **P(plan)** | Composite entry reliability (affidabilità %) | At BUY | Higher → better P&L. `r↑` and `r↓` both **positive**. |
| **SDS** | Pre-catalyst price-pattern score | **At entry only** (frozen / `entry_sds_score`). Never live SDS on closed deals. | Same as P(plan): both directional r **positive**. |
| **Resilience Score** | Ticker-intrinsic 5y drawdown-recovery + β asymmetry + upside capacity (`prediction/resilience_score.py`) | Snapshot per ticker, independent of SDS / regulatory | Same: both r **positive**. |
| **Regulatory score** | CRL / PDUFA / CMC. Sign convention: **+ = risk, − = favourable** | Frozen or `regulatory_risk_snapshot.json` | **Inverted.** Negative r is the *good* sign (more risk → worse P&L). |
| **EIS Score** | Aggregate Event Impact over **[CD−90d, CD]** (pre-catalyst window) | Frozen at BUY, else feed-window sum | Exploratory. Page currently treats **r↓** (loss mitigation) as the interesting direction, not upside. |

Models are **not interchangeable**. P(plan) is the entry composite; SDS is pattern; Resilience is the name’s own history vs XBI; Regulatory is event risk; EIS is clinical-feed heat before CD.

---

## 2. Cohort (Chart 1 / cards) — this is the only sample that matters

**Universe toggle on Chart 1 was `Portfolio`.** Sim-loop is gone. Cards always use closed portfolio.

Construction (`buildClosedPortfolioRows` in `desktop-ui/src/components/ModelComparisonPanel.tsx`):

1. Read live tester book `invest_sim_inputs` (`soldAt` set).
2. Final P&L% = `(closedValue − closedCapital) / closedCapital × 100`. Skip if P&L cannot be formed.
3. P(plan) = `entryProbPct` on the book, else lookup `entry_affidabilita_pct` / `affidabilita_pct` in `investment_sim_outcomes.json` by `TICKER|CD_DATE`. If still missing → **placeholder 50** and `pplanIsDefault=true`.
4. SDS = outcomes `entry_sds_score` or **frozen feature store** (localStorage, first-write-wins). Live SDS snapshot is **not** used for closed deals.
5. EIS / regulatory / MCS similarly prefer frozen BUY-time features.

**As of this snapshot (local book):**

| | n |
|---|---|
| Closed with P&L (Chart 1) | **47** |
| Excluded from P(plan) correlation (placeholder X=50) | **7** |
| P(plan) correlation sample | **40** |
| Wins / losses in the 47 | 21 / 23 (2 flat-ish in the default-7 set) |
| P&L range (all 47) | **−26.5% … +20.2%**, mean **−0.29%** |

The seven “portfolio without history” names (no P(plan) on the book and no outcomes lookup) are:

`IRWD, VYGR, OLMA, PBYI, TLX, BCAB, CLRB`  
P&L%: `+1.5, 0.0, −2.8, +0.4, −8.4, +2.0, +3.5`.

That banner is **not** “missing 1Y price history”. It is missing **entry P(plan)**.

Independent reproduction from `data/invest_sim_inputs.json` + `data/investment_sim_outcomes.json` recovers P(plan) card math:

- n=40, r↑ **+0.06**, r↓ **+0.15**, r(all) **+0.15**, Fisher 95% CI **[−0.17, +0.44]**
- Win≥60: **43%** on **n=7** (threshold relaxed from 75 because the ≥75 bucket is empty/too small)

SDS/EIS/Reg/Resilience on the **screen** include frozen localStorage features, so they will not match a file-only replay. Trust the UI numbers below for those four.

---

## 3. Metric dictionary (read this before the cards)

All `r` are **Pearson** on `(score, final P&L%)`. Min n for a number = 3 (`corrOnRows`). CI = Fisher z, n≥4.

| Symbol | Definition | How to read |
|---|---|---|
| **r (all)** | corr(score, P&L) on the scored closed sample | Secondary. Mixes winners and losers; easy to misread. |
| **r↑** | Same corr, **wins only** (`pnl > 0`) | “Does a higher score mark *larger* gains?” |
| **r↓** | Same corr, **losses only** (`pnl < 0`) | “Does a higher score mark *shallower* losses?” (less negative P&L). This is what the page calls the **primary** skill. |
| **Win≥T** | Hit rate among names with score ≥ T, T relaxed until the bucket has n≥2. P(plan)/SDS try 75→60→50→40; Regulatory 50→25→15; EIS 25→15→10 | Tiny buckets. 43% on n=7 is not a gate. |
| **Tertile ΔP&L** | Mean P&L high tertile − low tertile (also Spearman on the card) | Robust to 1–2 outliers. Prefer this over OLS if Theil-Sen and OLS disagree on the scatter. |
| Colour bands | \|r\|≥0.30 green/red “directional (exploratory)”; 0.10–0.29 amber “weak / CI overlaps 0”; <0.10 slate “noise” | At n≈40, even \|r\|=0.30 is usually **not** significant. Critical \|r\| for p<0.05 at n=40 is ~0.31. |

**Scatters (Chart 1):** X = score at entry, Y = final P&L%. Green = win, red = loss. Solid line = **Theil-Sen** (robust). Dashed grey = **OLS**. If they diverge, OLS is leverage-pulled; believe Theil-Sen.

**Range restriction (yellow box, important):** the real book only entered names the model already liked. Low scores are truncated. Correlations are **attenuated**. You cannot conclude “P(plan) does not work” from a flat r on a pre-filtered cohort.

---

## 4. Numbers on screen (2026-09-02 local session)

Header:

- Closed deals: **47** · outcomes file gen. **01/09/2026 16:09** (Rome)
- SDS snapshot: **29 ticker** · gen. **02/09/2026 09:04** (Rome) — used for *open* positions / coverage note, **not** for closed-deal SDS X values

### 4.1 P(plan) — composite entry

| | |
|---|---|
| n | 40 (↑17 ↓21 from file replay; UI matches r↑/r↓) |
| r↑ | **+0.06** (noise) |
| r↓ | **+0.15** (weak, right sign) |
| r(all) | **+0.15**, CI ≈ **[−0.17, +0.44]** (crosses zero) |
| Win≥60 | **43%** (n=7) |

**Read:** among names we actually bought, P(plan) does **not** rank the winners. It has a small, correctly signed association with *how bad* the losers were. That is consistent with range restriction: entries already sit in a high band, so leftover variance is mostly downside triage. **Do not raise the P(plan) BUY cut from this.** **Do not drop P(plan) from the stack from this.**

### 4.2 SDS — pre-catalyst pattern (entry-frozen)

| | |
|---|---|
| n | **43** |
| r↑ | **−0.03** (wrong sign, noise) |
| r↓ | **+0.11** (weak, right sign) |
| Win≥40 | **45%** (threshold already relaxed to 40) |

**Read:** closed-deal SDS is **not** predicting upside. Slightly helpful, if at all, on loss depth. File-only replay (outcomes `entry_sds_score`, n=31) looked *worse* on r↑ (−0.36) — the extra frozen rows on screen pull r↑ back to ~0. Need ≥3 closed deals with `entry_sds_score` or freeze; new trades populate automatically. **Do not retune SDS gates from Chart 1.**

### 4.3 Resilience Score — ticker-intrinsic

| | |
|---|---|
| n | **41** |
| r↑ | **+0.06** |
| r↓ | **+0.02** |
| r(all) | **−0.02** |

Local snapshot file `data/resilience_scores_snapshot.json` is **stale (2026-08-11)**. VPS copy is 2026-08-31. Card still scores 41/47 because many tickers exist in the index; **do not treat this as a freshly calibrated factor**. Signal is indistinguishable from zero. Click-through on the card opens the per-ticker breakdown; use that if you need to see who is scored `ok` vs missing history.

Unmeasured threshold is n<8 (`CORR_UNMEASURED_N`). n=41 clears that; the problem is **effect size**, not sample flag.

### 4.4 Regulatory score — inverted scale (this is the only loud card)

| | |
|---|---|
| n | **41** |
| r↑ | **−0.40** (strong; **good** sign because inverted) |
| r↓ | **+0.19** (weak; **bad** sign on inverted scale — among losers, more-risk names lost *slightly less*) |
| Win≥25 | **50%** (threshold relaxed from 50 to 25) |

**Read:** among **winners**, higher regulatory-risk names made smaller gains. That is the intended “+ = risk” convention and the strongest number on the page (\|r↑\|=0.40). Among **losers** the sign flips mildly. Combined story: regulatory risk **caps upside** more than it **deepens losses** in this book. Sign on the axis is verified in code (`invertedScale: true`). **Do not invert the score.** **Do not treat Win≥25 50% as a tradable cutoff** (adaptive bucket).

Scatter for regulatory **dedupes by ticker** (mean P&L if several CDs). Score 0 names are plotted as grey “no signal” dots at x=0 and excluded from the fit.

### 4.5 EIS Score — pre-CD aggregate, exploratory

| | |
|---|---|
| n | **27** (UI note: too few for cohort inference) |
| r↑ | **−0.23** (wrong sign for “high EIS → bigger wins”) |
| r↓ | **+0.32** (directional; high EIS → shallower losses) |
| Win≥25 | **0%** |

**Read:** EIS in this book is a **loss-cushion / mean-reversion-ish** readout, not an upside predictor. That matches the page copy: “scores mainly predict loss mitigation (r↓), not upside (r↑).” n=27, CI overlaps zero — **do not split by EIS band, do not add an EIS BUY threshold, do not rewrite Soft BUY from this.** Win≥25 = 0% is almost certainly a 2–4 name bucket, not a law of nature.

---

## 5. How to rank the five (for a human, not for a weight file)

Ordered by *what you can honestly say today* on this closed-portfolio book:

1. **Regulatory (inverted)** — only index with \|r\|≥0.30 in a direction the scale predicts (r↑ −0.40). Still exploratory; n=41, one side only.
2. **EIS r↓ +0.32** — interesting as **downside cushion**, contradicted by r↑ and by Win≥25=0%. Keep as diagnostic, not a gate.
3. **P(plan) r↓ +0.15** — weak, right sign, CI includes 0. Consistent with truncated high-score entries.
4. **SDS** — flat. Frozen-at-entry coverage is the real SDS workstream, not this r.
5. **Resilience** — zero, and the snapshot on disk is weeks stale.

**None of these justify changing bucket weights, Soft BUY thresholds, or SDS cutoffs.** The yellow box and the footer are the product rule: overlapping CIs at n≈26–40.

---

## 6. Data freshness (local vs VPS) — do not mix them

The screenshot is the **local** desktop book.

| Artifact | Local (this screenshot) | VPS `91.99.15.48` |
|---|---|---|
| Closed deals in book with P&L | 47 | 47 (same tickers; VPS has more `soldAt` rows without P&L) |
| `invest_sim_inputs` updated | 2026-09-01 16:09 Rome | 2026-09-02 09:40 Rome |
| `investment_sim_outcomes.json` | 2026-09-01 16:09 Rome, **150** rows | 2026-09-02 09:38 Rome, **72** rows |
| `sds_snapshot.json` | 2026-09-02 09:04, **n=29** | 2026-09-02 09:04, **n=36** |
| Resilience snapshot | 2026-08-11 | 2026-08-31 |

The “Closed deals: gen. …” timestamp is **`investment_sim_outcomes.json.generated_at`**, not “when the 47 sells happened”. The 47 rows themselves are live `soldAt` in the book.

If you analyse VPS web, expect a **different SDS n** and a **newer outcomes file**. Recompute; do not paste these r’s onto VPS.

---

## 7. Rest of the page (Charts 2–3, summary table) — secondary

- **Chart 2:** same scores vs **T+3 stock move after MCS assignment**, not full-trade P&L. Forward-move validation. Different question.
- **EIS vs T+3** can also plot **per clinical event** (not the [CD−90, CD] sum). Do not mix that r with the card r.
- **MCS (Market Context)** appears in the summary table with inverted scale (high MCS = risk-on / different convention — check `invertedScale: true` on that row). Not one of the five hero cards.
- **Rescue Score** still exists in code (loss-cohort recovery) but the hero card was replaced by **Resilience**. Don’t confuse them.
- Correlation summary table repeats the cards with Fisher CI and n↑/n↓.

---

## 8. Code map

| Piece | Path |
|---|---|
| Page | `desktop-ui/src/components/ModelComparisonPanel.tsx` |
| Parent tab | `desktop-ui/src/components/ModelAccuracyLabView.tsx` (`models-eval` / `comparison`) |
| Pearson / Fisher CI / Theil-Sen | `desktop-ui/src/sheet/statSignificance.ts` |
| Directional r, tertiles, placeholder filter | `desktop-ui/src/sheet/scorePnlCorrelation.ts` |
| Closed-row builder | `buildClosedPortfolioRows` in `ModelComparisonPanel.tsx` |
| Frozen BUY features | `desktop-ui/src/calibration/featureSnapshotStore.ts` (browser localStorage) |
| Outcomes JSON | `data/investment_sim_outcomes.json` (built by `scripts/investment_sim_outcomes.py`, also after sim-inputs PUT) |
| SDS snapshot | `data/sds_snapshot.json` (+ `.last_good`) |
| Resilience | `data/resilience_scores_snapshot.json` |
| Book | `data/invest_sim_inputs.json` and/or tester book via `/api/investment/sim-inputs` |

---

## 9. Working rules for the next Claude

1. **Question being asked:** “On names we already bought and sold, do these scores rank final P&L?” That is **not** “should we BUY this ticker tomorrow?”
2. **Primary metrics are r↑ and r↓**, not r(all). r(all) can hide a useful r↓ behind a dead r↑ (P(plan), EIS).
3. **Regulatory is inverted.** A red r↑ would be a problem; −0.40 is the *healthy* colour.
4. **Range restriction:** low scores are missing by construction. Flat r ≠ useless score.
5. **n per directional split is ~13–21.** Treat \|r\|=0.3 as a hint, not a p<0.05 result.
6. **Do not** change Soft BUY, SDS gates, EIS bands, or bucket weights from this panel.
7. **Do not** “fix” the 7 placeholders by imputing 50 into the correlation — they are already excluded; that is correct.
8. If asked to refresh the tab: rebuild/sync `investment_sim_outcomes.json` (local is a day behind VPS) and `resilience_scores_snapshot.json` (weeks behind). SDS this morning is fine.
9. If asked about 1Y curves: wrong surface. Price/volume vs EIS charts, not this panel.

---

## 10. One-paragraph status (pasteable)

On 2026-09-02 the local Comparison tab scores **47 closed real-portfolio trades** (40 with a real P(plan); 7 excluded as X=50 placeholders). **P(plan)** does not rank winners (r↑ +0.06) and only weakly ranks losers (r↓ +0.15); 95% CI on r(all) is [−0.17, +0.44]. **SDS** is flat (r↑ −0.03, r↓ +0.11). **Resilience** is noise and its on-disk snapshot is stale. **Regulatory** (inverted: +risk/−fav) is the only loud result: r↑ −0.40 among winners (higher risk, smaller gains); r↓ +0.19 among losers is the wrong inverted sign. **EIS** (n=27) looks like loss mitigation (r↓ +0.32) not upside (r↑ −0.23, Win≥25 = 0%); the UI already forbids cohort inference. None of this is a mandate to reweight the live recommendation stack.
