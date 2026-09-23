import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyLearningCycle,
  exportLearningLabReport,
  fetchLearningLabOverview,
  previewLearningCycle,
  resetLearningLab,
  type LearningLabOverview,
} from "../api/supernova";
import { useLang } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { fetchLearningPipelineOverview, fetchLearningAuditLog, type LearningAuditLog, type LearningPipelineOverview } from "../api/learningBus";
import { LearningLabAuditLogPanel } from "./LearningLabAuditLogPanel";
import { LearningLabUnifiedView } from "./LearningLabUnifiedView";
import { ChannelImpactPanels } from "./ChannelImpactPanels";
import { ExpectedMoveSection } from "./ExpectedMoveSection";
import { GlobalCalFactorReadOnly, LearningPipelinePanel } from "./LearningPipelinePanel";
import { LearningLabPortfolioTab } from "./LearningLabPortfolioTab";
import { seedCdPatternPolygonOverviewFromLab } from "../sheet/useCdPatternPolygonOverview";
import { loadInvestSimHistory, loadInvestSimInputs } from "../sheet/investSimStorage";
import { computeEisFeedWindowScore } from "../sheet/lossRescueEngine";
import { analyzeRescueRebound, type RescueReboundAnalysis } from "../sheet/recommendationRescue";
import { analyzeSellTiming, type SellTimingAnalysis } from "../sheet/recommendationSellTiming";

const REFRESH_MS = 5 * 60_000;
const OVERVIEW_SESSION_KEY = "learningLab.overview.v1";

function readSessionOverview(): LearningLabOverview | null {
  try {
    const raw = sessionStorage.getItem(OVERVIEW_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LearningLabOverview;
  } catch {
    return null;
  }
}

function saveSessionOverview(doc: LearningLabOverview): void {
  try {
    sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(doc));
  } catch {
    /* quota / private mode */
  }
}

function formatLearningLabLoadError(raw: string, it: boolean): string {
  if (/aborted|timeout/i.test(raw)) {
    return it
      ? "Timeout caricamento Learning Lab — l'API impiega troppo tempo o è bloccata da un refresh. Riavvia l'app o attendi la fine del refresh su :8765."
      : "Learning Lab load timed out — the API is too slow or blocked by a refresh. Restart the app or wait for refresh to finish on :8765.";
  }
  if (/failed to fetch|networkerror|load failed|connessione|connection refused|enotfound/i.test(raw)) {
    return it
      ? "API non raggiungibile su :8765 — avvia SuperNova desktop (Avvia_Biotech_Desktop.bat) e riprova."
      : "API not reachable on :8765 — start SuperNova desktop (Avvia_Biotech_Desktop.bat) and retry.";
  }
  return raw;
}

type LabTopTab = "model" | "portfolio" | "monitor";
const MIN_LEARNING_WEEK_N = 15;

function LearningDataMissingBanner({
  data,
  it,
}: {
  data: LearningLabOverview;
  it: boolean;
}) {
  if (data.data_available !== false && !data.cluster_data_missing && !data.regime_data_missing) {
    return null;
  }
  return (
    <div className="rounded-lg border border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/8 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-semibold text-ink">
        {it ? "Dati calibrazione non disponibili" : "Calibration data unavailable"}
      </p>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        {it
          ? "Cluster/regime JSON assenti o mock disabilitato. Esegui refresh orchestrator o primo ciclo learning per popolare i file."
          : "Cluster/regime JSON missing or mock disabled. Run orchestrator refresh or first learning cycle to populate files."}
      </p>
    </div>
  );
}

function LearningLivePoolBanner({
  data,
  it,
}: {
  data: LearningLabOverview;
  it: boolean;
}) {
  const live = data.live_pool;
  const n = live?.n_outcomes ?? data.total_outcomes ?? 0;
  const mae = live?.mae_with_all;
  const dir = live?.dir_with_all;
  if (n < MIN_LEARNING_WEEK_N || mae == null) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/8 px-3 py-2.5 space-y-1">
      <p className="text-[11px] font-semibold text-ink">
        {it ? "Pool live PastCatalyst (oggi)" : "Live PastCatalyst pool (today)"}
      </p>
      <p className="text-[11px] text-ink-muted leading-relaxed">
        {it
          ? `MAE ${mae.toFixed(2)}% · dir ${dir != null ? `${(dir * 100).toFixed(1)}%` : "—"} · n=${n.toLocaleString()} coppie pred/actual.`
          : `MAE ${mae.toFixed(2)}% · dir ${dir != null ? `${(dir * 100).toFixed(1)}%` : "—"} · n=${n.toLocaleString()} pred/actual pairs.`}
        {data.demo_history
          ? it
            ? " Il trend settimanale fino a maggio è storico demo (~2.6% MAE); l'ultimo punto live è la misura reale."
            : " Weekly trend through May is demo seed history (~2.6% MAE); the latest live point is the real measurement."
          : null}
      </p>
    </div>
  );
}

export function LearningLabView({
  reloadToken = 0,
  simTable,
  sdsRows,
}: {
  reloadToken?: number;
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [data, setData] = useState<LearningLabOverview | null>(null);
  const [pipeline, setPipeline] = useState<LearningPipelineOverview | null>(null);
  const [auditLog, setAuditLog] = useState<LearningAuditLog | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topTab, setTopTab] = useState<LabTopTab>("model");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewLearningCycle>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [reestimating, setReestimating] = useState(false);
  const hasDataRef = useRef(false);
  hasDataRef.current = data != null;

  // Re-estimate the per-channel impact: force a backend recompute (bypassing the
  // 5-min overview cache) and swap in the fresh values. The ChannelImpactPanels
  // diffs the new values against the snapshot it took right before this call.
  const handleReestimateChannels = useCallback(async () => {
    setReestimating(true);
    setError(null);
    try {
      const doc = await fetchLearningLabOverview({ force: true });
      setData(doc);
      saveSessionOverview(doc);
      seedCdPatternPolygonOverviewFromLab(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReestimating(false);
    }
  }, []);


  // HOLD / rescue rebound analysis lives in the UI sheet (rescue score + daily
  // PnL path) and feeds the Recommendation channel panel.
  const rescueRebound = useMemo<RescueReboundAnalysis | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const history = loadInvestSimHistory();
      return analyzeRescueRebound({
        history,
        inputs: loadInvestSimInputs(),
        eisScoreForKey: (ticker) => computeEisFeedWindowScore(ticker, lang, null, history),
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, lang]);

  // Predictive SELL timing (MII↓ + EIS≤0 + low rescue) — walk-forward graded on
  // the daily PnL path, same UI-sheet data as the rescue analysis.
  const sellTiming = useMemo<SellTimingAnalysis | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const history = loadInvestSimHistory();
      return analyzeSellTiming({
        history,
        inputs: loadInvestSimInputs(),
        eisScoreForKey: (ticker) => computeEisFeedWindowScore(ticker, lang, null, history),
      });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken, lang]);

  const globalCfFromPipeline = useMemo(() => {
    const step = pipeline?.steps?.find((s) => s.id === "global_cal_factor");
    const v = step?.summary?.value;
    return typeof v === "number" ? v : data?.global_cal_factor ?? null;
  }, [pipeline, data?.global_cal_factor]);

  const globalCfUpdatedAt = useMemo(() => {
    const step = pipeline?.steps?.find((s) => s.id === "global_cal_factor");
    const u = step?.summary?.updated_at;
    return typeof u === "string" ? u : null;
  }, [pipeline]);

  const load = useCallback(async () => {
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      const [doc, pipe] = await Promise.all([
        fetchLearningLabOverview(),
        fetchLearningPipelineOverview().catch(() => null),
      ]);
      setData(doc);
      setPipeline(pipe);
      saveSessionOverview(doc);
      seedCdPatternPolygonOverviewFromLab(doc);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const stale = readSessionOverview();
      if (stale) {
        setData(stale);
        seedCdPatternPolygonOverviewFromLab(stale);
        setError(
          it
            ? `Mostro ultimo snapshot locale — aggiornamento fallito: ${formatLearningLabLoadError(raw, it)}`
            : `Showing last local snapshot — refresh failed: ${formatLearningLabLoadError(raw, it)}`,
        );
      } else {
        setError(formatLearningLabLoadError(raw, it));
      }
    } finally {
      setLoading(false);
    }
  }, [it]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const doc = await fetchLearningAuditLog(200);
      setAuditLog(doc);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (topTab !== "monitor") return;
    void loadAudit();
  }, [topTab, loadAudit, reloadToken]);

  const lastRun = useMemo(() => {
    if (!data?.generated_at) return "—";
    return new Date(data.generated_at).toLocaleString();
  }, [data?.generated_at]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const p = await previewLearningCycle();
      setPreview(p);
      setPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmApply = async () => {
    setBusy(true);
    setError(null);
    try {
      await applyLearningCycle();
      setPreviewOpen(false);
      await fetchLearningLabOverview({ force: true }).then(async (doc) => {
        setData(doc);
        saveSessionOverview(doc);
        seedCdPatternPolygonOverviewFromLab(doc);
        const pipe = await fetchLearningPipelineOverview().catch(() => null);
        setPipeline(pipe);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const report = await exportLearningLabReport();
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learning_lab_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    const msg = it
      ? "Reset completo learning (cluster, regime, EIS, feedback)? Doppia conferma."
      : "Full learning reset (cluster, regime, EIS, feedback)? Double confirm.";
    if (!window.confirm(msg)) return;
    if (!window.confirm(it ? "Confermi definitivamente?" : "Confirm permanently?")) return;
    setBusy(true);
    setError(null);
    try {
      await resetLearningLab(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const topTabBtn = (id: LabTopTab, label: string) => (
    <button
      type="button"
      className={`rounded-md px-2.5 py-1 text-[11px] ${topTab === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"}`}
      onClick={() => setTopTab(id)}
    >
      {label}
    </button>
  );

  if (loading && !data) {
    return <p className="text-sm text-ink-muted py-8 text-center">{it ? "Caricamento Learning Lab…" : "Loading Learning Lab…"}</p>;
  }

  return (
    <ViewErrorBoundary label="Learning Lab">
      <div className="flex flex-col flex-1 gap-3 pr-1">
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold">Learning Lab</h3>
            <p className="text-[10px] text-ink-muted">
              {it ? "Ultimo aggiornamento" : "Last run"}: {lastRun}
            </p>
          </div>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void runPreview()}>
            {it ? "Esegui ciclo" : "Run cycle"}
          </button>
          <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void handleExport()}>
            Export
          </button>
          <button type="button" className="btn-ghost text-xs text-negative" disabled={busy} onClick={() => void handleReset()}>
            Reset
          </button>
        </div>

        {error ? <p className="text-xs text-negative">{error}</p> : null}

        <div className="flex gap-1 flex-wrap shrink-0">
          {topTabBtn("model", it ? "Calibrazione modello" : "Model calibration")}
          {topTabBtn("portfolio", it ? "Portfolio e advice" : "Portfolio & advice")}
          {topTabBtn("monitor", it ? "Monitor loop" : "Loop monitor")}
        </div>

        {data && topTab === "model" ? (
          <div className="space-y-4">
            <LearningDataMissingBanner data={data} it={it} />
            <LearningLivePoolBanner data={data} it={it} />
            <ChannelImpactPanels
              data={data.channel_impact}
              it={it}
              rescue={rescueRebound}
              sellTiming={sellTiming}
              onReestimate={handleReestimateChannels}
              reestimating={reestimating}
            />
            <ExpectedMoveSection data={data.expected_move} it={it} />
            <LearningPipelinePanel pipeline={pipeline} it={it} />
            <GlobalCalFactorReadOnly value={globalCfFromPipeline} updatedAt={globalCfUpdatedAt} it={it} />
          </div>
        ) : null}

        {topTab === "portfolio" ? (
          <LearningLabPortfolioTab simTable={simTable} sdsRows={sdsRows} reloadToken={reloadToken} />
        ) : null}

        {topTab === "monitor" ? (
          <div className="space-y-4">
            <LearningLabUnifiedView reloadToken={reloadToken} weeklyMetrics={auditLog?.weekly_metrics ?? []} />
            <LearningLabAuditLogPanel data={auditLog} loading={auditLoading} error={auditError} />
          </div>
        ) : null}

        {previewOpen && preview ? (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4">
            <div className="bg-surface rounded-xl border border-[rgb(var(--border))] shadow-xl max-w-lg w-full p-4 space-y-3">
              <h4 className="text-sm font-semibold">{it ? "Anteprima ciclo learning" : "Learning cycle preview"}</h4>
              <p className="text-[10px] text-ink-muted">
                {it
                  ? "Conferma per scrivere su disco. Il global cal_factor (v4) non viene modificato da questo ciclo."
                  : "Confirm to write to disk. Global cal_factor (v4) is NOT changed by this cycle."}
              </p>
              <ul className="text-[11px] space-y-1 max-h-48 overflow-y-auto font-mono">
                {preview.diff.cluster_changes.map((c) => (
                  <li key={String(c.cluster)}>
                    {String(c.cluster)}: {String(c.from)} → {String(c.to)}
                  </li>
                ))}
                {preview.diff.regime_changes.map((c) => (
                  <li key={String(c.regime)}>
                    {String(c.regime)}: {String(c.from)} → {String(c.to)}
                  </li>
                ))}
                {!preview.diff.cluster_changes.length && !preview.diff.regime_changes.length ? (
                  <li>{it ? "Nessuna modifica proposta." : "No proposed changes."}</li>
                ) : null}
              </ul>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={() => setPreviewOpen(false)}>
                  {it ? "Annulla" : "Cancel"}
                </button>
                <button type="button" className="btn-primary text-xs" disabled={busy} onClick={() => void confirmApply()}>
                  {it ? "Applica" : "Apply"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ViewErrorBoundary>
  );
}
