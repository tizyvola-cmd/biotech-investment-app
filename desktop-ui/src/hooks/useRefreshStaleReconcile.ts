import { useEffect } from "react";
import { fetchRefreshStatus } from "../api/supernova";
import {
  getRefreshSnapshot,
  isRefreshInFlight,
  makeRefreshLife,
  setRefreshLife,
} from "../shared/refreshStatusStore";

const POLL_MS = 20_000;

/**
 * Clears a stuck "Orchestrator …" badge when the API reports the subprocess
 * ended but the refresh modal was closed before lifecycle advanced.
 */
export function useRefreshStaleReconcile(apiOk: boolean | null): void {
  useEffect(() => {
    if (apiOk !== true) return;

    const tick = async () => {
      const { life } = getRefreshSnapshot();
      if (!isRefreshInFlight()) return;
      // WeeklyFull sul VPS: non riconciliare contro lo status refresh locale.
      if (life.fromServerWeeklyFull) return;
      try {
        const st = await fetchRefreshStatus();
        if (st.running) return;
        const ok = st.ok === "1" || st.state === "ok" || st.exit_code === 0;
        if (life.state === "running" || life.state === "starting") {
          setRefreshLife(
            makeRefreshLife({
              state: ok ? "exporting" : "error",
              elapsedSec: life.elapsedSec,
              message:
                st.message ||
                (ok
                  ? "Orchestrator completato — sincronizzazione snapshot…"
                  : "Refresh terminato con errori."),
              profile: st.profile === "sunday" ? "sunday" : life.profile,
            }),
          );
        }
        if (!ok && life.state !== "error") {
          setRefreshLife(
            makeRefreshLife({
              state: "error",
              elapsedSec: life.elapsedSec,
              message: st.message || "Refresh terminato con errori.",
              profile: life.profile,
            }),
          );
        }
      } catch {
        /* offline */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => window.clearInterval(id);
  }, [apiOk]);
}
