import type { MobileCurveChartsPayload, MobileDashboardSnapshot } from "./dashboardTypes";
import { decisionRecFromSnapshot, findDecisionRowInSnapshot } from "./decisionChartSnapshot";
import type { DecisionChartTickerRow, DecisionRec, DecisionScoreInput } from "./decisionChartLogic";
import {
  getDiagnosticNote,
  isRescuePosition,
  resolveDecisionChartRec,
} from "./decisionChartLogic";
import type { MobileScoreEnrichment } from "./hooks/useMobileScoreEnrichment";
import { buildMobilePriceWindows } from "./mobilePriceVariation";
import { buildOpportunityAlertMessage, buildRescueNote } from "./mobileOpportunityAlert";
import {
  eisFromSources,
  probPctFromRow,
  regRiskFromSources,
  riskV2FromRow,
  sdsFromSources,
} from "./mobileDecisionScoreResolve";
import { computeTickerMcs, xbiClosesFromSnapshot } from "./mobileMarketContext";
import { resolveSimRowLiquidityScore } from "./mobileSimRowLiquidity";
import { clinicalPhaseFromSimRow, formatCdDateShort } from "./mobileSimRowClinicalMeta";
import { daysFromCompletionDate } from "./opportunityLogic";
import {
  computeSimulationPosition,
  normalizedRowKey,
  parseNum,
  rowHasActivePortfolio,
} from "./simLogic";
import type { ChartBundle, ChartPoint, InvestSimInputs } from "./types";
import type { MobileOpportunityCardProps } from "./components/MobileOpportunityCard";
import { indicatorIsContextOnly, prepareClinicalIndicators } from "./eis/clinicalIndicators";
import type { ClinicalStudyIndicator, ClinicalPreCdRecord } from "./api";
import { manualEisForTicker } from "./gainStarDisplay";

function operationalRecFromSnapshot(
  snapshot: MobileDashboardSnapshot | null,
  key: string,
): DecisionRec | null {
  const rec = snapshot?.recommendations?.find((r) => r.key === key);
  if (!rec?.action) return null;
  const a = rec.action.trim().toUpperCase();
  if (a === "BUY" || a.startsWith("BUY") || a.includes("COMPRA") || a.includes("ENTRA")) return "buy";
  if (a === "SELL" || a.includes("EXIT") || a.includes("VEND") || a.includes("USC")) return "sell";
  if (a === "HOLD" || a.includes("MANTIEN")) return "hold";
  if (a === "REVIEW" || a === "UNCERTAIN" || a === "INCERTO" || a.includes("RIVEDI") || a.includes("ATTEND") || a.includes("INCERT")) return "review";
  return null;
}

function chartPointsForRow(bundle: ChartBundle | null, row: Record<string, unknown>): ChartPoint[] | null {
  const tk = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "").trim();
  if (!tk || !cd || cd === "—") return null;
  const key = normalizedRowKey(tk, cd);
  const [, iso] = key.split("|");
  const sk = iso && iso !== "—" ? `co:${tk}|${iso}` : null;
  if (!sk || !bundle?.series?.[sk]?.points?.length) return null;
  return bundle.series[sk].points ?? null;
}

function formatCdDate(cd: string): string {
  return formatCdDateShort(cd);
}

function phaseFromRow(row: Record<string, unknown>): string {
  return clinicalPhaseFromSimRow(row) || "—";
}

function clinicalRowsFromIndicators(
  indicators: ClinicalStudyIndicator[] | undefined | null,
  it: boolean,
): MobileOpportunityCardProps["clinicalIndicators"] {
  const valid = prepareClinicalIndicators(indicators ?? []);
  return valid.slice(0, 8).map((ind) => {
    const contextOnly = indicatorIsContextOnly(ind);
    const badge =
      contextOnly ? ("CTX" as const) : ind.kpi_type === "efficacy" ? ("EFF" as const) : null;
    return {
      label: (ind.label ?? "").trim() || (it ? "Indicatore" : "Indicator"),
      value: ind.value ?? "—",
      badge,
    };
  });
}

function resolveRegSignedScore(
  ticker: string,
  row: Record<string, unknown>,
  regSnap: import("./api").RegulatoryRiskSnapshot | null | undefined,
): number | null {
  const tk = ticker.trim().toUpperCase();
  const snapEntry = regSnap?.tickers?.[tk];
  if (snapEntry?.score != null && Number.isFinite(snapEntry.score)) return snapEntry.score;
  const raw = parseNum(findCol(row, "reg risk", "regulatory", "rischio reg", "reg risk score"));
  if (raw == null) return null;
  if (raw >= -100 && raw <= 100 && (raw < 0 || raw > 50)) return raw;
  return Math.round(raw * 2 - 100);
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

export function buildMobileOpportunityCardProps(opts: {
  row: Record<string, unknown>;
  inputs: InvestSimInputs;
  snapshot: MobileDashboardSnapshot | null;
  chartBundle: ChartBundle | null;
  enrichment: MobileScoreEnrichment;
  curveCharts?: MobileCurveChartsPayload | null;
  decisionRow?: DecisionChartTickerRow | null;
  clinicalIndicators?: ClinicalStudyIndicator[] | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  it?: boolean;
}): Omit<MobileOpportunityCardProps, "onOpenDetail"> {
  const {
    row,
    inputs,
    snapshot,
    chartBundle,
    enrichment,
    curveCharts,
    decisionRow: decisionRowHint,
    clinicalIndicators,
    clinicalRecords = [],
    it = false,
  } = opts;
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "—");
  const key = normalizedRowKey(ticker, cd);
  const decisionRow = decisionRowHint ?? findDecisionRowInSnapshot(snapshot, key);
  const snapRec = decisionRecFromSnapshot(snapshot, key);
  const daysToCD = daysFromCompletionDate(cd);
  const inPort = rowHasActivePortfolio(row, inputs);
  const pos = inPort ? computeSimulationPosition(row, inputs) : null;
  const pnlPct = pos?.pnlUnavailable ? null : pos?.pnlPct ?? null;

  const chartPts = chartPointsForRow(chartBundle, row);
  const xbiCloses = xbiClosesFromSnapshot(enrichment.mcsDoc);
  const tickerCloses = (chartPts ?? [])
    .map((p) => p.price_storico_usd)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const mcsDay = enrichment.mcsDoc?.latest;
  const mcs =
    mcsDay && tickerCloses.length && xbiCloses.length
      ? computeTickerMcs(mcsDay, tickerCloses, xbiCloses)
      : mcsDay?.mcs_global ?? null;

  const eis = eisFromSources(snapshot, key, row);
  const manualEis = manualEisForTicker(snapshot?.manualEisByTicker, ticker);
  const computedScores: DecisionScoreInput = {
    pplan: probPctFromRow(row, snapshot, key),
    sds: sdsFromSources(row, ticker, enrichment.sdsByTicker),
    eis: eis.display,
    eisRaw: manualEis?.score ?? eis.raw,
    riskV2: riskV2FromRow(row),
    regRisk: regRiskFromSources(row, ticker, enrichment.regSnap),
    mcs: mcs != null && Number.isFinite(mcs) ? Math.round(mcs) : null,
    pnlPct,
    isRescue: isRescuePosition(pnlPct),
    status: inPort ? "open" : "closed",
  };
  let scores = decisionRow?.scores ?? computedScores;
  if (manualEis?.score != null && Number.isFinite(manualEis.score)) {
    const raw = manualEis.score;
    scores = {
      ...scores,
      eisRaw: raw,
      eis: Math.round(Math.max(0, Math.min(100, 50 + raw))),
    };
  } else if (computedScores.eisRaw != null) {
    scores = { ...scores, eisRaw: computedScores.eisRaw, eis: computedScores.eis ?? scores.eis };
  }

  const rec =
    snapRec ??
    decisionRow?.rec ??
    resolveDecisionChartRec(scores, operationalRecFromSnapshot(snapshot, key));
  const regHigh = scores.regRisk != null && scores.regRisk >= 50;
  const rescueNote = buildRescueNote(scores.isRescue, regHigh, it);

  const priceWindows = buildMobilePriceWindows({
    simRow: row,
    marketDoc: enrichment.mcsDoc,
    chartPts,
  }).map((w) => ({
    window: w.window,
    tickerChange: w.tickerChange,
    marketChange: w.marketChange,
  }));

  const clinical = clinicalRowsFromIndicators(clinicalIndicators, it);
  const extraClinical = Math.max(0, prepareClinicalIndicators(clinicalIndicators ?? []).length - clinical.length);

  return {
    ticker,
    companyName: String(row.Società ?? row.Nome ?? row.Company ?? "").trim(),
    phase: phaseFromRow(row),
    daysToCD: daysToCD ?? 0,
    cdDate: formatCdDate(cd),
    recommendation: rec,
    pnlPct,
    isRescue: scores.isRescue,
    rescueNote,
    scores: {
      pplan: scores.pplan,
      sds: scores.sds,
      eis: scores.eis,
      riskV2: scores.riskV2,
      regRisk: scores.regRisk,
      mcs: scores.mcs,
      liquidity: resolveSimRowLiquidityScore(row),
    },
    alertMessage: buildOpportunityAlertMessage(scores, pnlPct, scores.isRescue, it),
    diagnostic: decisionRow?.diagnostic ?? getDiagnosticNote(scores, rec),
    priceWindows,
    clinicalIndicators: clinical,
    extraClinicalCount: extraClinical,
    simRow: row,
    curveCharts: curveCharts ?? null,
    hasPosition: inPort,
    eisRaw: scores.eisRaw ?? manualEis?.score ?? eis.raw,
    regSignedScore: resolveRegSignedScore(ticker, row, enrichment.regSnap),
    clinicalRecords,
    dashSnapshot: snapshot,
  };
}
