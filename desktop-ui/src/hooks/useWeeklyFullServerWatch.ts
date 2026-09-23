import { useEffect, useRef } from "react";
import { useLang } from "../shared/i18n";
import { fetchWeeklyFullStatus, type WeeklyFullServerStatus } from "../api/refresh";
import {
  acknowledgeWeeklyFullServerStatus,
  buildSundayResultFromServerStatus,
  isWeeklyFullActuallyRunning,
  isWeeklyFullCompletionNew,
  playWeeklyFullDoneBeep,
} from "../shared/weeklyFullServerWatch";
import {
  getRefreshSnapshot,
  makeRefreshLife,
  setRefreshLife,
  setWeeklyFullServerRunningOpen,
  showSundayRefreshResult,
  type SundayRefreshResult,
} from "../shared/refreshStatusStore";

const POLL_IDLE_MS = 45_000;
const POLL_RUNNING_MS = 15_000;

/**
 * Polls VPS WeeklyFull status (not local :8765).
 * Shows top-bar clock badge + running modal while orchestrator is active;
 * popup + beep when it finishes.
 *
 * Does NOT require local apiOk — WeeklyFull lives on the server.
 */
export function useWeeklyFullServerWatch(options: {
  /** Default true. Set false only to disable the watcher entirely. */
  enabled?: boolean;
  onServerCompleted?: (result: SundayRefreshResult) => void | Promise<void>;
}): void {
  const enabled = options.enabled !== false;
  const { onServerCompleted } = options;
  const { lang } = useLang();
  const langCode = lang === "it" ? "it" : "en";
  const handlingRef = useRef(false);
  const lastRunningRef = useRef(false);
  const seenRunningAtRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onServerCompleted);
  onCompleteRef.current = onServerCompleted;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let pollTimer: number | null = null;
    let tickTimer: number | null = null;

    const runningMessage =
      langCode === "it"
        ? "Orchestrator settimanale in corso sul server…"
        : "Weekly orchestrator running on the server…";

    const clearTickTimer = () => {
      if (tickTimer != null) {
        window.clearInterval(tickTimer);
        tickTimer = null;
      }
    };

    const pushRunningLife = (elapsedSec: number) => {
      setRefreshLife(
        makeRefreshLife({
          state: "running",
          elapsedSec,
          message: runningMessage,
          profile: "sunday",
          fromServerWeeklyFull: true,
        }),
      );
    };

    const startElapsedTicker = () => {
      clearTickTimer();
      tickTimer = window.setInterval(() => {
        if (seenRunningAtRef.current == null) return;
        const life = getRefreshSnapshot().life;
        if (!life.fromServerWeeklyFull || life.state !== "running") return;
        const elapsedSec = Math.max(
          0,
          Math.round((Date.now() - seenRunningAtRef.current) / 1000),
        );
        pushRunningLife(elapsedSec);
      }, 1000);
    };

    const applyRunningBadge = (status: WeeklyFullServerStatus) => {
      const running = isWeeklyFullActuallyRunning(status);
      if (running) {
        if (seenRunningAtRef.current == null) {
          seenRunningAtRef.current = Date.now();
          setWeeklyFullServerRunningOpen(true);
        }
        const elapsedSec = Math.max(
          0,
          Math.round((Date.now() - seenRunningAtRef.current) / 1000),
        );
        lastRunningRef.current = true;
        pushRunningLife(elapsedSec);
        startElapsedTicker();
        return;
      }

      clearTickTimer();
      seenRunningAtRef.current = null;
      if (lastRunningRef.current) {
        lastRunningRef.current = false;
        setWeeklyFullServerRunningOpen(false);
        const life = getRefreshSnapshot().life;
        if (life.fromServerWeeklyFull && life.state === "running") {
          setRefreshLife(
            makeRefreshLife({
              state: "idle",
              elapsedSec: 0,
              message: "",
              profile: "daily",
              fromServerWeeklyFull: false,
            }),
          );
        }
      }
    };

    const handleCompletion = async (status: WeeklyFullServerStatus) => {
      if (handlingRef.current || !isWeeklyFullCompletionNew(status)) return;
      const result = buildSundayResultFromServerStatus(status, langCode);
      if (!result) return;
      handlingRef.current = true;
      try {
        // Ack all finish timestamps up-front so a slow reload / remount cannot re-popup.
        acknowledgeWeeklyFullServerStatus(status);
        playWeeklyFullDoneBeep(result.success);
        showSundayRefreshResult(result);
        await onCompleteRef.current?.(result);
      } finally {
        handlingRef.current = false;
        lastRunningRef.current = false;
        seenRunningAtRef.current = null;
        clearTickTimer();
        setWeeklyFullServerRunningOpen(false);
        setRefreshLife(
          makeRefreshLife({
            state: "idle",
            elapsedSec: 0,
            message: "",
            profile: "daily",
            fromServerWeeklyFull: false,
          }),
        );
      }
    };

    const scheduleNext = (running: boolean) => {
      if (pollTimer != null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(
        () => void tick(),
        running ? POLL_RUNNING_MS : POLL_IDLE_MS,
      );
    };

    const tick = async () => {
      try {
        const status = await fetchWeeklyFullStatus();
        if (cancelled) return;
        applyRunningBadge(status);
        await handleCompletion(status);
        scheduleNext(isWeeklyFullActuallyRunning(status));
      } catch {
        if (!cancelled) scheduleNext(lastRunningRef.current);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (pollTimer != null) window.clearTimeout(pollTimer);
      clearTickTimer();
    };
  }, [enabled, langCode]);
}
