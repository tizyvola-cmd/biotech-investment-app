/**
 * Mini-curve of the recalibrated BEST PREDICTION (Prediction + Recalibration).
 *
 * Preferred source: ``pct_foglio`` (Simulation sheet Pred + K-8/AI feed recalib),
 * same field as the large ``SimulationCurveChart``. Falls back to ``pct_curva``
 * (seq curve) then ``pct_modello`` (v4 global cal only).
 *
 * Overlays the historical real price (``pct_reale``) in light gray where
 * available, marks the "today" position and colors based on the FORWARD
 * trend (from today onward) to avoid reading "green" on a past peak.
 *
 * When the recalibrated curve diverges from the pure model (max gap >
 * DIVERGE_HINT_PP) a small "R" marker is shown in the corner to indicate
 * "here real historical data is modifying the future pred".
 *
 * Further fallback: if the chart bundle (``simulation_charts_snapshot.json``)
 * is not loaded, use the 8 sheet columns (Pred −60..+7) as before.
 */

import type { ChartPoint } from "../types";
import { resolveDisplayRecalibPoints } from "./predictionCurveGrid";
import { livePctVsM60AtToday } from "./predictionCurveDailyRecalib";
import { chartPointSortKey, includeChartNode } from "./chartNodes";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { SparklineLevelMarker, SparklineNowMarker } from "./nowTimelineMarker";
import type { SparklineTargetStop } from "./simRowTargetStop";
import { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";
import {
  CD_HOT_ZONE_OPACITY_SPARK,
  CD_HOT_ZONE_RGB,
  CD_WATCH_ZONE_OPACITY_SPARK,
  CD_WATCH_ZONE_RGB,
} from "./chartCdZones";
import { t } from "../shared/i18n";
import { extractCurveInputs } from "./precatCurve";
import { isMarketSlopeDeclining, resolveMarketSlopeTone } from "./portfolioGainLossStyle";

type FallbackPoint = { offset: number; val: number };

/**
 * Extracts the curve points from the 8 "Δ% vs Pred−60 Pred ±X" sheet columns.
 *
 * Values in the sheet are FRACTIONS (e.g. 0.0032 = 0.32%), while the chart
 * bundle uses PERCENTAGE POINTS (e.g. 0.32). We normalize to pp by multiplying
 * x100 when |val| < 1 (heuristic but robust: a pred variation exceeding 100%
 * of the price is practically impossible for these horizons, while sub-fractions
 * indicate decimal percentage notation). Without this scaling the forward
 * trend color threshold (0.1pp) would treat every sheet signal as "flat" → all
 * sparklines gray.
 */
export function extractSparklinePoints(row: Record<string, unknown>): FallbackPoint[] {
  const raw = Object.entries(row)
    .filter(([k]) => k.startsWith("Δ%") && k.includes("Pred\n"))
    .map(([k, v]) => {
      const m = k.match(/([+−-])(\d+)\s*$/u);
      if (!m) return null;
      const sign = m[1] === "+" ? 1 : -1;
      const offset = Number(m[2]) * sign;
      const val = Number(v);
      return Number.isFinite(offset) && Number.isFinite(val) ? { offset, val } : null;
    })
    .filter((x): x is FallbackPoint => x !== null);

  const maxAbs = raw.reduce((m, p) => Math.max(m, Math.abs(p.val)), 0);
  const needsScale = maxAbs > 0 && maxAbs < 1;
  const scale = needsScale ? 100 : 1;
  return raw
    .map((p) => ({ offset: p.offset, val: p.val * scale }))
    .sort((a, b) => a.offset - b.offset);
}

function xForOffset(
  offset: number,
  minOff: number,
  maxOff: number,
  width: number,
  padX: number
): number {
  if (maxOff === minOff) return width / 2;
  const t = (offset - minOff) / (maxOff - minOff);
  return padX + t * (width - 2 * padX);
}

function yForVal(val: number, min: number, range: number, height: number, padY: number): number {
  return padY + (1 - (val - min) / range) * (height - 2 * padY);
}

/** Bande pre-CD: watching (−120…−60d) e hot (−60…0d), stesso calendario di cdHorizons. */
function SparklineCdZoneBands({
  minOff,
  maxOff,
  width,
  height,
  padX,
  showZoneLabels,
}: {
  minOff: number;
  maxOff: number;
  width: number;
  height: number;
  padX: number;
  showZoneLabels?: boolean;
}) {
  const zones: { from: number; to: number; fill: string; label: string; short: string; hot: boolean }[] = [
    {
      from: -SIM_MONITOR_HORIZON_DAYS,
      to: -SIM_HOT_ZONE_DAYS,
      fill: CD_WATCH_ZONE_RGB,
      label: t("signals.timing.watchZone"),
      short: t("signals.sparkline.zoneWatching"),
      hot: false,
    },
    {
      from: -SIM_HOT_ZONE_DAYS,
      to: 0,
      fill: CD_HOT_ZONE_RGB,
      label: t("signals.sparkline.zoneHot"),
      short: t("signals.sparkline.zoneHot"),
      hot: true,
    },
  ];

  const labelY = height - 2;
  const fontSize = height >= 52 ? 7 : height >= 40 ? 6 : 5.5;

  return (
    <>
      {zones.map((z) => {
        const lo = Math.max(z.from, minOff);
        const hi = Math.min(z.to, maxOff);
        if (lo >= hi) return null;
        const x1 = xForOffset(lo, minOff, maxOff, width, padX);
        const x2 = xForOffset(hi, minOff, maxOff, width, padX);
        const w = Math.max(0.5, x2 - x1);
        const isHot = z.hot;
        return (
          <g key={z.label}>
            <rect
              x={x1}
              y={0}
              width={w}
              height={height}
              fill={z.fill}
              opacity={isHot ? CD_HOT_ZONE_OPACITY_SPARK : CD_WATCH_ZONE_OPACITY_SPARK}
              aria-hidden
            >
              <title>{z.label}</title>
            </rect>
            {showZoneLabels && w >= 18 ? (
              <text
                x={x1 + w / 2}
                y={labelY}
                textAnchor="middle"
                fontSize={fontSize}
                fontWeight="600"
                fill={isHot ? "rgb(var(--cd-hot-zone-label))" : "rgb(var(--cd-watch-zone-label))"}
                opacity="0.92"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {z.short}
              </text>
            ) : null}
          </g>
        );
      })}
    </>
  );
}

const FORWARD_TREND_THRESHOLD_PP = 0.1;
/** Above this divergence the recalibrated curve is "pulling" the future pred
 *  and we show it with a small visual marker in the sparkline. */
const DIVERGE_HINT_PP = 0.5;

/** Posizione aperta — colora il tratto realizzato vs previsione modello. */
export type SparklinePortfolioContext = {
  pnlPct: number | null;
  buyPriceUsd?: number | null;
};

function realizedTrendColor(pnlPct: number | null | undefined): string {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return "rgb(var(--ink-muted))";
  if (pnlPct >= FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-up))";
  if (pnlPct <= -FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-down))";
  return "rgb(var(--ink-muted))";
}

function priceT60FromDense(_dense: DenseSparklinePoint[], row: Record<string, unknown>): number | null {
  for (const k of ["close_m60", "seq_curve_t60_usd", "close_m60_cal"]) {
    const raw = row[k];
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function entryPctVsM60(
  row: Record<string, unknown>,
  buyPriceUsd: number | null | undefined,
): number | null {
  if (buyPriceUsd == null || !Number.isFinite(buyPriceUsd) || buyPriceUsd <= 0) return null;
  const p60 = priceT60FromDense([], row);
  if (p60 == null || p60 <= 0) return null;
  return Math.round(((buyPriceUsd / p60 - 1) * 100) * 100) / 100;
}

function sparklineRisingTowardTarget(
  row: Record<string, unknown> | undefined,
  fwdDeltaPp: number | null,
): boolean {
  if (fwdDeltaPp != null && Number.isFinite(fwdDeltaPp)) {
    if (fwdDeltaPp <= -FORWARD_TREND_THRESHOLD_PP) return false;
    if (fwdDeltaPp >= FORWARD_TREND_THRESHOLD_PP) return true;
  }
  if (!row) return false;
  const { slope5d, slope20d } = extractCurveInputs(row);
  if (isMarketSlopeDeclining(slope5d, slope20d)) return false;
  return resolveMarketSlopeTone(slope5d, slope20d) === "gain";
}

function slopeTrendColor(slope5d: number | null, slope20d: number | null): string {
  const eff = slope5d ?? slope20d;
  if (eff == null || !Number.isFinite(eff)) return "rgb(var(--ink-muted))";
  if (eff >= FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-up))";
  if (eff <= -FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-down))";
  return "rgb(var(--ink-muted))";
}

function trendColor(deltaFwdPp: number | null): string {
  if (deltaFwdPp == null) return "rgb(var(--ink-muted))";
  if (deltaFwdPp >= FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-up))";
  if (deltaFwdPp <= -FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-down))";
  return "rgb(var(--ink-muted))";
}

export type DenseSparklinePoint = {
  offset: number;
  /** Value drawn on the main line (Prediction + Recalibration path). */
  best: number;
  /** Source of the best value. */
  bestSource: "foglio" | "ricalibrata" | "modello";
  /** Pure v4 model (only for estimating divergence vs recalibrated, not drawn). */
  modello: number | null;
  /** Observed historical real price, if available (gray overlay). */
  reale: number | null;
};

/** Extract dense bundle points (standard + K-8 + AI feed recalib knots).
 *  Priority: pct_foglio → pct_curva → pct_modello. */
function densePointsFromBundle(
  bundlePoints: ChartPoint[] | undefined | null
): DenseSparklinePoint[] | null {
  if (!bundlePoints || bundlePoints.length === 0) return null;
  const sorted = [...bundlePoints]
    .filter((p) => p && includeChartNode(p, { includeRecalibExtras: true }))
    .filter((p) => Number.isFinite(p.offset))
    .sort((a, b) => {
      const ka = chartPointSortKey(a);
      const kb = chartPointSortKey(b);
      return ka[0] !== kb[0] ? ka[0] - kb[0] : ka[1] - kb[1];
    });

  const byOffset = new Map<number, DenseSparklinePoint>();
  for (const p of sorted) {
      const hasFoglio = typeof p.pct_foglio === "number" && Number.isFinite(p.pct_foglio);
      const hasCurva = typeof p.pct_curva === "number" && Number.isFinite(p.pct_curva);
      const hasModelloRaw =
        typeof p.pct_modello_raw === "number" && Number.isFinite(p.pct_modello_raw);
      const hasModello = typeof p.pct_modello === "number" && Number.isFinite(p.pct_modello);
      const best: number | null = hasFoglio
        ? (p.pct_foglio as number)
        : hasCurva
          ? (p.pct_curva as number)
          : hasModello
            ? (p.pct_modello as number)
            : null;
      const bestSource: DenseSparklinePoint["bestSource"] = hasFoglio
        ? "foglio"
        : hasCurva
          ? "ricalibrata"
          : "modello";
    if (best == null || !Number.isFinite(best)) continue;
    byOffset.set(p.offset, {
      offset: p.offset,
      best: best as number,
      bestSource,
      modello: hasModelloRaw
        ? (p.pct_modello_raw as number)
        : hasModello
          ? (p.pct_modello as number)
          : null,
      reale:
        typeof p.pct_reale === "number" && Number.isFinite(p.pct_reale)
          ? p.pct_reale
          : null,
    });
  }
  const filtered = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  if (filtered.length < 2) return null;
  return filtered;
}

/**
 * Δ% modello (best curve) da «oggi» al giorno CD — stessa curva della sparkline.
 * Ritorna null se CD passata, dati insufficienti o bundle assente.
 */
export function forwardBestCurveDeltaToCd(
  row: Record<string, unknown>,
  points?: ChartPoint[] | null,
): number | null {
  if (!points?.length) return null;
  const overlaid = resolveDisplayRecalibPoints(points, row);
  const dense = densePointsFromBundle(overlaid);
  if (!dense) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;
  const bestPts = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atNow = interpolateAtOffset(bestPts, nowOff, { extrapolate: true });
  const atCd = interpolateAtOffset(bestPts, 0, { extrapolate: true });
  if (atNow == null || atCd == null) return null;
  return Math.round((atCd - atNow) * 100) / 100;
}

/**
 * Primo incrocio curva best con targetPct (vs oggi) — orizzonte più corto del CD.
 * Ritorna null se il target non è raggiunto prima del CD sulla curva bundle.
 */
export function forwardDaysAndReturnToTarget(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
  targetPct: number,
): { days: number; returnPct: number } | null {
  if (!points?.length || targetPct <= 0) return null;
  const overlaid = resolveDisplayRecalibPoints(points, row);
  const dense = densePointsFromBundle(overlaid);
  if (!dense) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;

  const bestPts = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atNow = interpolateAtOffset(bestPts, nowOff, { extrapolate: true });
  if (atNow == null) return null;

  const goalY = atNow + targetPct;
  const forward = dense
    .filter((p) => p.offset > nowOff && p.offset <= 0)
    .sort((a, b) => a.offset - b.offset);
  if (!forward.length) return null;

  let prevOff = nowOff;
  let prevY = atNow;
  for (const p of forward) {
    if (p.best >= goalY) {
      const span = p.best - prevY;
      const t = span === 0 ? 1 : (goalY - prevY) / span;
      const hitOff = prevOff + t * (p.offset - prevOff);
      const days = Math.max(1, Math.round(hitOff - nowOff));
      const atHit = interpolateAtOffset(bestPts, hitOff);
      const returnPct =
        atHit != null
          ? Math.round((atHit - atNow) * 100) / 100
          : Math.round(targetPct * 10) / 10;
      return { days, returnPct };
    }
    prevOff = p.offset;
    prevY = p.best;
  }
  return null;
}

/**
 * Fine del tratto in salita sulla curva bundle (oggi → CD): picco locale al primo
 * plateau o al primo segmento flat/negativo dopo una salita significativa.
 * Allineato alla strategia «entra in slope+, esci quando flat o in discesa».
 */
export function forwardRiseSegmentPeak(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
  flatThrPpPerDay = 0.05,
): { days: number; returnPct: number } | null {
  if (!points?.length) return null;
  const overlaid = resolveDisplayRecalibPoints(points, row);
  const dense = densePointsFromBundle(overlaid);
  if (!dense) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;

  const bestPts = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atNow = interpolateAtOffset(bestPts, nowOff, { extrapolate: true });
  if (atNow == null) return null;

  const forward = dense
    .filter((p) => p.offset > nowOff && p.offset <= 0)
    .sort((a, b) => a.offset - b.offset);
  if (!forward.length) return null;

  const minRisePp = Math.max(flatThrPpPerDay * 3, 0.12);
  const plateauEps = Math.max(flatThrPpPerDay * 2, 0.08);

  let peakOff = nowOff;
  let peakY = atNow;
  let prevOff = nowOff;
  let prevY = atNow;
  let consecutiveFlat = 0;

  for (const p of forward) {
    const dOff = p.offset - prevOff;
    if (dOff <= 0) continue;
    const segSlope = (p.best - prevY) / dOff;

    if (p.best > peakY + 0.02) {
      peakY = p.best;
      peakOff = p.offset;
      consecutiveFlat = 0;
    } else if (segSlope <= flatThrPpPerDay) {
      consecutiveFlat += 1;
      if (
        consecutiveFlat >= 1 &&
        peakY - atNow >= minRisePp &&
        Math.abs(p.best - peakY) <= plateauEps
      ) {
        break;
      }
    } else if (segSlope < -flatThrPpPerDay && peakY - atNow >= minRisePp) {
      break;
    } else {
      consecutiveFlat = 0;
    }

    prevOff = p.offset;
    prevY = p.best;
  }

  const returnPct = Math.round((peakY - atNow) * 100) / 100;
  const days = Math.max(0, Math.round(peakOff - nowOff));
  if (returnPct <= 0.05) return null;
  return { days: Math.max(1, days), returnPct };
}

export type ForwardCurveRelativePath = {
  relPoints: { offset: number; relPp: number }[];
  trailingSlopePpPerDay: number | null;
  netPeakPp: number;
};

/** Punti curva best % vs oggi (0 = T0) — base per colori riga Simulation / Decision Lab. */
export function buildForwardCurveRelativePath(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
): ForwardCurveRelativePath | null {
  if (!points?.length) return null;
  const overlaid = resolveDisplayRecalibPoints(points, row);
  const dense = densePointsFromBundle(overlaid);
  if (!dense) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;

  const bestPts = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atNow = interpolateAtOffset(bestPts, nowOff, { extrapolate: true });
  if (atNow == null) return null;

  const forward = dense
    .filter((p) => p.offset > nowOff && p.offset <= 0)
    .sort((a, b) => a.offset - b.offset);
  if (!forward.length) return null;

  const relPoints: ForwardCurveRelativePath["relPoints"] = [
    { offset: nowOff, relPp: 0 },
    ...forward.map((p) => ({
      offset: p.offset,
      relPp: Math.round((p.best - atNow) * 100) / 100,
    })),
  ];

  let trailingSlopePpPerDay: number | null = null;
  if (forward.length >= 2) {
    const a = forward[forward.length - 2];
    const b = forward[forward.length - 1];
    const dOff = b.offset - a.offset;
    if (dOff > 0) {
      trailingSlopePpPerDay = Math.round(((b.best - a.best) / dOff) * 100) / 100;
    }
  } else if (forward.length === 1) {
    const dOff = forward[0].offset - nowOff;
    if (dOff > 0) {
      trailingSlopePpPerDay =
        Math.round(((forward[0].best - atNow) / dOff) * 100) / 100;
    }
  }

  const netPeakPp = relPoints.reduce((m, p) => Math.max(m, p.relPp), 0);
  return { relPoints, trailingSlopePpPerDay, netPeakPp };
}

/**
 * Δ% modello (best curve) dal giorno di ingresso al CD — piano completo «Plan at entry».
 * `holdDaysElapsed` = giorni da investedAt a oggi; offset ingresso ≈ nowOff − elapsed.
 */
export function curveDeltaFromEntryToCd(
  row: Record<string, unknown>,
  points?: ChartPoint[] | null,
  holdDaysElapsed?: number | null,
): number | null {
  if (!points?.length) return null;
  const overlaid = resolveDisplayRecalibPoints(points, row);
  const dense = densePointsFromBundle(overlaid);
  if (!dense) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;
  const elapsed =
    holdDaysElapsed != null && Number.isFinite(holdDaysElapsed) && holdDaysElapsed > 0
      ? holdDaysElapsed
      : 0;
  const entryOff = nowOff - elapsed;
  const bestPts = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atEntry = interpolateAtOffset(bestPts, entryOff);
  const atCd = interpolateAtOffset(bestPts, 0);
  if (atEntry == null || atCd == null) return null;
  return Math.round((atCd - atEntry) * 100) / 100;
}

/** Max divergence |best - modello| in pp between dense points.
 *  Used to signal when live recalibration is deviating from the pure model. */
function maxDivergencePp(dense: DenseSparklinePoint[]): number {
  let max = 0;
  for (const p of dense) {
    if (p.modello == null || p.best == null) continue;
    const d = Math.abs(p.best - p.modello);
    if (d > max) max = d;
  }
  return max;
}

export function SimulationSparkline({
  row,
  points,
  width = 80,
  height = 26,
  className,
  showCdZones,
  showZoneLabels,
  targetStop,
  portfolio,
}: {
  row: Record<string, unknown>;
  /** Dense recalibrated curve from the chart bundle (preferred if present). */
  points?: ChartPoint[] | null;
  width?: number;
  height?: number;
  className?: string;
  /** Bande watching / hot dietro la curva (default: sì se area ≥ ~80×28). */
  showCdZones?: boolean;
  /** Etichette «Watching» / «Hot» sulle bande (default: sì con showCdZones e h ≥ 40). */
  showZoneLabels?: boolean;
  /** Cerchi target (verde) e stop (rosso) vs «oggi» sulla curva. */
  targetStop?: SparklineTargetStop | null;
  /** Portafoglio aperto — tratto realizzato = P&L, avanti = solo previsione (tratteggio). */
  portfolio?: SparklinePortfolioContext | null;
}) {
  const cdZones =
    showCdZones ?? (width >= 80 && height >= 28);
  const zoneLabels =
    showZoneLabels ?? (cdZones && height >= 40);
  const overlaid =
    points?.length && row ? resolveDisplayRecalibPoints(points, row) : points;
  const dense = densePointsFromBundle(overlaid);
  const nowOff = completionDateToNowOffset(row["Completion Date"]);

  const padX = 2;
  const padY = 3;

  if (dense) {
    return (
      <DenseModelSparkline
        dense={dense}
        nowOff={nowOff}
        width={width}
        height={height}
        padX={padX}
        padY={padY}
        className={className}
        showCdZones={cdZones}
        showZoneLabels={zoneLabels}
        targetStop={targetStop}
        row={row}
        portfolio={portfolio}
        overlaidPoints={overlaid ?? undefined}
      />
    );
  }

  const fallback = extractSparklinePoints(row);
  if (fallback.length < 2) {
    return <span className="text-ink-muted/30 text-[10px]">—</span>;
  }
  return (
    <FallbackSparkline
      pts={fallback}
      nowOff={nowOff}
      width={width}
      height={height}
      padX={padX}
      padY={padY}
      className={className}
      showCdZones={cdZones}
      showZoneLabels={zoneLabels}
      targetStop={targetStop}
    />
  );
}

function DenseModelSparkline({
  dense,
  nowOff,
  width,
  height,
  padX,
  padY,
  className,
  showCdZones,
  showZoneLabels,
  targetStop,
  row,
  portfolio,
  overlaidPoints,
}: {
  dense: DenseSparklinePoint[];
  nowOff: number | null;
  width: number;
  height: number;
  padX: number;
  padY: number;
  className?: string;
  showCdZones?: boolean;
  showZoneLabels?: boolean;
  targetStop?: SparklineTargetStop | null;
  row?: Record<string, unknown>;
  portfolio?: SparklinePortfolioContext | null;
  overlaidPoints?: ChartPoint[];
}) {
  // Main line = best prediction (recalibrated curve, fallback to model)
  const bestPts = dense.map((p) => ({ offset: p.offset, val: p.best }));
  const realePts = dense
    .filter((p): p is DenseSparklinePoint & { reale: number } => p.reale != null)
    .map((p) => ({ offset: p.offset, val: p.reale }));

  const allVals = [...bestPts.map((p) => p.val), ...realePts.map((p) => p.val), 0];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 0.01;

  const minOffData = Math.min(...bestPts.map((p) => p.offset));
  const maxOffData = Math.max(...bestPts.map((p) => p.offset));
  const minOff =
    nowOff != null && Number.isFinite(nowOff)
      ? Math.min(minOffData, nowOff)
      : minOffData;
  const maxOff =
    nowOff != null && Number.isFinite(nowOff)
      ? Math.max(maxOffData, nowOff)
      : maxOffData;

  const realePath =
    realePts.length >= 2
      ? realePts
          .map((p) => {
            const x = xForOffset(p.offset, minOff, maxOff, width, padX);
            const y = yForVal(p.val, minVal, range, height, padY);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : null;

  const zeroY = yForVal(0, minVal, range, height, padY);
  const zeroInRange = zeroY > padY && zeroY < height - padY;

  const nowModel =
    nowOff != null && Number.isFinite(nowOff)
      ? interpolateAtOffset(
          bestPts.map((p) => ({ offset: p.offset, y: p.val })),
          nowOff,
        )
      : null;

  const modelPath = bestPts
    .map((p) => {
      const x = xForOffset(p.offset, minOff, maxOff, width, padX);
      const y = yForVal(p.val, minVal, range, height, padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const forwardModelPath =
    nowOff != null && Number.isFinite(nowOff)
      ? bestPts
          .filter((p) => p.offset >= nowOff - 0.25)
          .map((p) => {
            const x = xForOffset(p.offset, minOff, maxOff, width, padX);
            const y = yForVal(p.val, minVal, range, height, padY);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : modelPath;

  const hasPortfolioPnl =
    portfolio?.pnlPct != null && Number.isFinite(portfolio.pnlPct);
  const splitAtNow = hasPortfolioPnl && nowOff != null && Number.isFinite(nowOff);

  let realizedPath: string | null = realePath;
  if (splitAtNow && row) {
    const entryPct = entryPctVsM60(row, portfolio?.buyPriceUsd);
    const liveToday =
      overlaidPoints?.length && nowOff != null
        ? livePctVsM60AtToday(overlaidPoints, row, nowOff)
        : nowModel;
    if (entryPct != null && liveToday != null && nowOff != null) {
      const entryOff = Math.min(minOffData, nowOff - 1);
      realizedPath = [
        `${xForOffset(entryOff, minOff, maxOff, width, padX).toFixed(1)},${yForVal(entryPct, minVal, range, height, padY).toFixed(1)}`,
        `${xForOffset(nowOff, minOff, maxOff, width, padX).toFixed(1)},${yForVal(liveToday, minVal, range, height, padY).toFixed(1)}`,
      ].join(" ");
    } else if (!realizedPath && liveToday != null && nowOff != null) {
      const pastPts = bestPts.filter((p) => p.offset <= nowOff);
      if (pastPts.length >= 2) {
        realizedPath = pastPts
          .map((p) => {
            const x = xForOffset(p.offset, minOff, maxOff, width, padX);
            const y = yForVal(p.val, minVal, range, height, padY);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
      }
    }
  }

  const lastModel = bestPts[bestPts.length - 1]?.val ?? null;
  // Color based on T+5 vs today (not T+7): aligns with the PRED+5 arrow in the table
  const T5_FWD = 5;
  const t5Model =
    nowOff != null && Number.isFinite(nowOff) && nowOff < T5_FWD
      ? interpolateAtOffset(bestPts.map((p) => ({ offset: p.offset, y: p.val })), T5_FWD)
      : null;
  const fwdDelta =
    t5Model != null && nowModel != null
      ? t5Model - nowModel
      : nowModel != null && lastModel != null && nowOff != null && nowOff < maxOffData
        ? lastModel - nowModel
        : null;

  const marketSlopes = row ? extractCurveInputs(row) : { slope5d: null, slope20d: null };
  const marketDeclining = isMarketSlopeDeclining(
    marketSlopes.slope5d,
    marketSlopes.slope20d,
  );
  const risingTowardTarget = sparklineRisingTowardTarget(row, fwdDelta);
  const holdGreen = "rgb(var(--signal-up))";
  const downColor = "rgb(var(--signal-down))";
  const color = risingTowardTarget
    ? holdGreen
    : marketDeclining
      ? downColor
      : trendColor(fwdDelta);
  const forecastColor = marketDeclining ? downColor : color;
  const forecastOpacity = marketDeclining ? 0.45 : splitAtNow ? 0.72 : 0.95;
  const showRealePrimary = marketDeclining && realePts.length >= 2 && !splitAtNow;
  const realePrimaryColor = slopeTrendColor(marketSlopes.slope5d, marketSlopes.slope20d);

  const realizedColor = hasPortfolioPnl
    ? risingTowardTarget
      ? holdGreen
      : marketDeclining
        ? downColor
        : realizedTrendColor(portfolio!.pnlPct)
    : null;

  let nowX: number | null = null;
  let nowY: number | null = null;
  if (nowOff != null && Number.isFinite(nowOff) && nowModel != null) {
    nowX = xForOffset(nowOff, minOff, maxOff, width, padX);
    nowY = yForVal(nowModel, minVal, range, height, padY);
  }

  const allRecalib = dense.every(
    (p) => p.bestSource === "foglio" || p.bestSource === "ricalibrata"
  );
  const sourceLabel = allRecalib
    ? "Prediction + Recalibration"
    : dense.every((p) => p.bestSource === "modello")
      ? "model (fallback)"
      : "mixed (recalibrated + model)";

  // Max best vs pure model divergence: if > DIVERGE_HINT_PP the recalibration
  // is appreciably changing the pred → we show a small marker.
  const divergePp = maxDivergencePp(dense);
  const isDiverging = allRecalib && divergePp > DIVERGE_HINT_PP;

  const labelTxt = (() => {
    const parts: string[] = [`Best curve (${sourceLabel})`];
    if (hasPortfolioPnl && portfolio?.pnlPct != null) {
      const sign = portfolio.pnlPct >= 0 ? "+" : "";
      parts.unshift(`P&L ${sign}${portfolio.pnlPct.toFixed(2)}% since entry (solid line)`);
      parts.push("dashed = model forecast from today");
    }
    if (nowOff != null) parts.push(`today at ${nowOff > 0 ? "+" : ""}${nowOff}d from CD`);
    if (fwdDelta != null) {
      const sign = fwdDelta >= 0 ? "+" : "";
      parts.push(
        marketDeclining
          ? `model forecast T+5: ${sign}${fwdDelta.toFixed(2)}pp (market slope ↓)`
          : `Δ from today to T+5: ${sign}${fwdDelta.toFixed(2)}pp`,
      );
    }
    if (isDiverging) {
      parts.push(`active recalibration (Δ max ${divergePp.toFixed(1)}pp vs pure model)`);
    }
    if (realePts.length > 0 && !splitAtNow) {
      parts.push(`${realePts.length} historical real closes`);
    }
    return parts.join(" · ");
  })();

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className ? `overflow-visible ${className}` : "shrink-0 overflow-visible"}
      aria-label={labelTxt}
      role="img"
    >
      <title>{labelTxt}</title>
      {showCdZones ? (
        <SparklineCdZoneBands
          minOff={minOff}
          maxOff={maxOff}
          width={width}
          height={height}
          padX={padX}
          showZoneLabels={showZoneLabels}
        />
      ) : null}
      {zeroInRange ? (
        <line
          x1={padX}
          x2={width - padX}
          y1={zeroY}
          y2={zeroY}
          stroke="rgb(var(--ink-muted))"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.35"
        />
      ) : null}
      {maxOff >= -0.5 && minOff <= 0.5 ? (
        <line
          x1={xForOffset(0, minOff, maxOff, width, padX)}
          y1={0}
          x2={xForOffset(0, minOff, maxOff, width, padX)}
          y2={height}
          stroke="rgb(var(--ink-muted))"
          strokeWidth="0.75"
          opacity="0.28"
        />
      ) : null}
      {splitAtNow && realizedPath ? (
        <polyline
          points={realizedPath}
          fill="none"
          stroke={realizedColor ?? "rgb(var(--signal-down))"}
          strokeWidth={2.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.95"
        />
      ) : realePath ? (
        <polyline
          points={realePath}
          fill="none"
          stroke={showRealePrimary ? realePrimaryColor : "rgb(var(--ink-muted))"}
          strokeWidth={showRealePrimary ? 2.25 : 1}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={showRealePrimary ? 0.95 : 0.45}
        />
      ) : null}
      <polyline
        points={splitAtNow || showRealePrimary ? forwardModelPath : modelPath}
        fill="none"
        stroke={splitAtNow || showRealePrimary ? forecastColor : color}
        strokeWidth={showCdZones ? 2 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={splitAtNow || showRealePrimary || marketDeclining ? "3 2" : undefined}
        opacity={splitAtNow || showRealePrimary ? forecastOpacity : 0.95}
      />
      {nowX != null && nowY != null ? (
        <SparklineNowMarker x={nowX} y={nowY} height={height} />
      ) : null}
      {targetStop && nowX != null && nowY != null && nowModel != null ? (
        <>
          <SparklineLevelMarker
            x={xForOffset(0, minOff, maxOff, width, padX)}
            y={yForVal(
              interpolateAtOffset(
                bestPts.map((p) => ({ offset: p.offset, y: p.val })),
                0,
              ) ?? nowModel + targetStop.targetHighPp,
              minVal,
              range,
              height,
              padY,
            )}
            kind="target"
          />
          <SparklineLevelMarker
            x={nowX}
            y={yForVal(nowModel + targetStop.stopPp, minVal, range, height, padY)}
            kind="stop"
          />
        </>
      ) : null}
      {isDiverging ? (
        // Mini-badge "R" in the top right: live recalibration is deviating
        // from the pure model pred. On the current dataset this is rare, will
        // become relevant when historical closes accumulate.
        <>
          <circle
            cx={width - 3}
            cy={3}
            r={3}
            fill="rgb(var(--accent))"
            opacity="0.85"
          />
          <text
            x={width - 3}
            y={4.5}
            textAnchor="middle"
            fontSize="4.5"
            fontWeight="bold"
            fill="rgb(var(--surface))"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            R
          </text>
        </>
      ) : null}
    </svg>
  );
}

function FallbackSparkline({
  pts,
  nowOff,
  width,
  height,
  padX,
  padY,
  className,
  showCdZones,
  showZoneLabels,
  targetStop,
}: {
  pts: FallbackPoint[];
  nowOff: number | null;
  width: number;
  height: number;
  padX: number;
  padY: number;
  className?: string;
  showCdZones?: boolean;
  showZoneLabels?: boolean;
  targetStop?: SparklineTargetStop | null;
}) {
  const vals = pts.map((p) => p.val);
  const allVals = [...vals, 0];
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 0.01;

  const minOffData = Math.min(...pts.map((p) => p.offset));
  const maxOffData = Math.max(...pts.map((p) => p.offset));
  const minOff =
    nowOff != null && Number.isFinite(nowOff)
      ? Math.min(minOffData, nowOff)
      : minOffData;
  const maxOff =
    nowOff != null && Number.isFinite(nowOff)
      ? Math.max(maxOffData, nowOff)
      : maxOffData;

  const svgPts = pts
    .map((p) => {
      const x = xForOffset(p.offset, minOff, maxOff, width, padX);
      const y = yForVal(p.val, minVal, range, height, padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const zeroY = yForVal(0, minVal, range, height, padY);
  const zeroInRange = zeroY > padY && zeroY < height - padY;

  const nowVal =
    nowOff != null && Number.isFinite(nowOff)
      ? interpolateAtOffset(pts.map((p) => ({ offset: p.offset, y: p.val })), nowOff)
      : null;
  const lastVal = vals[vals.length - 1];
  // Color based on T+5 vs today: aligns with the PRED+5 arrow in the table
  const T5_FWD = 5;
  const t5Val =
    nowOff != null && Number.isFinite(nowOff) && nowOff < T5_FWD
      ? interpolateAtOffset(pts.map((p) => ({ offset: p.offset, y: p.val })), T5_FWD)
      : null;
  const fwdDelta =
    t5Val != null && nowVal != null
      ? t5Val - nowVal
      : nowVal != null && nowOff != null && nowOff < maxOffData
        ? lastVal - nowVal
        : null;
  const color = trendColor(fwdDelta);

  let nowX: number | null = null;
  let nowY: number | null = null;
  if (nowOff != null && Number.isFinite(nowOff) && nowVal != null) {
    nowX = xForOffset(nowOff, minOff, maxOff, width, padX);
    nowY = yForVal(nowVal, minVal, range, height, padY);
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className ? `overflow-visible ${className}` : "shrink-0 overflow-visible"}
      aria-label={
        nowOff != null
          ? `Pred curve · today at ${nowOff > 0 ? "+" : ""}${nowOff} d from CD (sheet fallback)`
          : "Predictive curve (sheet fallback)"
      }
      role="img"
    >
      <title>Model curve (fallback to sheet columns; chart bundle not loaded)</title>
      {showCdZones ? (
        <SparklineCdZoneBands
          minOff={minOff}
          maxOff={maxOff}
          width={width}
          height={height}
          padX={padX}
          showZoneLabels={showZoneLabels}
        />
      ) : null}
      {zeroInRange ? (
        <line
          x1={padX}
          x2={width - padX}
          y1={zeroY}
          y2={zeroY}
          stroke="rgb(var(--ink-muted))"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.35"
        />
      ) : null}
      {maxOff >= -0.5 && minOff <= 0.5 ? (
        <line
          x1={xForOffset(0, minOff, maxOff, width, padX)}
          y1={0}
          x2={xForOffset(0, minOff, maxOff, width, padX)}
          y2={height}
          stroke="rgb(var(--ink-muted))"
          strokeWidth="0.75"
          opacity="0.28"
        />
      ) : null}
      <polyline
        points={svgPts}
        fill="none"
        stroke={color}
        strokeWidth={showCdZones ? 2 : 1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
      {nowX != null && nowY != null ? (
        <SparklineNowMarker x={nowX} y={nowY} height={height} />
      ) : null}
      {targetStop && nowX != null && nowY != null && nowVal != null ? (
        <>
          <SparklineLevelMarker
            x={xForOffset(0, minOff, maxOff, width, padX)}
            y={yForVal(
              interpolateAtOffset(pts.map((p) => ({ offset: p.offset, y: p.val })), 0) ??
                nowVal + targetStop.targetHighPp,
              minVal,
              range,
              height,
              padY,
            )}
            kind="target"
          />
          <SparklineLevelMarker
            x={nowX}
            y={yForVal(nowVal + targetStop.stopPp, minVal, range, height, padY)}
            kind="stop"
          />
        </>
      ) : null}
    </svg>
  );
}
