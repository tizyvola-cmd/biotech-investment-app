import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import {
  buildTemporalRowsFromSummary,
  parseMonitorEntries,
  type MonitorEntry,
  type TemporalModelRow,
} from "../sheet/accuracyMetrics";
import { PredictionGuidePanel } from "./PredictionGuidePanel";
import { useLang, useT } from "../shared/i18n";
import { RefreshControls } from "./RefreshControls";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { EisSignalImpactPanel } from "./EisSignalImpactPanel";
import { QcTodayDashboard } from "./QcTodayDashboard";
import { MissedOpportunityPanel } from "./MissedOpportunityPanel";
import { SdsPredictionAccuracyPanel } from "./SdsPredictionAccuracyPanel";
import { ModelComparisonPanel } from "./ModelComparisonPanel";
import { TesterPredictionTab } from "./TesterPredictionTab";
import { loadModelLearningsBundle } from "../data/modelLearningsData";
import { buildModelLearningsView } from "../sheet/modelLearningsTimeline";
import { fetchDesktopManifest, invalidateProjectJsonCache } from "../data/projectData";

type ModelsTab = "performance" | "distribution" | "prediction";
type PerformanceSubview = "dashboard" | "models-eval" | "missed";
type ModelsEvalSubNav = "comparison" | "sds-accuracy" | "eis-analysis";

/** Legacy route aliases → top-level tab. */
export type ModelsTabId =
  | ModelsTab
  | "comparison"
  | "ra-score-calibration"
  | "ra-calibration"
  | "sds-prediction-accuracy"
  | "cont-sell-accuracy"
  | "eis-signal-impact"
  | "eis-analysis"
  | "today"
  | "learning"
  | "detail"
  | "qc"
  | "temporal"
  | "evolution"
  | "curveEngine"
  | "learnings"
  | "validation"
  | "preCdSignals"
  | "calibration"
  | "calibration-diversify"
  | "calibration-prediction";

const LEGACY_TAB: Record<string, ModelsTab> = {
  "ra-score-calibration": "performance",
  "ra-calibration": "performance",
  "sds-prediction-accuracy": "performance",
  "cont-sell-accuracy": "performance",
  performance: "performance",
  today: "performance",
  qc: "performance",
  temporal: "performance",
  evolution: "performance",
  curveEngine: "performance",
  learnings: "performance",
  detail: "performance",
  validation: "performance",
  preCdSignals: "performance",
  learning: "performance",
  comparison: "performance",
  distribution: "distribution",
  // Model Calibration shell removed — diversify → Performance; prediction kept as its own tab.
  calibration: "performance",
  "calibration-diversify": "performance",
  "calibration-prediction": "prediction",
};

function resolveInitialTab(initialTab: ModelsTabId | undefined): ModelsTab {
  if (initialTab === undefined) return "performance";
  if (initialTab in LEGACY_TAB) return LEGACY_TAB[initialTab];
  if (
    initialTab === "performance" ||
    initialTab === "distribution" ||
    initialTab === "prediction"
  ) {
    return initialTab;
  }
  return "performance";
}

function resolveInitialPerformanceSubview(initialTab: ModelsTabId | undefined): PerformanceSubview {
  if (
    initialTab === "sds-prediction-accuracy" ||
    initialTab === "cont-sell-accuracy" ||
    initialTab === "eis-signal-impact" ||
    initialTab === "eis-analysis" ||
    initialTab === "comparison"
  ) {
    return "models-eval";
  }
  return "dashboard";
}

function resolveInitialModelsEvalSubNav(initialTab: ModelsTabId | undefined): ModelsEvalSubNav {
  if (initialTab === "sds-prediction-accuracy") return "sds-accuracy";
  if (initialTab === "eis-signal-impact" || initialTab === "eis-analysis") return "eis-analysis";
  return "comparison";
}

function tabBtn(active: boolean) {
  return `rounded-md px-3 py-1.5 text-sm transition ${
    active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
  }`;
}

function subNavPill(active: boolean) {
  return `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? "border-accent bg-accent/10 text-[rgb(var(--accent))]"
      : "border-[rgb(var(--border))]/60 bg-surface/40 text-ink-muted hover:text-ink hover:bg-surface/70"
  }`;
}

/** Model analysis — performance QC, portfolio outcomes, CD distribution curves. */
export function ModelAccuracyLabView({
  accTable,
  simTable,
  loading: sheetLoading,
  error: sheetError,
  onReload,
  accuracyDataStale,
  manifestUpdatedAt,
  initialTab,
  onInitialTabConsumed,
  onNestedBackChange,
  apiOk: _apiOk = null,
  chartsBundle = null,
}: {
  accTable: SheetTable | null;
  simTable?: SheetTable | null;
  loading: boolean;
  simLoading?: boolean;
  error: string | null;
  onReload: () => void;
  onReloadSimulation?: () => void;
  onOpenSimulationPnl?: () => void;
  onOpenDailyPnlLedger?: () => void;
  accuracyDataStale?: boolean;
  manifestUpdatedAt?: string | null;
  initialTab?: ModelsTabId;
  onInitialTabConsumed?: () => void;
  /** When a sub-view is open (Models eval, Missed, Distribution…), wire the top-bar ← here. */
  onNestedBackChange?: (handler: (() => void) | null) => void;
  apiOk?: boolean | null;
  chartsBundle?: ChartBundle | null;
}) {
  const [tab, setTab] = useState<ModelsTab>(() => resolveInitialTab(initialTab));
  const [performanceSubview, setPerformanceSubview] = useState<PerformanceSubview>(() =>
    resolveInitialPerformanceSubview(initialTab),
  );
  const [summaryRows, setSummaryRows] = useState<TemporalModelRow[]>([]);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [monitorEntries, setMonitorEntries] = useState<MonitorEntry[]>([]);
  const [monitorSource, setMonitorSource] = useState("");
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [learningsReloadToken, setLearningsReloadToken] = useState(0);
  const [learningsLoading, setLearningsLoading] = useState(true);
  const [learningsSources, setLearningsSources] = useState<Awaited<
    ReturnType<typeof loadModelLearningsBundle>
  >["sources"] | null>(null);
  const [modelsEvalSubNav, setModelsEvalSubNav] = useState<ModelsEvalSubNav>(() =>
    resolveInitialModelsEvalSubNav(initialTab),
  );
  const [sdsAccUpdatedAt, setSdsAccUpdatedAt] = useState<string | null>(null);
  const [eisMagUpdatedAt, setEisMagUpdatedAt] = useState<string | null>(null);
  const [eisMagReloadToken, setEisMagReloadToken] = useState(0);
  const modelLabAccuracySigRef = useRef("");
  const learningsManifestSigRef = useRef("");

  useEffect(() => {
    if (initialTab === undefined) return;
    setTab(resolveInitialTab(initialTab));
    setPerformanceSubview(resolveInitialPerformanceSubview(initialTab));
    setModelsEvalSubNav(resolveInitialModelsEvalSubNav(initialTab));
    onInitialTabConsumed?.();
  }, [initialTab, onInitialTabConsumed]);

  useEffect(() => {
    if (tab !== "performance") {
      setPerformanceSubview("dashboard");
    }
  }, [tab]);

  useEffect(() => {
    if (!onNestedBackChange) return;
    const onDashboard = tab === "performance" && performanceSubview === "dashboard";
    if (onDashboard) {
      onNestedBackChange(null);
      return;
    }
    onNestedBackChange(() => {
      if (tab !== "performance") {
        setTab("performance");
      }
      setPerformanceSubview("dashboard");
    });
    return () => onNestedBackChange(null);
  }, [tab, performanceSubview, onNestedBackChange]);

  const reloadLearningsBundle = useCallback(async () => {
    setLearningsLoading(true);
    setSummaryError(null);
    setMonitorError(null);

    const { sources, errors, monitorSource: ms } = await loadModelLearningsBundle();

    setLearningsSources(sources);
    setLearningsLoading(false);

    if (sources.accuracySummary) {
      setSummaryRows(buildTemporalRowsFromSummary(sources.accuracySummary));
      setSummaryError(null);
    } else {
      setSummaryRows([]);
      setSummaryError(
        errors.find((e) => e.includes("accuracy_v4_v5_summary")) ?? "Summary missing",
      );
    }

    if (sources.monitor) {
      setMonitorEntries(parseMonitorEntries(sources.monitor));
      setMonitorSource(ms);
      setMonitorError(null);
    } else {
      setMonitorEntries([]);
      setMonitorSource("");
      setMonitorError(
        errors.find((e) => e.includes("model_accuracy_monitor")) ?? "Monitor missing",
      );
    }
  }, []);

  useEffect(() => {
    if (learningsReloadToken > 0) invalidateProjectJsonCache();
    void reloadLearningsBundle();
  }, [learningsReloadToken, reloadLearningsBundle]);

  const { lang } = useLang();
  const learningsView = useMemo(() => {
    if (!learningsSources) return null;
    return buildModelLearningsView(learningsSources, { lang, monitorSource });
  }, [learningsSources, lang, monitorSource]);


  useEffect(() => {
    const unsub = window.supernova?.onAccuracyMonitorUpdated?.(() => {
      invalidateProjectJsonCache();
      void reloadLearningsBundle();
    });
    return unsub ?? undefined;
  }, [reloadLearningsBundle]);

  useEffect(() => {
    if (!manifestUpdatedAt) return;
    const sig = manifestUpdatedAt;
    if (learningsManifestSigRef.current && learningsManifestSigRef.current !== sig) {
      invalidateProjectJsonCache();
      setLearningsReloadToken((n) => n + 1);
    }
    learningsManifestSigRef.current = sig;
  }, [manifestUpdatedAt]);

  useEffect(() => {
    if (
      tab !== "performance" ||
      performanceSubview !== "models-eval" ||
      (modelsEvalSubNav !== "sds-accuracy" && modelsEvalSubNav !== "eis-analysis")
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const m = await fetchDesktopManifest();
      if (cancelled || !m) return;
      const sds = m.sds_accuracy_updated_at ?? null;
      const eis = m.eis_magnitude_updated_at ?? null;
      setSdsAccUpdatedAt(sds);
      setEisMagUpdatedAt(eis);
      const sig = `${sds ?? ""}|${eis ?? ""}`;
      if (modelLabAccuracySigRef.current && modelLabAccuracySigRef.current !== sig) {
        invalidateProjectJsonCache();
        setLearningsReloadToken((n) => n + 1);
        if (modelsEvalSubNav === "eis-analysis") {
          setEisMagReloadToken((n) => n + 1);
        }
      }
      modelLabAccuracySigRef.current = sig;
    };
    void poll();
    const id = window.setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tab, performanceSubview, modelsEvalSubNav]);

  const handleReload = useCallback(() => {
    if (
      tab === "performance" &&
      performanceSubview === "models-eval" &&
      (modelsEvalSubNav === "sds-accuracy" || modelsEvalSubNav === "eis-analysis")
    ) {
      setLearningsReloadToken((n) => n + 1);
      if (modelsEvalSubNav === "eis-analysis") {
        setEisMagReloadToken((n) => n + 1);
      }
      return;
    }
    if (tab === "distribution") {
      onReload();
      return;
    }
    onReload();
    setLearningsReloadToken((n) => n + 1);
  }, [tab, performanceSubview, modelsEvalSubNav, onReload]);

  const hasSummary = summaryRows.length > 0;
  const t = useT();
  const subtitle =
    tab === "performance"
      ? performanceSubview === "models-eval"
          ? modelsEvalSubNav === "sds-accuracy"
            ? t("modelLab.subtitle.sdsAccuracy")
            : modelsEvalSubNav === "eis-analysis"
              ? t("modelLab.subtitle.eisAnalysis")
              : t("modelLab.subtitle.comparison")
          : t("modelLab.subtitle.performance")
      : t("modelLab.subtitle.distribution");

  const curveErrors = useMemo(() => {
    const errs: string[] = [];
    if (monitorError) errs.push(monitorError);
    if (summaryError) errs.push(summaryError);
    return errs;
  }, [monitorError, summaryError]);

  const reloadLoading =
    tab === "distribution"
      ? sheetLoading
      : performanceSubview === "models-eval" && modelsEvalSubNav === "comparison"
        ? false
        : learningsLoading || sheetLoading;

  return (
    <section className="card model-accuracy-tab flex flex-col flex-1">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">{t("modelLab.page.title")}</h2>
          <p className="text-xs text-ink-muted">{subtitle}</p>
          <p className="text-[10px] text-[rgb(var(--accent))]/75 leading-snug mt-1 max-w-xl">
            {t("modelLab.slopeHarmonyNote")}
          </p>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap items-center">
          <button
            type="button"
            className={tabBtn(tab === "performance")}
            onClick={() => {
              setTab("performance");
              setPerformanceSubview("dashboard");
            }}
          >
            {t("modelLab.tab.performance")}
          </button>
          <button
            type="button"
            className={tabBtn(tab === "distribution")}
            onClick={() => setTab("distribution")}
          >
            {t("modelLab.tab.distribution")}
          </button>
          <button
            type="button"
            className={tabBtn(tab === "prediction")}
            onClick={() => setTab("prediction")}
          >
            {t("modelLab.calibration.subNav.prediction")}
          </button>
          <RefreshControls
            onLocalReload={handleReload}
            localLoading={reloadLoading}
            reloadTooltip={t("refresh.page.modelAnalysis.tooltip")}
            extraInfo={hasSummary ? `${summaryRows.length} accuracy rows` : undefined}
          />
        </div>
      </div>

      <div className="flex flex-col flex-1 p-4 gap-3">
        {tab === "performance" && performanceSubview === "dashboard" && (
          <ViewErrorBoundary label="Performance">
            <QcTodayDashboard
              reloadToken={learningsReloadToken}
              bundleLoading={learningsLoading}
              simTable={simTable ?? null}
              monitorEntries={monitorEntries}
              monitorSource={monitorSource}
              curveErrors={curveErrors}
              sources={learningsSources}
              view={learningsView}
              onOpenModelsEval={() => {
                setModelsEvalSubNav("comparison");
                setPerformanceSubview("models-eval");
              }}
              onOpenMissed={() => setPerformanceSubview("missed")}
            />
          </ViewErrorBoundary>
        )}

        {tab === "performance" && performanceSubview === "missed" && (
          <div className="flex flex-col flex-1 gap-3">
            <button
              type="button"
              className="self-start shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
              onClick={() => setPerformanceSubview("dashboard")}
            >
              ← {t("modelLab.performance.backToDashboard")}
            </button>
            <div className="flex flex-col flex-1 overflow-y-auto pr-1">
              <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 p-4">
                <ViewErrorBoundary label="Missed opportunities">
                  <MissedOpportunityPanel
                    simTable={simTable ?? null}
                    reloadToken={learningsReloadToken}
                  />
                </ViewErrorBoundary>
              </div>
            </div>
          </div>
        )}

        {tab === "performance" && performanceSubview === "models-eval" && (
          <div className="flex flex-col flex-1 gap-3">
            {/* Level-1 back + Level-2 sub-nav pills in one row */}
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                className="rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
                onClick={() => setPerformanceSubview("dashboard")}
              >
                ← {t("modelLab.performance.backToDashboard")}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className={subNavPill(modelsEvalSubNav === "comparison")}
                  onClick={() => setModelsEvalSubNav("comparison")}
                >
                  {t("modelLab.subtitle.comparison")}
                </button>
                <button
                  type="button"
                  className={subNavPill(modelsEvalSubNav === "sds-accuracy")}
                  onClick={() => setModelsEvalSubNav("sds-accuracy")}
                >
                  {t("modelLab.performance.openSdsAccuracy")}
                </button>
                <button
                  type="button"
                  className={subNavPill(modelsEvalSubNav === "eis-analysis")}
                  onClick={() => setModelsEvalSubNav("eis-analysis")}
                >
                  {t("modelLab.performance.openEisAnalysis")}
                </button>
              </div>
            </div>

            {modelsEvalSubNav === "comparison" && (
              <div className="flex flex-col flex-1 overflow-y-auto pr-1">
                <ViewErrorBoundary label="Model comparison">
                  <ModelComparisonPanel />
                </ViewErrorBoundary>
              </div>
            )}

            {modelsEvalSubNav === "sds-accuracy" && (
              <ViewErrorBoundary label="SDS Prediction Accuracy">
                <SdsPredictionAccuracyPanel
                  simTable={simTable ?? null}
                  reloadToken={learningsReloadToken}
                  dataUpdatedAt={sdsAccUpdatedAt}
                />
              </ViewErrorBoundary>
            )}

            {modelsEvalSubNav === "eis-analysis" && (
              <div className="flex flex-col flex-1 pr-1">
                <ViewErrorBoundary label="EIS signal impact">
                  <EisSignalImpactPanel
                    curveImpact={learningsSources?.signalCalib?.curve_impact_cumulative}
                    reloadToken={eisMagReloadToken + learningsReloadToken}
                    dataUpdatedAt={eisMagUpdatedAt}
                  />
                </ViewErrorBoundary>
              </div>
            )}

          </div>
        )}

        {tab === "distribution" && (
          <div className="flex flex-col flex-1 gap-3 pr-1">
            <p className="text-xs text-ink-muted shrink-0">
              % distribution around CD · μ curve fitting · weekly comparison.
            </p>
            <div className="shrink-0 rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3">
              <PredictionGuidePanel
                accTable={accTable}
                sheetLoading={sheetLoading}
                sheetError={sheetError}
                accuracyDataStale={accuracyDataStale}
                manifestUpdatedAt={manifestUpdatedAt}
                onReloadAccuracy={onReload}
              />
            </div>
          </div>
        )}

        {tab === "prediction" && (
          <div className="flex flex-col flex-1 overflow-y-auto pr-1">
            <ViewErrorBoundary label="Prediction & recommendation engine">
              <TesterPredictionTab
                apiOk={_apiOk}
                simTable={simTable ?? null}
                chartsBundle={chartsBundle ?? null}
              />
            </ViewErrorBoundary>
          </div>
        )}

      </div>
    </section>
  );
}
