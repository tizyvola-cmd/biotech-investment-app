import { useEffect, useMemo, useState } from "react";
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
import { renderCdZones } from "../sheet/chartCdZones";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import {
  holdingDayFractionFromInvestedAt,
  holdingDaysFromInvestedAt,
  resolveInvestedAt,
} from "../sheet/investSimStorage";
import type { ChartPoint } from "../types";
import { plannedGainEurFromRecalibCurve } from "../sheet/predictionCurveDailyRecalib";
import { POST_CD_GAIN_EXTENSION_DAYS } from "../sheet/chartNodes";
import { resolveExpectedGainPlan } from "../sheet/simulationPlanGain";
import { computeSimulationPosition } from "../sheet/simulationPosition";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { completionDateToNowOffset, interpolateAtOffset } from "../sheet/chartNowOffset";
import { buildMtmBackfillActualAnchors } from "../sheet/pulseMtmBackfill";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { useLang, useT } from "../shared/i18n";

export type PortfolioGainChartRow = {
  key: string;
  name: string;
  ticker: string;
  pnlEur: number | null;
  pnlUnavailable: boolean;
  /** Delta giornaliero — allineato alle barre P&L sopra (scope Today). */
  pnlEurToday?: number | null;
  pnlPctToday?: number | null;
  hasToday?: boolean;
  investedAt: string | null;
  expectedHoldDays: number | null;
  /** Giorni da oggi al target piano (≠ CD). */
  daysToTarget: number | null;
  expectedGainEur: number | null;
  expectedGainPct: number | null;
  targetGainPct?: number | null;
  holdDaysElapsed: number | null;
  capital: number;
  currentPriceUsd?: number | null;
  buyPriceUsd?: number | null;
  valueNow?: number;
  /** Simulation row + chart bundle for recalibrated planned curve. */
  simRow?: Record<string, unknown>;
  chartPoints?: ChartPoint[] | null;
};

function roundDayKey(d: number): number {
  return Math.round(d * 1000) / 1000;
}

function collectSeriesDays(
  maxDay: number,
  anchors: Map<number, number>,
  minDay = 0,
  extraAnchors?: Map<number, number>,
): number[] {
  const set = new Set<number>();
  for (let d = minDay; d <= Math.ceil(maxDay); d++) set.add(d);
  for (const m of [anchors, extraAnchors]) {
    if (!m) continue;
    for (const d of m.keys()) {
      if (d >= minDay - 0.001 && d <= maxDay + 0.001) set.add(roundDayKey(d));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function interpolateAnchors(day: number, anchors: Map<number, number>): number | null {
  if (!anchors.size) return null;
  const keys = [...anchors.keys()].sort((a, b) => a - b);
  if (day <= keys[0]) return anchors.get(keys[0]) ?? null;
  if (day >= keys[keys.length - 1]) return anchors.get(keys[keys.length - 1]) ?? null;
  for (let i = 0; i < keys.length - 1; i++) {
    const d0 = keys[i];
    const d1 = keys[i + 1];
    if (day >= d0 && day <= d1) {
      const v0 = anchors.get(d0)!;
      const v1 = anchors.get(d1)!;
      const t = d1 === d0 ? 0 : (day - d0) / (d1 - d0);
      return Math.round((v0 + t * (v1 - v0)) * 100) / 100;
    }
  }
  return null;
}

/** Anchor points P&L realizzato (entry + history + chart daily MTM + oggi). */
function buildActualAnchors(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[],
  todayDay: number,
  livePnl: number | null,
): Map<number, number> {
  return buildMtmBackfillActualAnchors(row, history, todayDay, livePnl);
}

export type GainPlanPoint = {
  day: number;
  planned: number | null;
  actual: number | null;
  /** Pre-entry stock path (€) for hypothetical opportunities — mark-to-market at entry price. */
  historical: number | null;
};

const HISTORICAL_LOOKBACK_DAYS = 30;

function chartPriceAtOffset(chartPoints: ChartPoint[], offset: number): number | null {
  const series = chartPoints
    .map((p) => ({
      offset: p.offset,
      y: (p.price_storico_usd ?? p.price_usd) as number | null | undefined,
    }))
    .filter((p) => p.y != null && Number.isFinite(p.y)) as { offset: number; y: number }[];
  if (!series.length) return null;
  return interpolateAtOffset(series, offset);
}

/** € gain if entry at past price, valued at today's price (plan capital). */
function buildHistoricalLookbackAnchors(row: PortfolioGainChartRow): Map<number, number> {
  const anchors = new Map<number, number>();
  if (row.investedAt?.trim()) return anchors;

  const pts = row.chartPoints;
  const capital = row.capital;
  const simRow = row.simRow;
  if (!pts?.length || !simRow || capital <= 0) return anchors;

  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return anchors;

  const entryPrice =
    row.currentPriceUsd ?? chartPriceAtOffset(pts, nowOff);
  if (entryPrice == null || entryPrice <= 0) return anchors;

  anchors.set(0, 0);

  const lookbackStart = Math.max(-60, nowOff - HISTORICAL_LOOKBACK_DAYS);
  for (const p of pts) {
    if (p.offset >= nowOff - 0.01 || p.offset < lookbackStart - 0.01) continue;
    const histPrice = p.price_storico_usd ?? p.price_usd;
    if (histPrice == null || !Number.isFinite(histPrice) || histPrice <= 0) continue;

    const daysBeforeEntry = roundDayKey(nowOff - p.offset);
    if (daysBeforeEntry <= 0.001) continue;
    const dayAxis = roundDayKey(-daysBeforeEntry);
    const shares = capital / histPrice;
    const gain = Math.round((shares * entryPrice - capital) * 100) / 100;
    anchors.set(dayAxis, gain);
  }

  return anchors;
}

/** Build day-series: linear planned ramp to expected gain; actual from history + live mark-to-market. */
export function buildGainPlanSeries(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[]
): GainPlanPoint[] {
  const investedAtIso = row.investedAt?.trim() || null;
  const todayDay =
    (investedAtIso ? holdingDayFractionFromInvestedAt(investedAtIso) : null) ??
    row.holdDaysElapsed ??
    0;
  const todayDayCal =
    investedAtIso != null ? holdingDaysFromInvestedAt(investedAtIso) : Math.round(todayDay);
  const planDays = row.expectedHoldDays ?? todayDayCal ?? Math.ceil(todayDay);
  const postCdHorizon =
    row.expectedHoldDays != null && Number.isFinite(row.expectedHoldDays)
      ? row.expectedHoldDays + POST_CD_GAIN_EXTENSION_DAYS
      : null;
  const maxDay = Math.max(todayDay, planDays, postCdHorizon ?? 0, 1);

  const livePnl =
    !row.pnlUnavailable && row.pnlEur != null && Number.isFinite(row.pnlEur)
      ? Math.round(row.pnlEur * 100) / 100
      : null;

  const anchors = buildActualAnchors(row, history, todayDay, livePnl);
  const historicalAnchors = buildHistoricalLookbackAnchors(row);
  const hasHistorical = historicalAnchors.size > 1;
  const actualEndDay = anchors.size > 0 ? Math.max(todayDay, 0.01) : todayDay;
  const holdDaysForRecalib = todayDay;

  const plannedEnd = row.expectedGainEur;
  const plannedSpan = planDays > 0 ? planDays : maxDay;
  const useRecalibPlan = Boolean(row.simRow && row.chartPoints?.length);

  let minDay = 0;
  if (hasHistorical) {
    const neg = [...historicalAnchors.keys()].filter((d) => d < 0);
    if (neg.length) minDay = Math.min(...neg);
  }

  const seriesDays = collectSeriesDays(maxDay, anchors, minDay, historicalAnchors);
  const out: GainPlanPoint[] = [];
  for (const day of seriesDays) {
    let planned: number | null = null;
    if (day >= 0 && useRecalibPlan && row.simRow) {
      planned = plannedGainEurFromRecalibCurve(
        row.simRow,
        row.chartPoints,
        row.capital,
        holdDaysForRecalib,
        day,
      );
    } else if (day >= 0 && plannedEnd != null && Number.isFinite(plannedEnd)) {
      planned = Math.round((day / plannedSpan) * plannedEnd * 100) / 100;
    }
    const actual =
      !hasHistorical &&
      day <= actualEndDay + 0.001 &&
      day >= 0 &&
      anchors.size > 0
        ? interpolateAnchors(day, anchors)
        : null;
    const historical =
      day <= 0.001 && hasHistorical ? interpolateAnchors(day, historicalAnchors) : null;
    out.push({ day, planned, actual, historical });
  }
  return out;
}

function gainPlanRowName(ticker: string, cd: string): string {
  return cd && cd !== "—" ? `${ticker} · ${cd}` : ticker;
}

/** Open-position row for gain vs plan charts (P&L tab, loss analysis cards). */
export function buildPortfolioGainPlanRowFromSim(
  key: string,
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[],
  chartPoints?: ChartPoint[] | null,
): PortfolioGainChartRow | null {
  const pos = computeSimulationPosition(row, inputs, { history });
  if (!pos || pos.capital <= 0) return null;
  const investedAt = resolveInvestedAt(key, inputs[key], history);
  const holdDaysElapsed = investedAt ? holdingDaysFromInvestedAt(investedAt) : null;
  const gainPlan = resolveExpectedGainPlan(row, pos.capital, { chartPoints: chartPoints ?? null });
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "—");
  return {
    key,
    name: gainPlanRowName(ticker, cd),
    ticker,
    pnlEur: pos.pnlUnavailable ? null : pos.pnlEur,
    pnlUnavailable: pos.pnlUnavailable,
    investedAt,
    expectedHoldDays: gainPlan.daysToCd,
    daysToTarget: gainPlan.daysToTarget ?? null,
    expectedGainEur: gainPlan.expectedGainEur,
    expectedGainPct: gainPlan.expectedReturnPct,
    targetGainPct: gainPlan.targetReturnPct,
    holdDaysElapsed,
    capital: pos.capital,
    currentPriceUsd: pos.currPrice,
    buyPriceUsd: pos.buyPrice > 0 ? pos.buyPrice : null,
    valueNow: pos.valueNow,
    simRow: row,
    chartPoints: chartPoints ?? null,
  };
}

/** Hypothetical entry today — for off-portfolio opportunity cards. */
export function buildHypotheticalGainPlanRow(
  key: string,
  row: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null,
  capitalEur = DEFAULT_PLAN_CAPITAL_EUR,
): PortfolioGainChartRow | null {
  const gainPlan = resolveExpectedGainPlan(row, capitalEur, { chartPoints: chartPoints ?? null });
  const hasRecalib = Boolean(chartPoints?.length);
  if (
    !hasRecalib &&
    gainPlan.expectedGainEur == null &&
    gainPlan.expectedReturnPct == null &&
    gainPlan.daysToCd == null
  ) {
    return null;
  }
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "—");
  const priceRaw = row["Current Price"] ?? row.Price;
  const currentPriceUsd =
    priceRaw != null && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
  return {
    key,
    name: gainPlanRowName(ticker, cd),
    ticker,
    pnlEur: 0,
    pnlUnavailable: false,
    investedAt: null,
    expectedHoldDays: gainPlan.daysToCd,
    daysToTarget: gainPlan.daysToTarget ?? null,
    expectedGainEur: gainPlan.expectedGainEur,
    expectedGainPct: gainPlan.expectedReturnPct,
    targetGainPct: gainPlan.targetReturnPct,
    holdDaysElapsed: 0,
    capital: capitalEur,
    currentPriceUsd,
    buyPriceUsd: currentPriceUsd,
    simRow: row,
    chartPoints: chartPoints ?? null,
  };
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}€ ${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$ ${v.toFixed(2)}`;
}

const GAIN_PLANNED_COLOR = "#6366f1";
const GAIN_ACTUAL_COLOR = "#00B050";
const GAIN_HISTORICAL_COLOR = "#0d9488";

function gainTooltipColor(dataKey: string): string {
  if (dataKey === "historical") return GAIN_HISTORICAL_COLOR;
  if (dataKey === "actual") return GAIN_ACTUAL_COLOR;
  return GAIN_PLANNED_COLOR;
}

function GainTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; name: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/60 bg-surface-elevated px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-semibold text-ink mb-1">Day {label}</p>
      {payload.map((p) => (
        <p
          key={p.dataKey}
          className="tabular-nums font-semibold"
          style={{ color: gainTooltipColor(p.dataKey) }}
        >
          {p.name}: {fmtEur(p.value)}
        </p>
      ))}
    </div>
  );
}

export function PortfolioGainPlanSingleChart({
  row,
  history,
  compact = false,
  embedded = false,
  height,
  hideLegend = false,
  planMarkerLabel,
}: {
  row: PortfolioGainChartRow;
  history: InvestSimHistoryPoint[];
  /** Compact layout for 24h assessment company card. */
  compact?: boolean;
  /** Same footprint as Pred / Slope / MII tiles in loss-analysis card. */
  embedded?: boolean;
  height?: number;
  hideLegend?: boolean;
  /** Override «Planned exit» marker (e.g. recovery horizon). */
  planMarkerLabel?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const cardTile = embedded || compact;

  const series = useMemo(() => buildGainPlanSeries(row, history), [row, history]);
  const isHypothetical = !row.investedAt?.trim();
  const hasHistorical = useMemo(
    () => series.some((p) => p.historical != null && Number.isFinite(p.historical)),
    [series],
  );
  const minDay = useMemo(() => {
    let m = 0;
    for (const p of series) m = Math.min(m, p.day);
    return m;
  }, [series]);
  const maxDay = useMemo(() => {
    let m = 0;
    for (const p of series) m = Math.max(m, p.day);
    return m;
  }, [series]);

  const yDomain = useMemo((): [number, number] => {
    let min = 0;
    let max = 0;
    for (const p of series) {
      for (const v of [p.planned, p.actual, p.historical]) {
        if (v == null || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (min === max) {
      const pad = Math.max(cardTile ? 120 : 500, Math.abs(max) * 0.15);
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.12 || (cardTile ? 120 : 500);
    return [min - pad, max + pad];
  }, [series, cardTile]);

  const todayDay =
    (row.investedAt ? holdingDayFractionFromInvestedAt(row.investedAt) : null) ??
    row.holdDaysElapsed ??
    null;
  const todayDayCal =
    row.investedAt != null
      ? holdingDaysFromInvestedAt(row.investedAt)
      : todayDay != null
        ? Math.round(todayDay)
        : null;
  const planDays = row.daysToTarget ?? row.expectedHoldDays ?? null;
  const chartHeight = height ?? (embedded ? 200 : compact ? 220 : 320);
  const tileMode = embedded && hideLegend;

  return (
    <div className={tileMode ? "h-full w-full min-h-0" : cardTile ? "space-y-1.5" : "space-y-3"}>
      {!embedded ? (
      <div className={`flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted tabular-nums ${compact ? "text-[10px]" : ""}`}>
        <span>
          Capital <strong className="text-ink">€{row.capital.toLocaleString("en-US")}</strong>
        </span>
        {row.currentPriceUsd != null && (
          <span>
            Stock now <strong className="text-ink">{fmtUsd(row.currentPriceUsd)}</strong>
            {row.buyPriceUsd != null && (
              <span className="opacity-75"> · buy {fmtUsd(row.buyPriceUsd)}</span>
            )}
          </span>
        )}
        {row.valueNow != null && row.valueNow > 0 && (
          <span>
            Position value <strong className="text-ink">{fmtEur(row.valueNow)}</strong>
          </span>
        )}
        {row.holdDaysElapsed != null && (
          <span>
            Held <strong className="text-ink">{Math.round(row.holdDaysElapsed)}d</strong>
          </span>
        )}
        {planDays != null && (
          <span>
            Plan horizon <strong className="text-ink">{planDays}d</strong>
          </span>
        )}
        {row.expectedGainEur != null && (
          <span>
            Target gain <strong className="text-ink">{fmtEur(row.expectedGainEur)}</strong>
            {(row.targetGainPct ?? row.expectedGainPct) != null && (
              <span className="opacity-75">
                {" "}
                (
                {row.targetGainPct != null
                  ? `tgt ${row.targetGainPct >= 0 ? "+" : ""}${row.targetGainPct.toFixed(1)}%`
                  : `CD ${row.expectedGainPct! >= 0 ? "+" : ""}${row.expectedGainPct!.toFixed(1)}%`}
                )
              </span>
            )}
          </span>
        )}
        {row.pnlEur != null && (
          <span>
            {t("sim.gainPlan.actualTotal")}{" "}
            <strong
              className={
                row.pnlEur >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]"
              }
            >
              {fmtEur(row.pnlEur)}
            </strong>
          </span>
        )}
        {row.hasToday && row.pnlEurToday != null ? (
          <span>
            {t("sim.gainPlan.actualToday")}{" "}
            <strong
              className={
                row.pnlEurToday >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]"
              }
            >
              {fmtEur(row.pnlEurToday)}
              {row.pnlPctToday != null && Number.isFinite(row.pnlPctToday)
                ? ` (${row.pnlPctToday >= 0 ? "+" : ""}${row.pnlPctToday.toFixed(2)}%)`
                : ""}
            </strong>
          </span>
        ) : null}
      </div>
      ) : null}

      <div className={tileMode ? "h-full w-full" : "w-full"} style={tileMode ? undefined : { height: chartHeight }}>
        <ResponsiveContainer width="100%" height={tileMode ? "100%" : chartHeight}>
          <LineChart
            data={series}
            margin={{
              top: embedded ? 10 : compact ? 8 : 12,
              right: embedded ? 8 : compact ? 12 : 20,
              left: embedded ? 0 : 4,
              bottom: embedded ? 0 : compact ? 4 : 8,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            {planDays != null && planDays > 0 && maxDay > planDays
              ? renderCdZones({ cdX: planDays, xMin: minDay, xMax: maxDay })
              : null}
            <XAxis
              dataKey="day"
              type="number"
              domain={[minDay, "dataMax"]}
              tick={{ fontSize: embedded ? 9 : compact ? 10 : 11 }}
              tickCount={embedded ? 5 : undefined}
              label={
                compact && !embedded
                  ? undefined
                  : !cardTile
                    ? {
                        value: isHypothetical && hasHistorical
                          ? it
                            ? "Giorni (negativo = prima dell'ingresso)"
                            : "Days (negative = before entry)"
                          : "Days since entry",
                        position: "insideBottom",
                        offset: -2,
                        fontSize: 10,
                      }
                    : undefined
              }
            />
            <YAxis
              tick={{ fontSize: embedded ? 9 : compact ? 10 : 11 }}
              domain={yDomain}
              width={embedded ? 42 : compact ? 48 : 56}
              tickFormatter={(v) => {
                const n = Number(v);
                if (embedded && Math.abs(n) >= 1000) {
                  return `€${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
                }
                return `€${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
              }}
              label={
                compact
                  ? undefined
                  : {
                      value: "Capital gained €",
                      angle: -90,
                      position: "insideLeft",
                      offset: 12,
                      fontSize: 10,
                    }
              }
            />
            <Tooltip content={<GainTooltip />} />
            {!cardTile ? <Legend /> : null}
            <ReferenceLine y={0} stroke="rgba(120,120,120,0.45)" strokeDasharray="4 4" />
            {isHypothetical && hasHistorical ? (
              <ReferenceLine
                x={0}
                stroke="rgb(var(--accent))"
                strokeDasharray="4 3"
                label={{
                  value: it ? "Ingresso oggi" : "Entry today",
                  position: "insideTop",
                  fontSize: 9,
                  fill: "rgb(var(--accent))",
                }}
              />
            ) : null}
            {todayDayCal != null && todayDayCal > 0 ? (
              <ReferenceLine
                x={todayDay ?? todayDayCal}
                stroke="#dc2626"
                strokeWidth={1.75}
                strokeDasharray="5 3"
                label={{
                  value: "TODAY",
                  position: "top",
                  fontSize: 10,
                  fontWeight: 800,
                  fill: "#dc2626",
                  letterSpacing: "0.06em",
                  offset: 4,
                }}
              />
            ) : null}
            {planDays != null && planDays > 0 && planDays !== todayDayCal ? (
              <ReferenceLine
                x={planDays}
                stroke="rgba(120,120,120,0.5)"
                strokeDasharray="2 4"
                label={{
                  value: planMarkerLabel ?? (compact ? "Plan" : "Planned exit"),
                  position: "insideTopLeft",
                  fontSize: 9,
                  fill: "rgb(var(--ink-muted))",
                }}
              />
            ) : null}
            <Line
              type="monotone"
              dataKey="planned"
              name={
                it
                  ? "Piano ricalib. (curva prediction)"
                  : "Planned gain (recalibrated curve)"
              }
              stroke={GAIN_PLANNED_COLOR}
              strokeWidth={embedded ? 1.75 : 2}
              strokeDasharray="6 4"
              dot={false}
              connectNulls
            />
            {hasHistorical ? (
              <Line
                type="monotone"
                dataKey="historical"
                name={t("sim.gainPlan.historicalCurve")}
                stroke={GAIN_HISTORICAL_COLOR}
                strokeWidth={embedded ? 2 : 2.5}
                dot={false}
                connectNulls
              />
            ) : null}
            {!isHypothetical || !hasHistorical ? (
              <Line
                type="monotone"
                dataKey="actual"
                name={it ? "Gain reale" : "Actual gain"}
                stroke={GAIN_ACTUAL_COLOR}
                strokeWidth={embedded ? 2 : 2.5}
                dot={(props) => {
                  const { cx, cy, index, payload } = props as {
                    cx?: number;
                    cy?: number;
                    index?: number;
                    payload?: GainPlanPoint;
                  };
                  if (cx == null || cy == null || payload?.actual == null) {
                    return <g key={`actual-dot-empty-${index ?? "x"}`} />;
                  }
                  const isEnd =
                    index != null &&
                    (index === series.length - 1 || series[index + 1]?.actual == null);
                  const isStart = index === 0;
                  if (!isStart && !isEnd && (todayDay == null || todayDay > 3)) {
                    return <g key={`actual-dot-skip-${index}`} />;
                  }
                  return (
                    <circle
                      key={`actual-dot-${index}`}
                      cx={cx}
                      cy={cy}
                      r={isEnd ? 4 : 3}
                      fill={GAIN_ACTUAL_COLOR}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                  );
                }}
                activeDot={{ r: 5, fill: GAIN_ACTUAL_COLOR }}
                connectNulls={false}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {embedded && !hideLegend ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-[#6366f1] opacity-90" style={{ backgroundImage: "repeating-linear-gradient(90deg, #6366f1 0 3px, transparent 3px 5px)" }} />
            {it ? "Piano ricalib." : "Planned"}
          </span>
          {hasHistorical ? (
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 rounded bg-[#0d9488]" />
              {t("sim.gainPlan.historicalCurveShort")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 rounded bg-[#00B050]" />
              {it ? "Reale" : "Actual"}
            </span>
          )}
        </div>
      ) : compact ? (
        <p className="text-[9px] text-ink-muted leading-snug">
          {t("sim.gainPlan.desc")}
        </p>
      ) : null}
    </div>
  );
}

function fmtChipEur(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}€`;
}

function gainPlanChipTitle(
  row: PortfolioGainChartRow,
  totalLabel: string,
  todayLabel: string,
): string {
  const parts = [row.name];
  if (row.pnlEur != null) {
    parts.push(`${totalLabel}: ${fmtChipEur(row.pnlEur)}`);
  }
  if (row.hasToday && row.pnlEurToday != null) {
    const pct =
      row.pnlPctToday != null && Number.isFinite(row.pnlPctToday)
        ? ` (${row.pnlPctToday >= 0 ? "+" : ""}${row.pnlPctToday.toFixed(2)}%)`
        : "";
    parts.push(`${todayLabel}: ${fmtChipEur(row.pnlEurToday)}${pct}`);
  }
  return parts.join(" · ");
}

export function PortfolioGainPlanChart({
  rows,
  history,
}: {
  rows: PortfolioGainChartRow[];
  history: InvestSimHistoryPoint[];
}) {
  const t = useT();
  const selectable = useMemo(
    () => rows.filter((r) => !r.pnlUnavailable && r.capital > 0),
    [rows]
  );

  const [selectedKey, setSelectedKey] = useState("");

  useEffect(() => {
    if (!selectable.length) {
      setSelectedKey("");
      return;
    }
    if (!selectable.some((r) => r.key === selectedKey)) {
      setSelectedKey(selectable[0].key);
    }
  }, [selectable, selectedKey]);

  const selected = useMemo(
    () => selectable.find((r) => r.key === selectedKey) ?? null,
    [selectable, selectedKey]
  );

  if (!selectable.length) {
    return (
      <p className="text-sm text-ink-muted text-center py-6">
        {t("sim.gainPlan.empty")}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/20 p-3 space-y-3">
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t("sim.gainPlan.title")}</h3>
          <p className="text-[10px] text-ink-muted mt-0.5 leading-snug max-w-xl">
            {t("sim.gainPlan.desc")}
          </p>
        </div>
        <SelectionChipGroup className="gap-1.5">
          {selectable.map((r) => {
            const active = selectedKey === r.key;
            const pnl = r.pnlEur;
            const todayPnl = r.hasToday ? r.pnlEurToday : null;
            return (
              <SelectionChip
                key={r.key}
                active={active}
                onClick={() => setSelectedKey(r.key)}
                title={gainPlanChipTitle(r, t("sim.gainPlan.chipTotal"), t("sim.gainPlan.chipToday"))}
                className="tabular-nums font-semibold"
              >
                {r.ticker}
                {pnl != null && (
                  <span
                    className={`ml-1 font-normal text-[10px] ${
                      active
                        ? ""
                        : pnl >= 0
                          ? "text-[rgb(var(--signal-up))]"
                          : "text-[rgb(var(--signal-down))]"
                    }`}
                  >
                    {fmtChipEur(pnl)}
                    <span className="opacity-70 font-normal"> {t("sim.gainPlan.chipTotalShort")}</span>
                  </span>
                )}
                {todayPnl != null && Number.isFinite(todayPnl) ? (
                  <span
                    className={`ml-0.5 font-normal text-[10px] ${
                      active
                        ? "opacity-90"
                        : todayPnl >= 0
                          ? "text-[rgb(var(--signal-up))]"
                          : "text-[rgb(var(--signal-down))]"
                    }`}
                  >
                    · {fmtChipEur(todayPnl)} {t("sim.gainPlan.chipTodayShort")}
                  </span>
                ) : null}
              </SelectionChip>
            );
          })}
        </SelectionChipGroup>
      </div>

      {selected ? <PortfolioGainPlanSingleChart row={selected} history={history} /> : null}
    </div>
  );
}
