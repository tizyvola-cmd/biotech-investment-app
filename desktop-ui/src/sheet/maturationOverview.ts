import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import { summarizePaperClosedDeals } from "./paperSimMaturation";
import type { PortfolioDailyPnlLedger } from "./simulationPosition";
import { pnlEurFromDailyPct, dailyChangePctFromRow } from "./simulationPosition";
import { summarizeClosedPiggyBankFromLedger } from "./closedPiggyBank";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { SheetTable } from "../types";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

const MATURATION_CHART_SANITY_EUR = 500_000;

export type MaturationOverviewGroup = {
  id: "actual" | "simEqual" | "simSynth";
  openDeals: number;
  closedDeals: number;
  closedPnlEur: number;
  openMtmEur: number;
  totalPnlEur: number;
  pnl24hEur: number | null;
};

export function clampMaturationChartValue(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) > MATURATION_CHART_SANITY_EUR) return null;
  return roundEur(v);
}

/** Y-axis domain that ignores corrupt outliers so €-scale lines stay visible. */
export function computeMaturationChartYDomain(values: Array<number | null | undefined>): [number, number] {
  const sane = values.filter(
    (v): v is number => v != null && Number.isFinite(v) && Math.abs(v) <= MATURATION_CHART_SANITY_EUR,
  );
  if (!sane.length) return [-1000, 1000];
  let min = Math.min(...sane);
  let max = Math.max(...sane);
  if (min === max) {
    const pad = Math.max(250, Math.abs(min) * 0.15 + 100);
    return [roundEur(min - pad), roundEur(max + pad)];
  }
  const span = max - min;
  const pad = Math.max(150, span * 0.12);
  min = roundEur(min - pad);
  max = roundEur(max + pad);
  if (min <= 0 && max >= 0 && span < Math.abs(max - min) * 0.5) {
    /* keep zero in view when curves cross */
  } else if (min > 0) min = roundEur(Math.min(min, 0));
  else if (max < 0) max = roundEur(Math.max(max, 0));
  return [min, max];
}

function sumSimLoopOpenPnl24h(
  paperPortfolio: PaperPosition[],
  evalByKey: Map<string, TickerSimEvaluation>,
  simRowByKey: Map<string, Record<string, unknown>>,
  scale?: (key: string, equalCap: number) => number,
): number | null {
  let sum = 0;
  let covered = 0;
  for (const pos of paperPortfolio) {
    const ev = evalByKey.get(pos.key);
    const equalCap = pos.capital;
    const cap = scale ? scale(pos.key, equalCap) : equalCap;
    if (cap <= 0) continue;

    const fromEval = ev?.pnlPct24h;
    if (fromEval != null && Number.isFinite(fromEval)) {
      sum += roundEur((cap * fromEval) / 100);
      covered += 1;
      continue;
    }
    const simRow = simRowByKey.get(pos.key);
    const dailyPct = simRow ? dailyChangePctFromRow(simRow) : null;
    if (dailyPct != null && Number.isFinite(dailyPct)) {
      const markPct = sanitizePaperMovePct(ev?.pnlPct ?? pos.lastMarkPct) ?? 0;
      const pnlEur = roundEur((cap * markPct) / 100);
      const valueNow = cap + pnlEur;
      sum += valueNow > 0 ? pnlEurFromDailyPct(valueNow, dailyPct) : roundEur((cap * dailyPct) / 100);
      covered += 1;
    }
  }
  return covered > 0 ? roundEur(sum) : null;
}

function synthCapForKey(
  key: string,
  equalCap: number,
  shareByRowKey: Record<string, number>,
  totalCapitalEur: number,
): number {
  const share = shareByRowKey[key];
  if (typeof share === "number" && Number.isFinite(share) && share >= 0 && totalCapitalEur > 0) {
    return roundEur(share * totalCapitalEur);
  }
  return equalCap;
}

export function buildMaturationOverview(opts: {
  ledger: PortfolioDailyPnlLedger | null;
  simTable: SheetTable | null;
  livePiggy: ExperimentPiggyBank;
  paperPortfolio: PaperPosition[];
  liveEvaluations: TickerSimEvaluation[];
  ticks: DecisionSimTick[];
  synthLatest?: { closedPnlEur: number; openMtmEur: number } | null;
  synthSizing?: {
    shareByRowKey: Record<string, number>;
    totalCapitalEur: number;
  } | null;
}): MaturationOverviewGroup[] {
  const {
    ledger,
    simTable,
    livePiggy,
    paperPortfolio,
    liveEvaluations,
    ticks,
    synthLatest,
    synthSizing,
  } = opts;

  const evalByKey = new Map(liveEvaluations.map((e) => [e.key, e]));
  const simRowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const closedDeals = summarizePaperClosedDeals(ticks);
  const todayKey = new Date().toISOString().slice(0, 10);

  const out: MaturationOverviewGroup[] = [];

  if (ledger && ledger.rows.length > 0) {
    const closedSummary = summarizeClosedPiggyBankFromLedger(ledger);
    const closedPnl = roundEur(closedSummary.rawPnlEur);
    const openMtm = roundEur(ledger.openGrandTotal);
    const pnl24h =
      ledger.openDayTotals[todayKey] ??
      ledger.dayTotals[todayKey] ??
      null;
    out.push({
      id: "actual",
      openDeals: ledger.openRowCount,
      closedDeals: ledger.archivedRowCount,
      closedPnlEur: closedPnl,
      openMtmEur: openMtm,
      totalPnlEur: roundEur(closedPnl + openMtm),
      pnl24hEur: pnl24h != null && Number.isFinite(pnl24h) ? roundEur(pnl24h) : null,
    });
  }

  const simClosed = roundEur(livePiggy.closedPnlEur ?? closedDeals.rawPnlEur);
  const simOpen = roundEur(livePiggy.openMtmPnlEur ?? 0);
  const sim24h = sumSimLoopOpenPnl24h(paperPortfolio, evalByKey, simRowByKey);
  out.push({
    id: "simEqual",
    openDeals: paperPortfolio.length,
    closedDeals: livePiggy.closedTradeCount ?? closedDeals.dealCount,
    closedPnlEur: simClosed,
    openMtmEur: simOpen,
    totalPnlEur: roundEur(livePiggy.totalPnlEur ?? simClosed + simOpen),
    pnl24hEur: sim24h,
  });

  if (synthLatest && synthSizing) {
    const scale = (key: string, equalCap: number) =>
      synthCapForKey(key, equalCap, synthSizing.shareByRowKey, synthSizing.totalCapitalEur);
    const synth24h = sumSimLoopOpenPnl24h(paperPortfolio, evalByKey, simRowByKey, scale);
    out.push({
      id: "simSynth",
      openDeals: paperPortfolio.length,
      closedDeals: livePiggy.closedTradeCount ?? closedDeals.dealCount,
      closedPnlEur: roundEur(synthLatest.closedPnlEur),
      openMtmEur: roundEur(synthLatest.openMtmEur),
      totalPnlEur: roundEur(synthLatest.closedPnlEur + synthLatest.openMtmEur),
      pnl24hEur: synth24h,
    });
  }

  return out;
}

export function maturationOverviewLabel(id: MaturationOverviewGroup["id"], it: boolean): string {
  if (id === "actual") return it ? "Portfolio reale" : "Actual portfolio";
  if (id === "simSynth") return it ? "Sim loop · synth" : "Sim loop · synth";
  return it ? "Sim loop" : "Sim loop";
}
