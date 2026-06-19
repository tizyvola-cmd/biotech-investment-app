/**
 * Advice feedback engine.
 *
 * Closes the loop between the diagnostic "P(plan) vs forecast error" panel
 * and the recommendation engine. From the observed bucket success rates
 * and dominant root causes it derives:
 *
 *   1. Per-bucket probability multipliers — stretch P(plan) up/down to
 *      match the realised success rate of that bucket (e.g. if the
 *      P(plan)=50–59% bucket actually wins 46% of the time, P(plan)=53%
 *      becomes 53 × 46/55 ≈ 44%). Clipped to [0.5, 1.5] to avoid
 *      runaway corrections from tiny samples.
 *
 *   2. Per (bucket × action) demotions — when an action class on a
 *      bucket is wrong too often, demote it to REVIEW so the user still
 *      gets a heads-up but no auto BUY/SELL signal fires (e.g. SELL
 *      in 50–59% with bad-rate 60% on ≥8 samples ⇒ SELL→REVIEW).
 *
 *   3. Dominant root-cause per bucket — surfaced as the human-readable
 *      reason a demotion was applied.
 *
 * The engine is *pure* in terms of math; persistence to localStorage is
 * exposed separately so the React hook layer can subscribe to changes.
 */

import {
  ADVICE_CALIB_BUCKETS,
  type AdviceActionKind,
  type AdviceCalibBucketDef,
  type AdviceCalibBucketId,
  type AdviceCalibrationBucketRow,
  type AdviceCalibrationPoint,
  type BadAdviceCategory,
  type BadAdviceDiagnosis,
} from "./investDecisionSimAdviceCalibration";

/** Below this many scored advices the bucket multiplier stays neutral (1.0). */
export const ADVICE_FEEDBACK_MIN_BUCKET_SAMPLES = 5;
/** Minimum scored advice points before auto-apply writes learnings without a manual click. */
export const ADVICE_FEEDBACK_AUTO_APPLY_MIN_SCORED = ADVICE_FEEDBACK_MIN_BUCKET_SAMPLES;
/** Below this many scored advices the (bucket × action) demotion does not trigger. */
export const ADVICE_FEEDBACK_MIN_ACTION_SAMPLES = 8;
/** Bad-rate threshold (bad / scored) at which a (bucket × action) cell is demoted. */
export const ADVICE_FEEDBACK_DEMOTE_BAD_RATE = 0.55;
/** Clip range for the bucket multiplier — matches backend cal_factor clipping. */
export const ADVICE_FEEDBACK_MULTIPLIER_MIN = 0.5;
export const ADVICE_FEEDBACK_MULTIPLIER_MAX = 1.5;
/**
 * If we shift P(plan) and the corrected probability differs from the raw by
 * less than this many percentage points we record the correction but treat
 * it as a no-op (avoids cosmetic 0.1pp deltas spamming the UI).
 */
export const ADVICE_FEEDBACK_CORRECTION_EPSILON_PP = 0.5;

const STORAGE_KEY = "supernova.adviceFeedback.v1";
export const ADVICE_FEEDBACK_CHANGED_EVENT = "supernova-advice-feedback-changed";

export type BucketCorrection = {
  bucketId: AdviceCalibBucketId;
  bucketLabel: string;
  /** P(plan)_corrected = P(plan)_raw × multiplier (clipped). */
  multiplier: number;
  /** Raw multiplier before clipping — useful to surface tiny / huge sample noise. */
  multiplierRaw: number;
  samples: number;
  good: number;
  bad: number;
  successRatePct: number | null;
  declaredAvgProbPct: number | null;
};

/** Demotion rule: when fired, the action becomes `to` and the raw is kept aside. */
export type ActionDemotion = {
  bucketId: AdviceCalibBucketId;
  bucketLabel: string;
  from: AdviceActionKind;
  to: AdviceActionKind;
  samples: number;
  badCount: number;
  badRate: number;
  /** Dominant root-cause across the bad cases in this cell (if any). */
  dominantRootCause: BadAdviceCategory | null;
};

export type AdviceFeedback = {
  /** ISO timestamp of when the feedback was *computed*. */
  generatedAt: string;
  /** Total scored points used to build this snapshot. */
  scoredPoints: number;
  /** Per-bucket probability multipliers. Buckets without enough samples are omitted. */
  bucketCorrections: Map<AdviceCalibBucketId, BucketCorrection>;
  /** Demotions keyed by `${bucketId}|${action}`. */
  actionDemotions: Map<string, ActionDemotion>;
};

export type SerializedAdviceFeedback = {
  generatedAt: string;
  scoredPoints: number;
  bucketCorrections: BucketCorrection[];
  actionDemotions: ActionDemotion[];
  schemaVersion: 1;
};

/** Neutral / empty feedback — what the system uses when nothing has been saved yet. */
export function emptyAdviceFeedback(): AdviceFeedback {
  return {
    generatedAt: new Date(0).toISOString(),
    scoredPoints: 0,
    bucketCorrections: new Map(),
    actionDemotions: new Map(),
  };
}

function actionKey(bucketId: AdviceCalibBucketId, action: AdviceActionKind): string {
  return `${bucketId}|${action}`;
}

function clampMultiplier(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(
    ADVICE_FEEDBACK_MULTIPLIER_MAX,
    Math.max(ADVICE_FEEDBACK_MULTIPLIER_MIN, raw),
  );
}

function bucketForProbability(probPct: number): AdviceCalibBucketDef | null {
  for (const def of ADVICE_CALIB_BUCKETS) {
    if (probPct >= def.min && probPct <= def.max) return def;
  }
  return null;
}

/** Demotion target for each action. SELL/BUY/HOLD → REVIEW; REVIEW unchanged. */
function demotionTarget(action: AdviceActionKind): AdviceActionKind {
  if (action === "review") return "review";
  return "review";
}

function dominantRootCauseFor(
  diagnoses: BadAdviceDiagnosis[],
): BadAdviceCategory | null {
  if (!diagnoses.length) return null;
  const counts = new Map<BadAdviceCategory, number>();
  for (const d of diagnoses) {
    counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
  }
  let best: BadAdviceCategory | null = null;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  return best;
}

/**
 * Builds a fresh feedback snapshot from the raw advice-calibration points,
 * the aggregated bucket rows and the per-point root-cause diagnoses.
 *
 * `diagnosesByPointId` is keyed by `AdviceCalibrationPoint.id` and only
 * needs to contain entries for `outcome === "bad"` points. Missing entries
 * are tolerated (the demotion still fires, just without a root-cause label).
 */
export function buildAdviceFeedback(
  points: AdviceCalibrationPoint[],
  bucketRows: AdviceCalibrationBucketRow[],
  diagnosesByPointId: Map<string, BadAdviceDiagnosis> | null = null,
  now: Date = new Date(),
): AdviceFeedback {
  const bucketCorrections = new Map<AdviceCalibBucketId, BucketCorrection>();
  for (const row of bucketRows) {
    const scored = row.goodCount + row.badCount;
    if (scored < ADVICE_FEEDBACK_MIN_BUCKET_SAMPLES) continue;
    if (row.successRatePct == null || row.avgProbPct == null || row.avgProbPct <= 0) continue;
    const multiplierRaw = row.successRatePct / row.avgProbPct;
    bucketCorrections.set(row.bucketId, {
      bucketId: row.bucketId,
      bucketLabel: row.bucketLabel,
      multiplier: clampMultiplier(multiplierRaw),
      multiplierRaw,
      samples: scored,
      good: row.goodCount,
      bad: row.badCount,
      successRatePct: row.successRatePct,
      declaredAvgProbPct: row.avgProbPct,
    });
  }

  const actionGroups = new Map<
    string,
    { samples: number; bad: number; bucketLabel: string; bucketId: AdviceCalibBucketId; action: AdviceActionKind; badDiagnoses: BadAdviceDiagnosis[] }
  >();
  for (const p of points) {
    if (p.outcome === "pending") continue;
    const def = bucketForProbability(p.probPct);
    if (!def) continue;
    const key = actionKey(def.id, p.suggestedAction);
    const slot = actionGroups.get(key) ?? {
      samples: 0,
      bad: 0,
      bucketLabel: def.labelEn,
      bucketId: def.id,
      action: p.suggestedAction,
      badDiagnoses: [] as BadAdviceDiagnosis[],
    };
    slot.samples += 1;
    if (p.outcome === "bad") {
      slot.bad += 1;
      const diag = diagnosesByPointId?.get(p.id) ?? null;
      if (diag) slot.badDiagnoses.push(diag);
    }
    actionGroups.set(key, slot);
  }

  const actionDemotions = new Map<string, ActionDemotion>();
  for (const [key, slot] of actionGroups) {
    if (slot.samples < ADVICE_FEEDBACK_MIN_ACTION_SAMPLES) continue;
    const badRate = slot.bad / slot.samples;
    if (badRate < ADVICE_FEEDBACK_DEMOTE_BAD_RATE) continue;
    const to = demotionTarget(slot.action);
    if (to === slot.action) continue;
    actionDemotions.set(key, {
      bucketId: slot.bucketId,
      bucketLabel: slot.bucketLabel,
      from: slot.action,
      to,
      samples: slot.samples,
      badCount: slot.bad,
      badRate,
      dominantRootCause: dominantRootCauseFor(slot.badDiagnoses),
    });
  }

  return {
    generatedAt: now.toISOString(),
    scoredPoints: points.filter((p) => p.outcome !== "pending").length,
    bucketCorrections,
    actionDemotions,
  };
}

export type CorrectionResult = {
  correctedPct: number;
  multiplier: number;
  bucketId: AdviceCalibBucketId | null;
  applied: boolean;
};

/** Returns the corrected P(plan) and whether the correction is materially different. */
export function correctProbabilityPct(
  probPct: number | null,
  feedback: AdviceFeedback | null | undefined,
): CorrectionResult {
  if (probPct == null || !Number.isFinite(probPct)) {
    return { correctedPct: probPct ?? 0, multiplier: 1, bucketId: null, applied: false };
  }
  if (!feedback || feedback.bucketCorrections.size === 0) {
    return { correctedPct: probPct, multiplier: 1, bucketId: null, applied: false };
  }
  const def = bucketForProbability(probPct);
  if (!def) return { correctedPct: probPct, multiplier: 1, bucketId: null, applied: false };
  const corr = feedback.bucketCorrections.get(def.id);
  if (!corr) return { correctedPct: probPct, multiplier: 1, bucketId: def.id, applied: false };
  const raw = probPct * corr.multiplier;
  const clamped = Math.max(0, Math.min(100, raw));
  const applied = Math.abs(clamped - probPct) >= ADVICE_FEEDBACK_CORRECTION_EPSILON_PP;
  return {
    correctedPct: Math.round(clamped * 10) / 10,
    multiplier: corr.multiplier,
    bucketId: def.id,
    applied,
  };
}

export type DemotionResult = {
  demotedTo: AdviceActionKind | null;
  reason: ActionDemotion | null;
};

/** Returns the demoted action (if any) and the rule that fired. */
export function demoteAction(
  action: AdviceActionKind | null | undefined,
  probPct: number | null | undefined,
  feedback: AdviceFeedback | null | undefined,
): DemotionResult {
  if (!action || probPct == null || !Number.isFinite(probPct)) {
    return { demotedTo: null, reason: null };
  }
  if (!feedback || feedback.actionDemotions.size === 0) {
    return { demotedTo: null, reason: null };
  }
  const def = bucketForProbability(probPct);
  if (!def) return { demotedTo: null, reason: null };
  const rule = feedback.actionDemotions.get(actionKey(def.id, action));
  if (!rule) return { demotedTo: null, reason: null };
  return { demotedTo: rule.to, reason: rule };
}

/**
 * Combined helper — applies the bucket multiplier *first* (so the demotion
 * looks up the corrected probability bucket), then the demotion. This avoids
 * paradoxes where a P(plan) of 53% would map to one bucket pre-correction
 * and a different one post-correction.
 */
export type AdviceCorrectionRecord = {
  probPctRaw: number;
  probPctCorrected: number;
  probPctApplied: boolean;
  bucketIdRaw: AdviceCalibBucketId | null;
  bucketIdCorrected: AdviceCalibBucketId | null;
  multiplier: number;
  actionRaw: AdviceActionKind;
  actionEffective: AdviceActionKind;
  demotion: ActionDemotion | null;
};

export function applyAdviceFeedback(
  action: AdviceActionKind,
  probPct: number | null,
  feedback: AdviceFeedback | null | undefined,
): AdviceCorrectionRecord | null {
  if (probPct == null || !Number.isFinite(probPct)) return null;
  if (!feedback || (feedback.bucketCorrections.size === 0 && feedback.actionDemotions.size === 0)) {
    return null;
  }
  const corr = correctProbabilityPct(probPct, feedback);
  const bucketRaw = bucketForProbability(probPct)?.id ?? null;
  const bucketCorrected = bucketForProbability(corr.correctedPct)?.id ?? bucketRaw;
  // Demotion considers the *raw* bucket (where the historical evidence lives).
  const dem = demoteAction(action, probPct, feedback);
  return {
    probPctRaw: probPct,
    probPctCorrected: corr.correctedPct,
    probPctApplied: corr.applied,
    bucketIdRaw: bucketRaw,
    bucketIdCorrected: bucketCorrected,
    multiplier: corr.multiplier,
    actionRaw: action,
    actionEffective: dem.demotedTo ?? action,
    demotion: dem.reason,
  };
}

export function serializeAdviceFeedback(fb: AdviceFeedback): SerializedAdviceFeedback {
  return {
    generatedAt: fb.generatedAt,
    scoredPoints: fb.scoredPoints,
    bucketCorrections: Array.from(fb.bucketCorrections.values()),
    actionDemotions: Array.from(fb.actionDemotions.values()),
    schemaVersion: 1,
  };
}

export function deserializeAdviceFeedback(
  raw: SerializedAdviceFeedback | null | undefined,
): AdviceFeedback {
  if (!raw || raw.schemaVersion !== 1) return emptyAdviceFeedback();
  const bucketCorrections = new Map<AdviceCalibBucketId, BucketCorrection>();
  for (const c of raw.bucketCorrections ?? []) {
    if (!c?.bucketId) continue;
    bucketCorrections.set(c.bucketId, c);
  }
  const actionDemotions = new Map<string, ActionDemotion>();
  for (const d of raw.actionDemotions ?? []) {
    if (!d?.bucketId || !d?.from) continue;
    actionDemotions.set(actionKey(d.bucketId, d.from), d);
  }
  return {
    generatedAt: raw.generatedAt ?? new Date(0).toISOString(),
    scoredPoints: raw.scoredPoints ?? 0,
    bucketCorrections,
    actionDemotions,
  };
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAdviceFeedback(): AdviceFeedback | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedAdviceFeedback;
    return deserializeAdviceFeedback(parsed);
  } catch {
    return null;
  }
}

export function saveAdviceFeedback(fb: AdviceFeedback): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(serializeAdviceFeedback(fb)));
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(ADVICE_FEEDBACK_CHANGED_EVENT));
    }
  } catch {
    /* storage full or blocked — keep going, the in-memory snapshot is intact. */
  }
}

export function clearAdviceFeedback(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(ADVICE_FEEDBACK_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

/** Stable key for comparing correction rules — ignores generatedAt / scoredPoints drift. */
export function adviceFeedbackRulesKey(fb: AdviceFeedback): string {
  const buckets = [...fb.bucketCorrections.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([id, c]) =>
        `${id}:${c.multiplier.toFixed(4)}:${c.samples}:${c.good}:${c.bad}`,
    )
    .join("|");
  const demotions = [...fb.actionDemotions.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([key, d]) =>
        `${key}:${d.from}->${d.to}:${d.badRate.toFixed(4)}:${d.samples}`,
    )
    .join("|");
  return `${buckets};;${demotions}`;
}

/**
 * Whether pending learnings should be persisted without a manual Apply click.
 * Requires corrections/demotions, enough scored samples, and a change vs stored rules.
 */
export function shouldAutoApplyAdviceFeedback(
  pending: AdviceFeedback,
  stored: AdviceFeedback | null | undefined,
  opts?: { minScoredPoints?: number },
): boolean {
  const minScored = opts?.minScoredPoints ?? ADVICE_FEEDBACK_AUTO_APPLY_MIN_SCORED;
  if (pending.scoredPoints < minScored) return false;
  if (pending.bucketCorrections.size === 0 && pending.actionDemotions.size === 0) {
    return false;
  }
  if (!stored || (stored.bucketCorrections.size === 0 && stored.actionDemotions.size === 0)) {
    return true;
  }
  return adviceFeedbackRulesKey(pending) !== adviceFeedbackRulesKey(stored);
}

export type ApplyAdviceFeedbackAutoResult = {
  applied: boolean;
  reason: "none" | "insufficient_data" | "unchanged" | "applied";
};

/** Persist pending learnings when auto-apply gates pass. Returns whether a write occurred. */
export function applyAdviceFeedbackAutoIfDue(
  pending: AdviceFeedback,
  stored: AdviceFeedback | null | undefined = loadAdviceFeedback(),
  opts?: { minScoredPoints?: number },
): ApplyAdviceFeedbackAutoResult {
  if (pending.scoredPoints < (opts?.minScoredPoints ?? ADVICE_FEEDBACK_AUTO_APPLY_MIN_SCORED)) {
    return { applied: false, reason: "insufficient_data" };
  }
  if (pending.bucketCorrections.size === 0 && pending.actionDemotions.size === 0) {
    return { applied: false, reason: "none" };
  }
  if (!shouldAutoApplyAdviceFeedback(pending, stored, opts)) {
    return { applied: false, reason: "unchanged" };
  }
  saveAdviceFeedback(pending);
  return { applied: true, reason: "applied" };
}

/** Compact summary string for the UI status badge. */
export function describeAdviceFeedback(
  fb: AdviceFeedback | null | undefined,
  lang: "it" | "en" = "it",
): string {
  if (!fb || (fb.bucketCorrections.size === 0 && fb.actionDemotions.size === 0)) {
    return lang === "it" ? "Nessuna correzione attiva" : "No corrections active";
  }
  const buckets = fb.bucketCorrections.size;
  const demotions = fb.actionDemotions.size;
  if (lang === "it") {
    return `${buckets} bucket corretti · ${demotions} azioni declassate`;
  }
  return `${buckets} buckets corrected · ${demotions} action demotions`;
}
