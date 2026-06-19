/**
 * Entry solidity — when a Simulation row looks investable but fails strict / macro gate.
 */
import type { Top2PickSignal } from "./top2PortfolioPick";
import { isWatchZone } from "./cdHorizons";
import {
  entryTimingSolidityLabel,
  entryTimingSolidityPoints,
} from "./entrySolidityTiming";
import { reliabilitySoliditySummary } from "./entrySolidityReliability";
import {
  computeEntrySolidityComposite,
  type EntrySolidityComposite,
} from "./entrySolidityComposite";
import { applyPriceAlignedComposite, loadLiveRaPolarities } from "./rascorePolarityStore";
import {
  passesStrictTopPick,
  strictPickFailureReasons,
  type StrictPickFailure,
  type StrictTopOppOpts,
} from "./topOppsStrictPick";

export type SimulationSolidityLevel = "ok" | "caution" | "blocked";

export type SimulationSolidityResult = {
  level: SimulationSolidityLevel;
  failures: StrictPickFailure[];
  /** Sub-indice timing ingresso −2…+10 (solo solidità, non Score Reliability). */
  timingIndex: number | null;
  timingLabel: string | null;
  /** Score Reliability 0–100 — stesso composito del Decision Lab. */
  reliabilityScore: number | null;
  reliabilityLabel: string | null;
  /** Score composito solidità ingresso 0–100 (torta UI). */
  composite: EntrySolidityComposite;
  /** Raw precat before macro gate (enter/accumulate/…). */
  originalPrecatKind: string | null;
  gatedPrecatKind: string | null;
  macroGateFired: boolean;
  gateReason: string | null;
};

function entryLikeOriginal(pick: Top2PickSignal): boolean {
  const k = pick.precatOriginalKind ?? pick.precatKind;
  return k === "enter" || k === "accumulate";
}

function shouldSurfaceSolidityWarning(
  pick: Top2PickSignal,
  failures: StrictPickFailure[],
): boolean {
  if (pick.hasPosition) return false;
  if (failures.length === 0) return false;

  /** Watch CD (61–120d): show badge for every strict-pick failure — list is monitor-only. */
  if (isWatchZone(pick.days)) return true;

  const macro = pick.marketGate?.regime_gate_fired === true;
  const entryLike = entryLikeOriginal(pick);
  const hasTarget =
    pick.planReturnPct != null && Number.isFinite(pick.planReturnPct) && pick.planReturnPct > 0;

  return macro || entryLike || hasTarget;
}

function solidityLevel(
  failures: StrictPickFailure[],
  macroGateFired: boolean,
  daysToCd?: number | null,
): SimulationSolidityLevel {
  const hard = new Set([
    "macro_gate_hold",
    "macro_gate_avoid",
    "align_contrarian",
    "precat_sell",
    "timing_binary",
    "sds_veto",
    "sds_low_confidence",
    "sds_below_hot",
    "sds_below_watch",
    "sds_unavailable",
  ]);
  /** In CD watch (61–120d): SDS gap is caution only, not hard block (C). */
  const softSdsInCdWatch = new Set(["sds_below_watch", "sds_unavailable"]);

  if (macroGateFired) return "blocked";

  for (const f of failures) {
    if (!hard.has(f.code)) continue;
    if (isWatchZone(daysToCd) && softSdsInCdWatch.has(f.code)) continue;
    return "blocked";
  }

  return failures.length > 0 ? "caution" : "ok";
}

export type SimulationSolidityMode = "entry" | "rascore";

export function resolveSimulationEntrySolidity(
  pick: Top2PickSignal | null | undefined,
  opts?: StrictTopOppOpts,
  lang: "it" | "en" = "it",
  mode: SimulationSolidityMode = "entry",
): SimulationSolidityResult | null {
  if (!pick) return null;
  if (mode === "entry" && pick.hasPosition) return null;

  const timingIndex = entryTimingSolidityPoints(pick.days);
  const timingLabel = entryTimingSolidityLabel(pick.days, lang);
  const rel = reliabilitySoliditySummary(pick, lang, opts);

  const allFailures = strictPickFailureReasons(pick, opts);
  const failures =
    mode === "rascore" && pick.hasPosition
      ? allFailures.filter((f) => f.code !== "has_position")
      : allFailures;
  const passed = mode === "rascore" ? false : passesStrictTopPick(pick, opts);
  const composite = computeEntrySolidityComposite(pick, failures, opts, lang);

  const alignedComposite =
    mode === "rascore"
      ? applyPriceAlignedComposite(composite, loadLiveRaPolarities())
      : composite;

  if (mode === "rascore") {
    const macroGateFired = pick.marketGate?.regime_gate_fired === true;
    return {
      level: solidityLevel(failures, macroGateFired, pick.days),
      failures,
      composite: alignedComposite,
      timingIndex,
      timingLabel,
      reliabilityScore: rel.score,
      reliabilityLabel: rel.line,
      originalPrecatKind: pick.precatOriginalKind ?? pick.precatKind ?? null,
      gatedPrecatKind: pick.precatKind ?? null,
      macroGateFired,
      gateReason: pick.marketGate?.gate_reason ?? null,
    };
  }

  if (passed) {
    return {
      level: "ok",
      failures: [],
      composite,
      timingIndex,
      timingLabel,
      reliabilityScore: rel.score,
      reliabilityLabel: rel.line,
      originalPrecatKind: pick.precatOriginalKind ?? pick.precatKind ?? null,
      gatedPrecatKind: pick.precatKind ?? null,
      macroGateFired: pick.marketGate?.regime_gate_fired === true,
      gateReason: pick.marketGate?.gate_reason ?? null,
    };
  }

  if (!shouldSurfaceSolidityWarning(pick, failures)) return null;

  const macroGateFired = pick.marketGate?.regime_gate_fired === true;
  return {
    level: solidityLevel(failures, macroGateFired, pick.days),
    failures,
    composite,
    timingIndex,
    timingLabel,
    reliabilityScore: rel.score,
    reliabilityLabel: rel.line,
    originalPrecatKind: pick.precatOriginalKind ?? pick.precatKind ?? null,
    gatedPrecatKind: pick.precatKind ?? null,
    macroGateFired,
    gateReason: pick.marketGate?.gate_reason ?? null,
  };
}

export function simulationSolidityVisible(
  result: SimulationSolidityResult | null | undefined,
): result is SimulationSolidityResult {
  return !!result;
}
