import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAccuracySheet,
  fetchClinicalSimulationSheet,
  fetchSecK8SimulationSheet,
  fetchFinancialSheet,
  fetchHealth,
  fetchOrchestratorLog,
  fetchRefreshLog,
  fetchSimulationSheet,
  fetchStatus,
  runOrchestrator,
} from "./api/supernova";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopBar } from "./components/AppTopBar";
import { CatalystHubView, type CatalystHubPanel } from "./components/CatalystHubView";
import { ClinicalSimulationView } from "./components/ClinicalSimulationView";
import { SecK8SimulationView } from "./components/SecK8SimulationView";
import { InvestmentSimulationView } from "./components/InvestmentSimulationView";
import { InvestmentDecisionLabView } from "./components/InvestmentDecisionLabView";
import { ModelAccuracyLabView } from "./components/ModelAccuracyLabView";
import { MainDashboardView } from "./components/MainDashboardView";
import { SystemView } from "./components/SystemView";
import { FinancialNodesView } from "./components/FinancialNodesView";
import { FinancialSheetView } from "./components/FinancialSheetView";
import { loadPredictions } from "./data/predictions";
import {
  accuracyManifestSignature,
  desktopDataDirHint,
  fetchDesktopManifest,
  isDesktopShell,
} from "./data/projectData";
import {
  applyThemeToDocument,
  loadResolvedTheme,
  saveStoredTheme,
  type ResolvedTheme,
} from "./sheet/themePrefs";
import type { ApiStatus, AppScreen, CatalystRow, FinancialViewMode, SheetTable } from "./types";

const PAGE_SIZE = 200;

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("main");
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
  const [dataSource, setDataSource] = useState("");
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);

  const [desktopManifest, setDesktopManifest] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [log, setLog] = useState("");
  const [refreshLog, setRefreshLog] = useState("");
  const [busy, setBusy] = useState(false);

  const [simTable, setSimTable] = useState<SheetTable | null>(null);
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
  const [finView, setFinView] = useState<FinancialViewMode>("nodes");
  const [secK8FocusTicker, setSecK8FocusTicker] = useState<string | null>(null);
  const [catalystChartsFocus, setCatalystChartsFocus] = useState<{
    seriesKey: string | null;
    ticker: string;
  } | null>(null);
  const [catalystPanelFocus, setCatalystPanelFocus] = useState<CatalystHubPanel | null>(null);

  const openSecK8 = useCallback((ticker?: string) => {
    setSecK8FocusTicker(ticker?.trim().toUpperCase() || null);
    setScreen("secK8");
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const reloadData = useCallback(async () => {
    setDataLoading(true);
    setDataError(null);
    const { rows, source, error } = await loadPredictions();
    setAllRows(rows);
    setDataSource(source);
    if (error) setDataError(error);
    setDataLoading(false);
    setPage(1);
  }, []);

  useEffect(() => {
    void reloadData();
    void fetchDesktopManifest().then((m) => {
      if (m?.updated_at) setDesktopManifest(m.updated_at);
    });
  }, [reloadData]);

  const filtered = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.ticker.toUpperCase().includes(q));
  }, [allRows, filter]);

  const visible = useMemo(
    () => filtered.slice(0, page * PAGE_SIZE),
    [filtered, page]
  );

  const refreshApi = useCallback(async () => {
    try {
      await fetchHealth();
      setApiOk(true);
      setStatus(await fetchStatus());
      const l = await fetchOrchestratorLog(4000);
      setLog(l.log);
      try {
        const rl = await fetchRefreshLog(4000);
        setRefreshLog(rl.log);
      } catch {
        setRefreshLog("");
      }
    } catch {
      setApiOk(false);
    }
  }, []);

  useEffect(() => {
    void refreshApi();
  }, [refreshApi]);

  const reloadSimulation = useCallback(async () => {
    setSimLoading(true);
    setSimError(null);
    try {
      const t = await fetchSimulationSheet();
      setSimTable(t);
      if (t.error) setSimError(t.error);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
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
      const m = await fetchDesktopManifest();
      const sig = accuracyManifestSignature(m);
      setAccManifestSigAtLoad(sig);
      setAccManifestSigLive(sig);
      if (m?.updated_at) setDesktopManifest(m.updated_at);
    } catch (e) {
      setAccError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccLoading(false);
    }
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
        screen === "simulation" ||
        screen === "clinical" ||
        screen === "secK8") &&
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
      (screen === "models" || screen === "modelli") &&
      !accTable &&
      !accLoading
    ) {
      void reloadAccuracy();
    }
  }, [screen, accTable, accLoading, reloadAccuracy]);

  /** Tab Modelli: se lo snapshot Accuracy sul disco è più recente, ricarica il foglio. */
  useEffect(() => {
    if (screen !== "modelli") return;
    let cancelled = false;
    void fetchDesktopManifest().then((m) => {
      if (cancelled) return;
      const live = accuracyManifestSignature(m);
      setAccManifestSigLive(live);
      if (m?.updated_at) setDesktopManifest(m.updated_at);
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
          "Nessuna riga Financial — chiudi Excel sul workbook, esegui orchestrator, poi Ricarica."
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFinError(
        msg.includes("abort")
          ? "Timeout (>2 min). Chiudi Excel, riavvia supernova_api (porta 8765) e premi Ricarica."
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

  const reloadAllSheets = useCallback(() => {
    void reloadData();
    void reloadSimulation();
    void reloadClinical();
    void reloadSecK8();
    void reloadAccuracy();
    void reloadFinancial();
    void fetchDesktopManifest().then((m) => {
      if (m?.updated_at) setDesktopManifest(m.updated_at);
    });
  }, [reloadData, reloadSimulation, reloadClinical, reloadSecK8, reloadAccuracy, reloadFinancial]);

  const onRunQuick = async () => {
    setBusy(true);
    try {
      await runOrchestrator("quick");
      setTimeout(() => void refreshApi(), 2000);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "rgb(var(--bg-deep))" }}>
      <AppSidebar screen={screen} onScreen={setScreen} apiOk={apiOk} />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <AppTopBar
          screen={screen}
          desktopManifest={desktopManifest}
          apiOk={apiOk}
          status={status}
          onReloadData={() => void reloadData()}
        />
        {(dataError || (!dataLoading && allRows.length === 0 && !dataError)) && (
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
                      Apri cartella data
                    </button>
                  </>
                )}
              </p>
            )}
            {!dataLoading && allRows.length === 0 && !dataError && (
              <p className="text-ink-muted">
                Nessun catalyst caricato — verifica{" "}
                <code className="text-accent">{desktopDataDirHint()}</code>
              </p>
            )}
          </div>
        )}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 p-4">
        {screen === "main" && (
          <MainDashboardView
            simTable={simTable}
            simLoading={simLoading}
            secK8Table={secK8Table}
            secK8Loading={secK8Loading}
            onScreen={setScreen}
            onOpenSecK8={openSecK8}
          />
        )}

        {screen === "catalyst" && (
          <CatalystHubView
            simTable={simTable}
            simLoading={simLoading}
            simError={simError}
            onReloadSimulation={() => void reloadSimulation()}
            catalystRows={visible}
            catalystFilter={filter}
            onCatalystFilter={(v) => {
              setFilter(v);
              setPage(1);
            }}
            catalystSelectedId={null}
            onCatalystSelect={() => undefined}
            catalystLoading={dataLoading}
            catalystSource={dataSource}
            catalystTotal={filtered.length}
            onCatalystLoadMore={() => setPage((p) => p + 1)}
            hasMoreCatalysts={visible.length < filtered.length}
            chartsFocusSeriesKey={catalystChartsFocus?.seriesKey ?? null}
            chartsFocusTicker={catalystChartsFocus?.ticker ?? null}
            onChartsFocusConsumed={() => setCatalystChartsFocus(null)}
            focusPanel={catalystPanelFocus}
            onFocusPanelConsumed={() => setCatalystPanelFocus(null)}
          />
        )}

        {screen === "simulation" && (
          <InvestmentSimulationView
            simTable={simTable}
            simLoading={simLoading}
            simError={simError}
            onReloadSimulation={() => void reloadSimulation()}
            onOpenPredictionCharts={({ seriesKey, ticker }) => {
              setCatalystChartsFocus({ seriesKey, ticker });
              setScreen("catalyst");
            }}
            onOpenSimulationTable={() => {
              setCatalystPanelFocus("table");
              setScreen("catalyst");
            }}
          />
        )}

        {screen === "clinical" && (
          <ClinicalSimulationView
            simTable={simTable}
            clinicalTable={clinicalTable}
            loading={clinicalLoading}
            error={clinicalError}
            onReload={() => void reloadClinical()}
          />
        )}

        {screen === "secK8" && (
          <SecK8SimulationView
            simTable={simTable}
            secK8Table={secK8Table}
            loading={secK8Loading}
            error={secK8Error}
            onReload={() => void reloadSecK8()}
            initialTicker={secK8FocusTicker}
            onInitialTickerConsumed={() => setSecK8FocusTicker(null)}
          />
        )}

        {screen === "decisionLab" && (
          <InvestmentDecisionLabView simTable={simTable} simLoading={simLoading} />
        )}

        {screen === "financial" && finView === "nodes" && (
          <div className="flex flex-1 min-h-0 flex-col">
            <FinancialNodesView
              table={finTable}
              loading={finLoading}
              error={finError}
              onReload={() => void reloadFinancial()}
              onOpenTable={() => setFinView("table")}
            />
          </div>
        )}

        {screen === "models" && (
          <ModelAccuracyLabView
            accTable={accTable}
            loading={accLoading}
            error={accError}
            onReload={() => void reloadAccuracy()}
            initialTab="temporal"
            accuracyDataStale={
              Boolean(
                accManifestSigLive &&
                  accManifestSigAtLoad &&
                  accManifestSigLive !== accManifestSigAtLoad
              )
            }
            manifestUpdatedAt={desktopManifest}
          />
        )}

        {screen === "modelli" && (
          <ModelAccuracyLabView
            accTable={accTable}
            loading={accLoading}
            error={accError}
            onReload={() => void reloadAccuracy()}
            initialTab="guide"
            accuracyDataStale={
              Boolean(
                accManifestSigLive &&
                  accManifestSigAtLoad &&
                  accManifestSigLive !== accManifestSigAtLoad
              )
            }
            manifestUpdatedAt={desktopManifest}
          />
        )}

        {screen === "financial" && finView === "table" && (
          <div className="flex flex-col min-h-0 flex-1 gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setFinView("nodes")}
              >
                ← Vista nodi
              </button>
            </div>
            <FinancialSheetView
              table={finTable}
              loading={finLoading}
              error={finError}
              onReload={() => void reloadFinancial()}
            />
          </div>
        )}

        {screen === "system" && (
          <SystemView
            apiOk={apiOk}
            busy={busy}
            onBusyChange={setBusy}
            onRefreshComplete={reloadAllSheets}
            status={status}
            log={log}
            refreshLog={refreshLog}
            onRunQuick={() => void onRunQuick()}
            onRefreshStatus={() => void refreshApi()}
            theme={theme}
            onTheme={handleThemeChange}
          />
        )}
        </div>
      </div>
    </div>
  );
}
