import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { loadSdsCohort } from "../api/supernova";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { loadSdsReferenceCurves } from "../sheet/sdsRoiBlend";
import { loadSdsRoiConvergenceSources } from "../sheet/sdsRoiSimConvergence";
import { buildSdsPredictionSignals } from "../sheet/sdsRoiTemporalConvergence";
import {
  buildSdsPredictionWeeklyRows,
  recordSdsPredictionWeeklySnapshot,
} from "../sheet/sdsPredictionCalibrationHistory";
import {
  computeGlobalRho,
  computeSdsAccuracyKpis,
  countSdsRhoPairs,
} from "../sheet/sdsPredictionAccuracyCompute";
import { useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { ModelLabAccuracyUpdatedBar } from "./ModelLabAccuracyUpdatedBar";
import { SdsPredictionAccuracy } from "./SdsPredictionAccuracy";

export function SdsPredictionAccuracyPanel({
  simTable,
  reloadToken = 0,
  dataUpdatedAt,
}: {
  simTable?: SheetTable | null;
  reloadToken?: number;
  dataUpdatedAt?: string | null;
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signals, setSignals] = useState<ReturnType<typeof buildSdsPredictionSignals>>([]);
  const [weeklyCalibration, setWeeklyCalibration] = useState<
    ReturnType<typeof buildSdsPredictionWeeklyRows>
  >([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void Promise.all([
      loadSdsRoiConvergenceSources(),
      loadSdsCohort(false),
      loadSimulationChartsBundle(),
      loadSdsReferenceCurves(),
    ])
      .then(([sources, sds, charts, refPack]) => {
        if (cancelled) return;
        const simSnap = simTable?.rows?.length
          ? { rows: simTable.rows as Record<string, unknown>[] }
          : sources.simSnap;
        const built = buildSdsPredictionSignals(
          sources.forecast,
          sources.sdsSnap,
          simSnap,
          sources.backtest,
          {
            chartBundle: charts.bundle,
            refCurves: refPack.refs,
            sdsRows: sds.rows ?? [],
          },
        );
        setSignals(built);
        if (charts.error) setLoadError(charts.error);

        if (built.length > 0) {
          const kpis = computeSdsAccuracyKpis(built, []);
          const rho = computeGlobalRho(built);
          const rhoN = countSdsRhoPairs(built);
          recordSdsPredictionWeeklySnapshot({
            mae: kpis.mae,
            coverage: kpis.coveragePct,
            rho,
            rhoN,
            nSignals: kpis.totalSignals,
          });
        }
        setWeeklyCalibration(buildSdsPredictionWeeklyRows());
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, simTable]);

  const hasData = useMemo(() => signals.length > 0, [signals]);

  if (loading) {
    return (
      <div style={{ padding: "16px 18px", color: "var(--sn-text-3)", fontSize: 11 }}>
        {t("modelLab.sdsAccuracy.loading")}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div
        style={{
          borderRadius: 12,
          border: "0.5px dashed var(--sn-border)",
          background: "var(--sn-surface)",
          padding: "16px 18px",
        }}
      >
        <p style={{ fontSize: 11, color: "var(--sn-text-3)" }}>
          {loadError ? t("modelLab.sdsAccuracy.loadError") : t("modelLab.sdsAccuracy.empty")}
        </p>
      </div>
    );
  }

  return (
    <ViewErrorBoundary label="SDS Prediction Accuracy">
      <ModelLabAccuracyUpdatedBar updatedAt={dataUpdatedAt} />
      <SdsPredictionAccuracy signals={signals} weeklyCalibration={weeklyCalibration} />
    </ViewErrorBoundary>
  );
}
