/**
 * Calcola e pubblica Top 2 BUY/SELL dalla tab Simulation — senza aprire Decision Lab.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { reconcileInvestSimInputs, normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
import { loadInvestSimHistory } from "./investSimStorage";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { buildPrecatEntry, extractCurveInputs } from "./precatCurve";
import {
  applyMarketContextGate,
  effectivePrecatKindForPick,
  getCachedMarketContext,
  loadMarketGateBypass,
  type MarketContextDoc,
} from "./marketContextGate";
import { computeSlopeStability, stabilityVerdict } from "./slopeStability";
import { planRoiBundleFromGainPlan } from "./canonicalRoi";
import { resolveExpectedGainPlan, daysFromToday, readPred5RelativePp } from "./simulationPlanGain";
import {
  parseNum,
  rowHasActivePortfolio,
  currentPriceFromRow,
  positionPnlForOpenRow,
} from "./simulationPosition";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  pickTop2BuyCandidates,
  pickTop2SellCandidates,
  isTickerInPortfolio,
  projectedMovePct,
  type Top2PickSignal,
} from "./top2PortfolioPick";
import { setTop2BuySell, type Top2PrioritySignal } from "./top2BuySellStore";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "./simRowClinicalMeta";
import { signalMetricsFromSimRow } from "./investSignalScore";
import { tradeCalibThreshold } from "./investmentTradeCalib";

function actionFromScore(score: number | null): string {
  if (score == null) return "monitor";
  if (score >= tradeCalibThreshold("score_forte_min")) return "forte";
  if (score >= tradeCalibThreshold("score_watch_min")) return "watch";
  return "monitor";
}

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

/** Valid ticker + CD for RA calibration / temporal ρ (wider than live Top Opps window). */
export function isSimRowCalibrationEligible(row: Record<string, unknown>): boolean {
  const ticker = String(row.Ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return false;
  const cd = String(row["Completion Date"] ?? "").trim();
  if (!cd || cd === "—") return false;
  const days = daysFromToday(cd);
  if (days == null || days > 130) return false;
  return true;
}

export type PickSignalOpts = {
  /** RA calibration cohort — include past CDs and pre-CD rows outside Top Opps window. */
  calibrationCohort?: boolean;
};

export function pickSignalFromSimRow(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  chartPoints?: ChartPoint[] | null,
  history?: InvestSimHistoryPoint[] | null,
  marketCtx?: MarketContextDoc | null,
  opts?: PickSignalOpts,
): Top2PickSignal | null {
  const ticker = String(row.Ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return null;

  const cd = String(row["Completion Date"] ?? "").trim();
  if (!cd || cd === "—") return null;

  const days = daysFromToday(cd);
  if (opts?.calibrationCohort) {
    if (days == null || days > 130) return null;
  } else if (days == null || days < -45 || days > 120) {
    return null;
  }

  const cols = Object.keys(row);
  const colAffid = findCol(cols, "Affidabilit") ?? "";
  const colR2 = findCol(cols, "R²") ?? findCol(cols, "R2") ?? "";
  let affid = parseNum(row[colAffid]);
  if (affid != null && affid > 1) affid /= 100;
  const r2 = parseNum(row[colR2]);
  const pred5 = readPred5RelativePp(row, { chartPoints });

  const hasPosition = rowHasActivePortfolio(row, inputs);
  const pnlMetrics = hasPosition ? positionPnlForOpenRow(row, inputs, history) : null;
  const pos = pnlMetrics?.pos ?? null;

  const { slope5d, slope20d, slope45d, runUp30d } = extractCurveInputs(row);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
  const verdict = stabilityVerdict(stab, effSlope);
  const precatRaw = buildPrecatEntry(slope5d, slope20d, runUp30d, days);
  const { gate } = applyMarketContextGate(precatRaw, marketCtx, {
    bypass: loadMarketGateBypass(),
  });
  const gatedKind = effectivePrecatKindForPick(precatRaw.kind, gate);
  const gateLabel =
    gate?.regime_gate_fired && gatedKind === "hold"
      ? "⏸ Macro hold"
      : gate?.regime_gate_fired && gatedKind === "avoid" && precatRaw.kind !== "avoid"
        ? "🚫 Macro avoid"
        : precatRaw.label;

  const simKey = normalizedRowKey(ticker, cd);
  const planCapital =
    inputs[simKey]?.capital > 0 ? inputs[simKey].capital : DEFAULT_PLAN_CAPITAL_EUR;
  const gainPlan = resolveExpectedGainPlan(row, planCapital, { chartPoints });
  const roi = planRoiBundleFromGainPlan(gainPlan, planCapital, days);

  return {
    ticker,
    cd,
    days,
    pred5,
    affid,
    r2,
    slope20d,
    precatExpectedReturn: precatRaw.expectedReturnPct ?? null,
    precatKind: gatedKind,
    precatOriginalKind: precatRaw.kind,
    precatLabel: gateLabel,
    marketRegime: gate?.market_regime,
    marketGate: gate,
    upsideScore: 0,
    planReturnPct: roi.planReturnPct,
    planCdReturnPct: roi.planCdReturnPct,
    planDays: roi.planDays,
    hasPosition,
    stabilityVerdict: verdict,
    slopeRotationFlag: stab.rotationFlag,
    simRow: row,
    chartPoints: chartPoints ?? null,
    pnlPct: pnlMetrics?.pnlPct ?? null,
    pnlEur: pnlMetrics?.pnlEur ?? null,
    pnlPct24h: pnlMetrics?.pnlPct24h ?? null,
    pnlEur24h: pnlMetrics?.pnlEur24h ?? null,
    buyPriceUsd: pnlMetrics?.buyPriceUsd ?? null,
    currentPriceUsd: pos?.currPrice ?? currentPriceFromRow(row),
  };
}

export function pickToTop2Priority(s: Top2PickSignal): Top2PrioritySignal {
  const row = s.simRow ?? {};
  const cols = Object.keys(row);
  const metrics = cols.length ? signalMetricsFromSimRow(row, cols) : null;
  const score = metrics?.score ?? null;
  return {
    ticker: s.ticker,
    cd: s.cd,
    days: s.days ?? null,
    pred5: s.pred5 ?? null,
    affid: s.affid ?? (metrics?.affidPct != null ? metrics.affidPct / 100 : null),
    r2: s.r2 ?? metrics?.r2 ?? null,
    slope20d: s.slope20d ?? null,
    precatExpectedReturn: s.precatExpectedReturn ?? null,
    planReturnPct: s.planReturnPct ?? null,
    planDays: s.planDays ?? s.days ?? null,
    planCapitalEur: DEFAULT_PLAN_CAPITAL_EUR,
    clinicalPhase: clinicalPhaseFromSimRow(row),
    clinicalIndication: clinicalIndicationFromSimRow(row),
    action: actionFromScore(score),
    precatKind: s.precatKind,
    precatLabel: s.precatLabel,
    score: score ?? undefined,
    stabilityVerdict: s.stabilityVerdict,
    hasPosition: s.hasPosition,
    pnlPct: s.pnlPct ?? null,
    pnlEur: s.pnlEur ?? null,
    pnlEur24h: s.pnlEur24h ?? null,
    pnlPct24h: s.pnlPct24h ?? null,
    buyPriceUsd: s.buyPriceUsd ?? null,
    currentPriceUsd: s.currentPriceUsd ?? null,
    clinicalKpi: null,
    k8Kpi: null,
    simRow: row,
  };
}

export type BuildTop2BuyPoolOptions = {
  /**
   * When false (Decision Lab), Top 2 BUY follows the same filtered hot list only.
   * When true (legacy Simulation publish), fall back to unfiltered positives if hot is empty.
   */
  allowUnfilteredFallback?: boolean;
};

/** Pool BUY: filtered hot top; optional fallback to unfiltered positives. */
export function buildTop2BuyPool(
  all: Top2PickSignal[],
  hotTop: Top2PickSignal[],
  portfolioTickers?: Set<string>,
  opts?: BuildTop2BuyPoolOptions,
): Top2PickSignal[] {
  const held = (s: Top2PickSignal) => isTickerInPortfolio(s, portfolioTickers);
  const hot = hotTop.filter((s) => !held(s));
  if (hot.length > 0 || opts?.allowUnfilteredFallback === false) return hot;
  return all.filter((s) => {
    if (held(s)) return false;
    if (s.precatKind === "avoid" || s.precatKind === "sell" || s.precatKind === "late") return false;
    return projectedMovePct(s) > 0;
  });
}

export function buildPickSignalsFromSimTable(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
  marketCtx?: MarketContextDoc | null,
): Top2PickSignal[] {
  if (!simTable?.rows?.length) return [];
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const history = loadInvestSimHistory();
  const ctx = marketCtx ?? getCachedMarketContext();
  const out: Top2PickSignal[] = [];
  for (const row of simTable.rows) {
    const seriesKey = simulationRowSeriesKey(row);
    const pts = seriesKey ? chartPointsBySeriesKey?.get(seriesKey) : undefined;
    const sig = pickSignalFromSimRow(row, merged, pts, history, ctx);
    if (sig) out.push(sig);
  }
  return out;
}

export function portfolioTickersFromTable(
  simTable: SheetTable,
  inputs: InvestSimInputs,
): Set<string> {
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const s = new Set<string>();
  for (const row of simTable.rows) {
    if (!rowHasActivePortfolio(row, merged)) continue;
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (tk && !tk.includes("TOTALE")) s.add(tk);
  }
  return s;
}

/** Pubblica Top 2 nel store condiviso (Dashboard + Simulation). */
export function publishTop2FromSimulation(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  chartPointsBySeriesKey?: Map<string, ChartPoint[]>,
  hotTopPickSignals?: Top2PickSignal[],
): void {
  const all = buildPickSignalsFromSimTable(simTable, inputs, chartPointsBySeriesKey);
  if (!all.length || !simTable) {
    setTop2BuySell([], []);
    return;
  }
  const portfolioTickers = portfolioTickersFromTable(simTable, inputs);
  const buyPool = buildTop2BuyPool(all, hotTopPickSignals ?? [], portfolioTickers);
  const buy = pickTop2BuyCandidates(buyPool, portfolioTickers);
  const buyTickers = new Set(buy.map((s) => s.ticker));
  const sell = pickTop2SellCandidates(all, buyTickers);
  setTop2BuySell(buy.map(pickToTop2Priority), sell.map(pickToTop2Priority));
}
