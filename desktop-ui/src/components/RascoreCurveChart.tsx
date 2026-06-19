import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  CHART_CURVES_AXIS_LINE,
  CHART_CURVES_AXIS_TICK,
  CHART_CURVES_GRID,
  CHART_CURVES_PANEL,
  chartCurvesLegendStyle,
} from "../sheet/chartTheme";
import {
  computeRascoreChartYDomain,
  rascoreBubbleRadius,
  rascoreChartSlots,
  type RascoreSignalImpactView,
} from "../sheet/rascoreSignalImpactView";
import { useLang, useT } from "../shared/i18n";

type TimeWindow = "7d" | "24h";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export function RascoreCurveChart({ view }: { view: RascoreSignalImpactView }) {
  const t = useT();
  const { lang } = useLang();
  const [window, setWindow] = useState<TimeWindow>("7d");

  const slots = useMemo(() => rascoreChartSlots(view.bins), [view.bins]);

  const bubbleData = useMemo(() => {
    const metricKey = window === "7d" ? "grow7dPct" : "grow24hPct";
    const nKey = window === "7d" ? "n7d" : "n24h";
    return slots
      .filter((b) => b.n > 0 && b[nKey] > 0 && b[metricKey] != null)
      .map((b) => ({
        scoreMid: b.scoreMid,
        binLabel: b.binLabel,
        successPct: b[metricKey] as number,
        n: b[nKey],
        nTotal: b.n,
        nInvest: b.nInvest,
        grow7d: b.grow7dPct,
        grow24h: b.grow24hPct,
        decline7d: b.decline7dPct,
        winInvest: b.nInvest >= 2 ? b.winInvestPct : null,
        meanPnl: b.meanPnlPct,
        empty: false,
      }));
  }, [slots, window]);

  const xDomain = useMemo((): [number, number] => {
    if (!slots.length) return [15, 85];
    const mids = slots.map((s) => s.scoreMid);
    return [Math.min(...mids) - 8, Math.max(...mids) + 8];
  }, [slots]);

  const yDomain = useMemo(() => computeRascoreChartYDomain(), []);

  const investRefMid =
    view.thresholds.investMinScore != null ? view.thresholds.investMinScore + 5 : null;

  if (!slots.length) return null;

  return (
    <div className={`${CHART_CURVES_PANEL} p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink mb-0.5">
            {t("modelLab.qc.rascoreImpact.chartTitle")}
          </p>
          <p className="text-[9px] text-ink-muted leading-snug max-w-2xl">
            {t("modelLab.qc.rascoreImpact.chartCaption")}
          </p>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-md seg-toggle-track shrink-0">
          {(["7d", "24h"] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={window === w ? "seg-btn-active" : "seg-btn"}
              onClick={() => setWindow(w)}
            >
              {w === "7d" ? t("modelLab.qc.rascoreImpact.window7d") : t("modelLab.qc.rascoreImpact.window24h")}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid {...CHART_CURVES_GRID} vertical={false} />
            <XAxis
              dataKey="scoreMid"
              type="number"
              domain={xDomain}
              ticks={slots.map((s) => s.scoreMid)}
              tick={CHART_CURVES_AXIS_TICK}
              axisLine={CHART_CURVES_AXIS_LINE}
              tickLine={false}
              height={36}
              tickFormatter={(v: number) => {
                const slot = slots.find((s) => s.scoreMid === v);
                if (!slot) return String(Math.round(v));
                if (slot.n === 0) {
                  return lang === "it" ? `${slot.binLabel}\nn/a` : `${slot.binLabel}\nn/a`;
                }
                return slot.binLabel;
              }}
            />
            <YAxis
              domain={yDomain}
              tick={CHART_CURVES_AXIS_TICK}
              axisLine={CHART_CURVES_AXIS_LINE}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${v}%`}
              label={{
                value:
                  window === "7d"
                    ? t("modelLab.qc.rascoreImpact.yAxis7d")
                    : t("modelLab.qc.rascoreImpact.yAxis24h"),
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 9,
              }}
            />
            <ZAxis dataKey="n" range={[80, 520]} />
            <ReferenceLine
              y={50}
              stroke="#cbd5e1"
              strokeDasharray="4 4"
              label={{
                value: t("modelLab.qc.rascoreImpact.majorityRule"),
                fontSize: 8,
                fill: "#94a3b8",
                position: "insideTopRight",
              }}
            />
            {investRefMid != null && window === "7d" ? (
              <ReferenceLine
                x={investRefMid}
                stroke="#059669"
                strokeDasharray="6 3"
                label={{
                  value: t("modelLab.qc.rascoreImpact.investRef"),
                  fontSize: 8,
                  fill: "#059669",
                  position: "insideTopLeft",
                }}
              />
            ) : null}
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as (typeof bubbleData)[number];
                return (
                  <div className="rounded-md border border-[rgb(var(--panel-feed-border))]/60 bg-white px-2.5 py-2 text-[10px] shadow-md max-w-[260px]">
                    <p className="font-semibold text-ink mb-1">
                      RA {row.binLabel}{" "}
                      <span className="font-normal text-ink-muted">
                        (n={row.nTotal}
                        {row.nInvest > 0 ? ` · ${row.nInvest} pf` : ""})
                      </span>
                    </p>
                    <p className="text-emerald-700 font-semibold">
                      {window === "7d"
                        ? t("modelLab.qc.rascoreImpact.series.grow7d")
                        : t("modelLab.qc.rascoreImpact.series.grow24h")}
                      : {fmtPct(row.successPct)} · n={row.n}
                    </p>
                    <p className="text-ink-muted mt-1">
                      {t("modelLab.qc.rascoreImpact.tooltipAltWindow")}:{" "}
                      {window === "7d" ? fmtPct(row.grow24h, 0) : fmtPct(row.grow7d)}
                    </p>
                    {row.winInvest != null ? (
                      <p className="text-violet-700">
                        {t("modelLab.qc.rascoreImpact.series.winInvest")}: {fmtPct(row.winInvest)}
                      </p>
                    ) : row.nInvest === 1 ? (
                      <p className="text-ink-muted/80 italic">
                        {t("modelLab.qc.rascoreImpact.winRateSingle")}
                      </p>
                    ) : null}
                    {row.meanPnl != null ? (
                      <p className="text-blue-700">
                        {t("modelLab.qc.rascoreImpact.series.meanPnl")}: {fmtPct(row.meanPnl)}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
            <Legend {...chartCurvesLegendStyle()} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
            <Scatter
              name={
                window === "7d"
                  ? t("modelLab.qc.rascoreImpact.bubbleLegend7d")
                  : t("modelLab.qc.rascoreImpact.bubbleLegend24h")
              }
              data={bubbleData}
              fill="#059669"
              isAnimationActive={false}
            >
              {bubbleData.map((entry) => (
                <Cell
                  key={entry.binLabel}
                  fill={
                    entry.successPct >= 55
                      ? "#059669"
                      : entry.successPct >= 45
                        ? "#d97706"
                        : "#e11d48"
                  }
                  fillOpacity={0.82}
                  stroke={
                    entry.successPct >= 55
                      ? "#047857"
                      : entry.successPct >= 45
                        ? "#b45309"
                        : "#be123c"
                  }
                  strokeWidth={1.5}
                  r={rascoreBubbleRadius(entry.n)}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted/85 mt-1 leading-snug">
        {t("modelLab.qc.rascoreImpact.bubbleSizeHint")}
      </p>
    </div>
  );
}
