/**
 * Target / Stop dinamici da pendenza curva (precat) + bande σ calibrate.
 * Se sale → target da traiettoria modello verso CD.
 * Se scende → max drawdown tollerato (P(rebound)) poi vendita obbligatoria.
 */
import { buildPrecatEntry, computePrecatCurve, classifyRegime } from "./precatCurve";
import type { StabilityVerdict } from "./slopeStability";
import { tradeCalibThreshold } from "./investmentTradeCalib";

export type DynamicTargetMode = "rise" | "fall" | "flat";

export type DynamicTargetStop = {
  targetLowPct: number;
  targetHighPct: number;
  stopPct: number;
  /** Sotto questo % P&L → vendere (stop dinamico slope). */
  sellTriggerPct: number;
  mode: DynamicTargetMode;
  expectedPct: number | null;
  probReboundPct: number | null;
  effSlopePpd: number;
  modelHint: string;
  detail: string;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Target/stop da slope + curva precat (orizzonte = giorni al CD).
 * Ritorna null se CD passato o slope piatta (usa fallback pred/cohort).
 */
export function buildSlopeAwareTargetStop(params: {
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  runUp30d: number | null;
  days: number | null;
  isLong: boolean;
  stabilityVerdict: StabilityVerdict;
  rotationFlag: 0 | 1;
}): DynamicTargetStop | null {
  const { slope5d, slope20d, runUp30d, days, isLong, stabilityVerdict, rotationFlag } = params;
  void params.slope45d;

  if (days == null || days <= 0) return null;

  const precat = buildPrecatEntry(slope5d, slope20d, runUp30d, days);
  const curve = computePrecatCurve(slope20d, slope5d, runUp30d, days);
  const effSlope = curve.effSlope;
  const regime = classifyRegime(runUp30d);

  const flatThr = tradeCalibThreshold("dynamic_slope_flat_pp_per_day");
  if (Math.abs(effSlope) < flatThr) return null;

  const expectedPct = precat.expectedReturnPct ?? round1(effSlope * days);
  const probUp = precat.probPositive;

  const recoveringLong =
    isLong &&
    expectedPct != null &&
    expectedPct > 0 &&
    slope5d != null &&
    slope5d > flatThr &&
    effSlope < -flatThr;

  const modeSlope = recoveringLong ? slope5d! : effSlope;

  const wp = curve.waypoints.length
    ? curve.waypoints[curve.waypoints.length - 1]
    : null;
  const ci68Lo = wp?.ci68Lo ?? expectedPct - curve.sigmaBasePp * 0.65;
  const ci68Hi = wp?.ci68Hi ?? expectedPct + curve.sigmaBasePp * 0.65;
  const ci90Lo = wp?.ci90Lo ?? expectedPct - curve.sigmaBasePp * 1.1;

  const forceSell =
    !recoveringLong &&
    (rotationFlag === 1 ||
      stabilityVerdict === "exit" ||
      stabilityVerdict === "avoid");

  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  if (isLong && modeSlope > flatThr) {
    const targetLow = round1(clamp(Math.min(ci68Lo, expectedPct * 0.55), 0.5, 40));
    const targetHigh = round1(
      clamp(Math.max(ci68Hi, expectedPct * 1.15, targetLow + 0.8), targetLow + 0.5, 55)
    );
    const stop = round1(-clamp(curve.sigmaBasePp * 0.35, 3, 10));
    const sellAt = forceSell ? round1(Math.max(stop, -5)) : stop;
    return {
      targetLowPct: targetLow,
      targetHighPct: targetHigh,
      stopPct: stop,
      sellTriggerPct: sellAt,
      mode: "rise",
      expectedPct,
      probReboundPct: probUp,
      effSlopePpd: modeSlope,
      modelHint: recoveringLong
        ? `↗ recovery ${fmtPct(expectedPct)} to CD · hold for target`
        : `↑ model ${fmtPct(expectedPct)} to CD · P↑ ${probUp ?? "—"}%`,
      detail: recoveringLong
        ? `Short-term recovery ${modeSlope.toFixed(2)} pp/d (20d still ${effSlope.toFixed(2)}) · ${regime} · stop ${fmtPct(stop)}`
        : `Rising slope ${modeSlope.toFixed(2)} pp/d (${curve.slopeSource}) · ${regime} · stop cushion ${fmtPct(stop)}`,
    };
  }

  if (isLong && modeSlope < -flatThr) {
    const reboundWide = probUp != null && probUp >= 42 && rotationFlag === 0;
    const maxDip = round1(
      clamp(Math.abs(ci90Lo) * (reboundWide ? 1.0 : 0.65), 5, reboundWide ? 22 : 14)
    );
    const stop = -maxDip;
    const sellAt = forceSell
      ? round1(-clamp(maxDip * 0.45, 4, 10))
      : stop;
    const targetLow = round1(Math.min(-0.5, expectedPct * 1.15));
    const targetHigh = round1(Math.min(-0.2, expectedPct * 0.45));
    return {
      targetLowPct: targetLow,
      targetHighPct: targetHigh,
      stopPct: stop,
      sellTriggerPct: sellAt,
      mode: "fall",
      expectedPct,
      probReboundPct: probUp,
      effSlopePpd: effSlope,
      modelHint: reboundWide
        ? `↓ max dip ${maxDip}% · sell < ${fmtPct(sellAt)}`
        : `↓ sell < ${fmtPct(sellAt)} (low rebound ${probUp ?? "—"}%)`,
      detail: `Falling slope ${effSlope.toFixed(2)} pp/d · P(rebound) ${probUp ?? "—"}% · ${forceSell ? "rotation/exit → tight stop" : "wider stop while trend may recover"}`,
    };
  }

  if (!isLong && effSlope < -0.05) {
    const targetLow = round1(Math.min(-1, expectedPct * 1.2));
    const targetHigh = round1(Math.min(-0.3, expectedPct * 0.5));
    const stop = round1(clamp(curve.sigmaBasePp * 0.4, 5, 12));
    return {
      targetLowPct: targetLow,
      targetHighPct: targetHigh,
      stopPct: stop,
      sellTriggerPct: forceSell ? round1(stop * 0.6) : stop,
      mode: "fall",
      expectedPct,
      probReboundPct: probUp,
      effSlopePpd: effSlope,
      modelHint: `↓ short to ${fmtPct(expectedPct)}`,
      detail: `Negative slope favours short · ${curve.slopeSource}`,
    };
  }

  if (!isLong && effSlope > 0.05) {
    const targetLow = round1(Math.max(1, expectedPct * 0.5));
    const targetHigh = round1(Math.max(targetLow + 0.5, expectedPct * 1.1));
    const stop = round1(clamp(curve.sigmaBasePp * 0.4, 5, 12));
    return {
      targetLowPct: targetLow,
      targetHighPct: targetHigh,
      stopPct: stop,
      sellTriggerPct: stop,
      mode: "rise",
      expectedPct,
      probReboundPct: probUp,
      effSlopePpd: effSlope,
      modelHint: `↑ cover risk · stock rising ${fmtPct(expectedPct)}`,
      detail: `Positive slope vs short · exit if stop ${fmtPct(stop)} hit`,
    };
  }

  return null;
}
