/**
 * Sim Loop Acceptance Policy
 *
 * Defines which BUY recommendations the sim loop should accept automatically.
 * Selective defaults (P(plan) ≥ 50%, SDS ≥ 30) filter out
 * low-confidence signals. Thresholds improve over time via the error-pattern
 * loop (universe-split loss rate analysis).
 *
 * Policy is stored in localStorage (v2 key) so it can be tuned from the UI
 * without a full redeploy. Legacy v1 keys are migrated on first load.
 */

const STORAGE_KEY = "supernova_simloop_policy_v2";
/** Legacy key written by old code — used only to detect "never manually configured". */
const STORAGE_KEY_V1 = "supernova_simloop_policy_v1";

export type SimLoopAcceptancePolicy = {
  /** Minimum SDS score required to accept a BUY. 0 = no filter (accept all). */
  minSds: number;
  /** Minimum P(plan) % required to accept a BUY. 0 = no filter. */
  minPplanPct: number;
  /** If true, reject BUY when the ticker matches the approved loss-risk pattern. */
  rejectOnLossPattern: boolean;
  /** If true, reject BUY when suggestedAction is not explicitly "buy". */
  requireExplicitBuy: boolean;
  /** ISO timestamp of last manual edit by user. */
  updatedAt: string | null;
  /** Free-text note describing the policy rationale. */
  note: string;
};

/**
 * Selective defaults: P(plan) ≥ 50% and SDS ≥ 30 required.
 * Rationale: model accuracy is ~53% overall; accepting all signals dilutes the
 * sim loop with low-confidence calls. Threshold 50% P(plan) targets the upper
 * half of the model's confidence distribution; SDS ≥ 30 excludes very weak
 * signal-strength tickers.
 */
export const DEFAULT_POLICY: SimLoopAcceptancePolicy = {
  minSds: 30,
  minPplanPct: 50,
  rejectOnLossPattern: false,
  requireExplicitBuy: true,
  updatedAt: null,
  note: "Default: P(plan) ≥ 50% · SDS ≥ 30",
};

/**
 * Returns true if `p` looks like a never-manually-configured policy
 * (both thresholds still at the old permissive zero values).
 */
function isUnconfiguredPermissivePolicy(p: Partial<SimLoopAcceptancePolicy>): boolean {
  return (p.minSds ?? 0) === 0 && (p.minPplanPct ?? 0) === 0 && !p.updatedAt;
}

export function loadSimLoopPolicy(): SimLoopAcceptancePolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SimLoopAcceptancePolicy>;
      return { ...DEFAULT_POLICY, ...parsed };
    }
    // Check legacy v1 key: if user had manually configured it, migrate their values.
    // If it was the old permissive default (0/0/never edited), use new selective default.
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const parsedV1 = JSON.parse(rawV1) as Partial<SimLoopAcceptancePolicy>;
      if (isUnconfiguredPermissivePolicy(parsedV1)) {
        return { ...DEFAULT_POLICY };
      }
      return { ...DEFAULT_POLICY, ...parsedV1 };
    }
    return { ...DEFAULT_POLICY };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function saveSimLoopPolicy(policy: SimLoopAcceptancePolicy): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...policy, updatedAt: new Date().toISOString() }),
    );
  } catch {
    // best-effort
  }
}

export function resetSimLoopPolicy(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Evaluate whether a candidate BUY row passes the current policy.
 *
 * @param sds       - Current SDS score for the ticker (null = unknown)
 * @param pplanPct  - P(plan) / affidabilità % (0-100, null = unknown)
 * @param matchesLossPattern - true if the ticker matches the approved loss pattern
 * @param suggestedAction    - raw suggestedAction string from simRow
 * @param policy    - policy to evaluate against (defaults to loaded policy)
 * @returns { accepted: boolean; reason: string }
 */
export function evaluateSimLoopPolicy(
  sds: number | null,
  pplanPct: number | null,
  matchesLossPattern: boolean,
  suggestedAction: string | null | undefined,
  policy?: SimLoopAcceptancePolicy,
): { accepted: boolean; reason: string } {
  const p = policy ?? loadSimLoopPolicy();

  if (p.requireExplicitBuy && suggestedAction?.toLowerCase() !== "buy") {
    return { accepted: false, reason: "suggestedAction is not buy" };
  }

  if (p.minSds > 0) {
    if (sds == null) {
      return { accepted: false, reason: `SDS unknown — required ≥ ${p.minSds}` };
    }
    if (sds < p.minSds) {
      return { accepted: false, reason: `SDS ${sds.toFixed(0)} < minimum ${p.minSds}` };
    }
  }

  if (p.minPplanPct > 0) {
    if (pplanPct == null) {
      return { accepted: false, reason: `P(plan) unknown — required ≥ ${p.minPplanPct}%` };
    }
    if (pplanPct < p.minPplanPct) {
      return { accepted: false, reason: `P(plan) ${pplanPct.toFixed(0)}% < minimum ${p.minPplanPct}%` };
    }
  }

  if (p.rejectOnLossPattern && matchesLossPattern) {
    return { accepted: false, reason: "matches approved loss-risk pattern" };
  }

  return { accepted: true, reason: "ok" };
}
