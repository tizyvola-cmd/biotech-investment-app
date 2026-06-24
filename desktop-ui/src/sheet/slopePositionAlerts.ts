import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { extractCurveInputs } from "./precatCurve";
import { readPred5Pp } from "./simulationPlanGain";
import {
  isMaterialSlopePriceGap,
  resolveSlopeCapitalImpact,
  resolveSlopeStockPrices,
} from "./slopeStockPrices";
import { activePortfolioCdsFromInputs } from "./cdLifecycle";
import { daysFromToday } from "./simulationPlanGain";
import { rowHasActivePortfolio } from "./simulationPosition";
import {
  classifySlopeEventKind,
  slopeDeltaPpPerDay,
  SLOPE_STRONG_RISE_DELTA_MIN,
  SLOPE_STRONG_RISE_SLOPE20,
  SLOPE_STRONG_RISE_SLOPE5,
} from "./slopeThresholds";
import type { InvestSimInputs } from "./investSimStorage";
import { buildPickSignalsFromSimTable } from "./top2FromSimulation";
import { buildUnifiedSlopeFeed, type UnifiedSlopeFeedRow } from "./slopeEventsFeed";
import {
  ALERT_KIND_PRIORITY,
  compareSlopeAlertKind,
  eventImpactAbs,
  feedKindToAlertKind,
  type SlopeAlertKind,
} from "./slopeErrorRank";
import { slopesFromFeedRow } from "./slopeEventSummary";

/** Massimo errori (inversione / decel / contrarian) nel banner compatto. */
export const SLOPE_BANNER_MAX_ERRORS = 5;
/** Massimo accelerazioni / slope ↑ nel banner compatto. */
export const SLOPE_BANNER_MAX_ACCEL = 2;
/** @deprecated Usare SLOPE_BANNER_MAX_ERRORS. */
export const SLOPE_BANNER_MAX = SLOPE_BANNER_MAX_ERRORS;

export type SlopeAlertRow = {
  ticker: string;
  cd: string;
  days: number | null;
  kind: SlopeAlertKind;
  slope5d: number;
  slope20d: number;
  delta: number;
  /** Magnitudine per tie-break (|Δ| o impatto feed). */
  impact: number;
  /** Perdita € sul capitale vs modello T+5 (posizione aperta). */
  capitalLossEur: number | null;
  positionPnlEur: number | null;
  capitalEur: number | null;
};

function findCol(cols: string[], kw: string): string | undefined {
  const k = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(k));
}

function openPortfolioTickers(
  simTable: SheetTable,
  inputs: InvestSimInputs,
): Set<string> {
  const cols =
    simTable.columns?.length
      ? simTable.columns
      : Object.keys(simTable.rows[0] ?? {});
  const colTicker = findCol(cols, "Ticker") ?? "Ticker";
  const out = new Set<string>();
  for (const row of simTable.rows) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const tk = String(row[colTicker] ?? "").trim().toUpperCase();
    if (tk) out.add(tk);
  }
  for (const ref of activePortfolioCdsFromInputs(inputs)) {
    out.add(ref.ticker);
  }
  return out;
}

function capitalFieldsFromRow(
  simRow: Record<string, unknown> | undefined,
  chartPoints: ChartPoint[] | null | undefined,
  inputs: InvestSimInputs | undefined,
): Pick<SlopeAlertRow, "capitalLossEur" | "positionPnlEur" | "capitalEur"> {
  if (!simRow || !inputs) {
    return { capitalLossEur: null, positionPnlEur: null, capitalEur: null };
  }
  const { actual, expected } = resolveSlopeStockPrices(simRow, chartPoints, null);
  const cap = resolveSlopeCapitalImpact(simRow, inputs, actual, expected);
  return {
    capitalLossEur: cap.modelGapLossEur,
    positionPnlEur: cap.positionPnlEur,
    capitalEur: cap.capitalEur,
  };
}

function alertFromSlopes(
  ticker: string,
  cd: string,
  days: number | null,
  slope5d: number,
  slope20d: number,
  simRow?: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null,
  inputs?: InvestSimInputs,
): SlopeAlertRow | null {
  const kind = classifySlopeEventKind(slope5d, slope20d);
  if (!kind) return null;

  if (simRow) {
    const { actual, expected } = resolveSlopeStockPrices(simRow, chartPoints, null);
    if (!isMaterialSlopePriceGap(actual, expected)) return null;
  }

  const capFields = capitalFieldsFromRow(simRow, chartPoints, inputs);
  const delta = slopeDeltaPpPerDay(slope5d, slope20d);
  if (kind === "slope_rev") {
    const impact = Math.max(Math.abs(slope5d), Math.abs(slope20d));
    return {
      ticker,
      cd,
      days,
      kind: "reversal",
      slope5d,
      slope20d,
      delta,
      impact,
      ...capFields,
    };
  }
  if (kind === "slope_dec") {
    return {
      ticker,
      cd,
      days,
      kind: "deceleration",
      slope5d,
      slope20d,
      delta,
      impact: Math.abs(delta),
      ...capFields,
    };
  }
  const strongRise =
    slope5d >= SLOPE_STRONG_RISE_SLOPE5 &&
    slope20d >= SLOPE_STRONG_RISE_SLOPE20 &&
    delta >= SLOPE_STRONG_RISE_DELTA_MIN &&
    delta < 0.8;
  return {
    ticker,
    cd,
    days,
    kind: "acceleration",
    slope5d,
    slope20d,
    delta,
    impact: strongRise ? slope5d + Math.max(0, delta) : Math.abs(delta),
    ...capFields,
  };
}

function alertFromFeedRow(
  row: UnifiedSlopeFeedRow,
  simRow?: Record<string, unknown> | null,
  chartPoints?: ChartPoint[] | null,
  inputs?: InvestSimInputs,
): SlopeAlertRow | null {
  const kind = feedKindToAlertKind(row.kind);
  if (!kind) return null;

  if (simRow) {
    const { actual, expected } = resolveSlopeStockPrices(simRow, chartPoints, row);
    if (!isMaterialSlopePriceGap(actual, expected)) return null;
  }
  const { slope5d, slope20d, delta } = slopesFromFeedRow(row);
  if (slope5d == null) return null;
  const s5 = slope5d;
  const s20 = slope20d ?? s5;
  const d = delta ?? s5 - s20;
  const capFields = capitalFieldsFromRow(simRow ?? undefined, chartPoints, inputs);
  return {
    ticker: row.ticker,
    cd: row.cd,
    days: daysFromToday(row.cd),
    kind,
    slope5d: s5,
    slope20d: s20,
    delta: d,
    impact: eventImpactAbs(row),
    ...capFields,
  };
}

function mergeAlertsByTicker(alerts: SlopeAlertRow[]): SlopeAlertRow[] {
  const byTicker = new Map<string, SlopeAlertRow>();
  for (const a of alerts) {
    const key = a.ticker.toUpperCase();
    const prev = byTicker.get(key);
    if (
      !prev ||
      compareSlopeAlertKind(a.kind, prev.kind, a.impact, prev.impact) > 0
    ) {
      byTicker.set(key, a);
    }
  }
  return [...byTicker.values()];
}

function simContextByTicker(
  simTable: SheetTable,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
): Map<string, { simRow: Record<string, unknown>; chartPts: ChartPoint[] | null }> {
  const cols =
    simTable.columns?.length ? simTable.columns : Object.keys(simTable.rows[0] ?? {});
  const colTicker = findCol(cols, "Ticker") ?? "Ticker";
  const out = new Map<string, { simRow: Record<string, unknown>; chartPts: ChartPoint[] | null }>();
  for (const row of simTable.rows) {
    const tk = String(row[colTicker] ?? "").trim().toUpperCase();
    if (!tk) continue;
    const sk = simulationRowSeriesKey(row);
    const chartPts = sk && chartPointsBySeriesKey ? chartPointsBySeriesKey.get(sk) ?? null : null;
    out.set(tk, { simRow: row, chartPts });
  }
  return out;
}

/** Eventi dal log slope/contrarian per ticker in portafoglio. */
export function buildSlopePositionAlertsFromFeed(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
): SlopeAlertRow[] {
  if (!simTable?.rows?.length) return [];
  const open = openPortfolioTickers(simTable, inputs);
  if (!open.size) return [];
  const ctx = simContextByTicker(simTable, chartPointsBySeriesKey);
  const feed = buildUnifiedSlopeFeed();
  return feed
    .filter((r) => open.has(r.ticker.toUpperCase()))
    .map((r) => {
      const c = ctx.get(r.ticker.toUpperCase());
      return alertFromFeedRow(r, c?.simRow, c?.chartPts, inputs);
    })
    .filter((a): a is SlopeAlertRow => a != null);
}

/** Slope ERROR su posizioni aperte — stessa pipeline del banner Segnali attivi. */
export function buildSlopePositionAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
): SlopeAlertRow[] {
  if (!simTable?.rows?.length) return [];
  const picks = buildPickSignalsFromSimTable(simTable, inputs, chartPointsBySeriesKey);
  const signals = picks
    .filter((p) => p.hasPosition && p.simRow)
    .map((p) => ({
      hasPosition: true as const,
      ticker: p.ticker,
      cd: p.cd,
      days: p.days ?? null,
      simRow: p.simRow as Record<string, unknown>,
    }));
  return buildSlopeAlertsFromSignalRows(signals, chartPointsBySeriesKey, inputs);
}

/** Solo errori (no accelerazione) — max N, ranking unificato tipo poi |Δ|. */
export function prioritizeSlopeErrors(
  alerts: SlopeAlertRow[],
  max = SLOPE_BANNER_MAX_ERRORS,
): SlopeAlertRow[] {
  return alerts
    .filter((a) => a.kind !== "acceleration")
    .sort((a, b) => compareSlopeAlertKind(b.kind, a.kind, b.impact, a.impact))
    .slice(0, max);
}

export type SlopeBannerSlice = {
  /** Righe da mostrare (errori poi accelerazioni). */
  shown: SlopeAlertRow[];
  errorRows: SlopeAlertRow[];
  accelRows: SlopeAlertRow[];
  hiddenErrors: number;
  hiddenAccels: number;
  totalErrors: number;
  totalAccels: number;
};

/** Top errori + top slope ↑ per banner (compatto o pannello inline). */
export function sliceSlopeAlertsForBanner(
  alerts: SlopeAlertRow[],
  maxErrors = SLOPE_BANNER_MAX_ERRORS,
  maxAccel = SLOPE_BANNER_MAX_ACCEL,
): SlopeBannerSlice {
  const errors = alerts
    .filter((a) => a.kind !== "acceleration")
    .sort((a, b) => compareSlopeAlertKind(b.kind, a.kind, b.impact, a.impact));
  const accels = alerts
    .filter((a) => a.kind === "acceleration")
    .sort((a, b) => b.impact - a.impact || b.slope5d - a.slope5d);

  const errorRows = errors.slice(0, maxErrors);
  const accelRows = accels.slice(0, maxAccel);
  return {
    shown: [...errorRows, ...accelRows],
    errorRows,
    accelRows,
    hiddenErrors: Math.max(0, errors.length - errorRows.length),
    hiddenAccels: Math.max(0, accels.length - accelRows.length),
    totalErrors: errors.length,
    totalAccels: accels.length,
  };
}

/** Da righe segnale già calcolate (InvestmentSignalsPanel). */
export function buildSlopeAlertsFromSignalRows(
  signals: Array<{
    hasPosition: boolean;
    ticker: string;
    cd: string;
    days: number | null;
    simRow: Record<string, unknown>;
  }>,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
  inputs?: InvestSimInputs,
): SlopeAlertRow[] {
  const fromSheet: SlopeAlertRow[] = [];
  for (const s of signals) {
    if (!s.hasPosition) continue;
    const { slope5d, slope20d } = extractCurveInputs(s.simRow);
    if (slope5d == null || slope20d == null) continue;
    const sk = simulationRowSeriesKey(s.simRow);
    const chartPts =
      sk && chartPointsBySeriesKey ? chartPointsBySeriesKey.get(sk) ?? null : null;
    const row = alertFromSlopes(
      s.ticker,
      s.cd,
      s.days,
      slope5d,
      slope20d,
      s.simRow,
      chartPts,
      inputs,
    );
    if (row) fromSheet.push(row);

    const pred5 = readPred5Pp(s.simRow);
    if (
      slope5d != null &&
      pred5 != null &&
      Math.abs(pred5) >= 1 &&
      s.days != null &&
      s.days >= 0 &&
      s.days <= 60 &&
      (slope5d > 0) !== (pred5 > 0)
    ) {
      const { actual, expected } = resolveSlopeStockPrices(s.simRow, chartPts, null);
      if (isMaterialSlopePriceGap(actual, expected)) {
        const delta = slopeDeltaPpPerDay(slope5d, slope20d ?? slope5d);
        const capFields = capitalFieldsFromRow(s.simRow, chartPts, inputs);
        fromSheet.push({
          ticker: s.ticker,
          cd: s.cd,
          days: s.days,
          kind: "contrarian",
          slope5d,
          slope20d: slope20d ?? slope5d,
          delta,
          impact:
            Math.abs(slope5d) +
            (pred5 != null && Number.isFinite(pred5) ? Math.abs(pred5) * 0.12 : 0),
          ...capFields,
        });
      }
    }
  }

  const open = new Set(
    signals.filter((s) => s.hasPosition).map((s) => s.ticker.toUpperCase()),
  );
  const simByTk = new Map(
    signals
      .filter((s) => s.hasPosition)
      .map((s) => {
        const sk = simulationRowSeriesKey(s.simRow);
        const chartPts =
          sk && chartPointsBySeriesKey ? chartPointsBySeriesKey.get(sk) ?? null : null;
        return [s.ticker.toUpperCase(), { simRow: s.simRow, chartPts }] as const;
      }),
  );
  const fromFeed = buildUnifiedSlopeFeed()
    .filter((r) => open.has(r.ticker.toUpperCase()))
    .map((r) => {
      const c = simByTk.get(r.ticker.toUpperCase());
      return alertFromFeedRow(r, c?.simRow, c?.chartPts, inputs);
    })
    .filter((a): a is SlopeAlertRow => a != null);

  return mergeAlertsByTicker([...fromSheet, ...fromFeed]);
}

export { ALERT_KIND_PRIORITY };
