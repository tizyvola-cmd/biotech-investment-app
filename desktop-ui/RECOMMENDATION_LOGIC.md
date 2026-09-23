# Recommendation logic — Biotech Investment app

Single source of truth for BUY / SELL / HOLD / REVIEW. Used by sim loop, popups, Tester monitor, and Copilot.

## Principle

**One operational action per ticker per tick.** Intermediate layers (precat, slope, Top2) are inputs, not final recommendations.

## Top2 verdict semantics

| Profile | `investVerdict = yes` means |
|---------|----------------------------|
| Opportunity (buy-side) | Yes, **enter** |
| Portfolio (sell-side) | Yes, **exit** |

UI must label **Top2 ingresso** vs **Top2 uscita** — never bare "yes".

## Final action — `deriveSuggestedAction(item, inPaper)`

### Paper portfolio (`inPaper = true`)

- `exit` → **SELL** unless recovery guards → **HOLD**
- `hold` → HOLD
- else → REVIEW

### Real portfolio (`hasPosition`, not in paper)

Same recovery guards on `exit` as paper (P2).

**SELL** if `exitDecision = exit` and the recovery thesis is dead:

- P(recovery) &lt; 55% **or** curve does not cover the loss
- Meaningful peak (≥2%) that explicitly covers the loss can still Hold
- `curveRisingHold` / Top2=wait / micro-peak / flat 24h alone do **not** block Sell
- **Never SELL when MTM &gt; 0** (take-profit is manual) — includes Gen 4 giveback and continuation exhaustion
- **Giveback Soft SELL** needs open MTM **&lt; 0** (flat €0 after a fresh buy is not an exit), peak ≥ **€100**, drop from peak ≥ **20%** of **(purchased capital + peak gains)**; peak scoped to the **current open run** (`investedAt` + sell-gap in history). A prior hold’s peak must not Soft-SELL a fresh Soft BUY. Red Pulse/mobile bell uses the same threshold.
- **Never SELL when the session day is green** (Var. Giorn. &gt; 0) — even if total MTM is still mildly red (CERS +13% day / −2.8% total must not show SELL)

**Soft / urgent SELL (promote REC, escape sticky HOLD / rescue Uncertain):**

1. **Soft SELL G1** — open book (trial: more aggressive):
   - total P&amp;L ≤ **−12%** → **SELL** (deep floor — no risk/reg/P required, **immediate**), **or**
   - total P&amp;L ≤ **−2.5%** and (Risk v2 ≥ **40** **or** Reg ≥ **45** **or** P(plan) &lt; **50**) **after ≥ 3 NYSE sessions** (buy day = 0; weekend does not count), **or**
   - total P&amp;L ≤ **−6%** with risk/reg/P all missing (orphan enhance) **after the same 3-session hold**
2. **Urgent SELL G2 (hard book stop, automatic)** — **book-wide** (not per ticker): day losses € (today 24h + prior session) vs **purchased + open gains** (`Σ capital + Σ max(0, MTM €)`). Trigger when `|day losses| > 20% × (purchased + gains)` (`budgetEur = purchasedPlusGainsEur × 0.20`). Then **auto-sell** worst day losers (**fastest day %** = most drastic loss in the time unit) until remaining losses fit the budget. Skip MTM &gt; 0. Desktop + mobile notify **sold tickers** (auto-sold modal / snapshot `autoSold`).
3. Recovery guards can demote Soft SELL → HOLD, but **not** Urgent G2 (equity-budget cut wins). Deep floor ≤ **−12%** also ignores recovery. Never SELL if MTM &gt; 0 (green MTM + red day is not auto-SELL)

**Volume strategy:** Soft BUY is intentionally looser (more entries / more false positives OK); G2 hard-caps day losses at 20% of (purchased + gains) and exits the fastest day losers automatically.

**Grade 3 Soft BUY sizing (Gen 4):** demoted names stay BUY but size down by Soft BUY gate tier — **strong 100% · mid 70% · weak 40%** of base (`softBuyCapitalFromGateStrength`). Applies to Register Buy suggested capital, Home Soft BUY `suggestedCapitalEur`, mobile Soft BUY trade draft, and synth/auto paper `resolveBuyCapital` (after SDS/EIS safety).

### Issuer resilience (Decision Chart scores)

From Simulation row: market cap, ADV20, β, FY liquidity, commercial/approved phase.

- **Fragile** (small/illiquid) + rescue P&amp;L ≤ −5% + weak P/MCS → **Sell** (not parked in Uncertain)
- **Resilient** (large/liquid/commercial) + MTM ≥ 0 + P(plan) ≥ 45 → **Hold**
- EIS remains setup evidence; MCS still dominates external-vs-internal rescue framing

### Off-portfolio BUY paths (priority order)

All BUY paths require **positive expected forward gain** (`planReturnPct > 0`, positive curve peak, or positive Pred+5 with model not declining). P(recovery) alone is not enough.

1. **Soft BUY G1 (volume) = Home Suggested BUY** — SDS ≥ **20** · P(plan) ≥ **50** · **rising ≥ 2 sessions** (today + prior green) · precat **sell** blocks · tape not catastrophic. **Gen 4:** Top2 NO / weak P(cont) **do not hard-block** — they demote ranking + **Grade 3 size** (strong/mid/weak). Wind-run G1w still promotes on 10d+P(cont). Forward target ≥3% is **not** required for G1. Same list as Home cutoff what-if. Off-book names that miss Soft BUY but have **P(plan) ≥ 50** → **HOLD** (wait), not blanket Uncertain. **Post-sell cooldown (5d):** after a real-book sell (`ignoreSheet`+`soldAt`), Soft BUY cannot re-propose that company (warrant/common shared) — avoids sell→Suggested BUY churn.
1b. **Soft BUY G1c (study override)** — SDS ≥ **40** · P(plan) ≥ **55** · forward ≥ **3%** · **rising ≥ 2 sessions** · same **P(cont)/edge** filter when 10d % ≥ +5% → propose **BUY** even if Top2 NO or precat avoid (β block at **3.0**)
1c. **Home cutoff what-if** — SDS/P + ↑≥2d for capture KPIs only. **Suggested BUY pills = Soft BUY G1 list** (`ops.buys` / `deriveSuggestedAction`), not the raw cutoff ticker list. Must match Evaluation.
1d. **Soft BUY G1v High Vol** — cheap pre-filter **VOL vs prev ≥ 150%**, then confirmed 5m RVOL log-slope (**T_double ≤ 30 min**, R²≥0.6, 2 consecutive buckets, dollar-volume floor). Off-book · green day · tape · !precat sell · !warrant. **SDS/P and ↑2d are not required.** Chip suffix **High Vol**. First flag of the session starts a scoped **EIS / clinical-pre-CD search** for that ticker. Quality gates (β/liq/momentum) do not drop High Vol (same as G1w).
2. Strict Top2 yes + ENTER + P(plan) ≥ 60% + study evidence (SDS/EIS)
3. Other legacy Top2 / momentum / watch paths as implemented in `qualifiesStrictOpportunityBuy`

**BUY quality gates (post-promotion → REVIEW if any fail)** — `recommendationSignalGates.ts` / `recommendationSignalConfig.ts`:

| Gate | Rule |
|------|------|
| Weighted price momentum | 24h **35** · 7g **30** · 3M **20** · 6M **15** (renormalize if missing). Demote if score &lt; **−4**. No horizons → neutral (does not block). |
| Beta | Demote if β &gt; **2.0** |
| Liquidity FY | Demote if score 0–1 &lt; **0.25** |

Never invent SELL from these gates. Wire via `enhanceCtx.simRow` (+ optional `chartPts`).

## Exit decision — `mapInvestVerdictToExit`

Recovery / curve ↑ overrides mechanical exit from slope/precat when P(recovery) suggests hold.

## UI alignment

- **Single arbiter everywhere:** Pulse Rec, Cutoff operative BUY/SELL, Simulation Rec, Decision Chart buckets, Top KPI chips — all use `deriveSuggestedAction` (+ Soft/Urgent enhance). Do **not** let Decision Chart `getRecommendation` (score rules) override the loop when an operational action is present.
- **Decision Chart score-only Soft BUY** also requires `risingStreakOk` (↑≥2 sessions) and `continuationOk` (P(cont)/edge when 10d % ≥ +5%) — same Soft BUY gates; no SDS/P Soft BUY on red days or exhausted runs.
- Open-book `buy` from the loop displays as **HOLD** (keep) on Pulse / Decision Chart.
- **PlanProbHero** uses `suggestedAction` (via `planProbDecisionForDisplay`), not raw `exitDecision` alone.
- **Alerts**: BUY, SELL, and portfolio **HOLD** with `holdThesis` trigger popups (auto-popup on app open disabled).
- **Charts** in alert modal:
  - Pred sparkline: absolute pre-CD, forward ~T+7
  - Slope trajectory: % vs today, model to T+90 post-CD
  - Gain plan marker: prefer `daysToTarget` over `daysToCd`
- **Cutoff sweet-spot tickers** (SDS×P sweep what-if) are **not** the same list as Operative BUY — that box is Soft BUY G1 only.

## Misalignments (warnings only)

| ID | Trigger |
|----|---------|
| harmony_pred_slope | Overlay ≠ slope trajectory |
| target_vs_supernova | Plan target ≠ forward pre-CD peak (>2.5 pp) |
| precat_vs_verdict | Precat buy + Top2 no, or precat avoid + Top2 yes |
| spot_vs_model | Spot vs model today > 8% |
| slope_sign_mismatch | slope5 sign ≠ pred+5 |

## Composite score (CD zone weights v1.0)

Auxiliary signal **0–100** from `computeCompositeScore()` — does **not** override recovery guards or Top2/precat rules.

| Zone | When | Dominant indices |
|------|------|------------------|
| hot | CD ≤60d, not in loss | P(plan) 32%, Top2 24%, precat 18% |
| watch | CD 61–120d | P(plan) 26%, SDS 11%, conf 10% |
| early | CD >120d | SDS 24%, conf 22%, EIS 16% |
| loss | Portfolio + P&L < −2% | slope 18%, conf 12%, top2 8% |

**Priority order (unchanged):**
1. Recovery guards → always win
2. `deriveSuggestedAction()` → final action
3. `compositeScore` → ranking, popup confidence, Learning Lab

**Composite-only nudges:**
- Portfolio exit borderline → `review` if zone=loss and score ≥40 (else `sell`)
- Opportunity `hold` → `review` if score ≥55

Weights in `src/lib/scoring/zoneWeights.ts` — calibrate only after backtest (`compositeScoreBacktest.ts`).

## Key thresholds

| Parameter | Value |
|-----------|-------|
| P(plan) min BUY | 40% |
| P(plan) watchlist BUY | 45% |
| P(recovery) HOLD | 55% |
| Momentum 24h | +0.5% |
| Momentum P min | 45% |
