/**
 * Filtri tabella Simulation (workspace).
 *
 * | Filtro          | Criterio |
 * |-----------------|----------|
 * | All             | Tutte le righe del foglio |
 * | Portfolio       | Posizione aperta — **tutte**, anche fuori finestra CD attiva |
 * | Top opportunity | Chiavi hot Top pubblicate da Decision Lab (stesso elenco zona hot) |
 * | To sell now     | In portafoglio + decrescita verso CD (ROI ≤ 0 o pendenza in calo) |
 * | Hot Zone        | CD entro 60 giorni (zona hot), indipendente da Top Opp |
 */
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { isHotZone } from "./cdHorizons";
import { isPublishedHotTop } from "./recommendationTiers";
import type { Top2PrioritySignal } from "./top2BuySellStore";
import type { TopOppsSnapshot } from "./topOppsStore";
import { rowHasActivePortfolio } from "./simulationPosition";
import type { SimulationPosition } from "./simulationPosition";
import {
  cdReturnPctFromGainPlan,
  primaryDaysFromGainPlan,
  primaryReturnPctFromGainPlan,
} from "./canonicalRoi";
import { readPred5Pp, resolveExpectedGainPlan } from "./simulationPlanGain";
import { signalMetricsFromSimRow } from "./investSignalScore";
import { sustainedDeclineFromSimRow } from "./portfolioDeclineSell";
import type { ChartPoint } from "../types";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import type { InvestSimInputs } from "./investSimStorage";
import { roiPerDayFromPlan } from "./topOppQuality";

export type SimTableFilterId =
  | "all"
  | "portfolio"
  | "topOpps"
  | "sellNow"
  | "hotZone";

export type SimTableFilterCounts = Record<SimTableFilterId, number>;

const FILTER_STORAGE_KEY = "supernova_sim_table_filter";
const VALID_FILTERS: SimTableFilterId[] = [
  "all",
  "portfolio",
  "topOpps",
  "sellNow",
  "hotZone",
];

export function loadSimTableFilter(): SimTableFilterId {
  if (typeof window === "undefined") return "all";
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw && VALID_FILTERS.includes(raw as SimTableFilterId)) {
      return raw as SimTableFilterId;
    }
  } catch {
    /* private mode */
  }
  return "all";
}

export function saveSimTableFilter(filter: SimTableFilterId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, filter);
  } catch {
    /* quota */
  }
}

/** Posizione aperta — stesso criterio del KPI «Active portfolio». */
export function isActiveSimPortfolioPosition(
  p: SimulationPosition,
  simRow: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
): boolean {
  if (simRow) return rowHasActivePortfolio(simRow, inputs);
  const inp = inputs[p.key];
  return p.capital > 0 && !inp?.ignoreSheet;
}

/** Tutte le posizioni portfolio (anche fuori finestra CD hot/watch). */
export function filterActivePortfolioPositions(
  positions: SimulationPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
): SimulationPosition[] {
  return positions.filter((p) =>
    isActiveSimPortfolioPosition(p, simRowByKey.get(p.key), inputs),
  );
}

type RowCtx = {
  inPortfolio: boolean;
  seriesKey: string | null;
  daysToCd: number | null;
  topOppQuality: boolean;
  roiPerDay: number;
  sellNow: boolean;
  inHotZone: boolean;
};

/** Hot Top pubblicata da Decision Lab (non in portafoglio). */
export function isSimTableTopOpportunity(
  inPortfolio: boolean,
  seriesKey: string | null,
  topOpps: TopOppsSnapshot,
): boolean {
  if (inPortfolio) return false;
  return isPublishedHotTop(seriesKey, topOpps);
}

/** Decrescita verso CD — allineato a ``pickTop2SellCandidates``. */
export function isSimTableSellNow(
  inPortfolio: boolean,
  simRow: Record<string, unknown> | undefined,
  columns: string[] | undefined,
  planReturnPct: number | null,
  planCdReturnPct?: number | null,
  chartPoints?: ChartPoint[] | null,
): boolean {
  if (!inPortfolio || !simRow) return false;
  const pred5Pp = columns?.length
    ? signalMetricsFromSimRow(simRow, columns).pred5Pp
    : readPred5Pp(simRow);
  return sustainedDeclineFromSimRow(
    simRow,
    planReturnPct,
    pred5Pp,
    planCdReturnPct,
    chartPoints,
  );
}

function rowCtxForPosition(
  p: SimulationPosition,
  simRow: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
  topOpps: TopOppsSnapshot,
  chartPts: ChartPoint[] | null,
  columns: string[] | undefined,
): RowCtx {
  const inPortfolio = isActiveSimPortfolioPosition(p, simRow, inputs);
  const inp = inputs[p.key];

  const seriesKey = simRow ? simulationRowSeriesKey(simRow) : null;

  const planCap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
  const gainPlan = simRow ? resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts }) : null;
  const daysToCd = gainPlan?.daysToCd ?? null;
  const planReturnPct = gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null;
  const planCdReturnPct = gainPlan ? cdReturnPctFromGainPlan(gainPlan) : null;
  const planDays = gainPlan ? primaryDaysFromGainPlan(gainPlan) : null;

  const topOppQuality = isSimTableTopOpportunity(inPortfolio, seriesKey, topOpps);

  const roiPerDay = roiPerDayFromPlan(planReturnPct, planDays ?? daysToCd);
  const inHotZone = isHotZone(daysToCd);

  const sellNow = isSimTableSellNow(
    inPortfolio,
    simRow,
    columns,
    planReturnPct,
    planCdReturnPct,
    chartPts,
  );

  return {
    inPortfolio,
    seriesKey,
    daysToCd,
    topOppQuality,
    roiPerDay,
    sellNow,
    inHotZone,
  };
}

export function buildSimTableFilterCounts(
  positions: SimulationPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  topOpps: TopOppsSnapshot,
  _top2Sell: Top2PrioritySignal[],
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  columns: string[] | undefined,
  /** When set, portfolio count uses all open positions (ignores CD horizon pool). */
  allPositions?: SimulationPosition[],
): SimTableFilterCounts {
  const portfolioPool = allPositions ?? positions;
  const counts: SimTableFilterCounts = {
    all: positions.length,
    portfolio: filterActivePortfolioPositions(portfolioPool, simRowByKey, inputs).length,
    topOpps: 0,
    sellNow: 0,
    hotZone: 0,
  };

  for (const p of positions) {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const ctx = rowCtxForPosition(p, simRow, inputs, topOpps, chartPts, columns);

    if (ctx.topOppQuality) counts.topOpps += 1;
    if (ctx.sellNow) counts.sellNow += 1;
    if (ctx.inHotZone) counts.hotZone += 1;
  }

  return counts;
}

export function sortSimPositionsByDecline(
  positions: SimulationPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): SimulationPosition[] {
  const scored = positions.map((p) => {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const inp = inputs[p.key];
    const planCap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
    const gainPlan = simRow ? resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts }) : null;
    const planRet =
      (gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null) ??
      (gainPlan ? cdReturnPctFromGainPlan(gainPlan) : null);
    const planDays = gainPlan ? primaryDaysFromGainPlan(gainPlan) : null;
    const roiPerDay = roiPerDayFromPlan(planRet, planDays ?? gainPlan?.daysToCd ?? null);
    return { p, planRet: planRet ?? 999, roiPerDay };
  });
  scored.sort(
    (a, b) =>
      a.planRet - b.planRet ||
      a.roiPerDay - b.roiPerDay ||
      a.p.ticker.localeCompare(b.p.ticker),
  );
  return scored.map((s) => s.p);
}

export function sortSimPositionsByRoiPerDay(
  positions: SimulationPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): SimulationPosition[] {
  const scored = positions.map((p) => {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const inp = inputs[p.key];
    const planCap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
    const gainPlan = simRow ? resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts }) : null;
    const primary = gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null;
    const planDays = gainPlan ? primaryDaysFromGainPlan(gainPlan) : null;
    const roiPerDay = roiPerDayFromPlan(primary, planDays ?? gainPlan?.daysToCd ?? null);
    return { p, roiPerDay };
  });
  scored.sort((a, b) => b.roiPerDay - a.roiPerDay || a.p.ticker.localeCompare(b.p.ticker));
  return scored.map((s) => s.p);
}

export function filterSimTablePositions(
  positions: SimulationPosition[],
  filter: SimTableFilterId,
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  topOpps: TopOppsSnapshot,
  _top2Sell: Top2PrioritySignal[],
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  columns: string[] | undefined,
  /** When set, portfolio filter searches all open positions (ignores CD horizon pool). */
  allPositions?: SimulationPosition[],
): SimulationPosition[] {
  if (filter === "portfolio") {
    const pool = allPositions ?? positions;
    return filterActivePortfolioPositions(pool, simRowByKey, inputs);
  }
  void allPositions;
  if (filter === "all") return positions;

  return positions.filter((p) => {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const ctx = rowCtxForPosition(p, simRow, inputs, topOpps, chartPts, columns);

    switch (filter) {
      case "topOpps":
        return ctx.topOppQuality;
      case "sellNow":
        return ctx.sellNow;
      case "hotZone":
        return ctx.inHotZone;
      default:
        return true;
    }
  });
}
