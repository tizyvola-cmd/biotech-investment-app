# Rec counterfactuals — what Comparison cannot see

**Date:** 2026-09-02  
**Script:** `scripts/diag_rec_counterfactual.py` → `data/diag_rec_counterfactual.json`  
**Question:** Do SDS≥20 / P(plan)≥50 add entry edge vs names that failed *only* those gates? Do SELL exits beat hold-anyway?

This is the test the Comparison panel is structurally blind to. Numbers below are first-pass, with n that is still small. Do not retune gates from a single day’s dump.

---

## Verdict in one paragraph

**Entry:** among names that already got into the outcomes replay, P(plan)≥50 adds **no detectable P&L edge** vs SDS-ok names with P<50 (mean +1.92% vs +1.85%, n=69 vs 16). SDS<20 is almost absent from that file (n=1), so the SDS floor is untested there. On the *current* off-book Simulation snapshot, the three names that fail **SDS only** (high P, SDS<20) are ugly on trailing 1M (mean −37%, BJDX/CODX crashes) — that is the first hint the SDS floor is doing scrap-filtering, but n=3. **SELL:** after 47 real closes, Yahoo to now is a coin flip overall (21 “sold was right” / 47 = 45%; median after-sell **+1%**). The G1 loss band (−12% to −2.5%, the score-trigger zone) is also a coin flip (median **0%**, mean **−1.5%**). Deep floor n=4 is mixed (saved CRDF, sold VIR too early). Tiny reds (n=4) **all** bounced; SKYE +193% after a −1.6% two-day roundtrip dominates the mean. Green-at-sell exits (n=24) saved disasters (KPTI −81%, BCAB −70% after taking a small gain) and also left rips (PLSE +114%). **Net: mechanical tail control has a clearer fingerprint than the score gates.**

---

## 1. Entry counterfactual

### 1A. Outcomes replay (`investment_sim_outcomes.json`, 143 rows with P&L)

This is still a **selected** population (they entered a sim/replay). Almost everyone already has SDS≥20.

| Bucket | n | Mean P&L% | Median | Win% |
|---|---:|---:|---:|---:|
| PASS SDS≥20 & P≥50 | 69 | +1.92 | 0.0 | 49 |
| FAIL P only (SDS≥20, P<50) | **16** | **+1.85** | 0.0 | 44 |
| FAIL SDS only (P≥50, SDS<20) | **1** | −4.83 | — | 0 |
| FAIL both | 2 | +2.24 | +6.0 | 50 |
| No SDS recorded | 55 | +3.66 | +0.7 | 58 |

**Read:** the only comparison with n>10 is PASS vs FAIL-P-only. They are the same trade. **P(plan)≥50 is not ranking extra edge inside names the system already touched.** SDS<20 is not in this file — you cannot credit or blame the SDS floor from outcomes.

### 1B. Current off-book Simulation (30 names not in the open book, trailing Var 1M %)

Proxy, not path-from-decision-date. Several “off-book” names are **already sold** (MSLE, NRIX, …) still sitting on the Simulation tab — their +1M is partly the hold-anyway story, not a never-bought story.

| Bucket | n | Mean 1M% | Median | Win% | Who |
|---|---:|---:|---:|---:|---|
| PASS both (SDS≥20, P≥50) | 13 | +17.3 | +15.2 | 77 | MSLE, NRIX, CERS, SRPT, … (many recently sold) |
| FAIL SDS only (P≥50, SDS<20) | **3** | **−36.8** | −45.7 | 33 | **BJDX −69, CODX −46, PODD +5** |
| FAIL P only (SDS≥20, P<50) | 5 | +10.5 | +4.2 | 80 | KZIA +19, ZNTL +36, SKYE −10, VNDA +3, INBX +4 |
| FAIL both | 3 | +7.7 | −3.5 | 33 | NSPR, AXSM, SNDX |
| Missing SDS | 4 | +22.6 | +24.5 | 100 | JSPR, SYRE, … |

**Read:** the SDS-only fails are the first *scrap* signal: high P(plan), SDS in the cellar, 1M destruction. n=3 — treat as a hypothesis, not a gate change. FAIL-P-only is mixed and small; it does **not** say “we should have bought them” (trailing 1M, some already in the sold book).

**What we still lack:** a daily log of off-book names that failed *only* SDS or P on day T, with forward return T→T+20. Missed-opp / what-if snapshots can do that next; this pass does not.

---

## 2. SELL hold-anyway (47 closed book lots, Yahoo 1d from `soldAt` → last close)

We do **not** have live Reg / Risk v2 / P(plan) at the sell tick. Buckets use **realized P&L at exit**, which is what Soft SELL G1 and the −12% floor actually key off.

`after_sell > 0` = selling left money on the table. `after_sell < 0` = selling avoided more damage.

| Exit class | n | After-sell mean | After-sell median | Sold was right |
|---|---:|---:|---:|---|
| All closed | 47 | +5.3% | **+1.0%** | 21/47 (**45%**) |
| Deep floor (≤ −12%) | 4 | −0.7% | +3.6% | 2/4 |
| **G1 zone (−12% to −2.5%)** | **15** | **−1.5%** | **0.0%** | **7/15 (47%)** |
| Shallow red (−2.5% to 0) | 4 | +52.7%* | +8.7% | 0/4 |
| Green or flat at sell | 24 | +2.7% | +1.4% | 12/24 (50%) |

\*Mean is **SKYE +193%** after a −1.6% / 2-day hold. Without SKYE the shallow mean is ~+6%.

### G1 zone (the score-trigger candidate)

Coin flip. Mean slightly **helps** hold-anyway? No: mean −1.5% means the path *after* sell drifted a bit more down — selling was **slightly** right on average, median exactly 0.

Saved: LTRN −35% after, WVE −13%, CHRS −6%, GRCE −6%.  
Too early: TLX +15% after, CRDL +9%, OLMA +8%, CCCC +4%.  
KZIA / NSPR sold 2026-09-01 → after=0 (no path yet).

**This does not validate Reg≥45 / Risk≥40 / P<50 as timers.** It says: once you are already −2.5% to −12%, getting out vs staying is ~50/50 on the subsequent path.

### Deep floor (mechanical, n=4)

| Ticker | Realized | After sell |
|---|---:|---:|
| CRDF | −14.6 | **−27.5** (floor saved another −13) |
| ZNTL | −15.6 | −10.6 (saved a bit more) |
| CERS | −26.5 | +3.6 (small bounce) |
| VIR | −12.7 | **+31.9** (sold the low) |

Exactly the job description of a tail cap: one name kept crashing, one name reversed. You do not need a score to justify −12%.

### Green-at-sell (n=24) — not Soft SELL G1

Half right. The right calls are brutal: **KPTI −81%** and **BCAB −70%** after taking +2–4%. The wrong calls are rips after tiny wins (PLSE +114% in 1 day — likely noise/holding_days=1). This is take-profit / continuation / manual, not the score stop.

### Shallow red (n=4)

All four rose after exit (COCP, VERA, NRIX, SKYE). Three were 2-day roundtrips. **Do not Soft-SELL −1% noise** is the honest read; n is too small to legislate.

---

## 3. What this does (and does not) change

Keep:

- Deep floor **−12%** and Urgent **G2** as the risk spine. CRDF/KPTI/BCAB are the existence proof.
- Soft BUY **largo** as a volume strategy. Entry scores are not shown to be stock-pickers on this book.

Do not, from this dump:

- Raise P(plan) or SDS cuts (no extra edge vs fail-P; SDS floor only n=3 scrap).
- Add EIS to G1 (not tested here; still low weight).
- Treat Reg≥45 as a proven stop timer (we never saw Reg at sell time; G1-zone path is 50/50).

Next measurement if you want a real gate test:

1. Daily off-book snapshot: fail-only-SDS vs fail-only-P vs pass, **forward** 5d/20d (not trailing 1M).
2. On each Soft SELL, persist `{reg, riskV2, pplan, pnl}` at fire time, then the same Yahoo hold-anyway path.

---

## 4. Re-run

```powershell
cd "c:\coding\Biotech_Investment app 6"
.\.venv\Scripts\python.exe scripts\diag_rec_counterfactual.py
```
