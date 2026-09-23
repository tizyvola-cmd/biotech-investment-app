import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  buildPortfolioDailyPnlLedger,
  computeSimulationPosition,
  currentPriceFromRow,
  dailyChangePctFromRow,
  isStalePhantomOpportunityRow,
  commonTickersOnSheet,
  shouldHideRedundantWarrantRow,
  portfolioDailyPnlFromRow,
  positionCapitalPnlPct,
  rowHasActivePortfolio,
} from "./simulationPosition";
import {
  closedPiggyHasBaseline,
  computeClosedPiggyBankDisplay,
  loadClosedPiggyBankBaseline,
  type ClosedPiggyBankDisplay,
  summarizeClosedPiggyBankFromLedger,
} from "./closedPiggyBank";
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
import { computePortfolioCashFlow } from "./experimentCashFlow";
import { bookMarkToMarket } from "./bookMarkToMarket";

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
  /** Daily close vs prior close (`Var. giorn. %`) — for the Δ 24h column. */
  pnlPct24h: number | null;
  sds: SdsGateInfo | null;
};

export type DashboardPulsePortfolioTotals = ReturnType<typeof aggregateOpenPortfolioPnl> & {
  /** All-time closed P&L (same as closedPnlEur hero — kept for older callers). */
  closedPnlEurAllTime?: number;
  /** Closed P&L since last beer-glass Reset (secondary). */
  closedPnlEurSinceReset?: number;
  closedPiggyHasBaseline?: boolean;
  /** Nominal capital released by every archived (SELL) ledger row. */
  capitalReturnedFromClosedEur?: number;
  /** Nominal capital currently locked in open portfolio positions. */
  capitalInOpenEur?: number;
  /** min(returned, open) — descriptive upper bound of recycled capital. */
  capitalReinvestedEur?: number;
  /** max(0, open − returned) — capital that cannot come from closed deals. */
  freshCapitalDeployedEur?: number;
  /** Positive realized P&L summed from closed deals. */
  realizedGainsFromClosedEur?: number;
  /** min(gains, open) — gains portion of open book (display metric). */
  gainsRecycledInOpenEur?: number;
  /** open − gainsRecycledInOpen. */
  capitalNotFromGainsEur?: number;
};

export type DashboardPulseData = {
  hasPriorVisit: boolean;
  priorVisitAt: string | null;
  portfolioTotals: DashboardPulsePortfolioTotals;
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
/**
 * First-visit slope floor for the Dashboard "Opportunities · MII rising"
 * section. Intentionally more permissive than the global MII default
 * (`loadMigMinSlopeAngleDeg` = 20°) so the list is not empty when the
 * market cools down. `verdict !== "BLOCK"` still guards against noisy
 * fits, and `slope > 8°` still filters flat/downtrends.
 */
const OPPS_FIRST_VISIT_MIN_SLOPE_DEG = 15;

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

/**
 * Trend arrow = market session direction (24h close vs prior close).
 * Δ visit is a separate UX metric (since last dashboard open) and must not
 * flip the arrow when the day itself is red/green — that made CERS-like rows
 * look "up" while 24h was −€112.
 */
export function resolvePulseTableTrendDirection(
  pnlEur24h: number | null,
  pnlPct24h: number | null,
  deltaPnlEurSinceVisit: number | null,
  _hasPriorVisit?: boolean,
): PulseDirection {
  return resolveDirection(pnlEur24h, pnlPct24h, deltaPnlEurSinceVisit);
}

/**
 * Ignore visit snapshots saved mid-load with inflated P&L (e.g. ~1.5k vs live ~700).
 * When the portfolio-level total looks contaminated but per-ticker snaps exist
 * (common after sells / ghost-book cleanup), keep tickers for row Δ visit and
 * rebase the portfolio anchor so the KPI tile is not a bogus multi-k€ swing.
 */
export function resolveEffectiveVisitSnapshot(
  priorSnapshot: DashboardVisitSnapshot | null | undefined,
  portfolioTotals: ReturnType<typeof aggregateOpenPortfolioPnl>,
): DashboardVisitSnapshot | null {
  if (!priorSnapshot) return null;
  if (
    !portfolioPnlDeltaLooksLikeStaleBaseline(
      priorSnapshot.portfolioPnlEur,
      portfolioTotals.pnlEur,
      portfolioTotals.pnlEurToday,
      portfolioTotals.todayCovered,
    )
  ) {
    return priorSnapshot;
  }
  const n = Object.keys(priorSnapshot.tickers ?? {}).length;
  if (n === 0) return null;
  return {
    ...priorSnapshot,
    portfolioPnlEur: portfolioTotals.pnlEur,
  };
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
  const book = bookMarkToMarket(inputs[key], pos.currPrice);
  const capital = book ? (inputs[key]?.capital ?? pos.capital) : pos.capital;
  const gainPlan = resolveExpectedGainPlan(row, capital, { chartPoints: chartPoints ?? null });
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "—");
  return {
    key,
    name: cd !== "—" ? `${ticker} · ${cd}` : ticker,
    ticker,
    pnlEur: book ? book.pnlEur : pos.pnlUnavailable ? null : pos.pnlEur,
    pnlUnavailable: book ? false : pos.pnlUnavailable,
    investedAt,
    expectedHoldDays: gainPlan.daysToCd,
    daysToTarget: gainPlan.daysToTarget ?? null,
    expectedGainEur: gainPlan.expectedGainEur,
    expectedGainPct: gainPlan.expectedReturnPct,
    targetGainPct: gainPlan.targetReturnPct,
    holdDaysElapsed,
    capital,
    currentPriceUsd: pos.currPrice,
    buyPriceUsd: book
      ? (inputs[key]?.buyPrice && inputs[key]!.buyPrice > 0 ? inputs[key]!.buyPrice : pos.buyPrice)
      : pos.buyPrice > 0
        ? pos.buyPrice
        : null,
    valueNow: book?.valueNow ?? pos.valueNow,
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

/** Effective first-visit floor for the Opportunities section (see comment
 *  on OPPS_FIRST_VISIT_MIN_SLOPE_DEG). Uses the min between the global
 *  user setting and the section-specific floor, so power users who
 *  lowered the global slider still get a permissive Opportunities view. */
function resolveOppsMinSlopeDeg(globalMin: number): number {
  return Math.min(globalMin, OPPS_FIRST_VISIT_MIN_SLOPE_DEG);
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
  /** When set, aligns Gain closed KPI with the beer-glass display (incl. reset baseline). */
  closedPiggyDisplay?: ClosedPiggyBankDisplay | null;
  /** Portfolio investment budget — budget-first attribution of open capital. */
  startingCapitalEur?: number | null;
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
    closedPiggyDisplay = null,
    startingCapitalEur = null,
  } = opts;

  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const portfolioTotals: DashboardPulsePortfolioTotals = aggregateOpenPortfolioPnl(
    simTable,
    inputs,
    history,
  );
  const portfolioLedger = buildPortfolioDailyPnlLedger(simTable, inputs, history);
  // Reconcile "Gain closed" with the beer glass: same ledger rows, same reset baseline (when set).
  const closedFromLedger = closedPiggyDisplay
    ? {
        rawPnlEur: closedPiggyDisplay.rawPnlEur,
        positionCount: closedPiggyDisplay.positionCount,
        pnlEur: closedPiggyDisplay.pnlEur,
        sinceResetPnlEur: closedPiggyDisplay.sinceResetPnlEur,
        hasBaseline: closedPiggyHasBaseline(closedPiggyDisplay),
      }
    : (() => {
        const summary = summarizeClosedPiggyBankFromLedger(portfolioLedger, inputs);
        const display = computeClosedPiggyBankDisplay(summary, loadClosedPiggyBankBaseline());
        return {
          rawPnlEur: summary.rawPnlEur,
          positionCount: summary.positionCount,
          pnlEur: display.pnlEur,
          sinceResetPnlEur: display.sinceResetPnlEur,
          hasBaseline: closedPiggyHasBaseline(display),
        };
      })();
  // Hero KPI = all-time closed (not offset by Reset).
  portfolioTotals.closedPnlEur = closedFromLedger.pnlEur;
  portfolioTotals.closedPnlEurAllTime = closedFromLedger.rawPnlEur;
  portfolioTotals.closedPnlEurSinceReset = closedFromLedger.sinceResetPnlEur;
  portfolioTotals.closedPiggyHasBaseline = closedFromLedger.hasBaseline;
  portfolioTotals.closedCount = closedFromLedger.positionCount;
  const cashFlow = computePortfolioCashFlow(
    portfolioLedger,
    portfolioTotals.capital,
    startingCapitalEur,
  );
  portfolioTotals.capitalReturnedFromClosedEur = cashFlow.capitalReturnedFromClosedEur;
  portfolioTotals.capitalInOpenEur = cashFlow.capitalInOpenEur;
  // Gains actually locked beyond budget (not returned-principal heuristic).
  portfolioTotals.capitalReinvestedEur = cashFlow.gainsRecycledInOpenEur;
  portfolioTotals.freshCapitalDeployedEur = cashFlow.freshCapitalDeployedEur;
  portfolioTotals.realizedGainsFromClosedEur = cashFlow.realizedGainsFromClosedEur;
  portfolioTotals.gainsRecycledInOpenEur = cashFlow.gainsRecycledInOpenEur;
  portfolioTotals.capitalNotFromGainsEur = cashFlow.capitalNotFromGainsEur;
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
    // Book chip is source of truth; gain-plan only fills a flat-zero restore.
    const pnlEur =
      chip.pnlEur !== 0 || gainPlanRow.pnlEur == null
        ? chip.pnlEur
        : gainPlanRow.pnlEur;
    const pnlPct =
      Math.abs(chip.pnlPct) > 0.05 || gainPlanRow.pnlEur == null
        ? chip.pnlPct
        : positionCapitalPnlPct(gainPlanRow.pnlEur, gainPlanRow.capital) ?? chip.pnlPct;
    const deltaPnlEurSinceVisit =
      prior != null ? Math.round((pnlEur - prior.pnlEur) * 100) / 100 : null;
    const deltaPnlPctSinceVisit =
      prior != null ? Math.round((pnlPct - prior.pnlPct) * 100) / 100 : null;

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
      pnlEur,
      pnlPct,
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

  const minPassDeg = resolveOppsMinSlopeDeg(loadMigMinSlopeAngleDeg());
  const opportunityRows: DashboardPulseOppRow[] = [];
  const sheetRows = simTable?.rows ?? [];
  const commonTickers = commonTickersOnSheet(sheetRows);
  const hotRows = filterOffPortfolioHotZoneSimRows(sheetRows, inputs);

  for (const row of hotRows) {
    const ticker = String(row.Ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    if (isStalePhantomOpportunityRow(row)) continue;
    // JSPRW when JSPR exists — trade the common only (avoid dual-company UI).
    if (shouldHideRedundantWarrantRow(row, commonTickers, inputs)) continue;
    const cd = String(row["Completion Date"] ?? "—");
    const key = normalizedRowKey(ticker, cd);
    const mig = migByKey.get(migSolidityKey(ticker, cd));
    if (!mig) continue;
    const priorAngle = effectivePriorSnapshot?.tickers[key]?.miiAngle;
    if (!isSignificantMiiRising(mig, priorAngle, minPassDeg)) continue;

    const dailyPct = dailyChangePctFromRow(row);

    opportunityRows.push({
      key,
      ticker,
      completionDate: cd,
      miiAngle: mig.slopeAngleDeg,
      deltaMiiSinceVisit:
        priorAngle != null ? Math.round((mig.slopeAngleDeg - priorAngle) * 10) / 10 : null,
      pnlPct24h: dailyPct != null && Number.isFinite(dailyPct) ? dailyPct : null,
      sds: sdsByTicker.get(ticker) ?? null,
    });
  }

  opportunityRows.sort((a, b) => b.miiAngle - a.miiAngle);
  if (opportunityRows.length > 6) opportunityRows.length = 6;

  const gainPlanRows = portfolioRows.map((r) => r.gainPlanRow);
  const portfolioPlanGap = summarizePlanGap(gainPlanRows, history);
  const gapForChart: PlanGapSummary = {
    ...portfolioPlanGap,
    actualNowEur: portfolioTotals.pnlEur,
    gapEur:
      portfolioPlanGap.plannedNowEur != null
        ? Math.round((portfolioTotals.pnlEur - portfolioPlanGap.plannedNowEur) * 100) / 100
        : portfolioPlanGap.gapEur,
    gapPct:
      portfolioPlanGap.plannedNowEur != null && portfolioTotals.capital > 0
        ? Math.round(
            ((portfolioTotals.pnlEur - portfolioPlanGap.plannedNowEur) /
              portfolioTotals.capital) *
              10000,
          ) / 100
        : portfolioPlanGap.gapPct,
  };
  const aggregateGainPlanSeries = buildPortfolioGainPlanAggregateSeries(
    gainPlanRows,
    history,
    effectivePriorSnapshot?.savedAt ?? null,
    lang,
    { preferHoldDayAxis: true, liveGap: gapForChart },
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
  /** Same open MTM as Pulse rows — Δ visit must compare apples to apples. */
  const chips = buildDashboardPortfolioChips(simTable, inputs, history);
  const chipByKey = new Map(chips.map((c) => [c.key, c]));
  const tickers: Record<string, DashboardVisitTickerSnap> = {};

  for (const row of simTable?.rows ?? []) {
    const ticker = String(row.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const cd = row["Completion Date"];
    const key = normalizedRowKey(ticker, cd);
    const inPortfolio = rowHasActivePortfolio(row, inputs);
    const mig = migByKey.get(migSolidityKey(ticker, String(cd ?? "")));

    if (inPortfolio) {
      const chip = chipByKey.get(key);
      const pos = computeSimulationPosition(row, inputs, { history });
      const daily = pos
        ? portfolioDailyPnlFromRow(pos, row)
        : { pnlEur24h: null as number | null, pnlPct24h: null as number | null };
      const pnlEur = chip?.pnlEur ?? (pos?.pnlUnavailable ? 0 : pos?.pnlEur ?? 0);
      const pnlPct =
        chip?.pnlPct ?? (pos?.pnlUnavailable ? 0 : pos?.pnlPct ?? 0);
      tickers[key] = {
        pnlEur,
        pnlPct,
        pnlEur24h: chip?.pnlEur24h ?? daily.pnlEur24h,
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

/**
 * Load + optionally discard a contaminated visit baseline once at dashboard enter.
 * Callers must freeze the result in React state for the whole visit — do not
 * re-read localStorage on every price refresh (alt-tab save would zero Δ visit).
 */
export function captureDashboardVisitBaseline(
  prior: DashboardVisitSnapshot | null | undefined,
  portfolioTotals: ReturnType<typeof aggregateOpenPortfolioPnl>,
): DashboardVisitSnapshot | null {
  return resolveEffectiveVisitSnapshot(prior ?? null, portfolioTotals);
}

/**
 * When no real leave snapshot exists, implied MTM at prior close ≈ live − 24h.
 * Freezing live MTM as the baseline made Δ visit stay +€0 for the whole visit
 * whenever prices were already loaded (typical after market close / first paint).
 */
export function buildSyntheticDayVisitBaseline(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  migByKey: Map<string, MigSoliditySnapshot>;
}): DashboardVisitSnapshot {
  const { simTable, inputs, history, migByKey } = opts;
  const chips = buildDashboardPortfolioChips(simTable, inputs, history);
  const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const tickers: Record<string, DashboardVisitTickerSnap> = {};

  for (const chip of chips) {
    const d24 =
      chip.pnlEur24h != null && Number.isFinite(chip.pnlEur24h) ? chip.pnlEur24h : 0;
    const priorPnl = Math.round((chip.pnlEur - d24) * 100) / 100;
    const priorPct =
      chip.capitalEur > 0
        ? Math.round((priorPnl / chip.capitalEur) * 10000) / 100
        : Math.round((chip.pnlPct - (chip.pnlPct24h ?? 0)) * 100) / 100;
    const row = rowByKey.get(chip.key);
    const ticker = chip.ticker.trim().toUpperCase();
    const cd = row ? String(row["Completion Date"] ?? "") : "";
    const mig = row ? migByKey.get(migSolidityKey(ticker, cd)) : undefined;
    tickers[chip.key] = {
      pnlEur: priorPnl,
      pnlPct: priorPct,
      pnlEur24h: null,
      price: row ? currentPriceFromRow(row) : null,
      miiAngle: mig?.slopeAngleDeg ?? null,
    };
  }

  return {
    savedAt: new Date().toISOString(),
    portfolioPnlEur:
      Math.round((totals.pnlEur - (totals.pnlEurToday ?? 0)) * 100) / 100,
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
