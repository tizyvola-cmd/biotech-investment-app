/**
 * Loads the full loss-risk catalog (per ticker) used by the Risk column in
 * the Dashboard recommendations table, the 24h Assessment view and the
 * Three-portfolios comparison.
 *
 * Internally wraps `buildThreePortfolioComparison` so every UI surface that
 * shows a risk score uses the *exact same* numbers (single source of truth).
 * The hook loads its own dependencies lazily — closed sim outcomes (for the
 * Phase A univariate screening) and the approved Phase B pattern (for the
 * +20 pattern-match bump). Consumers only need to pass the live simTable
 * and the SDS roster.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
  type SimOutcomeRow,
} from "../data/investmentSimOutcomesData";
import type { SdsRow } from "../api/supernova";
import { useLang } from "../shared/i18n";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { runUnivariateScreening } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import { useInvestSimInputs } from "./useInvestSimInputs";
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

/**
 * Portfolio budget used to translate each deal's `sizeShare` into an
 * actionable € recommendation displayed in the Risk cell.
 *
 * Kept as a single constant here (rather than threaded as a prop everywhere)
 * because the recommendation needs to make sense across all UI surfaces that
 * consume the loss-risk catalog. If the user later wants this to follow the
 * Capital pot stored at the top of the dashboard, we lift it to a hook
 * argument — for now 50 k € matches the brief.
 */
export const LOSS_RISK_DEFAULT_BUDGET_EUR = 50_000;

/**
 * Reactive map keyed by uppercase ticker — each entry contains everything
 * the `LossRiskPoopCell` + `LossRiskBreakdownModal` need to render. Tickers
 * absent from the catalog have no Phase A signal yet (the cell shows "—").
 */
export type LossRiskCatalog = Map<string, LossRiskEntry>;

function dealToLossRiskEntry(
  deal: ComparisonDeal,
  sizing?: { eur: number; pct: number } | null,
  sizingAvailable = false,
): LossRiskEntry {
  return {
    ticker: deal.ticker,
    phaseLabel: deal.cells.clinicalPhase ?? "",
    riskScore: deal.riskScore,
    lossRisk: deal.lossRisk,
    cells: deal.cells,
    recommendedSizeEur:
      sizingAvailable && sizing ? Math.round(sizing.eur) : null,
    recommendedSizePct: sizingAvailable && sizing ? sizing.pct : null,
    recommendedSizeBudgetEur: sizingAvailable ? LOSS_RISK_DEFAULT_BUDGET_EUR : null,
  };
}

export function useLossRiskCatalog(args: {
  simTable: SheetTable | null;
  sdsRows: SdsRow[] | null | undefined;
  /** Chart bundle — feeds the monitor pipeline used by the comparison build. */
  chartBundle: ChartBundle | null;
  /** Bump to invalidate (e.g. after a refresh of sim outcomes). */
  reloadToken?: number;
  /** Bump after the user approves/clears a Phase B pattern. */
  patternStoreVersion?: number;
}): {
  catalog: LossRiskCatalog;
  /** Row-key index — covers every sim/monitor row, not only BUY sim-loop deals. */
  catalogByRowKey: Map<string, LossRiskEntry>;
  loading: boolean;
} {
  const { simTable, sdsRows, chartBundle, reloadToken = 0, patternStoreVersion = 0 } = args;
  const { lang } = useLang();
  const inputs = useInvestSimInputs(simTable, reloadToken);
  const [closedRows, setClosedRows] = useState<SimOutcomeRow[]>([]);
  const [outcomesLoading, setOutcomesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOutcomesLoading(true);
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      if (cancelled) return;
      setClosedRows(closedSimOutcomeRowsFromDoc(doc));
      setOutcomesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Approved Phase B pattern — re-read when parent bumps patternStoreVersion.
  const approvedPattern = useMemo<RiskPattern | null>(() => {
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );

  const calibrationSnapshot = useMemo(() => {
    try {
      return computeCalibrationSnapshot(closedRows, { simTable, sdsRows: sdsRows ?? undefined });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  const sdsBreakdown = useMemo(
    () => computeSdsGainBreakdown(closedRows, { simTable, sdsRows: sdsRows ?? undefined }),
    [closedRows, simTable, sdsRows],
  );

  const phaseA = useMemo<PhaseAResult | null>(() => {
    try {
      return runUnivariateScreening(closedRows, {
        simTable,
        sdsRows: sdsRows ?? undefined,
      });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  // Reuse the same builder as ThreePortfolioCompareView so the riskScore is
  // numerically identical across every surface. The total capital pot is
  // irrelevant to risk-scoring (it only affects allocation €), so we pass a
  // placeholder of 1 000 000 to keep the allocators happy.
  const { catalog, catalogByRowKey } = useMemo(() => {
    const byTicker: LossRiskCatalog = new Map();
    const byRowKey = new Map<string, LossRiskEntry>();
    if (!simTable?.rows?.length) return { catalog: byTicker, catalogByRowKey: byRowKey };
    try {
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
      // Weighted sizing across the full union (mine + sim loop). Same module
      // that powers the Step 3 "Risk-weighted portfolio sizing" chart — so
      // the recommendation shown in the Risk cell and the one driving the
      // chart are guaranteed to use the same numbers (no duplicate logic).
      let patternMatchByRowKey = new Map<string, boolean>();
      if (approvedPattern) {
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

      // KPI snapshot / opportunities include WAIT/HOLD rows outside the BUY-only
      // sim-loop universe — index every monitor row by rowKey so Risk & Benefit
      // can resolve per deal, not only per ticker in the three-portfolio union.
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

      // Any remaining sim-table row (e.g. off-portfolio opportunity not yet
      // surfaced by the monitor pipeline).
      for (const rec of simTable.rows) {
        const tickerRaw = String(
          (rec as Record<string, unknown>).Ticker ??
            (rec as Record<string, unknown>).ticker ??
            "",
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
      /* swallow — empty catalog is a safe fallback (cells render "—") */
    }
    return { catalog: byTicker, catalogByRowKey: byRowKey };
  }, [
    simTable,
    closedRows,
    sdsRows,
    inputs,
    pointsBySeriesKey,
    lang,
    calibrationSnapshot,
    sdsBreakdown,
    phaseA,
    approvedPattern,
  ]);

  // Keep a ref to detect changes without re-creating the consumer on every
  // render — useful for tables that snapshot the catalog on demand.
  const ref = useRef(catalog);
  ref.current = catalog;

  return { catalog, catalogByRowKey, loading: outcomesLoading };
}

/** Convenience lookup — returns the entry for a ticker (uppercase tolerant). */
export function lookupLossRisk(
  catalog: LossRiskCatalog,
  ticker: string | null | undefined,
): LossRiskEntry | null {
  if (!ticker) return null;
  return catalog.get(String(ticker).toUpperCase()) ?? null;
}

/** Lookup by sim row key — preferred for KPI snapshot / loss-analysis tables. */
export function lookupLossRiskByRowKey(
  catalogByRowKey: Map<string, LossRiskEntry>,
  rowKey: string | null | undefined,
): LossRiskEntry | null {
  if (!rowKey) return null;
  return catalogByRowKey.get(rowKey) ?? null;
}
