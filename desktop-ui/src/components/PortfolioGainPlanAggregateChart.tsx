import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AggregateGainPlanPoint } from "../sheet/dashboardPulseAggregate";
import { useLang, useT, type TranslationKey } from "../shared/i18n";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}€${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function PortfolioGainPlanAggregateChart({
  series,
  height = 168,
  titleKey = "dashboard.pulse.chartTitle",
  captionKey = "dashboard.pulse.chartCaption",
}: {
  series: AggregateGainPlanPoint[];
  height?: number;
  titleKey?: TranslationKey;
  /** i18n key for the caption under the chart. */
  captionKey?: TranslationKey;
}) {
  const t = useT();
  const { lang } = useLang();

  const chartData = useMemo(
    () =>
      series.filter(
        (p) =>
          (p.planned != null && Number.isFinite(p.planned)) ||
          (p.actual != null && Number.isFinite(p.actual)),
      ),
    [series],
  );

  const yDomain = useMemo((): [number, number] => {
    let min = 0;
    let max = 0;
    for (const p of chartData) {
      for (const v of [p.planned, p.actual]) {
        if (v == null || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    const pad = Math.max(80, (max - min) * 0.14 || Math.abs(max) * 0.12);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData]);

  if (chartData.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-[rgb(var(--panel-feed-border))]/55 bg-white/80 text-[11px] text-ink-muted"
        style={{ height }}
      >
        {t("dashboard.pulse.chartEmpty")}
      </div>
    );
  }

  return (
    <div className="invest-trend-chart-panel rounded-xl border border-[rgb(var(--panel-feed-border))]/55 bg-white/95 px-2 py-2 min-h-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))] mb-1 px-0.5">
        {t(titleKey)}
      </p>
      <div style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--panel-feed-border) / 0.35)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={yDomain}
              allowDataOverflow={false}
              tickCount={5}
              tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
              tickFormatter={(v) => {
              const n = Math.round(v);
              const sign = n >= 0 ? "+" : "−";
              return `${sign}€${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
            }}
              width={44}
            />
            <ReferenceLine y={0} stroke="rgb(var(--ink-muted) / 0.35)" strokeDasharray="2 4" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md border border-[rgb(var(--panel-feed-border))]/60 bg-white px-2.5 py-1.5 text-[11px] shadow-md">
                    <p className="font-semibold text-ink mb-1">{label}</p>
                    {payload.map((p) => (
                      <p key={String(p.dataKey)} className="tabular-nums" style={{ color: p.color }}>
                        {p.name}: {fmtEur(p.value as number)}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconSize={8}
              wrapperStyle={{ fontSize: 9, paddingBottom: 2 }}
            />
            <Line
              type="linear"
              dataKey="planned"
              name={lang === "it" ? "Piano €" : "Plan €"}
              stroke="rgb(var(--ink-muted))"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="actual"
              name={lang === "it" ? "Reale €" : "Actual €"}
              stroke="rgb(var(--signal-up))"
              strokeWidth={2.25}
              dot={{ r: 2.5, fill: "rgb(var(--signal-up))" }}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted/80 leading-snug mt-1 px-0.5">
        {t(captionKey)}
      </p>
    </div>
  );
}

export { fmtEur as fmtPulseEur, fmtPct as fmtPulsePct };
