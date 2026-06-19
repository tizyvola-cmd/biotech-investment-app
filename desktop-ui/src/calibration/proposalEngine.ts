/**
 * Proposal Engine.
 *
 * Given a NEW snapshot and the currently-frozen weights, generate a
 * `CalibrationProposal` describing only the cells that changed in a
 * MEANINGFUL way:
 *
 *   - new cells that have data for the first time and pass the n floor
 *   - existing cells where the shrunk weight moved by more than `deltaEpsilon`
 *   - any cell whose CONFIDENCE LEVEL changed (low → medium → high), even if
 *     the numeric weight barely moved — this is the moment the dimension
 *     starts to "count more" in sizing and deserves explicit review
 *
 * The engine NEVER applies anything — it only produces a proposal object
 * and pushes it to the store with status="pending". The actual weight
 * update only happens when a human approves.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  type CalibrationDimension,
  type CalibrationProposal,
  type CalibrationSnapshot,
  type ConfidenceLevel,
  type FrozenWeights,
  type ProposalChange,
  type ShrinkageConfig,
  DEFAULT_SHRINKAGE_CONFIG,
} from "./calibrationTypes";
import { computeCalibrationSnapshot } from "./shrinkageEngine";
import {
  loadFrozenWeights,
  persistProposal,
  applyChangesToFrozenWeights,
  updateProposalStatus,
} from "./proposalStore";

/** Minimum absolute change in the shrunk weight to trigger a proposal entry. */
export const DEFAULT_DELTA_EPSILON = 0.02;

export type RationaleLang = "it" | "en";

export type ProposalGenerationOptions = {
  /** Trigger trade row_key, if known (null = manual recompute). */
  triggeredByTradeId?: string | null;
  /** Override config. */
  shrinkageConfig?: ShrinkageConfig;
  /** Override delta threshold. */
  deltaEpsilon?: number;
  /** Language used to format the human-readable rationale. Defaults to "en". */
  lang?: RationaleLang;
};

const DIM_LABEL_IT: Record<CalibrationDimension, string> = {
  clinicalPhase: "Fase clinica",
  clinicalIndication: "Indicazione",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};
const DIM_LABEL_EN: Record<CalibrationDimension, string> = {
  clinicalPhase: "Clinical phase",
  clinicalIndication: "Indication",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};

function confLabel(c: ConfidenceLevel): string {
  if (c === "high") return "HIGH";
  if (c === "medium") return "MEDIUM";
  return "LOW";
}

function generateRationale(
  args: {
    dimension: CalibrationDimension;
    cell: string;
    oldWeight: number | null;
    newWeight: number;
    oldN: number;
    newN: number;
    oldConfidence: ConfidenceLevel | null;
    newConfidence: ConfidenceLevel;
    confidenceChanged: boolean;
  },
  lang: RationaleLang = "en",
): string {
  const it = lang === "it";
  const dim = (it ? DIM_LABEL_IT : DIM_LABEL_EN)[args.dimension];
  const w = (v: number) => `${(v * 100).toFixed(1)}%`;
  const isFirstObservation = args.oldWeight == null;
  const pieces: string[] = [];

  if (isFirstObservation) {
    pieces.push(
      it
        ? `${dim} · ${args.cell}: prima osservazione, win rate iniziale (shrinkato) ${w(args.newWeight)} su n=${args.newN}.`
        : `${dim} · ${args.cell}: first observation, initial (shrunk) win rate ${w(args.newWeight)} on n=${args.newN}.`,
    );
  } else {
    const direction = args.newWeight > (args.oldWeight ?? 0)
      ? it ? "alzato" : "raised"
      : it ? "abbassato" : "lowered";
    const dPct = Math.abs(args.newWeight - (args.oldWeight ?? 0)) * 100;
    pieces.push(
      it
        ? `${dim} · ${args.cell}: win rate ${direction} da ${w(args.oldWeight ?? 0)} (n=${args.oldN}) a ${w(args.newWeight)} (n=${args.newN}) — Δ ${dPct.toFixed(1)}pp.`
        : `${dim} · ${args.cell}: win rate ${direction} from ${w(args.oldWeight ?? 0)} (n=${args.oldN}) to ${w(args.newWeight)} (n=${args.newN}) — Δ ${dPct.toFixed(1)}pp.`,
    );
  }

  if (args.confidenceChanged) {
    pieces.push(
      it
        ? `⚠️ Confidence passata da ${confLabel(args.oldConfidence ?? "low")} a ${confLabel(args.newConfidence)}: questa dimensione ora pesa di più nel sizing.`
        : `⚠️ Confidence changed from ${confLabel(args.oldConfidence ?? "low")} to ${confLabel(args.newConfidence)}: this dimension now carries more weight in sizing.`,
    );
  } else if (args.newConfidence === "low") {
    pieces.push(
      it
        ? `Confidence resta LOW (n=${args.newN}): sotto soglia per influenzare il sizing in modo significativo.`
        : `Confidence remains LOW (n=${args.newN}): below the threshold to meaningfully influence sizing.`,
    );
  }

  return pieces.join(" ");
}

/**
 * Compute the diff between a fresh snapshot and the current frozen weights.
 *
 * Returns the list of ProposalChange entries (never persisted by this fn).
 */
export function diffSnapshotVsFrozen(
  snapshot: CalibrationSnapshot,
  frozen: FrozenWeights,
  deltaEpsilon: number = DEFAULT_DELTA_EPSILON,
  lang: RationaleLang = "en",
): ProposalChange[] {
  const changes: ProposalChange[] = [];
  const dims = Object.keys(snapshot.dimensions) as CalibrationDimension[];

  for (const dim of dims) {
    const dimEst = snapshot.dimensions[dim];
    if (!dimEst.hasVariance) {
      // Whole dimension has no variance — skip (it'll be disabled in sizing).
      continue;
    }
    for (const cell of dimEst.cells) {
      // Never propose for n=0 cells (no data → no signal)
      if (cell.inactive === "no_data") continue;

      const frozenEntry = frozen.weights[dim]?.[cell.cell];
      const oldWeight = frozenEntry?.weight ?? null;
      const oldN = frozenEntry?.n ?? 0;
      const oldConfidence: ConfidenceLevel | null =
        frozenEntry?.confidence ?? null;

      const newWeight = cell.shrinkageApplied;
      const confidenceChanged =
        oldConfidence != null && oldConfidence !== cell.confidence;
      const weightChanged =
        oldWeight == null
          ? true
          : Math.abs(newWeight - oldWeight) >= deltaEpsilon;

      // Skip cells where nothing meaningful changed.
      if (!confidenceChanged && !weightChanged) continue;

      const delta = oldWeight == null ? newWeight : newWeight - oldWeight;
      changes.push({
        dimension: dim,
        cell: cell.cell,
        oldWeight: oldWeight ?? snapshot.globalPrior,
        newWeight,
        delta,
        oldN,
        newN: cell.n,
        oldConfidence: oldConfidence ?? "low",
        newConfidence: cell.confidence,
        confidenceChanged,
        rationale: generateRationale(
          {
            dimension: dim,
            cell: cell.cell,
            oldWeight,
            newWeight,
            oldN,
            newN: cell.n,
            oldConfidence,
            newConfidence: cell.confidence,
            confidenceChanged,
          },
          lang,
        ),
      });
    }
  }
  return changes;
}

let proposalIdSeq = 0;
function nextProposalId(): string {
  proposalIdSeq += 1;
  return `prop-${Date.now().toString(36)}-${proposalIdSeq.toString(36)}`;
}

/**
 * Top-level entry point: from outcomes → snapshot → diff → proposal.
 *
 * Persists the proposal as `pending` IF and only if there are changes.
 * Returns the proposal (or null if no meaningful changes were detected).
 */
export function generateProposalFromOutcomes(
  outcomes: SimOutcomeRow[],
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
  opts: ProposalGenerationOptions = {},
): { snapshot: CalibrationSnapshot; proposal: CalibrationProposal | null } {
  const snapshot = computeCalibrationSnapshot(outcomes, {
    simTable: ctx.simTable,
    sdsRows: ctx.sdsRows,
    config: opts.shrinkageConfig ?? DEFAULT_SHRINKAGE_CONFIG,
  });
  const frozen = loadFrozenWeights();
  const changes = diffSnapshotVsFrozen(
    snapshot,
    frozen,
    opts.deltaEpsilon ?? DEFAULT_DELTA_EPSILON,
    opts.lang ?? "en",
  );
  if (changes.length === 0) return { snapshot, proposal: null };

  const proposal: CalibrationProposal = {
    id: nextProposalId(),
    createdAt: new Date().toISOString(),
    triggeredByTradeId: opts.triggeredByTradeId ?? null,
    changes,
    status: "pending",
  };
  persistProposal(proposal);
  return { snapshot, proposal };
}

/**
 * Approve a proposal → atomically applies its changes to frozen weights.
 * Idempotent: if the proposal is not pending, this is a no-op and returns null.
 */
export function approveProposal(
  proposalId: string,
  reviewNote?: string,
  reviewedBy?: string,
): { frozen: FrozenWeights; proposal: CalibrationProposal } | null {
  const updated = updateProposalStatus(
    proposalId,
    "approved",
    reviewNote,
    reviewedBy,
  );
  if (!updated) return null;
  const frozen = applyChangesToFrozenWeights(proposalId, updated.changes);
  return { frozen, proposal: updated };
}

/**
 * Reject a proposal → no changes to frozen weights, but record persists.
 */
export function rejectProposal(
  proposalId: string,
  reviewNote?: string,
  reviewedBy?: string,
): CalibrationProposal | null {
  return updateProposalStatus(proposalId, "rejected", reviewNote, reviewedBy);
}
