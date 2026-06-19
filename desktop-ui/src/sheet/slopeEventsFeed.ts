/**
 * Unified slope + contrarian feed rows for Catalyst Hub → Slope errors tables.
 */

import {
  findChartSeriesByTickerCd,
  findSimulationRowByTickerCd,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { resolveRecalibratedChartPoints } from "./predictionCurveDailyRecalib";
import { canRenderSlopeTrajectory } from "./slopeRecalibCurve";
import type { ChartBundle } from "../types";
import type { SheetTable } from "../types";
import { loadContrarianLog, type ContrarianEventRecord } from "./contrarianLog";
import {
  listActiveContrarianEvents,
  listActiveSlopeErrorEvents,
  type SlopeChartDismissMap,
} from "./slopeErrorCharts";
import { loadSlopeLog, type SlopeEventRecord } from "./slopeEventLog";
import { extractCurveInputs } from "./precatCurve";
import { isActiveCdMonitoring } from "./cdLifecycle";
import { daysFromToday, readPred5Pp } from "./simulationPlanGain";
import { rowHasActivePortfolio } from "./simulationPosition";
import type { InvestSimInputs } from "./investSimStorage";
import { slopePriceGapFromSimRow } from "./slopeStockPrices";
import {
  classifySlopeEventKind,
  SLOPE_MIN_PRICE_GAP_USD,
  slopeDeltaPpPerDay,
} from "./slopeThresholds";

export { SLOPE_MIN_PRICE_GAP_USD };

export type UnifiedSlopeFeedRow =
  | {
      source: "slope";
      id: string;
      ticker: string;
      cd: string;
      detected_at: number;
      kind: SlopeEventRecord["kind"];
      detail: string;
      had_open_position?: boolean;
      hasActiveChart: boolean;
      slopeEvent: SlopeEventRecord;
    }
  | {
      source: "contrarian";
      id: string;
      ticker: string;
      cd: string;
      detected_at: number;
      kind: "contrarian";
      detail: string;
      had_open_position?: boolean;
      hasActiveChart: boolean;
      contrarianEvent: ContrarianEventRecord;
    };

export type CompanySlopeSummary = {
  ticker: string;
  rows: UnifiedSlopeFeedRow[];
  eventCount: number;
  activeChartCount: number;
  latestAt: number;
};

function slopeDetail(e: SlopeEventRecord): string {
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  if (e.kind === "slope_rev") {
    return `20d ${fmt(e.slope20d)} → 5d ${fmt(e.slope5d)} pp/g`;
  }
  return `20d ${fmt(e.slope20d)} → 5d ${fmt(e.slope5d)} · Δ ${fmt(e.delta_pp_per_day)} pp/g · T-${Math.max(0, e.days_to_cd_at_detection)}`;
}

function contrarianDetail(e: ContrarianEventRecord): string {
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  const div =
    e.divergence_type === "model_up" ? "model ↑ vs curve ↓" : "model ↓ vs curve ↑";
  return `slope ${fmt(e.slope5d)} · pred ${fmt(e.pred5)}% · ${div}`;
}

export function buildUnifiedSlopeFeed(
  dismissed?: SlopeChartDismissMap,
  portfolioOnly = false,
): UnifiedSlopeFeedRow[] {
  const activeSlopeIds = new Set(listActiveSlopeErrorEvents(dismissed).map((e) => e.id));
  const activeContrarianIds = new Set(listActiveContrarianEvents(dismissed).map((e) => e.id));
  const out: UnifiedSlopeFeedRow[] = [];

  for (const e of loadSlopeLog().events) {
    if (!isActiveCdMonitoring(daysFromToday(e.cd))) continue;
    if (portfolioOnly && e.had_open_position !== true) continue;
    out.push({
      source: "slope",
      id: e.id,
      ticker: e.ticker,
      cd: e.cd,
      detected_at: e.detected_at,
      kind: e.kind,
      detail: slopeDetail(e),
      had_open_position: e.had_open_position,
      hasActiveChart: activeSlopeIds.has(e.id),
      slopeEvent: e,
    });
  }

  for (const e of loadContrarianLog().events) {
    if (!isActiveCdMonitoring(daysFromToday(e.cd))) continue;
    if (portfolioOnly && e.had_open_position !== true) continue;
    out.push({
      source: "contrarian",
      id: e.id,
      ticker: e.ticker,
      cd: e.cd,
      detected_at: e.detected_at,
      kind: "contrarian",
      detail: contrarianDetail(e),
      had_open_position: e.had_open_position,
      hasActiveChart: activeContrarianIds.has(e.id),
      contrarianEvent: e,
    });
  }

  return out.sort((a, b) => b.detected_at - a.detected_at);
}

/**
 * Nasconde eventi il cui ticker ha |modello T+5 − reale| noto ma < soglia.
 * `resolveGapUsd` restituisce `undefined` se il ticker non è nel foglio Simulation.
 */
export function filterSlopeFeedByMaterialPriceGap(
  rows: UnifiedSlopeFeedRow[],
  resolveGapUsd: (tickerUpper: string) => number | null | undefined,
): UnifiedSlopeFeedRow[] {
  return rows.filter((row) => {
    const gap = resolveGapUsd(row.ticker.toUpperCase());
    // Gap sconosciuto: mantieni (allineato al banner che legge la riga Simulation).
    if (gap == null || !Number.isFinite(gap)) return true;
    return gap >= SLOPE_MIN_PRICE_GAP_USD;
  });
}

function completionDateKey(cd: string): string {
  const raw = String(cd ?? "").trim();
  if (!raw) return "";
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = new Date(raw);
  if (!Number.isFinite(iso.getTime())) return raw.toUpperCase();
  return iso.toISOString().slice(0, 10);
}

function feedRowKey(row: Pick<UnifiedSlopeFeedRow, "ticker" | "cd" | "kind">): string {
  return `${row.ticker.toUpperCase()}|${completionDateKey(row.cd)}|${row.kind}`;
}

/** One row per ticker+CD+kind — keeps the most recent detection. */
export function dedupeSlopeFeedByTickerCdKind(
  rows: UnifiedSlopeFeedRow[],
): UnifiedSlopeFeedRow[] {
  const best = new Map<string, UnifiedSlopeFeedRow>();
  for (const row of rows) {
    const k = feedRowKey(row);
    const prev = best.get(k);
    if (!prev || row.detected_at > prev.detected_at) {
      best.set(k, row);
    }
  }
  return [...best.values()].sort((a, b) => b.detected_at - a.detected_at);
}

function mergeFeedRowsDeduped(
  primary: UnifiedSlopeFeedRow[],
  extra: UnifiedSlopeFeedRow[],
): UnifiedSlopeFeedRow[] {
  const merged = dedupeSlopeFeedByTickerCdKind([...primary, ...extra]);
  return merged;
}

/** Segnale live da foglio (non ancora nel log o filtrato) — coerente con banner Decision Lab. */
export function buildLivePortfolioSlopeFeed(
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null,
  inputs: InvestSimInputs,
  portfolioOnly: boolean,
): UnifiedSlopeFeedRow[] {
  if (!simTable?.rows?.length) return [];
  const cols =
    simTable.columns?.length ? simTable.columns : Object.keys(simTable.rows[0] ?? {});
  const colTicker = cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
  const colCd =
    cols.find((c) => c.toLowerCase().includes("completion")) ?? "Completion Date";
  const activeSlopeIds = new Set(listActiveSlopeErrorEvents().map((e) => e.id));
  const activeContrarianIds = new Set(listActiveContrarianEvents().map((e) => e.id));
  const out: UnifiedSlopeFeedRow[] = [];

  for (const row of simTable.rows) {
    if (portfolioOnly && !rowHasActivePortfolio(row, inputs)) continue;
    const ticker = String(row[colTicker] ?? "").trim().toUpperCase();
    const cd = String(row[colCd] ?? "").trim();
    if (!ticker || !cd) continue;
    if (!isActiveCdMonitoring(daysFromToday(cd))) continue;

    const sk = simulationRowSeriesKey(row);
    const rawPts = sk && chartsBundle?.series?.[sk]?.points ? chartsBundle.series[sk].points : null;
    const chartPts = rawPts ?? null;
    const gap = slopePriceGapFromSimRow(row, chartPts);
    if (gap != null && Number.isFinite(gap) && gap < SLOPE_MIN_PRICE_GAP_USD) continue;

    const { slope5d, slope20d, runUp30d } = extractCurveInputs(row);
    const days = daysFromToday(cd);
    const pred5 = readPred5Pp(row);

    if (
      slope5d != null &&
      pred5 != null &&
      Math.abs(pred5) >= 1 &&
      days != null &&
      days >= 0 &&
      days <= 60 &&
      (slope5d > 0) !== (pred5 > 0)
    ) {
      const id = `live-${ticker}-${completionDateKey(cd)}-contrarian`;
      const regime =
        runUp30d == null ? "flat" : runUp30d >= 25 ? "btr" : runUp30d >= 10 ? "moderate" : runUp30d < -10 ? "ctr" : "flat";
      const ev: ContrarianEventRecord = {
        id,
        ticker,
        cd,
        detected_at: Date.now(),
        days_to_cd_at_detection: days,
        slope5d,
        pred5,
        divergence_type: pred5 > 0 ? "model_up" : "model_down",
        regime,
        had_open_position: true,
        confirmed: null,
        actual_pnl_pct: null,
        resolution_at: null,
      };
      out.push({
        source: "contrarian",
        id,
        ticker,
        cd,
        detected_at: ev.detected_at,
        kind: "contrarian",
        detail: contrarianDetail(ev),
        had_open_position: true,
        hasActiveChart: activeContrarianIds.has(id) || (chartPts?.length ?? 0) >= 2,
        contrarianEvent: ev,
      });
    }

    if (slope5d != null && slope20d != null) {
      const kind = classifySlopeEventKind(slope5d, slope20d);
      if (kind) {
        const delta = slopeDeltaPpPerDay(slope5d, slope20d);
        const id = `live-${ticker}-${completionDateKey(cd)}-${kind}`;
        const ev: SlopeEventRecord = {
          id,
          ticker,
          cd,
          detected_at: Date.now(),
          kind,
          days_to_cd_at_detection: days ?? 0,
          slope5d,
          slope20d,
          delta_pp_per_day: delta,
          run_up_30d: runUp30d,
          regime: "flat",
          pred_pct_median: null,
          had_open_position: true,
          price_at_detection: null,
          confirmed: null,
          actual_pnl_pct: null,
          confirmed_slope5d: null,
          resolution_at: null,
        };
        out.push({
          source: "slope",
          id,
          ticker,
          cd,
          detected_at: ev.detected_at,
          kind,
          detail: slopeDetail(ev),
          had_open_position: true,
          hasActiveChart: activeSlopeIds.has(id) || (chartPts?.length ?? 0) >= 2,
          slopeEvent: ev,
        });
      }
    }
  }
  return out;
}

/** Stesso pipeline della tab Slope errors (log + live portafoglio + filtro gap). */
export function buildSlopeFeedForPanel(
  opts: {
    dismissed?: SlopeChartDismissMap;
    portfolioOnly?: boolean;
    simTable?: SheetTable | null;
    chartsBundle?: ChartBundle | null;
    inputs?: InvestSimInputs;
    resolveGapUsd: (tickerUpper: string) => number | null | undefined;
  },
): UnifiedSlopeFeedRow[] {
  const portfolioOnly = opts.portfolioOnly ?? false;
  const raw = dedupeSlopeFeedByTickerCdKind(
    buildUnifiedSlopeFeed(opts.dismissed, portfolioOnly),
  );
  const live =
    opts.simTable && opts.inputs
      ? buildLivePortfolioSlopeFeed(opts.simTable, opts.chartsBundle ?? null, opts.inputs, portfolioOnly)
      : [];
  const merged = mergeFeedRowsDeduped(raw, live);
  const filtered = filterSlopeFeedByMaterialPriceGap(merged, opts.resolveGapUsd);
  return enrichSlopeFeedChartFlags(filtered, opts.simTable ?? null, opts.chartsBundle ?? null);
}

/** Company display name from a Simulation row (Italian/English column variants). */
export function companyNameFromSimRow(simRow: Record<string, unknown> | null | undefined): string {
  if (!simRow) return "";
  return String(
    simRow["Società"] ?? simRow["Societa"] ?? simRow.Nome ?? simRow.Company ?? "",
  ).trim();
}

export type SlopeChartResolveResult = {
  simRow: Record<string, unknown> | null;
  chartPts: import("../types").ChartPoint[] | null;
  /** Evento log: ticker assente dal foglio Simulation caricato. */
  logStaleNoSimRow: boolean;
  /** Curva solo da snapshot (nessuna riga foglio). */
  chartFromSnapshotOnly: boolean;
};

/** Riga foglio + punti curva (ricalib. se c’è riga; snapshot grezzo se solo log). */
export function resolveSlopeChartContext(
  ticker: string,
  cd: string,
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null,
): SlopeChartResolveResult {
  const rows = simTable?.rows ?? [];
  const simRow = rows.length ? findSimulationRowByTickerCd(rows, ticker, cd) : null;
  if (simRow) {
    const sk = simulationRowSeriesKey(simRow);
    const rawPts = sk && chartsBundle?.series?.[sk]?.points ? chartsBundle.series[sk].points : null;
    const chartPts = rawPts?.length ? resolveRecalibratedChartPoints(rawPts, simRow) : null;
    return {
      simRow,
      chartPts,
      logStaleNoSimRow: false,
      chartFromSnapshotOnly: false,
    };
  }
  const hit = findChartSeriesByTickerCd(chartsBundle, ticker, cd);
  const chartPts = hit?.points?.length ? resolveRecalibratedChartPoints(hit.points, null) : null;
  return {
    simRow: null,
    chartPts,
    logStaleNoSimRow: true,
    chartFromSnapshotOnly: Boolean(chartPts?.length),
  };
}

/** ↓ solo se TTL attivo e dati sufficienti per disegnare la traiettoria. */
export function enrichSlopeFeedChartFlags(
  rows: UnifiedSlopeFeedRow[],
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null,
): UnifiedSlopeFeedRow[] {
  if (!simTable?.rows?.length) {
    return rows.map((r) => ({ ...r, hasActiveChart: false }));
  }
  return rows.map((row) => {
    const ctx = resolveSlopeChartContext(row.ticker, row.cd, simTable, chartsBundle);
    const days = daysFromToday(row.cd) ?? 30;
    const canChart = canRenderSlopeTrajectory({
      chartPoints: ctx.chartPts,
      simRow: ctx.simRow,
      daysToCd: days,
    });
    return { ...row, hasActiveChart: row.hasActiveChart && canChart };
  });
}

export function countPortfolioSlopeFeedRows(
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null,
  inputs: InvestSimInputs,
  dismissed?: SlopeChartDismissMap,
): number {
  if (!simTable?.rows?.length) return 0;
  const gapByTicker = new Map<string, number | null>();
  const cols =
    simTable.columns?.length ? simTable.columns : Object.keys(simTable.rows[0] ?? {});
  const colTicker = cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
  for (const row of simTable.rows) {
    const tk = String(row[colTicker] ?? "").trim().toUpperCase();
    if (!tk) continue;
    const sk = simulationRowSeriesKey(row);
    const rawPts = sk && chartsBundle?.series?.[sk]?.points ? chartsBundle.series[sk].points : null;
    gapByTicker.set(tk, slopePriceGapFromSimRow(row, rawPts));
  }
  return buildSlopeFeedForPanel({
    dismissed,
    portfolioOnly: true,
    simTable,
    chartsBundle,
    inputs,
    resolveGapUsd: (tk) => gapByTicker.get(tk) ?? null,
  }).length;
}

export function groupSlopeFeedByTicker(rows: UnifiedSlopeFeedRow[]): CompanySlopeSummary[] {
  const map = new Map<string, UnifiedSlopeFeedRow[]>();
  for (const row of rows) {
    const tk = row.ticker.toUpperCase();
    const list = map.get(tk) ?? [];
    list.push(row);
    map.set(tk, list);
  }
  return [...map.entries()]
    .map(([ticker, list]) => {
      const sorted = [...list].sort((a, b) => b.detected_at - a.detected_at);
      return {
        ticker,
        rows: sorted,
        eventCount: sorted.length,
        activeChartCount: sorted.filter((r) => r.hasActiveChart).length,
        latestAt: sorted[0]?.detected_at ?? 0,
      };
    })
    .sort((a, b) => b.latestAt - a.latestAt || a.ticker.localeCompare(b.ticker));
}

export function feedLogCounts(): { slope: number; contrarian: number; withChart: number } {
  const slope = loadSlopeLog().events.length;
  const contrarian = loadContrarianLog().events.length;
  const withChart =
    listActiveSlopeErrorEvents().length + listActiveContrarianEvents().length;
  return { slope, contrarian, withChart };
}

export function slopeEventToFeedRow(e: SlopeEventRecord, hasActiveChart = true): UnifiedSlopeFeedRow {
  return {
    source: "slope",
    id: e.id,
    ticker: e.ticker,
    cd: e.cd,
    detected_at: e.detected_at,
    kind: e.kind,
    detail: slopeDetail(e),
    had_open_position: e.had_open_position,
    hasActiveChart,
    slopeEvent: e,
  };
}

export function activeSlopeChartFeedRows(
  dismissed?: SlopeChartDismissMap,
  portfolioOnly = false,
): UnifiedSlopeFeedRow[] {
  return listActiveSlopeErrorEvents(dismissed)
    .filter((e) => !portfolioOnly || e.had_open_position !== false)
    .map((e) => slopeEventToFeedRow(e, true));
}
