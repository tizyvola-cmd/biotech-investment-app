/**
 * Decision chart — Buy / Hold / Uncertain / Sell from multi-score inputs.
 * Internal key stays `review`; UI labels are Uncertain / Incerto.
 * Thresholds marked SOGLIA_PROVVISORIA are tuning placeholders.
 */

import type { LossAnalysisScoreSection } from "./investSimKeys";

export type DecisionRec = "buy" | "hold" | "review" | "sell";

export const DECISION_REC_ORDER: DecisionRec[] = ["buy", "hold", "review", "sell"];

export const DECISION_REC_ZONE: Record<
  DecisionRec,
  { labelIt: string; labelEn: string; bg: string; border: string; badge: string; divider: string }
> = {
  buy: {
    labelIt: "Buy",
    labelEn: "Buy",
    bg: "bg-emerald-50/80 dark:bg-emerald-950/25",
    border: "border-emerald-300/70 dark:border-emerald-700/50",
    badge: "bg-emerald-600 text-white",
    divider: "border-emerald-300/55 dark:border-emerald-700/45",
  },
  hold: {
    labelIt: "Hold",
    labelEn: "Hold",
    bg: "bg-sky-50/80 dark:bg-sky-950/25",
    border: "border-sky-300/70 dark:border-sky-700/50",
    badge: "bg-sky-600 text-white",
    divider: "border-sky-300/55 dark:border-sky-700/45",
  },
  review: {
    labelIt: "Incerto",
    labelEn: "Uncertain",
    bg: "bg-amber-50/80 dark:bg-amber-950/25",
    border: "border-amber-300/70 dark:border-amber-700/50",
    badge: "bg-amber-600 text-white",
    divider: "border-amber-300/55 dark:border-amber-700/45",
  },
  sell: {
    labelIt: "Sell",
    labelEn: "Sell",
    bg: "bg-rose-50/80 dark:bg-rose-950/25",
    border: "border-rose-300/70 dark:border-rose-700/50",
    badge: "bg-rose-600 text-white",
    divider: "border-rose-300/55 dark:border-rose-700/45",
  },
};

export type DecisionScoreInput = {
  pplan: number | null;
  sds: number | null;
  /** EIS on 0–100 display scale (50 = neutral). */
  eis: number | null;
  /** Raw signed EIS for display (+11, −3, …). */
  eisRaw: number | null;
  /** Raw 0–100 — higher = more investment risk (Risk v2). */
  riskV2: number | null;
  /** Raw regulatory score mapped to 0–100 — higher = more regulatory risk. */
  regRisk: number | null;
  /** Market Context Score 0–100 — higher = more favorable external context. */
  mcs: number | null;
  pnlPct: number | null;
  /** Session day move % (Var. Giorn.) — never SELL when > 0. */
  pnlPct24h?: number | null;
  /** Rescue space when pnl < -2%. */
  isRescue: boolean;
  status: "open" | "closed";
  /**
   * Backend-set flag: (price < $1 OR ADV20 < 100k share) AND |Δgg%| > 15.
   * Downstream: the recommendation is forced to REVIEW to avoid classifying
   * bid-ask bounce or fade-off-peak on sub-dime warrants as BUY/SELL.
   * Set from `low_liq_noise` in `simulation_sheet_snapshot.json`.
   */
  lowLiqNoise?: boolean;
  /** Optional human-readable reason for `lowLiqNoise` (e.g. "price=$0.0851<$1; |Δ|=22.6%"). */
  lowLiqReason?: string | null;
  /**
   * Issuer resilience from mcap / ADV / β / FY liq / commercial phase.
   * Fragile small-illiquid losers should not park forever in Uncertain;
   * resilient large/commercial names get more Hold room under MCS.
   */
  resilience?: import("./issuerResilience").IssuerResilienceBand | null;
  resilienceScore?: number | null;
  /** Open book vs opportunity — Soft BUY only when false. */
  hasPosition?: boolean;
  /** Book-budget Urgent SELL G2 flag from caller. */
  urgentSellG2?: boolean;
  /**
   * Warrant sheet symbol (JSPRW…) — Soft BUY must target the common (JSPR).
   * Set by Decision Chart build from ticker suffix.
   */
  isWarrant?: boolean;
  /**
   * Rising ≥2 sessions (what-if / Soft BUY gate). Score-only Soft BUY requires
   * `true`; omit/false → no Soft BUY from SDS/P alone (fail closed).
   */
  risingStreakOk?: boolean;
  /**
   * When 10d % ≥ +5%: P(cont) ≥ 50 and edge ≤ 0. Out of regime → true.
   * Omit/false → no Soft BUY from SDS/P alone (fail closed when known false).
   */
  continuationOk?: boolean;
};

export type DecisionChartTickerRow = {
  key: string;
  ticker: string;
  company: string | null;
  phaseLabel: string | null;
  pnlPct: number | null;
  /** 24h move % — for opportunity CD filters on mobile. */
  pnlPct24h?: number | null;
  scores: DecisionScoreInput;
  rec: DecisionRec;
  diagnostic: string;
  /** Plain-language explanation of why this Buy/Hold/Review/Sell was chosen. */
  recExplanation?: RecommendationExplanation;
  insufficientScores: boolean;
  /** Open portfolio position — show 💼 on decision bubbles. */
  hasPortfolio?: boolean;
  /** Manual EIS confirmed a material positive catalyst. */
  manualGainStar?: boolean;
  /** Daily gain ★ sequence (one per confirmed gain day). */
  gainStars?: import("./gainStarLedger").GainStarDisplay[];
};

const RESCUE_PNL_THRESHOLD_PCT = -2;

/** Map signed regulatory score (−100…+100) to 0–100 risk scale for decision logic. */
export function regRiskFromSignedScore(signed: number | null | undefined): number | null {
  if (signed == null || !Number.isFinite(signed)) return null;
  return Math.round(Math.max(0, Math.min(100, (signed + 100) / 2)));
}

/** Invert risk axes for radar display (high raw risk → low dot = bad). */
export function invertRiskAxis(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.round(Math.max(0, Math.min(100, 100 - raw)));
}

/**
 * Bar/dot color for Reg. risk on the 0–100 decision scale (50 = neutral).
 * Lower than 50 → green (favorable); above → amber/red — not a fixed alarm red.
 */
export function regRiskDisplayBarColor(regRisk: number | null | undefined): string {
  if (regRisk == null || !Number.isFinite(regRisk)) return "#94a3b8";
  const signed = regRisk * 2 - 100;
  if (signed < 0) return "#10b981";
  if (signed <= 2) return "#64748b";
  if (signed >= 50) return "#e11d48";
  if (signed >= 25) return "#d97706";
  return "#f59e0b";
}

export function isRescuePosition(pnlPct: number | null | undefined): boolean {
  return pnlPct != null && Number.isFinite(pnlPct) && pnlPct < RESCUE_PNL_THRESHOLD_PCT;
}

/**
 * Study / event setup for marginal BUY (NRXP lesson): P(plan) alone in the
 * 60–64 band is not enough when SDS is weak and EIS is missing — the card
 * can look bullish on short-term relative strength vs a falling sector ETF
 * while clinical/event evidence is empty.
 *
 * Evidence = SDS ≥ 50, or positive raw EIS, or EIS display above neutral (50).
 */
export function hasStudySetupEvidence(s: DecisionScoreInput): boolean {
  if (s.sds != null && Number.isFinite(s.sds) && s.sds >= 50) return true;
  if (s.eisRaw != null && Number.isFinite(s.eisRaw) && s.eisRaw > 0) return true;
  if (s.eis != null && Number.isFinite(s.eis) && s.eis > 50) return true;
  return false;
}

export type RecommendationRuleKey =
  | "closed_pnl_buy"
  | "closed_pnl_hold"
  | "closed_pnl_sell"
  | "low_liq_noise_review"
  | "reg_veto"
  | "rescue_sell_fragile"
  | "rescue_review_mcs"
  | "rescue_sell"
  | "rescue_review"
  | "resilient_hold"
  | "pplan_buy"
  | "pplan_buy_reg_swing"
  | "pnl_sell"
  | "pnl_buy"
  | "pplan_hold"
  | "pplan_sell_sub40"
  | "sds_buy"
  | "sds_hold"
  | "risk_sell"
  | "soft_buy_g1"
  | "soft_sell_g1"
  | "urgent_sell_g2"
  | "default_review";

export type RecommendationExplanation = {
  headline: string;
  trigger: string;
  buyGaps: string[];
  sellWarnings: string[];
  source: "scores" | "operational" | "closed";
};

function traceRecommendation(s: DecisionScoreInput): { rec: DecisionRec; rule: RecommendationRuleKey } {
  if (s.status === "closed") {
    if (s.pnlPct !== null && s.pnlPct >= 5) return { rec: "buy", rule: "closed_pnl_buy" };
    if (s.pnlPct !== null && s.pnlPct >= -2) return { rec: "hold", rule: "closed_pnl_hold" };
    return { rec: "sell", rule: "closed_pnl_sell" };
  }
  // Low-liquidity noise override: a sub-dime warrant / illiquid ticker with
  // |Δ giornaliero| > 15% is dominated by bid-ask bounce or fade-off-peak
  // on parabolic days (see ERNAW 2026-07-15: −22.64% on 50k share volume
  // while the correlated common ERNA closed +11% on the same positive
  // catalyst). Forcing REVIEW prevents SELL/BUY classifications on a
  // signal that is not information-bearing at the issuer level.
  if (s.lowLiqNoise === true) {
    // Fragile deep losers: microstructure noise must not trap a -5% book in Uncertain.
    if (
      s.resilience === "fragile" &&
      s.pnlPct != null &&
      s.pnlPct <= -5 &&
      (s.pplan == null || s.pplan < 55)
    ) {
      return { rec: "sell", rule: "rescue_sell_fragile" };
    }
    return { rec: "review", rule: "low_liq_noise_review" };
  }
  if (s.regRisk !== null && s.regRisk >= 70) return { rec: "sell", rule: "reg_veto" };
  if (s.isRescue) {
    // Small / illiquid / non-commercial: exit Uncertain toward Sell when drawdown is deep.
    if (
      s.resilience === "fragile" &&
      s.pnlPct != null &&
      s.pnlPct <= -5 &&
      (s.pplan == null || s.pplan < 55 || s.mcs == null || s.mcs < 50)
    ) {
      return { rec: "sell", rule: "rescue_sell_fragile" };
    }
    if ((s.pplan !== null && s.pplan < 40) || (s.regRisk !== null && s.regRisk >= 50)) {
      return { rec: "sell", rule: "rescue_sell" };
    }
    // Soft / urgent SELL before MCS-friendly Uncertain — escape sticky rescue.
    if (s.urgentSellG2) {
      return { rec: "sell", rule: "urgent_sell_g2" };
    }
    if (
      s.pnlPct != null &&
      s.pnlPct <= -4 &&
      ((s.riskV2 != null && s.riskV2 >= 40) ||
        (s.regRisk != null && s.regRisk >= 45) ||
        (s.pplan != null && s.pplan < 50))
    ) {
      return { rec: "sell", rule: "soft_sell_g1" };
    }
    // Large / liquid / commercial: MCS-friendly rescue stays Uncertain (after soft exits).
    if (
      s.resilience === "resilient" &&
      s.mcs !== null &&
      s.mcs > 45 &&
      (s.regRisk === null || s.regRisk < 40) &&
      (s.pplan === null || s.pplan >= 40)
    ) {
      return { rec: "review", rule: "rescue_review_mcs" };
    }
    if (s.mcs !== null && s.mcs > 55 && (s.regRisk === null || s.regRisk < 30)) {
      return { rec: "review", rule: "rescue_review_mcs" };
    }
    return { rec: "review", rule: "rescue_review" };
  }
  // Resilient name still green on MTM — prefer Hold over default Uncertain.
  if (
    s.resilience === "resilient" &&
    s.pnlPct != null &&
    s.pnlPct >= 0 &&
    s.pplan != null &&
    s.pplan >= 45
  ) {
    return { rec: "hold", rule: "resilient_hold" };
  }
  // Soft BUY G1 — off-book only (explicit false; undefined = unknown → skip).
  // Same what-if gate as deriveSuggestedAction: SDS≥20 · P≥50 · rising ≥2d · no warrant.
  // Operational action still wins via resolveDecisionChartRec.
  if (
    s.hasPosition === false &&
    s.status === "open" &&
    s.isWarrant !== true &&
    s.risingStreakOk === true &&
    s.continuationOk !== false &&
    s.sds != null &&
    s.sds >= 20 &&
    s.pplan != null &&
    s.pplan >= 50 &&
    (s.riskV2 == null || s.riskV2 <= 55)
  ) {
    return { rec: "buy", rule: "soft_buy_g1" };
  }
  // Primary BUY — aligned with sim-loop P_ENTRY_MIN (60), Loss ≤ 40.
  // Marginal band 60–64 also requires study/event setup (SDS/EIS) — NRXP:
  // P≈60 + empty EIS + weak SDS looked like a Buy on relative strength vs
  // a falling XBI while evidence was absent.
  if (s.pplan !== null && s.pplan >= 60 && (s.riskV2 === null || s.riskV2 <= 40)) {
    if (s.pplan >= 65 || hasStudySetupEvidence(s)) {
      return { rec: "buy", rule: "pplan_buy" };
    }
  }
  // Reg-swing BUY: P(plan) 60–64 with Loss slightly above the primary cap
  // (40 < Loss ≤ 45) but regulatory risk still in the typical mild band
  // (Reg ≤ 45). Still requires study setup (same NRXP guard).
  if (
    s.pplan !== null &&
    s.pplan >= 60 &&
    s.pplan < 65 &&
    s.regRisk !== null &&
    s.regRisk <= 45 &&
    s.riskV2 !== null &&
    s.riskV2 > 40 &&
    s.riskV2 <= 45 &&
    hasStudySetupEvidence(s)
  ) {
    return { rec: "buy", rule: "pplan_buy_reg_swing" };
  }
  if (s.urgentSellG2 && s.hasPosition === true) {
    return { rec: "sell", rule: "urgent_sell_g2" };
  }
  if (s.pnlPct != null && Number.isFinite(s.pnlPct)) {
    if (
      s.pnlPct <= -7 &&
      ((s.riskV2 != null && s.riskV2 >= 45) ||
        (s.regRisk != null && s.regRisk >= 55) ||
        (s.pplan != null && s.pplan < 45))
    ) {
      return { rec: "sell", rule: "pnl_sell" };
    }
    if (
      s.hasPosition === true &&
      s.pnlPct <= -4 &&
      ((s.riskV2 != null && s.riskV2 >= 40) ||
        (s.regRisk != null && s.regRisk >= 45) ||
        (s.pplan != null && s.pplan < 50))
    ) {
      return { rec: "sell", rule: "soft_sell_g1" };
    }
    // Momentum BUY: Δ ≥ +5% is not enough alone — need real setup evidence
    // (SDS≥50 or positive EIS or P≥60). Blocks chase after a green day when
    // study scores are empty/weak (NRXP / thin-SDS momentum cases).
    if (
      s.pnlPct >= 5 &&
      hasStudySetupEvidence(s) &&
      (s.pplan == null || s.pplan >= 50) &&
      (s.riskV2 == null || s.riskV2 <= 45) &&
      (s.regRisk == null || s.regRisk < 65)
    ) {
      return { rec: "buy", rule: "pnl_buy" };
    }
  }
  if (s.pplan !== null && s.pplan >= 50) return { rec: "hold", rule: "pplan_hold" };
  if (s.pplan !== null && s.pplan < 40) return { rec: "sell", rule: "pplan_sell_sub40" };
  if (s.pplan === null) {
    if (s.sds !== null && s.sds >= 65 && (s.riskV2 === null || s.riskV2 <= 35)) {
      return { rec: "buy", rule: "sds_buy" };
    }
    if (s.sds !== null && s.sds >= 50) return { rec: "hold", rule: "sds_hold" };
    if (s.riskV2 !== null && s.riskV2 >= 66) return { rec: "sell", rule: "risk_sell" };
  }
  return { rec: "review", rule: "default_review" };
}

function buyGapLines(s: DecisionScoreInput, it: boolean): string[] {
  const gaps: string[] = [];
  if (s.regRisk != null && s.regRisk >= 70) {
    gaps.push(
      it
        ? `Reg. ${Math.round(s.regRisk)} ≥ 70 — veto assoluto (Sell)`
        : `Reg. ${Math.round(s.regRisk)} ≥ 70 — hard veto (Sell)`,
    );
    return gaps;
  }
  if (s.pplan != null && s.pplan < 60) {
    gaps.push(
      it
        ? `P(plan) ${Math.round(s.pplan)} < 60 (mancano ${60 - Math.round(s.pplan)} pt per Buy)`
        : `P(plan) ${Math.round(s.pplan)} < 60 (need ${60 - Math.round(s.pplan)} more pts for Buy)`,
    );
  } else if (s.pplan == null) {
    gaps.push(it ? "P(plan) assente — Buy solo via SDS ≥ 65" : "P(plan) missing — Buy only via SDS ≥ 65");
  }
  if (
    s.pplan != null &&
    s.pplan >= 60 &&
    s.pplan < 65 &&
    (s.riskV2 == null || s.riskV2 <= 40) &&
    !hasStudySetupEvidence(s)
  ) {
    gaps.push(
      it
        ? `Fascia marginale P 60–64: serve SDS ≥ 50 o EIS positivo (ora SDS ${s.sds != null ? Math.round(s.sds) : "—"}, EIS ${s.eisRaw != null ? (s.eisRaw > 0 ? "+" : "") + s.eisRaw.toFixed(1) : "assente"})`
        : `Marginal P 60–64: need SDS ≥ 50 or positive EIS (now SDS ${s.sds != null ? Math.round(s.sds) : "—"}, EIS ${s.eisRaw != null ? (s.eisRaw > 0 ? "+" : "") + s.eisRaw.toFixed(1) : "missing"})`,
    );
  }
  if (s.pplan != null && s.pplan >= 60 && s.pplan < 65 && s.riskV2 != null && s.riskV2 > 40) {
    const regOk = s.regRisk != null && s.regRisk <= 45;
    const lossOk = s.riskV2 <= 45;
    if (!(regOk && lossOk && hasStudySetupEvidence(s))) {
      gaps.push(
        it
          ? `Reg-swing Buy: Loss 41–45 + Reg. ≤ 45 + SDS/EIS (ora Reg ${s.regRisk != null ? Math.round(s.regRisk) : "—"}, Loss ${Math.round(s.riskV2)})`
          : `Reg-swing Buy: Loss 41–45 + Reg. ≤ 45 + SDS/EIS (now Reg ${s.regRisk != null ? Math.round(s.regRisk) : "—"}, Loss ${Math.round(s.riskV2)})`,
      );
    }
  }
  if (s.riskV2 != null && s.riskV2 > 40) {
    gaps.push(
      it
        ? `Loss risk ${Math.round(s.riskV2)} > 40 (soglia Buy)`
        : `Loss risk ${Math.round(s.riskV2)} > 40 (Buy threshold)`,
    );
  }
  if (s.sds != null && s.sds < 50) {
    gaps.push(
      it
        ? `SDS ${Math.round(s.sds)} < 50 — setup debole`
        : `SDS ${Math.round(s.sds)} < 50 — weak setup`,
    );
  }
  return gaps;
}

function sellWarningLines(s: DecisionScoreInput, it: boolean): string[] {
  const lines: string[] = [];
  if (s.pplan != null && s.pplan >= 40) {
    lines.push(
      it
        ? `Sell se P(plan) scende sotto 40 (ora ${Math.round(s.pplan)})`
        : `Sell if P(plan) drops below 40 (now ${Math.round(s.pplan)})`,
    );
  }
  if (s.regRisk != null && s.regRisk < 70) {
    lines.push(
      it
        ? `Sell se Reg. ≥ 70 (ora ${Math.round(s.regRisk)})`
        : `Sell if Reg. ≥ 70 (now ${Math.round(s.regRisk)})`,
    );
  }
  if (s.riskV2 != null && s.riskV2 < 66) {
    lines.push(
      it
        ? `Sell se Loss risk ≥ 66 (ora ${Math.round(s.riskV2)})`
        : `Sell if Loss risk ≥ 66 (now ${Math.round(s.riskV2)})`,
    );
  }
  if (s.pnlPct != null && s.pnlPct > -7) {
    lines.push(
      it
        ? `Sell rapido se P&L ≤ −7% con risk/P(plan) deboli`
        : `Fast Sell if P&L ≤ −7% with weak risk/P(plan)`,
    );
  }
  return lines;
}

function ruleTriggerText(
  rule: RecommendationRuleKey,
  s: DecisionScoreInput,
  it: boolean,
): string {
  const p = s.pplan != null ? Math.round(s.pplan) : null;
  const loss = s.riskV2 != null ? Math.round(s.riskV2) : null;
  const reg = s.regRisk != null ? Math.round(s.regRisk) : null;
  const mcs = s.mcs != null ? Math.round(s.mcs) : null;
  const pnl = s.pnlPct != null && Number.isFinite(s.pnlPct) ? s.pnlPct.toFixed(1) : null;

  switch (rule) {
    case "pplan_buy":
      return it
        ? p != null && p < 65
          ? `P(plan) ${p} (60–64) + Loss ≤ 40 + SDS/EIS → Buy`
          : `P(plan) ${p} ≥ 65 e Loss ≤ 40 → Buy`
        : p != null && p < 65
          ? `P(plan) ${p} (60–64) + Loss ≤ 40 + SDS/EIS → Buy`
          : `P(plan) ${p} ≥ 65 and Loss ≤ 40 → Buy`;
    case "pplan_buy_reg_swing":
      return it
        ? `P(plan) ${p} (60–64) con Loss ${loss} (41–45), Reg. ${reg} ≤ 45 e SDS/EIS → Buy (reg-swing)`
        : `P(plan) ${p} (60–64) with Loss ${loss} (41–45), Reg. ${reg} ≤ 45 and SDS/EIS → Buy (reg-swing)`;
    case "pnl_buy":
      return it
        ? `Mossa 24h +${pnl}% con SDS/EIS (o setup) → Buy momentum`
        : `24h move +${pnl}% with SDS/EIS setup → momentum Buy`;
    case "pplan_hold":
      return it
        ? `P(plan) ${p} ≥ 50 ma sotto criteri Buy (serve ≥ 60 e Loss ≤ 40) → Hold`
        : `P(plan) ${p} ≥ 50 but below Buy criteria (need ≥ 60 and Loss ≤ 40) → Hold`;
    case "pplan_sell_sub40":
      return it
        ? `P(plan) ${p} < 40 → Sell (zona Sell dello spettro)`
        : `P(plan) ${p} < 40 → Sell (spectrum Sell zone)`;
    case "sds_hold":
      return it
        ? `P(plan) assente, SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 50 → Hold`
        : `P(plan) missing, SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 50 → Hold`;
    case "sds_buy":
      return it
        ? `P(plan) assente, SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 65 e Loss ≤ 35 → Buy`
        : `P(plan) missing, SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 65 and Loss ≤ 35 → Buy`;
    case "reg_veto":
      return it
        ? `Reg. ${reg} ≥ 70 → Sell (veto regolatorio)`
        : `Reg. ${reg} ≥ 70 → Sell (regulatory veto)`;
    case "pnl_sell":
      return it
        ? `P&L ${pnl}% (≤ −7) con risk/P(plan) deboli → Sell`
        : `P&L ${pnl}% (≤ −7) with weak risk/P(plan) → Sell`;
    case "risk_sell":
      return it
        ? `Loss risk ${loss} ≥ 66 senza P(plan) → Sell`
        : `Loss risk ${loss} ≥ 66 without P(plan) → Sell`;
    case "rescue_sell_fragile":
      return it
        ? `Small/illiquido (resilienza bassa) in perdita profonda → Sell — EIS/MCS non bastano a tenere Uncertain`
        : `Fragile small/illiquid name in deep loss → Sell — EIS/MCS alone must not park Uncertain`;
    case "rescue_review_mcs":
      return it
        ? `Rescue: MCS ${mcs} > 55 e Reg. basso → Incerto (possibile recupero)`
        : `Rescue: MCS ${mcs} > 55 and low Reg. → Uncertain (recovery possible)`;
    case "rescue_sell":
      return it
        ? `Rescue: P(plan) < 40 o Reg. ≥ 50 → Sell`
        : `Rescue: P(plan) < 40 or Reg. ≥ 50 → Sell`;
    case "rescue_review":
      return it
        ? `Rescue space (P&L < −2%) → Incerto finché non migliorano P(plan)/Reg.`
        : `Rescue space (P&L < −2%) → Uncertain until P(plan)/Reg. improve`;
    case "resilient_hold":
      return it
        ? `Large/liquido/commercial in MTM ≥ 0 con P(plan) ≥ 45 → Hold`
        : `Resilient large/liquid/commercial with MTM ≥ 0 and P(plan) ≥ 45 → Hold`;
    case "default_review":
      return it
        ? `P(plan) < 50 e SDS insufficiente → Incerto (profilo non deciso)`
        : `P(plan) < 50 and weak SDS → Uncertain (undecided profile)`;
    case "closed_pnl_buy":
      return it ? `Posizione chiusa con P&L ≥ +5% → Buy` : `Closed position P&L ≥ +5% → Buy`;
    case "closed_pnl_hold":
      return it ? `Posizione chiusa, P&L tra −2% e +5% → Hold` : `Closed position, P&L between −2% and +5% → Hold`;
    case "closed_pnl_sell":
      return it ? `Posizione chiusa con P&L < −2% → Sell` : `Closed position P&L < −2% → Sell`;
    case "low_liq_noise_review": {
      const reason = s.lowLiqReason && s.lowLiqReason.trim().length > 0
        ? ` (${s.lowLiqReason})`
        : "";
      return it
        ? `Ticker illiquido / sub-dime con |Δ 24h| > 15% → Incerto (bounce di microstruttura, non segnale direzionale)${reason}`
        : `Illiquid / sub-dime ticker with |Δ 24h| > 15% → Uncertain (microstructure bounce, not directional signal)${reason}`;
    }
    case "soft_buy_g1":
      return it
        ? `Soft BUY G1: SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 20 · P(plan) ${p} ≥ 50 · rialzo ≥2 sessioni · P(cont) ok se 10d%≥5% (off-book)`
        : `Soft BUY G1: SDS ${s.sds != null ? Math.round(s.sds) : "—"} ≥ 20 · P(plan) ${p} ≥ 50 · rising ≥2 sessions · P(cont) ok if 10d%≥5% (off-book)`;
    case "soft_sell_g1":
      return it
        ? `Soft SELL G1: P&L ${pnl}% ≤ −2.5% con risk≥40 / reg≥45 / P(plan)<50`
        : `Soft SELL G1: P&L ${pnl}% ≤ −2.5% with risk≥40 / reg≥45 / P(plan)<50`;
    case "urgent_sell_g2":
      return it
        ? `Urgent SELL G2: budget 20% day-wins (oggi+sessione prec.) — taglio perdenti day peggiori`
        : `Urgent SELL G2: 20% day-win budget (today+prior session) — cut worst day losers`;
    default:
      return it ? "Regole multi-score" : "Multi-score rules";
  }
}

function recHeadline(rec: DecisionRec, it: boolean): string {
  switch (rec) {
    case "buy":
      return it ? "Buy — setup favorevole" : "Buy — favorable setup";
    case "hold":
      return it ? "Hold — mantieni, nessun segnale di uscita" : "Hold — keep, no exit signal";
    case "review":
      return it ? "Incerto — profilo non deciso o in rescue" : "Uncertain — undecided or rescue profile";
    case "sell":
      return it ? "Sell — segnale di uscita" : "Sell — exit signal";
    default:
      return rec;
  }
}

/** Explain why this recommendation was chosen and what would change it. */
export function explainRecommendation(
  s: DecisionScoreInput,
  finalRec: DecisionRec,
  it: boolean,
  operationalAction?: "buy" | "sell" | "hold" | "review" | "none" | null,
): RecommendationExplanation {
  const traced = traceRecommendation(s);
  const op =
    operationalAction === "buy" ||
    operationalAction === "sell" ||
    operationalAction === "hold" ||
    operationalAction === "review"
      ? operationalAction
      : null;

  if (op != null && op !== traced.rec && op !== "review") {
    return {
      headline: recHeadline(finalRec, it),
      trigger: it
        ? `Motore sim loop imposta ${op.toUpperCase()} (score multi-asse = ${traced.rec.toUpperCase()})`
        : `Sim loop engine sets ${op.toUpperCase()} (multi-score = ${traced.rec.toUpperCase()})`,
      buyGaps: buyGapLines(s, it),
      sellWarnings: sellWarningLines(s, it),
      source: "operational",
    };
  }

  if (s.status === "closed") {
    return {
      headline: recHeadline(finalRec, it),
      trigger: ruleTriggerText(traced.rule, s, it),
      buyGaps: [],
      sellWarnings: [],
      source: "closed",
    };
  }

  return {
    headline: recHeadline(finalRec, it),
    trigger: ruleTriggerText(traced.rule, s, it),
    buyGaps: finalRec !== "buy" ? buyGapLines(s, it) : [],
    sellWarnings: finalRec !== "sell" ? sellWarningLines(s, it) : [],
    source: "scores",
  };
}

export function getRecommendation(s: DecisionScoreInput): DecisionRec {
  return traceRecommendation(s).rec;
}

export function getDiagnosticNote(
  s: DecisionScoreInput,
  rec: DecisionRec,
  it = true,
): string {
  void rec;
  const parts: string[] = [];

  if (s.pplan !== null && s.pplan >= 60) {
    parts.push(
      it
        ? `P(plan) alto (${Math.round(s.pplan)})`
        : `P(plan) high (${Math.round(s.pplan)})`,
    );
  }
  if (s.pplan !== null && s.pplan < 40) {
    parts.push(
      it
        ? `P(plan) basso (${Math.round(s.pplan)}) — segnale di uscita`
        : `P(plan) low (${Math.round(s.pplan)}) — exit signal`,
    );
  }
  if (s.isRescue) {
    parts.push(
      it
        ? "posizione in rescue space — 0 recuperi pieni osservati finora"
        : "position in rescue space — 0 full recoveries observed so far",
    );
  }
  if (s.regRisk !== null && s.regRisk >= 50) {
    parts.push(
      it
        ? `rischio regolatorio elevato (${Math.round(s.regRisk)}) — verificare CRL/PDUFA`
        : `high regulatory risk (${Math.round(s.regRisk)}) — check CRL/PDUFA`,
    );
  }
  if (s.mcs !== null && s.mcs > 55) {
    parts.push(
      it
        ? `contesto di mercato favorevole (MCS ${Math.round(s.mcs)}) — calo probabile causa esterna`
        : `favorable market context (MCS ${Math.round(s.mcs)}) — drop likely externally driven`,
    );
  }
  if (s.mcs !== null && s.mcs < 35) {
    parts.push(
      it
        ? `contesto di mercato avverso (MCS ${Math.round(s.mcs)}) — causa interna probabile`
        : `adverse market context (MCS ${Math.round(s.mcs)}) — internal cause likely`,
    );
  }
  if (s.pplan !== null && s.pplan >= 50 && s.pplan < 70) {
    parts.push(
      it
        ? "P(plan) nella fascia 50–70% — soggetto a variazione dopo fix bucket in corso"
        : "P(plan) in the 50–70% band — subject to change after ongoing bucket fix",
    );
  }
  if (s.mcs === null) {
    parts.push(
      it
        ? "MCS non ancora disponibile — contesto esterno non valutato"
        : "MCS not yet available — external context not assessed",
    );
  }
  if (s.pplan === null && s.sds === null && s.riskV2 === null) {
    parts.push(
      it
        ? "score insufficienti per raccomandazione affidabile"
        : "insufficient scores for reliable recommendation",
    );
  }

  return parts.length > 0
    ? `${parts.join(". ")}.`
    : it
    ? "Profilo di score nella norma — nessun segnale anomalo rilevato."
    : "Score profile within normal range — no anomalous signal detected.";
}

export function hasInsufficientScores(s: DecisionScoreInput): boolean {
  return s.pplan === null && s.sds === null && s.riskV2 === null;
}

/** Align chart buckets with sim loop / PlanProbHero (`deriveSuggestedAction`). */
export function mapOperationalActionToDecisionRec(
  action: "buy" | "sell" | "hold" | "review" | "none" | null | undefined,
): DecisionRec | null {
  if (action === "buy" || action === "sell" || action === "hold" || action === "review") {
    return action;
  }
  return null;
}

function isProfitableOpenPosition(scores: DecisionScoreInput): boolean {
  return (
    scores.status === "open" &&
    scores.pnlPct != null &&
    Number.isFinite(scores.pnlPct) &&
    scores.pnlPct > 0
  );
}

/**
 * Align Evaluation with sim-loop:
 * - Green MTM + operational SELL = continuation take-profit → keep SELL.
 * - Operational SELL is source of truth (deep Soft −12% / G2 may sell on a green day).
 * - Score-only path: demote green-MTM SELL and green-session SELL (CERS-like mild red).
 */
function demoteSellForDisplay(
  rec: DecisionRec,
  scores: DecisionScoreInput,
  opts: { fromOperational: boolean },
): DecisionRec {
  if (rec !== "sell") return rec;
  if (opts.fromOperational && isProfitableOpenPosition(scores)) {
    // Continuation exhaustion soft-sell (MTM > 0) — match Home.
    return "sell";
  }
  if (isProfitableOpenPosition(scores)) return "hold";
  // Trust deriveSuggestedAction when present — do not re-apply green-day HOLD.
  if (opts.fromOperational) return rec;
  if (
    scores.status === "open" &&
    scores.pnlPct24h != null &&
    Number.isFinite(scores.pnlPct24h) &&
    scores.pnlPct24h > 0
  ) {
    return "hold";
  }
  return rec;
}

/**
 * Decision Chart / Top KPI buckets = same arbiter as Pulse / Cutoff / Simulation.
 * When `operationalAction` is provided (`deriveSuggestedAction`), it wins.
 * Score-only `getRecommendation` is fallback when the sim loop did not run.
 */
export function resolveDecisionChartRec(
  scores: DecisionScoreInput,
  operationalAction?: "buy" | "sell" | "hold" | "review" | "none" | null,
): DecisionRec {
  let op = mapOperationalActionToDecisionRec(operationalAction);

  // Open book: BUY means "keep / accumulate" in the loop — show HOLD (Pulse chip).
  if (op === "buy" && scores.hasPosition) {
    op = "hold";
  }
  if (op != null) {
    return demoteSellForDisplay(op, scores, { fromOperational: true });
  }

  return demoteSellForDisplay(getRecommendation(scores), scores, {
    fromOperational: false,
  });
}

/**
 * Card / hero display for Decision Chart REC.
 * Soft BUY stays labeled Soft BUY when Register Buy is gated — never demote to
 * Hold (that made Top KPI say BUY while the card said Hold).
 */
export function resolveHeroDecisionRec(
  decisionRec: DecisionRec | null | undefined,
  _opts?: { buyGated?: boolean },
): DecisionRec | null {
  if (decisionRec == null) return null;
  return decisionRec;
}

export function decisionRecLabel(rec: DecisionRec, it: boolean): string {
  const map: Record<DecisionRec, [string, string]> = {
    buy: ["Buy", "Buy"],
    hold: ["Hold", "Hold"],
    review: ["Uncertain", "Incerto"],
    sell: ["Sell", "Sell"],
  };
  const pair = map[rec];
  return it ? pair[1] : pair[0];
}

export function decisionRecTextClass(rec: DecisionRec): string {
  switch (rec) {
    case "buy":
      return "text-[rgb(var(--signal-up))]";
    case "hold":
      return "text-sky-600 dark:text-sky-400";
    case "review":
      return "text-[rgb(var(--warn))]";
    case "sell":
      return "text-[rgb(var(--signal-down))]";
    default:
      return "text-ink-muted";
  }
}

export function summarizeDecisionRecs(rows: DecisionChartTickerRow[]): {
  buy: number;
  hold: number;
  review: number;
  sell: number;
} {
  let buy = 0;
  let hold = 0;
  let review = 0;
  let sell = 0;
  for (const r of rows) {
    if (r.rec === "buy") buy += 1;
    else if (r.rec === "hold") hold += 1;
    else if (r.rec === "review") review += 1;
    else sell += 1;
  }
  return { buy, hold, review, sell };
}

/** Maps decision-chart radar axis → scroll target inside the 24h card. */
export function decisionAxisToScoreSection(axisId: string): LossAnalysisScoreSection | null {
  switch (axisId) {
    case "pplan":
      return "gainPlan";
    case "sds":
      return "predBlend";
    case "eis":
      return "eisReg";
    case "riskV2":
      return "slope24h";
    case "regRisk":
      return "eisReg";
    case "mcs":
      return "priceVar";
    default:
      return null;
  }
}
