/** Decision chart — mirrored from desktop (mobile-ui only). */

export type DecisionRec = "buy" | "hold" | "review" | "sell";

export type DecisionScoreInput = {
  pplan: number | null;
  sds: number | null;
  eis: number | null;
  eisRaw: number | null;
  riskV2: number | null;
  regRisk: number | null;
  mcs: number | null;
  pnlPct: number | null;
  /** Session day move % — score-only path may demote SELL when > 0. */
  pnlPct24h?: number | null;
  isRescue: boolean;
  status: "open" | "closed";
  /** Open book: Soft BUY → HOLD on the chart. */
  hasPosition?: boolean;
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
  insufficientScores: boolean;
  hasPortfolio?: boolean;
  /** @deprecated use gainStars */
  manualGainStar?: boolean;
  gainStars?: import("./gainStarDisplay").GainStarSnapshot[];
};

export function regRiskFromSignedScore(signed: number | null | undefined): number | null {
  if (signed == null || !Number.isFinite(signed)) return null;
  return Math.round(Math.max(0, Math.min(100, (signed + 100) / 2)));
}

export function invertRiskAxis(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.round(Math.max(0, Math.min(100, 100 - raw)));
}

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
  return pnlPct != null && Number.isFinite(pnlPct) && pnlPct < -2;
}

export function getRecommendation(s: DecisionScoreInput): DecisionRec {
  if (s.status === "closed") {
    if (s.pnlPct !== null && s.pnlPct >= 5) return "buy";
    if (s.pnlPct !== null && s.pnlPct >= -2) return "hold";
    return "sell";
  }
  if (s.regRisk !== null && s.regRisk >= 70) return "sell";
  if (s.isRescue) {
    if (s.mcs !== null && s.mcs > 55 && (s.regRisk === null || s.regRisk < 30)) return "review";
    if ((s.pplan !== null && s.pplan < 40) || (s.regRisk !== null && s.regRisk >= 50)) return "sell";
    return "review";
  }
  if (s.pplan !== null && s.pplan >= 65 && (s.riskV2 === null || s.riskV2 <= 35)) return "buy";

  if (s.pnlPct != null && Number.isFinite(s.pnlPct)) {
    if (
      s.pnlPct <= -7 &&
      ((s.riskV2 != null && s.riskV2 >= 45) ||
        (s.regRisk != null && s.regRisk >= 55) ||
        (s.pplan != null && s.pplan < 45))
    ) {
      return "sell";
    }
    if (
      s.pnlPct >= 5 &&
      ((s.pplan != null && s.pplan >= 50) || (s.sds != null && s.sds >= 50)) &&
      (s.riskV2 == null || s.riskV2 <= 45) &&
      (s.regRisk == null || s.regRisk < 65)
    ) {
      return "buy";
    }
  }

  if (s.pplan !== null && s.pplan >= 50) return "hold";
  if (s.pplan === null) {
    if (s.sds !== null && s.sds >= 65 && (s.riskV2 === null || s.riskV2 <= 35)) return "buy";
    if (s.sds !== null && s.sds >= 50) return "hold";
    if (s.riskV2 !== null && s.riskV2 >= 66) return "sell";
  }
  return "review";
}

export function getDiagnosticNote(s: DecisionScoreInput, rec: DecisionRec): string {
  void rec;
  const parts: string[] = [];
  if (s.pplan !== null && s.pplan >= 65) parts.push(`P(plan) alto (${Math.round(s.pplan)})`);
  if (s.pplan !== null && s.pplan < 40) parts.push(`P(plan) basso (${Math.round(s.pplan)})`);
  if (s.isRescue) parts.push("rescue space");
  if (s.regRisk !== null && s.regRisk >= 50) parts.push(`reg. risk ${Math.round(s.regRisk)}`);
  if (s.mcs !== null && s.mcs > 55) parts.push(`MCS favorevole (${Math.round(s.mcs)})`);
  if (s.pplan === null && s.sds === null && s.riskV2 === null) {
    parts.push("score insufficienti");
  }
  return parts.length > 0 ? `${parts.join(" · ")}.` : "Profilo nella norma.";
}

export function hasInsufficientScores(s: DecisionScoreInput): boolean {
  return s.pplan === null && s.sds === null && s.riskV2 === null;
}

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
    Boolean(scores.hasPosition) &&
    scores.pnlPct != null &&
    Number.isFinite(scores.pnlPct) &&
    scores.pnlPct > 0
  );
}

/**
 * Align with desktop:
 * - Operational SELL is source of truth (deep Soft −12% / G2 may sell on a green day).
 * - Score-only path: demote green-MTM and green-session SELL.
 */
function demoteSellForDisplay(
  rec: DecisionRec,
  scores: DecisionScoreInput,
  opts: { fromOperational: boolean },
): DecisionRec {
  if (rec !== "sell") return rec;
  if (opts.fromOperational && isProfitableOpenPosition(scores)) {
    // Continuation take-profit (MTM > 0) — keep SELL when operational said so.
    return "sell";
  }
  if (isProfitableOpenPosition(scores)) return "hold";
  if (opts.fromOperational) return rec;
  if (
    scores.pnlPct24h != null &&
    Number.isFinite(scores.pnlPct24h) &&
    scores.pnlPct24h > 0
  ) {
    return "hold";
  }
  return rec;
}

/**
 * Same arbiter as desktop: Soft BUY/SELL operational action wins over score-only.
 */
export function resolveDecisionChartRec(
  scores: DecisionScoreInput,
  operationalAction?: "buy" | "sell" | "hold" | "review" | "none" | null,
): DecisionRec {
  let op = mapOperationalActionToDecisionRec(operationalAction);
  if (op === "buy" && scores.hasPosition) op = "hold";
  if (op != null) {
    return demoteSellForDisplay(op, scores, { fromOperational: true });
  }
  return demoteSellForDisplay(getRecommendation(scores), scores, {
    fromOperational: false,
  });
}
