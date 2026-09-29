import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import type { AppScreen } from "../types";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  buildMissedOpportunityAudit,
  saveMissedOppSnapshot,
} from "../sheet/missedOpportunityAudit";
import { aggregateOpenPortfolioPnl } from "../sheet/simulationPosition";
import type { SuggestionMonitorRow } from "../sheet/suggestionMonitor";
import { DashboardAiFeedCard, type DashboardAiFeedItem } from "./DashboardAiFeedCard";
import { AdviceLearningsRecalculationBridge } from "./AdviceLearningsRecalculationBridge";
import { useLang } from "../shared/i18n";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  loadInvestmentSimOutcomes,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";
import { closedValidationOutcomeRowsFromDoc } from "../sheet/simOutcomeCycleDedup";
import { buildRealPortfolioAccuracySummary } from "../sheet/realPortfolioAccuracy";
import type {
  PortfolioSellEnrichContext,
  RealPortfolioAccuracySummary,
} from "../sheet/realPortfolioAccuracy";

export function DashboardChartsRow({
  simTable,
  chartBundle,
  sdsRows,
  aiFeed,
}: {
  simTable: SheetTable | null;
  chartBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null;
  dataUpdatedAt?: string | null;
  onNavigate?: (screen: AppScreen) => void;
  /** Accepted for backward-compat; no longer used inside this component. */
  monitorRows?: SuggestionMonitorRow[];
  aiFeed?: {
    feed: DashboardAiFeedItem[];
    recentCount: number;
    loading: boolean;
    loadError: string | null;
    updatedAt?: string | null;
    scopeLabel: string;
    onOpenFeed: () => void;
  };
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable);
  const portfolioHistory = useInvestSimPortfolioHistory().history;
  const polygonOverview = useCdPatternPolygonOverview();
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const [outcomesDoc, setOutcomesDoc] = useState<SimOutcomesDoc | null>(null);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      if (cancelled) return;
      setOutcomesDoc(doc ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows,
      migSolidityByKey: buildMigSolidityByKey(simTable, chartBundle, sdsRows),
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable, chartBundle, sdsRows, eisState, polygonOverview, inputs]);

  const missedSummary = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    return buildMissedOpportunityAudit({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
    });
  }, [simTable, inputs, pointsBySeriesKey, it, probOptions]);

  const pnlActualEur = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory);
    if (totals.todayCovered > 0 && Number.isFinite(totals.pnlEurToday)) {
      return totals.pnlEurToday;
    }
    return Number.isFinite(totals.pnlEur) ? totals.pnlEur : null;
  }, [simTable, inputs, portfolioHistory]);

  // Persist missed-opportunity snapshots for Model Lab (no dashboard card).
  useEffect(() => {
    if (!missedSummary || missedSummary.with24hN === 0) return;
    saveMissedOppSnapshot(missedSummary, pnlActualEur);
  }, [missedSummary, pnlActualEur]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const outcomeDocRows = outcomesDoc?.rows ?? [];
  const closedOutcomeRows = useMemo(
    () => (outcomesDoc ? closedValidationOutcomeRowsFromDoc(outcomesDoc) : []),
    [outcomesDoc],
  );

  const portfolioSellEnrich = useMemo((): PortfolioSellEnrichContext | undefined => {
    if (!simTable?.rows?.length) return undefined;
    return {
      simRowByKey,
      pointsBySeriesKey,
      seriesKeyForSimRow: (row) => simulationRowSeriesKey(row) ?? null,
    };
  }, [simTable?.rows?.length, simRowByKey, pointsBySeriesKey]);

  const realPortfolioAccuracy = useMemo(
    (): RealPortfolioAccuracySummary =>
      buildRealPortfolioAccuracySummary(
        outcomeDocRows,
        closedOutcomeRows,
        portfolioSellEnrich,
      ),
    [outcomeDocRows, closedOutcomeRows, portfolioSellEnrich],
  );

  if (!simTable?.rows?.length && !realPortfolioAccuracy.outcomeRowCount) return null;

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <AdviceLearningsRecalculationBridge
        simTable={simTable}
        chartBundle={chartBundle}
        lang={it ? "it" : "en"}
      />
      {aiFeed ? (
        <div className="w-full">
          <DashboardAiFeedCard
            feed={aiFeed.feed}
            recentCount={aiFeed.recentCount}
            loading={aiFeed.loading}
            loadError={aiFeed.loadError}
            updatedAt={aiFeed.updatedAt}
            scopeLabel={aiFeed.scopeLabel}
            onOpenFeed={aiFeed.onOpenFeed}
            fill
            className="min-h-0"
          />
        </div>
      ) : null}
    </div>
  );
}
