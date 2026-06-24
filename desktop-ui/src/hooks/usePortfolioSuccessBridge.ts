import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle, loadSimulationChartsBundle } from "../data/simulationCharts";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
} from "../data/investmentSimOutcomesData";
import { useInvestSimInputs } from "./useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "./useInvestSimPortfolioHistory";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadSdsCohort } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  buildClosedSuccessMetrics,
  buildTodaySuccessMetrics,
  mergePortfolioSuccessBridge,
  type PortfolioSuccessBridge,
} from "../sheet/portfolioSuccessBridge";
import {
  buildMissedOpportunityAudit,
  loadMissedOppHistory,
  saveMissedOppSnapshot,
  summarizeMissedOppImprovement,
} from "../sheet/missedOpportunityAudit";
import { buildPortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import { useLang } from "../shared/i18n";

/** Metriche allineate chiusure + oggi — condivise tra Performance e Diversificazione. */
export function usePortfolioSuccessBridge(
  simTable: SheetTable | null,
  reloadToken = 0,
): { bridge: PortfolioSuccessBridge; loading: boolean } {
  const { lang } = useLang();
  const inputs = useInvestSimInputs(simTable, reloadToken);
  const portfolioHistory = useInvestSimPortfolioHistory(reloadToken).history;
  const polygonOverview = useCdPatternPolygonOverview();
  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [closedRows, setClosedRows] = useState<ReturnType<typeof closedSimOutcomeRowsFromDoc>>([]);
  const [outcomesLoading, setOutcomesLoading] = useState(true);

  useEffect(() => {
    void loadSimulationChartsBundle().then(({ bundle }) => setChartBundle(bundle));
    void loadEisSuperScoreState().then(setEisState);
    void loadSdsCohort(false).then((p) => setSdsRows(p.rows ?? null));
  }, [reloadToken]);

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

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartBundle, sdsRows),
    [simTable, chartBundle, sdsRows],
  );

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows,
      migSolidityByKey,
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
    };
  }, [simTable?.rows?.length, sdsRows, migSolidityByKey, eisState, polygonOverview]);

  useEffect(() => {
    if (reloadToken <= 0 || !simTable?.rows?.length) return;
    const summary = buildMissedOpportunityAudit({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      probOptions,
    });
    if (summary.with24hN === 0) return;
    const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
    const todayKey = new Date().toISOString().slice(0, 10);
    const open = ledger.openDayTotals[todayKey];
    const pnlActualEur = open != null && Number.isFinite(open) ? open : null;
    saveMissedOppSnapshot(summary, pnlActualEur);
  }, [reloadToken, simTable, inputs, pointsBySeriesKey, lang, probOptions, portfolioHistory]);

  const bridge = useMemo((): PortfolioSuccessBridge => {
    const closed = buildClosedSuccessMetrics(closedRows);

    if (!simTable?.rows?.length) {
      return mergePortfolioSuccessBridge(closed, null);
    }

    const summary = buildMissedOpportunityAudit({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      probOptions,
    });

    if (summary.with24hN === 0) {
      return mergePortfolioSuccessBridge(closed, null);
    }

    const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
    const todayKey = new Date().toISOString().slice(0, 10);
    const open = ledger.openDayTotals[todayKey];
    const pnlActualEur = open != null && Number.isFinite(open) ? open : null;

    const history = loadMissedOppHistory();
    const improvement = summarizeMissedOppImprovement(
      history,
      summary,
      pnlActualEur,
    );
    const today = buildTodaySuccessMetrics(
      improvement,
      pnlActualEur,
      summary.pnlRecommendationsEur,
      summary.pnlFairRecommendationsEur,
    );

    return mergePortfolioSuccessBridge(closed, today);
  }, [
    closedRows,
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    probOptions,
    portfolioHistory,
  ]);

  return { bridge, loading: outcomesLoading && !closedRows.length };
}
