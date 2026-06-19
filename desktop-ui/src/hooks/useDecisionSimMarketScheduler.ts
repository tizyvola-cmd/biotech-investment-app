import { useEffect, useRef } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useLang } from "../shared/i18n";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  decisionSimMarketHourKey,
  isDecisionSimMarketWindow,
} from "../sheet/investDecisionSimSchedule";
import { tryRunDecisionSimAutoTick } from "../sheet/decisionSimAutoTick";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";

const POLL_MS = 60_000;

export function useDecisionSimMarketScheduler({
  apiOk,
  simTable,
  simChartsBundle,
  inputs,
  sdsRows,
  onReloadSimulation,
}: {
  apiOk: boolean | null;
  simTable: SheetTable | null;
  simChartsBundle: ChartBundle | null;
  inputs: InvestSimInputs;
  sdsRows: SdsRow[] | null;
  onReloadSimulation: () => Promise<SheetTable | null>;
}) {
  const { lang } = useLang();
  const polygonOverview = useCdPatternPolygonOverview();
  const lastReloadHourRef = useRef<string | null>(null);
  const eisStateRef = useRef<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(null);

  useEffect(() => {
    void loadEisSuperScoreState().then((s) => {
      eisStateRef.current = s;
    });
  }, []);

  useEffect(() => {
    if (apiOk !== true || !simTable?.rows?.length) return;

    const run = () => {
      const now = new Date();
      const inWindow = isDecisionSimMarketWindow(now);

      if (inWindow) {
        const hourKey = decisionSimMarketHourKey(now);
        if (hourKey && lastReloadHourRef.current !== hourKey) {
          lastReloadHourRef.current = hourKey;
          void onReloadSimulation();
        }
      }

      const state = loadDecisionSimState();
      if (!state.config.enabled) return;
      if (!inWindow) return;

      const pointsBySeriesKey = chartPointsMapFromBundle(simChartsBundle);
      const probOptions: LossAnalysisProbOptions | null = {
        sdsRows,
        migSolidityByKey: buildMigSolidityByKey(simTable, simChartsBundle, sdsRows),
        eisSuperScoreState: eisStateRef.current,
        polygonOverview,
        lightweightPolygon: true,
        mergedInputs: inputs,
      };

      void tryRunDecisionSimAutoTick({
        simTable,
        inputs,
        pointsBySeriesKey,
        lang: lang === "it" ? "it" : "en",
        probOptions,
      });
    };

    run();
    const id = window.setInterval(run, POLL_MS);
    return () => window.clearInterval(id);
  }, [
    apiOk,
    simTable,
    simChartsBundle,
    inputs,
    sdsRows,
    polygonOverview,
    lang,
    onReloadSimulation,
  ]);
}
