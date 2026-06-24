/**
 * Solidità ingresso — allineamento direzionale = componente Align dello Score Reliability.
 * Non usa precat_avoid (slope≤0 binario): stessa logica di computeScoreBreakdown.
 */
import type { Top2PickSignal } from "./top2PortfolioPick";
import type { StrictTopOppOpts } from "./topOppsStrictPick";
import { pickScoreBreakdown } from "./entrySolidityReliability";

/** Soglia blocco: Align < 0 = contrarian (come nel composito score). */
export const ALIGN_SOLIDITY_MIN = 0;

export function alignSolidityPoints(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): number | null {
  const b = pickScoreBreakdown(s, opts);
  if (!b) return null;
  return b.slopeAlign;
}

export function passesAlignForSolidity(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): boolean {
  const pts = alignSolidityPoints(s, opts);
  if (pts == null) return true;
  return pts >= ALIGN_SOLIDITY_MIN;
}

export function appendAlignSolidityFailures(
  out: { code: string; detail?: string }[],
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): void {
  const b = pickScoreBreakdown(s, opts);
  if (!b) return;
  if (b.slopeAlign < ALIGN_SOLIDITY_MIN) {
    out.push({
      code: "align_contrarian",
      detail: `${b.slopeAlign.toFixed(1)} · ${b.slopeAlignLabel}`,
    });
  }
}
