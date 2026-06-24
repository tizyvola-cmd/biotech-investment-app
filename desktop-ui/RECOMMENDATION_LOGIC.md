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

**SELL** only if `exitDecision = exit` and all fail:

- `curveRisingHold`
- Top2 = wait
- P(recovery) ≥ 55% and covers loss

### Off-portfolio BUY paths (priority order)

All BUY paths require **positive expected forward gain** (`planReturnPct > 0`, positive curve peak, or positive Pred+5 with model not declining). P(recovery) alone is not enough.

1. Top2 yes + exit hold/review
2. Top2 yes + exit + precat enter/accumulate + P(plan) ≥ 40%
3. Top2 wait + precat enter/accumulate + P(plan) ≥ 45%
4. Momentum override: Var.24h ≥ 0.5% + P ≥ 45% — **blocked** if precat avoid + forward model declining, or **expected gain ≤ 0**
5. Watch zone T−61…120 + precat accumulate/enter + P ≥ 40%
6. Precat late + momentum + P ≥ 45%

## Exit decision — `mapInvestVerdictToExit`

Recovery / curve ↑ overrides mechanical exit from slope/precat when P(recovery) suggests hold.

## UI alignment

- **PlanProbHero** uses `suggestedAction` (via `planProbDecisionForDisplay`), not raw `exitDecision` alone.
- **Alerts**: BUY, SELL, and portfolio **HOLD** with `holdThesis` trigger popups.
- **Charts** in alert modal:
  - Pred sparkline: absolute pre-CD, forward ~T+7
  - Slope trajectory: % vs today, model to T+90 post-CD
  - Gain plan marker: prefer `daysToTarget` over `daysToCd`

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
