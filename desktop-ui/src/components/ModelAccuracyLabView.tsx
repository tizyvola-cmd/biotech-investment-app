import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SheetTable } from "../types";
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
import { InvestmentSimOutcomesPanel } from "./InvestmentSimOutcomesPanel";
import { LearningLabView } from "./LearningLabView";
import { EisSignalImpactPanel } from "./EisSignalImpactPanel";
import { QcTodayDashboard } from "./QcTodayDashboard";
import { SellsQualityTab } from "./SellsQualityPanel";
import { SdsPredictionAccuracyPanel } from "./SdsPredictionAccuracyPanel";
import { INVEST_SIM_INPUTS_CHANGED_EVENT } from "../sheet/investSimStorage";
import { loadModelLearningsBundle } from "../data/modelLearningsData";
import { buildModelLearningsView } from "../sheet/modelLearningsTimeline";
import { fetchDesktopManifest, invalidateProjectJsonCache } from "../data/projectData";

type ModelsTab = "performance" | "portfolio" | "distribution" | "sells";
type PerformanceSubview = "dashboard" | "learning" | "sds-accuracy" | "eis-analysis";

/** Legacy route aliases → top-level tab. */
export type ModelsTabId =
  | ModelsTab
  | "ra-score-calibration"
  | "ra-calibration"
  | "sds-prediction-accuracy"
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
  | "preCdSignals";

const LEGACY_TAB: Record<string, ModelsTab> = {
  "ra-score-calibration": "performance",
  "ra-calibration": "performance",
  "sds-prediction-accuracy": "performance",
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
  distribution: "distribution",
  portfolio: "portfolio",
};

function resolveInitialTab(initialTab: ModelsTabId | undefined): ModelsTab {
  if (initialTab === undefined) return "performance";
  if (initialTab in LEGACY_TAB) return LEGACY_TAB[initialTab];
  if (
    initialTab === "performance" ||
    initialTab === "portfolio" ||
    initialTab === "distribution" ||
    initialTab === "sells"
  ) {
    return initialTab;
  }
  return "performance";
}

function resolveInitialPerformanceSubview(initialTab: ModelsTabId | undefined): PerformanceSubview {
  if (initialTab === "learning") return "learning";
  if (initialTab === "sds-prediction-accuracy") return "sds-accuracy";
  if (initialTab === "eis-signal-impact" || initialTab === "eis-analysis") return "eis-analysis";
  return "dashboard";
}

function tabBtn(active: boolean) {
  return `rounded-md px-3 py-1.5 text-sm transition ${
    active ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
  }`;
}

/** Model analysis — performance QC, portfolio outcomes, CD distribution curves. */
export function ModelAccuracyLabView({
  accTable,
  simTable,
  loading: sheetLoading,
  simLoading = false,
  error: sheetError,
  onReload,
  onReloadSimulation,
  onOpenSimulationPnl,
  onOpenDailyPnlLedger,
  accuracyDataStale,
  manifestUpdatedAt,
  initialTab,
  onInitialTabConsumed,
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
  const [learningReloadToken, setLearningReloadToken] = useState(0);
  const [portfolioReloadToken, setPortfolioReloadToken] = useState(0);
  const [signalsReloadToken, setSignalsReloadToken] = useState(0);
  const [sdsAccUpdatedAt, setSdsAccUpdatedAt] = useState<string | null>(null);
  const [eisMagUpdatedAt, setEisMagUpdatedAt] = useState<string | null>(null);
  const [eisMagReloadToken, setEisMagReloadToken] = useState(0);
  const modelLabAccuracySigRef = useRef("");

  useEffect(() => {
    if (initialTab === undefined) return;
    setTab(resolveInitialTab(initialTab));
    setPerformanceSubview(resolveInitialPerformanceSubview(initialTab));
    onInitialTabConsumed?.();
  }, [initialTab, onInitialTabConsumed]);

  useEffect(() => {
    if (tab !== "performance") {
      setPerformanceSubview("dashboard");
    }
  }, [tab]);

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
    if (typeof window === "undefined") return;
    const onPortfolioChanged = () => setSignalsReloadToken((n) => n + 1);
    window.addEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onPortfolioChanged);
    return () =>
      window.removeEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onPortfolioChanged);
  }, []);

  useEffect(() => {
    const unsub = window.supernova?.onAccuracyMonitorUpdated?.(() => {
      invalidateProjectJsonCache();
      void reloadLearningsBundle();
    });
    return unsub ?? undefined;
  }, [reloadLearningsBundle]);

  useEffect(() => {
    if (
      tab !== "performance" ||
      (performanceSubview !== "sds-accuracy" &&
        performanceSubview !== "eis-analysis")
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
        if (performanceSubview === "eis-analysis") {
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
  }, [tab, performanceSubview]);

  const handleReload = useCallback(() => {
    if (tab === "performance" && performanceSubview === "learning") {
      setLearningReloadToken((n) => n + 1);
      return;
    }
    if (
      tab === "performance" &&
      (performanceSubview === "sds-accuracy" ||
        performanceSubview === "eis-analysis")
    ) {
      setLearningsReloadToken((n) => n + 1);
      if (performanceSubview === "eis-analysis") {
        setEisMagReloadToken((n) => n + 1);
      }
      return;
    }
    if (tab === "portfolio") {
      onReloadSimulation?.();
      setPortfolioReloadToken((n) => n + 1);
      setSignalsReloadToken((n) => n + 1);
      return;
    }
    if (tab === "distribution") {
      onReload();
      return;
    }
    onReload();
    setLearningsReloadToken((n) => n + 1);
  }, [tab, performanceSubview, onReload, onReloadSimulation]);

  const hasSummary = summaryRows.length > 0;
  const t = useT();
  const subtitle =
    tab === "performance"
      ? performanceSubview === "learning"
        ? t("modelLab.subtitle.learningLab")
        : performanceSubview === "sds-accuracy"
          ? t("modelLab.subtitle.sdsAccuracy")
          : performanceSubview === "eis-analysis"
            ? t("modelLab.subtitle.eisAnalysis")
            : t("modelLab.subtitle.performance")
      : tab === "portfolio"
        ? t("modelLab.subtitle.portfolio")
        : tab === "sells"
          ? t("modelLab.subtitle.sells")
          : t("modelLab.subtitle.distribution");

  const curveErrors = useMemo(() => {
    const errs: string[] = [];
    if (monitorError) errs.push(monitorError);
    if (summaryError) errs.push(summaryError);
    return errs;
  }, [monitorError, summaryError]);

  const reloadLoading =
    tab === "portfolio"
      ? simLoading
      : tab === "distribution"
        ? sheetLoading
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
            className={tabBtn(tab === "portfolio")}
            onClick={() => setTab("portfolio")}
          >
            {t("modelLab.tab.portfolio")}
          </button>
          <button
            type="button"
            className={tabBtn(tab === "sells")}
            onClick={() => setTab("sells")}
          >
            {t("modelLab.tab.sells")}
          </button>
          <button
            type="button"
            className={tabBtn(tab === "distribution")}
            onClick={() => setTab("distribution")}
          >
            {t("modelLab.tab.distribution")}
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
              onOpenLearningLab={() => setPerformanceSubview("learning")}
              onOpenSdsAccuracy={() => setPerformanceSubview("sds-accuracy")}
              onOpenEisAnalysis={() => setPerformanceSubview("eis-analysis")}
            />
          </ViewErrorBoundary>
        )}

        {tab === "performance" && performanceSubview === "sds-accuracy" && (
          <div className="flex flex-col flex-1 gap-3">
            <button
              type="button"
              className="self-start shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
              onClick={() => setPerformanceSubview("dashboard")}
            >
              ← {t("modelLab.performance.backToDashboard")}
            </button>
            <ViewErrorBoundary label="SDS Prediction Accuracy">
              <SdsPredictionAccuracyPanel
                simTable={simTable ?? null}
                reloadToken={learningsReloadToken}
                dataUpdatedAt={sdsAccUpdatedAt}
              />
            </ViewErrorBoundary>
          </div>
        )}

        {tab === "performance" && performanceSubview === "eis-analysis" && (
          <div className="flex flex-col flex-1 gap-3">
            <button
              type="button"
              className="self-start shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
              onClick={() => setPerformanceSubview("dashboard")}
            >
              ← {t("modelLab.performance.backToDashboard")}
            </button>
            <div className="flex flex-col flex-1 pr-1">
              <ViewErrorBoundary label="EIS signal impact">
                <EisSignalImpactPanel
                  curveImpact={learningsSources?.signalCalib?.curve_impact_cumulative}
                  reloadToken={eisMagReloadToken + learningsReloadToken}
                  dataUpdatedAt={eisMagUpdatedAt}
                />
              </ViewErrorBoundary>
            </div>
          </div>
        )}

        {tab === "performance" && performanceSubview === "learning" && (
          <div className="flex flex-col flex-1 gap-3">
            <button
              type="button"
              className="self-start shrink-0 rounded-md border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface/70 transition"
              onClick={() => setPerformanceSubview("dashboard")}
            >
              ← {t("modelLab.performance.backToDashboard")}
            </button>
            <ViewErrorBoundary label="Learning Lab">
              <LearningLabView reloadToken={learningReloadToken} simTable={simTable ?? null} />
            </ViewErrorBoundary>
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

        {tab === "portfolio" && (
          <div className="flex flex-col flex-1 pr-1">
            <ViewErrorBoundary label="Your portfolio">
              <InvestmentSimOutcomesPanel
                reloadToken={portfolioReloadToken + signalsReloadToken}
                simTable={simTable ?? null}
                onOpenSimulationPnl={onOpenSimulationPnl}
                onOpenDailyPnlLedger={onOpenDailyPnlLedger}
              />
            </ViewErrorBoundary>
          </div>
        )}

        {tab === "sells" && (
          <div className="flex flex-col flex-1 pr-1">
            <SellsQualityTab
              simTable={simTable ?? null}
              reloadToken={portfolioReloadToken + signalsReloadToken}
            />
          </div>
        )}
      </div>
    </section>
  );
}
