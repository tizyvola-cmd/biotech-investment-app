/**
 * What-if panel refresh (sheet-only wind table): live signals (Var. Giorn. %)
 * → caller reloads Simulation snapshot + book hydrate. No Yahoo hourly curves.
 */
import {
  triggerLiveSignalsRefresh,
  waitForLiveSignalsIdle,
} from "../api/supernova";

export type WhatIfPanelRefreshPhase =
  | "idle"
  | "live_signals"
  | "sheet"
  | "book"
  /** @deprecated Opzione 1: curves removed from wind table; kept for old callers. */
  | "curves";

/**
 * Kick off live-signals (with force_prices) and wait until the job finishes.
 * Caller then reloads the Simulation sheet and bumps book hydrate.
 */
export async function runWhatIfLiveSignalsForPanel(opts?: {
  cdHorizon?: number;
  timeoutMs?: number;
  onPhase?: (phase: WhatIfPanelRefreshPhase) => void;
}): Promise<{ ok: boolean; message?: string }> {
  const cdHorizon = opts?.cdHorizon ?? 90;
  opts?.onPhase?.("live_signals");
  try {
    const started = await triggerLiveSignalsRefresh(cdHorizon, { forcePrices: true });
    if (started?.error) {
      return { ok: false, message: started.error };
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
  try {
    const st = await waitForLiveSignalsIdle({ timeoutMs: opts?.timeoutMs ?? 90_000 });
    if (st.running) {
      return { ok: false, message: "Live signals still running (timeout)" };
    }
    if (st.ok === false && st.error) {
      return { ok: false, message: st.error };
    }
    return { ok: true, message: st.message };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
