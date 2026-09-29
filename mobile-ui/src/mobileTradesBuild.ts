import type { MobileDashboardSnapshot } from "./dashboardTypes";
import type { DecisionChartTickerRow, DecisionRec } from "./decisionChartLogic";
import {
  aggregateRiskScore,
  buildMobileTradeCandidateRows,
} from "./mobileDecisionChartBuild";
import { suggestedInvestPctForBuy } from "./mobileBuySizing";
import type { MobileScoreEnrichment } from "./hooks/useMobileScoreEnrichment";
import { daysFromCompletionDate } from "./opportunityLogic";
import {
  computeSimulationPosition,
  currentPriceFromRow,
  normalizedRowKey,
  parseNum,
  rowHasActivePortfolio,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export type MobileTradeRow = {
  key: string;
  ticker: string;
  company: string;
  cd: string;
  riskScore: number | null;
  benefitScore: number | null;
  priceUsd: number | null;
  targetLabel: string;
  rec: DecisionRec;
  recSizePct: number | null;
  buyPrice: number;
  capital: number;
  inPortfolio: boolean;
};

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function companyFromRow(row: Record<string, unknown>): string {
  return String(row.Nome ?? row.Company ?? row.Società ?? row["Company Name"] ?? "").trim();
}

function planReturnFromRow(row: Record<string, unknown>): number | null {
  const raw = parseNum(findCol(row, "roi target", "target roi", "gain target", "roi plan", "roi→cd"));
  if (raw == null) return null;
  return Math.abs(raw) <= 1.5 ? raw * 100 : raw;
}

function roiTargetDays(row: Record<string, unknown>, snapshot: MobileDashboardSnapshot | null, key: string): number | null {
  const snap = snapshot?.recommendations?.find((r) => r.key === key);
  if (snap?.daysToTarget != null) return snap.daysToTarget;
  const fromRow = parseNum(findCol(row, "days to target", "giorni target", "days target"));
  if (fromRow != null) return Math.round(fromRow);
  return daysFromCompletionDate(String(row["Completion Date"] ?? ""));
}

function deriveBenefitScore(
  row: Record<string, unknown>,
  snapshot: MobileDashboardSnapshot | null,
  key: string,
  capital: number,
  pnlPct: number | null,
): number | null {
  const snap = snapshot?.recommendations?.find((r) => r.key === key);
  const expectedReturnPct = snap?.planReturnPct ?? planReturnFromRow(row);
  const daysToTarget = roiTargetDays(row, snapshot, key);
  let perDay: number | null = null;
  if (expectedReturnPct != null && daysToTarget != null && daysToTarget > 0) {
    perDay = expectedReturnPct / daysToTarget;
  } else if (capital >= 500 && (pnlPct == null || pnlPct > -15)) {
    const mv1d =
      parseNum(findCol(row, "var. giorn", "var giorn", "daily", "24h")) ??
      parseNum(row["Var. Giorn. %"]);
    if (mv1d != null && mv1d > 0) perDay = Math.abs(mv1d) <= 1.5 ? mv1d * 100 : mv1d;
  }
  if (perDay == null || perDay <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, (perDay / 1.5) * 100)));
}

function formatTarget(
  row: Record<string, unknown>,
  snapshot: MobileDashboardSnapshot | null,
  key: string,
): string {
  const snap = snapshot?.recommendations?.find((r) => r.key === key);
  const days = snap?.daysToTarget ?? roiTargetDays(row, snapshot, key);
  if (snap?.targetPriceUsd != null && Number.isFinite(snap.targetPriceUsd)) {
    return `$${snap.targetPriceUsd.toFixed(2)}${days != null ? ` · ${days}d` : ""}`;
  }
  const plan = snap?.planReturnPct ?? planReturnFromRow(row);
  if (plan != null && days != null) return `${plan.toFixed(0)}% · ${days}d`;
  if (plan != null) return `${plan.toFixed(0)}%`;
  return "—";
}

function enrichTradeRow(
  decision: DecisionChartTickerRow,
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
): MobileTradeRow {
  const pos = computeSimulationPosition(row, inputs);
  const inPortfolio = rowHasActivePortfolio(row, inputs);
  const buyPrice = pos?.buyPrice ?? 0;
  const capital = pos?.capital ?? 0;
  const riskScore = decision.scores.riskV2 ?? aggregateRiskScore(decision.scores);
  const benefitScore = deriveBenefitScore(row, snapshot, decision.key, capital, decision.pnlPct);
  const recSizePct = decision.rec === "buy" ? suggestedInvestPctForBuy(decision.scores) : null;

  return {
    key: decision.key,
    ticker: decision.ticker,
    company: decision.company ?? (companyFromRow(row) || decision.ticker),
    cd: String(row["Completion Date"] ?? "—"),
    riskScore: riskScore != null ? Math.round(riskScore) : null,
    benefitScore,
    priceUsd: currentPriceFromRow(row),
    targetLabel: formatTarget(row, snapshot, decision.key),
    rec: decision.rec,
    recSizePct,
    buyPrice,
    capital,
    inPortfolio,
  };
}

export function buildMobileTradeRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): MobileTradeRow[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of sheet?.rows ?? []) {
    const key = normalizedRowKey(String(row.Ticker ?? ""), String(row["Completion Date"] ?? ""));
    if (key) byKey.set(key, row);
  }

  const candidates = buildMobileTradeCandidateRows(sheet, inputs, snapshot, enrichment);
  return candidates
    .map((decision) => {
      const row = byKey.get(decision.key);
      if (!row) return null;
      return enrichTradeRow(decision, row, inputs, snapshot);
    })
    .filter((r): r is MobileTradeRow => r != null);
}
