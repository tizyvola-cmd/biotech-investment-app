import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EisScatterBundle } from "../data/signalCalibrationData";
import type { EisSignSplitChartRow, EisSlopeChartRow } from "../sheet/eisSignalImpactView";
import {
  eisSignSplitLift,
  eisSignSplitWorks,
  fmtSignSplitLift,
} from "../sheet/eisSignSplitVisual";
import { useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

function fmtCorr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function fmtSlope(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp/EIS`;
}

function fmtPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp`;
}

type ChartLegendItem = {
  color: string;
  label: string;
  dashed?: boolean;
  kind?: "line" | "bar";
};

function EisChartLegend({ items }: { items: ChartLegendItem[] }) {
  if (!items.length) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1.5 text-[9px] text-ink-muted"
      aria-label="Chart legend"
    >
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {item.kind === "bar" ? (
            <span className="inline-block h-2.5 w-2.5 rounded-sm opacity-80" style={{ backgroundColor: item.color }} />
          ) : (
            <span
              className="inline-block h-0 w-4 border-t-2"
              style={{
                borderColor: item.color,
                borderTopStyle: item.dashed ? "dashed" : "solid",
              }}
            />
          )}
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}

const CHART_X_LABEL = {
  position: "bottom" as const,
  offset: 4,
  style: { fontSize: 8, fill: "#64748b" },
};

const CHART_MARGIN = { top: 16, right: 14, left: 4, bottom: 28 };

function peakBand(rows: EisSlopeChartRow[] | EisSignSplitChartRow[]) {
  const peak = rows.find((r) => r.isPeak);
  if (!peak) return null;
  if ("daysMin" in peak && "daysMax" in peak) {
    return { x1: peak.daysMin, x2: peak.daysMax, label: peak.window };
  }
  const mid = peak.daysMid;
  return { x1: Math.max(0, mid - 15), x2: mid + 15, label: peak.window };
}

export function EisSlopeByCdWindowChart({
  rows,
  peakDaysMin,
  peakDaysMax,
}: {
  rows: EisSlopeChartRow[];
  peakDaysMin?: number | null;
  peakDaysMax?: number | null;
}) {
  const t = useT();
  if (!rows.length) return null;

  const sorted = [...rows].sort((a, b) => b.daysMid - a.daysMid);
  const xMax = Math.max(...sorted.map((r) => r.daysMax), 30);
  const band =
    peakDaysMin != null
      ? {
          x1: peakDaysMin,
          x2: peakDaysMax ?? peakDaysMin + 30,
          label: sorted.find((r) => r.isPeak)?.window,
        }
      : peakBand(sorted);

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.eisMagnitude.slopeChartTitle")}</p>
      <p className="text-[9px] text-ink-muted leading-snug">{t("modelLab.qc.eisMagnitude.slopeChartBody")}</p>
      <div className="h-[240px] w-full min-h-0">
        <ViewErrorBoundary label="EIS slope by CD window">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sorted} margin={{ ...CHART_MARGIN, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
              <XAxis
                type="number"
                dataKey="daysMid"
                domain={[0, xMax]}
                reversed
                tick={{ fontSize: 9 }}
                height={32}
                tickFormatter={(d: number) => `${Math.round(d)}d`}
                label={{
                  value: t("modelLab.qc.eisMagnitude.slopeXAxis"),
                  ...CHART_X_LABEL,
                }}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                width={52}
                label={{
                  value: t("modelLab.qc.eisMagnitude.slopeAxis"),
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 8, fill: "#64748b" },
                }}
              />
              {band ? (
                <ReferenceArea
                  x1={band.x1}
                  x2={band.x2}
                  fill="#eab308"
                  fillOpacity={0.12}
                  stroke="#eab308"
                  strokeOpacity={0.35}
                  strokeDasharray="4 3"
                />
              ) : null}
              <ReferenceLine
                x={0}
                stroke="#eab308"
                strokeWidth={2}
                strokeDasharray="6 4"
                label={{
                  value: t("modelLab.qc.eisMagnitude.cdLine"),
                  position: "insideTopRight",
                  fill: "#ca8a04",
                  fontSize: 9,
                }}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.6} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as EisSlopeChartRow;
                  return (
                    <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md space-y-0.5">
                      <p className="font-semibold">
                        {row.window} · {row.daysMin}–{row.daysMax}d {t("modelLab.qc.eisMagnitude.beforeCd")}
                      </p>
                      {row.isPeak ? (
                        <p className="text-amber-700 font-medium">{t("modelLab.qc.eisMagnitude.peakWindow")}</p>
                      ) : null}
                      <p>
                        T+1: {fmtSlope(row.slope1d)} · ρ {fmtCorr(row.r1d)} · n={row.n1d}
                      </p>
                      <p>
                        T+7: {fmtSlope(row.slope7d)} · ρ {fmtCorr(row.r7d)} · n={row.n7d}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="slope1d"
                name={t("modelLab.qc.eisMagnitude.horizonT1")}
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 1, stroke: "#fff" }}
                connectNulls={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="slope7d"
                name={t("modelLab.qc.eisMagnitude.horizonT7")}
                stroke="#059669"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 4, strokeWidth: 1, stroke: "#fff" }}
                connectNulls={false}
                legendType="none"
              />
            </LineChart>
          </ResponsiveContainer>
        </ViewErrorBoundary>
      </div>
      <EisChartLegend
        items={[
          { color: "#2563eb", label: t("modelLab.qc.eisMagnitude.horizonT1") },
          { color: "#059669", label: t("modelLab.qc.eisMagnitude.horizonT7"), dashed: true },
        ]}
      />
    </div>
  );
}

export function EisSignSplitByWindowChart({
  rows,
  showWeek,
}: {
  rows: EisSignSplitChartRow[];
  showWeek: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const enrichedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        lift1d: eisSignSplitLift(row.posAvg1d, row.negAvg1d),
        lift7d: eisSignSplitLift(row.posAvg7d, row.negAvg7d),
        works1d: eisSignSplitWorks(row.posAvg1d, row.negAvg1d),
        works7d: eisSignSplitWorks(row.posAvg7d, row.negAvg7d),
      })),
    [rows],
  );

  const peakRow = useMemo(
    () => enrichedRows.find((row) => row.isPeak) ?? enrichedRows[0] ?? null,
    [enrichedRows],
  );

  if (!rows.length) return null;
  if (!rows.some((r) => r.nNeg1d > 0 || r.nPos1d > 0)) return null;

  const sorted = [...enrichedRows].sort((a, b) => b.daysMid - a.daysMid);
  const xMax = Math.max(...sorted.map((r) => r.daysMid + 15), 30);
  const band = peakBand(sorted);

  const liftVerdict = (works: boolean | null) =>
    works == null ? "—" : works ? t("modelLab.qc.eisMagnitude.signSplitWorks") : t("modelLab.qc.eisMagnitude.signSplitInverted");

  const liftColor = (lift: number | null) => {
    if (lift == null) return "text-ink-muted";
    return lift > 0.05 ? "text-emerald-800" : lift < -0.05 ? "text-rose-700" : "text-ink-muted";
  };

  return (
    <div className="space-y-2 rounded-lg border border-rose-200/40 bg-rose-50/20 px-2.5 py-2.5">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left rounded-md hover:bg-rose-100/35 transition px-1 py-0.5 -mx-1"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="text-[10px] text-rose-700/80 shrink-0 pt-0.5" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[11px] font-semibold text-ink">
            {t("modelLab.qc.eisMagnitude.signSplitChartTitle")}
          </span>
          <span className="block text-[9px] text-ink-muted leading-snug">
            {expanded
              ? t("modelLab.qc.eisMagnitude.signSplitCollapse")
              : t("modelLab.qc.eisMagnitude.signSplitExpand")}
          </span>
        </span>
        {!expanded && peakRow?.lift1d != null ? (
          <span className={`shrink-0 text-[9px] tabular-nums font-medium ${liftColor(peakRow.lift1d)}`}>
            {peakRow.window} · T+1 {fmtSignSplitLift(peakRow.lift1d)}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <>
          <p className="text-[9px] text-ink-muted leading-snug -mt-1">
            {t("modelLab.qc.eisMagnitude.signSplitChartBody")}
          </p>
          <p className="text-[9px] leading-snug rounded border border-indigo-200/60 bg-indigo-50/70 px-2 py-1.5 text-indigo-950">
            {t("modelLab.qc.eisMagnitude.signSplitReadRule")}
          </p>

          <div className="h-[260px] w-full min-h-0">
            <ViewErrorBoundary label="EIS sign split">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sorted} margin={{ ...CHART_MARGIN, bottom: 36 }} barGap={2} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                  <XAxis
                    type="number"
                    dataKey="daysMid"
                    domain={[0, xMax]}
                    reversed
                    tick={{ fontSize: 9 }}
                    height={32}
                    tickFormatter={(d: number) => `${Math.round(d)}d`}
                    label={{
                      value: t("modelLab.qc.eisMagnitude.slopeXAxis"),
                      ...CHART_X_LABEL,
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    width={48}
                    unit=" pp"
                    label={{
                      value: t("modelLab.qc.eisMagnitude.signSplitYAxis"),
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 8, fill: "#64748b" },
                    }}
                  />
                  {band ? (
                    <ReferenceArea
                      x1={band.x1}
                      x2={band.x2}
                      fill="#eab308"
                      fillOpacity={0.12}
                      stroke="#eab308"
                      strokeOpacity={0.35}
                      strokeDasharray="4 3"
                      label={{
                        value: t("modelLab.qc.eisMagnitude.signSplitPeakBand"),
                        position: "insideTop",
                        fill: "#a16207",
                        fontSize: 8,
                      }}
                    />
                  ) : null}
                  <ReferenceLine
                    x={0}
                    stroke="#eab308"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    label={{
                      value: t("modelLab.qc.eisMagnitude.cdLine"),
                      position: "insideTopRight",
                      fill: "#ca8a04",
                      fontSize: 9,
                    }}
                  />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.6} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as (typeof sorted)[number];
                      return (
                        <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md space-y-1 max-w-[240px]">
                          <p className="font-semibold">{row.window}</p>
                          <p className="text-[9px] text-ink-muted">
                            {Math.round(row.daysMid)}d {t("modelLab.qc.eisMagnitude.beforeCd")}
                          </p>
                          <p className="text-rose-700">
                            EIS− T+1: {fmtPp(row.negAvg1d)} · n={row.nNeg1d}
                          </p>
                          <p className="text-emerald-700">
                            EIS+ T+1: {fmtPp(row.posAvg1d)} · n={row.nPos1d}
                          </p>
                          {row.lift1d != null ? (
                            <p className={`font-medium ${liftColor(row.lift1d)}`}>
                              {t("modelLab.qc.eisMagnitude.signSplitTooltipLift", {
                                horizon: "T+1",
                                lift: fmtSignSplitLift(row.lift1d),
                                verdict: liftVerdict(row.works1d),
                              })}
                            </p>
                          ) : null}
                          {showWeek ? (
                            <>
                              <p className="text-rose-600/90 border-t border-[rgb(var(--border))]/30 pt-1">
                                EIS− T+7: {fmtPp(row.negAvg7d)} · n={row.nNeg7d}
                              </p>
                              <p className="text-emerald-600/90">
                                EIS+ T+7: {fmtPp(row.posAvg7d)} · n={row.nPos7d}
                              </p>
                              {row.lift7d != null ? (
                                <p className={`font-medium ${liftColor(row.lift7d)}`}>
                                  {t("modelLab.qc.eisMagnitude.signSplitTooltipLift", {
                                    horizon: "T+7",
                                    lift: fmtSignSplitLift(row.lift7d),
                                    verdict: liftVerdict(row.works7d),
                                  })}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="negAvg1d"
                    name={t("modelLab.qc.eisMagnitude.negativeEisT1")}
                    fill="#e11d48"
                    fillOpacity={0.75}
                    radius={[2, 2, 0, 0]}
                    legendType="none"
                  />
                  <Bar
                    dataKey="posAvg1d"
                    name={t("modelLab.qc.eisMagnitude.positiveEisT1")}
                    fill="#059669"
                    fillOpacity={0.75}
                    radius={[2, 2, 0, 0]}
                    legendType="none"
                  />
                  {showWeek ? (
                    <>
                      <Bar
                        dataKey="negAvg7d"
                        name={t("modelLab.qc.eisMagnitude.negativeEisT7")}
                        fill="#fda4af"
                        fillOpacity={0.85}
                        radius={[2, 2, 0, 0]}
                        legendType="none"
                      />
                      <Bar
                        dataKey="posAvg7d"
                        name={t("modelLab.qc.eisMagnitude.positiveEisT7")}
                        fill="#6ee7b7"
                        fillOpacity={0.85}
                        radius={[2, 2, 0, 0]}
                        legendType="none"
                      />
                    </>
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </ViewErrorBoundary>
          </div>
          <EisChartLegend
            items={[
              { color: "#e11d48", label: t("modelLab.qc.eisMagnitude.negativeEisT1"), kind: "bar" },
              { color: "#059669", label: t("modelLab.qc.eisMagnitude.positiveEisT1"), kind: "bar" },
              ...(showWeek
                ? [
                    { color: "#fda4af", label: t("modelLab.qc.eisMagnitude.negativeEisT7"), kind: "bar" as const },
                    { color: "#6ee7b7", label: t("modelLab.qc.eisMagnitude.positiveEisT7"), kind: "bar" as const },
                  ]
                : []),
            ]}
          />

          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40">
                  <th className="text-left py-1 pr-2 font-medium">
                    {t("modelLab.qc.eisMagnitude.signSplitTableWindow")}
                  </th>
                  <th className="text-right py-1 px-2 font-medium">
                    {t("modelLab.qc.eisMagnitude.signSplitLiftT1")}
                  </th>
                  {showWeek ? (
                    <th className="text-right py-1 pl-2 font-medium">
                      {t("modelLab.qc.eisMagnitude.signSplitLiftT7")}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().map((row) => (
                  <tr
                    key={row.window}
                    className={`border-b border-[rgb(var(--border))]/20 tabular-nums ${
                      row.isPeak ? "bg-amber-50/80" : ""
                    }`}
                  >
                    <td className="py-1 pr-2 font-medium">
                      {row.window}
                      {row.isPeak ? (
                        <span className="ml-1 text-[8px] font-semibold uppercase text-amber-800">
                          peak
                        </span>
                      ) : null}
                    </td>
                    <td className={`py-1 px-2 text-right font-medium ${liftColor(row.lift1d)}`}>
                      {fmtSignSplitLift(row.lift1d)}
                      {row.works1d != null ? (
                        <span className="ml-1 text-[8px] font-normal opacity-80">
                          {liftVerdict(row.works1d)}
                        </span>
                      ) : null}
                    </td>
                    {showWeek ? (
                      <td className={`py-1 pl-2 text-right font-medium ${liftColor(row.lift7d)}`}>
                        {fmtSignSplitLift(row.lift7d)}
                        {row.works7d != null ? (
                          <span className="ml-1 text-[8px] font-normal opacity-80">
                            {liftVerdict(row.works7d)}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function EisScatterRegressionChart({
  title,
  body,
  bundle,
  lineColor,
  dotColor,
  hasPriceSummary = false,
}: {
  title: string;
  body: string;
  bundle: EisScatterBundle | null;
  lineColor: string;
  dotColor: string;
  hasPriceSummary?: boolean;
}) {
  const t = useT();
  const points = bundle?.points ?? [];
  const line = bundle?.regression?.line ?? [];
  const reg = bundle?.regression;

  if (!points.length && !line.length) {
    return (
      <div className="rounded border border-dashed border-[rgb(var(--border))]/50 px-2 py-3 text-[10px] text-ink-muted">
        {title}:{" "}
        {hasPriceSummary
          ? t("modelLab.qc.eisMagnitude.scatterNeedsApi")
          : t("modelLab.qc.eisMagnitude.scatterEmpty")}
      </div>
    );
  }

  const lineOnly = !points.length && line.length > 0;

  return (
    <div className="space-y-1 rounded border border-[rgb(var(--border))]/45 bg-white/80 px-2 py-2">
      <p className="text-[10px] font-medium text-ink">{title}</p>
      <p className="text-[9px] text-ink-muted leading-snug">{body}</p>
      <div className="h-[200px] w-full">
        <ViewErrorBoundary label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 8, right: 8, left: -4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                type="number"
                dataKey="x"
                name="EIS"
                tick={{ fontSize: 9 }}
                label={{
                  value: "EIS score",
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 8, fill: "#64748b" },
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                tick={{ fontSize: 9 }}
                width={40}
                unit=" pp"
                label={{
                  value: "ΔP",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 8, fill: "#64748b" },
                }}
              />
              <ReferenceLine x={0} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.7} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeOpacity={0.5} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as { x?: number; y?: number; ticker?: string; window?: string };
                  return (
                    <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                      <p className="font-semibold">
                        {p.ticker ?? "—"} · EIS {p.x?.toFixed(2)}
                      </p>
                      <p>ΔP {fmtPp(p.y)}</p>
                      {p.window ? <p className="text-ink-muted">{p.window} pre-CD</p> : null}
                    </div>
                  );
                }}
              />
              <Scatter data={points} fill={dotColor} fillOpacity={0.5} />
              <Line
                data={line}
                type="linear"
                dataKey="y"
                stroke={lineColor}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ViewErrorBoundary>
      </div>
      {lineOnly ? (
        <p className="text-[9px] text-ink-muted italic">{t("modelLab.qc.eisMagnitude.scatterLineOnly")}</p>
      ) : null}
      <p className="text-[9px] tabular-nums text-ink-muted">
        {t("modelLab.qc.eisMagnitude.regressionMeta", {
          slope: fmtSlope(reg?.slope),
          r: fmtCorr(reg?.r),
          n: String(reg?.n ?? bundle?.n_total ?? 0),
        })}
      </p>
    </div>
  );
}
