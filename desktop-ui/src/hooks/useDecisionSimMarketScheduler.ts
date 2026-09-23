import { useEffect, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useLang } from "../shared/i18n";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { RegulatoryRiskSnapshot, SdsRow } from "../api/supernova";
import { fetchRegulatoryRiskSnapshot } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossRiskCatalog } from "./useLossRiskCatalog";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  decisionSimDailyEvaluationKey,
  isDecisionSimDailyEvaluationWindow,
} from "../sheet/investDecisionSimSchedule";
import { tryRunDecisionSimAutoTick } from "../sheet/decisionSimAutoTick";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";

const POLL_MS = 60_000;

/**
 * Sim-loop market scheduler. Keeps the interval stable (enabled/apiOk only)
 * and reads live inputs from a ref — avoids tearing down the timer (and
 * re-running a heavy tick) every time Map catalogs / inputs change identity.
 */
export function useDecisionSimMarketScheduler({
  apiOk,
  simTable,
  simChartsBundle,
  inputs,
  sdsRows,
  onReloadSimulation,
  enabled = true,
  lossRiskCatalog = null,
  catalogByRowKey = null,
}: {
  apiOk: boolean | null;
  simTable: SheetTable | null;
  simChartsBundle: ChartBundle | null;
  inputs: InvestSimInputs;
  sdsRows: SdsRow[] | null;
  onReloadSimulation: () => Promise<SheetTable | null>;
  /** When false, skip 60s auto-tick (e.g. user on Catalyst / Models tab). */
  enabled?: boolean;
  /** Shared Home catalog — do NOT rebuild inside this hook. */
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
}) {
  const { lang } = useLang();
  const polygonOverview = useCdPatternPolygonOverview();
  const lastReloadDayRef = useRef<string | null>(null);
  const eisStateRef = useRef<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(null);
  const [autoRegSnap, setAutoRegSnap] = useState<RegulatoryRiskSnapshot | null>(null);

  const tickCtxRef = useRef({
    simTable,
    simChartsBundle,
    inputs,
    sdsRows,
    polygonOverview,
    lang,
    onReloadSimulation,
    lossRiskCatalog,
    catalogByRowKey,
    autoRegSnap,
  });
  tickCtxRef.current = {
    simTable,
    simChartsBundle,
    inputs,
    sdsRows,
    polygonOverview,
    lang,
    onReloadSimulation,
    lossRiskCatalog,
    catalogByRowKey,
    autoRegSnap,
  };

  useEffect(() => {
    void loadEisSuperScoreState().then((s) => {
      eisStateRef.current = s;
    });
  }, []);

  useEffect(() => {
    if (apiOk !== true) return;
    let cancelled = false;
    void fetchRegulatoryRiskSnapshot()
      .then((snap) => {
        if (!cancelled) setAutoRegSnap(snap);
      })
      .catch(() => {
        /* Soft SELL still works via riskV2 / P(plan) */
      });
    return () => {
      cancelled = true;
    };
  }, [apiOk]);

  const hasRows = Boolean(simTable?.rows?.length);

  useEffect(() => {
    if (!enabled || apiOk !== true || !hasRows) return;

    const run = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      const ctx = tickCtxRef.current;
      if (!ctx.simTable?.rows?.length) return;

      const now = new Date();
      const inDailyEval = isDecisionSimDailyEvaluationWindow(now);
      if (inDailyEval) {
        const dayKey = decisionSimDailyEvaluationKey(now);
        if (dayKey && lastReloadDayRef.current !== dayKey) {
          lastReloadDayRef.current = dayKey;
          void ctx.onReloadSimulation();
        }
      }

      const state = loadDecisionSimState();
      if (!state.config.enabled) return;

      const pointsBySeriesKey = chartPointsMapFromBundle(ctx.simChartsBundle);
      const probOptions: LossAnalysisProbOptions | null = {
        sdsRows: ctx.sdsRows,
        migSolidityByKey: buildMigSolidityByKey(
          ctx.simTable,
          ctx.simChartsBundle,
          ctx.sdsRows,
        ),
        eisSuperScoreState: eisStateRef.current,
        polygonOverview: ctx.polygonOverview,
        lightweightPolygon: true,
        mergedInputs: ctx.inputs,
      };
      const lang = ctx.lang === "it" ? "it" : "en";

      if (state.config.enabled) {
        void tryRunDecisionSimAutoTick({
          simTable: ctx.simTable,
          inputs: ctx.inputs,
          pointsBySeriesKey,
          lang,
          probOptions,
          lossRiskCatalog: ctx.lossRiskCatalog,
          catalogByRowKey: ctx.catalogByRowKey,
          autoRegSnap: ctx.autoRegSnap,
        });
      }
    };

    run();
    const id = window.setInterval(run, POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, apiOk, hasRows]);
}
