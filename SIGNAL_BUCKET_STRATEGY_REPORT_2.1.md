# Signal bucket strategy report 2.1 — MII / SDS / P(plan) / Crown

Version: **2.1**

### Changelog vs 2.0 / v1

| Change | Detail |
|--------|--------|
| **Lift definition (critical)** | **v1 chart tables** reported lift as **median forward return pp** (e.g. SDS universe +0.3pp = 0.2% − (−0.1%) median). **v2.0+ chart tables** report **win-rate pp** (e.g. +9.3pp = 54.2% − 44.9%). Same raw win%, different unit — **do not compare 0.3pp vs 9.3pp as “SDS got stronger”**. v2.1 shows **both** where relevant (win primary, median fwd labelled “v1 metric”). |
| **CI vs baseline test** | Wilson 95% CI on bucket win-rate; flag if **baseline falls inside CI** (cannot reject equality). Tier ✓/△ now uses CI exclusion, not n alone. |
| **History CI** | Wilson CI added to §5c (was missing in 2.0). |
| **Coverage footnote** | P(plan) row count vs Δ24h outcome count explained (§6). |
| From 2.0 | n≥20 lift rule, provisional banner, crown proxy removed, P(plan) null result, SDS directional concordance. |

Generated: 2026-08-31T10:46:14.634Z

> Handoff for Claude / next agent. **Read §0 and changelog before any gate change.**

---

## 0. Status — PROVISIONAL (crown log missing)


**Every conclusion in §3–9 is a hypothesis until crown log (37 Strong∩PF hits) + Grado 4.**

- Proxy tags = today's SDS/P(plan)/MII on historical windows → **look-ahead bias**.
- Do **not** change Soft BUY/SELL gates from this report alone.


---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| **Strongest directional signal?** | **SDS≥40** — positive **win-rate lift** in all 4 windows (§3). But **only 1/3** chart/history windows with CI have baseline **outside** bucket CI (others: baseline inside CI → direction only, not confirmed separation). |
| **P(plan)≥55 predictive?** | **No** — flat/negative win-rate lift; high coverage = poor separator (§4). Product role only. |
| **MII+volume alpha?** | **No** — negative when n≥16; ignore n=3 “positive”. |
| **v1 vs v2 “SDS got stronger”?** | **No** — mostly **lift metric change** (median fwd → win-rate). See changelog. |
| **Change gates now?** | **No** — crown Grado 4 first. |

---

## 2. Methodology

| Rule | Value |
|------|-------|
| **Primary lift (chart/history)** | **win-rate pp** = bucket win% − baseline win% |
| **Secondary lift (v1 comparable)** | **median forward return pp** — shown as “v1 metric” in chart rows |
| Report lift when | n≥20 († = raw if n<20) |
| **Evidence tier** | ✓ = CI excludes baseline; △ = CI overlaps OR marginal exclusion OR n<30; ⚠ = n<20 |
| Win-rate CI | Wilson 95%; **baseline inside CI → cannot reject equal win-rate** |

---

## 3. Tier A — SDS≥40 (concordance + CI test)

| Signal | Window | n | Win-rate (CI) · baseline | Lift (win · v1 med fwd) | CI vs baseline | Evidence |
|--------|--------|---|--------------------------|-------------------------|----------------|----------|
| SDS≥40 | Δ24h cross-section | 6 | win 16.7% [3.0%, 56.4%] | -2.1pp † (win) · +0.6pp † (median Δ24h) | baseline 18.8% inside CI [3.0%, 56.4%] → cannot reject equal win-rate at ~95% | ⚠ n=6 — non significativo (n<20) |
| SDS≥40 | chart forward +5d | 72 | win 54.2% [42.7%, 65.2%] · baseline 44.9% | +9.3pp · med fwd +0.3pp (v1 metric) | baseline 44.9% inside CI [42.7%, 65.2%] → cannot reject equal win-rate at ~95% | △ n=72 — **CI overlaps baseline** (direction only) |
| SDS≥40 | off-book chart +5d | 44 | win 56.8% [42.2%, 70.3%] · baseline 42.0% | +14.8pp · med fwd +2.4pp (v1 metric) | baseline 42.0% just outside CI (Δ0.2pp) — weak exclusion | △ n=44 — CI excludes baseline **marginally** |
| SDS≥40 | history weekly fwd | 27 | win 55.6% [37.3%, 72.4%] · baseline 47.3% | +8.3pp | baseline 47.3% inside CI [37.3%, 72.4%] → cannot reject equal win-rate at ~95% | △ n=27 — **CI overlaps baseline** (direction only) |

**Reading (honest):** SDS is **directionally concordant** (positive win-rate lift in all four windows). Statistically: check **CI vs baseline** column — where baseline sits **inside** the bucket CI, the lift is **directional only**, not confirmed at ~95%. This is **weaker than “strongest empirical pattern”** but still the **most promising signal in the report** pending crown Grado 4.

---

## 4. Tier A — P(plan)≥55 null result

| Signal | Window | n | Win-rate (CI) · baseline | Lift | CI vs baseline | Evidence |
|--------|--------|---|--------------------------|------|----------------|----------|
| P(plan)≥55 | Δ24h cross-section | 19 rows w/ Δ24h (20 in bucket) | win 10.5% [2.9%, 31.4%] | -8.3pp † (win) · -0.9pp † (median Δ24h) | baseline 18.8% inside CI [2.9%, 31.4%] → cannot reject equal win-rate at ~95% | ⚠ n=19 — non significativo (n<20) |
| P(plan)≥55 | chart forward +5d | 450 | win 44.0% [39.5%, 48.6%] · baseline 44.9% | -0.9pp · med fwd -0.0pp (v1 metric) | baseline 44.9% inside CI [39.5%, 48.6%] → cannot reject equal win-rate at ~95% | △ n=450 — **CI overlaps baseline** (direction only) |
| P(plan)≥55 | off-book chart +5d | 366 | win 40.4% [35.5%, 45.5%] · baseline 42.0% | -1.6pp · med fwd -0.2pp (v1 metric) | baseline 42.0% inside CI [35.5%, 45.5%] → cannot reject equal win-rate at ~95% | △ n=366 — **CI overlaps baseline** (direction only) |
| P(plan)≥55 | history weekly fwd | 179 | win 46.4% [39.2%, 53.7%] · baseline 47.3% | -0.9pp | baseline 47.3% inside CI [39.2%, 53.7%] → cannot reject equal win-rate at ~95% | △ n=179 — **CI overlaps baseline** (direction only) |

**Reading:** Consistently flat or negative win-rate lift. **Product conviction ≠ predictive filter** at this cutoff.

---

## 5. Tier B — small-n (do not cite lift)

| Bucket | n | Note |
|--------|---|------|
| MII+vol cross-section | 3 | Suppressed — n<20 |
| SDS ∩ P(plan) | 2 | Too few |
| MII+vol chart | 16 | Negative lift when n≥16 |

---

## 6. Signal coverage (universe n=33)

| Metric | Count |
|--------|-------|
| SDS≥40 rows | 6 |
| P(plan)≥55 rows | 20 |
| MII+vol | 3 |
| In PF | 3 |

**Coverage vs cross-section:** 20 rows pass P(plan)≥55 in universe; cross-section outcomes use **19** rows with valid Δ24h (20 in bucket, 1 missing Var. Giorn.).

---

## 7. Detail tables

### 7a. Cross-section Δ24h

| Bucket | rows in bucket | w/ Δ24h | median Δ24h | win lift | CI test |
|--------|----------------|---------|-------------|----------|---------|
| SDS≥40 | 6 | 6 | -1.9% | -2.1pp † | overlaps |
| P(plan)≥55 | 20 | 19 | -3.4% | -8.3pp † | overlaps |

### 7b. Chart forward

| Bucket | n | win · CI | lift win · v1 med fwd | CI test |
|--------|---|----------|----------------------|---------|
| SDS≥40 | 72 | win 54.2% [42.7%, 65.2%] · baseline 44.9% | +9.3pp · med fwd +0.3pp (v1 metric) | overlaps |
| P(plan)≥55 | 450 | win 44.0% [39.5%, 48.6%] · baseline 44.9% | -0.9pp · med fwd -0.0pp (v1 metric) | overlaps |

---

## 8. Crown log

**Missing** — Grado 3 → Export crown log → `data/whatif_crown_hits_export.json`

---

## 9. KEEP / DEPRIORITIZE / NEXT

**KEEP:** SDS gate (best directional + some CI support); P(plan) in UI; crown log; low_liq; MCS.

**DEPRIORITIZE:** MII hard gate; “volume best predictor”; claiming P(plan)≥55 predicts.

**NEXT (P0):** Crown export → Grado 4 → re-run this script → gate changes only if crown readouts confirm SDS.

---

## 10. Limitations

- PROVISIONAL: crown log (Strong∩PF ground truth) not loaded — sections 4–5c use static proxy tags with look-ahead bias.
- Lift in pp suppressed when n<20; treat n=20–29 as caution only.
- Signals are CURRENT snapshot tags applied to historical forward windows.
- Crown log outcomes are session-day what-if P&L, not realized trades.
- MII mom proxy ≠ real MII (entrySolidityMig is the single source of truth).
- PF book in snapshot may be tiny — prefer universe + crown export for gate changes.

---

## 11. Commands

```powershell
cd "c:\coding\Biotech_Investment app 6\desktop-ui"
npx tsx scripts/diag-signal-bucket-compare.ts
```

Files: `SIGNAL_BUCKET_STRATEGY_REPORT_2.1.md` · `data/diag_signal_bucket_compare.json`
