import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  computeSimulationPosition,
  currentPriceFromRow,
  portfolioDailyPnlFromRow,
  rowHasActivePortfolio,
} from "./simulationPosition";
import { filterOffPortfolioHotZoneSimRows } from "./simCdHorizonScope";
import { pickSignalFromSimRow } from "./top2FromSimulation";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { holdingDaysFromInvestedAt } from "./investSimStorage";
import { resolveSimulationEntrySolidity } from "./simulationEntrySolidity";
import { buildMigSolidityByKey, migSolidityKey, type MigSoliditySnapshot } from "./entrySolidityMig";
import { buildSdsByTicker, type SdsGateInfo } from "./sdsTopOppGate";
import { DEFAULT_MIG_CONFIG } from "./marketInterestGate";
import { loadMigMinSlopeAngleDeg } from "./marketInterestPrefs";
import { summarizePortfolioWinRate } from "./portfolioGainLossStyle";
import type { PortfolioGainChartRow } from "../components/PortfolioGainPlanChart";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import {
  buildPortfolioGainPlanAggregateSeries,
  planGapForRow,
  summarizePlanGap,
  type AggregateGainPlanPoint,
  type PlanGapSummary,
} from "./dashboardPulseAggregate";
import {
  loadDashboardVisitSnapshot,
  type DashboardVisitSnapshot,
  type DashboardVisitTickerSnap,
} from "./dashboardVisitSnapshot";
import { portfolioPnlDeltaLooksLikeStaleBaseline } from "./piggyBankTrend";

export type PulseDirection = "up" | "down" | "flat";

export type DashboardPulsePortfolioRow = {
  key: string;
  ticker: string;
  completionDate: string;
  direction: PulseDirection;
  pnlEur: number;
  pnlPct: number;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  deltaPnlEurSinceVisit: number | null;
  deltaPnlPctSinceVisit: number | null;
  gainPlanRow: PortfolioGainChartRow;
  planGap: PlanGapSummary;
  raScore: number | null;
  sds: SdsGateInfo | null;
};

export type DashboardPulseOppRow = {
  key: string;
  ticker: string;
  completionDate: string;
  miiAngle: number;
  deltaMiiSinceVisit: number | null;
  raScore: number | null;
  sds: SdsGateInfo | null;
};

export type DashboardPulseData = {
  hasPriorVisit: boolean;
  priorVisitAt: string | null;
  portfolioTotals: ReturnType<typeof aggregateOpenPortfolioPnl>;
  deltaPortfolioPnlSinceVisit: number | null;
  winRate: ReturnType<typeof summarizePortfolioWinRate>;
  portfolioRows: DashboardPulsePortfolioRow[];
  opportunityRows: DashboardPulseOppRow[];
  aggregateGainPlanSeries: AggregateGainPlanPoint[];
  portfolioPlanGap: PlanGapSummary;
};

const EPS_EUR = 0.5;
const EPS_PCT = 0.05;
const MII_RISING_DELTA_DEG = DEFAULT_MIG_CONFIG.minSignificantDeltaDeg;

function resolveDirection(
  pnlEur24h: number | null,
  pnlPct24h: number | null,
  deltaPnlEur: number | null,
): PulseDirection {
  if (pnlEur24h != null && Math.abs(pnlEur24h) > EPS_EUR) {
    return pnlEur24h > 0 ? "up" : "down";
  }
  if (pnlPct24h != null && Math.abs(pnlPct24h) > EPS_PCT) {
    return pnlPct24h > 0 ? "up" : "down";
  }
  if (deltaPnlEur != null && Math.abs(deltaPnlEur) > EPS_EUR) {
    return deltaPnlEur > 0 ? "up" : "down";
  }
  return "flat";
}

/** Trend arrow in the positions table — aligned with the Δ visit column when a prior visit exists. */
export function resolvePulseTableTrendDirection(
  pnlEur24h: number | null,
  pnlPct24h: number | null,
  deltaPnlEurSinceVisit: number | null,
  hasPriorVisit: boolean,
): PulseDirection {
  if (hasPriorVisit && deltaPnlEurSinceVisit != null) {
    if (Math.abs(deltaPnlEurSinceVisit) > EPS_EUR) {
      return deltaPnlEurSinceVisit > 0 ? "up" : "down";
    }
    return "flat";
  }
  return resolveDirection(pnlEur24h, pnlPct24h, deltaPnlEurSinceVisit);
}

/** Ignore visit snapshots saved mid-load with inflated P&L (e.g. ~1.5k vs live ~700). */
export function resolveEffectiveVisitSnapshot(
  priorSnapshot: DashboardVisitSnapshot | null | undefined,
  portfolioTotals: ReturnType<typeof aggregateOpenPortfolioPnl>,
): DashboardVisitSnapshot | null {
  if (!priorSnapshot) return null;
  if (
    portfolioPnlDeltaLooksLikeStaleBaseline(
      priorSnapshot.portfolioPnlEur,
      portfolioTotals.pnlEur,
      portfolioTotals.pnlEurToday,
      portfolioTotals.todayCovered,
    )
  ) {
    return null;
  }
  return priorSnapshot;
}

function directionSortKey(d: PulseDirection): number {
  if (d === "up") return 0;
  if (d === "flat") return 1;
  return 2;
}

function buildGainPlanRow(
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
    name: cd !== "—" ? `${ticker} · ${cd}` : ticker,
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

function isSignificantMiiRising(
  mig: MigSoliditySnapshot,
  priorAngle: number | null | undefined,
  minPassDeg: number,
): boolean {
  if (mig.slopeAngleDeg <= 8) return false;
  if (priorAngle != null && Number.isFinite(priorAngle)) {
    return mig.slopeAngleDeg - priorAngle >= MII_RISING_DELTA_DEG;
  }
  return mig.slopeAngleDeg >= minPassDeg && mig.verdict !== "BLOCK";
}

export function buildDashboardPulseData(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  chartPointsByKey: Map<string, ChartPoint[]>;
  sdsByTicker: Map<string, SdsGateInfo>;
  migByKey: Map<string, MigSoliditySnapshot>;
  priorSnapshot?: DashboardVisitSnapshot | null;
  lang?: "it" | "en";
}): DashboardPulseData {
  const {
    simTable,
    inputs,
    history,
    chartPointsByKey,
    sdsByTicker,
    migByKey,
    priorSnapshot = loadDashboardVisitSnapshot(),
    lang = "it",
  } = opts;

  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const portfolioTotals = aggregateOpenPortfolioPnl(simTable, inputs, history);
  const effectivePriorSnapshot = resolveEffectiveVisitSnapshot(priorSnapshot, portfolioTotals);
  const chips = buildDashboardPortfolioChips(simTable, inputs, history);

  const deltaPortfolioPnlSinceVisit =
    effectivePriorSnapshot != null
      ? Math.round((portfolioTotals.pnlEur - effectivePriorSnapshot.portfolioPnlEur) * 100) / 100
      : null;

  const portfolioRows: DashboardPulsePortfolioRow[] = [];
  for (const chip of chips) {
    const row = rowByKey.get(chip.key);
    if (!row) continue;
    const sk = simulationRowSeriesKey(row);
    const chartPts = sk ? chartPointsByKey.get(sk) : null;
    const gainPlanRow = buildGainPlanRow(chip.key, row, inputs, history, chartPts);
    if (!gainPlanRow) continue;

    const prior = effectivePriorSnapshot?.tickers[chip.key];
    const deltaPnlEurSinceVisit =
      prior != null ? Math.round((chip.pnlEur - prior.pnlEur) * 100) / 100 : null;
    const deltaPnlPctSinceVisit =
      prior != null ? Math.round((chip.pnlPct - prior.pnlPct) * 100) / 100 : null;

    const pick = pickSignalFromSimRow(row, inputs, chartPts, history);
    const raSolidity = resolveSimulationEntrySolidity(
      pick,
      { sdsByTicker, migByKey: migByKey as Map<string, MigSoliditySnapshot> },
      lang,
      "rascore",
    );
    const raScore = raSolidity?.composite.total ?? null;

    portfolioRows.push({
      key: chip.key,
      ticker: chip.ticker,
      completionDate: String(row["Completion Date"] ?? "—"),
      direction: resolvePulseTableTrendDirection(
        chip.pnlEur24h,
        chip.pnlPct24h,
        deltaPnlEurSinceVisit,
        effectivePriorSnapshot != null,
      ),
      pnlEur: chip.pnlEur,
      pnlPct: chip.pnlPct,
      pnlEur24h: chip.pnlEur24h,
      pnlPct24h: chip.pnlPct24h,
      deltaPnlEurSinceVisit,
      deltaPnlPctSinceVisit,
      gainPlanRow,
      planGap: planGapForRow(gainPlanRow, history),
      raScore,
      sds: sdsByTicker.get(chip.ticker) ?? null,
    });
  }

  portfolioRows.sort((a, b) => {
    const da = directionSortKey(a.direction);
    const db = directionSortKey(b.direction);
    if (da !== db) return da - db;
    const a24 = a.pnlEur24h ?? 0;
    const b24 = b.pnlEur24h ?? 0;
    if (a.direction === "down") return a24 - b24;
    return b24 - a24;
  });

  const winRate = summarizePortfolioWinRate(
    portfolioRows.map((r) => ({
      pnlEur: r.pnlEur,
      pnlPct: r.pnlPct,
      pnlEur24h: r.pnlEur24h,
      pnlPct24h: r.pnlPct24h,
    })),
  );

  const minPassDeg = loadMigMinSlopeAngleDeg();
  const opportunityRows: DashboardPulseOppRow[] = [];
  const hotRows = filterOffPortfolioHotZoneSimRows(simTable?.rows ?? [], inputs);

  for (const row of hotRows) {
    const ticker = String(row.Ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const cd = String(row["Completion Date"] ?? "—");
    const key = normalizedRowKey(ticker, cd);
    const mig = migByKey.get(migSolidityKey(ticker, cd));
    if (!mig) continue;
    const priorAngle = effectivePriorSnapshot?.tickers[key]?.miiAngle;
    if (!isSignificantMiiRising(mig, priorAngle, minPassDeg)) continue;

    const sk = simulationRowSeriesKey(row);
    const chartPts = sk ? chartPointsByKey.get(sk) : null;
    const pick = pickSignalFromSimRow(row, inputs, chartPts, history);
    const raSolidity = resolveSimulationEntrySolidity(
      pick,
      { sdsByTicker, migByKey: migByKey as Map<string, MigSoliditySnapshot> },
      lang,
      "entry",
    );
    const raScore = raSolidity?.composite.total ?? null;

    opportunityRows.push({
      key,
      ticker,
      completionDate: cd,
      miiAngle: mig.slopeAngleDeg,
      deltaMiiSinceVisit:
        priorAngle != null ? Math.round((mig.slopeAngleDeg - priorAngle) * 10) / 10 : null,
      raScore,
      sds: sdsByTicker.get(ticker) ?? null,
    });
  }

  opportunityRows.sort((a, b) => b.miiAngle - a.miiAngle);
  if (opportunityRows.length > 6) opportunityRows.length = 6;

  const gainPlanRows = portfolioRows.map((r) => r.gainPlanRow);
  const portfolioPlanGap = summarizePlanGap(gainPlanRows, history);
  const aggregateGainPlanSeries = buildPortfolioGainPlanAggregateSeries(
    gainPlanRows,
    history,
    effectivePriorSnapshot?.savedAt ?? null,
    lang,
    { preferHoldDayAxis: true },
  );

  return {
    hasPriorVisit: effectivePriorSnapshot != null,
    priorVisitAt: effectivePriorSnapshot?.savedAt ?? null,
    portfolioTotals,
    deltaPortfolioPnlSinceVisit,
    winRate,
    portfolioRows,
    opportunityRows,
    aggregateGainPlanSeries,
    portfolioPlanGap,
  };
}

export function buildDashboardVisitSnapshotFromState(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  migByKey: Map<string, MigSoliditySnapshot>;
}): DashboardVisitSnapshot {
  const { simTable, inputs, history, migByKey } = opts;
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
  const tickers: Record<string, DashboardVisitTickerSnap> = {};

  for (const row of simTable?.rows ?? []) {
    const ticker = String(row.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const cd = row["Completion Date"];
    const key = normalizedRowKey(ticker, cd);
    const inPortfolio = rowHasActivePortfolio(row, inputs);
    const mig = migByKey.get(migSolidityKey(ticker, String(cd ?? "")));

    if (inPortfolio) {
      const pos = computeSimulationPosition(row, inputs, { history });
      const daily = pos
        ? portfolioDailyPnlFromRow(pos, row)
        : { pnlEur24h: null as number | null, pnlPct24h: null as number | null };
      tickers[key] = {
        pnlEur: pos?.pnlUnavailable ? 0 : pos?.pnlEur ?? 0,
        pnlPct: pos?.pnlUnavailable ? 0 : pos?.pnlPct ?? 0,
        pnlEur24h: daily.pnlEur24h,
        price: currentPriceFromRow(row),
        miiAngle: mig?.slopeAngleDeg ?? null,
      };
    } else if (mig && mig.slopeAngleDeg > 0) {
      tickers[key] = {
        pnlEur: 0,
        pnlPct: 0,
        pnlEur24h: null,
        price: currentPriceFromRow(row),
        miiAngle: mig.slopeAngleDeg,
      };
    }
  }

  void rowByKey;

  return {
    savedAt: new Date().toISOString(),
    portfolioPnlEur: totals.pnlEur,
    tickers,
  };
}

export function buildMigMapsForDashboard(
  simTable: SheetTable | null,
  chartBundle: { series?: Record<string, { points?: ChartPoint[] }> } | null,
  sdsRows: SdsRow[] | null | undefined,
) {
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable, chartBundle as import("../types").ChartBundle | null, sdsRows);
  return { sdsByTicker, migByKey };
}
