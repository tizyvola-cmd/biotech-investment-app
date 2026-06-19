import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtAxisEurTick, fmtAxisPctTick } from "../sheet/chartAxisFormat";
import { useT } from "../shared/i18n";

const BAR_CHART_HEIGHT = 320;

export type PortfolioPnlBarRow = Record<string, unknown> & {
  name: string;
  ticker: string;
  pnlPct?: number | null;
  pnlEur?: number | null;
  pnlPctToday?: number | null;
  pnlEurToday?: number | null;
  pnlPctSinceReading?: number | null;
  pnlEurSinceReading?: number | null;
  hasReadingDelta?: boolean;
};

function fmtMetricValue(v: number | null | undefined, metric: "pct" | "eur"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return metric === "pct"
    ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
    : `${v >= 0 ? "+" : ""}€ ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function metricToneClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  return v >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]";
}

function PnlBarTooltip({
  active,
  payload,
  label,
  metric,
  seriesName,
  showDual,
  todayLabel,
  totalLabel,
  readingLabel,
  recoveringLabel,
}: {
  active?: boolean;
  payload?: { value: number; payload: PortfolioPnlBarRow }[];
  label?: string;
  metric: "pct" | "eur";
  seriesName: string;
  showDual?: boolean;
  todayLabel?: string;
  totalLabel?: string;
  readingLabel?: string;
  recoveringLabel?: string;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  const row = payload[0]?.payload;
  const todayKey = metric === "pct" ? "pnlPctToday" : "pnlEurToday";
  const totalKey = metric === "pct" ? "pnlPct" : "pnlEur";
  const readingKey = metric === "pct" ? "pnlPctSinceReading" : "pnlEurSinceReading";
  const todayVal = row?.[todayKey] as number | null | undefined;
  const totalVal = row?.[totalKey] as number | null | undefined;
  const readingVal = row?.[readingKey] as number | null | undefined;
  const recovering =
    showDual &&
    totalVal != null &&
    (readingVal != null || todayVal != null) &&
    totalVal < -0.05 &&
    ((readingVal != null && readingVal > 0.05) || (todayVal != null && todayVal > 0.05));

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2 text-xs shadow-lg ring-1 ring-black/5 max-w-[220px]">
      <p className="font-semibold text-ink tracking-wide">{row?.ticker ?? label}</p>
      {row?.name && row.name !== row?.ticker ? (
        <p className="text-[10px] text-ink-muted mt-0.5">{String(row.name).replace(/^[^·]+·\s*/, "")}</p>
      ) : null}
      <p className={`mt-1.5 text-sm font-bold tabular-nums ${metricToneClass(v)}`}>
        {v != null && Number.isFinite(v) ? fmtMetricValue(v, metric) : "—"}
      </p>
      <p className="text-[10px] text-ink-muted/80 mt-1">{seriesName}</p>
      {showDual && row?.hasToday !== false && (todayVal != null || totalVal != null) ? (
        <div className="mt-2 pt-2 border-t border-[rgb(var(--border))]/40 space-y-1 text-[10px] tabular-nums">
          {totalVal != null && Number.isFinite(totalVal) ? (
            <p>
              <span className="text-ink-muted">{totalLabel}: </span>
              <span className={metricToneClass(totalVal)}>{fmtMetricValue(totalVal, metric)}</span>
            </p>
          ) : null}
          {readingVal != null && Number.isFinite(readingVal) ? (
            <p>
              <span className="text-ink-muted">{readingLabel ?? "Reading"}: </span>
              <span className={metricToneClass(readingVal)}>{fmtMetricValue(readingVal, metric)}</span>
            </p>
          ) : null}
          {todayVal != null && Number.isFinite(todayVal) ? (
            <p>
              <span className="text-ink-muted">{todayLabel}: </span>
              <span className={metricToneClass(todayVal)}>{fmtMetricValue(todayVal, metric)}</span>
            </p>
          ) : null}
          {recovering && recoveringLabel ? (
            <p className="text-emerald-700 dark:text-emerald-400 font-semibold leading-snug pt-0.5">
              {recoveringLabel}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PortfolioPnlBarChart({
  data,
  dataKey,
  seriesName,
  metric,
  yDomain,
  portfolioReference,
  portfolioReferenceLabel,
  showDualInTooltip = false,
}: {
  data: PortfolioPnlBarRow[];
  dataKey: string;
  seriesName: string;
  metric: "pct" | "eur";
  yDomain: [number, number];
  /** Linea di riferimento = totale portafoglio (card header). */
  portfolioReference?: number | null;
  portfolioReferenceLabel?: string;
  /** In modalità Total, mostra anche oggi nel tooltip. */
  showDualInTooltip?: boolean;
}) {
  const t = useT();
  const axisMuted = "rgb(var(--ink-muted))";
  const gridStroke = "rgb(var(--border) / 0.55)";

  const hasSeriesValues = useMemo(
    () =>
      data.some((row) => {
        const v = row[dataKey] as number | null | undefined;
        return v != null && Number.isFinite(v);
      }),
    [data, dataKey],
  );

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-gradient-to-b from-[rgb(var(--surface-elevated))] to-[rgb(var(--surface))]/40 p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-ink-muted">{seriesName}</p>
        <p className="text-[10px] text-ink-muted/70 tabular-nums">{data.length} tickers</p>
      </div>
      {!hasSeriesValues ? (
        <p className="text-sm text-ink-muted text-center py-16 leading-relaxed">
          {t("sim.pnl.bar.noSeriesData")}
        </p>
      ) : (
      <div className="w-full" style={{ height: BAR_CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={BAR_CHART_HEIGHT} debounce={50}>
          <BarChart
            data={data}
            margin={{ top: 16, right: 12, left: 4, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid
              stroke={gridStroke}
              strokeDasharray="4 6"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: axisMuted, fontWeight: 500 }}
              tickLine={false}
              axisLine={{ stroke: gridStroke }}
              angle={-32}
              textAnchor="end"
              height={64}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: axisMuted }}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={yDomain}
              tickFormatter={(v) =>
                metric === "pct" ? `${fmtAxisPctTick(v)}%` : `€${fmtAxisEurTick(v)}`
              }
              allowDecimals
            />
            <Tooltip
              cursor={{ fill: "rgb(var(--accent) / 0.06)", radius: 6 }}
              content={
                <PnlBarTooltip
                  metric={metric}
                  seriesName={seriesName}
                  showDual={showDualInTooltip}
                  todayLabel={t("sim.pnl.bar.tooltipToday")}
                  totalLabel={t("sim.pnl.bar.tooltipTotal")}
                  readingLabel={t("sim.pnl.bar.tooltipReading")}
                  recoveringLabel={t("sim.lossAnalysis.pnlDual.recovering")}
                />
              }
            />
            <ReferenceLine
              y={0}
              stroke="rgb(var(--ink-muted) / 0.35)"
              strokeWidth={1.5}
            />
            {portfolioReference != null && Number.isFinite(portfolioReference) ? (
              <ReferenceLine
                y={portfolioReference}
                stroke="rgb(var(--accent))"
                strokeWidth={2}
                strokeDasharray="6 4"
                label={{
                  value: portfolioReferenceLabel ?? "",
                  position: "insideTopRight",
                  fill: "rgb(var(--accent))",
                  fontSize: 9,
                }}
              />
            ) : null}
            <Bar
              dataKey={dataKey}
              name={seriesName}
              maxBarSize={44}
              radius={[5, 5, 5, 5]}
              minPointSize={3}
              isAnimationActive
              animationDuration={480}
              animationEasing="ease-out"
            >
              {data.map((entry, i) => {
                const v = entry[dataKey] as number | null | undefined;
                return (
                  <Cell
                    key={`bar-${i}`}
                    fill={
                      v == null || !Number.isFinite(v)
                        ? "rgb(var(--signal-neutral) / 0.45)"
                        : v >= 0
                          ? "rgb(var(--signal-up) / 0.88)"
                          : "rgb(var(--signal-down) / 0.88)"
                    }
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      )}
    </div>
  );
}
