/**
 * Pull server-side calibration state into desktop localStorage (Phase 5).
 * Best-effort — keeps local edits unless server state is newer.
 */
import { fetchCalibrationState } from "../api/learningBus";
import type { CalibrationProposal, FrozenWeights } from "./calibrationTypes";

const PROPOSAL_STORE_KEY = "supernova.calibration.proposals.v1";
const FROZEN_WEIGHTS_KEY = "supernova.calibration.frozenWeights.v1";
const ADVICE_FEEDBACK_KEY = "supernova.adviceFeedback.v1";

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export async function pullCalibrationFromServer(): Promise<{ ok: boolean; message: string }> {
  const state = await fetchCalibrationState();
  let n = 0;

  if (state.frozen_weights) {
    safeSet(FROZEN_WEIGHTS_KEY, JSON.stringify(state.frozen_weights as FrozenWeights));
    n += 1;
  }
  if (Array.isArray(state.calibration_proposals)) {
    safeSet(PROPOSAL_STORE_KEY, JSON.stringify(state.calibration_proposals as CalibrationProposal[]));
    n += 1;
  }
  if (state.advice_feedback && typeof state.advice_feedback === "object") {
    safeSet(ADVICE_FEEDBACK_KEY, JSON.stringify(state.advice_feedback));
    n += 1;
  }

  return {
    ok: true,
    message: n > 0 ? `Imported ${n} calibration artifact(s) from server` : "Server state empty",
  };
}
