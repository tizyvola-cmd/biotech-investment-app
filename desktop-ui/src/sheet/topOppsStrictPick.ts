/**
 * Filtri strict Top Opps / solidità ingresso («Ha senso investire ORA?»).
 * Pred +5g non è più un gate — sorpassato (ROI target + timing + precat).
 * Stabilità pendenza: rimossa temporaneamente dalla solidità (Decision Lab invariato).
 */
import type { Top2PickSignal } from "./top2PortfolioPick";
import { isHotZone, isWatchZone } from "./cdHorizons";
import {
  getCachedSdsForTopOpps,
  sdsStrictPickFailures,
  type SdsGateInfo,
} from "./sdsTopOppGate";
import {
  appendReliabilitySolidityFailures,
  legacyMinAffidPctToScoreFloor,
  passesReliabilityForSolidity,
} from "./entrySolidityReliability";
import {
  appendAlignSolidityFailures,
  passesAlignForSolidity,
} from "./entrySolidityAlign";
import {
  entryTimingAllowsInvestNow,
  entryTimingSolidityFailures,
  replacesPrecatTooEarlyFailure,
} from "./entrySolidityTiming";
import type { MigSoliditySnapshot } from "./entrySolidityMig";
import type { SignalMetricsFromRowOptions } from "./investSignalScore";

export type StrictTopOppOpts = {
  /** @deprecated Ignorato — Pred +5 rimosso dalla solidità. */
  upsideThresholdPct?: number;
  /** @deprecated Ignorato — usa Score Reliability (``minScoreReliability``). */
  minAffidabilita?: number;
  /** Override soglia score 0–100; default da trade-calib per zona CD. */
  minScoreReliability?: number;
  /** SDS snapshot keyed by ticker — defaults to cached map from Decision Lab / Dashboard. */
  sdsByTicker?: Map<string, SdsGateInfo> | null;
  /** MII + Calib per ticker|cd — da tab Market Interest. */
  migByKey?: Map<string, MigSoliditySnapshot> | null;
  /** Stesse opzioni della colonna Affidabilità/Reliability in Simulation (sign curve, chart). */
  reliabilityMetricsOptions?: SignalMetricsFromRowOptions;
  /** Colonne foglio Simulation — preferite a Object.keys(simRow). */
  simColumns?: string[];
};

export type StrictPickFailureCode =
  | "has_position"
  | "cd_past"
  | "no_target_roi"
  | "macro_gate_hold"
  | "macro_gate_avoid"
  | "precat_hold"
  | "precat_avoid"
  | "align_contrarian"
  | "precat_sell"
  | "precat_late"
  | "precat_too_early"
  | "precat_other"
  | "timing_binary"
  | "timing_pre_peak"
  | "timing_beyond_hot"
  | "low_score_reliability"
  | "sds_veto"
  | "sds_low_confidence"
  | "sds_below_hot"
  | "sds_below_watch"
  | "sds_unavailable";

export type StrictPickFailure = {
  code: StrictPickFailureCode;
  detail?: string;
};

function sdsZoneForPick(s: Top2PickSignal): "hot" | "watch" | null {
  if (isHotZone(s.days)) return "hot";
  if (isWatchZone(s.days)) return "watch";
  return null;
}

function appendSdsFailures(
  out: StrictPickFailure[],
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): void {
  const zone = sdsZoneForPick(s);
  if (!zone) return;
  const map = opts?.sdsByTicker ?? getCachedSdsForTopOpps();
  out.push(...sdsStrictPickFailures(s.ticker, zone, map ?? undefined, s.days));
}

function resolveMinScoreReliability(opts?: StrictTopOppOpts): number | null {
  if (opts?.minScoreReliability != null && Number.isFinite(opts.minScoreReliability)) {
    return opts.minScoreReliability;
  }
  if (
    opts?.minAffidabilita != null &&
    Number.isFinite(opts.minAffidabilita) &&
    opts.minAffidabilita > 0
  ) {
    return legacyMinAffidPctToScoreFloor(opts.minAffidabilita);
  }
  return null;
}

/** Why a row fails strict top-pick (mirrors ``passesStrictTopPick``). */
export function strictPickFailureReasons(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): StrictPickFailure[] {
  const out: StrictPickFailure[] = [];
  const minScore = resolveMinScoreReliability(opts);

  if (s.hasPosition) out.push({ code: "has_position" });
  if (s.days != null && s.days < -3) out.push({ code: "cd_past" });

  if (s.planReturnPct == null || !Number.isFinite(s.planReturnPct) || s.planReturnPct <= 0) {
    out.push({ code: "no_target_roi" });
  }

  const pk = s.precatKind;
  if (pk === "hold") {
    if (s.marketGate?.regime_gate_fired) {
      out.push({
        code: "macro_gate_hold",
        detail: s.marketGate.gate_reason,
      });
    } else {
      out.push({ code: "precat_hold" });
    }
  } else if (pk === "avoid") {
    if (
      s.marketGate?.regime_gate_fired &&
      s.precatOriginalKind &&
      s.precatOriginalKind !== "avoid"
    ) {
      out.push({
        code: "macro_gate_avoid",
        detail: s.marketGate.gate_reason,
      });
    }
    // Direction: appendAlignSolidityFailures (Score Align) — not precat_avoid
  } else if (pk === "sell") {
    out.push({ code: "precat_sell" });
  } else if (pk === "late") {
    out.push({ code: "precat_late" });
  } else if (pk === "too_early") {
    if (!replacesPrecatTooEarlyFailure(s.days)) {
      out.push({ code: "precat_too_early" });
    }
  } else if (pk !== "enter" && pk !== "accumulate") {
    out.push({ code: "precat_other" });
  }

  appendReliabilitySolidityFailures(out, s, minScore, opts);
  appendAlignSolidityFailures(out, s, opts);

  appendSdsFailures(out, s, opts);
  out.push(...entryTimingSolidityFailures(s.days));

  return out;
}

export function passesStrictTopPick(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): boolean {
  if (s.hasPosition) return false;
  if (s.days != null && s.days < -3) return false;

  if (s.planReturnPct == null || !Number.isFinite(s.planReturnPct) || s.planReturnPct <= 0) {
    return false;
  }

  const pk = s.precatKind;
  if (pk === "sell" || pk === "late" || pk === "too_early" || pk === "hold") {
    return false;
  }
  if (
    pk === "avoid" &&
    s.marketGate?.regime_gate_fired &&
    s.precatOriginalKind &&
    s.precatOriginalKind !== "avoid"
  ) {
    return false;
  }
  if (pk !== "enter" && pk !== "accumulate" && pk !== "avoid") {
    return false;
  }

  if (!passesAlignForSolidity(s, opts)) {
    return false;
  }

  if (!entryTimingAllowsInvestNow(s.days)) {
    return false;
  }

  if (!passesReliabilityForSolidity(s, resolveMinScoreReliability(opts), opts)) {
    return false;
  }

  const sdsFails = (() => {
    const zone = sdsZoneForPick(s);
    if (!zone) return [];
    const map = opts?.sdsByTicker ?? getCachedSdsForTopOpps();
    return sdsStrictPickFailures(s.ticker, zone, map ?? undefined, s.days);
  })();
  if (sdsFails.length > 0) return false;

  return true;
}
