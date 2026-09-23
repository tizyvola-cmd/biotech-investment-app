import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { loadMarketContextDoc } from "./sheet/marketContextGate";
import {
  fetchClinicalSimulationSheet,
  fetchSecK8SimulationSheet,
  fetchFinancialSheet,
  fetchHealth,
  fetchOrchestratorLog,
  fetchSimulationSheet,
  fetchStatus,
  hasStoredApiToken,
} from "./api/supernova";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopBar } from "./components/AppTopBar";
import { AccessDeskView as TesterMonitorView } from "./components/AccessDeskView";
import { PageZoomControls } from "./components/PageZoomControls";
import { PlatformRail, type PlatformId } from "./components/PlatformRail";
import { HighTechComingSoonView } from "./components/HighTechComingSoonView";
import { useSignalAlerts } from "./hooks/useSignalAlerts";
import { useAccessAdminAlertCount } from "./hooks/useAccessAdminAlertCount";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import { CatalystDaysPage } from "./components/CatalystDaysPage";
import { GuidanceCalendarPanel } from "./components/GuidanceCalendarPanel";
import { UniverseDiscoveryFeedPanel } from "./components/UniverseDiscoveryFeedPanel";
import { PremiumLockedPreview } from "./components/PremiumUnlockMessage";
import type { CatalystChartsSubPanel } from "./components/CatalystHubView";
import { RefreshDataModal } from "./components/RefreshDataModal";
import { PortfolioRefreshAlertsModal } from "./components/PortfolioRefreshAlertsModal";
import { PortfolioLossUrgentModal } from "./components/PortfolioLossUrgentModal";
import { UrgentSellG2AutoSoldModal } from "./components/UrgentSellG2AutoSoldModal";
import { useUrgentSellG2AutoExecute } from "./hooks/useUrgentSellG2AutoExecute";
import {
  pullCompanionInvestSimOpensIntoDesktop,
  pushMobileAutoSoldEvent,
} from "./api/mobileDashboardSnapshot";
import { DesktopTesterGate } from "./components/DesktopTesterGate";
import { SupernovaLandingPage } from "./components/SupernovaLandingPage";
import { useDesktopTesterSession } from "./hooks/useDesktopTesterSession";
import { allowsDesktopAccountSwitch, isAllowedOwnerEmail } from "./sheet/testerSession";
import { reportUiError } from "./sheet/reportUiError";
import { adoptRemoteTesterInvestBook } from "./sheet/investSimStorage";
import { GapInvestigationModal } from "./components/GapInvestigationModal";
import { RecommendationAlertModal } from "./components/RecommendationAlertModal";
import { SynthSyncSummaryModal } from "./components/SynthSyncSummaryModal";
import { useInvestSimInputsMutable, usePortfolioSell } from "./hooks/useInvestSimInputs";
import { useRecommendationAlertQueue } from "./hooks/useRecommendationAlertQueue";
import { useLossRiskCatalog } from "./hooks/useLossRiskCatalog";
import { useWeeklyFullServerWatch } from "./hooks/useWeeklyFullServerWatch";
import { useRefreshStaleReconcile } from "./hooks/useRefreshStaleReconcile";
import { buildSimRowByKeyMap, normalizedRowKey } from "./sheet/investSimKeys";
import { loadUiPrefsLocal } from "./sheet/uiPrefs";
import { runManualSynthSyncForRow, SYNTH_SYNC_COMPLETED_EVENT, type SynthSyncSummary } from "./sheet/synthCapitalSyncLog";
import {
  computeSimulationPosition,
  positionCapitalPnlPct,
  rowHasActivePortfolio,
} from "./sheet/simulationPosition";
import type { SimulationNavFocus } from "./sheet/investSimStorage";
import type { ChartBundle } from "./types";
import { loadSimulationChartsBundle } from "./data/simulationCharts";
import { hydrateMedtechSymbolsFromSnapshot } from "./sheet/medtechSymbols";
import {
  ackLossModalBatch,
  dismissPortfolioLossAlert,
  dismissPortfolioLossAlerts,
  isLossModalBatchAcked,
  lossAlertKeySig,
  markLossModalAutoShownThisSession,
  pendingPortfolioLossAlerts,
  type PortfolioLossAlert,
} from "./sheet/portfolioLossUrgent";
import { filterUrgentPortfolioLossAlerts, prioritizeLossAlertsBySlopeExit } from "./sheet/portfolioLossAnalysis";
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
  markSaturdayAutostartDone,
  shouldAutoStartSundayFull,
} from "./shared/sundayRefreshSchedule";
import { fetchWeeklyFullStatus } from "./api/refresh";
import {
  acknowledgeWeeklyFullServerStatus,
  dismissWeeklyFullCompletion,
  weeklyFullCompletedToday,
} from "./shared/weeklyFullServerWatch";
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
  acknowledgeEisStaleWarning,
  checkClinicalFeedRefreshPopup,
  checkClinicalFeedStaleWarning,
  CLINICAL_FEED_REFRESH_COPY,
  type ClinicalFeedRefreshReport,
  type EisStaleWarning,
} from "./sheet/clinicalFeedRefresh";
import { PipelineStaleWarningModal } from "./components/PipelineStaleWarningModal";
import { loadPredictions } from "./data/predictions";
import { loadLocalSheet } from "./data/localSheets";
import { probeApiReachable, fetchNewBioIpoStatus } from "./api/supernova";
import {
  desktopDataDirHint,
  fetchDesktopManifest,
  isDesktopShell,
} from "./data/projectData";
import type { TranslationKey } from "./shared/i18n";
import { useLang, useT } from "./shared/i18n";
import { REMOTE_HOST_CHANGED_EVENT } from "./shared/remoteHost";
import { isDeskBootBusy } from "./sheet/deskBootGate";
import {
  applyThemeToDocument,
  loadResolvedTheme,
  saveStoredTheme,
  type ResolvedTheme,
} from "./sheet/themePrefs";
import type { ApiStatus, AppScreen, CatalystRow, SheetTable } from "./types";
import { useScreenNavigation } from "./shared/useScreenNavigation";
import { parseScreenDeepLink } from "./shared/screenDeepLink";
import { resolveLiveScreen } from "./shared/retiredScreens";
import { setEvalLabProfile } from "./sheet/evalLabProfileStore";
import type { LossAnalysisProfile } from "./sheet/portfolioLossAnalysis";
import { SCREEN_LABEL_KEYS } from "./components/AppSidebar";
import { EIS_DEEP_DIVE_OPEN_EVENT, getEisDeepDiveFocus } from "./sheet/eisDeepDiveFocusStore";
import { CALENDAR_FOCUS_EVENT } from "./sheet/calendarFocusStore";

const CatalystHubView = lazy(() =>
  import("./components/CatalystHubView").then((m) => ({ default: m.CatalystHubView })),
);
const ClinicalSimulationView = lazy(() =>
  import("./components/ClinicalSimulationView").then((m) => ({ default: m.ClinicalSimulationView })),
);
const SecK8SimulationView = lazy(() =>
  import("./components/SecK8SimulationView").then((m) => ({ default: m.SecK8SimulationView })),
);
const InvestmentSimulationView = lazy(() =>
  import("./components/InvestmentSimulationView").then((m) => ({
    default: m.InvestmentSimulationView,
  })),
);
const FinancialSheetView = lazy(() =>
  import("./components/FinancialSheetView").then((m) => ({ default: m.FinancialSheetView })),
);
const SystemView = lazy(() =>
  import("./components/SystemView").then((m) => ({ default: m.SystemView })),
);

function ScreenFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-ink-muted text-sm p-8 min-h-[120px]">
      Loading…
    </div>
  );
}

export default function App() {
  const deepLink = parseScreenDeepLink();
  const isPopoutWindow = deepLink.popout;
  const initialScreen = resolveLiveScreen(deepLink.screen ?? "catalystDesk");
  const { screen, navigateTo: pushScreen, goBack, canGoBack, previousScreen } =
    useScreenNavigation(initialScreen);
  const navAfterPaintRef = useRef<number | null>(null);
  const pendingNavDestRef = useRef<AppScreen | null>(null);
  const navigateTo = useCallback((next: AppScreen, opts?: { immediate?: boolean }) => {
    // Removed sidebar tabs — keep deep-links from landing on a blank screen.
    const dest = resolveLiveScreen(next);
    const apply = () => {
      pendingNavDestRef.current = null;
      if (dest === "simulation") {
        // Hidden Deep Dive route — company sheet only (Top KPI table removed).
        setSimulationFocus((prev) => {
          const hasTarget = Boolean(
            prev?.ticker?.trim() ||
              prev?.rowKey?.trim() ||
              prev?.openEis ||
              prev?.action,
          );
          if (!hasTarget) return prev;
          return {
            ...prev,
            view: prev?.view ?? "lossAnalysis",
            preferTopKpi: false,
            openDeepDive: true,
          };
        });
      }
      pushScreen(dest);
    };

    // Same destination already queued (e.g. leftover click after mousedown) — keep first schedule.
    if (
      !opts?.immediate &&
      pendingNavDestRef.current === dest &&
      navAfterPaintRef.current != null
    ) {
      return;
    }

    if (navAfterPaintRef.current != null) {
      cancelAnimationFrame(navAfterPaintRef.current);
      navAfterPaintRef.current = null;
    }

    // Deep-links / programmatic jumps still commit in this turn.
    if (opts?.immediate) {
      pendingNavDestRef.current = null;
      flushSync(apply);
      return;
    }

    pendingNavDestRef.current = dest;

    // Top nav first, heavy desk second: AppSidebar paints pending tab via flushSync;
    // one rAF lets that highlight commit before we unmount Catalyst/Simulation.
    navAfterPaintRef.current = requestAnimationFrame(() => {
      navAfterPaintRef.current = null;
      flushSync(apply);
    });
  }, [pushScreen]);

  useEffect(() => {
    return () => {
      if (navAfterPaintRef.current != null) {
        cancelAnimationFrame(navAfterPaintRef.current);
      }
    };
  }, []);
  const { lang } = useLang();
  const t = useT();
  const desktopTester = useDesktopTesterSession();
  const testerBookAdoptedRef = useRef<string | null>(null);
  const showAccessAdmin = isAllowedOwnerEmail(desktopTester.tester?.email ?? "");
  const showSystemAdmin = showAccessAdmin;
  const accessAlertCount = useAccessAdminAlertCount(
    showAccessAdmin,
    screen === "testerMonitor",
  );

  useEffect(() => {
    const onWindowError = (ev: ErrorEvent) => {
      const msg = ev.message || String(ev.error || "window error");
      // Stale hashed chunk after deploy → hard reload once (testers otherwise sit on broken UI / false offline).
      if (
        typeof window !== "undefined" &&
        /Loading chunk|dynamically imported module|Importing a module script failed/i.test(msg)
      ) {
        const key = "sn_stale_chunk_reload";
        try {
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            const u = new URL(window.location.href);
            u.searchParams.set("_sn", String(Date.now()));
            window.location.replace(u.toString());
            return;
          }
        } catch {
          /* ignore */
        }
      }
      reportUiError({
        label: "window",
        message: msg,
        stack: ev.error instanceof Error ? ev.error.stack : null,
        source: "window",
      });
    };
    const onUnhandled = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "unhandledrejection";
      if (
        typeof window !== "undefined" &&
        /Loading chunk|dynamically imported module|Importing a module script failed/i.test(message)
      ) {
        const key = "sn_stale_chunk_reload";
        try {
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, "1");
            const u = new URL(window.location.href);
            u.searchParams.set("_sn", String(Date.now()));
            window.location.replace(u.toString());
            return;
          }
        } catch {
          /* ignore */
        }
      }
      reportUiError({
        label: "promise",
        message,
        stack: reason instanceof Error ? reason.stack : null,
        source: "promise",
      });
    };
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  useEffect(() => {
    if (screen !== "testerMonitor" && screen !== "system") return;
    if (screen === "testerMonitor" && showAccessAdmin) return;
    if (screen === "system" && showSystemAdmin) return;
    navigateTo("catalystDesk", { immediate: true });
  }, [screen, showAccessAdmin, showSystemAdmin, navigateTo]);

  useEffect(() => {
    const onOpenEis = () => {
      const focus = getEisDeepDiveFocus();
      const tk = focus?.ticker?.trim().toUpperCase();
      setSimulationFocus({
        ...(tk ? { ticker: tk } : {}),
        view: "lossAnalysis",
        preferTopKpi: false,
        openDeepDive: true,
        openEis: true,
        focusNonce: Date.now(),
      });
      navigateTo("simulation", { immediate: true });
    };
    window.addEventListener(EIS_DEEP_DIVE_OPEN_EVENT, onOpenEis);
    return () => window.removeEventListener(EIS_DEEP_DIVE_OPEN_EVENT, onOpenEis);
  }, [navigateTo]);

  useEffect(() => {
    const onCal = () => navigateTo("calendar", { immediate: true });
    window.addEventListener(CALENDAR_FOCUS_EVENT, onCal);
    return () => window.removeEventListener(CALENDAR_FOCUS_EVENT, onCal);
  }, [navigateTo]);

  useEffect(() => {
    if (!isPopoutWindow || typeof document === "undefined") return;
    document.title = `SuperNova — ${t(SCREEN_LABEL_KEYS[screen])}`;
  }, [isPopoutWindow, screen, t]);
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
  const [platform, setPlatform] = useState<PlatformId>("pharma");

  const [simTable, setSimTable] = useState<SheetTable | null>(null);
  const simTableRef = useRef<SheetTable | null>(null);
  simTableRef.current = simTable;
  const reloadSimInFlightRef = useRef<Promise<SheetTable | null> | null>(null);
  const reloadSimDoneAtRef = useRef(0);
  const sheetsReloadInFlightRef = useRef(false);
  useEffect(() => {
    if (desktopTester.gate !== "ready" || !desktopTester.tester?.testerId) return;
    if (testerBookAdoptedRef.current === desktopTester.tester.testerId) return;
    testerBookAdoptedRef.current = desktopTester.tester.testerId;
    void adoptRemoteTesterInvestBook(simTable?.rows as Record<string, unknown>[] | undefined).catch(
      () => {
        /* hydrate best-effort */
      },
    );
  }, [desktopTester.gate, desktopTester.tester?.testerId, simTable?.rows]);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const [clinicalTable, setClinicalTable] = useState<SheetTable | null>(null);
  const [clinicalLoading, setClinicalLoading] = useState(false);
  const [clinicalError, setClinicalError] = useState<string | null>(null);

  const [secK8Table, setSecK8Table] = useState<SheetTable | null>(null);
  const [secK8Loading, setSecK8Loading] = useState(false);
  const [secK8Error, setSecK8Error] = useState<string | null>(null);

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
  const [simulationFocus, setSimulationFocus] = useState<SimulationNavFocus | null>(null);
  const handleEvalLabNav = useCallback(
    (profile: LossAnalysisProfile) => {
      setEvalLabProfile(profile);
      // Top KPI removed — Evaluation without a ticker lands on Catalyst Days.
      setSimulationFocus(null);
      navigateTo("catalystDesk", { immediate: true });
    },
    [navigateTo],
  );

  // Screen content follows `screen` after the top-nav paint (see navigateTo rAF).
  // Do not wrap in startTransition — Home live updates used to starve deferred switches.
  const renderedScreen = screen;

  // Do NOT keep Home + Evaluation Lab mounted together. Hidden keep-alive
  // meant every Buy/Sell rebuilt operationalRec + loss-risk catalog twice.
  // Classic Home (`main`) is retired — Catalyst desk is the landing screen.

  const scheduleIdleWarm = useCallback((warm: () => void, timeoutMs: number) => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) warm();
    };
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    if (typeof ric === "function") {
      const id = ric(run, { timeout: timeoutMs });
      return () => {
        cancelled = true;
        (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(run, Math.min(400, timeoutMs));
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  /** Heavy extras (sim-outcomes, charts-for-coherence, SDS API) after first paint. */
  const [homeHeavyReady, setHomeHeavyReady] = useState(false);
  useEffect(() => {
    setHomeHeavyReady(false);
    return scheduleIdleWarm(() => setHomeHeavyReady(true), 900);
  }, [screen, scheduleIdleWarm]);

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

  const handleNavigateToSimulationLossAnalysis = useCallback(
    (
      ticker?: string,
      cd?: string,
      rowKey?: string,
      opts?: { openDeepDive?: boolean },
    ) => {
      const tk = ticker?.trim().toUpperCase();
      const cdNorm = cd?.trim() || undefined;
      const key =
        rowKey?.trim() ||
        (tk && cdNorm ? normalizedRowKey(tk, cdNorm) : undefined);
      // Top KPI removed — any ticker landing opens the company Deep Dive sheet.
      const openDeepDive = opts?.openDeepDive !== false;
      setSimulationFocus({
        ...(tk
          ? {
              ticker: tk,
              cd: cdNorm,
              rowKey: key,
            }
          : {}),
        view: "lossAnalysis",
        preferTopKpi: false,
        openDeepDive,
        focusNonce: Date.now(),
      });
      navigateTo("simulation", { immediate: true });
    },
    [navigateTo],
  );

  /*
   * Stable prop identities for lazy screens (P1.c).
   *
   * The App component re-renders very frequently (health polling, refresh
   * events, alert queues). Every inline arrow function became a NEW prop
   * reference on each render, so any React.memo/useMemo optimization inside
   * the lazy views was defeated. We hoist the wrappers to ``useCallback``
   * so children can safely rely on reference equality.
   */
  const handleCatalystChartsFocusConsumed = useCallback(() => {
    setCatalystChartsFocus(null);
  }, []);
  const handleCatalystChartsSubPanelConsumed = useCallback(() => {
    setCatalystChartsSubFocus(null);
  }, []);
  const handleSlopeChartsFocusTickerConsumed = useCallback(() => {
    setSlopeChartsFocusTicker(null);
  }, []);
  const handleSecK8FocusConsumed = useCallback(() => {
    setSecK8FocusTicker(null);
  }, []);
  const handleSimulationFocusConsumed = useCallback(() => {
    setSimulationFocus(null);
  }, []);
  const handleTopBarGoBack = useCallback(() => {
    goBack();
  }, [goBack]);
  // Reload handlers are wired after reload* callbacks exist (see below).
  const handleOpen24hAssessment = useCallback(
    (focus: {
      ticker: string;
      cd?: string;
      rowKey?: string;
      openDeepDive?: boolean;
    }) => {
      handleNavigateToSimulationLossAnalysis(focus.ticker, focus.cd, focus.rowKey, {
        openDeepDive: focus.openDeepDive !== false,
      });
    },
    [handleNavigateToSimulationLossAnalysis],
  );
  const handleOpenPredictionChartsWithKey = useCallback(
    ({ seriesKey, ticker }: { seriesKey: string | null; ticker: string }) => {
      openPredictionCharts({ seriesKey, ticker });
    },
    [openPredictionCharts],
  );
  useEffect(() => {
    void loadMarketContextDoc();
    void import("./sheet/marketContextScore").then((m) => m.loadMarketContextSnapshot());
    void import("./sheet/manualFeedPersistence").then((m) => m.hydrateManualFeedStoreFromDisk());
    void hydrateMedtechSymbolsFromSnapshot();
    // Resilience Score snapshot — must be hydrated at boot so downstream
    // synchronous lookups (`lookupResilienceForTicker`) inside allocators,
    // rescue score compute, and chart enrichment can return real numbers
    // rather than falling back to `unmeasured`. Fetches ~<20ms JSON from
    // disk-snapshot; failure is silent (score simply stays unmeasured).
    void import("./sheet/resilienceScoreData").then((m) => m.hydrateResilienceSnapshot());
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
    (
      m: {
        updated_at?: string | null;
        workbook_mtime?: string | null;
        prices_as_of?: string | null;
        live_signals_updated_at?: string | null;
      } | null,
    ) => {
      if (!m) return;
      // Top-bar "data updated" can track manifest bump; price-as-of is separate.
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

  /** Catalyst predictions (~32MB JSON) — solo quando serve Catalyst Hub, non al boot dashboard. */
  useEffect(() => {
    if (screen !== "catalyst") return;
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
      // Perf (Jul 2026): fetch /api/status here but NOT the orchestrator log.
      // The log is only consumed by SystemView (opened via the sidebar
      // "System" tab). Fetching 4 000 lines at boot cost a 1.3 s HTTP slot
      // that competed with sim-outcomes / learning-lab-overview under the
      // Chromium 6-connection cap. See PERF_HANDOFF_CLAUDE.md.
      setStatus(await fetchStatus());
    } catch {
      /* Health OK — keep online badge; status is best-effort. */
    }
  }, []);

  // Fetch the orchestrator log only when the System tab is actually opened.
  useEffect(() => {
    if (screen !== "system" || apiOk !== true) return;
    let cancelled = false;
    void fetchOrchestratorLog(4000)
      .then((l) => {
        if (!cancelled) setLog(l.log);
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [screen, apiOk]);

  // Keep a ref so the stable interval callback can read current apiOk without
  // being a dep (otherwise every health response destroys+recreates the timer).
  const apiOkRef = useRef(apiOk);
  apiOkRef.current = apiOk;

  // Lightweight health-only poller. ``refreshApi`` does several heavy calls
  // (status + log tails) that we only want at boot and after recovery; for
  // continuous monitoring we just ping ``/api/health`` and flip ``apiOk``.
  // Why: when the desktop app starts BEFORE the Python subprocess finishes
  // its imports, the very first ``refreshApi`` fails and the UI shows "API
  // offline" forever (there was no retry). With this poller, as soon as the
  // backend becomes reachable the badge clears itself and the full status
  // bundle is refreshed once via ``refreshApi``.
  //
  // Hysteresis: a single failed probe must NOT flip the badge to offline.
  // Under Chromium's 6-connection HTTP/1.1 cap, /api/health often queues
  // behind slow endpoints and times out even though the server is fine —
  // that was the main source of the flickering "API offline" badge.
  useEffect(() => {
    let cancelled = false;
    let consecutiveFails = 0;
    /**
     * While online: need several fails so a queued /api/health behind a desk storm
     * does not flash «API offline» (testers must not see that signal anyway).
     * Boot/offline: 2 fails to ignore a blip.
     */
    const failsBeforeOffline = (wasOnline: boolean) => (wasOnline ? 5 : 2);
    const tick = async () => {
      // Skip fail accounting while Catalyst desk is booting (queued health ≠ offline).
      if (isDeskBootBusy()) return;
      try {
        await fetchHealth();
        if (cancelled) return;
        consecutiveFails = 0;
        if (!apiOkRef.current) {
          // Just came back online: rerun the heavy bundle once.
          void refreshApi();
        } else {
          setApiOk(true);
          setRefreshStoreApiOk(true);
        }
      } catch {
        if (cancelled) return;
        if (isDeskBootBusy()) return;
        consecutiveFails += 1;
        if (consecutiveFails >= failsBeforeOffline(apiOkRef.current === true)) {
          setApiOk(false);
          setRefreshStoreApiOk(false);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => { void tick(); }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshApi]); // apiOk removed — read via ref; interval now stable

  const reloadSimulation = useCallback(async (): Promise<SheetTable | null> => {
    if (reloadSimInFlightRef.current) return reloadSimInFlightRef.current;
    // Coalesce stampedes (manifest poll + hype-done + interest hydrate + desk refresh).
    if (
      Date.now() - reloadSimDoneAtRef.current < 6_000 &&
      (simTableRef.current?.rows?.length ?? 0) > 0
    ) {
      return simTableRef.current;
    }
    const run = (async (): Promise<SheetTable | null> => {
      const { invalidateProjectJsonCache } = await import("./data/projectData");
      invalidateProjectJsonCache("simulation_sheet_snapshot.json");
      setSimError(null);
      let local: import("./types").SheetTable | null = null;
      try {
        try {
          local = await loadLocalSheet("simulation");
          if (local?.rows?.length) {
            setSimTable(local);
            setSimLoading(false);
          } else {
            setSimLoading(true);
          }
        } catch {
          setSimLoading(true);
        }
        const online = await probeApiReachable();
        // Sidecars (hype/catalyst/manual) are merged inside fetchSimulationSheet —
        // do not fan-out a second parallel trio on Catalyst entry.
        const sheet = online ? await fetchSimulationSheet() : local;
        const merged = sheet ?? local;
        if (merged) {
          setSimTable(merged);
          if (merged.error) setSimError(merged.error);
        }
        return merged;
      } catch (e) {
        setSimError(e instanceof Error ? e.message : String(e));
        return local;
      } finally {
        setSimLoading(false);
        reloadSimDoneAtRef.current = Date.now();
        reloadSimInFlightRef.current = null;
      }
    })();
    reloadSimInFlightRef.current = run;
    return run;
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
      (screen === "catalyst" ||
        screen === "clinical" ||
        screen === "secK8" ||
        screen === "simulation" ||
        screen === "catalystDesk") &&
      !simTable &&
      !simLoading
    ) {
      void reloadSimulation();
    }
  }, [screen, simTable, simLoading, reloadSimulation]);

  useEffect(() => {
    const onHypeDone = () => {
      void reloadSimulation();
    };
    window.addEventListener("supernova-hype-volume-funnel-done", onHypeDone);
    return () =>
      window.removeEventListener("supernova-hype-volume-funnel-done", onHypeDone);
  }, [reloadSimulation]);

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

  // Don't load SEC-K8 on Home — it contended with book hydrate / Yahoo / snapshot.
  useEffect(() => {
    if (screen === "secK8" && !secK8Table && !secK8Loading) {
      void reloadSecK8();
    }
  }, [screen, secK8Table, secK8Loading, reloadSecK8]);

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

  // ── Signal alerts (native / refresh hooks; UI bell removed) ─────────────
  const { checkSignals } = useSignalAlerts(simTable);

  const [portfolioAlertsOpen, setPortfolioAlertsOpen] = useState(false);
  const [portfolioAlerts, setPortfolioAlerts] = useState<PortfolioRefreshAlert[]>([]);
  const [portfolioAlertsCopy, setPortfolioAlertsCopy] = useState<{
    titleKey: TranslationKey;
    subtitleKey: TranslationKey;
  }>({
    titleKey: "portfolioRefresh.modal.title",
    subtitleKey: "portfolioRefresh.modal.subtitle",
  });
  const [serverWeeklyFullEnabled, setServerWeeklyFullEnabled] = useState(false);
  const morningDiscoveryContextRef = useRef<{ manifestSig: string; ipoFinishedAt: string }>({
    manifestSig: "",
    ipoFinishedAt: "",
  });
  const clinicalFeedReportRef = useRef<ClinicalFeedRefreshReport | null>(null);
  const [eisStaleWarning, setEisStaleWarning] = useState<EisStaleWarning | null>(null);
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

  const { inputs: investSimInputs, patchInputs: patchInvestSimInputs, commitInputs: commitInvestSimInputs } =
    useInvestSimInputsMutable(simTable);
  const sellPortfolioPosition = usePortfolioSell(simTable);

  // Soft BUY/SELL from mobile → VPS book: pull into Pulse even when Home is not mounted.
  // 45s + no-op when fingerprint unchanged (see syncInvestSimInputsBidirectional).
  const companionBookInputsRef = useRef(investSimInputs);
  companionBookInputsRef.current = investSimInputs;
  useEffect(() => {
    const tick = () => {
      if (!hasStoredApiToken()) return;
      if (document.visibilityState === "hidden") return;
      void pullCompanionInvestSimOpensIntoDesktop(companionBookInputsRef.current).catch(
        () => {
          /* best-effort */
        },
      );
    };
    const first = window.setTimeout(tick, 8_000);
    const id = window.setInterval(tick, 45_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const handleDashboardSell: import("./components/PortfolioExitButton").PortfolioSellHandler =
    useCallback(
      async (key, simRow, opts) => {
        const result = await sellPortfolioPosition(key, simRow, opts);
        if (result?.ok) commitInvestSimInputs(result.inputs);
        return result;
      },
      [sellPortfolioPosition, commitInvestSimInputs],
    );
  const { soldNotices: g2AutoSoldNotices, clearSoldNotices: clearG2AutoSoldNotices } =
    useUrgentSellG2AutoExecute({
      simTable,
      inputs: investSimInputs,
      simLoading,
      sell: handleDashboardSell,
    });
  const g2MobilePushSigRef = useRef("");
  useEffect(() => {
    if (!g2AutoSoldNotices.length) return;
    const sig = g2AutoSoldNotices
      .map((s) => s.key)
      .sort()
      .join("|");
    if (!sig || sig === g2MobilePushSigRef.current) return;
    g2MobilePushSigRef.current = sig;
    let openCountAfter = 0;
    for (const e of Object.values(investSimInputs)) {
      if (e && !e.ignoreSheet && (e.capital ?? 0) > 0 && (e.buyPrice ?? 0) > 0) {
        openCountAfter += 1;
      }
    }
    void pushMobileAutoSoldEvent({
      id: `g2-${sig}-${Date.now()}`,
      at: new Date().toISOString(),
      kind: "urgent_g2",
      items: g2AutoSoldNotices.map((s) => ({
        key: s.key,
        ticker: s.ticker,
        dayPnlPct: s.dayPnlPct,
        dayPnlEur: s.dayPnlEur,
        reason: s.reason,
      })),
      openCountAfter,
    });
  }, [g2AutoSoldNotices, investSimInputs]);
  const [simChartsBundle, setSimChartsBundle] = useState<ChartBundle | null>(null);
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);

  const recAlertQueue = useRecommendationAlertQueue({
    simTable,
    inputs: investSimInputs,
    chartsBundle: simChartsBundle,
    sdsRows: sdsRowsForMig,
    lang: lang === "it" ? "it" : "en",
    // Popup "New recommendation" disabilitato all'apertura — solo sync firme.
    enabled: false,
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
  const [gapInvestigationQueue, setGapInvestigationQueue] = useState<GapInvestigationModalPayload[]>([]);
  const gapInvestigationModal = gapInvestigationQueue[0] ?? null;

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
    if (!homeHeavyReady) return;
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setSimChartsBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [simTable?.rows?.length, screen, homeHeavyReady]);

  // CoherenceAlertModal (Top Opps stale popup) removed.


  const capturePortfolioBeforeRefreshCb = useCallback(() => {
    capturePortfolioBeforeRefresh(simTable);
  }, [simTable]);

  const reloadAllSheets = useCallback(async (): Promise<SheetTable | null> => {
    const sim = await reloadSimulation();
    await Promise.all([
      reloadData(),
      reloadClinical(),
      reloadSecK8(),
      reloadFinancial(),
    ]);
    void fetchDesktopManifest().then((m) => {
      if (m?.updated_at) applyDesktopManifest(m);
    });
    return sim;
  }, [reloadData, reloadSimulation, reloadClinical, reloadSecK8, reloadFinancial]);

  const handleReloadSimulationVoid = useCallback(async (): Promise<void> => {
    await reloadSimulation();
  }, [reloadSimulation]);
  const handleReloadClinical = useCallback(async (): Promise<void> => {
    await reloadClinical();
  }, [reloadClinical]);
  const handleReloadSecK8 = useCallback(async (): Promise<void> => {
    await reloadSecK8();
  }, [reloadSecK8]);
  const handleReloadFinancial = useCallback(async (): Promise<void> => {
    await reloadFinancial();
  }, [reloadFinancial]);

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

  const runEisStaleWarningCheck = useCallback(async () => {
    const w = await checkClinicalFeedStaleWarning();
    if (w.show) setEisStaleWarning(w);
  }, []);

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
    void readLocalSdsSnapshot().then((doc) => {
      if (!cancelled && doc?.rows?.length) setSdsRowsForMig(doc.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [simTable, simLoading]);

  useEffect(() => {
    if (simLoading || !homeHeavyReady) return;
    let cancelled = false;
    void loadSdsCohort(false)
      .then((doc) => {
        if (!cancelled && doc?.rows?.length) setSdsRowsForMig(doc.rows);
      })
      .catch(() => {
        /* local snapshot already applied */
      });
    return () => {
      cancelled = true;
    };
  }, [simTable, simLoading, homeHeavyReady]);

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

    // Never auto-open the "in loss / curve rising" carousel on app start.
    if (!lossModalRefreshTokenRef.current) {
      lossModalRefreshTokenRef.current = "app-start";
    }
    lossModalShowPendingRef.current = false;
  }, [simTable, investSimInputs, simLoading, lossModalOpen]);

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
          !isRefreshInFlight() &&
          !sheetsReloadInFlightRef.current
        ) {
          sheetsReloadInFlightRef.current = true;
          try {
            const sim = await reloadAllSheets();
            markReloadCompleted();
            checkSignals();
            if (sim) await runMorningDiscoveryCheck(sim);
            await runClinicalFeedRefreshCheck();
          } finally {
            sheetsReloadInFlightRef.current = false;
          }
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

  // Check for stale EIS pipeline once when API first comes online.
  const eisStaleCheckedRef = useRef(false);
  useEffect(() => {
    if (!apiOk || eisStaleCheckedRef.current) return;
    eisStaleCheckedRef.current = true;
    void runEisStaleWarningCheck();
  }, [apiOk, runEisStaleWarningCheck]);

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

  // Single shared catalog for Home + sim-loop Soft SELL — avoid rebuilding
  // the heavy three-portfolio / monitor pipeline twice per render.
  const needSharedLossRisk =
    screen === "catalystDesk" || screen === "simulation";
  const { catalog: sharedLossRiskCatalog, catalogByRowKey: sharedLossRiskByRowKey } =
    useLossRiskCatalog({
      simTable: needSharedLossRisk ? simTable : null,
      sdsRows: sdsRowsForMig,
      chartBundle: needSharedLossRisk ? simChartsBundle : null,
      enabled: needSharedLossRisk,
    });

  useEffect(() => {
    if (apiOk !== true) return;
    void fetchStatus()
      .then((st) => {
        if (st.saturday_weekly_full_enabled) setServerWeeklyFullEnabled(true);
      })
      .catch(() => {
        /* keep prior — VPS probe below is source of truth for WeeklyFull */
      });
  }, [apiOk]);

  /** VPS WeeklyFull flag — does not require local :8765. */
  useEffect(() => {
    let cancelled = false;
    void fetchWeeklyFullStatus()
      .then((st) => {
        if (cancelled) return;
        if (st.enabled) setServerWeeklyFullEnabled(true);
        if (weeklyFullCompletedToday(st)) {
          markSaturdayAutostartDone();
          acknowledgeWeeklyFullServerStatus(st);
        }
      })
      .catch(() => {
        /* offline / no token */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleServerWeeklyFullCompleted = useCallback(
    async () => {
      // Model quality (sign curve / learnings) reads project JSON — drop cache.
      try {
        const { invalidateProjectJsonCache } = await import("./data/projectData");
        invalidateProjectJsonCache();
      } catch {
        /* optional */
      }
      const sim = await reloadAllSheets();
      markReloadCompleted();
      checkSignals();
      if (sim) await runMorningDiscoveryCheck(sim);
      pendingPortfolioAlertsAfterSundayRef.current = true;
    },
    [reloadAllSheets, checkSignals, runMorningDiscoveryCheck],
  );

  useWeeklyFullServerWatch({
    enabled: serverWeeklyFullEnabled,
    onServerCompleted: handleServerWeeklyFullCompleted,
  });

  useRefreshStaleReconcile(apiOk);

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

  /** Sabato mattina — avvio locale solo se il server NON ha scheduler WeeklyFull. */
  useEffect(() => {
    if (!isDesktopShell()) return;
    if (!shouldAutoStartSundayFull()) return;
    let cancelled = false;
    void (async () => {
      try {
        const st = await fetchWeeklyFullStatus();
        if (cancelled) return;
        if (st.enabled || weeklyFullCompletedToday(st)) {
          if (st.enabled) setServerWeeklyFullEnabled(true);
          markSaturdayAutostartDone();
          acknowledgeWeeklyFullServerStatus(st);
          return;
        }
      } catch {
        /* fall through — local autostart only if API up */
      }
      if (cancelled || apiOk !== true || serverWeeklyFullEnabled) return;
      markSaturdayAutostartDone();
      requestSundayFullAutostart();
    })();
    return () => {
      cancelled = true;
    };
  }, [apiOk, serverWeeklyFullEnabled]);


  const testerGateMode =
    desktopTester.gate === "loading"
      ? "loading"
      : desktopTester.gate === "pending"
        ? "pending"
        : desktopTester.gate === "revoked"
          ? "revoked"
          : "register";

  if (desktopTester.pickerOpen && desktopTester.tester) {
    return (
      <DesktopTesterGate
        mode={testerGateMode}
        tester={desktopTester.tester}
        accountRoster={desktopTester.accountRoster}
        authBusy={desktopTester.authBusy}
        authErr={desktopTester.authErr}
        inviteRequired={desktopTester.inviteRequired}
        switching
        onRegister={desktopTester.register}
        onActivateAccount={(a) => {
          testerBookAdoptedRef.current = null;
          void desktopTester.activateAccount(a);
        }}
        onRefresh={() => void desktopTester.refreshAccess()}
        onSignOut={desktopTester.signOut}
        onCancelSwitch={desktopTester.closeAccountPicker}
      />
    );
  }

  if (desktopTester.showLanding) {
    return (
      <SupernovaLandingPage
        mode={testerGateMode}
        tester={desktopTester.tester}
        authBusy={desktopTester.authBusy}
        authErr={desktopTester.authErr}
        canEnter={desktopTester.gate === "ready"}
        onEnter={desktopTester.enterApp}
        onRequestAccess={(payload) => {
          void desktopTester.register(payload.email, payload.displayName, undefined, {
            edition: payload.edition,
            otherSpaces: payload.otherSpaces.trim(),
            firstName: payload.firstName,
            lastName: payload.lastName,
            birthYear: payload.birthYear,
          });
        }}
        onSignIn={(email) => {
          void desktopTester.signIn(email);
        }}
        onRefresh={() => void desktopTester.refreshAccess()}
        onSignOut={desktopTester.signOut}
      />
    );
  }

  return (
    <div className="app-shell flex flex-col h-screen overflow-hidden bg-[rgb(var(--bg-deep))]">
      {desktopTester.showGate && desktopTester.gate === "ready" ? (
        <DesktopTesterGate
          mode="register"
          tester={desktopTester.tester}
          accountRoster={desktopTester.accountRoster}
          authBusy={desktopTester.authBusy}
          authErr={desktopTester.authErr}
          inviteRequired={desktopTester.inviteRequired}
          switching
          onRegister={(email, name, code) => {
            testerBookAdoptedRef.current = null;
            void desktopTester.register(email, name, code);
          }}
          onActivateAccount={(a) => {
            testerBookAdoptedRef.current = null;
            void desktopTester.activateAccount(a);
          }}
          onRefresh={() => void desktopTester.refreshAccess()}
          onSignOut={desktopTester.signOut}
          onCancelSwitch={desktopTester.closeAccountPicker}
        />
      ) : null}
      {!isPopoutWindow ? (
        <>
          <PlatformRail active={platform} onSelect={setPlatform} />
          <AppSidebar
            screen={screen}
            onScreen={(next) => {
              setPlatform("pharma");
              navigateTo(next);
            }}
            onEvalLabNav={(lab) => {
              setPlatform("pharma");
              handleEvalLabNav(lab);
            }}
            apiOk={apiOk}
            showAccessAdmin={showAccessAdmin}
            showSystemAdmin={showSystemAdmin}
            accessAlertCount={accessAlertCount}
            accountEmail={desktopTester.tester?.email ?? null}
            onSignOut={
              desktopTester.gate === "ready"
                ? () => {
                    testerBookAdoptedRef.current = null;
                    desktopTester.signOut();
                  }
                : undefined
            }
          />
        </>
      ) : null}
      <div className="app-main flex flex-col flex-1 min-h-0 overflow-hidden min-w-0 bg-[rgb(var(--bg-deep))] relative z-0 isolate">
        {platform === "hitech" &&
        screen !== "testerMonitor" &&
        screen !== "system" ? (
          <HighTechComingSoonView onBackBiotech={() => setPlatform("pharma")} />
        ) : (
          <>
        <AppTopBar
          screen={screen}
          desktopManifest={desktopManifest}
          apiOk={apiOk}
          status={status}
          showApiOffline={showAccessAdmin}
          canGoBack={canGoBack && screen !== "simulation"}
          previousScreen={previousScreen}
          onGoBack={handleTopBarGoBack}
          accountEmail={
            desktopTester.gate === "ready" ? desktopTester.tester?.email ?? null : null
          }
          onSwitchAccount={
            allowsDesktopAccountSwitch()
              ? () => {
                  desktopTester.openAccountPicker();
                }
              : undefined
          }
          onSignOutAccount={() => {
            testerBookAdoptedRef.current = null;
            desktopTester.signOut();
          }}
        />
        {platform === "hitech" &&
        (screen === "testerMonitor" || screen === "system") ? (
          <div className="shrink-0 px-4 py-1.5 text-[11px] text-ink-muted border-b border-[rgb(var(--border))]/30">
            Access / System stay on Biotech layout while Technology/AI desk is still WIP.
          </div>
        ) : null}
        {(screen === "catalyst") &&
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
          className={`flex-1 min-h-0 ${
            screen === "catalystDesk" ||
            screen === "simulation" ||
            screen === "discovery" ||
            screen === "calendar"
              ? "relative flex-1 min-h-0 overflow-hidden p-0"
              : "flex flex-col overflow-y-auto overscroll-contain p-4"
          }`}
        >
        {renderedScreen === "catalyst" && (
          <ViewErrorBoundary label="Curves" showTechnicalDetail={showAccessAdmin}>
            <Suspense fallback={<ScreenFallback />}>
              <CatalystHubView
                simTable={simTable}
                simLoading={simLoading}
                simError={simError}
                onReloadSimulation={handleReloadSimulationVoid}
                secK8Table={secK8Table}
                onOpenSecK8={openSecK8}
                chartsFocusSeriesKey={catalystChartsFocus?.seriesKey ?? null}
                chartsFocusTicker={catalystChartsFocus?.ticker ?? null}
                onChartsFocusConsumed={handleCatalystChartsFocusConsumed}
                chartsSubPanelFocus={catalystChartsSubFocus}
                slopeChartsFocusTicker={slopeChartsFocusTicker}
                onChartsSubPanelFocusConsumed={handleCatalystChartsSubPanelConsumed}
                onSlopeChartsFocusTickerConsumed={handleSlopeChartsFocusTickerConsumed}
                onOpenPredictionCharts={openPredictionCharts}
                sdsRows={sdsRowsForMig}
              />
            </Suspense>
          </ViewErrorBoundary>
        )}

        {renderedScreen === "clinical" && (
          <Suspense fallback={<ScreenFallback />}>
            <ClinicalSimulationView
              simTable={simTable}
              clinicalTable={clinicalTable}
              loading={clinicalLoading}
              error={clinicalError}
              onReload={handleReloadClinical}
            />
          </Suspense>
        )}

        {renderedScreen === "secK8" && (
          <Suspense fallback={<ScreenFallback />}>
            <SecK8SimulationView
              simTable={simTable}
              secK8Table={secK8Table}
              loading={secK8Loading}
              error={secK8Error}
              onReload={handleReloadSecK8}
              initialTicker={secK8FocusTicker}
              onInitialTickerConsumed={handleSecK8FocusConsumed}
            />
          </Suspense>
        )}

        {renderedScreen === "calendar" && (
          <ViewErrorBoundary label="Calendar" showTechnicalDetail={showAccessAdmin}>
            <div className="w-full min-w-0 min-h-0 flex-1 flex flex-col h-full overflow-hidden">
              {desktopTester.hasPremium ? (
                <GuidanceCalendarPanel it={lang === "it"} />
              ) : (
                <PremiumLockedPreview bodyKey="premium.unlock.calendar">
                  <GuidanceCalendarPanel it={lang === "it"} />
                </PremiumLockedPreview>
              )}
            </div>
          </ViewErrorBoundary>
        )}

        {renderedScreen === "discovery" && (
          <ViewErrorBoundary label="Discovery" showTechnicalDetail={showAccessAdmin}>
            {desktopTester.hasPremium ? (
              <UniverseDiscoveryFeedPanel it={lang === "it"} />
            ) : (
              <PremiumLockedPreview bodyKey="premium.unlock.discovery" fill="cover">
                <UniverseDiscoveryFeedPanel it={lang === "it"} />
              </PremiumLockedPreview>
            )}
          </ViewErrorBoundary>
        )}

        {renderedScreen === "catalystDesk" && (
          <ViewErrorBoundary label="Catalyst Days" showTechnicalDetail={showAccessAdmin}>
            <Suspense fallback={<ScreenFallback />}>
              <CatalystDaysPage
                simTable={simTable}
                inputs={investSimInputs}
                sdsRows={sdsRowsForMig}
                chartBundle={simChartsBundle}
                lossRiskCatalog={sharedLossRiskCatalog}
                catalogByRowKey={sharedLossRiskByRowKey}
                onOpenEvaluationTopKpi={handleOpen24hAssessment}
                onReloadSimulation={reloadSimulation}
                hasPremium={desktopTester.hasPremium}
              />
            </Suspense>
          </ViewErrorBoundary>
        )}

        {renderedScreen === "simulation" && (
          <ViewErrorBoundary label="Deep Dive" showTechnicalDetail={showAccessAdmin}>
            <Suspense fallback={<ScreenFallback />}>
              <InvestmentSimulationView
                simTable={simTable}
                simLoading={simLoading}
                simError={simError}
                onReloadSimulation={reloadSimulation}
                onOpenPredictionCharts={handleOpenPredictionChartsWithKey}
                onOpenSlopeCharts={openSlopeErrorCharts}
                focusTicker={simulationFocus}
                initialView="lossAnalysis"
                onFocusConsumed={handleSimulationFocusConsumed}
                onExitDeepDive={() => navigateTo("catalystDesk", { immediate: true })}
                sharedLossRiskCatalog={sharedLossRiskCatalog}
                sharedLossRiskByRowKey={sharedLossRiskByRowKey}
                sharedChartBundle={simChartsBundle}
              />
            </Suspense>
          </ViewErrorBoundary>
        )}

        {renderedScreen === "financial" && (
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <Suspense fallback={<ScreenFallback />}>
              <FinancialSheetView
                table={finTable}
                loading={finLoading}
                error={finError}
                onReload={handleReloadFinancial}
                simTable={simTable}
              />
            </Suspense>
          </div>
        )}

        {renderedScreen === "system" && showSystemAdmin && (
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
            />
          </Suspense>
        )}
        {renderedScreen === "testerMonitor" && showAccessAdmin ? (
          <TesterMonitorView apiOk={apiOk} />
        ) : null}
        </div>
          </>
        )}
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
          const tk = ticker.trim().toUpperCase();
          if (tk) {
            setSimulationFocus({
              ticker: tk,
              view: "lossAnalysis",
              preferTopKpi: false,
              openDeepDive: true,
              focusNonce: Date.now(),
            });
            navigateTo("simulation");
          } else {
            navigateTo("catalystDesk");
          }
        }}
        onClose={handlePortfolioAlertsClose}
      />
      <ViewErrorBoundary label="Loss alert modal">
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
          onOpenLossAnalysis={(ticker, cd) =>
            handleNavigateToSimulationLossAnalysis(ticker, cd)
          }
          onSellPosition={handleDashboardSell}
        />
      </ViewErrorBoundary>
      <UrgentSellG2AutoSoldModal
        open={g2AutoSoldNotices.length > 0}
        sold={g2AutoSoldNotices}
        onClose={clearG2AutoSoldNotices}
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
        onClose={() => {
          // Ack ALL finish ids from the live status so the poll cannot reopen this popup.
          dismissWeeklyFullCompletion({ summary: sundayResult?.summary ?? null });
          void fetchWeeklyFullStatus()
            .then((status) => acknowledgeWeeklyFullServerStatus(status))
            .catch(() => {
              /* offline — summary ack above is enough for most cases */
            });
          closeSundayRefreshResult();
        }}
      />
      <ViewErrorBoundary label="Recommendation alert modal">
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
          onTrimToSynth={handleSynthTrimFromAlert}
        />
      </ViewErrorBoundary>
      <SynthSyncSummaryModal
        open={synthSyncSummaryOpen}
        summary={synthSyncSummary}
        onClose={() => setSynthSyncSummaryOpen(false)}
      />
      {eisStaleWarning?.show && (
        <PipelineStaleWarningModal
          warning={eisStaleWarning}
          onClose={() => {
            acknowledgeEisStaleWarning(eisStaleWarning.reportId);
            setEisStaleWarning((w) => (w ? { ...w, show: false } : null));
          }}
        />
      )}
      {/* Page zoom: bottom-right (was top bar next to bell). */}
      {!isPopoutWindow ? (
        <div className="pointer-events-none fixed bottom-3 right-3 z-[90]">
          <div className="pointer-events-auto shadow-md rounded-lg">
            <PageZoomControls />
          </div>
        </div>
      ) : null}
    </div>
  );
}
