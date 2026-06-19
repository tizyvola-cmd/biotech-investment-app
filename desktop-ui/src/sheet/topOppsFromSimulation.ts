/**
 * Top Opportunities (hot / watch) dalla Simulation — senza aprire Decision Lab.
 * Default: filtri strict su pick (precat/stability/slider). Opzione relaxed legacy.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import type { InvestSimInputs } from "./investSimStorage";
import { isHotZone, isWatchZone } from "./cdHorizons";
import { roiPerDayFromPlan } from "./topOppQuality";
import {
  buildPickSignalsFromSimTable,
  buildTop2BuyPool,
  pickToTop2Priority,
  portfolioTickersFromTable,
} from "./top2FromSimulation";
import {
  pickTop2BuyCandidates,
  pickTop2SellCandidates,
  type Top2PickSignal,
} from "./top2PortfolioPick";
import { loadUpsideThresholdPct } from "./topOppsThreshold";
import { loadTopOppMinAffidPct } from "./topOppQuality";
import { passesStrictTopPick } from "./topOppsStrictPick";
import { setActiveTopOpps, shouldSkipDashboardTopOppsPublish } from "./topOppsStore";
import { setTop2BuySell } from "./top2BuySellStore";

export type TopOppsClassifyMode = "strict" | "relaxed";

export type TopOppsClassifyOptions = {
  upsideThresholdPct?: number;
  /** Confidence minima 0–100. */
  minAffidabilita?: number;
  /** strict = allineato Decision Lab (pick); relaxed = legacy permissivo. */
  mode?: TopOppsClassifyMode;
};

/** Soglie Dashboard allineate agli slider Decision Lab. */
export function defaultDashboardClassifyOpts(): TopOppsClassifyOptions {
  return {
    upsideThresholdPct: loadUpsideThresholdPct(),
    minAffidabilita: loadTopOppMinAffidPct(),
    mode: "strict",
  };
}

const HOT_CAP = 20;
const WATCH_CAP = 10;
const DEFAULT_UPSIDE = 0.8;
const DEFAULT_MIN_AFF = 45;

function sortByRoiDay(a: Top2PickSignal, b: Top2PickSignal): number {
  const rda = roiPerDayFromPlan(a.planReturnPct, a.planDays ?? a.days);
  const rdb = roiPerDayFromPlan(b.planReturnPct, b.planDays ?? b.days);
  if (Math.abs(rda - rdb) > 0.0001) return rdb - rda;
  return (b.planReturnPct ?? 0) - (a.planReturnPct ?? 0);
}

function passesRelaxedHot(
  s: Top2PickSignal,
  upside: number,
  minAff: number,
): boolean {
  if (s.hasPosition) return false;
  if (s.days != null && s.days < -3) return false;

  const planOk = s.planReturnPct != null && s.planReturnPct > 0;
  const predOk = s.pred5 != null && s.pred5 >= upside;
  if (!planOk && !predOk) return false;

  if (s.precatKind === "avoid" || s.precatKind === "sell") return false;
  if (s.stabilityVerdict === "exit" || s.stabilityVerdict === "avoid") return false;

  if (minAff > 0) {
    const affPct = s.affid != null ? s.affid * 100 : null;
    if (affPct == null || affPct < minAff) return false;
  }

  return true;
}

function passesTopOppPick(
  s: Top2PickSignal,
  opts: TopOppsClassifyOptions,
): boolean {
  const mode = opts.mode ?? "strict";
  const upside = opts.upsideThresholdPct ?? (mode === "strict" ? loadUpsideThresholdPct() : DEFAULT_UPSIDE);
  const minAff = opts.minAffidabilita ?? (mode === "strict" ? loadTopOppMinAffidPct() : DEFAULT_MIN_AFF);
  if (mode === "strict") {
    return passesStrictTopPick(s, { upsideThresholdPct: upside, minAffidabilita: minAff });
  }
  return passesRelaxedHot(s, upside, minAff);
}

export function classifyTopOppsFromPickSignals(
  all: Top2PickSignal[],
  opts?: TopOppsClassifyOptions,
): { hot: Top2PickSignal[]; watch: Top2PickSignal[] } {
  const resolved: TopOppsClassifyOptions = {
    mode: opts?.mode ?? "strict",
    upsideThresholdPct: opts?.upsideThresholdPct,
    minAffidabilita: opts?.minAffidabilita,
  };

  const hot: Top2PickSignal[] = [];
  const watch: Top2PickSignal[] = [];

  for (const s of all) {
    if (!passesTopOppPick(s, resolved)) continue;
    if (isHotZone(s.days)) hot.push(s);
    else if (isWatchZone(s.days)) watch.push(s);
  }

  hot.sort(sortByRoiDay);
  watch.sort(sortByRoiDay);
  return { hot: hot.slice(0, HOT_CAP), watch: watch.slice(0, WATCH_CAP) };
}

function seriesKeysFromPicks(rows: Top2PickSignal[]): string[] {
  const keys: string[] = [];
  for (const s of rows) {
    if (!s.simRow) continue;
    const k = simulationRowSeriesKey(s.simRow);
    if (k) keys.push(k);
  }
  return keys;
}

/** Pubblica hot/watch + Top 2 BUY/SELL (Dashboard / Simulation). */
export function publishDashboardRecommendationsFromSimulation(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
  opts?: TopOppsClassifyOptions & { forceTimestamp?: boolean },
): void {
  const forceTimestamp = opts?.forceTimestamp === true;
  const all = buildPickSignalsFromSimTable(simTable, inputs, chartPointsBySeriesKey);
  if (!all.length) {
    if (!shouldSkipDashboardTopOppsPublish()) {
      setActiveTopOpps(
        { hotKeys: [], watchKeys: [], top2BuyKeys: [] },
        { publishedBy: "dashboard-strict", forceTimestamp },
      );
    }
    setTop2BuySell([], []);
    return;
  }

  const classifyOpts: TopOppsClassifyOptions = {
    ...defaultDashboardClassifyOpts(),
    ...opts,
    mode: opts?.mode ?? "strict",
  };
  const { hot, watch } = classifyTopOppsFromPickSignals(all, classifyOpts);
  const portfolioTickers = simTable
    ? portfolioTickersFromTable(simTable, inputs)
    : new Set<string>();
  const buyPool = buildTop2BuyPool(all, hot, portfolioTickers);
  const buy = pickTop2BuyCandidates(buyPool, portfolioTickers);
  const buyTickers = new Set(buy.map((s) => s.ticker));
  const sell = pickTop2SellCandidates(all, buyTickers);

  if (!shouldSkipDashboardTopOppsPublish()) {
    setActiveTopOpps(
      {
        hotKeys: seriesKeysFromPicks(hot),
        watchKeys: seriesKeysFromPicks(watch),
        top2BuyKeys: seriesKeysFromPicks(buy),
      },
      { publishedBy: "dashboard-strict", forceTimestamp },
    );
  }
  setTop2BuySell(buy.map(pickToTop2Priority), sell.map(pickToTop2Priority));
}

/** @deprecated Use publishDashboardRecommendationsFromSimulation */
export function publishTopOppsFromSimulation(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
  opts?: TopOppsClassifyOptions,
): void {
  publishDashboardRecommendationsFromSimulation(simTable, inputs, chartPointsBySeriesKey, opts);
}
