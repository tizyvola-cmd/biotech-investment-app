import { useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { loadSdsCohort, type SdsRow } from "../api/supernova";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import {
  buildRascoreObservations,
  buildRascoreSignalImpactView,
  rascoreChartHasPlottableSeries,
} from "../sheet/rascoreSignalImpactView";
import {
  buildRascoreCalibrationChartRows,
  buildRascoreEvolutionSummary,
  recordRascoreWeeklySnapshot,
} from "../sheet/rascoreCalibrationHistory";
import { observationsToSignals } from "../sheet/rascoreCalibrationCompute";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { ModelLabAccuracyUpdatedBar } from "./ModelLabAccuracyUpdatedBar";
import { RaScoreCalibration } from "./RaScoreCalibration";

export function RaScoreCalibrationPanel({
  simTable,
  reloadToken = 0,
  dataUpdatedAt,
}: {
  simTable?: SheetTable | null;
  reloadToken?: number;
  dataUpdatedAt?: string | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const langCode = lang === "it" ? "it" : "en";
  const inputs = useInvestSimInputs(simTable ?? null);
  const history = useInvestSimPortfolioHistory();

  const [sdsRows, setSdsRows] = useState<SdsRow[]>([]);
  const [chartBundle, setChartBundle] = useState<
    Awaited<ReturnType<typeof loadSimulationChartsBundle>>["bundle"]
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void Promise.all([loadSdsCohort(false), loadSimulationChartsBundle()])
      .then(([sds, charts]) => {
        if (cancelled) return;
        setSdsRows(sds.rows ?? []);
        setChartBundle(charts.bundle);
        if (charts.error) setLoadError(charts.error);
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
  }, [reloadToken]);

  const view = useMemo(() => {
    const observations = buildRascoreObservations({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: langCode,
    });
    return buildRascoreSignalImpactView(observations);
  }, [simTable, chartBundle, sdsRows, inputs, history, langCode]);

  const [evolutionSummary, setEvolutionSummary] = useState(() => buildRascoreEvolutionSummary());

  useEffect(() => {
    if (!view.hasData || loading) return;
    recordRascoreWeeklySnapshot(view);
    setEvolutionSummary(buildRascoreEvolutionSummary());
  }, [view, loading]);

  const signals = useMemo(() => observationsToSignals(view.observations), [view.observations]);
  const inverseBuildArgs = useMemo(
    () => ({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: langCode as "it" | "en",
    }),
    [simTable, chartBundle, sdsRows, inputs, history, langCode],
  );
  const weeklyRho = useMemo(
    () =>
      buildRascoreCalibrationChartRows(evolutionSummary).map((r) => ({
        week: r.label,
        rho: r.rho,
        rhoN: r.rhoN,
      })),
    [evolutionSummary],
  );

  const hasChartData =
    view.bins.length > 0 && view.nTotal > 0 && rascoreChartHasPlottableSeries(view.bins);

  if (!simTable?.rows?.length) {
    return (
      <div
        style={{
          borderRadius: 12,
          border: "0.5px dashed var(--sn-border)",
          background: "linear-gradient(168deg, #ffffff 0%, #f8fafc 50%, #f5f3ff 100%)",
          padding: "16px 18px",
        }}
      >
        <p style={{ fontSize: 11, color: "var(--sn-text-3)" }}>{t("modelLab.qc.rascoreImpact.noSim")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: "16px 18px", color: "var(--sn-text-3)", fontSize: 11 }}>
        {t("modelLab.qc.rascoreImpact.loading")}
      </div>
    );
  }

  if (!hasChartData) {
    return (
      <div
        style={{
          borderRadius: 12,
          border: "0.5px dashed var(--sn-border)",
          background: "linear-gradient(168deg, #ffffff 0%, #f8fafc 50%, #f5f3ff 100%)",
          padding: "16px 18px",
        }}
      >
        <p style={{ fontSize: 11, color: "var(--sn-text-3)" }}>
          {loadError ? t("modelLab.qc.rascoreImpact.loadError") : t("modelLab.qc.rascoreImpact.empty")}
        </p>
      </div>
    );
  }

  return (
    <ViewErrorBoundary label="RA Score Calibration">
      <ModelLabAccuracyUpdatedBar updatedAt={dataUpdatedAt} />
      <RaScoreCalibration
        signals={signals}
        weeklyRho={weeklyRho}
        inverseBuildArgs={inverseBuildArgs}
        cohort={view.cohort}
      />
    </ViewErrorBoundary>
  );
}
