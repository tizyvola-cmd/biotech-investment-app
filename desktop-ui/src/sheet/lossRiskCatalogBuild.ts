/**
 * Sync loss-risk catalog builder — same logic as useLossRiskCatalog (no React).
 */
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { runUnivariateScreening } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { buildSimRowByKeyMap, normalizedRowKey } from "../sheet/investSimKeys";
import {
  buildComparisonDealForLossRisk,
  buildThreePortfolioComparison,
  type ComparisonDeal,
} from "../sheet/threePortfolioCompare";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import {
  DEFAULT_WEIGHTED_SIZING_CONFIG,
  computeWeightedPortfolioStats,
} from "../sheet/portfolioWeightedSizing";
import { extractAllRowFeatures } from "../riskPattern/lossRiskScreening";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  LOSS_RISK_DEFAULT_BUDGET_EUR,
  type LossRiskCatalog,
  dealToLossRiskEntry,
} from "../hooks/useLossRiskCatalog";

export function buildLossRiskCatalogSync(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  chartBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null | undefined;
  closedRows: SimOutcomeRow[];
  lang: "it" | "en";
  approvedPattern?: RiskPattern | null;
}): { catalog: LossRiskCatalog; catalogByRowKey: Map<string, LossRiskEntry> } {
  const { simTable, inputs, chartBundle, sdsRows, closedRows, lang } = args;
  const byTicker: LossRiskCatalog = new Map();
  const byRowKey = new Map<string, LossRiskEntry>();
  if (!simTable?.rows?.length) return { catalog: byTicker, catalogByRowKey: byRowKey };

  let approvedPattern: RiskPattern | null = args.approvedPattern ?? null;
  if (approvedPattern === undefined) {
    try {
      approvedPattern = loadApprovedPattern().current ?? null;
    } catch {
      approvedPattern = null;
    }
  }

  try {
    const pointsBySeriesKey = chartPointsMapFromBundle(chartBundle);
    const calibrationSnapshot = computeCalibrationSnapshot(closedRows, {
      simTable,
      sdsRows: sdsRows ?? undefined,
    });
    const sdsBreakdown = computeSdsGainBreakdown(closedRows, {
      simTable,
      sdsRows: sdsRows ?? undefined,
    });
    const phaseA: PhaseAResult | null = runUnivariateScreening(closedRows, {
      simTable,
      sdsRows: sdsRows ?? undefined,
    });

    const sdsByTicker = new Map<string, SdsRow>();
    for (const s of sdsRows ?? []) {
      if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
    }
    const simRowByKey = buildSimRowByKeyMap(simTable.rows);
    const dealCtx = {
      sdsByTicker,
      snapshot: calibrationSnapshot,
      sdsBreakdown,
      phaseA,
      approvedPattern,
    };

    const putDeal = (
      deal: ComparisonDeal,
      sizing?: { eur: number; pct: number } | null,
      sizingAvailable = false,
    ) => {
      const entry = dealToLossRiskEntry(deal, sizing, sizingAvailable);
      byRowKey.set(deal.rowKey, entry);
      byTicker.set(deal.ticker.toUpperCase(), entry);
    };

    const comparison = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: sdsRows ?? null,
      inputs,
      pointsBySeriesKey,
      lang,
      calibrationSnapshot,
      sdsBreakdown,
      totalCapitalEur: 1_000_000,
      phaseA,
      approvedPattern,
    });

    let patternMatchByRowKey = new Map<string, boolean>();
    const patternStats = approvedPattern?.inSampleStats;
    const patternQualityOk =
      (patternStats?.lift ?? 0) >= 1.3 && (patternStats?.precision ?? 0) >= 0.5;
    if (approvedPattern && patternQualityOk) {
      try {
        const features = extractAllRowFeatures(closedRows, {
          simTable,
          sdsRows: sdsRows ?? undefined,
        });
        for (const d of comparison.allDeals) {
          const fk = Array.from(features.keys()).find((k) =>
            k.startsWith(`${d.ticker.toUpperCase()}|`),
          );
          if (!fk) continue;
          const fc = features.get(fk);
          if (!fc) continue;
          patternMatchByRowKey.set(d.rowKey, matchPattern(approvedPattern, fc));
        }
      } catch {
        patternMatchByRowKey = new Map();
      }
    }

    const sizingStats = computeWeightedPortfolioStats(
      comparison.allDeals,
      DEFAULT_WEIGHTED_SIZING_CONFIG,
      (deal) => patternMatchByRowKey.get(deal.rowKey) === true,
    );
    const sizingByRowKey = new Map<string, { eur: number; pct: number }>();
    for (const row of sizingStats.perDealBreakdown) {
      sizingByRowKey.set(row.rowKey, {
        eur: row.sizeShare * LOSS_RISK_DEFAULT_BUDGET_EUR,
        pct: row.sizeShare * 100,
      });
    }
    const sizingAvailable =
      !sizingStats.uniformFallbackActive && sizingStats.positionsCount > 0;
    for (const d of comparison.allDeals) {
      putDeal(d, sizingByRowKey.get(d.rowKey), sizingAvailable);
    }

    let monitorRows: ReturnType<typeof buildSuggestionMonitorRows> = [];
    try {
      monitorRows = buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        paperPortfolio: [],
      });
    } catch {
      monitorRows = [];
    }
    for (const m of monitorRows) {
      if (byRowKey.has(m.key)) continue;
      const ticker = String(m.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      const deal = buildComparisonDealForLossRisk(
        m.key,
        ticker,
        simRowByKey.get(m.key),
        m.probPct ?? null,
        {
          ...dealCtx,
          realizedReturnPct:
            m.pnlPct != null && Number.isFinite(m.pnlPct) ? m.pnlPct : null,
          realizedReturnPct24h:
            m.pnlPct24h != null && Number.isFinite(m.pnlPct24h) ? m.pnlPct24h : null,
        },
      );
      putDeal(deal);
    }

    for (const rec of simTable.rows) {
      const tickerRaw = String(
        (rec as Record<string, unknown>).Ticker ?? (rec as Record<string, unknown>).ticker ?? "",
      );
      if (!tickerRaw) continue;
      const ticker = tickerRaw.toUpperCase();
      const cd =
        (rec["Completion Date"] as string) ??
        (rec["Catalyst Date"] as string) ??
        (rec["CD"] as string) ??
        "";
      if (!cd) continue;
      const rowKey = normalizedRowKey(ticker, cd);
      if (byRowKey.has(rowKey)) continue;
      const deal = buildComparisonDealForLossRisk(
        rowKey,
        ticker,
        rec as Record<string, unknown>,
        null,
        dealCtx,
      );
      putDeal(deal);
    }
  } catch {
    /* empty catalog */
  }

  return { catalog: byTicker, catalogByRowKey: byRowKey };
}
