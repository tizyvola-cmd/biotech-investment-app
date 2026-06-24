/**
 * Grafico traiettoria % vs oggi — marker «Oggi» sempre visibile sull’asse CD.
 */
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_CURVES_AXIS_LINE,
  chartCurvesAxisTick,
  chartCurvesGrid,
  CHART_CURVES_TOOLTIP,
  CHART_CURVES_TOOLTIP_MUTED,
  CHART_CURVES_TOOLTIP_TITLE,
  CHART_LAB_DOT_ACTUAL,
  CHART_LAB_DOT_PRED,
  CHART_LAB_LINE_ACTUAL,
  CHART_LAB_LINE_EXPECTED,
  CHART_LAB_LINE_PRED,
  chartCurvesLegendStyle,
} from "../sheet/chartTheme";
import { renderCdZones } from "../sheet/chartCdZones";
import {
  formatSlopeTrajectoryAxisTick,
  magnifiedPctDomain,
  slopeTrajectoryAxisTicks,
  slopeTrajectoryXDomain,
} from "../sheet/slopeErrorCharts";
import type { SlopeTrajectoryPoint } from "../sheet/slopeRecalibCurve";
import { ChartNowPinLabel, NowCurvePinShape } from "../sheet/nowTimelineMarker";
import { computeSlopeRotationFlag } from "../sheet/slopeStability";
import {
  buildActualWindowSegments,
  buildExpectedPreErrorTrajectory,
  buildTrajectoryWindowSlices,
  SLOPE_WINDOW_20D,
  SLOPE_WINDOW_5D,
} from "../sheet/slopeTrajectoryOverlay";
import { segmentSlopePpD } from "../sheet/slopeRecalibCurve";
import { fmtPortfolioPnlPct } from "../sheet/portfolioGainLossStyle";
import { useT } from "../shared/i18n";
import { useThemeContext } from "../context/ThemeContext";

export function SlopeTrajectoryChart({
  points,
  todayOffset,
  lang,
  predName,
  actualName,
  showSlopeWindows = false,
  slope5d = null,
  slope20d = null,
  dailyMovePct = null,
  height = 200,
  chartOnly = false,
}: {
  points: SlopeTrajectoryPoint[];
  todayOffset: number;
  lang: "it" | "en";
  predName: string;
  actualName: string;
  showSlopeWindows?: boolean;
  /** Pendenze pp/g per colorare i segmenti 5g/20g sulla curva reale. */
  slope5d?: number | null;
  slope20d?: number | null;
  /** Var. Giorn. % (24h move) — annotato sul pin «Oggi». */
  dailyMovePct?: number | null;
  height?: number;
  /** Solo grafico — niente didascalie sopra/sotto (tile 24h assessment). */
  chartOnly?: boolean;
}) {
  const t = useT();
  const { theme: appearanceTheme } = useThemeContext();
  const it = lang === "it";
  const curvesGrid = useMemo(() => chartCurvesGrid(), [appearanceTheme]);
  const curvesAxisTick = useMemo(() => chartCurvesAxisTick(), [appearanceTheme]);
  const xDomain = useMemo(() => slopeTrajectoryXDomain(points, todayOffset), [points, todayOffset]);
  const xTicks = useMemo(() => slopeTrajectoryAxisTicks(xDomain, todayOffset), [xDomain, todayOffset]);
  const tile = chartOnly;
  const lineW = tile ? 1.75 : 2.5;
  const lineWSecondary = tile ? 1.5 : 2;
  const dotMain = tile ? 3.5 : 5;
  const dotKnot = tile ? 4.5 : 6;
  const refTodayW = tile ? 1.5 : 2;

  const actualPointCount = useMemo(
    () => points.filter((p) => !p.isToday && p.actual != null && Number.isFinite(p.actual)).length,
    [points],
  );
  const showActualLine = actualPointCount >= 2;

  const segmentField = useMemo(
    () => (showActualLine ? "actual" : "pred"),
    [showActualLine],
  );

  const trajectorySlope20d = useMemo(
    () =>
      segmentSlopePpD(points, segmentField, SLOPE_WINDOW_20D.end, SLOPE_WINDOW_20D.start),
    [points, segmentField],
  );

  const resolvedSlope20d = useMemo(
    () => trajectorySlope20d ?? slope20d,
    [trajectorySlope20d, slope20d],
  );

  const expectedPreErrorSlice = useMemo(
    () =>
      showSlopeWindows
        ? buildExpectedPreErrorTrajectory(
            points,
            todayOffset,
            resolvedSlope20d,
            segmentField,
          )
        : [],
    [showSlopeWindows, points, todayOffset, resolvedSlope20d, segmentField],
  );

  const expectedPreErrorName = it ? "Atteso (20g)" : "Expected (20d)";

  const chartData = useMemo(() => {
    type Row = SlopeTrajectoryPoint & { expectedPreError?: number | null };
    const map = new Map<number, Row>();
    for (const p of points) map.set(p.offset, { ...p });
    for (const ep of expectedPreErrorSlice) {
      const prev = map.get(ep.offset);
      if (prev) {
        map.set(ep.offset, { ...prev, expectedPreError: ep.expected });
      } else {
        map.set(ep.offset, {
          offset: ep.offset,
          label: ep.offset === todayOffset ? "T0" : ep.offset === 0 ? "CD" : `T${ep.offset}`,
          pred: null,
          actual: null,
          gap: null,
          expectedPreError: ep.expected,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.offset - b.offset);
  }, [points, expectedPreErrorSlice, todayOffset]);

  const [yMin, yMax] = useMemo(
    () =>
      magnifiedPctDomain([
        ...points.flatMap((p) => [p.pred, p.actual, p.gap]),
        ...expectedPreErrorSlice.map((p) => p.expected),
      ]),
    [points, expectedPreErrorSlice],
  );

  const todayLabel = it ? "Oggi" : "Today";
  const daysToCd = Math.max(0, -todayOffset);
  const rotation = computeSlopeRotationFlag(slope5d, slope20d) === 1;

  const dailyPinSub =
    dailyMovePct != null && Number.isFinite(dailyMovePct)
      ? t("sim.lossAnalysis.chart.todayDailyMove", {
          pct: fmtPortfolioPnlPct(dailyMovePct),
        })
      : undefined;
  const dailyPinColor =
    dailyMovePct != null && dailyMovePct < -0.01
      ? "#dc2626"
      : dailyMovePct != null && dailyMovePct > 0.01
        ? "#16a34a"
        : "#64748b";

  const windowSlices = useMemo(
    () =>
      showSlopeWindows
        ? buildTrajectoryWindowSlices(points, it ? "it" : "en", segmentField)
        : [],
    [showSlopeWindows, points, it, segmentField],
  );

  const windowSegments = useMemo(
    () =>
      showSlopeWindows
        ? buildActualWindowSegments(points, it ? "it" : "en", segmentField)
        : [],
    [showSlopeWindows, points, it, segmentField],
  );

  const segmentCurveName =
    segmentField === "actual" ? actualName : predName;

  function tooltipSeriesColor(name: string | undefined): string {
    if (name === predName) return CHART_LAB_LINE_PRED;
    if (name === actualName) return CHART_LAB_LINE_ACTUAL;
    if (name === expectedPreErrorName) return CHART_LAB_LINE_EXPECTED;
    return "#64748b";
  }

  const slopeBadgeRow = useMemo(() => {
    if (!showSlopeWindows) return null;
    const fmt = (v: number | null | undefined) =>
      v != null && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : "—";
    const items: { key: string; text: string; tone: "up" | "down" | "warn" | "muted" }[] = [];
    for (const seg of windowSegments) {
      const is5d = seg.label === "5g" || seg.label === "5d";
      const slopeVal = is5d ? slope5d : slope20d;
      const rising = (slopeVal ?? 0) >= 0;
      let tone: "up" | "down" | "warn" = rising ? "up" : "down";
      if (rotation && is5d) tone = "down";
      if (rotation && !is5d) tone = "up";
      items.push({
        key: seg.label,
        text: `${seg.label} ${fmt(slopeVal)}`,
        tone,
      });
    }
    if (rotation) {
      items.push({
        key: "rev",
        text: it ? "↻ inversione" : "↻ reversal",
        tone: "warn",
      });
    }
    return items;
  }, [showSlopeWindows, windowSegments, slope5d, slope20d, rotation, it]);

  if (points.length < 2) {
    return (
      <p className="text-xs chart-lab-muted py-8 text-center">
        {it
          ? "Dati curva insufficienti (snapshot grafici o foglio Simulation)"
          : "Insufficient curve data (charts snapshot or Simulation sheet)"}
      </p>
    );
  }

  function windowStroke(label: string): { stroke: string; width: number; dash?: string } {
    const is5d = label === "5g" || label === "5d";
    const slopeVal = is5d ? slope5d : slope20d;
    const rising = (slopeVal ?? 0) >= 0;
    if (rotation && is5d) {
      return { stroke: "rgb(var(--signal-down))", width: 5 };
    }
    if (rotation && !is5d) {
      return { stroke: "rgb(var(--signal-up))", width: 4, dash: "6 4" };
    }
    return {
      stroke: rising ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))",
      width: is5d ? 4 : 3.5,
    };
  }

  return (
    <div className={chartOnly ? "h-full w-full min-h-0" : "space-y-1"}>
      {!chartOnly ? (
      <p className="text-[10px] text-ink-muted/85 leading-snug px-0.5">
        {it ? (
          <>
            <span className="font-semibold text-[rgb(var(--warn))]">Oggi</span> = linea arancione (0% =
            prezzo attuale).{" "}
            {daysToCd > 0 ? (
              <>
                A sinistra il passato, a destra verso CD ({daysToCd}g).
              </>
            ) : (
              <>Giorno CD.</>
            )}
          </>
        ) : (
          <>
            <span className="font-semibold text-[rgb(var(--warn))]">Today</span> = orange line (0% =
            current price).{" "}
            {daysToCd > 0 ? (
              <>Past on the left, catalyst CD in {daysToCd}d on the right.</>
            ) : (
              <>Catalyst day.</>
            )}
          </>
        )}
        {showSlopeWindows ? (
          <>
            {" "}
            {it ? (
              <>
                Segmenti <span className="font-semibold text-ink">verde/rosso</span> sulla curva{" "}
                <span className="font-semibold" style={{ color: segmentField === "actual" ? CHART_LAB_LINE_ACTUAL : CHART_LAB_LINE_PRED }}>
                  {segmentCurveName}
                </span>{" "}
                = pendenza 20g e 5g{rotation ? " · ↻ inversione tra le due finestre" : ""}.
                {expectedPreErrorSlice.length >= 2 ? (
                  <>
                    {" "}
                    <span className="font-semibold" style={{ color: CHART_LAB_LINE_EXPECTED }}>
                      {expectedPreErrorName}
                    </span>{" "}
                    = traiettoria attesa (20g proiettata da −10g, prima dell&apos;errore slope).
                  </>
                ) : null}
              </>
            ) : (
              <>
                <span className="font-semibold text-ink">Green/red</span> segments on{" "}
                <span className="font-semibold" style={{ color: segmentField === "actual" ? CHART_LAB_LINE_ACTUAL : CHART_LAB_LINE_PRED }}>
                  {segmentCurveName}
                </span>{" "}
                = 20d and 5d slope
                {rotation ? " · ↻ reversal between windows" : ""}.
                {expectedPreErrorSlice.length >= 2 ? (
                  <>
                    {" "}
                    <span className="font-semibold" style={{ color: CHART_LAB_LINE_EXPECTED }}>
                      {expectedPreErrorName}
                    </span>{" "}
                    = expected path (20d slope projected from −10d, before the slope error).
                  </>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </p>
      ) : null}
      {!chartOnly && slopeBadgeRow?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5 pb-0.5">
          {slopeBadgeRow.map((b) => (
            <span
              key={b.key}
              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                b.tone === "up"
                  ? "border-[rgb(var(--signal-up))]/35 bg-[rgb(var(--signal-up))]/10 text-[rgb(var(--signal-up))]"
                  : b.tone === "down"
                    ? "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))]"
                    : b.tone === "warn"
                      ? "border-[rgb(var(--warn))]/40 bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))]"
                      : "border-[rgb(var(--border))]/40 text-ink-muted"
              }`}
            >
              {b.text}
            </span>
          ))}
        </div>
      ) : null}
      <ResponsiveContainer
        width="100%"
        height={chartOnly ? "100%" : height}
        className="slope-trajectory-chart"
      >
        <LineChart
          data={chartData}
          margin={{ top: dailyPinSub ? 30 : 12, right: 12, left: 4, bottom: 6 }}
        >
          <CartesianGrid {...curvesGrid} />
          {renderCdZones({
            cdX: 0,
            xMin: xDomain[0],
            xMax: xDomain[1],
          })}
          <XAxis
            dataKey="offset"
            type="number"
            domain={xDomain}
            ticks={xTicks}
            tick={curvesAxisTick}
            axisLine={CHART_CURVES_AXIS_LINE}
            tickLine={false}
            tickFormatter={(d: number) => formatSlopeTrajectoryAxisTick(d, todayOffset, lang)}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={curvesAxisTick}
            axisLine={CHART_CURVES_AXIS_LINE}
            tickLine={false}
            tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
            width={52}
            label={
              showSlopeWindows
                ? {
                    value: it ? "% vs oggi" : "% vs today",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#64748b",
                    fontSize: 9,
                  }
                : undefined
            }
          />
          <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="4 4" />
          {/* T-10 → CD: grigio sfumato */}
          <ReferenceArea
            x1={-10}
            x2={0}
            fill="#94a3b8"
            fillOpacity={0.18}
            strokeOpacity={0}
            ifOverflow="extendDomain"
          />
          {/* CD → T+7: giallo senape sfumato */}
          <ReferenceArea
            x1={0}
            x2={7}
            fill="#ca8a04"
            fillOpacity={0.13}
            strokeOpacity={0}
            ifOverflow="extendDomain"
          />
          {showSlopeWindows ? (
            <>
              <ReferenceArea
                x1={-30}
                x2={-10}
            fill="#bfdbfe"
            fillOpacity={tile ? 0.1 : 0.18}
            strokeOpacity={0}
          />
          <ReferenceArea
            x1={-10}
            x2={-3}
            fill="#fde68a"
            fillOpacity={tile ? 0.12 : 0.2}
                strokeOpacity={0}
              />
            </>
          ) : null}
          <ReferenceLine
            x={todayOffset}
            stroke="#dc2626"
            strokeWidth={refTodayW + 0.25}
            strokeDasharray="5 3"
            label={
              <ChartNowPinLabel
                text={todayLabel}
                subText={dailyPinSub}
                subColor={dailyPinColor}
              />
            }
            ifOverflow="extendDomain"
          />
          {rotation && showSlopeWindows ? (
            <ReferenceLine
              x={SLOPE_WINDOW_5D.start}
              stroke="rgb(var(--signal-down))"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              ifOverflow="extendDomain"
            />
          ) : null}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as SlopeTrajectoryPoint | undefined;
              const title =
                row?.isToday
                  ? todayLabel
                  : row?.offset === 0
                    ? "CD"
                    : row?.label ?? "";
              return (
                <div className={CHART_CURVES_TOOLTIP}>
                  <p className={CHART_CURVES_TOOLTIP_TITLE}>{title}</p>
                  {payload.map((p) => {
                    const seriesName = String(p.name ?? "");
                    const seriesColor = tooltipSeriesColor(seriesName);
                    return (
                      <p
                        key={String(p.dataKey)}
                        className="tabular-nums font-semibold"
                        style={{ color: seriesColor }}
                      >
                        {seriesName}:{" "}
                        {typeof p.value === "number"
                          ? `${p.value >= 0 ? "+" : ""}${p.value.toFixed(1)}%`
                          : "—"}
                      </p>
                    );
                  })}
                  {row?.gap != null && (
                    <p className={`${CHART_CURVES_TOOLTIP_MUTED} tabular-nums`}>
                      <span>
                        {it ? "Scostamento (reale − modello)" : "Deviation (actual − model)"}:{" "}
                      </span>
                      <span
                        className="font-semibold"
                        style={{
                          color:
                            row.gap >= 0 ? CHART_LAB_LINE_ACTUAL : CHART_LAB_LINE_PRED,
                        }}
                      >
                        {row.gap >= 0 ? "+" : ""}
                        {row.gap.toFixed(1)}%
                      </span>
                    </p>
                  )}
                  {row?.isToday && dailyPinSub ? (
                    <p
                      className={CHART_CURVES_TOOLTIP_MUTED}
                      style={{ color: dailyPinColor, fontWeight: 600 }}
                    >
                      {dailyPinSub}
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
          {!chartOnly ? (
          <Legend
            {...chartCurvesLegendStyle()}
            verticalAlign="bottom"
            formatter={(value) => (
              <span
                style={{
                  color:
                    value === predName
                      ? CHART_LAB_LINE_PRED
                      : value === expectedPreErrorName
                        ? CHART_LAB_LINE_EXPECTED
                        : CHART_LAB_LINE_ACTUAL,
                }}
              >
                {value}
              </span>
            )}
          />
          ) : null}
          <Line
            type="monotone"
            dataKey="pred"
            name={predName}
            stroke={CHART_LAB_LINE_PRED}
            strokeWidth={lineW}
            strokeDasharray="6 3"
            dot={(props) => {
              const row = props.payload as SlopeTrajectoryPoint | undefined;
              if (row?.isToday) {
                return <NowCurvePinShape cx={props.cx} cy={props.cy} />;
              }
              if (
                row?.pred == null ||
                !Number.isFinite(row.pred) ||
                props.cx == null ||
                props.cy == null ||
                !Number.isFinite(props.cx) ||
                !Number.isFinite(props.cy)
              ) {
                return <g />;
              }
              const r = row?.isRecalibKnot ? dotKnot : dotMain;
              return (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={r}
                  fill={CHART_LAB_DOT_PRED}
                  stroke={row?.isRecalibKnot ? "#4f46e5" : CHART_LAB_LINE_PRED}
                  strokeWidth={row?.isRecalibKnot ? 1.5 : 1.5}
                />
              );
            }}
            activeDot={{ r: tile ? 5 : 7, fill: CHART_LAB_DOT_PRED }}
            connectNulls
          />
          {expectedPreErrorSlice.length >= 2 ? (
            <Line
              type="monotone"
              dataKey="expectedPreError"
              name={expectedPreErrorName}
              stroke={CHART_LAB_LINE_EXPECTED}
              strokeWidth={lineWSecondary}
              strokeDasharray="6 4"
              dot={{ r: tile ? 2.5 : 3, fill: CHART_LAB_LINE_EXPECTED, strokeWidth: 0 }}
              activeDot={{ r: tile ? 4 : 5, fill: CHART_LAB_LINE_EXPECTED }}
              connectNulls
              isAnimationActive={false}
            />
          ) : null}
          {showActualLine ? (
            <Line
              type="monotone"
              dataKey="actual"
              name={actualName}
              stroke={CHART_LAB_LINE_ACTUAL}
              strokeWidth={lineW}
              dot={(props) => {
                const row = props.payload as SlopeTrajectoryPoint | undefined;
                if (row?.isToday) return <g />;
                if (
                  row?.actual == null ||
                  !Number.isFinite(row.actual) ||
                  props.cx == null ||
                  props.cy == null ||
                  !Number.isFinite(props.cx) ||
                  !Number.isFinite(props.cy)
                ) {
                  return <g />;
                }
                return (
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={5}
                    fill={CHART_LAB_DOT_ACTUAL}
                    stroke={CHART_LAB_LINE_ACTUAL}
                    strokeWidth={1}
                  />
                );
              }}
              activeDot={{ r: 7, fill: CHART_LAB_DOT_ACTUAL }}
              connectNulls={false}
            />
          ) : null}
          {showSlopeWindows
            ? windowSlices.map((slice) => {
                const style = windowStroke(slice.label);
                return (
                  <Line
                    key={`win-${slice.label}-${slice.field}`}
                    data={slice.points}
                    type="monotone"
                    dataKey={slice.field}
                    name={slice.label}
                    stroke={style.stroke}
                    strokeWidth={style.width}
                    strokeDasharray={style.dash}
                    dot={false}
                    legendType="none"
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })
            : null}
        </LineChart>
      </ResponsiveContainer>
      {!chartOnly && !showActualLine && showSlopeWindows && windowSlices.length >= 2 ? (
        <p className="text-[9px] text-ink-muted/90 leading-snug px-0.5">
          {it
            ? "Storico prezzo assente — segmenti 5g/20g sulla curva modello ricalibrato (linea blu)."
            : "No price history — 5d/20d slope segments follow the recalibrated model curve (blue line)."}
        </p>
      ) : !chartOnly && !showActualLine ? (
        <p className="text-[9px] text-ink-muted/90 leading-snug px-0.5">
          {it
            ? "Curva Reale non tracciabile (storico prezzo assente) — usa i segmenti colorati 5g/20g sulla traiettoria stimata."
            : "Actual curve unavailable (no price history) — use colored 5d/20d slope segments."}
        </p>
      ) : null}
    </div>
  );
}
