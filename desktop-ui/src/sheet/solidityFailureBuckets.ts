/**
 * Raggruppa failure solidità ingresso per il modal analisi.
 */
import { isWatchZone } from "./cdHorizons";
import type { StrictPickFailure } from "./topOppsStrictPick";

export type SolidityFailureBucket = "expected" | "monitor" | "block";

const BLOCK_CODES = new Set<StrictPickFailure["code"]>([
  "macro_gate_hold",
  "macro_gate_avoid",
  "align_contrarian",
  "precat_sell",
  "timing_binary",
  "sds_veto",
  "sds_low_confidence",
  "sds_below_hot",
]);

export function bucketSolidityFailure(
  f: StrictPickFailure,
  daysToCd?: number | null,
): SolidityFailureBucket {
  if (f.code === "timing_beyond_hot" && isWatchZone(daysToCd)) {
    return "expected";
  }
  if (BLOCK_CODES.has(f.code)) return "block";
  return "monitor";
}

export function groupSolidityFailures(
  failures: StrictPickFailure[],
  daysToCd?: number | null,
): Record<SolidityFailureBucket, StrictPickFailure[]> {
  const out: Record<SolidityFailureBucket, StrictPickFailure[]> = {
    expected: [],
    monitor: [],
    block: [],
  };
  for (const f of failures) {
    out[bucketSolidityFailure(f, daysToCd)].push(f);
  }
  return out;
}

export function isSolidityHardFailureCode(code: StrictPickFailure["code"]): boolean {
  return BLOCK_CODES.has(code);
}
