import { useCallback, useEffect } from "react";
import type { SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import type { ChartBundle } from "../types";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import {
  aggregateAdviceCalibrationBuckets,
  filterAdviceCalibrationByUniverse,
  summarizeAdviceCalibration,
  buySellAdviceSnapshotFields,
} from "../sheet/investDecisionSimAdviceCalibration";
import { buildAdviceFeedback } from "../sheet/adviceFeedback";
import {
  ADVICE_CALIB_PIPELINE_VERSION,
  ADVICE_LEARNING_AUTO_SNAPSHOT_MIN_SCORED,
  ADVICE_RECALCULATE_REQUEST_EVENT,
  buildAdviceLearningSnapshot,
  loadAdviceCalibPipelineVersion,
  markAdviceCalibPipelineVersion,
  persistAdviceLearningsRecalculation,
} from "../sheet/adviceLearningHistory";
import { buildAdviceCalibrationForLearnings } from "./DecisionSimAdviceCalibrationPanel";

type Props = {
  simTable: SheetTable | null | undefined;
  chartBundle?: ChartBundle | null;
  lang: "it" | "en";
};

/** Headless bridge — runs pipeline migration + listens for manual recalc requests. */
export function AdviceLearningsRecalculationBridge({ simTable, chartBundle, lang }: Props) {
  const inputs = useInvestSimInputs(simTable ?? null);
  const pointsBySeriesKey = chartBundle ? chartPointsMapFromBundle(chartBundle) : new Map();

  const runRecalculation = useCallback(
    (resetHistory: boolean) => {
      if (!simTable?.rows?.length) return false;
      const state = loadDecisionSimState();
      const monitorRows = buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        paperPortfolio: state.paperPortfolio,
      });
      const points = buildAdviceCalibrationForLearnings({
        monitorRows,
        paperPortfolio: state.paperPortfolio,
        decisionSimTicks: state.ticks,
        liveEvaluations: monitorRows,
        simTable,
        lang,
      });
      const summary = summarizeAdviceCalibration(points);
      if (summary.scoredCount < 1) return false;
      const portfolioSummary = summarizeAdviceCalibration(
        filterAdviceCalibrationByUniverse(points, "portfolio"),
      );
      const simLoopSummary = summarizeAdviceCalibration(
        filterAdviceCalibrationByUniverse(points, "simloop"),
      );
      const bucketRows = aggregateAdviceCalibrationBuckets(points, lang);
      const feedback = buildAdviceFeedback(points, bucketRows, null);
      const snap = buildAdviceLearningSnapshot({
        summary,
        portfolioSummary,
        simLoopSummary,
        feedback,
        ...buySellAdviceSnapshotFields(points),
        manual: true,
      });
      persistAdviceLearningsRecalculation({ feedback, snapshot: snap, resetHistory });
      return true;
    },
    [simTable, inputs, pointsBySeriesKey, lang],
  );

  useEffect(() => {
    if (loadAdviceCalibPipelineVersion() >= ADVICE_CALIB_PIPELINE_VERSION) return;
    if (!simTable?.rows?.length) return;
    const state = loadDecisionSimState();
    const monitorRows = buildSuggestionMonitorRows({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      paperPortfolio: state.paperPortfolio,
    });
    const points = buildAdviceCalibrationForLearnings({
      monitorRows,
      paperPortfolio: state.paperPortfolio,
      decisionSimTicks: state.ticks,
      liveEvaluations: monitorRows,
      simTable,
      lang,
    });
    if (summarizeAdviceCalibration(points).scoredCount < ADVICE_LEARNING_AUTO_SNAPSHOT_MIN_SCORED) {
      return;
    }
    // Append v2 checkpoint — do not wipe prior timeline (user keeps trend history).
    runRecalculation(false);
    markAdviceCalibPipelineVersion();
  }, [simTable, inputs, pointsBySeriesKey, lang, runRecalculation]);

  useEffect(() => {
    const onRequest = () => {
      const it = lang === "it";
      const ok = window.confirm(
        it
          ? "Ricalcolare le raccomandazioni e aggiornare il checkpoint di oggi? Lo storico precedente resta intatto; le correzioni bucket verranno riscritte."
          : "Recalculate recommendations and update today's checkpoint? Prior timeline history is kept; bucket corrections will be rewritten.",
      );
      if (!ok) return;
      runRecalculation(false);
    };
    window.addEventListener(ADVICE_RECALCULATE_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(ADVICE_RECALCULATE_REQUEST_EVENT, onRequest);
  }, [lang, runRecalculation]);

  return null;
}
