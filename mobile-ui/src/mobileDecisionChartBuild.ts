import type { MobileDashboardSnapshot } from "./dashboardTypes";
import {
  allDecisionRowsFromViews,
  findDecisionRowInSnapshot,
  resolveDecisionChartViews,
  snapshotHasDecisionChartData,
} from "./decisionChartSnapshot";
import {
  type DecisionChartTickerRow,
  type DecisionScoreInput,
  getDiagnosticNote,
  hasInsufficientScores,
  isRescuePosition,
  resolveDecisionChartRec,
} from "./decisionChartLogic";
import type { MobileScoreEnrichment } from "./hooks/useMobileScoreEnrichment";
import { daysFromCompletionDate } from "./opportunityLogic";
import {
  eisFromSources,
  probPctFromRow,
  regRiskFromSources,
  riskV2FromRow,
  rowKeyFromSimRow,
  sdsFromSources,
} from "./mobileDecisionScoreResolve";
import {
  computeSimulationPosition,
  rowHasActivePortfolio,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";
import { gainStarsForTicker, manualEisForTicker } from "./gainStarDisplay";

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function buildScoreInput(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): DecisionScoreInput {
  const key = rowKeyFromSimRow(row);
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const inPort = rowHasActivePortfolio(row, inputs);
  const pos = inPort ? computeSimulationPosition(row, inputs) : null;
  const pnlPct = pos?.pnlUnavailable ? null : pos?.pnlPct ?? null;
  const eis = eisFromSources(snapshot, key, row);
  return {
    pplan: probPctFromRow(row, snapshot, key),
    sds: sdsFromSources(row, ticker, enrichment.sdsByTicker),
    eis: eis.display,
    eisRaw: eis.raw,
    riskV2: riskV2FromRow(row),
    regRisk: regRiskFromSources(row, ticker, enrichment.regSnap),
    mcs: null,
    pnlPct,
    isRescue: isRescuePosition(pnlPct),
    status: inPort ? "open" : "closed",
  };
}

function operationalRecFromSnapshot(
  snapshot: MobileDashboardSnapshot | null,
  key: string,
): import("./decisionChartLogic").DecisionRec | null {
  const rec = snapshot?.recommendations?.find((r) => r.key === key);
  if (!rec?.action) return null;
  const a = rec.action.trim().toUpperCase();
  if (a === "BUY" || a.startsWith("BUY") || a.includes("COMPRA") || a.includes("ENTRA")) return "buy";
  if (a === "SELL" || a.includes("EXIT") || a.includes("VEND") || a.includes("USC")) return "sell";
  if (a === "HOLD" || a.includes("MANTIEN")) return "hold";
  if (a === "REVIEW" || a === "UNCERTAIN" || a === "INCERTO" || a.includes("RIVEDI") || a.includes("ATTEND") || a.includes("INCERT")) return "review";
  return null;
}

function buildRow(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): DecisionChartTickerRow | null {
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return null;
  const key = rowKeyFromSimRow(row);
  const inPort = rowHasActivePortfolio(row, inputs);
  const scores = buildScoreInput(row, inputs, snapshot, enrichment);
  const rec = resolveDecisionChartRec(scores, operationalRecFromSnapshot(snapshot, key));
  const gainStars = gainStarsForTicker(snapshot?.gainStarsByTicker, ticker);
  const manualEis = manualEisForTicker(snapshot?.manualEisByTicker, ticker);
  return {
    key,
    ticker,
    company: String(row.Società ?? row.Nome ?? row.Company ?? "").trim() || null,
    phaseLabel: String(findCol(row, "phase", "fase") ?? "").trim() || null,
    pnlPct: scores.pnlPct,
    scores,
    rec,
    diagnostic: getDiagnosticNote(scores, rec),
    insufficientScores: hasInsufficientScores(scores),
    hasPortfolio: inPort,
    manualGainStar: gainStars.length > 0 || Boolean(manualEis?.showProvisionalStar),
    gainStars,
  };
}

/** Portfolio + top off-portfolio rows with CD within 120d. */
export function buildMobileDecisionChartRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
  limit = 12,
): DecisionChartTickerRow[] {
  const out: DecisionChartTickerRow[] = [];
  const seen = new Set<string>();
  for (const row of sheet?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const built = buildRow(row, inputs, snapshot, enrichment);
    if (!built || seen.has(built.key)) continue;
    seen.add(built.key);
    out.push(built);
  }
  for (const row of sheet?.rows ?? []) {
    if (rowHasActivePortfolio(row, inputs)) continue;
    const days = daysFromCompletionDate(String(row["Completion Date"] ?? ""));
    if (days == null || days < -3 || days > 120) continue;
    const built = buildRow(row, inputs, snapshot, enrichment);
    if (!built || seen.has(built.key)) continue;
    seen.add(built.key);
    out.push(built);
  }
  const order: Record<string, number> = { buy: 0, review: 1, hold: 2, sell: 3 };
  return out
    .sort((a, b) => (order[a.rec] ?? 9) - (order[b.rec] ?? 9) || a.ticker.localeCompare(b.ticker))
    .slice(0, limit);
}

/** Portfolio + hot/watch opportunities — no practical row cap (Trades tab). */
export function buildMobileTradeCandidateRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): DecisionChartTickerRow[] {
  return resolveMobileDecisionRows(sheet, inputs, snapshot, enrichment, 500);
}

export function topBuyDecisionRow(rows: DecisionChartTickerRow[]): DecisionChartTickerRow | null {
  return rows.find((r) => r.rec === "buy") ?? null;
}

/** Resolve decision rows: desktop/VPS snapshot first; local recompute only when snapshot has no chart data. */
export function resolveMobileDecisionRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
  limit = 500,
): DecisionChartTickerRow[] {
  if (snapshotHasDecisionChartData(snapshot)) {
    return allDecisionRowsFromViews(resolveDecisionChartViews(snapshot)).slice(0, limit);
  }
  return buildMobileDecisionChartRows(sheet, inputs, snapshot, enrichment, limit);
}

export function resolveMobileDecisionRow(
  key: string,
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  snapshot: MobileDashboardSnapshot | null,
  enrichment: MobileScoreEnrichment,
): DecisionChartTickerRow | null {
  const fromSnap = findDecisionRowInSnapshot(snapshot, key);
  if (fromSnap) return fromSnap;
  return resolveMobileDecisionRows(sheet, inputs, snapshot, enrichment).find((r) => r.key === key) ?? null;
}

export function aggregateRiskScore(scores: DecisionScoreInput): number | null {
  const parts = [scores.riskV2, scores.regRisk].filter((v): v is number => v != null);
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}
