/**
 * Sizing Rules.
 *
 * Reads ONLY approved weights (from FrozenWeights). Computes a suggested
 * size for ONE new opportunity, with full decomposition for UI.
 *
 * Order of operations (per brief):
 *   1. Confidence-weighted blending of dimension weights → ideal multiplier
 *   2. Diversification caps applied AFTER ideal multiplier
 *   3. Absolute floor/cap clamps
 *   4. Return SizingDecision with full breakdown (no opaque number)
 *
 * Never consults the live shrinkage engine — only frozen weights — so that
 * a "pending" proposal cannot accidentally leak into sizing.
 */
import {
  type CalibrationDimension,
  type ConfidenceLevel,
  type FrozenWeights,
  type SizingDecision,
} from "./calibrationTypes";

export type SizingInput = {
  ticker: string;
  /** Cell label in each dimension for this opportunity. */
  cells: Record<CalibrationDimension, string>;
  /** Total capital available across the whole portfolio (EUR). */
  totalCapitalEur: number;
  /** Already-deployed capital, by indication, for diversification caps. */
  deployedByIndicationEur?: Record<string, number>;
  /** Already-deployed capital, by phase. */
  deployedByPhaseEur?: Record<string, number>;
  /** Number of open positions (used for equal-weight baseline). */
  targetPositions: number;
};

export type SizingRulesConfig = {
  /** Maximum % of total capital on a single opportunity. */
  capPctSingle: number;
  /** Minimum % of total capital on a single opportunity (floor). */
  floorPctSingle: number;
  /** Maximum % of total capital concentrated in one therapeutic indication. */
  capPctByIndication: number;
  /** Maximum % of total capital concentrated in one clinical phase. */
  capPctByPhase: number;
  /** Attenuation factor applied to LOW-confidence dimensions. */
  lowConfidenceAttenuation: number;
  /** Attenuation factor applied to MEDIUM-confidence dimensions. */
  mediumConfidenceAttenuation: number;
  /** Neutral baseline win rate — used when a dim has no weight at all. */
  neutralWeight: number;
};

export const DEFAULT_SIZING_RULES_CONFIG: SizingRulesConfig = {
  // 25% per single opportunity: must be > 1/targetPositions to allow equal-weight baseline.
  capPctSingle: 0.25,
  floorPctSingle: 0.02,
  capPctByIndication: 0.4,
  capPctByPhase: 0.5,
  lowConfidenceAttenuation: 0.25,
  mediumConfidenceAttenuation: 0.6,
  neutralWeight: 0.5,
};

function attenuationForConfidence(
  c: ConfidenceLevel,
  cfg: SizingRulesConfig,
): number {
  if (c === "low") return cfg.lowConfidenceAttenuation;
  if (c === "medium") return cfg.mediumConfidenceAttenuation;
  return 1.0;
}

/**
 * Translate a calibrated win rate into a sizing multiplier vs neutral.
 *
 * weight = 0.5 (neutral) → multiplier 1.0
 * weight > 0.5 → multiplier > 1 (boost)
 * weight < 0.5 → multiplier < 1 (cut)
 *
 * Linear scaling around the neutral point, with bounded range to prevent
 * a single cell from completely zeroing or doubling the bet.
 */
function weightToMultiplier(weight: number, neutral: number): number {
  const delta = weight - neutral;
  // Linear: 1pp of edge → 2% size adjustment per dimension, bounded ±80%.
  // The bound is intentionally generous because attenuation by confidence
  // and absolute caps (capPctSingle) provide the real safety nets downstream.
  const raw = 1 + delta * 2;
  return Math.max(0.2, Math.min(1.8, raw));
}

/** Combined sizing multiplier from approved frozen weights (no caps). */
export function computeFrozenWeightMultiplier(
  cells: Record<CalibrationDimension, string>,
  frozen: FrozenWeights,
  cfg: SizingRulesConfig = DEFAULT_SIZING_RULES_CONFIG,
): number {
  let runningMultiplier = 1.0;
  const dimensions: CalibrationDimension[] = [
    "clinicalPhase",
    "clinicalIndication",
    "sdsBucket",
    "pplanBucket",
  ];

  for (const dim of dimensions) {
    const cell = cells[dim];
    const frozenEntry = frozen.weights[dim]?.[cell];
    if (!frozenEntry) continue;

    const idealMultiplier = weightToMultiplier(
      frozenEntry.weight,
      cfg.neutralWeight,
    );
    const attenuation = attenuationForConfidence(frozenEntry.confidence, cfg);
    const appliedMultiplier = 1.0 + (idealMultiplier - 1.0) * attenuation;
    runningMultiplier *= appliedMultiplier;
  }

  return runningMultiplier;
}

export function computeSizingDecision(
  input: SizingInput,
  frozen: FrozenWeights,
  cfg: SizingRulesConfig = DEFAULT_SIZING_RULES_CONFIG,
): SizingDecision {
  const baselineEur =
    input.targetPositions > 0
      ? input.totalCapitalEur / input.targetPositions
      : input.totalCapitalEur;

  const contributions: SizingDecision["contributions"] = [];
  let runningMultiplier = 1.0;

  const dimensions: CalibrationDimension[] = [
    "clinicalPhase",
    "clinicalIndication",
    "sdsBucket",
    "pplanBucket",
  ];

  for (const dim of dimensions) {
    const cell = input.cells[dim];
    const frozenEntry = frozen.weights[dim]?.[cell];

    if (!frozenEntry) {
      contributions.push({
        dimension: dim,
        cell,
        weight: cfg.neutralWeight,
        n: 0,
        confidence: "low",
        appliedMultiplier: 1.0,
        deltaEur: 0,
        note: "Nessun peso approvato per questa cella → neutro 1.0×",
      });
      continue;
    }

    const idealMultiplier = weightToMultiplier(
      frozenEntry.weight,
      cfg.neutralWeight,
    );
    const attenuation = attenuationForConfidence(frozenEntry.confidence, cfg);
    // Attenuated multiplier: interpolate between 1.0 (neutral) and ideal.
    const appliedMultiplier = 1.0 + (idealMultiplier - 1.0) * attenuation;
    const beforeEur = baselineEur * runningMultiplier;
    runningMultiplier *= appliedMultiplier;
    const afterEur = baselineEur * runningMultiplier;
    const deltaEur = afterEur - beforeEur;

    const confTag =
      frozenEntry.confidence === "low"
        ? `LOW (attenuato ×${attenuation.toFixed(2)})`
        : frozenEntry.confidence === "medium"
          ? `MEDIUM (attenuato ×${attenuation.toFixed(2)})`
          : "HIGH (pieno peso)";

    contributions.push({
      dimension: dim,
      cell,
      weight: frozenEntry.weight,
      n: frozenEntry.n,
      confidence: frozenEntry.confidence,
      appliedMultiplier,
      deltaEur,
      note: `Win rate ${(frozenEntry.weight * 100).toFixed(1)}% · n=${frozenEntry.n} · ${confTag}`,
    });
  }

  let idealSizeEur = baselineEur * runningMultiplier;

  // ── Diversification caps ─────────────────────────────────────────────
  const capsTriggered: SizingDecision["capsTriggered"] = [];

  // By indication
  const indicationDeployed =
    input.deployedByIndicationEur?.[input.cells.clinicalIndication] ?? 0;
  const indicationCapEur = input.totalCapitalEur * cfg.capPctByIndication;
  const indicationHeadroom = Math.max(
    0,
    indicationCapEur - indicationDeployed,
  );
  if (idealSizeEur > indicationHeadroom) {
    capsTriggered.push({
      capName: `Cap indicazione (${(cfg.capPctByIndication * 100).toFixed(0)}% capitale)`,
      triggered: true,
      note: `Indicazione "${input.cells.clinicalIndication}": già deployati ${indicationDeployed.toFixed(0)}€ → headroom ${indicationHeadroom.toFixed(0)}€`,
    });
    idealSizeEur = indicationHeadroom;
  } else {
    capsTriggered.push({
      capName: `Cap indicazione (${(cfg.capPctByIndication * 100).toFixed(0)}% capitale)`,
      triggered: false,
      note: `OK · headroom ${indicationHeadroom.toFixed(0)}€`,
    });
  }

  // By phase
  const phaseDeployed =
    input.deployedByPhaseEur?.[input.cells.clinicalPhase] ?? 0;
  const phaseCapEur = input.totalCapitalEur * cfg.capPctByPhase;
  const phaseHeadroom = Math.max(0, phaseCapEur - phaseDeployed);
  if (idealSizeEur > phaseHeadroom) {
    capsTriggered.push({
      capName: `Cap fase (${(cfg.capPctByPhase * 100).toFixed(0)}% capitale)`,
      triggered: true,
      note: `Fase "${input.cells.clinicalPhase}": già deployati ${phaseDeployed.toFixed(0)}€ → headroom ${phaseHeadroom.toFixed(0)}€`,
    });
    idealSizeEur = phaseHeadroom;
  } else {
    capsTriggered.push({
      capName: `Cap fase (${(cfg.capPctByPhase * 100).toFixed(0)}% capitale)`,
      triggered: false,
      note: `OK · headroom ${phaseHeadroom.toFixed(0)}€`,
    });
  }

  // ── Floor / cap absolute clamps ──────────────────────────────────────
  const floorEur = input.totalCapitalEur * cfg.floorPctSingle;
  const capEur = input.totalCapitalEur * cfg.capPctSingle;

  let finalSize = idealSizeEur;
  const clampedToCap = finalSize > capEur;
  if (clampedToCap) finalSize = capEur;
  const clampedToFloor = finalSize < floorEur;
  if (clampedToFloor) finalSize = floorEur;
  // Final guard: never propose more than available.
  if (finalSize > input.totalCapitalEur) finalSize = input.totalCapitalEur;
  if (finalSize < 0) finalSize = 0;

  return {
    ticker: input.ticker,
    sizeEur: finalSize,
    sizeFraction:
      input.totalCapitalEur > 0 ? finalSize / input.totalCapitalEur : 0,
    baselineEur,
    contributions,
    capsTriggered,
    clamps: {
      floorEur,
      capEur,
      clampedToFloor,
      clampedToCap,
    },
  };
}
