/**
 * Outlook riga tabella da traiettoria curva modello (oggi → CD).
 * Giallo = decrescita con recupero ≥ 3× la perdita; rosso altrimenti.
 */
import type { ChartPoint } from "../types";
import { buildForwardCurveRelativePath } from "./simulationSparkline";

export type CurveTrajectoryOutlook = "gain" | "loss" | "warn" | "flat";

export type CurveTrajectoryMetrics = {
  maxDrawdownPp: number;
  recoveryPp: number;
  netPeakPp: number;
  trailingSlopePpPerDay: number | null;
};

/** Rapporto minimo recupero / drawdown per «to watch» (giallo). */
export const CURVE_RECOVERY_WATCH_RATIO = 3;

const FLAT_PP = 0.8;
/** Drawdown minimo (pp) per considerare un tratto in decrescita. */
const DECLINE_PP = 1.5;
/** Crescita netta minima (pp) su curva senza drawdown significativo. */
const GAIN_PP = 1.2;
/** Dopo un drawdown, verde solo se il picco atteso supera questa soglia (crescita forte). */
export const STRONG_GROWTH_AFTER_DIP_PP = 10.0;

export function analyzeCurveTrajectoryMetrics(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
): CurveTrajectoryMetrics | null {
  const path = buildForwardCurveRelativePath(row, points);
  if (!path || path.relPoints.length < 2) return null;

  const rels = path.relPoints.map((p) => p.relPp);
  let minRel = 0;
  let minIdx = 0;
  for (let i = 0; i < rels.length; i++) {
    if (rels[i] < minRel) {
      minRel = rels[i];
      minIdx = i;
    }
  }

  const maxDrawdownPp = Math.max(0, -minRel);
  let peakAfterTrough = minRel;
  for (let i = minIdx; i < rels.length; i++) {
    peakAfterTrough = Math.max(peakAfterTrough, rels[i]);
  }
  const recoveryPp = minRel < -FLAT_PP ? peakAfterTrough - minRel : 0;

  return {
    maxDrawdownPp,
    recoveryPp,
    netPeakPp: path.netPeakPp,
    trailingSlopePpPerDay: path.trailingSlopePpPerDay,
  };
}

export function resolveCurveTrajectoryOutlook(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
): CurveTrajectoryOutlook | null {
  const metrics = analyzeCurveTrajectoryMetrics(row, points);
  if (!metrics) return null;

  const { maxDrawdownPp, recoveryPp, netPeakPp, trailingSlopePpPerDay } = metrics;

  if (maxDrawdownPp < FLAT_PP && Math.abs(netPeakPp) < FLAT_PP) {
    return "flat";
  }

  if (maxDrawdownPp >= DECLINE_PP) {
    if (recoveryPp >= CURVE_RECOVERY_WATCH_RATIO * maxDrawdownPp) {
      const trailingUp =
        trailingSlopePpPerDay == null || trailingSlopePpPerDay >= -0.02;
      if (netPeakPp >= STRONG_GROWTH_AFTER_DIP_PP && trailingUp) return "gain";
      return "warn";
    }
    return "loss";
  }

  if (netPeakPp >= GAIN_PP) return "gain";
  if (netPeakPp <= -DECLINE_PP) return "loss";
  return "flat";
}

/** Fallback senza bundle curva: usa ROI target come proxy del recupero atteso. */
export function resolvePlanRecoveryOutlook(outlook: {
  pnlPct?: number | null;
  planReturnPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  slopeDeclining?: boolean;
}): CurveTrajectoryOutlook {
  const plan = outlook.planReturnPct;
  const lossMag =
    outlook.pnlPct != null && Number.isFinite(outlook.pnlPct) && outlook.pnlPct < 0
      ? Math.abs(outlook.pnlPct)
      : 0;

  if (outlook.slopeDeclining) {
    if (
      plan != null &&
      plan > 0 &&
      plan >= CURVE_RECOVERY_WATCH_RATIO * Math.max(lossMag, DECLINE_PP)
    ) {
      return plan >= STRONG_GROWTH_AFTER_DIP_PP ? "gain" : "warn";
    }
    return "loss";
  }

  if (plan != null && plan >= GAIN_PP) return "gain";
  if (plan != null && plan <= -DECLINE_PP) return "loss";
  if (lossMag >= DECLINE_PP && plan != null && plan > 0) {
    return plan >= CURVE_RECOVERY_WATCH_RATIO * lossMag ? "warn" : "loss";
  }
  return "flat";
}
