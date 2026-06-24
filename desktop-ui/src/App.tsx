import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadMarketContextDoc } from "./sheet/marketContextGate";
import {
  fetchAccuracySheet,
  fetchClinicalSimulationSheet,
  fetchSecK8SimulationSheet,
  fetchFinancialSheet,
  fetchHealth,
  fetchOrchestratorLog,
  fetchSimulationSheet,
  fetchStatus,
} from "./api/supernova";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopBar } from "./components/AppTopBar";
import { NotificationBell } from "./components/NotificationBell";
import { useSignalAlerts } from "./hooks/useSignalAlerts";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import type { CatalystChartsSubPanel } from "./components/CatalystHubView";
import {
  RefreshDataModal,
  type DecisionLabTab,
} from "./components/InvestmentDecisionLabView";
import { InvestmentSimulationView } from "./components/InvestmentSimulationView";
import { PortfolioRefreshAlertsModal } from "./components/PortfolioRefreshAlertsModal";
import { PortfolioLossUrgentModal } from "./components/PortfolioLossUrgentModal";
import { SimLoopTradeAlertModal } from "./components/SimLoopTradeAlertModal";
import { GapInvestigationModal } from "./components/GapInvestigationModal";
import { RecommendationAlertModal } from "./components/RecommendationAlertModal";
import { SynthSyncSummaryModal } from "./components/SynthSyncSummaryModal";
import { useInvestSimInputsMutable, usePortfolioRegisterBuy, usePortfolioSell } from "./hooks/useInvestSimInputs";
import { useRecommendationAlertQueue } from "./hooks/useRecommendationAlertQueue";
import { useDecisionSimMarketScheduler } from "./hooks/useDecisionSimMarketScheduler";
import { buildSimRowByKeyMap } from "./sheet/investSimKeys";
import { loadUiPrefsLocal } from "./sheet/uiPrefs";
import { runManualSynthSyncForRow, SYNTH_SYNC_COMPLETED_EVENT, type SynthSyncSummary } from "./sheet/synthCapitalSyncLog";
import {
  computeSimulationPosition,
  positionCapitalPnlPct,
  rowHasActivePortfolio,
} from "./sheet/simulationPosition";
import type { SimulationNavFocus } from "./sheet/investSimStorage";
import type { ChartBundle } from "./types";
import {
  loadSimulationChartsBundle,
  lossAlertsChartsReady,
  peekSimulationChartsBundle,
  chartPointsMapFromBundle,
} from "./data/simulationCharts";
import {
  ackLossModalBatch,
  dismissPortfolioLossAlert,
  dismissPortfolioLossAlerts,
  isLossModalAutoShownThisSession,
  isLossModalBatchAcked,
  lossAlertKeySig,
  markLossModalAutoShownThisSession,
  pendingPortfolioLossAlerts,
  type PortfolioLossAlert,
} from "./sheet/portfolioLossUrgent";
import { filterUrgentPortfolioLossAlerts, prioritizeLossAlertsBySlopeExit } from "./sheet/portfolioLossAnalysis";
import {
  SIM_LOOP_TRADE_ALERT_EVENT,
  type SimLoopTradeAlertBatch,
} from "./sheet/simLoopTradeAlerts";
import {
  GAP_INVESTIGATION_EVENT,
  type GapInvestigationModalPayload,
} from "./sheet/gapInvestigationTypes";
import { commitGapInvestigationDecision } from "./sheet/gapInvestigationGate";
import { loadSdsCohort, readLocalSdsSnapshot, type SdsRow } from "./api/supernova";
import {
  clearPortfolioReviewPending,
  closeSundayRefreshResult,
  getRefreshDurationClass,
  getRefreshSnapshot,
  isRefreshInFlight,
  markReloadCompleted,
  requestSundayFullAutostart,
  setRefreshModalOpen,
  setRefreshStoreApiOk,
  setDataUpdatedAt,
  useRefreshStatus,
} from "./shared/refreshStatusStore";
import { resolveDataRefreshIso } from "./shared/dataFreshness";
import {
  shouldAutoStartSundayFull,
} from "./shared/sundayRefreshSchedule";
import { SundayRefreshResultModal } from "./components/SundayRefreshResultModal";
import {
  buildPostRefreshPortfolioAlerts,
  capturePortfolioBeforeRefresh,
  filterOpeningPortfolioAlerts,
  hasOpeningPortfolioAlertsToShow,
  type PortfolioRefreshAlert,
} from "./sheet/portfolioRefreshAlerts";
import {
  acknowledgeMorningDiscovery,
  buildMorningDiscoveryAlerts,
  ensureSimulationBaseline,
  manifestSignature,
  MORNING_DISCOVERY_COPY,
  shouldShowMorningDiscovery,
} from "./sheet/morningDiscovery";
import {
  acknowledgeClinicalFeedRefresh,
  checkClinicalFeedRefreshPopup,
  CLINICAL_FEED_REFRESH_COPY,
  type ClinicalFeedRefreshReport,
} from "./sheet/clinicalFeedRefresh";
import { CoherenceAlertModal } from "./components/CoherenceAlertModal";
import { buildCrossTabCoherenceReport } from "./sheet/crossTabCoherence";
import {
  assessCrossTabCoherenceHealth,
  type CoherenceCriticalIssue,
} from "./sheet/crossTabCoherenceHealth";
import { ackCoherenceAlert, isCoherenceAlertAcked } from "./sheet/coherenceAlertDismiss";
import { subscribeTopOpps } from "./sheet/topOppsStore";
import { loadPredictions } from "./data/predictions";
import { loadLocalSheet } from "./data/localSheets";
import { probeApiReachable, fetchNewBioIpoStatus } from "./api/supernova";
import {
  accuracyManifestSignature,
  desktopDataDirHint,
  fetchDesktopManifest,
  isDesktopShell,
} from "./data/projectData";
import type { TranslationKey } from "./shared/i18n";
import { useLang } from "./shared/i18n";
import {
  REMOTE_HOST_CHANGED_EVENT,
} from "./shared/remoteHost";
import {
  applyThemeToDocument,
  loadResolvedTheme,
  saveStoredTheme,
  type ResolvedTheme,
} from "./sheet/themePrefs";
import type { ApiStatus, AppScreen, CatalystRow, SheetTable } from "./types";
import { useScreenNavigation } from "./shared/useScreenNavigation";

const MainDashboardView = lazy(() =>
  import("./components/MainDashboardView").then((m) => ({ default: m.MainDashboardView })),
);
const CatalystHubView = lazy(() =>
  import("./components/CatalystHubView").then((m) => ({ default: m.CatalystHubView })),
);
const ClinicalSimulationView = lazy(() =>
  import("./components/ClinicalSimulationView").then((m) => ({ default: m.ClinicalSimulationView })),
);
const SecK8SimulationView = lazy(() =>
  import("./components/SecK8SimulationView").then((m) => ({ default: m.SecK8SimulationView })),
);
const CatalystFeedView = lazy(() =>
  import("./components/CatalystFeedView").then((m) => ({ default: m.CatalystFeedView })),
);
const InvestmentDecisionLabView = lazy(() =>
  import("./components/InvestmentDecisionLabView").then((m) => ({
    default: m.InvestmentDecisionLabView,
  })),
);
const ModelAccuracyLabView = lazy(() =>
  import("./components/ModelAccuracyLabView").then((m) => ({ default: m.ModelAccuracyLabView })),
);
const FinancialSheetView = lazy(() =>
  import("./components/FinancialSheetView").then((m) => ({ default: m.FinancialSheetView })),
);
const TesterMonitorView = lazy(() =>
  import("./components/TesterMonitorView").then((m) => ({ default: m.TesterMonitorView })),
);
const SystemView = lazy(() =>
  import("./components/SystemView").then((m) => ({ default: m.SystemView })),
);

type ModelsTabId = import("./components/ModelAccuracyLabView").ModelsTabId;

function ScreenFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-ink-muted text-sm p-8 min-h-[120px]">
      Loading…
    </div>
  );
}

export default function App() {
  const { screen, navigateTo: pushScreen, goBack, canGoBack, previousScreen } =
    useScreenNavigation("main");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigateTo = useCallback((next: AppScreen) => {
    pushScreen(next);
    setMobileNavOpen(false);
  }, [pushScreen]);
  const { lang } = useLang();
  const isDecisionLabShell = screen === "decisionLab";
  const [theme, setTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") return "light";
    return loadResolvedTheme();
  });

  const handleThemeChange = useCallback((next: ResolvedTheme) => {
    saveStoredTheme(next);
    setTheme(next);
    applyThemeToDocument(next);
  }, []);

  const [allRows, setAllRows] = useState<CatalystRow[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  // Filtro/paginazione del defunto pannello "Lista Catalyst" — rimossi.

  const [desktopManifest, setDesktopManifest] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  const [simTable, setSimTable] = useState<SheetTable | null>(null);
  const [clinicalFeedReloadToken, setClinicalFeedReloadToken] = useState(0);
  const [clinicalFeedFocusTicker, setClinicalFeedFocusTicker] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const [clinicalTable, setClinicalTable] = useState<SheetTable | null>(null);
  const [clinicalLoading, setClinicalLoading] = useState(false);
  const [clinicalError, setClinicalError] = useState<string | null>(null);

  const [secK8Table, setSecK8Table] = useState<SheetTable | null>(null);
  const [secK8Loading, setSecK8Loading] = useState(false);
  const [secK8Error, setSecK8Error] = useState<string | null>(null);

  const [accTable, setAccTable] = useState<SheetTable | null>(null);
  const [accLoading, setAccLoading] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);
  /** Firma manifest Accuracy al momento dell’ultimo caricamento foglio. */
  const [accManifestSigAtLoad, setAccManifestSigAtLoad] = useState("");
  const [accManifestSigLive, setAccManifestSigLive] = useState("");

  const [finTable, setFinTable] = useState<SheetTable | null>(null);
  const [finLoading, setFinLoading] = useState(false);
  const [finError, setFinError] = useState<string | null>(null);
  const [secK8FocusTicker, setSecK8FocusTicker] = useState<string | null>(null);
  const [catalystChartsFocus, setCatalystChartsFocus] = useState<{
    seriesKey: string | null;
    ticker: string;
  } | null>(null);
  const [catalystChartsSubFocus, setCatalystChartsSubFocus] = useState<CatalystChartsSubPanel | null>(null);
  const [slopeChartsFocusTicker, setSlopeChartsFocusTicker] = useState<string | null>(null);
  const [decisionLabFocus, setDecisionLabFocus] = useState<{
    ticker: string;
    cd?: string;
  } | null>(null);
  const [decisionLabMonitorFocus, setDecisionLabMonitorFocus] =
    useState<SimulationNavFocus | null>(null);
  const [simulationFocus, setSimulationFocus] = useState<SimulationNavFocus | null>(null);
  const [decisionLabInitialTab, setDecisionLabInitialTab] = useState<DecisionLabTab | "portfolio" | null>(null);
  const [decisionLabSdsFocusTicker, setDecisionLabSdsFocusTicker] = useState<string | null>(null);
  const [modelsInitialTab, setModelsInitialTab] = useState<ModelsTabId | null>(null);

  const openSlopeErrorCharts = useCallback((ticker?: string) => {
    setCatalystChartsFocus(null);
    setCatalystChartsSubFocus("slopeErrors");
    setSlopeChartsFocusTicker(ticker?.trim().toUpperCase() || null);
    navigateTo("catalyst");
  }, [navigateTo]);

  const openPredictionCharts = useCallback(
    (focus: { seriesKey: string | null; ticker: string }) => {
      setCatalystChartsSubFocus(null);
      setSlopeChartsFocusTicker(null);
      setCatalystChartsFocus({
        seriesKey: focus.seriesKey,
        ticker: focus.ticker.trim().toUpperCase(),
      });
      navigateTo("catalyst");
    },
    [navigateTo],
  );

  const openSecK8 = useCallback((ticker?: string) => {
    setSecK8FocusTicker(ticker?.trim().toUpperCase() || null);
    navigateTo("secK8");
  }, [navigateTo]);

  const handleNavigateToSimulation = useCallback(
    (ticker: string, action: "buy" | "sell", cd?: string) => {
      setDecisionLabMonitorFocus({
        ticker: ticker.trim().toUpperCase(),
        action,
        cd: cd?.trim() || undefined,
      });
      navigateTo("decisionLab");
    },
    [navigateTo],
  );

  const handleOpenSimulationRow = useCallback((focus: {
    ticker: string;
    cd?: string;
    rowKey?: string;
    syncToSynth?: boolean;
  }) => {
    setSimulationFocus({
      ticker: focus.ticker.trim().toUpperCase(),
      cd: focus.cd?.trim() || undefined,
      rowKey: focus.rowKey?.trim() || undefined,
      syncToSynth: focus.syncToSynth,
      view: "snapshotBar",
    });
    navigateTo("simulation");
  }, [navigateTo]);

  const handleOpenPatternScreen = useCallback((ticker?: string) => {
    void ticker;
    setDecisionLabInitialTab("patterns");
    navigateTo("decisionLab");
  }, [navigateTo]);

  const handleOpenSupernovaTab = useCallback((ticker?: string) => {
    setDecisionLabFocus(null);
    setDecisionLabMonitorFocus(null);
    setDecisionLabInitialTab("sds");
    setDecisionLabSdsFocusTicker(ticker?.trim().toUpperCase() || null);
    navigateTo("decisionLab");
  }, [navigateTo]);

  const handleNavigateToSimulationPnl = useCallback(() => {
    setSimulationFocus({ view: "snapshotBar" });
    navigateTo("simulation");
  }, [navigateTo]);

  const handleNavigateToDailyPnlLedger = useCallback(() => {
    setSimulationFocus({ view: "snapshotBar", openDailyLedger: true });
    navigateTo("simulation");
  }, [navigateTo]);

  const handleNavigateToSimulationLossAnalysis = useCallback(
    (ticker?: string, cd?: string, rowKey?: string) => {
      const tk = ticker?.trim().toUpperCase();
      setSimulationFocus({
        ...(tk
          ? {
              ticker: tk,
              cd: cd?.trim() || undefined,
              rowKey: rowKey?.trim() || undefined,
            }
          : {}),
        view: "lossAnalysis",
      });
      navigateTo("simulation");
    },
    [navigateTo],
  );

  const handleOpenSimulationSheetRow = useCallback(
    (focus: { ticker: string; cd?: string; action?: "buy" | "sell" }) => {
      setDecisionLabMonitorFocus({
        ticker: focus.ticker.trim().toUpperCase(),
        cd: focus.cd?.trim() || undefined,
        action: focus.action,
      });
      navigateTo("decisionLab");
    },
    [navigateTo],
  );

  useEffect(() => {
    void loadMarketContextDoc();
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const reloadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const { rows, error } = await loadPredictions();
    setAllRows(rows);
    if (error) setDataError(error);
    setDataLoading(false);
  }, []);

  const applyDesktopManifest = useCallback(
    (m: { updated_at?: string | null; workbook_mtime?: string | null } | null) => {
      if (!m) return;
      const iso = resolveDataRefreshIso(m.updated_at, m.workbook_mtime);
      if (!iso) return;
      setDesktopManifest(iso);
      setDataUpdatedAt(iso);
    },
    [],
  );

  useEffect(() => {
    void fetchDesktopManifest().then(applyDesktopManifest);
  }, [applyDesktopManifest]);

  /** Catalyst predictions (~32MB JSON) — solo quando serve Catalyst Hub / Feed, non al boot dashboard. */
  useEffect(() => {
    if (screen !== "catalyst" && screen !== "catalystFeed") return;
    if (dataLoading || allRows.length > 0) return;
    void reloadData();
  }, [screen, dataLoading, allRows.length, reloadData]);

  const refreshApi = useCallback(async () => {
    try {
      await fetchHealth();
      setApiOk(true);
      setRefreshStoreApiOk(true);
    } catch {
      setApiOk(false);
      setRefreshStoreApiOk(false);
      return;
    }
    try {
      setStatus(await fetchStatus());
      const l = await fetchOrchestratorLog(4000);
      setLog(l.log);
    } catch {
      /* Health OK — keep online badge; status/log are best-effort. */
    }
  }, []);

  // Lightweight health-only poller. ``refreshApi`` does several heavy calls
  // (status + log tails) that we only want at boot and after recovery; for
  // continuous monitoring we just ping ``/api/health`` and flip ``apiOk``.
  // Why: when the desktop app starts BEFORE the Python subprocess finishes
  // its imports, the very first ``refreshApi`` fails and the UI shows "API
  // offline" forever (there was no retry). With this poller, as soon as the
  // backend becomes reachable the badge clears itself and the full status
  // bundle is refreshed once via ``refreshApi``.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await fetchHealth();
        if (cancelled) return;
        if (!apiOk) {
          // Just came back online: rerun the heavy bundle once.
          void refreshApi();
        } else {
          setApiOk(true);
          setRefreshStoreApiOk(true);
        }
      } catch {
        if (!cancelled) {
          setApiOk(false);
          setRefreshStoreApiOk(false);
        }
      }
    };
    void tick();
    // Faster poll while offline (5s) so first boot recovers quickly; slower
    // when healthy (20s) to avoid noise.
    const interval = apiOk ? 20_000 : 5_000;
    const id = window.setInterval(() => { void tick(); }, interval);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiOk, refreshApi]);

  const reloadSimulation = useCallback(async (): Promise<SheetTable | null> => {
    setSimLoading(true);
    setSimError(null);
    try {
      let local: import("./types").SheetTable | null = null;
      try {
        local = await loadLocalSheet("simulation");
        // Preview only — keep simLoading true until remote fetch completes so
        // Piggy Bank / dashboard P&L don't flash stale cached prices.
        setSimTable(local);
      } catch {
        /* snapshot assente — attendi fetch completo */
      }
      const online = await probeApiReachable();
      if (local && !online) {
        return local;
      }
      const t = await fetchSimulationSheet();
      setSimTable(t);
      if (t.error) setSimError(t.error);
      return t;
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSimLoading(false);
    }
  }, []);

  const reloadAccuracy = useCallback(async () => {
    setAccLoading(true);
    setAccError(null);
    try {
      const t = await fetchAccuracySheet();
      setAccTable(t);
      if (t.error) setAccError(t.error);
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccLoading(false);
    }
    void fetchDesktopManifest().then((m) => {
      const sig = accuracyManifestSignature(m);
      setAccManifestSigAtLoad(sig);
      setAccManifestSigLive(sig);
      if (m?.updated_at) applyDesktopManifest(m);
    });
  }, []);

  const reloadClinical = useCallback(async () => {
    setClinicalLoading(true);
    setClinicalError(null);
    try {
      const t = await fetchClinicalSimulationSheet();
      setClinicalTable(t);
      if (t.error) setClinicalError(t.error);
    } catch (e) {
      setClinicalError(e instanceof Error ? e.message : String(e));
    } finally {
      setClinicalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      (screen === "main" ||
        screen === "catalyst" ||
        screen === "clinical" ||
        screen === "secK8" ||
        screen === "decisionLab" ||
        screen === "simulation") &&
      !simTable &&
      !simLoading
    ) {
      void reloadSimulation();
    }
  }, [screen, simTable, simLoading, reloadSimulation]);

  useEffect(() => {
    if (screen === "clinical" && !clinicalTable && !clinicalLoading) {
      void reloadClinical();
    }
  }, [screen, clinicalTable, clinicalLoading, reloadClinical]);

  const reloadSecK8 = useCallback(async () => {
    setSecK8Loading(true);
    setSecK8Error(null);
    try {
      try {
        const quick = await loadLocalSheet("secK8");
        setSecK8Table(quick);
        setSecK8Loading(false);
      } catch {
        /* snapshot assente */
      }
      const t = await fetchSecK8SimulationSheet();
      setSecK8Table(t);
      if (t.error) setSecK8Error(t.error);
    } catch (e) {
      setSecK8Error(e instanceof Error ? e.message : String(e));
    } finally {
      setSecK8Loading(false);
    }
  }, []);

  useEffect(() => {
    if ((screen === "main" || screen === "secK8") && !secK8Table && !secK8Loading) {
      void reloadSecK8();
    }
  }, [screen, secK8Table, secK8Loading, reloadSecK8]);

  useEffect(() => {
    if (
      screen === "models" &&
      !accTable &&
      !accLoading
    ) {
      void reloadAccuracy();
    }
  }, [screen, accTable, accLoading, reloadAccuracy]);

  /** Tab Modelli: se lo snapshot Accuracy sul disco è più recente, ricarica il foglio. */
  useEffect(() => {
    if (screen !== "models") return;
    let cancelled = false;
    void fetchDesktopManifest().then((m) => {
      if (cancelled) return;
      const live = accuracyManifestSignature(m);
      setAccManifestSigLive(live);
      if (m?.updated_at) applyDesktopManifest(m);
      if (
        live &&
        accManifestSigAtLoad &&
        live !== accManifestSigAtLoad &&
        !accLoading
      ) {
        void reloadAccuracy();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [screen, accManifestSigAtLoad, accLoading, reloadAccuracy]);

  const reloadFinancial = useCallback(async () => {
    setFinLoading(true);
    setFinError(null);
    try {
      const t = await fetchFinancialSheet();
      setFinTable(t);
      if (t.error) setFinError(t.error);
      else if (!t.rows?.length) {
        setFinError(
          "No Financial rows — close Excel on the workbook, run the orchestrator, then Reload."
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFinError(
        msg.includes("abort")
          ? "Timeout (>2 min). Close Excel, restart supernova_api (port 8765) and press Reload."
          : msg
      );
      setFinTable(null);
    } finally {
      setFinLoading(false);
    }
  }, []);

  useEffect(() => {
    if (screen === "financial" && !finTable && !finLoading) void reloadFinancial();
  }, [screen, finTable, finLoading, reloadFinancial]);

  // ── Signal alerts (campanella) ──────────────────────────────────────────
  const {
    alerts,
    unreadCount,
    markAllRead,
    clearAll: clearAllAlerts,
    dismissAlert,
    checkSignals,
  } = useSignalAlerts(simTable);

  const [portfolioAlertsOpen, setPortfolioAlertsOpen] = useState(false);
  const [portfolioAlerts, setPortfolioAlerts] = useState<PortfolioRefreshAlert[]>([]);
  const [portfolioAlertsCopy, setPortfolioAlertsCopy] = useState<{
    titleKey: TranslationKey;
    subtitleKey: TranslationKey;
  }>({
    titleKey: "portfolioRefresh.modal.title",
    subtitleKey: "portfolioRefresh.modal.subtitle",
  });
  const morningDiscoveryContextRef = useRef<{ manifestSig: string; ipoFinishedAt: string }>({
    manifestSig: "",
    ipoFinishedAt: "",
  });
  const clinicalFeedReportRef = useRef<ClinicalFeedRefreshReport | null>(null);
  const lastMorningDiscoverySigRef = useRef("");
  const pendingPortfolioAlertsAfterSundayRef = useRef(false);
  /** Avoid double onRefreshComplete (System tab + modal) clearing the pre-refresh snapshot. */
  const refreshCompletionTokenRef = useRef("");
  const refreshCompleteInFlightRef = useRef(false);
  const [portfolioSummaryTotals, setPortfolioSummaryTotals] = useState<
    import("./sheet/portfolioRefreshAlerts").PortfolioSummaryTotals | null
  >(null);
  const [portfolioAlertsHeaderSummary, setPortfolioAlertsHeaderSummary] = useState<string | null>(
    null,
  );

  const { inputs: investSimInputs, patchInputs: patchInvestSimInputs } =
    useInvestSimInputsMutable(simTable);
  const sellPortfolioPosition = usePortfolioSell(simTable);
  const registerPortfolioBuy = usePortfolioRegisterBuy(simTable);

  const handleDashboardSell: import("./components/PortfolioExitButton").PortfolioSellHandler =
    useCallback(
      (key, simRow, opts) => {
        const result = sellPortfolioPosition(key, simRow, opts);
        if (result?.ok) patchInvestSimInputs(() => result.inputs);
        return result;
      },
      [sellPortfolioPosition, patchInvestSimInputs],
    );
  const [simChartsBundle, setSimChartsBundle] = useState<ChartBundle | null>(null);
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);

  const recAlertQueue = useRecommendationAlertQueue({
    simTable,
    inputs: investSimInputs,
    chartsBundle: simChartsBundle,
    sdsRows: sdsRowsForMig,
    lang: lang === "it" ? "it" : "en",
    enabled: Boolean(simTable?.rows?.length) && Boolean(apiOk),
  });

  const handleSynthTrimFromAlert = useCallback(
    (rowKey: string) => {
      const synthAlloc = recAlertQueue.alertContext.synthAlloc;
      if (!synthAlloc || !simTable?.rows?.length) return;
      const simRowByKey = buildSimRowByKeyMap(simTable.rows);
      const simRow = simRowByKey.get(rowKey);
      if (!simRow || !rowHasActivePortfolio(simRow, investSimInputs)) return;
      const pos = computeSimulationPosition(simRow, investSimInputs);
      if (!pos) return;
      const pref = loadUiPrefsLocal().topCapital;
      let topCapital = pref != null && Number.isFinite(pref) && pref > 0 ? pref : 0;
      if (topCapital <= 0) {
        for (const v of Object.values(investSimInputs)) {
          if (v.capital > 0) topCapital += v.capital;
        }
      }
      if (topCapital <= 0) topCapital = 5000;
      runManualSynthSyncForRow({
        rowKey,
        synthAlloc,
        topCapitalEur: topCapital,
        inputs: investSimInputs,
        positions: [{ key: rowKey, ticker: pos.ticker }],
        inPortfolioByKey: { [rowKey]: true },
        pnlPctByKey: {
          [rowKey]:
            positionCapitalPnlPct(pos.pnlEur, pos.capital) ??
            (Number.isFinite(pos.pnlPct) ? pos.pnlPct : null),
        },
        patchInputs: patchInvestSimInputs,
        simRowByKeyForBuy: simRowByKey,
        source: "manual",
      });
      recAlertQueue.ackAll();
    },
    [recAlertQueue, simTable, investSimInputs, patchInvestSimInputs],
  );

  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [synthSyncSummary, setSynthSyncSummary] = useState<SynthSyncSummary | null>(null);
  const [synthSyncSummaryOpen, setSynthSyncSummaryOpen] = useState(false);

  useEffect(() => {
    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent<SynthSyncSummary>).detail;
      if (!detail) return;
      setSynthSyncSummary(detail);
      setSynthSyncSummaryOpen(true);
    };
    window.addEventListener(SYNTH_SYNC_COMPLETED_EVENT, onCompleted);
    return () => window.removeEventListener(SYNTH_SYNC_COMPLETED_EVENT, onCompleted);
  }, []);
  const [lossAlerts, setLossAlerts] = useState<PortfolioLossAlert[]>([]);
  const lossAlertsRef = useRef<PortfolioLossAlert[]>([]);
  const [lossAlertIndex, setLossAlertIndex] = useState(0);
  const lossAlertKeysRef = useRef("");
  /** In-memory ack for current session (key set only — not P&L). */
  const lossModalAckKeySigRef = useRef("");
  /** Set when refresh pipeline completes; cleared after user closes the modal once. */
  const lossModalShowPendingRef = useRef(false);
  const lossModalRefreshTokenRef = useRef("");
  const [coherenceAlertOpen, setCoherenceAlertOpen] = useState(false);
  const [coherenceCriticalIssues, setCoherenceCriticalIssues] = useState<CoherenceCriticalIssue[]>([]);
  const coherenceAlertSigRef = useRef("");
  const [systemCoherenceFocus, setSystemCoherenceFocus] = useState(false);
  const [simLoopTradeAlertQueue, setSimLoopTradeAlertQueue] = useState<SimLoopTradeAlertBatch[]>([]);
  const simLoopTradeAlertBatch = simLoopTradeAlertQueue[0] ?? null;
  const [gapInvestigationQueue, setGapInvestigationQueue] = useState<GapInvestigationModalPayload[]>([]);
  const gapInvestigationModal = gapInvestigationQueue[0] ?? null;

  useEffect(() => {
    const onTradeAlerts = (e: Event) => {
      const detail = (e as CustomEvent<SimLoopTradeAlertBatch>).detail;
      if (!detail?.alerts?.length) return;
      setSimLoopTradeAlertQueue((prev) => [...prev, detail].slice(-8));
    };
    window.addEventListener(SIM_LOOP_TRADE_ALERT_EVENT, onTradeAlerts);
    return () => window.removeEventListener(SIM_LOOP_TRADE_ALERT_EVENT, onTradeAlerts);
  }, []);

  useEffect(() => {
    const onGapInvestigation = (e: Event) => {
      const detail = (e as CustomEvent<GapInvestigationModalPayload>).detail;
      if (!detail?.recordId || !detail.event) return;
      setGapInvestigationQueue((prev) => {
        if (prev.some((p) => p.recordId === detail.recordId)) return prev;
        return [...prev, detail].slice(-8);
      });
    };
    window.addEventListener(GAP_INVESTIGATION_EVENT, onGapInvestigation);
    return () => window.removeEventListener(GAP_INVESTIGATION_EVENT, onGapInvestigation);
  }, []);

  const handleGapInvestigationClose = useCallback(() => {
    setGapInvestigationQueue((q) => q.slice(1));
  }, []);

  const handleGapInvestigationCommit = useCallback(
    (recordId: string, decision: Parameters<typeof commitGapInvestigationDecision>[1]) => {
      commitGapInvestigationDecision(recordId, decision);
      setGapInvestigationQueue((q) => q.filter((p) => p.recordId !== recordId));
    },
    [],
  );

  useEffect(() => {
    lossAlertsRef.current = lossAlerts;
  }, [lossAlerts]);

  useEffect(() => {
    if (!simTable?.rows?.length) {
      setSimChartsBundle(null);
      return;
    }
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setSimChartsBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [simTable?.rows?.length]);

  const coherenceChartMap = useMemo(
    () => chartPointsMapFromBundle(simChartsBundle ?? peekSimulationChartsBundle()),
    [simChartsBundle],
  );

  useEffect(() => {
    const runCoherenceAlertCheck = () => {
      if (!simTable?.rows?.length) return;
      const report = buildCrossTabCoherenceReport(
        simTable,
        investSimInputs,
        coherenceChartMap.size > 0 ? coherenceChartMap : undefined,
      );
      const health = assessCrossTabCoherenceHealth(report);
      if (health.criticalIssues.length === 0) return;
      if (isCoherenceAlertAcked(health.signature)) return;
      coherenceAlertSigRef.current = health.signature;
      setCoherenceCriticalIssues(health.criticalIssues);
      setCoherenceAlertOpen(true);
    };
    runCoherenceAlertCheck();
    return subscribeTopOpps(runCoherenceAlertCheck);
  }, [simTable, investSimInputs, coherenceChartMap]);

  const handleCoherenceAlertClose = useCallback(() => {
    if (coherenceAlertSigRef.current) ackCoherenceAlert(coherenceAlertSigRef.current);
    setCoherenceAlertOpen(false);
  }, []);

  const capturePortfolioBeforeRefreshCb = useCallback(() => {
    capturePortfolioBeforeRefresh(simTable);
  }, [simTable]);

  const tryOpenLossModal = useCallback(
    (pending: PortfolioLossAlert[], bundle: ChartBundle | null) => {
      if (!lossModalShowPendingRef.current) return;
      if (isLossModalAutoShownThisSession()) {
        lossModalShowPendingRef.current = false;
        return;
      }
      const keySig = lossAlertKeySig(pending);
      const token = lossModalRefreshTokenRef.current;
      if (
        lossModalAckKeySigRef.current === keySig ||
        isLossModalBatchAcked(token, keySig)
      ) {
        lossModalShowPendingRef.current = false;
        return;
      }
      setSimChartsBundle(bundle);
      if (lossAlertsChartsReady(pending, bundle)) {
        markLossModalAutoShownThisSession();
        setLossModalOpen(true);
      }
    },
    [],
  );

  const reloadAllSheets = useCallback(async (): Promise<SheetTable | null> => {
    const sim = await reloadSimulation();
    await Promise.all([
      reloadData(),
      reloadClinical(),
      reloadSecK8(),
      reloadAccuracy(),
      reloadFinancial(),
    ]);
    void fetchDesktopManifest().then((m) => {
      if (m?.updated_at) applyDesktopManifest(m);
    });
    return sim;
  }, [reloadData, reloadSimulation, reloadClinical, reloadSecK8, reloadAccuracy, reloadFinancial]);

  const runMorningDiscoveryCheck = useCallback(
    async (sim: SheetTable | null) => {
      if (!sim?.rows?.length) return;
      ensureSimulationBaseline(sim);
      let ipoSummary = null;
      try {
        const st = await fetchNewBioIpoStatus();
        ipoSummary = st.summary ?? null;
      } catch {
        /* optional */
      }
      let manifest = null;
      try {
        manifest = await fetchDesktopManifest();
      } catch {
        /* optional */
      }
      const manifestSig = manifestSignature(manifest);
      const ipoFinishedAt = ipoSummary?.finished_at ?? "";
      const alerts = buildMorningDiscoveryAlerts(sim, ipoSummary);
      if (!shouldShowMorningDiscovery(alerts, manifestSig, ipoFinishedAt)) return;
      const dedupeSig = `${manifestSig}|${ipoFinishedAt}|${alerts.map((a) => a.id).join(";")}`;
      if (lastMorningDiscoverySigRef.current === dedupeSig) return;
      lastMorningDiscoverySigRef.current = dedupeSig;
      morningDiscoveryContextRef.current = { manifestSig, ipoFinishedAt };
      setPortfolioAlertsCopy(MORNING_DISCOVERY_COPY);
      setPortfolioSummaryTotals(null);
      setPortfolioAlertsHeaderSummary(null);
      setPortfolioAlerts(alerts);
    },
    [],
  );

  const runClinicalFeedRefreshCheck = useCallback(async () => {
    if (portfolioAlertsOpen) return;
    const { show, report, alerts, modalSummary } = await checkClinicalFeedRefreshPopup(
      lang === "it" ? "it" : "en",
    );
    if (!show || !report || !alerts.length) return;
    clinicalFeedReportRef.current = report;
    setPortfolioAlertsCopy(CLINICAL_FEED_REFRESH_COPY);
    setPortfolioSummaryTotals(null);
    setPortfolioAlertsHeaderSummary(modalSummary);
    setPortfolioAlerts(alerts);
    // Feed clinico: niente popup automatico all'apertura.
  }, [portfolioAlertsOpen, lang]);

  const handlePortfolioAlertsClose = useCallback(() => {
    if (portfolioAlertsCopy.titleKey === "morningDiscovery.modal.title") {
      acknowledgeMorningDiscovery(
        simTable,
        morningDiscoveryContextRef.current.manifestSig,
        morningDiscoveryContextRef.current.ipoFinishedAt,
      );
    }
    if (portfolioAlertsCopy.titleKey === "clinicalFeedRefresh.modal.title") {
      void acknowledgeClinicalFeedRefresh(clinicalFeedReportRef.current);
      clinicalFeedReportRef.current = null;
    }
    setPortfolioAlertsHeaderSummary(null);
    setPortfolioAlertsOpen(false);
  }, [portfolioAlertsCopy.titleKey, simTable]);

  useEffect(() => {
    if (simLoading) return;
    let cancelled = false;
    void loadSdsCohort(false)
      .then((doc) => {
        if (!cancelled && doc?.rows?.length) setSdsRowsForMig(doc.rows);
      })
      .catch(() => {
        void readLocalSdsSnapshot().then((doc) => {
          if (!cancelled && doc?.rows?.length) setSdsRowsForMig(doc.rows);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [simTable, simLoading]);

  useEffect(() => {
    if (simLoading) return;
    if (!simTable?.rows?.length) {
      if (!lossModalOpen) {
        setLossAlerts([]);
        lossAlertKeysRef.current = "";
      }
      return;
    }
    const pendingRaw = pendingPortfolioLossAlerts(simTable, investSimInputs);
    const pending = prioritizeLossAlertsBySlopeExit(
      filterUrgentPortfolioLossAlerts(pendingRaw, simTable, investSimInputs),
      simTable,
      investSimInputs,
    );
    const keySig = lossAlertKeySig(pending);
    if (pending.length === 0) {
      setLossModalOpen(false);
      setLossAlerts([]);
      lossAlertKeysRef.current = "";
      lossModalShowPendingRef.current = false;
      return;
    }
    const keysChanged = keySig !== lossAlertKeysRef.current;
    setLossAlerts(pending);
    lossAlertKeysRef.current = keySig;
    if (keysChanged) setLossAlertIndex(0);

    if (!lossModalRefreshTokenRef.current) {
      lossModalRefreshTokenRef.current = "app-start";
    }
    const refreshToken = lossModalRefreshTokenRef.current;
    if (
      !isLossModalAutoShownThisSession() &&
      refreshToken === "app-start" &&
      lossModalAckKeySigRef.current !== keySig &&
      !isLossModalBatchAcked(refreshToken, keySig)
    ) {
      lossModalShowPendingRef.current = true;
    }

    if (!lossModalShowPendingRef.current) return;

    const cached = peekSimulationChartsBundle();
    if (cached && lossAlertsChartsReady(pending, cached)) {
      tryOpenLossModal(pending, cached);
    } else {
      void loadSimulationChartsBundle().then(({ bundle }) => tryOpenLossModal(pending, bundle));
    }
  }, [simTable, investSimInputs, simLoading, lossModalOpen, tryOpenLossModal]);

  useEffect(() => {
    if (!lossModalShowPendingRef.current) return;
    if (lossModalOpen || lossAlerts.length === 0) return;
    if (isLossModalAutoShownThisSession()) {
      lossModalShowPendingRef.current = false;
      return;
    }
    const keySig = lossAlertKeysRef.current;
    const token = lossModalRefreshTokenRef.current;
    if (lossModalAckKeySigRef.current === keySig || isLossModalBatchAcked(token, keySig)) {
      lossModalShowPendingRef.current = false;
      return;
    }
    if (lossAlertsChartsReady(lossAlerts, simChartsBundle)) {
      markLossModalAutoShownThisSession();
      setLossModalOpen(true);
    }
  }, [lossAlerts, simChartsBundle, lossModalOpen]);

  const finishLossModalBatch = useCallback((alertsToDismiss: PortfolioLossAlert[] = []) => {
    const keySig = lossAlertKeysRef.current;
    const token = lossModalRefreshTokenRef.current;
    if (alertsToDismiss.length) dismissPortfolioLossAlerts(alertsToDismiss);
    if (token && keySig) ackLossModalBatch(token, keySig);
    lossModalAckKeySigRef.current = keySig;
    lossModalShowPendingRef.current = false;
    markLossModalAutoShownThisSession();
    setLossModalOpen(false);
    if (alertsToDismiss.length) {
      setLossAlerts([]);
      lossAlertKeysRef.current = "";
    }
  }, []);

  const handleCloseLossModal = useCallback(() => {
    finishLossModalBatch(lossAlertsRef.current);
  }, [finishLossModalBatch]);

  const handleDismissLossTicker = useCallback(
    (key: string, pnlPct: number) => {
      dismissPortfolioLossAlert(key, pnlPct);
      setLossAlerts((prev) => {
        const next = prev.filter((a) => a.key !== key);
        if (next.length === 0) {
          finishLossModalBatch([]);
        } else {
          setLossAlertIndex((idx) => Math.min(idx, next.length - 1));
          lossAlertKeysRef.current = lossAlertKeySig(next);
        }
        return next;
      });
    },
    [finishLossModalBatch],
  );

  const {
    modalOpen: refreshModalOpen,
    sundayResultOpen,
    sundayResult,
  } = useRefreshStatus();

  const onRefreshPipelineCompleted = useCallback(async () => {
    if (refreshCompleteInFlightRef.current) return;
    refreshCompleteInFlightRef.current = true;
    try {
      const finishToken = String(getRefreshSnapshot().finishedAt?.getTime() ?? Date.now());
      if (refreshCompletionTokenRef.current === finishToken) return;
      refreshCompletionTokenRef.current = finishToken;

      const profile = getRefreshSnapshot().profile;
      const isLongRefresh = getRefreshDurationClass() === "long";
      let sim: SheetTable | null;
      if (profile === "daily") {
        sim = await reloadSimulation();
        void fetchDesktopManifest().then((m) => {
          if (m?.updated_at) applyDesktopManifest(m);
        });
        void Promise.all([
          reloadData(),
          reloadClinical(),
          reloadSecK8(),
          reloadAccuracy(),
          reloadFinancial(),
        ]).catch(() => {});
      } else {
        sim = await reloadAllSheets();
      }
      markReloadCompleted();
      clearPortfolioReviewPending();

      if (!isLongRefresh) {
        checkSignals();
        return;
      }

      const { alerts, summaryTotals } = await buildPostRefreshPortfolioAlerts(sim);
      const openingAlerts = filterOpeningPortfolioAlerts(alerts);
      setPortfolioSummaryTotals(summaryTotals);
      setPortfolioAlerts(openingAlerts);

      if (hasOpeningPortfolioAlertsToShow(openingAlerts)) {
        setPortfolioAlertsCopy({
          titleKey: "portfolioRefresh.modal.title",
          subtitleKey: "portfolioRefresh.modal.subtitle",
        });
        setPortfolioAlertsHeaderSummary(null);
        const sundayOpen = getRefreshSnapshot().sundayResultOpen;
        if (sundayOpen) {
          pendingPortfolioAlertsAfterSundayRef.current = true;
        } else {
          setPortfolioAlertsOpen(true);
        }
      }
      checkSignals();
    } finally {
      refreshCompleteInFlightRef.current = false;
    }
  }, [
    reloadAllSheets,
    reloadSimulation,
    reloadData,
    reloadClinical,
    reloadSecK8,
    reloadAccuracy,
    reloadFinancial,
    checkSignals,
  ]);

  /** Se snapshot/manifest in data/ cambiano (refresh server o altra tab), ricarica fogli. */
  const desktopManifestSigRef = useRef("");
  useEffect(() => {
    if (apiOk !== true) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const m = await fetchDesktopManifest();
        if (cancelled || !m) return;
        const sig = `${m.workbook_mtime ?? ""}|${m.updated_at ?? ""}`;
        if (
          desktopManifestSigRef.current &&
          desktopManifestSigRef.current !== sig &&
          !isRefreshInFlight()
        ) {
          const sim = await reloadAllSheets();
          markReloadCompleted();
          checkSignals();
          if (sim) await runMorningDiscoveryCheck(sim);
          await runClinicalFeedRefreshCheck();
        }
        desktopManifestSigRef.current = sig;
        applyDesktopManifest(m);
      } catch {
        /* manifest opzionale */
      }
    };
    void poll();
    const intervalMs = isDesktopShell() ? 20_000 : 60_000;
    const id = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    apiOk,
    reloadAllSheets,
    checkSignals,
    runMorningDiscoveryCheck,
    runClinicalFeedRefreshCheck,
    applyDesktopManifest,
  ]);

  useEffect(() => {
    if (simLoading || !simTable?.rows?.length) return;
    if (lossModalOpen) return;
    const pendingRaw = pendingPortfolioLossAlerts(simTable, investSimInputs);
    const pending = filterUrgentPortfolioLossAlerts(pendingRaw, simTable, investSimInputs);
    const keySig = lossAlertKeySig(pending);
    const token = lossModalRefreshTokenRef.current || "app-start";
    const lossUnacked =
      pending.length > 0 &&
      lossModalAckKeySigRef.current !== keySig &&
      !isLossModalBatchAcked(token, keySig);
    if (lossUnacked) return;
    ensureSimulationBaseline(simTable);
  }, [simTable, simLoading, lossModalOpen, investSimInputs]);

  useEffect(() => {
    const onRemote = () => {
      void reloadAllSheets().then(() => markReloadCompleted());
    };
    window.addEventListener(REMOTE_HOST_CHANGED_EVENT, onRemote);
    return () => window.removeEventListener(REMOTE_HOST_CHANGED_EVENT, onRemote);
  }, [reloadAllSheets]);

  useDecisionSimMarketScheduler({
    apiOk,
    simTable,
    simChartsBundle,
    inputs: investSimInputs,
    sdsRows: sdsRowsForMig,
    onReloadSimulation: reloadSimulation,
  });

  /** After Sunday full popup closes, show pending portfolio alerts if any. */
  useEffect(() => {
    if (sundayResultOpen) return;
    if (!pendingPortfolioAlertsAfterSundayRef.current) return;
    if (!hasOpeningPortfolioAlertsToShow(portfolioAlerts)) {
      pendingPortfolioAlertsAfterSundayRef.current = false;
      return;
    }
    pendingPortfolioAlertsAfterSundayRef.current = false;
    setPortfolioAlertsOpen(true);
  }, [sundayResultOpen, portfolioAlerts]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileNavOpen]);

  /** Sabato mattina, primo avvio desktop: orchestrator domenica full automatico. */
  useEffect(() => {
    if (apiOk !== true) return;
    if (!isDesktopShell()) return;
    if (!shouldAutoStartSundayFull()) return;
    requestSundayFullAutostart();
  }, [apiOk]);


  return (
    <div className="app-shell flex h-screen overflow-hidden bg-[rgb(var(--bg-deep))]">
      {mobileNavOpen ? (
        <button
          type="button"
          className="app-sidebar-backdrop lg:hidden"
          aria-label={lang === "it" ? "Chiudi menu" : "Close menu"}
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <AppSidebar
        screen={screen}
        onScreen={navigateTo}
        apiOk={apiOk}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className="app-main flex flex-col flex-1 overflow-hidden min-w-0 bg-[rgb(var(--bg-deep))]">
        <AppTopBar
          screen={screen}
          desktopManifest={desktopManifest}
          apiOk={apiOk}
          status={status}
          canGoBack={canGoBack}
          previousScreen={previousScreen}
          onGoBack={goBack}
          onMenuOpen={() => setMobileNavOpen(true)}
          notificationBell={
            <NotificationBell
              alerts={alerts}
              unreadCount={unreadCount}
              onMarkAllRead={markAllRead}
              onClearAll={clearAllAlerts}
              onDismiss={dismissAlert}
            />
          }
        />
        {(screen === "catalyst" || screen === "catalystFeed") &&
        (dataError ||
          (!dataLoading && allRows.length === 0 && !dataError)) && (
          <div className="shrink-0 px-5 py-2 text-sm border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))]/80">
            {dataError && (
              <p className="text-negative">
                {dataError}
                {isDesktopShell() && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline text-accent"
                      onClick={() => void window.supernova?.shell?.openDataDir()}
                    >
                      Open data folder
                    </button>
                  </>
                )}
              </p>
            )}
            {!dataLoading && allRows.length === 0 && !dataError && (
              <p className="text-ink-muted">
                No catalyst loaded — check{" "}
                <code className="text-accent">{desktopDataDirHint()}</code>
              </p>
            )}
          </div>
        )}
        <div
          className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0 ${
            isDecisionLabShell ? "p-0" : screen === "simulation" ? "p-0" : "p-4"
          }`}
        >
        {screen === "main" && (
          <Suspense fallback={<ScreenFallback />}>
            <MainDashboardView
              simTable={simTable}
              simLoading={simLoading}
              secK8Table={secK8Table}
              secK8Loading={secK8Loading}
              onScreen={navigateTo}
              onOpenSecK8={openSecK8}
              onReload={() => void reloadAllSheets()}
              onNavigateToSimulationPnl={handleNavigateToSimulationPnl}
              onOpenSimulationRow={handleOpenSimulationRow}
              onOpenSimulationSheet={handleOpenSimulationSheetRow}
              onOpen24hAssessment={(focus) =>
                handleNavigateToSimulationLossAnalysis(focus.ticker, focus.cd)
              }
              onRegisterBuy={registerPortfolioBuy}
              onSellPosition={handleDashboardSell}
              onOpenPredictionCharts={openPredictionCharts}
              onOpenCatalystFeed={() => navigateTo("catalystFeed")}
              onOpenClinicalFeed={(ticker) => {
                setClinicalFeedFocusTicker(ticker.trim().toUpperCase() || null);
                navigateTo("catalystFeed");
              }}
              onOpenSupernovaTab={handleOpenSupernovaTab}
            />
          </Suspense>
        )}

        {screen === "catalyst" && (
          <ViewErrorBoundary label="Curves">
            <Suspense fallback={<ScreenFallback />}>
              <CatalystHubView
                simTable={simTable}
                simLoading={simLoading}
                simError={simError}
                onReloadSimulation={() => void reloadSimulation()}
                secK8Table={secK8Table}
                onOpenSecK8={openSecK8}
                chartsFocusSeriesKey={catalystChartsFocus?.seriesKey ?? null}
                chartsFocusTicker={catalystChartsFocus?.ticker ?? null}
                onChartsFocusConsumed={() => setCatalystChartsFocus(null)}
                chartsSubPanelFocus={catalystChartsSubFocus}
                slopeChartsFocusTicker={slopeChartsFocusTicker}
                onChartsSubPanelFocusConsumed={() => setCatalystChartsSubFocus(null)}
                onSlopeChartsFocusTickerConsumed={() => setSlopeChartsFocusTicker(null)}
                onOpenPredictionCharts={openPredictionCharts}
                sdsRows={sdsRowsForMig}
              />
            </Suspense>
          </ViewErrorBoundary>
        )}

        {screen === "clinical" && (
          <Suspense fallback={<ScreenFallback />}>
            <ClinicalSimulationView
              simTable={simTable}
              clinicalTable={clinicalTable}
              loading={clinicalLoading}
              error={clinicalError}
              onReload={() => void reloadClinical()}
            />
          </Suspense>
        )}

        {screen === "secK8" && (
          <Suspense fallback={<ScreenFallback />}>
            <SecK8SimulationView
              simTable={simTable}
              secK8Table={secK8Table}
              loading={secK8Loading}
              error={secK8Error}
              onReload={() => void reloadSecK8()}
              initialTicker={secK8FocusTicker}
              onInitialTickerConsumed={() => setSecK8FocusTicker(null)}
            />
          </Suspense>
        )}

        {screen === "catalystFeed" && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <Suspense fallback={<ScreenFallback />}>
              <CatalystFeedView
                simTable={simTable}
                reloadSnapshotToken={clinicalFeedReloadToken}
                onReloadSnapshot={() => setClinicalFeedReloadToken((n) => n + 1)}
                initialTickerFilter={clinicalFeedFocusTicker}
                onInitialTickerFilterConsumed={() => setClinicalFeedFocusTicker(null)}
              />
            </Suspense>
          </div>
        )}

        {screen === "simulation" && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <ViewErrorBoundary label="Returns & Loss">
              <InvestmentSimulationView
                simTable={simTable}
                simLoading={simLoading}
                simError={simError}
                onReloadSimulation={reloadSimulation}
                onOpenPredictionCharts={({ seriesKey, ticker }) =>
                  openPredictionCharts({ seriesKey, ticker })
                }
                onOpenDecisionLabBlock={(focus) => {
                  setDecisionLabMonitorFocus({
                    ticker: focus.ticker.trim().toUpperCase(),
                    cd: focus.cd?.trim() || undefined,
                  });
                  navigateTo("decisionLab");
                }}
                onOpenDecisionLabScreen={() => navigateTo("decisionLab")}
                onOpenSupernovaScreen={handleOpenSupernovaTab}
                onOpenPatternScreen={handleOpenPatternScreen}
                onOpenSlopeCharts={openSlopeErrorCharts}
                focusTicker={simulationFocus}
                onFocusConsumed={() => setSimulationFocus(null)}
              />
            </ViewErrorBoundary>
          </div>
        )}

        {screen === "decisionLab" && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <Suspense fallback={<ScreenFallback />}>
              <InvestmentDecisionLabView
                simTable={simTable}
                simLoading={simLoading}
                simError={simError}
                onReloadSimulation={reloadSimulation}
                onNavigateToSimulation={handleNavigateToSimulation}
                onOpenCatalystFeed={() => navigateTo("catalystFeed")}
                onOpenClinicalFeed={(ticker) => {
                  setClinicalFeedFocusTicker(ticker.trim().toUpperCase() || null);
                  navigateTo("catalystFeed");
                }}
                onOpenSlopeErrorCharts={openSlopeErrorCharts}
                onOpenPredictionCharts={openPredictionCharts}
                focusSignal={decisionLabFocus}
                onFocusSignalConsumed={() => setDecisionLabFocus(null)}
                monitorFocus={decisionLabMonitorFocus}
                onMonitorFocusConsumed={() => setDecisionLabMonitorFocus(null)}
                initialTab={
                  decisionLabInitialTab === "portfolio" ? null : decisionLabInitialTab
                }
                onInitialTabConsumed={() => {
                  if (decisionLabInitialTab === "portfolio") {
                    setModelsInitialTab("portfolio");
                    navigateTo("models");
                  }
                  setDecisionLabInitialTab(null);
                }}
                sdsFocusTicker={decisionLabSdsFocusTicker}
                onSdsFocusConsumed={() => setDecisionLabSdsFocusTicker(null)}
              />
            </Suspense>
          </div>
        )}

        {screen === "models" && (
          <ViewErrorBoundary label="Model analysis">
            <Suspense fallback={<ScreenFallback />}>
              <ModelAccuracyLabView
                accTable={accTable}
                simTable={simTable}
                loading={accLoading}
                simLoading={simLoading}
                error={accError}
                onReload={() => void reloadAccuracy()}
                onReloadSimulation={() => void reloadSimulation()}
                onOpenPredictionCharts={openPredictionCharts}
                onOpenSimulationPnl={handleNavigateToSimulationPnl}
                onOpenDailyPnlLedger={handleNavigateToDailyPnlLedger}
                initialTab={modelsInitialTab ?? undefined}
                onInitialTabConsumed={() => setModelsInitialTab(null)}
                accuracyDataStale={
                  Boolean(
                    accManifestSigLive &&
                      accManifestSigAtLoad &&
                      accManifestSigLive !== accManifestSigAtLoad
                  )
                }
                manifestUpdatedAt={desktopManifest}
              />
            </Suspense>
          </ViewErrorBoundary>
        )}

        {screen === "financial" && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <Suspense fallback={<ScreenFallback />}>
              <FinancialSheetView
                table={finTable}
                loading={finLoading}
                error={finError}
                onReload={() => void reloadFinancial()}
                simTable={simTable}
              />
            </Suspense>
          </div>
        )}

        {screen === "testerMonitor" && (
          <Suspense fallback={<ScreenFallback />}>
            <ViewErrorBoundary label="Tester monitor">
              <TesterMonitorView apiOk={apiOk} simTable={simTable} chartsBundle={simChartsBundle} />
            </ViewErrorBoundary>
          </Suspense>
        )}

        {screen === "system" && (
          <Suspense fallback={<ScreenFallback />}>
            <SystemView
              apiOk={apiOk}
              busy={busy}
              onBusyChange={setBusy}
              onRefreshComplete={onRefreshPipelineCompleted}
              onBeforeRefreshStart={capturePortfolioBeforeRefreshCb}
              status={status}
              log={log}
              onRefreshStatus={() => void refreshApi()}
              theme={theme}
              onTheme={handleThemeChange}
              simTable={simTable}
              coherenceFocus={systemCoherenceFocus}
              onCoherenceFocusConsumed={() => setSystemCoherenceFocus(false)}
            />
          </Suspense>
        )}
        </div>
      </div>
      <RefreshDataModal
        open={refreshModalOpen}
        onClose={() => setRefreshModalOpen(false)}
        onCompleted={onRefreshPipelineCompleted}
        onBeforeRefreshStart={capturePortfolioBeforeRefreshCb}
      />
      <PortfolioRefreshAlertsModal
        open={portfolioAlertsOpen}
        alerts={portfolioAlerts}
        summaryTotals={portfolioSummaryTotals}
        titleKey={portfolioAlertsCopy.titleKey}
        subtitleKey={portfolioAlertsCopy.subtitleKey}
        headerSummary={portfolioAlertsHeaderSummary}
        onOpenClinicalFeed={(ticker) => {
          setClinicalFeedFocusTicker(ticker.trim().toUpperCase() || null);
          navigateTo("catalystFeed");
        }}
        onClose={handlePortfolioAlertsClose}
      />
      <PortfolioLossUrgentModal
        open={lossModalOpen}
        alerts={lossAlerts}
        activeIndex={lossAlertIndex}
        onActiveIndexChange={setLossAlertIndex}
        simTable={simTable}
        inputs={investSimInputs}
        chartsBundle={simChartsBundle}
        sdsRows={sdsRowsForMig}
        onClose={handleCloseLossModal}
        onDismissTicker={handleDismissLossTicker}
        onOpenSlopeCharts={openSlopeErrorCharts}
        onOpenPredictionCharts={(ticker, seriesKey) =>
          openPredictionCharts({ ticker, seriesKey })
        }
        onNavigateSimulation={(ticker, cd) =>
          handleOpenSimulationRow({ ticker, cd })
        }
        onOpenLossAnalysis={(ticker, cd) =>
          handleNavigateToSimulationLossAnalysis(ticker, cd)
        }
        onSellPosition={sellPortfolioPosition}
      />
      <SimLoopTradeAlertModal
        batch={simLoopTradeAlertBatch}
        onClose={() => setSimLoopTradeAlertQueue((q) => q.slice(1))}
        onOpen24h={({ ticker, cd, rowKey }) => {
          setSimLoopTradeAlertQueue((q) => q.slice(1));
          handleNavigateToSimulationLossAnalysis(ticker, cd, rowKey);
        }}
      />
      {gapInvestigationModal ? (
        <GapInvestigationModal
          recordId={gapInvestigationModal.recordId}
          event={gapInvestigationModal.event}
          finding={gapInvestigationModal.finding}
          onClose={handleGapInvestigationClose}
          onCommit={handleGapInvestigationCommit}
        />
      ) : null}
      <SundayRefreshResultModal
        open={sundayResultOpen}
        result={sundayResult}
        onClose={() => closeSundayRefreshResult()}
      />
      <CoherenceAlertModal
        open={coherenceAlertOpen}
        issues={coherenceCriticalIssues}
        onClose={handleCoherenceAlertClose}
        onOpenDashboard={() => navigateTo("main")}
        onOpenSimulation={() => navigateTo("simulation")}
        onOpenSystem={() => {
          navigateTo("system");
          setSystemCoherenceFocus(true);
        }}
      />
      <RecommendationAlertModal
        open={recAlertQueue.open}
        alerts={recAlertQueue.alerts}
        activeIndex={recAlertQueue.activeIndex}
        onActiveIndexChange={recAlertQueue.setActiveIndex}
        monitorRow={recAlertQueue.monitorRow}
        simTable={simTable}
        inputs={investSimInputs}
        chartsBundle={simChartsBundle}
        sdsRows={sdsRowsForMig}
        onClose={recAlertQueue.close}
        onOpenSimulationRow={(ticker, cd, opts) =>
          handleOpenSimulationRow({
            ticker,
            cd,
            rowKey: recAlertQueue.alerts[recAlertQueue.activeIndex]?.key,
            syncToSynth: opts?.syncToSynth,
          })
        }
        onTrimToSynth={handleSynthTrimFromAlert}
      />
      <SynthSyncSummaryModal
        open={synthSyncSummaryOpen}
        summary={synthSyncSummary}
        onClose={() => setSynthSyncSummaryOpen(false)}
      />
    </div>
  );
}
