/**
 * Score Validation Export — enriched daily audit for statistical correlation analysis.
 *
 * Extends the base gain audit with:
 * 1. Per-day scores: Rescue, P(plan), P(recovery), Composite, slope5d
 * 2. Trade state: entry price, price vs entry %, days since entry, suggested action
 * 3. Position-level outcome summary (separate sheet): final P&L, max drawdown,
 *    time to recovery, max gain, time to max gain
 */

import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { getMcsForDate, type MarketContextSnapshotDoc } from "./marketContextScore";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { buildSimRowByKeyMap } from "./investSimKeys";
import { calendarDayKeyFromDate } from "./ledgerDayWindow";
import {
  buildPortfolioDailyPnlLedger,
  computeSimulationPosition,
  scaleCloseSeriesToEntryCapital,
  sheetBuyPriceFromRow,
  tickerDailyCloseSeries,
} from "./simulationPosition";
import { computeRescueScoreBreakdown, computeRescueScoreExtendedBreakdown, computeEisFeedWindowScore } from "./lossRescueEngine";
import { computeCompositeScore, type CompositeScoreInput } from "../lib/scoring/compositeScore";
import { extractCurveInputs } from "./precatCurve";
import type { InvestSimInputEntry } from "./investSimStorage";
import { buildLossAnalysisItems } from "./portfolioLossAnalysis";
import { deriveSuggestedAction } from "./investDecisionSimLoop";
import {
  resolvePortfolioPositionActionForRow,
  type PortfolioPositionAction,
} from "./portfolioPositionAction";
import { getFrozenFeatures } from "../calibration/featureSnapshotStore";
import {
  computeRiskScoreV2,
  riskScoreV2InputFromSources,
} from "./riskScoreV2";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type ScoreValidationDayRow = {
  ticker: string;
  completionDate: string;
  status: "open" | "closed";
  day: string;
  daysSinceEntry: number | null;

  // Prices
  entryPriceUsd: number | null;
  closePriceUsd: number | null;
  priceVsEntryPct: number | null;

  // Scores (null = not applicable for this day/position)
  rescueScore: number | null;
  rescueProbPt: number | null;
  rescueLossPt: number | null;
  rescueEisPt: number | null;
  /** Diagnostic — all positions with valid entry price; Loss depth = 0 when price vs entry ≥ 0. */
  rescueScoreExtended: number | null;
  rescueExtendedProbPt: number | null;
  rescueExtendedLossPt: number | null;
  rescueExtendedEisPt: number | null;
  pPlan: number | null;
  compositeScore: number | null;
  compositeZone: string | null;
  slope5d: number | null;
  slope20d: number | null;

  // Suggested action
  suggestedAction: string | null;
};

export type ScoreValidationOutcomeRow = {
  ticker: string;
  completionDate: string;
  status: "open" | "closed";
  entryPriceUsd: number | null;
  entryDate: string;
  finalPnlPct: number | null;
  maxDrawdownPct: number | null;
  timeToRecoveryDays: number | null;
  maxGainPct: number | null;
  timeToMaxGainDays: number | null;
  holdDays: number | null;
  // Cause attribution diagnostics
  volumeAnomalyScore: number | null;
  volumeZscore: number | null;
  externalAlignmentScore: number | null;
  returnGapPct: number | null;
  internalCauseFlag: boolean | null;
  externalCauseFlag: boolean | null;
  /** Primary Risk v2 score at entry. */
  riskScoreV2: number | null;
  /** Secondary Phase A bucket loss-rate score (diagnostic). */
  riskScorePhaseA: number | null;
  riskScoreV2Plan: number | null;
  riskScoreV2Timing: number | null;
  riskScoreV2Liquidity: number | null;
  riskScoreV2Regulatory: number | null;
  riskScoreV2ComponentsUsed: string | null;
  /** Global MCS on entry date (same for all tickers that day). */
  mcsGlobal: number | null;
  mcsDataQuality: string | null;
};

export type RiskV2ComponentPopulation = {
  plan: number;
  timing: number;
  liquidity: number;
  regulatory: number;
};

export type ScoreValidationExport = {
  generatedAt: string;
  dayRows: ScoreValidationDayRow[];
  outcomeRows: ScoreValidationOutcomeRow[];
  warnings: string[];
  /** Closed/open positions with each Risk v2 component populated (for weight recalibration gate). */
  riskV2ComponentPopulation: RiskV2ComponentPopulation;
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isMarketDay(dayKey: string): boolean {
  const dow = new Date(dayKey + "T12:00:00Z").getUTCDay();
  return dow !== 0 && dow !== 6;
}

function dayDiff(from: string, to: string): number | null {
  const a = Date.parse(from + "T12:00:00Z");
  const b = Date.parse(to + "T12:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function parseSimNum(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—" || raw === "-") return null;
  const n = Number(String(raw).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * P(plan) — aligned with Model Quality / SellsQualityPanel / LossRescuePanel sources.
 */
export function extractPPlanFromSimRow(
  simRow: Record<string, unknown> | undefined,
  inp?: InvestSimInputEntry | null,
  rowKey?: string,
): number | null {
  if (simRow) {
    const affidLive = parseSimNum(simRow["affid_live"]);
    if (affidLive != null && affidLive > 0) {
      return round2(affidLive > 1 ? affidLive : affidLive * 100);
    }
    for (const key of [
      "Plan_Prob_Pct",
      "Affidabilità\ncalib %",
      "Affidabilità\n%",
      "Recovery Probability %",
      "P(plan) %",
      "Prob_Plan_%",
    ]) {
      const raw = simRow[key];
      if (raw == null || raw === "" || raw === "—") continue;
      const n = parseSimNum(raw);
      if (n == null) continue;
      const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
      if (pct > 0) return round2(pct);
    }
    const affidCol = Object.keys(simRow).find((k) => k.toLowerCase().includes("affidabilit"));
    if (affidCol) {
      const n = parseSimNum(simRow[affidCol]);
      if (n != null) {
        const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
        if (pct > 0) return round2(pct);
      }
    }
  }
  if (rowKey?.trim()) {
    const frozen = getFrozenFeatures(rowKey.trim());
    if (frozen?.pplanPct != null && frozen.pplanPct > 0) {
      return round2(frozen.pplanPct);
    }
  }
  const saved = inp?.entryProbPct;
  if (saved != null && Number.isFinite(saved) && saved > 0) {
    return round2(saved);
  }
  return null;
}

/** Slopes from Simulation row — same helper as portfolio loss analysis. */
export function extractSlopesFromSimRow(simRow: Record<string, unknown> | undefined): {
  slope5d: number | null;
  slope20d: number | null;
} {
  if (!simRow) return { slope5d: null, slope20d: null };
  const curves = extractCurveInputs(simRow);
  return {
    slope5d: curves.slope5d != null ? round2(curves.slope5d) : null,
    slope20d: curves.slope20d != null ? round2(curves.slope20d) : null,
  };
}

export function extractSuggestedActionFromSimRow(
  simRow: Record<string, unknown> | undefined,
): string | null {
  if (!simRow) return null;
  const raw = simRow["suggestedAction"] ?? simRow["Suggested Action"];
  if (raw == null || raw === "" || raw === "—") return null;
  const s = String(raw).trim().toLowerCase();
  return s || null;
}

function mapPortfolioActionToSuggested(action: PortfolioPositionAction): string {
  if (action === "sell") return "sell";
  if (action === "hold") return "hold";
  return "hold";
}

/**
 * Suggested action for export — same engine as dashboard recommendations when
 * possible; per-day fallback for closed/historical rows via portfolio action.
 */
export function resolveExportSuggestedAction(
  key: string,
  status: "open" | "closed",
  priceVsEntryPct: number | null,
  capital: number,
  lossByKey: Map<string, import("./portfolioLossAnalysis").PortfolioLossAnalysisItem>,
  simRow: Record<string, unknown> | undefined,
): string | null {
  const fromSheet = extractSuggestedActionFromSimRow(simRow);
  if (fromSheet) return fromSheet;

  const lossItem = lossByKey.get(key);
  if (lossItem && status === "open") {
    const action = deriveSuggestedAction(lossItem, false);
    return action === "none" ? null : action;
  }

  if (!simRow || priceVsEntryPct == null) return null;
  const capitalEur = capital > 0 ? capital : 5000;
  const pnlEur = round2((capitalEur * priceVsEntryPct) / 100);
  const portfolioAction = resolvePortfolioPositionActionForRow(
    simRow,
    { pnlEur, pnlPct: priceVsEntryPct },
    null,
    capitalEur,
  );
  return mapPortfolioActionToSuggested(portfolioAction);
}

// ────────────────────────────────────────────────────────────────────────────
// Main export builder
// ────────────────────────────────────────────────────────────────────────────

export function buildScoreValidationExport(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
  sdsByTicker?: Map<string, SdsRow>;
  mcsSnapshot?: MarketContextSnapshotDoc | null;
}): ScoreValidationExport {
  const { simTable, inputs, history = [], lang = "en" } = opts;
  const hist = history ?? [];
  const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, hist);
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const dayRows: ScoreValidationDayRow[] = [];
  const outcomeRows: ScoreValidationOutcomeRow[] = [];
  const warnings: string[] = [];
  const todayKey = calendarDayKeyFromDate(new Date());

  const sdsRows = opts.sdsByTicker ? [...opts.sdsByTicker.values()] : null;
  const lossItems = buildLossAnalysisItems(
    "portfolio",
    simTable,
    inputs,
    new Map(),
    lang,
    hist,
    sdsRows?.length ? { sdsRows } : null,
  );
  const lossByKey = new Map(lossItems.map((item) => [item.key, item]));

  for (const lr of ledger.rows) {
    const inp = inputs[lr.key];
    const investedAt = resolveInvestedAt(lr.key, inp, hist);
    const simRow = rowByKey.get(lr.key);
    const pos = simRow ? computeSimulationPosition(simRow, inputs, { history: hist }) : null;

    const sheetBuy = simRow ? (sheetBuyPriceFromRow(simRow) ?? null) : null;
    const buyPriceUsd: number | null = (() => {
      if (inp?.buyPrice && inp.buyPrice > 0) return inp.buyPrice;
      if (pos?.buyPrice && pos.buyPrice > 0) return pos.buyPrice;
      if (sheetBuy && sheetBuy > 0) return sheetBuy;
      return null;
    })();
    const shares =
      buyPriceUsd != null && buyPriceUsd > 0 && lr.capital > 0
        ? lr.capital / buyPriceUsd
        : null;

    const purchaseDate = (() => {
      if (inp?.purchaseDate?.trim()) return inp.purchaseDate.trim().slice(0, 10);
      if (investedAt?.trim()) {
        const d = new Date(investedAt);
        if (!Number.isNaN(d.getTime())) return calendarDayKeyFromDate(d);
      }
      return "";
    })();

    const closeSeriesRaw = tickerDailyCloseSeries(hist, lr.key, investedAt);
    const closeSeries = scaleCloseSeriesToEntryCapital(
      closeSeriesRaw,
      lr.capital,
      inferHistoryEntryCapital(hist, lr.key),
    );

    // Resolve daily close prices (value series)
    const dayKeys = new Set<string>();
    if (purchaseDate) dayKeys.add(purchaseDate);
    for (const pt of closeSeries) {
      if (isMarketDay(pt.dayKey)) dayKeys.add(pt.dayKey);
    }
    if (!lr.archived && isMarketDay(todayKey)) dayKeys.add(todayKey);

    const sortedDays = [...dayKeys].sort();
    const status: "open" | "closed" = lr.archived ? "closed" : "open";

    // P(plan) — static per position (sim row + saved entry prob + frozen features)
    const pPlan = extractPPlanFromSimRow(simRow, inp, lr.key);
    const { slope5d, slope20d } = extractSlopesFromSimRow(simRow);
    const positionSuggestedAction = resolveExportSuggestedAction(
      lr.key,
      status,
      null,
      lr.capital,
      lossByKey,
      simRow,
    );

    // EIS window score for rescue
    const eisWindowScore = computeEisFeedWindowScore(lr.ticker, lang, null, null);

    // Track prices for outcome computation
    let minPricePct = 0;
    let maxPricePct = 0;
    let minDay: string | null = null;
    let maxDay: string | null = null;
    let recoveredDay: string | null = null;
    let lastPricePct: number | null = null;
    let hasPriceTrack = false;

    for (const day of sortedDays) {
      const posValueEur = closeSeries.find((pt) => pt.dayKey === day)?.value ?? null;
      const closePriceUsd =
        posValueEur != null && shares != null && shares > 0
          ? round2(posValueEur / shares)
          : null;

      const priceVsEntryPct =
        closePriceUsd != null && buyPriceUsd != null && buyPriceUsd > 0
          ? round2(((closePriceUsd - buyPriceUsd) / buyPriceUsd) * 100)
          : null;

      const daysSinceEntry = purchaseDate ? dayDiff(purchaseDate, day) : null;

      // Rescue score — only when position is below entry (operational rescue space)
      let rescueScore: number | null = null;
      let rescueProbPt: number | null = null;
      let rescueLossPt: number | null = null;
      let rescueEisPt: number | null = null;
      const sdsCA = opts.sdsByTicker?.get(lr.ticker.toUpperCase())?.cause_attribution;
      const causeInput = sdsCA
        ? {
            volumeAnomalyScore: sdsCA.volume_anomaly?.score ?? null,
            externalAlignmentScore: sdsCA.external_alignment?.score ?? null,
            cashRunwayRiskScore: sdsCA.cash_runway_risk?.score ?? null,
          }
        : null;
      if (priceVsEntryPct != null && priceVsEntryPct < -2) {
        const rb = computeRescueScoreBreakdown({
          ticker: lr.ticker,
          entryProbPct: pPlan,
          lastMarkPct: priceVsEntryPct,
          eisWindowScore,
          causeAttribution: causeInput,
        });
        rescueScore = rb.rescoreScore;
        rescueProbPt = rb.probPt;
        rescueLossPt = rb.lossPt;
        rescueEisPt = rb.eisPt;
      }

      // Rescue score (extended) — all days with valid price vs entry
      let rescueScoreExtended: number | null = null;
      let rescueExtendedProbPt: number | null = null;
      let rescueExtendedLossPt: number | null = null;
      let rescueExtendedEisPt: number | null = null;
      if (priceVsEntryPct != null) {
        const rbx = computeRescueScoreExtendedBreakdown({
          ticker: lr.ticker,
          entryProbPct: pPlan,
          lastMarkPct: priceVsEntryPct,
          eisWindowScore,
          causeAttribution: causeInput,
        });
        rescueScoreExtended = rbx.rescoreScore;
        rescueExtendedProbPt = rbx.probPt;
        rescueExtendedLossPt = rbx.lossPt;
        rescueExtendedEisPt = rbx.eisPt;
      }

      // Composite score (simplified — no full PortfolioLossAnalysisItem available per day)
      let compositeScore: number | null = null;
      let compositeZone: string | null = null;
      if (pPlan != null) {
        const cInput: CompositeScoreInput = {
          daysToCd: null, // not tracked daily
          hasPosition: true,
          currentPnlPct: priceVsEntryPct,
          probPlan: pPlan,
          slope20d: slope20d,
        };
        const cResult = computeCompositeScore(cInput);
        compositeScore = cResult.score;
        compositeZone = cResult.zone;
      }

      dayRows.push({
        ticker: lr.ticker,
        completionDate: lr.completionDate,
        status,
        day,
        daysSinceEntry,
        entryPriceUsd: buyPriceUsd,
        closePriceUsd,
        priceVsEntryPct,
        rescueScore,
        rescueProbPt,
        rescueLossPt,
        rescueEisPt,
        rescueScoreExtended,
        rescueExtendedProbPt,
        rescueExtendedLossPt,
        rescueExtendedEisPt,
        pPlan,
        compositeScore,
        compositeZone,
        slope5d,
        slope20d,
        suggestedAction:
          resolveExportSuggestedAction(
            lr.key,
            status,
            priceVsEntryPct,
            lr.capital,
            lossByKey,
            simRow,
          ) ?? positionSuggestedAction,
      });

      // Track outcome stats
      if (priceVsEntryPct != null) {
        hasPriceTrack = true;
        lastPricePct = priceVsEntryPct;
        if (priceVsEntryPct < minPricePct) {
          minPricePct = priceVsEntryPct;
          minDay = day;
        }
        if (priceVsEntryPct > maxPricePct) {
          maxPricePct = priceVsEntryPct;
          maxDay = day;
        }
        // Recovery: first day back above 0 after having been below
        if (minPricePct < -2 && priceVsEntryPct >= 0 && !recoveredDay) {
          recoveredDay = day;
        }
      }
    }

    // Build outcome row for this position
    const holdDays = sortedDays.length >= 2
      ? dayDiff(sortedDays[0]!, sortedDays[sortedDays.length - 1]!)
      : null;

    const timeToRecoveryDays = recoveredDay && minDay
      ? dayDiff(minDay, recoveredDay)
      : null;

    const timeToMaxGainDays = maxDay && purchaseDate
      ? dayDiff(purchaseDate, maxDay)
      : null;

    // Cause attribution from SDS snapshot (point-in-time)
    const causeAttr = opts.sdsByTicker?.get(lr.ticker.toUpperCase())?.cause_attribution;
    const volAnomaly = causeAttr?.volume_anomaly;
    const extAlign = causeAttr?.external_alignment;

    const sdsRow = opts.sdsByTicker?.get(lr.ticker.toUpperCase());
    const riskV2Input = riskScoreV2InputFromSources({
      entryPplanPct: pPlan,
      daysToCd: sdsRow?.days_to_cd ?? null,
      slope5d,
      sdsRow: sdsRow ?? null,
    });
    const riskV2 = computeRiskScoreV2(riskV2Input);

    const mcsDay =
      purchaseDate && opts.mcsSnapshot
        ? getMcsForDate(opts.mcsSnapshot, purchaseDate)
        : opts.mcsSnapshot?.latest ?? null;

    const canComputeOutcomePct = buyPriceUsd != null && buyPriceUsd > 0 && hasPriceTrack;

    outcomeRows.push({
      ticker: lr.ticker,
      completionDate: lr.completionDate,
      status,
      entryPriceUsd: buyPriceUsd,
      entryDate: purchaseDate,
      finalPnlPct: canComputeOutcomePct ? lastPricePct : null,
      maxDrawdownPct:
        canComputeOutcomePct && minPricePct < 0 ? round2(minPricePct) : null,
      timeToRecoveryDays,
      maxGainPct:
        canComputeOutcomePct && maxPricePct > 0 ? round2(maxPricePct) : null,
      timeToMaxGainDays,
      holdDays,
      volumeAnomalyScore: volAnomaly?.score ?? null,
      volumeZscore: volAnomaly?.volume_zscore ?? null,
      externalAlignmentScore: extAlign?.score ?? null,
      returnGapPct: extAlign?.return_gap_pct ?? null,
      internalCauseFlag: causeAttr?.internal_cause_flag ?? null,
      externalCauseFlag: causeAttr?.external_cause_flag ?? null,
      riskScoreV2: riskV2.score,
      riskScorePhaseA: null,
      riskScoreV2Plan: riskV2.plan,
      riskScoreV2Timing: riskV2.timing,
      riskScoreV2Liquidity: riskV2.liquidity,
      riskScoreV2Regulatory: riskV2.regulatory,
      riskScoreV2ComponentsUsed: riskV2.componentsUsed.join(",") || null,
      mcsGlobal: mcsDay?.mcs_global ?? null,
      mcsDataQuality: mcsDay?.data_quality
        ? Object.entries(mcsDay.data_quality)
            .map(([k, v]) => `${k}:${v}`)
            .join(";")
        : null,
    });
  }

  // Warnings
  if (dayRows.length === 0) {
    warnings.push("No daily data generated — check history and inputs.");
  }
  const missingBuy = outcomeRows.filter((r) => r.entryPriceUsd == null);
  if (missingBuy.length > 0) {
    warnings.push(
      `${missingBuy.length} position(s) missing buy price — scores dependent on priceVsEntry will be null.`,
    );
  }

  const riskV2ComponentPopulation: RiskV2ComponentPopulation = {
    plan: outcomeRows.filter((r) => r.riskScoreV2Plan != null).length,
    timing: outcomeRows.filter((r) => r.riskScoreV2Timing != null).length,
    liquidity: outcomeRows.filter((r) => r.riskScoreV2Liquidity != null).length,
    regulatory: outcomeRows.filter((r) => r.riskScoreV2Regulatory != null).length,
  };
  if (
    riskV2ComponentPopulation.plan > 50 &&
    riskV2ComponentPopulation.timing > 50 &&
    riskV2ComponentPopulation.liquidity > 50 &&
    riskV2ComponentPopulation.regulatory > 50
  ) {
    warnings.push(
      lang === "it"
        ? "Risk v2: campione sufficiente per ricalibrazione pesi (tutti i componenti n>50) — rieseguire validazione."
        : "Risk v2: sample large enough for weight recalibration (all components n>50) — rerun validation.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    dayRows,
    outcomeRows,
    warnings,
    riskV2ComponentPopulation,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (private)
// ────────────────────────────────────────────────────────────────────────────

function inferHistoryEntryCapital(
  history: InvestSimHistoryPoint[],
  key: string,
): number | null {
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (!snap) continue;
    const entry = round2(snap.value - snap.pnl);
    if (entry > 0) return entry;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Spreadsheet XML builder
// ────────────────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(value: string | number | null | undefined, type: "String" | "Number"): string {
  if (value == null || value === "") {
    return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
  }
  if (type === "Number" && typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

const DAY_HEADERS = [
  "Ticker",
  "CD",
  "Status",
  "Day",
  "Days since entry",
  "Entry price ($)",
  "Close price ($)",
  "Price vs entry (%)",
  "Rescue score",
  "Rescue P(plan) pt",
  "Rescue Loss depth pt",
  "Rescue EIS pt",
  "Rescue score (extended)",
  "Rescue ext. P(plan) pt",
  "Rescue ext. Loss depth pt",
  "Rescue ext. EIS pt",
  "P(plan) %",
  "Composite score",
  "Composite zone",
  "Slope 5d",
  "Slope 20d",
  "Suggested action",
];

const OUTCOME_HEADERS = [
  "Ticker",
  "CD",
  "Status",
  "Entry price ($)",
  "Entry date",
  "Final P&L (%)",
  "Max drawdown (%)",
  "Time to recovery (days)",
  "Max gain (%)",
  "Time to max gain (days)",
  "Hold days",
  "Vol. anomaly score",
  "Vol. z-score",
  "Ext. alignment score",
  "Return gap (%)",
  "Internal cause flag",
  "External cause flag",
  "Risk score",
  "Risk score phase A",
  "Risk v2 plan",
  "Risk v2 timing",
  "Risk v2 liquidity",
  "Risk v2 regulatory",
  "Risk v2 components used",
  "MCS global",
  "MCS data quality",
];

export function buildScoreValidationSpreadsheetXml(
  exp: ScoreValidationExport,
): string {
  const dayHeaderRow = `<Row>${DAY_HEADERS.map((h) => xmlCell(h, "String")).join("")}</Row>`;
  const dayDataRows = exp.dayRows
    .map((r) =>
      `<Row>${[
        xmlCell(r.ticker, "String"),
        xmlCell(r.completionDate, "String"),
        xmlCell(r.status, "String"),
        xmlCell(r.day, "String"),
        xmlCell(r.daysSinceEntry, "Number"),
        xmlCell(r.entryPriceUsd, "Number"),
        xmlCell(r.closePriceUsd, "Number"),
        xmlCell(r.priceVsEntryPct, "Number"),
        xmlCell(r.rescueScore, "Number"),
        xmlCell(r.rescueProbPt, "Number"),
        xmlCell(r.rescueLossPt, "Number"),
        xmlCell(r.rescueEisPt, "Number"),
        xmlCell(r.rescueScoreExtended, "Number"),
        xmlCell(r.rescueExtendedProbPt, "Number"),
        xmlCell(r.rescueExtendedLossPt, "Number"),
        xmlCell(r.rescueExtendedEisPt, "Number"),
        xmlCell(r.pPlan, "Number"),
        xmlCell(r.compositeScore, "Number"),
        xmlCell(r.compositeZone, "String"),
        xmlCell(r.slope5d, "Number"),
        xmlCell(r.slope20d, "Number"),
        xmlCell(r.suggestedAction, "String"),
      ].join("")}</Row>`,
    )
    .join("");

  const outcomeHeaderRow = `<Row>${OUTCOME_HEADERS.map((h) => xmlCell(h, "String")).join("")}</Row>`;
  const outcomeDataRows = exp.outcomeRows
    .map((r) =>
      `<Row>${[
        xmlCell(r.ticker, "String"),
        xmlCell(r.completionDate, "String"),
        xmlCell(r.status, "String"),
        xmlCell(r.entryPriceUsd, "Number"),
        xmlCell(r.entryDate, "String"),
        xmlCell(r.finalPnlPct, "Number"),
        xmlCell(r.maxDrawdownPct, "Number"),
        xmlCell(r.timeToRecoveryDays, "Number"),
        xmlCell(r.maxGainPct, "Number"),
        xmlCell(r.timeToMaxGainDays, "Number"),
        xmlCell(r.holdDays, "Number"),
        xmlCell(r.volumeAnomalyScore, "Number"),
        xmlCell(r.volumeZscore, "Number"),
        xmlCell(r.externalAlignmentScore, "Number"),
        xmlCell(r.returnGapPct, "Number"),
        xmlCell(r.internalCauseFlag != null ? (r.internalCauseFlag ? "TRUE" : "FALSE") : null, "String"),
        xmlCell(r.externalCauseFlag != null ? (r.externalCauseFlag ? "TRUE" : "FALSE") : null, "String"),
        xmlCell(r.riskScoreV2, "Number"),
        xmlCell(r.riskScorePhaseA, "Number"),
        xmlCell(r.riskScoreV2Plan, "Number"),
        xmlCell(r.riskScoreV2Timing, "Number"),
        xmlCell(r.riskScoreV2Liquidity, "Number"),
        xmlCell(r.riskScoreV2Regulatory, "Number"),
        xmlCell(r.riskScoreV2ComponentsUsed, "String"),
        xmlCell(r.mcsGlobal, "Number"),
        xmlCell(r.mcsDataQuality, "String"),
      ].join("")}</Row>`,
    )
    .join("");

  const warningRows = exp.warnings.length > 0
    ? exp.warnings.map((w) => `<Row>${xmlCell("⚠ " + w, "String")}</Row>`).join("")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Daily Scores">
<Table>${dayHeaderRow}${dayDataRows}</Table>
</Worksheet>
<Worksheet ss:Name="Outcome Summary">
<Table>${outcomeHeaderRow}${outcomeDataRows}</Table>
</Worksheet>
<Worksheet ss:Name="Notes">
<Table>
<Row>${xmlCell("Score Validation Export — SuperNova", "String")}</Row>
<Row>${xmlCell("Generated: " + exp.generatedAt, "String")}</Row>
<Row>${xmlCell("", "String")}</Row>
<Row>${xmlCell("Column notes:", "String")}</Row>
<Row>${xmlCell("Rescue score: only populated when Price vs entry < -2% (rescue space). null = not applicable.", "String")}</Row>
<Row>${xmlCell("Rescue score (extended): same formula on all rows with entry price; Loss depth = 0 when Price vs entry >= 0%. For diagnostic analysis only.", "String")}</Row>
<Row>${xmlCell("P(plan): Affidabilità / Plan_Prob_Pct / affid_live (same sources as Model Quality). Static per position.", "String")}</Row>
<Row>${xmlCell("Composite score: 0-100 weighted blend of P(plan), slope, timing, SDS, EIS.", "String")}</Row>
<Row>${xmlCell("Max drawdown / max gain: empty when entry price missing — never 0 as placeholder.", "String")}</Row>
<Row>${xmlCell("Max drawdown: most negative Price vs entry % during hold period.", "String")}</Row>
<Row>${xmlCell("Time to recovery: days from max drawdown to first day back at or above entry.", "String")}</Row>
<Row>${xmlCell("Vol. anomaly score: 0-100 volume z-score normalized. High = anomalous volume (likely internal event).", "String")}</Row>
<Row>${xmlCell("Ext. alignment score: 0-100 return gap vs XBI. High = aligned with sector (likely external cause).", "String")}</Row>
<Row>${xmlCell("Risk score: Risk v2 (plan/timing/liquidity/regulatory) — provisional weights 40/25/25/10.", "String")}</Row>
<Row>${xmlCell("Risk score phase A: bucket loss-rate diagnostic (secondary); null when not computed on this row.", "String")}</Row>
<Row>${xmlCell("Risk v2 component population (n with non-null component): plan=" + exp.riskV2ComponentPopulation.plan + " timing=" + exp.riskV2ComponentPopulation.timing + " liquidity=" + exp.riskV2ComponentPopulation.liquidity + " regulatory=" + exp.riskV2ComponentPopulation.regulatory, "String")}</Row>
<Row>${xmlCell("Internal cause flag: TRUE when vol anomaly >= 60 AND ext alignment < 40.", "String")}</Row>
<Row>${xmlCell("External cause flag: TRUE when ext alignment >= 60 AND vol anomaly < 40.", "String")}</Row>
${warningRows}
</Table>
</Worksheet>
</Workbook>`;
}

export function downloadScoreValidationExcel(exp: ScoreValidationExport): void {
  const xml = buildScoreValidationSpreadsheetXml(exp);
  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `supernova-score-validation_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
