/**
 * RA ingresso → segnale investimento (buy/hold/avoid/reduce) da soglie calibrate.
 * Complementare a Top2 / P(plan) — non sostituisce deriveSuggestedAction.
 */
import { tradeCalibThreshold } from "./investmentTradeCalib";
import {
  loadRascoreCalibrationSnapshots,
  type RascoreWeeklySnapshot,
} from "./rascoreCalibrationHistory";
import type { RascoreCalibrationQuality } from "./rascoreSignalImpactView";

export type RaEntryInvestVerdict = "buy" | "hold" | "avoid" | "reduce";

export type RaCalibrationThresholds = {
  investMinScore: number;
  divestBelowScore: number;
  tier: RascoreCalibrationQuality["tier"];
  source: "snapshot" | "default";
  snapshotWeek: string | null;
};

export type RaEntryInvestVerdictResult = {
  verdict: RaEntryInvestVerdict | null;
  confidence: "high" | "medium" | "low";
  thresholds: RaCalibrationThresholds;
  /** true when calibration tier forced a softer label */
  downgraded: boolean;
};

const DEFAULT_INVEST_MIN = tradeCalibThreshold("score_forte_min");
const DEFAULT_DIVEST_BELOW = tradeCalibThreshold("score_watch_min");

export function resolveRaCalibrationThresholds(): RaCalibrationThresholds {
  const snaps = loadRascoreCalibrationSnapshots();
  const latest: RascoreWeeklySnapshot | null =
    snaps.length > 0
      ? [...snaps].sort((a, b) => b.weekTs - a.weekTs)[0]!
      : null;

  if (latest?.investMinScore != null && Number.isFinite(latest.investMinScore)) {
    let investMin = Math.round(latest.investMinScore);
    
    // Se investMinScore > 70, probabilmente la calibrazione ha trovato troppo pochi campioni positivi
    // con RA alto → usa un fallback più ragionevole per evitare di filtrare tutto.
    if (investMin > 70) {
      investMin = Math.max(DEFAULT_INVEST_MIN, 65);
    }
    
    const divestBelow =
      investMin > DEFAULT_DIVEST_BELOW + 5
        ? Math.max(DEFAULT_DIVEST_BELOW, investMin - 15)
        : DEFAULT_DIVEST_BELOW;
    return {
      investMinScore: investMin,
      divestBelowScore: divestBelow,
      tier: latest.tier ?? "insufficient",
      source: "snapshot",
      snapshotWeek: latest.weekKey,
    };
  }

  return {
    investMinScore: DEFAULT_INVEST_MIN,
    divestBelowScore: DEFAULT_DIVEST_BELOW,
    tier: "insufficient",
    source: "default",
    snapshotWeek: null,
  };
}

function confidenceFromTier(tier: RascoreCalibrationQuality["tier"]): RaEntryInvestVerdictResult["confidence"] {
  if (tier === "strong") return "high";
  if (tier === "weak") return "medium";
  return "low";
}

/** Entry RA + soglie calibrate → segnale ingresso/uscita RA. */
export function deriveRaEntryInvestVerdict(args: {
  entryRa: number | null | undefined;
  hasPosition: boolean;
  thresholds?: RaCalibrationThresholds;
}): RaEntryInvestVerdictResult {
  const thresholds = args.thresholds ?? resolveRaCalibrationThresholds();
  const confidence = confidenceFromTier(thresholds.tier);

  if (args.entryRa == null || !Number.isFinite(args.entryRa)) {
    return { verdict: null, confidence, thresholds, downgraded: false };
  }

  const ra = args.entryRa;
  const { investMinScore, divestBelowScore } = thresholds;
  let verdict: RaEntryInvestVerdict;
  let downgraded = false;

  if (args.hasPosition) {
    if (ra <= divestBelowScore) verdict = "reduce";
    else if (ra >= investMinScore) verdict = "hold";
    else verdict = "hold";
  } else if (ra >= investMinScore) {
    verdict = "buy";
  } else if (ra <= divestBelowScore) {
    verdict = "avoid";
  } else {
    verdict = "hold";
  }

  // Downgrade solo se tier "inverted" (correlazione negativa effettiva).
  // "insufficient" significa solo pochi dati, non dati sbagliati — permetti acquisti con confidence bassa.
  if (
    thresholds.source === "snapshot" &&
    thresholds.tier === "inverted" &&
    verdict === "buy"
  ) {
    verdict = "hold";
    downgraded = true;
  }

  return { verdict, confidence, thresholds, downgraded };
}

export function raEntryVerdictLabel(
  verdict: RaEntryInvestVerdict | null,
  lang: "it" | "en",
): string {
  if (!verdict) return "—";
  const labels: Record<RaEntryInvestVerdict, { it: string; en: string }> = {
    buy: { it: "BUY", en: "BUY" },
    hold: { it: "HOLD", en: "HOLD" },
    avoid: { it: "EVITA", en: "AVOID" },
    reduce: { it: "RIDUCI", en: "REDUCE" },
  };
  return labels[verdict][lang];
}
