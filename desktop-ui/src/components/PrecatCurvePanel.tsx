/**
 * PrecatCurvePanel — pre-catalyst curve visualization with CI bands.
 *
 * Shows:
 *   • CI 90% band (light area)
 *   • CI 68% band (darker area)
 *   • Predicted median line
 *   • Vertical "Today" marker (dashed red line)
 *   • CD marker (today + days_to_cd)
 *
 * Data is computed in-browser from slope_20d / slope_5d / run_up_30d.
 */

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtAxisPctTick } from "../sheet/chartAxisFormat";
import {
  NOW_MARKER_FILL,
  NOW_MARKER_STROKE,
} from "../sheet/nowTimelineMarker";
import type { ChartPoint as SimChartPoint } from "../types";
import { useT } from "../shared/i18n";
import {
  computePrecatCurve,
  extractCurveInputs,
  predGridPctVsToday,
  predPctVsTodayByOffset,
  regimeLabel,
  slopeSourceLabel,
  type PrecatWaypoint,
  type SlopeSource,
} from "../sheet/precatCurve";
import { recalibSeriesFromChartPoints } from "../sheet/slopeRecalibCurve";
import { resolveRecalibratedChartPoints } from "../sheet/predictionCurveDailyRecalib";
import {
  computeSlopeStability,
  slopeStabilityLabel,
} from "../sheet/slopeStability";

// ─── Visual constants ─────────────────────────────────────────────────────────

const COLOR_BULL   = "rgb(34, 197, 94)";   // var(--signal-up)
const COLOR_BEAR   = "rgb(239, 68, 68)";   // var(--signal-down)
const COLOR_FLAT   = "rgb(var(--accent))";

function curveColor(effSlope: number): string {
  if (effSlope > 0.1) return COLOR_BULL;
  if (effSlope < -0.1) return COLOR_BEAR;
  return COLOR_FLAT;
}

const uncertaintyColors: Record<string, string> = {
  BASSA:      "#22c55e",
  MEDIA:      "#f59e0b",
  ALTA:       "#ef4444",
  "MOLTO ALTA": "#a855f7",
};

// ─── Slope source badge ──────────────────────────────────────────────────────
// The slope can be measured or derived; we signal this visually so the user
// knows when to trust the median line.

function slopeBadgeShort(src: SlopeSource): string {
  switch (src) {
    case "measured_20d":   return "MIS";
    case "blended":        return "BLEND";
    case "proxy_5d":       return "PROXY";
    case "inferred_runup": return "INFER";
    case "none":           return "N/D";
  }
}

function slopeBadgeColor(src: SlopeSource): string {
  switch (src) {
    case "measured_20d":
    case "blended":
      return "text-ink";
    case "proxy_5d":       return "text-[rgb(var(--warn))]";
    case "inferred_runup": return "text-[rgb(var(--warn))]";
    case "none":           return "text-ink-muted/60";
  }
}

function slopeBadgeBg(src: SlopeSource): string {
  switch (src) {
    case "measured_20d":
    case "blended":
      return "bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))]";
    case "proxy_5d":       return "bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))]";
    case "inferred_runup": return "bg-[rgb(var(--warn))]/18 text-[rgb(var(--warn))]";
    case "none":           return "bg-[rgb(var(--border))]/20 text-ink-muted/70";
  }
}

// ─── Local types ──────────────────────────────────────────────────────────────

/** Recharts chart point for the CI band (stacked area format). */
type PrecatChartPoint = {
  /** X: days relative to CD (negative) */
  x: number;
  /** Base (transparent) for CI90 stacking */
  ci90Rail: number;
  /** CI90 band height */
  ci90Band: number;
  /** Base (transparent) for CI68 stacking */
  ci68Rail: number;
  /** CI68 band height */
  ci68Band: number;
  /** Linear median (constant eff. slope) */
  median: number | null;
  /** Recalibrated sheet path (% vs today) */
  recalib: number | null;
  /** σ_H in pp (for tooltip) */
  sigmaPp: number;
  /** X axis label */
  label: string;
};

function recalibMapFromChartPoints(
  chartPoints: SimChartPoint[] | undefined,
  todayOffset: number,
): Map<number, number> {
  const series = recalibSeriesFromChartPoints(chartPoints);
  const pts = series
    .filter((p) => p.pred != null)
    .map((p) => ({ d: p.offset, pct: p.pred as number }));
  if (pts.length < 2) return new Map();
  return predPctVsTodayByOffset(pts, todayOffset);
}

function buildChartData(
  waypoints: PrecatWaypoint[],
  recalibByX: Map<number, number>,
  daysToCd: number,
): PrecatChartPoint[] {
  const wpByX = new Map(waypoints.map((w) => [w.daysToCd, w]));
  const xSet = new Set<number>();
  for (const w of waypoints) xSet.add(w.daysToCd);
  for (const x of recalibByX.keys()) xSet.add(x);
  xSet.add(-daysToCd);

  return [...xSet]
    .sort((a, b) => a - b)
    .map((x) => {
      const wp = wpByX.get(x);
      const recalib = recalibByX.get(x) ?? null;
      const label = x === 0 ? "T0" : `T${x}`;
      return {
        x,
        label,
        ci90Rail: wp?.ci90Lo ?? 0,
        ci90Band: wp ? wp.ci90Hi - wp.ci90Lo : 0,
        ci68Rail: wp?.ci68Lo ?? 0,
        ci68Band: wp ? wp.ci68Hi - wp.ci68Lo : 0,
        median: wp?.predPct ?? null,
        recalib,
        sigmaPp: wp?.sigmaPp ?? 0,
      };
    });
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function PrecatTooltip({
  active, payload,
}: {
  active?: boolean;
  payload?: { payload?: PrecatChartPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const hi90 = d.ci90Rail + d.ci90Band;
  const lo90 = d.ci90Rail;
  const hi68 = d.ci68Rail + d.ci68Band;
  const lo68 = d.ci68Rail;
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

  return (
    <div className="bg-surface/95 border border-[rgb(var(--border))]/60 rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-semibold text-sm">{d.label}</p>
      {d.recalib != null && (
        <p>
          Ricalibrata: <span className="font-semibold tabular-nums">{fmt(d.recalib)}</span>
        </p>
      )}
      {d.median != null && (
        <p>
          Mediana lineare: <span className="font-semibold tabular-nums">{fmt(d.median)}</span>
        </p>
      )}
      {d.sigmaPp > 0 && (
        <>
          <p className="text-ink-muted">
            CI 68%: <span className="tabular-nums">[{fmt(lo68)}, {fmt(hi68)}]</span>
          </p>
          <p className="text-ink-muted">
            CI 90%: <span className="tabular-nums">[{fmt(lo90)}, {fmt(hi90)}]</span>
          </p>
          <p className="text-ink-muted">σ_H: <span className="tabular-nums">{d.sigmaPp.toFixed(1)}pp</span></p>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PrecatCurvePanel({
  simRow,
  daysToCd,
  chartPoints,
}: {
  /** Raw row from the Simulation sheet (Record<string, unknown>) */
  simRow: Record<string, unknown>;
  /** Days remaining to CD (> 0) */
  daysToCd: number;
  /** Dense recalibrated path from simulation_charts_snapshot (preferred). */
  chartPoints?: SimChartPoint[];
}) {
  const t = useT();
  const { slope20d, slope5d, slope45d, runUp30d } = extractCurveInputs(simRow);

  const curve = computePrecatCurve(slope20d, slope5d, runUp30d, daysToCd);
  const todayOffset = -daysToCd;
  const recalibPts = chartPoints?.length
    ? resolveRecalibratedChartPoints(chartPoints, simRow)
    : chartPoints;
  const fromChart = recalibMapFromChartPoints(recalibPts, todayOffset);
  const recalibByX = fromChart.size >= 2 ? fromChart : predGridPctVsToday(simRow, todayOffset);
  const hasRecalib = recalibByX.size >= 2;
  // Stability metrics (entry/exit driver) — mirror of the Python logic
  // in prediction.curve_forecast. Shown in header below the regime.
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);

  if (curve.waypoints.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-ink-muted">
        No waypoint — CD in {daysToCd} days, too close to generate the curve.
      </div>
    );
  }

  const data = buildChartData(curve.waypoints, recalibByX, daysToCd);
  const color = curveColor(curve.effSlope);
  const RECALIB_COLOR = "rgb(99, 102, 241)";
  const uLabel = curve.uncertaintyLabel;
  const badgeColor = uncertaintyColors[uLabel] ?? "#94a3b8";

  // Y domain with padding
  const allVals = data.flatMap((d) => {
    const vals: number[] = [d.ci90Rail, d.ci90Rail + d.ci90Band];
    if (d.median != null) vals.push(d.median);
    if (d.recalib != null) vals.push(d.recalib);
    return vals;
  });
  const yMin =
    allVals.length > 0 ? Math.floor(Math.min(...allVals) / 5) * 5 - 5 : -10;
  const yMax =
    allVals.length > 0 ? Math.ceil(Math.max(...allVals) / 5) * 5 + 5 : 10;

  const fmtPctAxis = (v: number) => `${v > 0 ? "+" : ""}${fmtAxisPctTick(v)}%`;

  // Median direction for the descriptive subtitle.
  const last  = data[data.length - 1];
  const first = data[0];
  const trendFrom = (pt: PrecatChartPoint | undefined) =>
    pt?.recalib ?? pt?.median ?? null;
  const medianDelta =
    last && first && trendFrom(last) != null && trendFrom(first) != null
      ? (trendFrom(last) as number) - (trendFrom(first) as number)
      : last?.median != null && first?.median != null
        ? last.median - first.median
        : 0;
  const isFlat = Math.abs(medianDelta) < 0.5 && Math.abs(curve.effSlope) < 0.05;
  const direction: "up" | "down" | "flat" =
    isFlat ? "flat" : medianDelta > 0 ? "up" : "down";

  // Numeric example at T-3 (last waypoint, "decision threshold").
  const lastSigma = last?.sigmaPp ?? curve.sigmaBasePp;
  const lastTrend = trendFrom(last) ?? last?.median ?? 0;

  // CI 68% range at T-3, expressed as "−X%/+Y%" string.
  const ci68LoLast = last ? last.ci68Rail : 0;
  const ci68HiLast = last ? last.ci68Rail + last.ci68Band : 0;

  return (
    <div className="space-y-2">
      {/* Header — regime + uncertainty */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-ink-muted">Regime:</span>
        <span className="font-medium">{regimeLabel(curve.regime, curve.runUp30d)}</span>
        <span className="text-ink-muted">·</span>
        <span className="text-ink-muted">σ_base:</span>
        <span className="tabular-nums font-medium">{curve.sigmaBasePp.toFixed(1)}pp</span>
        <span className="text-ink-muted">·</span>
        <span
          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ background: `${badgeColor}22`, color: badgeColor }}
        >
          Uncertainty {uLabel}
        </span>
        <span className="text-ink-muted">·</span>
        <span
          className={`tabular-nums font-medium ${slopeBadgeColor(curve.slopeSource)}`}
          title={`Slope source: ${slopeSourceLabel(curve.slopeSource)}`}
        >
          slope {curve.effSlope > 0 ? "+" : ""}{curve.effSlope.toFixed(2)} pp/d
        </span>
        <span
          className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${slopeBadgeBg(curve.slopeSource)}`}
          title={`Slope source: ${slopeSourceLabel(curve.slopeSource)}`}
        >
          {slopeBadgeShort(curve.slopeSource)}
        </span>
        {/* Stability badge — entry/exit driver */}
        {stab.stabilityClass !== "flat" && (
          <>
            <span className="text-ink-muted">·</span>
            <span
              className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                stab.rotationFlag === 1
                  ? "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))]"
                  : stab.stabilityClass === "high_consistency_45d" || stab.stabilityClass === "high_consistency_20d"
                    ? "bg-[rgb(var(--signal-up))]/15 text-[rgb(var(--signal-up))]"
                    : stab.stabilityClass === "med_consistency"
                      ? "bg-[rgb(var(--accent))]/12 text-[rgb(var(--accent))]"
                      : "bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))]"
              }`}
              title={`${slopeStabilityLabel(stab.stabilityClass)} · expected persistence window ≈ ${stab.persistenceWindowDays}d${stab.consistency != null ? ` · consistency ${Math.round(stab.consistency * 100)}%` : ""}`}
            >
              {stab.rotationFlag === 1
                ? "↻ ROTATION"
                : `STABLE ≈${stab.persistenceWindowDays}d`}
            </span>
          </>
        )}
      </div>

      {/* "How to read" — descriptive subtitle always present */}
      <div className="rounded-lg border border-[rgb(var(--border))]/30 bg-surface/40 px-3 py-2 text-[11px] leading-snug text-ink-muted/90 space-y-1">
        <p>
          <span className="font-semibold text-ink">What it shows:</span>{" "}
          expected % price change in the <strong>{data.length} observation days before the CD</strong> (T−20 = 20 days before the catalyst, T−3 = 3 days before).
          {hasRecalib ? (
            <span>{t("signals.precat.recalibNote")}</span>
          ) : (
            <span>
              The line is the <strong>median</strong> (central scenario); the bands are the <strong>confidence interval</strong> (68% and 90%) computed from σ_H.
            </span>
          )}
        </p>
        <p>
          <span className="font-semibold text-ink">Trend:</span>{" "}
          {direction === "up" && (
            <span>
              expected <strong className="text-[rgb(var(--signal-up))]">average rise of +{medianDelta.toFixed(1)}%</strong> between T{first?.x} and T{last?.x}.
            </span>
          )}
          {direction === "down" && (
            <span>
              expected <strong className="text-[rgb(var(--signal-down))]">average decline of {medianDelta.toFixed(1)}%</strong> between T{first?.x} and T{last?.x}.
            </span>
          )}
          {direction === "flat" && (
            <span>
              <strong className="text-[rgb(var(--accent))]">flat</strong> ({medianDelta >= 0 ? "+" : ""}{medianDelta.toFixed(1)}% median between T{first?.x} and T{last?.x}).
              {curve.slopeSource === "none" && (
                <span> No slope data available → the model only shows symmetric uncertainty.</span>
              )}
            </span>
          )}
          {(curve.slopeSource === "proxy_5d" || curve.slopeSource === "inferred_runup") && (
            <span className="text-[rgb(var(--warn))]">
              {" "}⚠ slope {curve.slopeSource === "proxy_5d" ? "estimated from 5d slope" : "inferred from 30d run-up"} (20d slope missing) — reduced reliability.
            </span>
          )}
        </p>
        {last && (
          <p>
            <span className="font-semibold text-ink">Example at T{last.x} (near CD):</span>{" "}
            {hasRecalib ? "ricalibrata" : "mediana"}{" "}
            <strong className="tabular-nums">{lastTrend > 0 ? "+" : ""}{lastTrend.toFixed(1)}%</strong>{" "}
            · 68% range <strong className="tabular-nums">[{ci68LoLast > 0 ? "+" : ""}{ci68LoLast.toFixed(1)}%, {ci68HiLast > 0 ? "+" : ""}{ci68HiLast.toFixed(1)}%]</strong>{" "}
            (uncertainty ±{lastSigma.toFixed(1)}pp at 1σ).
          </p>
        )}
      </div>

      {/* Chart */}
      <div className="invest-trend-chart-panel rounded-lg border p-2 h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 12, left: 12, bottom: 28 }}
          >
            {/* Light grid to make reading easier */}
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(148, 163, 184, 0.18)"
              vertical={true}
              horizontal={true}
            />

            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
              axisLine={{ stroke: "rgba(148,163,184,0.3)" }}
              tickLine={false}
              height={32}
            >
              <Label
                value="Days to CD (clinical catalyst)"
                offset={-6}
                position="insideBottom"
                style={{ fill: "rgb(var(--ink-muted))", fontSize: 10, fontWeight: 500 }}
              />
            </XAxis>
            <YAxis
              yAxisId="left"
              domain={[yMin, yMax]}
              tickFormatter={fmtPctAxis}
              tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
              axisLine={{ stroke: "rgba(148,163,184,0.3)" }}
              tickLine={false}
              width={56}
            >
              <Label
                value="Expected % change vs now"
                angle={-90}
                position="insideLeft"
                offset={-2}
                style={{
                  fill: "rgb(var(--ink-muted))",
                  fontSize: 10,
                  fontWeight: 500,
                  textAnchor: "middle",
                }}
              />
            </YAxis>
            {/* Y axis duplicated on the right: same domain as the left,
                makes it easier to read the slope/variation of the curve
                when looking at the right side of the chart (near CD). */}
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[yMin, yMax]}
              tickFormatter={fmtPctAxis}
              tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
              axisLine={{ stroke: "rgba(148,163,184,0.3)" }}
              tickLine={false}
              width={46}
            />

            <Tooltip content={<PrecatTooltip />} />

            {/* Zero line (current price = reference) */}
            <ReferenceLine
              yAxisId="left"
              y={0}
              stroke="rgba(148,163,184,0.55)"
              strokeDasharray="3 3"
            >
              <Label
                value="current price"
                position="insideBottomLeft"
                style={{ fill: "rgb(var(--ink-muted))", fontSize: 9 }}
              />
            </ReferenceLine>

            {/* Today on the pre-CD calendar (T−N where N = days to CD) */}
            <ReferenceLine
              yAxisId="left"
              x={`T-${daysToCd}`}
              stroke={NOW_MARKER_STROKE}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              ifOverflow="extendDomain"
            >
              <Label
                value="📍 today"
                position="insideTopLeft"
                style={{ fill: NOW_MARKER_FILL, fontSize: 9, fontWeight: 600 }}
              />
            </ReferenceLine>

            {/* Catalyst day (CD = T0) */}
            <ReferenceLine
              yAxisId="left"
              x="T0"
              stroke="rgb(var(--signal-down))"
              strokeWidth={1}
              strokeDasharray="3 3"
              ifOverflow="extendDomain"
            >
              <Label
                value="CD"
                position="insideTopRight"
                style={{ fill: "rgb(var(--signal-down))", fontSize: 9, fontWeight: 600 }}
              />
            </ReferenceLine>

            {/* T-3 marker (last waypoint = decision threshold) */}
            {last && last.x !== first?.x && (
              <ReferenceLine
                yAxisId="left"
                x={last.label}
                stroke="rgba(var(--accent), 0.4)"
                strokeDasharray="2 4"
              >
                <Label
                  value="decision threshold"
                  position="insideTopLeft"
                  style={{ fill: "rgb(var(--accent))", fontSize: 9, fontWeight: 600 }}
                />
              </ReferenceLine>
            )}

            {/* CI 90% band (stacked: transparent rail + visible fill) */}
            <Area
              yAxisId="left"
              dataKey="ci90Rail"
              stackId="ci90"
              fill="transparent"
              stroke="none"
              legendType="none"
              isAnimationActive={false}
            />
            <Area
              yAxisId="left"
              dataKey="ci90Band"
              stackId="ci90"
              fill={color}
              fillOpacity={0.1}
              stroke={color}
              strokeOpacity={0.2}
              strokeWidth={1}
              strokeDasharray="4 3"
              name="CI 90%"
              isAnimationActive={false}
            />

            {/* CI 68% band */}
            <Area
              yAxisId="left"
              dataKey="ci68Rail"
              stackId="ci68"
              fill="transparent"
              stroke="none"
              legendType="none"
              isAnimationActive={false}
            />
            <Area
              yAxisId="left"
              dataKey="ci68Band"
              stackId="ci68"
              fill={color}
              fillOpacity={0.2}
              stroke={color}
              strokeOpacity={0.4}
              strokeWidth={1}
              name="CI 68%"
              isAnimationActive={false}
            />

            {/* Recalibrated sheet path (real segment slopes) */}
            {hasRecalib && (
              <Line
                yAxisId="left"
                dataKey="recalib"
                stroke={RECALIB_COLOR}
                strokeWidth={2.5}
                connectNulls
                dot={{ r: 2.5, fill: RECALIB_COLOR, strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                name={t("signals.precat.legend.recalib")}
                isAnimationActive={false}
              />
            )}
            {/* Linear median (constant eff. slope) */}
            <Line
              yAxisId="left"
              dataKey="median"
              stroke={color}
              strokeWidth={hasRecalib ? 1.5 : 2}
              strokeDasharray={hasRecalib ? "6 4" : undefined}
              connectNulls
              dot={{ r: hasRecalib ? 0 : 2.5, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              name={t("signals.precat.legend.medianLinear")}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Mini legend with interpretation */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-muted px-1">
        {hasRecalib && (
          <span
            className="flex items-center gap-1"
            title={t("signals.precat.legend.recalib")}
          >
            <span className="inline-block w-5 h-0.5 rounded" style={{ background: RECALIB_COLOR }} />
            {t("signals.precat.legend.recalib")}
          </span>
        )}
        <span
          className="flex items-center gap-1"
          title="Central scenario: most likely % change vs current price"
        >
          <span
            className={`inline-block w-5 border-t-2 ${hasRecalib ? "border-dashed" : "rounded h-0.5"}`}
            style={{ borderColor: color, ...(hasRecalib ? {} : { background: color }) }}
          />
          {hasRecalib ? t("signals.precat.legend.medianLinear") : "Median = central scenario"}
        </span>
        <span
          className="flex items-center gap-1"
          title="68% confidence interval: in ~2 out of 3 cases the price falls within"
        >
          <span className="inline-block w-5 h-3 rounded opacity-40" style={{ background: color }} />
          CI 68% = ~2/3 of cases
        </span>
        <span
          className="flex items-center gap-1"
          title="90% confidence interval: in ~9 out of 10 cases the price falls within"
        >
          <span className="inline-block w-5 h-3 rounded opacity-15" style={{ background: color }} />
          CI 90% = ~9/10 of cases
        </span>
        <span className="ml-auto text-[10px] text-ink-muted/70">
          📍 today = T−{daysToCd} · CD = T0 · {data.length} waypoint · T{data[0]?.x} → T{data[data.length - 1]?.x}
        </span>
      </div>

      {/* Notes (only if there are warnings) */}
      {curve.notes.filter(n => !n.includes("→ regime")).length > 0 && (
        <div className="space-y-0.5">
          {curve.notes
            .filter(n => !n.includes("→ regime"))
            .map((note, i) => (
              <p key={i} className="text-[10px] text-ink-muted/70 leading-snug">
                ℹ {note}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
