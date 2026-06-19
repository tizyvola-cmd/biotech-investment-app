/**
 * Pattern Proposal Store — localStorage-backed audit trail + approved pattern
 * + rolling-holdout validation tags + flaggedButTaken tags.
 *
 * Mirror of `calibration/proposalStore.ts` but for `RiskPattern` objects.
 *
 * Why a separate store from CalibrationProposal:
 *   - A pattern is a logical AND of conditions (readable rule), not a weight.
 *     The diff is qualitatively different.
 *   - The lifecycle (approved pattern at most one at a time vs. many frozen
 *     weight cells) is different.
 *   - Confused users approving a "pattern" expecting it to change a "weight"
 *     would be a real risk.
 *
 * Append-only by design: no proposal is ever deleted. Status moves from
 * pending → approved/rejected, but the record remains in history.
 *
 * Stored keys (versioned):
 *   supernova.riskPattern.proposals.v1   → PatternProposal[]
 *   supernova.riskPattern.approved.v1    → ApprovedPatternRecord
 *   supernova.riskPattern.validation.v1  → Record<rowKey, ValidationTag>
 *   supernova.riskPattern.flagged.v1     → Record<rowKey, FlaggedTag>
 */
import type {
  PatternProposal,
  PatternProposalStatus,
  RiskPattern,
} from "./riskPatternTypes";

const PROPOSAL_KEY = "supernova.riskPattern.proposals.v1";
const APPROVED_KEY = "supernova.riskPattern.approved.v1";
const VALIDATION_KEY = "supernova.riskPattern.validation.v1";
const FLAGGED_KEY = "supernova.riskPattern.flagged.v1";

// ── In-memory fallback for non-browser environments ───────────────────────

const __memoryStore: Record<string, string> = {};

function safeGetItem(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      /* fall through */
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

// ── Proposals ─────────────────────────────────────────────────────────────

function loadProposals(): PatternProposal[] {
  const raw = safeGetItem(PROPOSAL_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PatternProposal[]) : [];
  } catch {
    return [];
  }
}

function saveProposals(p: PatternProposal[]): void {
  try {
    safeSetItem(PROPOSAL_KEY, JSON.stringify(p));
  } catch {
    /* no-op */
  }
}

export function listProposals(): PatternProposal[] {
  return loadProposals().slice().sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (b.status === "pending" && a.status !== "pending") return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function listPendingProposals(): PatternProposal[] {
  return listProposals().filter((p) => p.status === "pending");
}

export function persistProposal(p: PatternProposal): void {
  const all = loadProposals();
  all.push(p);
  saveProposals(all);
}

export function updateProposalStatus(
  id: string,
  status: Extract<PatternProposalStatus, "approved" | "rejected">,
  reviewNote?: string,
  reviewedBy?: string,
): PatternProposal | null {
  const all = loadProposals();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  if (all[idx].status !== "pending") {
    // Never overwrite a non-pending proposal — audit trail.
    return null;
  }
  const updated: PatternProposal = {
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

// ── Approved pattern (single, current) ────────────────────────────────────
//
// Only ONE pattern is approved at any moment. Approving a new one moves the
// previous to a "supersededHistory" inside this record (immutable trail).

export type ApprovedPatternRecord = {
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** Currently active pattern (the one used by Step 3 filter). */
  current: RiskPattern | null;
  /** Patterns previously approved, in chronological order (oldest first). */
  supersededHistory: RiskPattern[];
};

function emptyApprovedRecord(): ApprovedPatternRecord {
  return {
    updatedAt: new Date().toISOString(),
    current: null,
    supersededHistory: [],
  };
}

export function loadApprovedPattern(): ApprovedPatternRecord {
  const raw = safeGetItem(APPROVED_KEY);
  if (!raw) return emptyApprovedRecord();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "current" in parsed) {
      return parsed as ApprovedPatternRecord;
    }
    return emptyApprovedRecord();
  } catch {
    return emptyApprovedRecord();
  }
}

function saveApprovedPattern(r: ApprovedPatternRecord): void {
  try {
    safeSetItem(APPROVED_KEY, JSON.stringify(r));
  } catch {
    /* no-op */
  }
}

/**
 * Promote a pattern to "approved". The previous current (if any) is moved
 * into supersededHistory. Returns the updated record.
 */
export function promotePatternToApproved(p: RiskPattern): ApprovedPatternRecord {
  const r = loadApprovedPattern();
  const newRecord: ApprovedPatternRecord = {
    updatedAt: new Date().toISOString(),
    current: { ...p, approvedAt: new Date().toISOString() },
    supersededHistory: r.current
      ? [...r.supersededHistory, r.current]
      : r.supersededHistory,
  };
  saveApprovedPattern(newRecord);
  return newRecord;
}

/**
 * Clear the approved pattern. The previous current (if any) goes to history.
 * Used when rejecting a "currentPatternDegraded" alarm and the user explicitly
 * wants to remove the pattern instead of replacing it.
 */
export function clearApprovedPattern(): ApprovedPatternRecord {
  const r = loadApprovedPattern();
  const newRecord: ApprovedPatternRecord = {
    updatedAt: new Date().toISOString(),
    current: null,
    supersededHistory: r.current
      ? [...r.supersededHistory, r.current]
      : r.supersededHistory,
  };
  saveApprovedPattern(newRecord);
  return newRecord;
}

// ── Rolling holdout: validation tagging ───────────────────────────────────
//
// A trade is "used for validation" once a pattern has been used to evaluate
// its outcome out-of-sample. After that, the trade enters the training pool
// for the next proposal. The tagging is keyed by row_key; the date column
// inside ValidationTag tells which approved pattern was used.

export type ValidationTag = {
  rowKey: string;
  /** ISO timestamp when the trade was first used as out-of-sample for the
   *  then-current approved pattern. */
  usedForValidationAt: string;
  /** id of the approved pattern at the time of validation. */
  validationPatternId: string;
};

function loadValidationTags(): Record<string, ValidationTag> {
  const raw = safeGetItem(VALIDATION_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, ValidationTag>)
      : {};
  } catch {
    return {};
  }
}

function saveValidationTags(tags: Record<string, ValidationTag>): void {
  try {
    safeSetItem(VALIDATION_KEY, JSON.stringify(tags));
  } catch {
    /* no-op */
  }
}

export function getValidationTag(rowKey: string): ValidationTag | null {
  return loadValidationTags()[rowKey] ?? null;
}

export function tagAsUsedForValidation(
  rowKey: string,
  patternId: string,
): ValidationTag {
  const tags = loadValidationTags();
  const existing = tags[rowKey];
  // Idempotent — never overwrite the first validation tag for a row.
  if (existing) return existing;
  const tag: ValidationTag = {
    rowKey,
    usedForValidationAt: new Date().toISOString(),
    validationPatternId: patternId,
  };
  tags[rowKey] = tag;
  saveValidationTags(tags);
  return tag;
}

export function listValidationTags(): ValidationTag[] {
  return Object.values(loadValidationTags());
}

// ── flaggedButTaken tagging ───────────────────────────────────────────────
//
// When a position was flagged by the approved pattern at entry but the user
// took it anyway, we record this so the engine can later compute the *true*
// cost of the filter (how many wins it would have skipped if always applied).

export type FlaggedTag = {
  rowKey: string;
  /** ISO timestamp of the flag observation. */
  flaggedAt: string;
  /** id of the pattern that flagged the position. */
  patternId: string;
};

function loadFlaggedTags(): Record<string, FlaggedTag> {
  const raw = safeGetItem(FLAGGED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, FlaggedTag>)
      : {};
  } catch {
    return {};
  }
}

function saveFlaggedTags(tags: Record<string, FlaggedTag>): void {
  try {
    safeSetItem(FLAGGED_KEY, JSON.stringify(tags));
  } catch {
    /* no-op */
  }
}

export function getFlaggedTag(rowKey: string): FlaggedTag | null {
  return loadFlaggedTags()[rowKey] ?? null;
}

export function tagAsFlaggedButTaken(
  rowKey: string,
  patternId: string,
): FlaggedTag {
  const tags = loadFlaggedTags();
  const existing = tags[rowKey];
  if (existing) return existing;
  const tag: FlaggedTag = {
    rowKey,
    flaggedAt: new Date().toISOString(),
    patternId,
  };
  tags[rowKey] = tag;
  saveFlaggedTags(tags);
  return tag;
}

export function listFlaggedTags(): FlaggedTag[] {
  return Object.values(loadFlaggedTags());
}

// ── Reset for tests ───────────────────────────────────────────────────────

export function __resetPatternStoreForTests(): void {
  safeRemoveItem(PROPOSAL_KEY);
  safeRemoveItem(APPROVED_KEY);
  safeRemoveItem(VALIDATION_KEY);
  safeRemoveItem(FLAGGED_KEY);
}
