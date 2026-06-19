/**
 * Proposal store — localStorage-backed audit trail of CalibrationProposal.
 *
 * Append-only by design: once a proposal is created it is NEVER deleted.
 * Approval/rejection updates the status field but the full history remains.
 *
 * Separately persists `FrozenWeights` — the only thing sizingRules.ts is
 * allowed to consume. Frozen weights are updated atomically only when a
 * proposal is approved.
 */
import type {
  CalibrationProposal,
  FrozenWeights,
  ProposalChange,
} from "./calibrationTypes";

const PROPOSAL_STORE_KEY = "supernova.calibration.proposals.v1";
const FROZEN_WEIGHTS_KEY = "supernova.calibration.frozenWeights.v1";

type ProposalRecord = CalibrationProposal[];

/** Same in-memory fallback story as featureSnapshotStore. */
const __memoryStore: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      /* fall through to memory */
    }
  }
  return Object.prototype.hasOwnProperty.call(__memoryStore, key)
    ? __memoryStore[key]
    : null;
}

function safeSetItem(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      /* fall through */
    }
  }
  __memoryStore[key] = value;
}

function safeRemoveItem(key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* fall through */
    }
  }
  delete __memoryStore[key];
}

function loadProposals(): ProposalRecord {
  const raw = safeGetItem(PROPOSAL_STORE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ProposalRecord;
    return [];
  } catch {
    return [];
  }
}

function saveProposals(p: ProposalRecord): void {
  try {
    safeSetItem(PROPOSAL_STORE_KEY, JSON.stringify(p));
  } catch {
    /* no-op */
  }
}

export function listProposals(): CalibrationProposal[] {
  return loadProposals().slice().sort((a, b) => {
    // pending first, then by createdAt desc
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function listPendingProposals(): CalibrationProposal[] {
  return listProposals().filter((p) => p.status === "pending");
}

export function persistProposal(p: CalibrationProposal): void {
  const all = loadProposals();
  all.push(p);
  saveProposals(all);
}

/**
 * Update the status of a proposal. The proposal record itself is preserved.
 * Returns the updated proposal, or null if not found.
 */
export function updateProposalStatus(
  id: string,
  status: "approved" | "rejected",
  reviewNote?: string,
  reviewedBy?: string,
): CalibrationProposal | null {
  const all = loadProposals();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  if (all[idx].status !== "pending") {
    // Already reviewed — refuse to overwrite to preserve audit trail.
    return null;
  }
  const updated: CalibrationProposal = {
    ...all[idx],
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy,
    reviewNote,
  };
  all[idx] = updated;
  saveProposals(all);
  return updated;
}

// ── Frozen weights ────────────────────────────────────────────────────────

function emptyFrozenWeights(): FrozenWeights {
  return {
    updatedAt: new Date().toISOString(),
    lastProposalId: null,
    weights: {
      clinicalPhase: {},
      clinicalIndication: {},
      sdsBucket: {},
      pplanBucket: {},
    },
  };
}

export function loadFrozenWeights(): FrozenWeights {
  const raw = safeGetItem(FROZEN_WEIGHTS_KEY);
  if (!raw) return emptyFrozenWeights();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "weights" in parsed) {
      return parsed as FrozenWeights;
    }
    return emptyFrozenWeights();
  } catch {
    return emptyFrozenWeights();
  }
}

function saveFrozenWeights(fw: FrozenWeights): void {
  try {
    safeSetItem(FROZEN_WEIGHTS_KEY, JSON.stringify(fw));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("supernova:frozen-weights-updated", {
          detail: fw.updatedAt,
        }),
      );
    }
  } catch {
    /* no-op */
  }
}

/**
 * Apply the changes of an APPROVED proposal to the frozen weights.
 * The caller is responsible for ensuring the proposal is approved first.
 */
export function applyChangesToFrozenWeights(
  proposalId: string,
  changes: ProposalChange[],
): FrozenWeights {
  const fw = loadFrozenWeights();
  for (const c of changes) {
    const dimMap = fw.weights[c.dimension];
    dimMap[c.cell] = {
      weight: c.newWeight,
      n: c.newN,
      confidence: c.newConfidence,
    };
  }
  const updated: FrozenWeights = {
    ...fw,
    updatedAt: new Date().toISOString(),
    lastProposalId: proposalId,
  };
  saveFrozenWeights(updated);
  return updated;
}

/** Reset everything — TESTS / DEBUG ONLY. */
export function __resetCalibrationStoreForTests(): void {
  safeRemoveItem(PROPOSAL_STORE_KEY);
  safeRemoveItem(FROZEN_WEIGHTS_KEY);
}
