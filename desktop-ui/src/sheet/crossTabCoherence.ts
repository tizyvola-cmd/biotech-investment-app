/**
 * Audit helpers per confrontare pubblicazioni cross-tab (solo logica pura).
 */
import type { SheetTable } from "../types";
import type { ChartPoint } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { loadInvestSimHistory } from "./investSimStorage";
import {
  classifyTopOppsFromPickSignals,
  type TopOppsClassifyOptions,
} from "./topOppsFromSimulation";
import { buildPickSignalsFromSimTable } from "./top2FromSimulation";
import { loadUpsideThresholdPct } from "./topOppsThreshold";
import { loadTopOppMinAffidPct } from "./topOppQuality";
import { getActiveTopOpps, type TopOppsSnapshot } from "./topOppsStore";
import { countPortfolioSlopeFeedRows } from "./slopeEventsFeed";
import { buyPriceLooksInconsistent } from "./portfolioGainLossStyle";
import {
  currentPriceFromRow,
  positionPnlForOpenRow,
  rowHasActivePortfolio,
} from "./simulationPosition";
import { simulationRowSeriesKey, peekSimulationChartsBundle, chartPointsMapFromBundle } from "../data/simulationCharts";
import type { Top2PickSignal } from "./top2PortfolioPick";

/** Stesse chiavi serie usate dallo store Top Opps (`co:TICKER|YYYY-MM-DD`). */
function pickSeriesKeys(picks: Top2PickSignal[]): string[] {
  const keys: string[] = [];
  for (const s of picks) {
    if (s.simRow) {
      const k = simulationRowSeriesKey(s.simRow);
      if (k) keys.push(k);
      continue;
    }
    const t = String(s.ticker ?? "").trim().toUpperCase();
    if (t) keys.push(t);
  }
  return keys;
}

export type TopOppsAudit = {
  strictHot: number;
  strictWatch: number;
  strictHotKeys: string[];
  strictWatchKeys: string[];
  relaxedHot: number;
  relaxedWatch: number;
  sliderRelaxedHot: number;
  divergentTickers: string[];
};

export type CrossTabCoherenceReport = TopOppsAudit & {
  upsideThresholdPct: number;
  minAffidabilitaPct: number;
  store: Pick<
    TopOppsSnapshot,
    "hotKeys" | "watchKeys" | "top2BuyKeys" | "publishedBy" | "updatedAt"
  >;
  storeAgeMinutes: number | null;
  slopeFeedPortfolioRows: number;
  openPositions: number;
  buyPriceWarningTickers: string[];
};

export function auditTopOppsPublishers(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
): TopOppsAudit {
  const all = buildPickSignalsFromSimTable(simTable, inputs, chartPointsBySeriesKey);
  const sliderPct = loadUpsideThresholdPct();
  const minAff = loadTopOppMinAffidPct();

  const strictOpts: TopOppsClassifyOptions = {
    upsideThresholdPct: sliderPct,
    minAffidabilita: minAff,
    mode: "strict",
  };
  const relaxedOpts: TopOppsClassifyOptions = {
    upsideThresholdPct: 0.8,
    minAffidabilita: 45,
    mode: "relaxed",
  };
  const sliderRelaxedOpts: TopOppsClassifyOptions = {
    upsideThresholdPct: sliderPct,
    minAffidabilita: 45,
    mode: "relaxed",
  };

  const strict = classifyTopOppsFromPickSignals(all, strictOpts);
  const relaxed = classifyTopOppsFromPickSignals(all, relaxedOpts);
  const sliderRelaxed = classifyTopOppsFromPickSignals(all, sliderRelaxedOpts);

  const strictSet = new Set(strict.hot.map((s) => s.ticker));
  const relaxedSet = new Set(relaxed.hot.map((s) => s.ticker));
  const divergent = [...relaxedSet].filter((t) => !strictSet.has(t));

  return {
    strictHot: strict.hot.length,
    strictWatch: strict.watch.length,
    strictHotKeys: pickSeriesKeys(strict.hot),
    strictWatchKeys: pickSeriesKeys(strict.watch),
    relaxedHot: relaxed.hot.length,
    relaxedWatch: relaxed.watch.length,
    sliderRelaxedHot: sliderRelaxed.hot.length,
    divergentTickers: divergent,
  };
}

function findTickerCol(cols: string[]): string {
  return cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
}

function collectBuyPriceWarnings(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): string[] {
  if (!simTable?.rows?.length) return [];
  const cols =
    simTable.columns?.length
      ? simTable.columns
      : Object.keys(simTable.rows[0] ?? {});
  const colTicker = findTickerCol(cols);
  const history = loadInvestSimHistory();
  const out: string[] = [];
  for (const row of simTable.rows) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const m = positionPnlForOpenRow(row, inputs, history);
    const spot = currentPriceFromRow(row) ?? m.pos?.currPrice ?? null;
    const buy = m.buyPriceUsd ?? m.pos?.buyPrice ?? null;
    if (!buyPriceLooksInconsistent(buy, spot)) continue;
    const tk = String(row[colTicker] ?? "").trim().toUpperCase();
    if (tk) out.push(tk);
  }
  return out;
}

function countOpenPositions(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): number {
  if (!simTable?.rows?.length) return 0;
  let n = 0;
  for (const row of simTable.rows) {
    if (rowHasActivePortfolio(row, inputs)) n += 1;
  }
  return n;
}

export function buildCrossTabCoherenceReport(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
): CrossTabCoherenceReport {
  const chartMap =
    chartPointsBySeriesKey ??
    chartPointsMapFromBundle(peekSimulationChartsBundle());
  const audit = auditTopOppsPublishers(
    simTable,
    inputs,
    chartMap.size > 0 ? chartMap : undefined,
  );
  const store = getActiveTopOpps();
  const ageMs = store.updatedAt ? Date.now() - store.updatedAt : null;

  return {
    ...audit,
    upsideThresholdPct: loadUpsideThresholdPct(),
    minAffidabilitaPct: loadTopOppMinAffidPct(),
    store: {
      hotKeys: store.hotKeys,
      watchKeys: store.watchKeys,
      top2BuyKeys: store.top2BuyKeys,
      publishedBy: store.publishedBy,
      updatedAt: store.updatedAt,
    },
    storeAgeMinutes:
      ageMs != null && Number.isFinite(ageMs) ? Math.round(ageMs / 60_000) : null,
    slopeFeedPortfolioRows: countPortfolioSlopeFeedRows(simTable, null, inputs),
    openPositions: countOpenPositions(simTable, inputs),
    buyPriceWarningTickers: collectBuyPriceWarnings(simTable, inputs),
  };
}
