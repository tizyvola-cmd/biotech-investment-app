/**
 * Target / stop in pp sulla curva sparkline (stesso motore del Decision Lab).
 */
import { completionDateToNowOffset } from "./chartNowOffset";
import {
  buildSlopeAwareTargetStop,
  type DynamicTargetMode,
  type DynamicTargetStop,
} from "./dynamicTargetStop";
import { signalMetricsFromSimRow } from "./investSignalScore";
import { extractCurveInputs } from "./precatCurve";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import { readPred5Pp } from "./simulationPlanGain";
import { pipelineToneFromReturnPct } from "./pipelineOpportunity";

export type SparklineTargetStop = {
  /** Livello target (% vs «oggi» sulla curva disegnata). */
  targetHighPp: number;
  /** Livello stop (% vs «oggi»). */
  stopPp: number;
};

export type ModelTargetDisplay = {
  mode: "rise" | "fall" | "flat";
  targetPriceUsd: number | null;
  targetPct: number | null;
  tooltipIt: string;
  tooltipEn: string;
};

function applyPricePct(price: number, pct: number): number {
  return price * (1 + pct / 100);
}

function fmtTargetUsd(v: number): string {
  const d = Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 2;
  return `$${v.toFixed(d)}`;
}

function resolveIsLong(
  pred5: number | null,
  slope5d: number | null,
): boolean {
  const predClearlyNegative =
    pred5 != null && pred5 < -tradeCalibThreshold("pred_significant_pp");
  const predSignificant =
    pred5 != null && Math.abs(pred5) >= tradeCalibThreshold("pred_significant_pp");
  const slopeSignificant =
    slope5d != null &&
    Math.abs(slope5d) >= tradeCalibThreshold("slope_significant_pp_per_day");
  if (predSignificant) return pred5! > 0;
  if (slopeSignificant) return slope5d! > 0;
  if (predClearlyNegative) return false;
  return true;
}

function buildTargetStopForRow(
  row: Record<string, unknown>,
  columns?: string[],
): DynamicTargetStop | null {
  const daysRaw = completionDateToNowOffset(row["Completion Date"]);
  if (daysRaw == null || !Number.isFinite(daysRaw) || daysRaw <= 0) return null;

  const { slope5d, slope20d, slope45d, runUp30d } = extractCurveInputs(row);
  const pred5 = columns?.length
    ? signalMetricsFromSimRow(row, columns).pred5Pp
    : readPred5Pp(row);
  const isLong = resolveIsLong(pred5, slope5d);

  return buildSlopeAwareTargetStop({
    slope5d,
    slope20d,
    slope45d,
    runUp30d,
    days: daysRaw,
    isLong,
    stabilityVerdict: "watch",
    rotationFlag: 0,
  });
}

export function sparklineTargetStopFromSimRow(
  row: Record<string, unknown>,
  columns: string[],
): SparklineTargetStop | null {
  const ts = buildTargetStopForRow(row, columns);
  if (!ts) return null;
  return {
    targetHighPp: ts.targetHighPct,
    stopPp: ts.stopPct,
  };
}

/** Target price (rialzo) o freccia ↓ (ribasso) per colonna tabella Simulation. */
export function resolveModelTargetDisplay(
  row: Record<string, unknown>,
  currPriceUsd: number | null,
  columns?: string[],
  planReturnPct?: number | null,
): ModelTargetDisplay | null {
  const ts = buildTargetStopForRow(row, columns);
  const tone = pipelineToneFromReturnPct(planReturnPct);

  let mode: DynamicTargetMode | "unknown" = ts?.mode ?? "unknown";
  if (mode === "unknown" && tone === "gain") mode = "rise";
  if (mode === "unknown" && tone === "loss") mode = "fall";
  if (mode === "unknown" && tone === "flat") mode = "flat";

  if (mode === "fall" || tone === "loss") {
    return {
      mode: "fall",
      targetPriceUsd: null,
      targetPct: ts?.expectedPct ?? planReturnPct ?? null,
      tooltipIt:
        ts?.modelHint ??
        (planReturnPct != null
          ? `Modello in calo verso CD (${planReturnPct >= 0 ? "+" : ""}${planReturnPct.toFixed(1)}%)`
          : "Traiettoria modello in calo verso CD"),
      tooltipEn:
        ts?.modelHint ??
        (planReturnPct != null
          ? `Model declining toward CD (${planReturnPct >= 0 ? "+" : ""}${planReturnPct.toFixed(1)}%)`
          : "Model curve declining toward CD"),
    };
  }

  const targetPct =
    ts?.mode === "rise"
      ? ts.targetHighPct
      : planReturnPct != null && planReturnPct > 0
        ? planReturnPct
        : ts?.expectedPct ?? null;

  if (
    (mode === "rise" || tone === "gain") &&
    currPriceUsd != null &&
    currPriceUsd > 0 &&
    targetPct != null &&
    targetPct > 0
  ) {
    const targetPriceUsd = applyPricePct(currPriceUsd, targetPct);
    const pctLabel = `${targetPct >= 0 ? "+" : ""}${targetPct.toFixed(1)}%`;
    return {
      mode: "rise",
      targetPriceUsd,
      targetPct,
      tooltipIt:
        ts?.modelHint ??
        `Target modello ${pctLabel} → ${fmtTargetUsd(targetPriceUsd)} verso CD`,
      tooltipEn:
        ts?.modelHint ??
        `Model target ${pctLabel} → ${fmtTargetUsd(targetPriceUsd)} toward CD`,
    };
  }

  if (mode === "flat" || tone === "flat") {
    return {
      mode: "flat",
      targetPriceUsd: null,
      targetPct: null,
      tooltipIt: "Traiettoria modello piatta verso CD",
      tooltipEn: "Flat model trajectory toward CD",
    };
  }

  return null;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export type TargetProgressFill = {
  ratio: number | null;
  tone: "up" | "warn" | "muted";
};

/**
 * Avanzamento verso target per torta Simulation:
 * - in portafoglio: (prezzo − buy) / (target − buy)
 * - fuori portafoglio: prezzo corrente / target (quota del prezzo obiettivo)
 */
export function computeTargetProgress(
  display: ModelTargetDisplay | null,
  currPriceUsd: number | null,
  opts?: { buyPriceUsd?: number | null; inPortfolio?: boolean },
): TargetProgressFill {
  if (!display) return { ratio: null, tone: "muted" };

  if (display.mode === "fall") {
    return { ratio: null, tone: "warn" };
  }
  if (display.mode === "flat") {
    return { ratio: null, tone: "muted" };
  }

  const target = display.targetPriceUsd;
  const curr = currPriceUsd;
  if (target == null || curr == null || curr <= 0 || target <= 0) {
    return { ratio: null, tone: "muted" };
  }

  const buy = opts?.buyPriceUsd;
  const inPortfolio = opts?.inPortfolio === true;

  if (inPortfolio && buy != null && buy > 0 && target > buy) {
    const ratio = clamp01((curr - buy) / (target - buy));
    return { ratio, tone: ratio >= 0.95 ? "up" : "up" };
  }

  // For opportunities not in portfolio, progress is always 0 (not yet invested)
  if (!inPortfolio) {
    return { ratio: 0, tone: "muted" };
  }

  // For portfolio positions without a valid buy price, show empty progress
  return { ratio: 0, tone: "muted" };
}
