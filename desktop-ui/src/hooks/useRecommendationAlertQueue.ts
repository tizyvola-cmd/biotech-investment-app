import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { loadUiPrefsLocal } from "../sheet/uiPrefs";
import { useSimLoopSynthAllocation } from "./useSimLoopSynthAllocation";
import {
  ackRecommendationAlerts,
  detectNewRecommendationAlerts,
  recommendationAlertKeySig,
  suggestionRowForAlert,
  type RecommendationAlertPayload,
} from "../sheet/recommendationAlerts";
import type { SuggestionMonitorRow } from "../sheet/suggestionMonitor";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";

export function useRecommendationAlertQueue(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  chartsBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null;
  lang: "it" | "en";
  enabled?: boolean;
}): {
  open: boolean;
  alerts: RecommendationAlertPayload[];
  activeIndex: number;
  setActiveIndex: (idx: number) => void;
  monitorRow: SuggestionMonitorRow | null;
  alertContext: Parameters<typeof detectNewRecommendationAlerts>[0];
  close: () => void;
  ackAll: () => void;
} {
  const { simTable, inputs, chartsBundle, sdsRows, lang, enabled = true } = args;
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<RecommendationAlertPayload[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const lastKeySigRef = useRef("");
  const [eisState, setEisState] = useState<Awaited<
    ReturnType<typeof loadEisSuperScoreState>
  > | null>(null);
  const polygonOverview = useCdPatternPolygonOverview();

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
  }, []);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartsBundle),
    [chartsBundle],
  );

  const topCapital = useMemo(() => {
    const pref = loadUiPrefsLocal().topCapital;
    if (pref != null && Number.isFinite(pref) && pref > 0) return pref;
    let sum = 0;
    for (const v of Object.values(inputs)) {
      if (v.capital > 0) sum += v.capital;
    }
    return sum > 0 ? sum : 5000;
  }, [inputs]);

  const synthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows,
    investInputs: inputs,
    pointsBySeriesKey,
    totalCapitalEur: topCapital,
    enabled: enabled && Boolean(simTable?.rows?.length) && topCapital > 0,
  });

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable) return null;
    return {
      sdsRows,
      migSolidityByKey: buildMigSolidityByKey(simTable, chartsBundle, sdsRows),
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable, chartsBundle, sdsRows, eisState, polygonOverview, inputs]);

  const alertContext = useMemo(
    () => ({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      probOptions,
      paperPortfolio: [],
      synthAlloc,
    }),
    [simTable, inputs, pointsBySeriesKey, lang, probOptions, synthAlloc],
  );

  useEffect(() => {
    if (!enabled || !simTable?.rows?.length) {
      if (!open) {
        setAlerts([]);
        setOpen(false);
      }
      return;
    }
    if (open) return;

    const next = detectNewRecommendationAlerts(alertContext);
    const keySig = recommendationAlertKeySig(next);
    if (keySig === lastKeySigRef.current) return;
    lastKeySigRef.current = keySig;
    if (next.length === 0) {
      setAlerts([]);
      setOpen(false);
      return;
    }
    ackRecommendationAlerts(next);
    setAlerts(next);
    setActiveIndex(0);
    setOpen(true);
  }, [enabled, simTable, alertContext, open]);

  const monitorRow = useMemo(() => {
    const alert = alerts[activeIndex];
    if (!alert) return null;
    return suggestionRowForAlert(alertContext, alert.key);
  }, [alerts, activeIndex, alertContext]);

  const close = useCallback(() => {
    if (alerts.length) ackRecommendationAlerts(alerts);
    setOpen(false);
    setAlerts([]);
    lastKeySigRef.current = recommendationAlertKeySig(alerts);
  }, [alerts]);

  const ackAll = useCallback(() => {
    if (alerts.length) ackRecommendationAlerts(alerts);
  }, [alerts]);

  return {
    open,
    alerts,
    activeIndex,
    setActiveIndex,
    monitorRow,
    alertContext,
    close,
    ackAll,
  };
}
