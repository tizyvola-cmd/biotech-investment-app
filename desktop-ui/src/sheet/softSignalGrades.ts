/**
 * Soft / urgent grades that promote final BUY/SELL REC (not badge-only).
 *
 * Strategy (2026-08-13): wider Soft BUY volume (Top2 NO / P(cont) demote
 * only) + per-ticker giveback Soft SELL (20% of **purchased + gains**) +
 * hard Urgent SELL G2 when book day losses exceed **20% of
 * (purchased capital + open gains)** on the whole portfolio
 * (budget = purchasedPlusGainsEur × fraction).
 *
 * Grade 1 soft BUY — off-book SDS≥20 · P(plan)≥50 · rising ≥2 sessions
 *   (Top2 / P(cont) rank only; forward target not required).
 * Grade 1c study override — SDS≥40 · P≥55 · forward≥3% · rising ≥2d may clear Top2 NO.
 * Grade 1v High Vol — off-book volume acceleration (T_double ≤30 min, confirmed)
 *   · green day · tape · !precat sell. SDS/P and ↑2d are not required.
 * Grade 1d day-1 catalyst — SDS≥20 · P≥50 · Vol surge (≥150% or T_double) ·
 *   news Scores Σ>0 · green day · tape · !precat. ↑2d not required (desk align).
 * Grade 1 soft SELL — open book P&L≤−2.5% + (risk≥40 | reg≥45 | P&lt;50 |
 *   g10 declining / not-in-regime / exhaustion edge&gt;0 | catalyst news Σ&lt;0)
 *   after ≥3 NYSE sessions (buy day = 0). Deep floor ≤−12% is immediate.
 * Giveback Soft SELL — drop from peak ≥20% of (capital + peak gains) **and**
 *   open MTM € &lt; 0 → SELL (flat €0 at cost is not an exit; never auto-SELL
 *   a still-green winner). Peak scoped to the **current** open (`investedAt`).
 *   Min peak € required so noise / fresh buys cannot trip giveback.
 * Grade 2 urgent SELL — book-wide day-loss budget (20% of purchased+gains)
 *   → auto SELL worst day-% losers (most drastic loss in the time unit)
 *   until under budget; ties break on cont cut priority; UI + mobile notify
 *   sold tickers only.
 * Grade 3 sizing — Soft BUY capital × gate tier (strong 100% · mid 70% ·
 *   weak 40%) on Register Buy + synth/auto paper (`softBuyCapitalFromGateStrength`).
 *
 * Cutoffs from diag-soft-buy-whatif.ts / diag-upside-cutoff-sweep.ts /
 * diag-half-wins-sell-cutoff.ts.
 */

import {
  contLossSideSellBoost,
  contSellCutPriority,
} from "./continuationScore";
import {
  givebackAlertEligibleSinceInvestedAt,
  nyseSessionsElapsedSince,
} from "./marketSession";

/** Soft BUY volume trial — was 25, then 20. */
export const SOFT_BUY_G1_SDS_MIN = 20;
/** Soft BUY volume trial — was 55. */
export const SOFT_BUY_G1_PPLAN_MIN = 50;
/** Soft BUY preferred forward plan — G1 also accepts any forward >0. */
export const SOFT_BUY_G1_MIN_PLAN_RETURN_PCT = 3;
/**
 * Soft BUY G1c — study override of Top2 NO when forward≥3%.
 * Still passes through quality gates (β / liq / momentum).
 */
export const SOFT_BUY_G1C_SDS_MIN = 40;
export const SOFT_BUY_G1C_PPLAN_MIN = 55;

/** Soft SELL entry (with risk/reg/P weakness) — was −4 (trial: more aggressive). */
export const SOFT_SELL_G1_PNL_PCT = -2.5;
/** Absolute floor: deep open loss → SELL even if risk/reg/P look fine or missing. Was −15. */
export const SOFT_SELL_G1_DEEP_PNL_PCT = -12;
/**
 * When risk/reg/P are all unavailable, still Soft-SELL from this drawdown
 * (avoids sticky HOLD on names like JSPR with empty enhance). Was −8.
 */
export const SOFT_SELL_G1_ORPHAN_PNL_PCT = -6;
export const SOFT_SELL_G1_RISK_V2 = 40;
export const SOFT_SELL_G1_REG = 45;
export const SOFT_SELL_G1_PPLAN_MAX = 50;
/**
 * Mild / orphan Soft SELL G1 waits this many NYSE sessions after the buy
 * day (buy = 0). Blocks 1–2 day −1% noise (SKYE/COCP). Deep floor skips it.
 */
export const SOFT_SELL_G1_MIN_HOLD_SESSIONS = 3;

/**
 * Soft Soft SELL giveback — Suggested SELL when the name has dropped this
 * fraction of **(purchased capital + peak open gains)** from peak, and MTM &lt; 0.
 * (Red campanella per-ticker is separate: {@link GL_WIN_ALERT_FRAC_DEFAULT}.)
 */
export const SOFT_SELL_GIVEBACK_FRAC = 0.2;
/** Ignore giveback until the open printed at least this much € profit. */
export const SOFT_SELL_GIVEBACK_MIN_PEAK_EUR = 100;

/**
 * Pick-stocks / Pulse campanella — % of **G/L won** (not of capital bought).
 * Default 10%; user-overridable via uiPrefs `glWinAlertPct`.
 * Portfolio auto-sell stays Urgent G2 (20% of purchased + open gains).
 */
export const GL_WIN_ALERT_PCT_DEFAULT = 10;
export const GL_WIN_ALERT_FRAC_DEFAULT = GL_WIN_ALERT_PCT_DEFAULT / 100;
/** Clamp user % to a sane range. */
export const GL_WIN_ALERT_PCT_MIN = 1;
export const GL_WIN_ALERT_PCT_MAX = 50;

/** @deprecated use {@link GL_WIN_ALERT_FRAC_DEFAULT} — old capital-based −5%. */
export const POSITION_SHARE_LOSS_ALERT_FRAC = GL_WIN_ALERT_FRAC_DEFAULT;

/** Normalize UI/prefs percent (1–50) → fraction. */
export function clampGlWinAlertPct(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return GL_WIN_ALERT_PCT_DEFAULT;
  return Math.min(
    GL_WIN_ALERT_PCT_MAX,
    Math.max(GL_WIN_ALERT_PCT_MIN, Math.round(pct)),
  );
}

export function glWinAlertFracFromPct(pct: number | null | undefined): number {
  return clampGlWinAlertPct(pct) / 100;
}

/**
 * Won base $ for the column: current positive G/L, else peak wins if any.
 */
export function glWinAlertBaseUsd(
  pnlEur: number | null | undefined,
  peakPnlEur?: number | null,
): number | null {
  const cur =
    pnlEur != null && Number.isFinite(pnlEur) && pnlEur > 0 ? pnlEur : null;
  const peak =
    peakPnlEur != null && Number.isFinite(peakPnlEur) && peakPnlEur > 0
      ? peakPnlEur
      : null;
  if (cur != null) return Math.round(cur * 100) / 100;
  if (peak != null) return Math.round(peak * 100) / 100;
  return null;
}

/** Threshold $ = frac × won G/L base. */
export function glWinAlertThresholdUsd(
  pnlEur: number | null | undefined,
  peakPnlEur?: number | null,
  frac: number = GL_WIN_ALERT_FRAC_DEFAULT,
): number | null {
  if (!(frac > 0)) return null;
  const base = glWinAlertBaseUsd(pnlEur, peakPnlEur);
  if (base == null || !(base > 0)) return null;
  return Math.round(base * frac * 100) / 100;
}

/** Shares equivalent of the threshold at buy price. */
export function glWinAlertThresholdShares(
  thresholdUsd: number | null | undefined,
  buyPrice: number | null | undefined,
): number | null {
  if (
    thresholdUsd == null ||
    !Number.isFinite(thresholdUsd) ||
    thresholdUsd <= 0 ||
    buyPrice == null ||
    !Number.isFinite(buyPrice) ||
    buyPrice <= 0
  ) {
    return null;
  }
  return Math.round((thresholdUsd / buyPrice) * 100) / 100;
}

/**
 * Campanella: giveback from peak wins ≥ frac × peak (or current win if no peak).
 * Example: peak +$200, frac 10% → rings after giving back ≥ $20.
 */
export function glWinAlertHit(
  pnlEur: number | null | undefined,
  peakPnlEur?: number | null,
  frac: number = GL_WIN_ALERT_FRAC_DEFAULT,
): boolean {
  if (pnlEur == null || !Number.isFinite(pnlEur) || !(frac > 0)) return false;
  const peakHist =
    peakPnlEur != null && Number.isFinite(peakPnlEur) && peakPnlEur > 0
      ? peakPnlEur
      : null;
  const peakEff =
    peakHist != null
      ? Math.max(peakHist, pnlEur > 0 ? pnlEur : peakHist)
      : pnlEur > 0
        ? pnlEur
        : null;
  if (peakEff == null || !(peakEff > 0)) return false;
  const giveback = peakEff - pnlEur;
  return giveback + 1e-9 >= peakEff * frac && giveback > 0.5;
}

/** @deprecated use {@link glWinAlertThresholdUsd}. */
export function positionShareLossAlertUsd(
  shares: number | null | undefined,
  buyPrice: number | null | undefined,
  frac = GL_WIN_ALERT_FRAC_DEFAULT,
): number | null {
  if (
    shares == null ||
    !Number.isFinite(shares) ||
    shares <= 0 ||
    buyPrice == null ||
    !Number.isFinite(buyPrice) ||
    buyPrice <= 0 ||
    !(frac > 0)
  ) {
    return null;
  }
  return Math.round(shares * frac * buyPrice * 100) / 100;
}

/** @deprecated use {@link glWinAlertHit}. */
export function positionShareLossAlertHit(
  pnlEur: number | null | undefined,
  capitalEur: number | null | undefined,
  frac = GL_WIN_ALERT_FRAC_DEFAULT,
): boolean {
  if (pnlEur == null || !Number.isFinite(pnlEur) || !(pnlEur < 0)) return false;
  if (capitalEur == null || !Number.isFinite(capitalEur) || capitalEur <= 0) {
    return false;
  }
  if (!(frac > 0)) return false;
  return -pnlEur + 1e-9 >= capitalEur * frac;
}

/** Purchased € + open gains € (peak or current) for giveback / G2 base. */
export function purchasedPlusGainsEur(
  capitalEur: number | null | undefined,
  gainsEur: number | null | undefined,
): number {
  const cap =
    capitalEur != null && Number.isFinite(capitalEur) && capitalEur > 0
      ? capitalEur
      : 0;
  const gains =
    gainsEur != null && Number.isFinite(gainsEur) && gainsEur > 0 ? gainsEur : 0;
  return Math.round((cap + gains) * 100) / 100;
}

export type SoftSignalGrade = 1 | 2 | 3;

export type SoftBuyG1Input = {
  /** Open book — soft BUY is for off-book only. */
  hasPosition: boolean;
  sdsScore: number | null | undefined;
  /** P(plan) / recoveryProbabilityPct 0–100. */
  pplan: number | null | undefined;
};

export type SoftSellG1Input = {
  hasPosition: boolean;
  /** Total MTM P&L %. */
  pnlPct: number | null | undefined;
  pplan: number | null | undefined;
  riskV2: number | null | undefined;
  regRisk: number | null | undefined;
  /** Sim row — g10 / exhaustion context for loss-side boost. */
  simRow?: Record<string, unknown> | null;
  /** Open-run stamp — mild G1 needs ≥3 NYSE sessions; missing = mature. */
  investedAt?: string | null;
  now?: Date;
  /**
   * Catalyst desk bearish (news Σ Clin/Fin/Corp/Access < 0) — boosts Soft SELL
   * when MTM ≤ −2.5% even if risk/reg/P are flat.
   */
  catalystBearish?: boolean;
};

export type SoftBuyG1Result = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_buy_g1_sds_pplan";
  sds: number | null;
  pplan: number | null;
};

export type SoftSellG1Result = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_sell_g1_pnl_risk";
  pnlPct: number | null;
  reason: string | null;
};

/**
 * Peak open MTM € for a book key from invest_sim_history `byTicker.pnl`.
 * Scoped to the **latest contiguous open run** (key missing from a snapshot
 * resets the run — sell gap → rebuy) and, when set, to `sinceIso` (`investedAt`).
 * Uses the later of those two so a rewound investedAt cannot resurrect a
 * prior-hold peak after Soft BUY.
 */
export function peakPnlEurFromHistory(
  history:
    | readonly {
        ts?: string;
        byTicker?: Record<string, { pnl?: number }> | null;
      }[]
    | null
    | undefined,
  key: string,
  sinceIso?: string | null,
): number | null {
  const k = key.trim();
  if (!history?.length || !k) return null;

  let runStartIdx = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i]?.byTicker?.[k] == null) runStartIdx = i + 1;
  }

  let sinceMs =
    sinceIso != null && String(sinceIso).trim()
      ? Date.parse(String(sinceIso))
      : NaN;
  const runStartTs =
    runStartIdx < history.length && history[runStartIdx]?.ts != null
      ? Date.parse(String(history[runStartIdx]!.ts))
      : NaN;
  if (Number.isFinite(runStartTs)) {
    sinceMs = Number.isFinite(sinceMs) ? Math.max(sinceMs, runStartTs) : runStartTs;
  }

  let peak = -Infinity;
  for (let i = runStartIdx; i < history.length; i++) {
    const h = history[i]!;
    if (Number.isFinite(sinceMs)) {
      const t = h.ts != null ? Date.parse(String(h.ts)) : NaN;
      if (!Number.isFinite(t) || t + 1e-3 < sinceMs) continue;
    }
    const p = h.byTicker?.[k]?.pnl;
    if (p != null && Number.isFinite(p)) peak = Math.max(peak, p);
  }
  return Number.isFinite(peak) && peak > -Infinity ? peak : null;
}

export type SoftSellGivebackInput = {
  hasPosition: boolean;
  /** Peak open MTM € from history (current may be higher). */
  peakPnlEur: number | null | undefined;
  /** Current open MTM €. */
  pnlEur: number | null | undefined;
  /** Invested capital € for this open (purchased stocks). */
  capitalEur?: number | null;
  /** Fraction of (purchased + gains) that triggers SELL (default 0.20). */
  frac?: number;
  /** Entry time — off-session Soft BUY suppressed until a later RTH close. */
  investedAt?: string | null;
  now?: Date;
};

export type SoftSellGivebackResult = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_sell_giveback";
  peakPnlEur: number | null;
  pnlEur: number | null;
  givebackEur: number | null;
  reason: string | null;
};

/**
 * Soft SELL — drop from peak ≥ frac × (purchased capital + peak gains),
 * only once open MTM is strictly underwater. peakEff = max(historyPeak, current);
 * base = capital + peakEff (fallback: peakEff alone if capital missing).
 * Flat €0 / green MTM never auto-SELL.
 */
export function evaluateSoftSellGiveback(
  input: SoftSellGivebackInput,
): SoftSellGivebackResult {
  const frac =
    input.frac != null && Number.isFinite(input.frac) && input.frac > 0
      ? input.frac
      : SOFT_SELL_GIVEBACK_FRAC;
  const histPeak =
    input.peakPnlEur != null && Number.isFinite(input.peakPnlEur)
      ? input.peakPnlEur
      : null;
  const cur =
    input.pnlEur != null && Number.isFinite(input.pnlEur) ? input.pnlEur : null;
  if (!input.hasPosition || cur == null) {
    return {
      hit: false,
      grade: 1,
      rule: "soft_sell_giveback",
      peakPnlEur: histPeak,
      pnlEur: cur,
      givebackEur: null,
      reason: null,
    };
  }
  if (!givebackAlertEligibleSinceInvestedAt(input.investedAt, input.now ?? new Date())) {
    return {
      hit: false,
      grade: 1,
      rule: "soft_sell_giveback",
      peakPnlEur: histPeak,
      pnlEur: cur,
      givebackEur: null,
      reason: null,
    };
  }
  const peakEff =
    histPeak != null && histPeak > 0 ? Math.max(histPeak, cur) : cur > 0 ? cur : null;
  if (peakEff == null || !(peakEff >= SOFT_SELL_GIVEBACK_MIN_PEAK_EUR)) {
    return {
      hit: false,
      grade: 1,
      rule: "soft_sell_giveback",
      peakPnlEur: peakEff,
      pnlEur: cur,
      givebackEur: null,
      reason: null,
    };
  }
  const base = purchasedPlusGainsEur(input.capitalEur, peakEff);
  const threshBase = base > 0 ? base : peakEff;
  const giveback = peakEff - cur;
  const thresh = frac * threshBase;
  // Flat at cost (€0) after a fresh buy must not Soft-SELL; require underwater.
  const hit = cur < 0 && giveback + 1e-9 >= thresh;
  return {
    hit,
    grade: 1,
    rule: "soft_sell_giveback",
    peakPnlEur: peakEff,
    pnlEur: cur,
    givebackEur: Math.round(giveback * 100) / 100,
    reason: hit
      ? `giveback≥${Math.round(frac * 100)}% of purchased+gains €${Math.round(threshBase)} · MTM<0`
      : null,
  };
}

/** Grade 1 soft BUY — off-book, SDS≥20 and P(plan)≥50. Promotes REC to BUY. */
export function evaluateSoftBuyGrade1(input: SoftBuyG1Input): SoftBuyG1Result {
  const sds =
    input.sdsScore != null && Number.isFinite(input.sdsScore) ? input.sdsScore : null;
  const pplan =
    input.pplan != null && Number.isFinite(input.pplan) ? input.pplan : null;
  const hit =
    !input.hasPosition &&
    sds != null &&
    pplan != null &&
    sds >= SOFT_BUY_G1_SDS_MIN &&
    pplan >= SOFT_BUY_G1_PPLAN_MIN;
  return {
    hit,
    grade: 1,
    rule: "soft_buy_g1_sds_pplan",
    sds,
    pplan,
  };
}

export type SoftBuyG1cInput = SoftBuyG1Input;

export type SoftBuyG1cResult = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_buy_g1c_study_override";
  sds: number | null;
  pplan: number | null;
};

/** Grade 1c — SDS≥50 · P≥60 (study override; Top2/precat checked in loop). */
export function evaluateSoftBuyGrade1c(input: SoftBuyG1cInput): SoftBuyG1cResult {
  const sds =
    input.sdsScore != null && Number.isFinite(input.sdsScore) ? input.sdsScore : null;
  const pplan =
    input.pplan != null && Number.isFinite(input.pplan) ? input.pplan : null;
  const hit =
    !input.hasPosition &&
    sds != null &&
    pplan != null &&
    sds >= SOFT_BUY_G1C_SDS_MIN &&
    pplan >= SOFT_BUY_G1C_PPLAN_MIN;
  return {
    hit,
    grade: 1,
    rule: "soft_buy_g1c_study_override",
    sds,
    pplan,
  };
}

export type SoftBuyHighVolResult = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_buy_g1v_high_vol";
};

/** Soft BUY G1v — confirmed volume acceleration (T_double ≤30 min). */
export function evaluateSoftBuyHighVol(input: {
  hasPosition: boolean;
  flagged?: boolean | null;
}): SoftBuyHighVolResult {
  return {
    hit: !input.hasPosition && input.flagged === true,
    grade: 1,
    rule: "soft_buy_g1v_high_vol",
  };
}

/**
 * Soft BUY day-1 catalyst — align Rec with Catalyst desk market columns.
 * SDS/P · green day · tape · !precat (checked in loop) · vol surge · news Σ>0.
 * Rising ↑2d is NOT required (day-1 mover).
 */
export type SoftBuyDay1CatalystResult = {
  hit: boolean;
  grade: SoftSignalGrade;
  rule: "soft_buy_g1d_day1_catalyst";
};

export function evaluateSoftBuyDay1Catalyst(input: {
  hasPosition: boolean;
  sdsScore: number | null | undefined;
  pplan: number | null | undefined;
  /** VOL vs prev ≥150% and/or T_double flagged. */
  volSurge: boolean;
  /** Clin/Fin/Corp/Access Σ > 0 on desk Scores. */
  newsBullish: boolean;
}): SoftBuyDay1CatalystResult {
  const soft = evaluateSoftBuyGrade1({
    hasPosition: input.hasPosition,
    sdsScore: input.sdsScore,
    pplan: input.pplan,
  });
  return {
    hit: soft.hit && input.volSurge && input.newsBullish,
    grade: 1,
    rule: "soft_buy_g1d_day1_catalyst",
  };
}

/** True when mild/orphan G1 may fire. Missing investedAt → mature (legacy opens). */
export function softSellG1HoldMature(
  investedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const elapsed = nyseSessionsElapsedSince(investedAt, now);
  if (elapsed == null) return true;
  return elapsed >= SOFT_SELL_G1_MIN_HOLD_SESSIONS;
}

/**
 * Grade 1 soft SELL — open book, deep enough loss + weak risk/plan.
 * Promotes REC to SELL (escapes rescue_review / sticky HOLD when wired).
 *
 * Deep floor (≤ −12%): always hit — high P(plan) must not park a deep book in HOLD.
 * Orphan path (≤ −6% with risk/reg/P all missing): hit — empty enhance must not hide losses.
 * Mild / orphan paths wait ≥3 NYSE sessions after the buy day.
 */
export function evaluateSoftSellGrade1(input: SoftSellG1Input): SoftSellG1Result {
  const pnlPct =
    input.pnlPct != null && Number.isFinite(input.pnlPct) ? input.pnlPct : null;
  const pplan =
    input.pplan != null && Number.isFinite(input.pplan) ? input.pplan : null;
  const riskV2 =
    input.riskV2 != null && Number.isFinite(input.riskV2) ? input.riskV2 : null;
  const reg =
    input.regRisk != null && Number.isFinite(input.regRisk) ? input.regRisk : null;
  const now = input.now ?? new Date();

  if (!input.hasPosition || pnlPct == null || pnlPct > SOFT_SELL_G1_PNL_PCT) {
    return { hit: false, grade: 1, rule: "soft_sell_g1_pnl_risk", pnlPct, reason: null };
  }

  // Catastrophic open loss — no secondary scores required (JSPR −47% case).
  if (pnlPct <= SOFT_SELL_G1_DEEP_PNL_PCT) {
    return {
      hit: true,
      grade: 1,
      rule: "soft_sell_g1_pnl_risk",
      pnlPct,
      reason: `pnl≤${SOFT_SELL_G1_DEEP_PNL_PCT}% (deep loss)`,
    };
  }

  const riskOk = riskV2 != null && riskV2 >= SOFT_SELL_G1_RISK_V2;
  const regOk = reg != null && reg >= SOFT_SELL_G1_REG;
  const planWeak = pplan != null && pplan < SOFT_SELL_G1_PPLAN_MAX;
  const secondaryMissing = riskV2 == null && reg == null && pplan == null;
  const orphanDeep =
    secondaryMissing && pnlPct <= SOFT_SELL_G1_ORPHAN_PNL_PCT;
  const contBoost = contLossSideSellBoost(input.simRow ?? null);
  const catalystBoost = Boolean(input.catalystBearish);

  if (!riskOk && !regOk && !planWeak && !orphanDeep && !contBoost && !catalystBoost) {
    return { hit: false, grade: 1, rule: "soft_sell_g1_pnl_risk", pnlPct, reason: null };
  }
  // Mild / orphan G1: skip 1–2 session tape noise. Deep floor already returned.
  if (!softSellG1HoldMature(input.investedAt, now)) {
    return { hit: false, grade: 1, rule: "soft_sell_g1_pnl_risk", pnlPct, reason: null };
  }
  const bits: string[] = [`pnl≤${SOFT_SELL_G1_PNL_PCT}%`];
  if (riskOk) bits.push(`riskV2≥${SOFT_SELL_G1_RISK_V2}`);
  if (regOk) bits.push(`reg≥${SOFT_SELL_G1_REG}`);
  if (planWeak) bits.push(`pplan<${SOFT_SELL_G1_PPLAN_MAX}`);
  if (orphanDeep) bits.push("risk/reg/P missing");
  if (contBoost) bits.push(contBoost);
  if (catalystBoost) bits.push("catalyst news Σ<0");
  return {
    hit: true,
    grade: 1,
    rule: "soft_sell_g1_pnl_risk",
    pnlPct,
    reason: bits.join(" · "),
  };
}

/** Legacy per-name day floor — no longer gates G2 cuts (budget is book-wide). */
export const URGENT_SELL_G2_DAY_PCT_MAX = -2;
/** Legacy per-name total floor — no longer gates G2 cuts. */
export const URGENT_SELL_G2_TOTAL_PCT_MAX = -3;
/** Legacy catastrophic day marker (kept for diagnostics / older callers). */
export const URGENT_SELL_G2_CATASTROPHIC_DAY_PCT = -10;
/**
 * Max |aggregate day losses| as a fraction of **book purchased + open gains**.
 * purchasedPlusGains = Σ capital + Σ max(0, total MTM €).
 * budgetEur = purchasedPlusGains × fraction — not per ticker.
 * When |sum(day losses)| > budget, auto-sell worst day-% losers until back under.
 */
export const URGENT_SELL_G2_MAX_LOSS_OF_PURCHASED_PLUS_GAINS = 0.2;
/**
 * @deprecated alias — same as {@link URGENT_SELL_G2_MAX_LOSS_OF_PURCHASED_PLUS_GAINS}.
 * Name kept so older imports/docs still resolve; base is no longer day-wins.
 */
export const URGENT_SELL_G2_MAX_LOSS_OF_WINS =
  URGENT_SELL_G2_MAX_LOSS_OF_PURCHASED_PLUS_GAINS;

/** Resolve G2 budget fraction — single knob for UI / future prefs. */
export function resolveUrgentSellG2LossOfWinsFraction(): number {
  return URGENT_SELL_G2_MAX_LOSS_OF_PURCHASED_PLUS_GAINS;
}

export type UrgentSellBookLeg = {
  key: string;
  ticker: string;
  /** € P&L for the day (or rolling window contribution). */
  dayPnlEur: number;
  dayPnlPct: number | null;
  totalPnlPct: number | null;
  /** Invested capital € (purchased) — feeds book purchased+gains base. */
  capitalEur?: number | null;
  /** Total open MTM € — positive side counts as gains in the book base. */
  pnlEur?: number | null;
  /**
   * Continuation cut priority (higher = cut sooner on ties).
   * Prefer `attachContCutPriority` / pass simRow when building legs.
   */
  contCutPriority?: number | null;
};

/** Attach g10 / exhaustion cut priority from a Simulation row. */
export function attachContCutPriority(
  leg: UrgentSellBookLeg,
  simRow?: Record<string, unknown> | null,
): UrgentSellBookLeg {
  return {
    ...leg,
    contCutPriority: contSellCutPriority(simRow ?? null),
  };
}

export type UrgentSellG2Hit = {
  key: string;
  ticker: string;
  dayPnlEur: number;
  dayPnlPct: number | null;
  totalPnlPct: number | null;
  reason: string;
};

export type UrgentSellG2BookResult = {
  grade: SoftSignalGrade;
  rule: "urgent_sell_g2_book_budget";
  /** Σ capital + Σ max(0, total MTM €) — purchased + open gains. */
  purchasedPlusGainsEur: number;
  /**
   * @deprecated alias of {@link purchasedPlusGainsEur} (was day-wins sum).
   */
  winSumEur: number;
  /** Max allowed |aggregate day losses| = purchasedPlusGains × fraction */
  budgetEur: number;
  lossSumEur: number;
  /** Keys cut by G2 (fastest day % loss first until budget restored). */
  urgentKeys: Set<string>;
  hits: UrgentSellG2Hit[];
};

/**
 * G2 cut candidate: meaningful day € loss, never green total MTM.
 * Per-name day/total % floors are NOT required — the book-wide % trigger applies.
 */
export function isUrgentSellG2CutCandidate(leg: UrgentSellBookLeg): boolean {
  if (!(leg.dayPnlEur < -0.5)) return false;
  if (
    leg.totalPnlPct != null &&
    Number.isFinite(leg.totalPnlPct) &&
    leg.totalPnlPct > 0
  ) {
    return false;
  }
  return true;
}

/**
 * Cut order for G2: fastest day % decline first (time-axis velocity),
 * then continuation context (declining / not-run / exhaustion edge),
 * then largest € day loss. Null day % sorts last.
 */
export function compareUrgentSellG2Priority(
  a: UrgentSellBookLeg,
  b: UrgentSellBookLeg,
): number {
  const ap =
    a.dayPnlPct != null && Number.isFinite(a.dayPnlPct) ? a.dayPnlPct : null;
  const bp =
    b.dayPnlPct != null && Number.isFinite(b.dayPnlPct) ? b.dayPnlPct : null;
  if (ap != null && bp != null && ap !== bp) return ap - bp; // more negative first
  if (ap != null && bp == null) return -1;
  if (ap == null && bp != null) return 1;
  const ac =
    a.contCutPriority != null && Number.isFinite(a.contCutPriority)
      ? a.contCutPriority
      : 0;
  const bc =
    b.contCutPriority != null && Number.isFinite(b.contCutPriority)
      ? b.contCutPriority
      : 0;
  if (ac !== bc) return bc - ac; // higher cont priority first
  return a.dayPnlEur - b.dayPnlEur;
}

/**
 * Grade 2 urgent SELL — **book-wide** purchased+gains budget (hard stop).
 * Trigger: |sum(all day losses €)| > fraction × (Σ capital + Σ max(0, MTM €)).
 * Then auto-sell worst day losers (fastest day % = most drastic loss in the
 * time unit) until the remaining loss mass fits the budget. Not per-company %.
 *
 * Pass `dayPnlEur` as today-only or sum of last 2 session legs; pass
 * `capitalEur` / `pnlEur` so the equity base is correct.
 */
export function evaluateUrgentSellGrade2Book(
  legs: readonly UrgentSellBookLeg[],
): UrgentSellG2BookResult {
  const equityBase = legs.reduce(
    (a, l) => a + purchasedPlusGainsEur(l.capitalEur, l.pnlEur),
    0,
  );
  const lossFrac = resolveUrgentSellG2LossOfWinsFraction();
  const budgetEur = equityBase > 0 ? equityBase * lossFrac : 0;
  let lossSumEur = legs
    .filter((l) => l.dayPnlEur < 0)
    .reduce((a, l) => a + l.dayPnlEur, 0);

  const urgentKeys = new Set<string>();
  const hits: UrgentSellG2Hit[] = [];
  const pool = legs
    .filter((l) => isUrgentSellG2CutCandidate(l))
    .sort(compareUrgentSellG2Priority);

  const overBudget = () => lossSumEur < -budgetEur - 1e-6;
  const fracLabel = `${Math.round(lossFrac * 100)}% purchased+gains`;

  // Fail closed: missing capitalEur on legs used to yield budget=0 and
  // auto-sell every red-MTM day loser (SRPT/SYRE 2026-08-13) while green-MTM
  // day losers (CRDL) stayed protected. Never cut without a real equity base.
  if (budgetEur > 0) {
    for (const leg of pool) {
      if (!overBudget()) break;
      urgentKeys.add(leg.key);
      hits.push({
        key: leg.key,
        ticker: leg.ticker,
        dayPnlEur: leg.dayPnlEur,
        dayPnlPct: leg.dayPnlPct,
        totalPnlPct: leg.totalPnlPct,
        reason: `urgent G2 · book budget €${Math.round(budgetEur)} (${fracLabel} of €${Math.round(equityBase)}) · day ${leg.dayPnlPct?.toFixed(1)}% · total ${leg.totalPnlPct?.toFixed(1)}%`,
      });
      lossSumEur -= leg.dayPnlEur; // remove this loss from the book mass
    }
  }

  const equityRounded = Math.round(equityBase * 100) / 100;
  return {
    grade: 2,
    rule: "urgent_sell_g2_book_budget",
    purchasedPlusGainsEur: equityRounded,
    winSumEur: equityRounded,
    budgetEur: Math.round(budgetEur * 100) / 100,
    lossSumEur: Math.round(
      legs.filter((l) => l.dayPnlEur < 0).reduce((a, l) => a + l.dayPnlEur, 0) * 100,
    ) / 100,
    urgentKeys,
    hits,
  };
}

export function isUrgentSellGrade2Key(
  book: UrgentSellG2BookResult | null | undefined,
  key: string,
): boolean {
  return Boolean(book?.urgentKeys.has(key));
}

/** Deep Soft SELL floor — recovery must not demote to HOLD. */
export function softSellG1IsDeepFloor(result: SoftSellG1Result): boolean {
  return (
    result.hit &&
    result.pnlPct != null &&
    Number.isFinite(result.pnlPct) &&
    result.pnlPct <= SOFT_SELL_G1_DEEP_PNL_PCT
  );
}
