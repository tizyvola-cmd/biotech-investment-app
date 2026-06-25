import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { InvestmentSimulationView } from "./InvestmentSimulationView";
import type { SimulationNavFocus } from "../sheet/investSimStorage";
import {
  loadSimulationChartsBundle,
  invalidateSimulationChartsCache,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import type { ChartPoint, SheetTable } from "../types";
import {
  exportDesktopSnapshots,
  fetchPostRefreshPipelineLog,
  fetchPostRefreshPipelineStatus,
  fetchRefreshLog,
  fetchRefreshStatus,
  runDailyRefresh,
  runPostRefreshPipeline,
  triggerLiveSignalsRefresh,
} from "../api/supernova";
import {
  clearPendingAutoStart,
  makeRefreshLife,
  markReloadCompleted,
  setRefreshLife,
  setRefreshDurationClass,
  setRefreshProfile,
  showSundayRefreshResult,
  useRefreshStatus,
  type RefreshLifecycleInfo,
  type RefreshProfile,
} from "../shared/refreshStatusStore";
import { RefreshControls } from "./RefreshControls";
import { SupernovaDistanceScoreView } from "./SupernovaDistanceScoreView";
import { publishDashboardRecommendationsFromSimulation } from "../sheet/topOppsFromSimulation";

const PortfolioBuilderLabView = lazy(() =>
  import("./PortfolioBuilderLabView").then((m) => ({ default: m.PortfolioBuilderLabView })),
);
import { loadPortfolioSnapshotBeforeRefresh } from "../sheet/portfolioRefreshAlerts";
import { markSaturdayAutostartDone } from "../shared/sundayRefreshSchedule";
import { AntiqueClockIcon } from "./AntiqueClockIcon";
import { useLang, useT } from "../shared/i18n";

type LabTab = "monitor" | "sds" | "builder";
export type DecisionLabTab = LabTab;
// RefreshDataModal — "Refresh data" button that launches the server-side refresh
// (exported to be reused in other tabs — e.g. Simulation — so buttons and
// live badges are identical everywhere).
//
//
// (`POST /api/refresh/run?profile=daily` → `launch_refresh_fast.py`).
//
// Daily refresh (~8–18 min server): Simulation + snapshot essenziali; Accuracy
// saltata in feriale. UI non ripete l'export né attende il post-pipeline (KPI in background).
//
// Difference vs. "Reload": here we regenerate the data. Reload just re-reads them.
// ─────────────────────────────────────────────────────────────────────────

type RefreshState =
  | "idle"
  | "starting"
  | "running"        // refresh_fast.py in progress
  | "exporting"      // export snapshot JSON
  | "post-pipeline"  // directional calibration + cohort decision lab
  | "ok"
  | "error";

// ── Completion notifications ────────────────────────────────────────────────
//
// When the refresh finishes (ok or error), we notify the user even if they
// are in another tab/app:
//   1) Beep generated via Web Audio API (no asset to load)
//   2) Browser notification (requires permission, prompted on first refresh)
//   3) Document title flash ("✓ Refresh completed — ...")
//
// All best-effort: if the browser blocks audio or notifications, the toast/badge
// in the UI is still visible.

function playRefreshDoneBeep(success: boolean): void {
  try {
    type WindowWithAudio = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WindowWithAudio;
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq: number, when: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + dur + 0.05);
    };
    if (success) {
      // 3 ascending tones = "success chime"
      playTone(523, 0,    0.18); // C5
      playTone(659, 0.18, 0.18); // E5
      playTone(784, 0.36, 0.30); // G5
    } else {
      // 2 descending tones = "error"
      playTone(440, 0,    0.25); // A4
      playTone(330, 0.27, 0.40); // E4
    }
    // close context after 1.5s
    setTimeout(() => { void ctx.close(); }, 1500);
  } catch {
    /* no-op: audio not available */
  }
}

function showRefreshDoneBrowserNotification(success: boolean, elapsedSec: number, message: string): void {
  try {
    if (typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const mm = Math.floor(elapsedSec / 60);
    const ss = elapsedSec % 60;
    const elapsed = `${mm}m ${ss}s`;
    new Notification(
      success ? `✓ Refresh completed in ${elapsed}` : `✗ Refresh ended with error (${elapsed})`,
      {
        body: message.slice(0, 200),
        tag: "supernova-refresh",
        // For Electron / modern browsers — non-blocking if not supported:
        silent: false,
      }
    );
  } catch {
    /* notifications not available */
  }
}

function flashDocumentTitle(text: string, durationMs = 8000): void {
  try {
    if (typeof document === "undefined") return;
    const original = document.title;
    let toggle = false;
    const id = window.setInterval(() => {
      document.title = toggle ? original : text;
      toggle = !toggle;
    }, 1000);
    setTimeout(() => {
      window.clearInterval(id);
      document.title = original;
    }, durationMs);
  } catch {
    /* no-op */
  }
}

function fmtElapsedShort(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export type { RefreshLifecycleInfo };

// ── Live refresh mini-indicator in the header ───────────────────────────────
//
// Shows:
//   - during refresh: "⏳ Phase X/3 · 12:34" clickable → reopens the modal
//   - after OK completion: "✓ completed 12:34" for 90s, then disappears
//   - after error: "✗ refresh failed" persistent until the user reopens it
//   - idle: nothing
export function RefreshLiveBadge({
  info,
  finishedAt,
  onOpenModal,
}: {
  info: RefreshLifecycleInfo;
  finishedAt: Date | null;
  onOpenModal: () => void;
}) {
  // Force re-render every second (elapsed timer while in-flight, "ago" after done).
  const [, force] = useState(0);
  const inFlight =
    info.state === "starting" ||
    info.state === "running" ||
    info.state === "exporting" ||
    info.state === "post-pipeline";
  useEffect(() => {
    if (!inFlight && !finishedAt) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [inFlight, finishedAt]);

  if (info.state === "idle") return null;

  if (inFlight) {
    const isSunday = info.profile === "sunday";
    const phase = isSunday
      ? info.state === "starting"
        ? "Starting"
        : info.state === "exporting"
          ? "Snapshots"
          : "Orchestrator"
      : info.state === "starting"
        ? "Starting"
        : info.state === "running"
          ? "Phase 1/3"
          : info.state === "exporting"
            ? "Phase 2/3"
        : "Phase 3/3";
    return (
      <button
        type="button"
        onClick={onOpenModal}
        className="seg-btn-active inline-flex items-center gap-1.5 !px-2 !py-1 text-[10px]"
        title="Refresh in progress — click to reopen the panel"
      >
        {isSunday ? (
          <AntiqueClockIcon size={14} ticking />
        ) : (
        <span className="inline-block animate-spin">⏳</span>
        )}
        <span>{phase}</span>
        <span className="tabular-nums">{fmtElapsedShort(info.elapsedSec)}</span>
      </button>
    );
  }

  if (info.state === "ok" && finishedAt) {
    const secAgo = Math.max(0, Math.round((Date.now() - finishedAt.getTime()) / 1000));
    // After 90s hide the badge (the user has seen it, that's enough).
    if (secAgo > 90) return null;
    const ago = secAgo < 10 ? "now" : secAgo < 60 ? `${secAgo}s ago` : `${Math.floor(secAgo / 60)}m ago`;
    return (
      <button
        type="button"
        onClick={onOpenModal}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium bg-positive/15 text-positive hover:bg-positive/25 transition animate-pulse-once"
        title="Refresh completed — click to review log"
      >
        <span>✓</span>
        <span>Refresh completed</span>
        <span className="text-positive/70">· {ago}</span>
      </button>
    );
  }

  if (info.state === "error") {
    return (
      <button
        type="button"
        onClick={onOpenModal}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold bg-negative/15 text-negative hover:bg-negative/25 transition"
        title="Refresh failed — click to see error"
      >
        <span>✗</span>
        <span>Refresh failed</span>
      </button>
    );
  }

  return null;
}

export function RefreshDataModal({
  open,
  onClose,
  onCompleted,
  onLifecycleChange,
  onBeforeRefreshStart,
}: {
  open: boolean;
  onClose: () => void;
  /** Invoked when the server refresh ends ok: reloads the snapshots. */
  onCompleted: () => void;
  /** State snapshot for the parent (persistent mini-indicator in the header). */
  onLifecycleChange?: (info: RefreshLifecycleInfo) => void;
  /** Snapshot portfolio state before the pipeline starts. */
  onBeforeRefreshStart?: () => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const { profile: activeProfile, pendingAutoStart, apiOk } = useRefreshStatus();
  const apiOffline = apiOk === false;
  const [runProfile, setRunProfile] = useState<RefreshProfile>(activeProfile);
  const isSunday = runProfile === "sunday";
  const sundayExitRef = useRef<number | null>(null);

  useEffect(() => {
    setRunProfile(activeProfile);
  }, [activeProfile]);

  const [state, setState] = useState<RefreshState>("idle");
  const [message, setMessage] = useState<string>("");
  const [logTail, setLogTail] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Reset when the modal re-appears + auto-detect a refresh that is already
  // running on the server (e.g. started by a previous session that crashed
  // the UI, or by another tab). Without this, opening the modal always shows
  // "idle" and clicking "Start" would immediately fail with "Un job è già in
  // corso" because the backend lock is still held.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState("idle");
    setMessage("");
    setLogTail("");
    setUpdatedAt("");
    setStartedAt(null);
    setElapsedSec(0);
    (async () => {
      try {
        const st = await fetchRefreshStatus();
        if (cancelled) return;
        const procRunning = Boolean(st.running);
        if (procRunning) {
          // Join the running job: timer starts from "now" because we don't know
          // when the previous session launched it (the server file ``updated_at``
          // refers to the last status write, not to the job start).
          if (st.profile === "sunday") {
            setRefreshProfile("sunday");
            setRefreshDurationClass("long");
            setRunProfile("sunday");
          } else {
            setRefreshDurationClass("long");
          }
          if (!loadPortfolioSnapshotBeforeRefresh()) {
            onBeforeRefreshStart?.();
          }
          setStartedAt(new Date());
          setState("running");
          setUpdatedAt(st.updated_at ?? "");
          setMessage(st.message || "A refresh started by a previous session is still in progress…");
        }
      } catch {
        /* unavailable: the polling loop will retry once the user starts a refresh */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, onBeforeRefreshStart]);

  // Elapsed time timer (HH:MM) — active during all "in flight" phases.
  useEffect(() => {
    const active =
      state === "starting" ||
      state === "running" ||
      state === "exporting" ||
      state === "post-pipeline";
    if (!active) return;
    if (!startedAt) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state, startedAt]);

  // Polling status + log while the refresh is in progress.
  useEffect(() => {
    if (state !== "starting" && state !== "running") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const st = await fetchRefreshStatus();
        if (cancelled) return;
        setUpdatedAt(st.updated_at ?? "");
        // Solo il subprocess API conta come «in corso» — non st.state dal file (può restare «running»).
        const procRunning = Boolean(st.running);
        const exitCode =
          typeof st.exit_code === "number" && Number.isFinite(st.exit_code)
            ? st.exit_code
            : null;
        const serverOk = st.ok === "1" || st.state === "ok" || exitCode === 0;
        const serverErr =
          st.ok === "0" || st.state === "error" || (exitCode != null && exitCode !== 0);
        if (isSunday) {
          if (procRunning) {
            setState("running");
            setMessage(st.message || t("sundayRefresh.autostart.msg"));
          } else {
            const code = exitCode ?? -1;
            sundayExitRef.current = code;
            const ok = serverOk || code === 0;
            setState("exporting");
            setMessage(
              ok
                ? lang === "it"
                  ? "Orchestrator completato. Rigenerazione snapshot UI…"
                  : "Orchestrator finished. Regenerating UI snapshots…"
                : lang === "it"
                  ? `Orchestrator terminato con errori (exit ${code}). Export snapshot…`
                  : `Orchestrator ended with errors (exit ${code}). Exporting snapshots…`
            );
          }
        } else if (procRunning) {
          setState("running");
          setMessage(st.message || "Refresh in progress…");
        } else if (serverOk) {
          setState("exporting");
          setMessage(st.message || "Refresh completed. Regenerating snapshots for the UI…");
        } else if (serverErr) {
          setState("error");
          setMessage(st.message || "Error during the refresh.");
        } else if (st.state === "running" && !procRunning) {
          setState("error");
          setMessage(
            lang === "it"
              ? "Refresh interrotto o stato file obsoleto. Controlla last_refresh_desktop.log e riprova."
              : "Refresh interrupted or stale status file. Check last_refresh_desktop.log and retry."
          );
        } else {
          setState("exporting");
          setMessage(
            lang === "it"
              ? "Processo terminato — sincronizzazione snapshot UI…"
              : "Process ended — syncing UI snapshots…"
          );
        }
      } catch (e) {
        if (!cancelled) {
          setMessage(`Status unavailable: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      try {
        const lg = await fetchRefreshLog(2400);
        if (!cancelled) setLogTail(lg.log || "");
      } catch {
        /* log optional */
      }
    };

    void tick();
    const id = window.setInterval(() => { void tick(); }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state, isSunday, lang, t]);

  // "exporting": snapshot JSON per la UI (salta se il server li ha già scritti).
  useEffect(() => {
    if (state !== "exporting") return;
    let cancelled = false;

    const finishDailyOk = (msg: string) => {
      if (cancelled) return;
      setState("ok");
      setMessage(msg);
      void runPostRefreshPipeline().catch(() => {});
    };

    (async () => {
      try {
        let st: Awaited<ReturnType<typeof fetchRefreshStatus>> = {};
        try {
          st = await fetchRefreshStatus();
        } catch {
          /* optional */
        }
        const alreadyExported =
          st.snapshots_exported === "1" ||
          /snapshot essenziali|snapshot desktop esportati/i.test(st.message ?? "");

        let exportRes: Awaited<ReturnType<typeof exportDesktopSnapshots>> | null = null;
        if (!alreadyExported) {
          exportRes = await exportDesktopSnapshots({ essential: !isSunday });
        if (cancelled) return;
          if (exportRes?.error) {
          setState("error");
            setMessage(`Snapshot export failed: ${exportRes.error}`);
          return;
        }
        }

        const sheetsCount = exportRes?.sheets ? Object.keys(exportRes.sheets).length : 0;
        const exportNote = alreadyExported
          ? lang === "it"
            ? "Snapshot già aggiornati dal server."
            : "Snapshots already updated by the server."
          : lang === "it"
            ? `Snapshot rigenerati (${sheetsCount || 2} fogli).`
            : `Snapshots regenerated (${sheetsCount || 2} sheets).`;

        if (isSunday) {
          const code = sundayExitRef.current ?? 0;
          const ok = code === 0;
          setState(ok ? "ok" : "error");
            setMessage(
            ok
              ? lang === "it"
                ? `${exportNote} Orchestrator settimanale OK (include KPI + live signals).`
                : `${exportNote} Weekly orchestrator OK (includes KPI + live signals).`
              : lang === "it"
                ? `${exportNote} Orchestrator exit ${code}.`
                : `${exportNote} Orchestrator exit ${code}.`
            );
            return;
          }

        finishDailyOk(
          lang === "it"
            ? `${exportNote} Ricarico UI… (KPI direzionali in background).`
            : `${exportNote} Reloading UI… (directional KPIs in background).`
        );
      } catch (e) {
        if (cancelled) return;
        setState("ok");
        setMessage(
          lang === "it"
            ? `Refresh Excel OK; export snapshot: ${e instanceof Error ? e.message : String(e)}. Usa Reload se serve.`
            : `Excel refresh OK; snapshot export: ${e instanceof Error ? e.message : String(e)}. Use Reload if needed.`
        );
        void runPostRefreshPipeline().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, isSunday, lang]);

  // "post-pipeline" step: poll status until ok/error.
  useEffect(() => {
    if (state !== "post-pipeline") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const st = await fetchPostRefreshPipelineStatus();
        if (cancelled) return;
        if (st.updated_at) setUpdatedAt(st.updated_at);
        const procRunning = Boolean(st.running);
        if (procRunning) {
          setMessage(st.message || "Post-pipeline in progress…");
        } else if (st.state === "ok") {
          setState("ok");
          setMessage(st.message || "Post-pipeline completed.");
        } else if (st.state === "error") {
          // Don't block the user: Excel refresh is OK, post-pipeline had an issue.
          setState("ok");
          setMessage(
            `Refresh OK, but directional KPIs have issues: ${st.message || "unknown error"}`
          );
        }
      } catch {
        // Status temporarily unavailable — we will retry on the next tick.
      }
      try {
        const lg = await fetchPostRefreshPipelineLog(2400);
        if (!cancelled) setLogTail(lg.log || "");
      } catch {
        /* log optional */
      }
    };

    void tick();
    const id = window.setInterval(() => { void tick(); }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state, isSunday, lang]);

  // When transitioning to "ok", trigger snapshot reload on the caller (once per cycle).
  const completedHandledRef = useRef(false);
  useEffect(() => {
    if (state === "starting") {
      completedHandledRef.current = false;
    } else if (state === "ok" && !completedHandledRef.current) {
      completedHandledRef.current = true;
      void onCompleted();
    }
  }, [state, onCompleted]);

  const startSundayRefresh = useCallback(async () => {
    onBeforeRefreshStart?.();
    setRefreshProfile("sunday");
    setRefreshDurationClass("long");
    setRunProfile("sunday");
    sundayExitRef.current = null;
    setState("starting");
    setMessage(t("sundayRefresh.autostart.msg"));
    setLogTail("");
    setStartedAt(new Date());
    setElapsedSec(0);
    try {
      const res = await runDailyRefresh("sunday");
      if (res?.error) {
        setState("error");
        setMessage(String(res.error));
        return;
      }
      markSaturdayAutostartDone();
    } catch (e) {
      setState("error");
      setMessage(`Startup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onBeforeRefreshStart, t]);

  const startRefresh = useCallback(async () => {
    onBeforeRefreshStart?.();
    setRefreshDurationClass("long");
    setState("starting");
    setMessage("Starting daily refresh…");
    setLogTail("");
    setStartedAt(new Date());
    setElapsedSec(0);
    try {
      const res = await runDailyRefresh("daily");
      if (res?.error) {
        setState("error");
        setMessage(String(res.error));
        return;
      }
    } catch (e) {
      setState("error");
      setMessage(`Startup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onBeforeRefreshStart]);

  useEffect(() => {
    if (!open || !pendingAutoStart || !isSunday) return;
    clearPendingAutoStart();
    void startSundayRefresh();
  }, [open, pendingAutoStart, isSunday, startSundayRefresh]);

  const inFlight =
    state === "starting" ||
    state === "running" ||
    state === "exporting" ||
    state === "post-pipeline";
  const fmtElapsed = fmtElapsedShort;

  // ── Completion notification (sound + browser notification + title flash)
  // useRef to ensure we notify ONCE per cycle.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (state === "starting") {
      notifiedRef.current = false;
      // Pre-request notification permission on startup: the user is interacting
      // (has clicked "Start"), so the browser is more willing to grant it.
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } else if ((state === "ok" || state === "error") && !notifiedRef.current) {
      notifiedRef.current = true;
      const success = state === "ok";
      if (isSunday) {
        void (async () => {
          let summary = null;
          try {
            const { fetchOrchestratorSummary } = await import("../api/refresh");
            summary = await fetchOrchestratorSummary();
          } catch {
            /* optional */
          }
          showSundayRefreshResult({
            success,
            elapsedSec: summary?.elapsed_sec ?? elapsedSec,
            message,
            exitCode: sundayExitRef.current,
            summary: summary && Object.keys(summary).length > 0 ? summary : null,
          });
        })();
        playRefreshDoneBeep(success);
        flashDocumentTitle(
          success
            ? `✓ Sunday full ${fmtElapsedShort(elapsedSec)}`
            : `✗ Sunday full failed`
        );
      } else {
      playRefreshDoneBeep(success);
      showRefreshDoneBrowserNotification(success, elapsedSec, message);
      flashDocumentTitle(
        success
          ? `✓ Refresh completed in ${fmtElapsedShort(elapsedSec)}`
          : `✗ Refresh ended with error`
      );
    }
    }
  }, [state, elapsedSec, message, isSunday]);

  // ── Propagate state to the parent (for always-visible header badge) and
  //    to the global store (for badge shared across different tabs).
  useEffect(() => {
    const info = makeRefreshLife({
      state,
      elapsedSec,
      message,
      profile: runProfile,
    });
    onLifecycleChange?.(info);
    setRefreshLife(info);
  }, [onLifecycleChange, state, elapsedSec, message, runProfile]);

  // Render: modal ALWAYS mounted (the polling/timer useEffects keep running
  // even if the user has closed the panel). Visible overlay depends on `open`.
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!inFlight) onClose();
      }}
    >
      <div
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[rgb(var(--border))]/60 px-4 py-3">
          <div className="flex-1">
            <h3 className="text-base font-semibold inline-flex items-center gap-2">
              {isSunday ? (
                <>
                  <AntiqueClockIcon size={20} /> {t("sundayRefresh.modal.title")}
                </>
              ) : (
                <>🔄 Full data refresh</>
              )}
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {isSunday ? (
                t("sundayRefresh.modal.eta")
              ) : (
                <>
              End-to-end pipeline in 3 phases. Total ETA{" "}
                  <span className="text-ink">~15–25 minutes</span>. Equivalent to the daily scheduler.
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs disabled:opacity-50"
            onClick={onClose}
            disabled={inFlight}
            title={inFlight ? "Refresh in progress — wait for completion" : "Close"}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {state === "idle" && isSunday && (
            <>
              {apiOffline ? (
                <div className="rounded-lg border border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/8 px-3 py-2.5 text-xs space-y-1.5 mb-2">
                  <p className="font-semibold text-[rgb(var(--signal-down))]">
                    {t("refresh.modal.apiOffline.title")}
                  </p>
                  <p className="text-ink-muted leading-snug">{t("refresh.modal.apiOffline.body")}</p>
                </div>
              ) : null}
              <p className="text-xs text-ink-muted rounded-lg border border-[rgb(var(--warn))]/30 bg-[rgb(var(--warn))]/8 px-3 py-2">
                {lang === "it"
                  ? "Orchestrator settimanale completo (SEC 8-K, liquidità, coorte). Chiudi Excel sul workbook dati."
                  : "Full weekly orchestrator (SEC 8-K, liquidity, cohort). Close Excel on the data workbook."}
              </p>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs disabled:opacity-40"
                  disabled={apiOffline}
                  onClick={() => { void startSundayRefresh(); }}
                  title={apiOffline ? t("refresh.btn.refreshData.offline") : undefined}
                >
                  {lang === "it" ? "Avvia domenica full" : "Start Sunday full"}
                </button>
              </div>
            </>
          )}

          {state === "idle" && !isSunday && (
            <>
              {apiOffline ? (
                <div className="rounded-lg border border-[rgb(var(--signal-down))]/45 bg-[rgb(var(--signal-down))]/8 px-3 py-2.5 text-xs space-y-1.5">
                  <p className="font-semibold text-[rgb(var(--signal-down))]">
                    {t("refresh.modal.apiOffline.title")}
                  </p>
                  <p className="text-ink-muted leading-snug">{t("refresh.modal.apiOffline.body")}</p>
                  <p className="text-[10px] text-ink-muted/80 leading-snug">
                    {t("refresh.modal.apiOffline.reloadHint")}
                  </p>
                </div>
              ) : null}
              <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 text-xs space-y-3">
                <div>
                  <p className="font-semibold text-ink">
                    Phase 1/3 · Simulation + Accuracy refresh <span className="text-ink-muted font-normal">(~15–25 min)</span>
                  </p>
                  <ul className="space-y-1 text-ink-muted mt-1">
                    <li>
                      <span className="text-accent font-semibold">i.</span> Fresh prices (Yahoo Finance + Finnhub)
                      for all Simulation tickers.
                    </li>
                    <li>
                      <span className="text-accent font-semibold">ii.</span> Recalibrates predictive curves
                      (<code>model_d5</code>, <code>model_d20</code>, <code>slope_5d/20d/45d</code>,{" "}
                      <code>run_up_30d</code>).
                    </li>
                    <li>
                      <span className="text-accent font-semibold">iii.</span> Detects new catalysts that entered
                      the <span className="text-ink">≤ 60 d from CD</span> window with initial prediction.
                    </li>
                    <li>
                      <span className="text-accent font-semibold">iv.</span> Updates slope stability metrics
                      (<code>slope_consistency</code>, <code>rotation_flag</code>,{" "}
                      <code>persistence_window_days</code>).
                    </li>
                  </ul>
                </div>

                <div>
                  <p className="font-semibold text-ink">
                    Phase 2/3 · UI snapshot export <span className="text-ink-muted font-normal">(~30 s)</span>
                  </p>
                  <p className="text-ink-muted mt-0.5">
                    Regenerates the <code>*_snapshot.json</code> files in <code>data/</code> from which the UI reads
                    Simulation/Accuracy/Clinical/SecK8/Financial.
                  </p>
                </div>

                <div>
                  <p className="font-semibold text-ink">
                    Phase 3/3 · Directional KPIs + Model learnings <span className="text-ink-muted font-normal">(~5–8 min)</span>
                  </p>
                  <ul className="space-y-1 text-ink-muted mt-1">
                    <li>
                      <code>_build_directional_calibration.py</code> → updates Raw/Useful/Strong KPIs
                      of the <span className="text-ink">Predictive Diagnostics</span> tab.
                    </li>
                    <li>
                      <code>investment_decision_cohort.py</code> → feeds the{" "}
                      <span className="text-ink">Model learnings</span> tab of Model analysis.
                    </li>
                  </ul>
                </div>

                <p className="text-[10px] text-ink-muted/70 pt-1 border-t border-[rgb(var(--border))]/30">
                  <span className="text-ink">Incremental</span> end-to-end pipeline (~20–40 min total):
                  downloads only missing prices (<code>HISTLIB_INCREMENTAL_ONLY=1</code>) and preserves{" "}
                  <span className="text-ink">Prezzo acquisto</span> /{" "}
                  <span className="text-ink">Capitale</span> in Simulation
                  (<code>SIM_PRESERVE_OUTCOMES=1</code>). Close Excel before proceeding.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs disabled:opacity-40"
                  disabled={apiOffline}
                  onClick={() => { void startRefresh(); }}
                  title={apiOffline ? t("refresh.btn.refreshData.offline") : undefined}
                >
                  Start refresh
                </button>
              </div>
            </>
          )}

          {(state === "starting" || state === "running" || state === "exporting" || state === "post-pipeline") && (
            <>
              <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="flex items-center gap-2 font-semibold text-accent">
                    {isSunday ? (
                      <AntiqueClockIcon size={18} ticking />
                    ) : (
                    <span className="inline-block text-base animate-spin" aria-hidden>⏳</span>
                    )}
                    {isSunday
                      ? state === "starting"
                        ? "Orchestrator · Starting…"
                        : state === "running"
                          ? "Orchestrator · Weekly full pipeline"
                          : "Orchestrator · UI snapshot export"
                      : state === "starting"
                      ? "Phase 1/3 · Starting data refresh…"
                      : state === "running"
                        ? "Phase 1/3 · Simulation + Accuracy refresh"
                        : state === "exporting"
                          ? "Phase 2/3 · UI snapshot regeneration"
                            : "Phase 3/3 · Directional KPIs + Model learnings"}
                  </span>
                  <span className="text-ink-muted tabular-nums">
                    {isSunday ? "🕰" : "⏳"} elapsed {fmtElapsed(elapsedSec)}
                    {!isSunday &&
                      (state === "running" || state === "starting"
                      ? ` · ETA remaining ~${Math.max(0, 25 - Math.floor(elapsedSec / 60))} min`
                      : state === "post-pipeline"
                        ? ` · ETA remaining ~${Math.max(0, 6 - Math.floor(elapsedSec / 60))} min`
                          : "")}
                    {isSunday && (state === "running" || state === "starting")
                      ? " · ETA ~30–90+ min"
                        : ""}
                  </span>
                </div>
                <p className="text-ink-muted">{message || "Waiting for updates…"}</p>
                {updatedAt && (
                  <p className="text-[10px] text-ink-muted/70 mt-1">Last status update: {updatedAt}</p>
                )}
                {state === "exporting" && (
                  <p className="text-[10px] text-ink-muted/70 mt-1">
                    Exporting Simulation/Accuracy/Clinical/SecK8/Financial as JSON to data/ …
                  </p>
                )}
                {state === "post-pipeline" && (
                  <p className="text-[10px] text-ink-muted/70 mt-1">
                    Recomputing directional KPIs (Raw/Useful/Strong) of Predictive Diagnostics +
                    Model learnings tab of Model analysis.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                  Live log (tail)
                </p>
                <pre className="text-[10px] leading-tight font-mono bg-[rgb(var(--surface-3))]/30 border border-[rgb(var(--border))]/30 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap">
                  {logTail || "(waiting for output…)"}
                </pre>
              </div>
              <p className="text-[10px] text-ink-muted/70">
                You can close this panel: the refresh continues in the background. The status remains visible
                under the "Reload" button.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={onClose}
                >
                  Hide panel
                </button>
              </div>
            </>
          )}

          {state === "ok" && (
            <>
              <div className="rounded-lg border border-positive/50 bg-positive/10 p-3 text-xs">
                <p className="font-semibold text-positive">✓ Refresh completed in {fmtElapsed(elapsedSec)}</p>
                <p className="text-ink-muted mt-1">{message}</p>
              </div>
              <p className="text-xs text-ink-muted">
                Local snapshots have been regenerated. The Decision Lab and Active Signals panels
                will be reloaded automatically on close.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={onClose}
                >
                  Close and reload
                </button>
              </div>
            </>
          )}

          {state === "error" && (
            <>
              <div className="rounded-lg border border-negative/50 bg-negative/10 p-3 text-xs">
                <p className="font-semibold text-negative">✗ Error</p>
                <p className="text-ink-muted mt-1">{message}</p>
              </div>
              {logTail && (
                <div>
                  <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide mb-1">
                    Latest log
                  </p>
                  <pre className="text-[10px] leading-tight font-mono bg-[rgb(var(--surface-3))]/30 border border-[rgb(var(--border))]/30 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                    {logTail}
                  </pre>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setState("idle")}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export type InvestmentDecisionLabViewProps = {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError?: string | null;
  onReloadSimulation?: () => void | Promise<SheetTable | null | undefined>;
  onOpenCatalystFeed?: () => void;
  onOpenSlopeErrorCharts?: (ticker?: string) => void;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  focusSignal?: { ticker: string; cd?: string } | null;
  onFocusSignalConsumed?: () => void;
  monitorFocus?: SimulationNavFocus | null;
  onMonitorFocusConsumed?: () => void;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  /** Open a specific sub-tab when navigating back from Simulation screen. */
  initialTab?: DecisionLabTab | "portfolio" | null;
  onInitialTabConsumed?: () => void;
  /** Apri tab SuperNova con ticker selezionato (navigazione da Dashboard/Simulation). */
  sdsFocusTicker?: string | null;
  onSdsFocusConsumed?: () => void;
};

export function InvestmentDecisionLabView({
  simTable,
  simLoading,
  simError,
  onReloadSimulation,
  onOpenCatalystFeed: _onOpenCatalystFeed,
  onOpenSlopeErrorCharts,
  onOpenPredictionCharts,
  focusSignal,
  onFocusSignalConsumed,
  monitorFocus,
  onMonitorFocusConsumed,
  onOpenSimulationRow: _onOpenSimulationRow,
  initialTab,
  onInitialTabConsumed,
  sdsFocusTicker,
  onSdsFocusConsumed,
}: InvestmentDecisionLabViewProps) {
  const t = useT();
  const { apiOk } = useRefreshStatus();
  const [labTab, setLabTab] = useState<LabTab>("monitor");
  const [sdsMonitorFocus, setSdsMonitorFocus] = useState<SimulationNavFocus | null>(null);
  const [sdsTabFocusTicker, setSdsTabFocusTicker] = useState<string | null>(null);
  const [signalsReloadToken, setSignalsReloadToken] = useState(0);
  const [labReloadToken, setLabReloadToken] = useState(0);
  const [labRefreshing, setLabRefreshing] = useState(false);
  const investInputs = useInvestSimInputs(simTable, signalsReloadToken);
  const [labChartsBundle, setLabChartsBundle] = useState<
    Awaited<ReturnType<typeof loadSimulationChartsBundle>>["bundle"] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void loadSimulationChartsBundle().then(({ bundle }) => {
      if (!cancelled) setLabChartsBundle(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [simTable?.rows?.length, labReloadToken]);

  const labChartsBySeriesKey = useMemo(() => {
    const m = new Map<string, ChartPoint[]>();
    if (!simTable?.rows?.length || !labChartsBundle?.series) return m;
    for (const row of simTable.rows) {
      const sk = simulationRowSeriesKey(row);
      if (!sk) continue;
      const pts = labChartsBundle.series[sk]?.points;
      if (pts?.length) m.set(sk, pts);
    }
    return m;
  }, [simTable, labChartsBundle]);

  const labSimChartsByTicker = useMemo(() => {
    const m = new Map<string, { row: Record<string, unknown>; points: ChartPoint[] }>();
    if (!simTable?.rows?.length) return m;
    for (const row of simTable.rows) {
      const sk = simulationRowSeriesKey(row);
      if (!sk) continue;
      const pts = labChartsBySeriesKey.get(sk);
      if (!pts?.length) continue;
      const tk = String(row.Ticker ?? row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (tk) m.set(tk, { row, points: pts });
    }
    return m;
  }, [simTable, labChartsBySeriesKey]);

  useEffect(() => {
    if (!initialTab || initialTab === "portfolio") return;
    setLabTab(initialTab);
    onInitialTabConsumed?.();
  }, [initialTab, onInitialTabConsumed]);

  useEffect(() => {
    const tk = sdsFocusTicker?.trim().toUpperCase();
    if (!tk) return;
    setLabTab("sds");
    setSdsTabFocusTicker(tk);
    onSdsFocusConsumed?.();
  }, [sdsFocusTicker, onSdsFocusConsumed]);

  const handleOpenSupernovaScreen = useCallback((ticker?: string) => {
    setLabTab("sds");
    const tk = ticker?.trim().toUpperCase();
    setSdsTabFocusTicker(tk || null);
  }, []);

  useEffect(() => {
    if (focusSignal || monitorFocus || sdsMonitorFocus) setLabTab("monitor");
  }, [focusSignal, monitorFocus, sdsMonitorFocus]);

  const handleOpenSimulationTabRow = useCallback((focus: SimulationNavFocus) => {
    setLabTab("monitor");
    setSdsMonitorFocus({
      ticker: focus.ticker?.trim().toUpperCase(),
      cd: focus.cd?.trim() || undefined,
      action: focus.action,
    });
  }, []);

  const effectiveMonitorFocus = useMemo((): SimulationNavFocus | null => {
    if (monitorFocus) return monitorFocus;
    if (sdsMonitorFocus) return sdsMonitorFocus;
    if (!focusSignal?.ticker?.trim()) return null;
    return {
      ticker: focusSignal.ticker.trim().toUpperCase(),
      cd: focusSignal.cd?.trim() || undefined,
    };
  }, [monitorFocus, sdsMonitorFocus, focusSignal]);

  // investInputs syncs via useInvestSimInputs INVEST_SIM_INPUTS_CHANGED listener;
  // do not bump signalsReloadToken on every capital edit (triggers disk hydrate + UI freeze).

  const handleManualReload = useCallback(async () => {
    setLabRefreshing(true);
    try {
      const reloadedTable =
        (await Promise.resolve(onReloadSimulation?.())) ?? simTable;
      invalidateSimulationChartsCache();
      const { bundle } = await loadSimulationChartsBundle();
      setLabChartsBundle(bundle);
      const table = reloadedTable ?? simTable;
      if (table?.rows?.length) {
        const chartMap = new Map<string, ChartPoint[]>();
        for (const row of table.rows) {
          const sk = simulationRowSeriesKey(row);
          if (!sk) continue;
          const pts = bundle?.series?.[sk]?.points;
          if (pts?.length) chartMap.set(sk, pts);
        }
        publishDashboardRecommendationsFromSimulation(
          table,
          investInputs,
          chartMap.size > 0 ? chartMap : undefined,
          { forceTimestamp: true },
        );
      }
      setSignalsReloadToken((n) => n + 1);
      setLabReloadToken((n) => n + 1);
      if (apiOk) {
        void triggerLiveSignalsRefresh(60).catch(() => {});
      }
    } finally {
      markReloadCompleted();
      setLabRefreshing(false);
    }
  }, [apiOk, onReloadSimulation, simTable, investInputs]);

  return (
    <section
      className={`card decision-lab-view flex flex-col flex-1 min-w-0`}
    >
      <div className="sticky top-0 z-10 shrink-0 flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 bg-[rgb(var(--panel-lab-shell-bg))]">
        <div className="flex-1 min-w-[220px] max-w-3xl">
          <h2 className="text-lg font-semibold">{t("decisionLab.title")}</h2>
          <p className="text-xs text-ink-muted">
            {labTab === "sds"
              ? t("decisionLab.subtitle.sds")
              : labTab === "builder"
                ? "Build optimal portfolios with rebalancing & simulation"
                : t("decisionLab.subtitle.monitor")}
          </p>
        </div>
        {labTab !== "monitor" ? (
          <button
            type="button"
            className="btn-ghost text-[11px] font-semibold shrink-0 border border-[rgb(var(--border))]/50"
            title={t("decisionLab.nav.openSimulationTip")}
            onClick={() => setLabTab("monitor")}
          >
            {t("decisionLab.nav.openSimulation")}
          </button>
        ) : null}
        <div className="flex gap-0.5 p-0.5 rounded-md seg-toggle-track sim-workspace-toolbar">
          {(
            [
              ["monitor", t("decisionLab.tab.monitor")],
              ["sds", t("decisionLab.tab.sds")],
              ["builder", "Portfolio Builder"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded px-2.5 py-1 text-[10px] font-medium transition ${
                labTab === id ? "seg-btn-active" : "seg-btn"
              }`}
              onClick={() => setLabTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <RefreshControls
            onRefresh={handleManualReload}
            loading={simLoading || labRefreshing}
            tooltip={t("refresh.page.decisionLab.tooltip")}
            extraInfo={
              simTable?.rows?.length
                ? t("decisionLab.extra.simRows", { n: simTable.rows.length })
                : undefined
            }
          />
        </div>
      </div>


      <div className="flex flex-col flex-1 relative bg-[rgb(var(--panel-lab-shell-bg))]">
        {labTab === "sds" ? (
          <div className="flex flex-col flex-1 bg-[rgb(var(--panel-lab-shell-bg))]">
            <ViewErrorBoundary label="SuperNova">
              <SupernovaDistanceScoreView
                simChartsByTicker={labSimChartsByTicker}
                investInputs={investInputs}
                simTableColumns={simTable?.columns}
                onOpenSimulationRow={handleOpenSimulationTabRow}
                focusTicker={sdsTabFocusTicker}
                onFocusTickerConsumed={() => setSdsTabFocusTicker(null)}
                parentReloadToken={labReloadToken}
              />
            </ViewErrorBoundary>
          </div>
        ) : null}
        {labTab === "monitor" ? (
          <div className="flex flex-col flex-1 bg-[rgb(var(--panel-lab-shell-bg))]">
            <ViewErrorBoundary label="CD opportunities">
              <InvestmentSimulationView
                embedMode="decisionLab"
                simTable={simTable}
                simLoading={simLoading}
                simError={simError ?? null}
                onReloadSimulation={onReloadSimulation ?? (() => {})}
                parentReloadToken={labReloadToken}
                onOpenPredictionCharts={onOpenPredictionCharts ?? (() => {})}
                onOpenSlopeCharts={onOpenSlopeErrorCharts}
                focusTicker={effectiveMonitorFocus}
                onFocusConsumed={() => {
                  setSdsMonitorFocus(null);
                  onMonitorFocusConsumed?.();
                  onFocusSignalConsumed?.();
                }}
                onOpenSimulationRow={handleOpenSimulationTabRow}
                onOpenSupernovaScreen={handleOpenSupernovaScreen}
              />
            </ViewErrorBoundary>
          </div>
        ) : null}
        {labTab === "builder" ? (
          <div className="flex flex-col flex-1 bg-[rgb(var(--panel-lab-shell-bg))]">
            <ViewErrorBoundary label="Portfolio Builder">
              <Suspense
                fallback={
                  <p className="px-4 py-8 text-sm text-ink-muted">Loading Portfolio Builder...</p>
                }
              >
                <PortfolioBuilderLabView
                  simTable={simTable}
                  investInputs={investInputs}
                  pointsBySeriesKey={labChartsBySeriesKey}
                />
              </Suspense>
            </ViewErrorBoundary>
          </div>
        ) : null}
      </div>

    </section>
  );
}
