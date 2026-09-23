import { useId, useMemo, useState, type ReactElement } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AggregateGainPlanPoint } from "../sheet/dashboardPulseAggregate";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import {
  BUY_INDEX_LEGEND,
  buildBreakevenLogicFillSeries,
  SELL_INDEX_LEGEND,
  type BreakevenLogicMode,
  type BreakevenLogicPosition,
} from "../sheet/breakevenRecLogicFill";
import { useLang, useT, type TranslationKey } from "../shared/i18n";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}€${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function ActualDot(props: { cx?: number; cy?: number }): ReactElement {
  return (
    <circle
      cx={props.cx ?? 0}
      cy={props.cy ?? 0}
      r={2.5}
      fill="rgb(var(--signal-up))"
      stroke="#fff"
      strokeWidth={0.75}
    />
  );
}

export function PortfolioGainPlanAggregateChart({
  series,
  height = 168,
  titleKey = "dashboard.pulse.chartTitle",
  captionKey = "dashboard.pulse.chartCaption",
  logicPositions = null,
  history = null,
}: {
  series: AggregateGainPlanPoint[];
  height?: number;
  titleKey?: TranslationKey;
  captionKey?: TranslationKey;
  /** Open-book index scores — powers the under-curve Soft BUY/SELL blend. */
  logicPositions?: BreakevenLogicPosition[] | null;
  history?: InvestSimHistoryPoint[] | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const gradId = useId().replace(/:/g, "");
  const [mode, setMode] = useState<BreakevenLogicMode>("buy");

  const hasLogic = Boolean(logicPositions && logicPositions.length > 0);

  const chartData = useMemo(() => {
    const base = series.filter(
      (p) =>
        (p.planned != null && Number.isFinite(p.planned)) ||
        (p.actual != null && Number.isFinite(p.actual)),
    );
    if (!hasLogic || !logicPositions) {
      return base.map((p) => ({
        ...p,
        actualFill: p.actual,
        fillColor: "rgba(148,163,184,0.12)",
        fillAlpha: 0.12,
      }));
    }
    return buildBreakevenLogicFillSeries(
      base,
      logicPositions,
      history ?? [],
      mode,
    );
  }, [series, hasLogic, logicPositions, history, mode]);

  const gradientStops = useMemo(() => {
    if (chartData.length < 2) return [] as { offset: string; color: string }[];
    const n = chartData.length;
    return chartData.map((p, i) => ({
      offset: `${(i / Math.max(1, n - 1)) * 100}%`,
      color: p.fillColor,
    }));
  }, [chartData]);

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

  const indexLegend = mode === "buy" ? BUY_INDEX_LEGEND : SELL_INDEX_LEGEND;

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
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1 px-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
          {t(titleKey)}
        </p>
        {hasLogic ? (
          <SelectionChipGroup className="gap-1">
            <SelectionChip
              active={mode === "buy"}
              className="!text-[9px] !px-1.5 !py-0.5"
              onClick={() => setMode("buy")}
              title={
                it
                  ? "Sotto la curva: mix Soft BUY (SDS · P(plan) · P(cont))"
                  : "Under curve: Soft BUY mix (SDS · P(plan) · P(cont))"
              }
            >
              Soft BUY
            </SelectionChip>
            <SelectionChip
              active={mode === "sell"}
              className="!text-[9px] !px-1.5 !py-0.5"
              onClick={() => setMode("sell")}
              title={
                it
                  ? "Sotto la curva: mix Soft SELL (MTM · P(plan)↓ · Risk · Reg · P(cont))"
                  : "Under curve: Soft SELL mix (MTM · weak P(plan) · Risk · Reg · P(cont))"
              }
            >
              Soft SELL
            </SelectionChip>
          </SelectionChipGroup>
        ) : null}
      </div>

      {hasLogic ? (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5 mb-1 text-[9px] text-ink-muted">
          {indexLegend.map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: x.hex }}
              />
              {x.label}
            </span>
          ))}
          <span className="text-ink-muted/70">
            {it
              ? "· intensità = distanza dal gate minimo"
              : "· intensity = clearance past min gate"}
          </span>
        </div>
      ) : null}

      <div style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`be-logic-${gradId}`} x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
            </defs>
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
            <ReferenceLine
              y={0}
              stroke="rgb(var(--ink-muted) / 0.55)"
              strokeDasharray="4 3"
              label={{
                value: it ? "pareggio" : "breakeven",
                position: "insideTopRight",
                fill: "rgb(var(--ink-muted))",
                fontSize: 9,
              }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-md border border-[rgb(var(--panel-feed-border))]/60 bg-white px-2.5 py-1.5 text-[11px] shadow-md">
                    <p className="font-semibold text-ink mb-1">{label}</p>
                    {payload
                      .filter((p) => p.dataKey === "planned" || p.dataKey === "actual")
                      .map((p) => (
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
            <Area
              type="linear"
              dataKey="actualFill"
              name={it ? "Logica (area)" : "Logic (fill)"}
              stroke="none"
              fill={`url(#be-logic-${gradId})`}
              fillOpacity={1}
              baseValue={0}
              isAnimationActive={false}
              legendType="none"
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="planned"
              name={it ? "Piano €" : "Plan €"}
              stroke="rgb(var(--ink-muted))"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
            />
            <Line
              type="linear"
              dataKey="actual"
              name={it ? "Reale €" : "Actual €"}
              stroke="rgb(var(--signal-up))"
              strokeWidth={2.25}
              dot={ActualDot}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted/80 leading-snug mt-1 px-0.5">
        {t(captionKey)}
      </p>
    </div>
  );
}

export { fmtEur as fmtPulseEur, fmtPct as fmtPulsePct };
