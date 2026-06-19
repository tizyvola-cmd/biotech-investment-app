/**
 * Gate for risk-weighted portfolio sizing in Step 3 / Three-portfolio compare.
 *
 * Weighted allocation is disabled until BOTH:
 *   - at least WEIGHTED_SIZING_MIN_TRADES resolved closed trades fed shrinkage, AND
 *   - at least one calibration cell has confidence === "high" (n ≥ 15).
 */
import type { CalibrationSnapshot } from "./calibrationTypes";

export const WEIGHTED_SIZING_MIN_TRADES = 25;

export type WeightedSizingGateReason =
  | "insufficient_trades"
  | "no_high_confidence_bucket";

export type WeightedSizingGateStatus = {
  ok: boolean;
  totalTrades: number;
  highConfidenceCellCount: number;
  reasons: WeightedSizingGateReason[];
};

export function countHighConfidenceCells(snapshot: CalibrationSnapshot | null): number {
  if (!snapshot) return 0;
  let n = 0;
  for (const dim of Object.values(snapshot.dimensions)) {
    for (const cell of dim.cells) {
      if (cell.inactive == null && cell.confidence === "high") n += 1;
    }
  }
  return n;
}

export function evaluateWeightedSizingGate(
  snapshot: CalibrationSnapshot | null,
): WeightedSizingGateStatus {
  const totalTrades = snapshot?.totalTrades ?? 0;
  const highConfidenceCellCount = countHighConfidenceCells(snapshot);
  const reasons: WeightedSizingGateReason[] = [];
  if (totalTrades < WEIGHTED_SIZING_MIN_TRADES) {
    reasons.push("insufficient_trades");
  }
  if (highConfidenceCellCount === 0) {
    reasons.push("no_high_confidence_bucket");
  }
  return {
    ok: reasons.length === 0,
    totalTrades,
    highConfidenceCellCount,
    reasons,
  };
}

export function weightedSizingGateMessage(
  gate: WeightedSizingGateStatus,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  const parts: string[] = [];
  if (gate.reasons.includes("insufficient_trades")) {
    parts.push(
      it
        ? `servono almeno ${WEIGHTED_SIZING_MIN_TRADES} trade chiusi (ora ${gate.totalTrades})`
        : `need at least ${WEIGHTED_SIZING_MIN_TRADES} closed trades (currently ${gate.totalTrades})`,
    );
  }
  if (gate.reasons.includes("no_high_confidence_bucket")) {
    parts.push(
      it
        ? "almeno un bucket di calibrazione con confidence HIGH (n≥15)"
        : "at least one calibration bucket with HIGH confidence (n≥15)",
    );
  }
  const req = parts.join(it ? " e " : " and ");
  return it
    ? `Sizing pesato disabilitato finché non ci sono ${req}. Usa uniforme o manuale.`
    : `Weighted sizing disabled until ${req}. Use uniform or manual instead.`;
}

export function weightedSizingGateTitle(lang: "it" | "en"): string {
  return lang === "it" ? "Sizing pesato non ancora affidabile" : "Weighted sizing not reliable yet";
}
