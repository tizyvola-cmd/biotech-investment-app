/**
 * Gate Learning Loop v1 (2026-07-18).
 *
 * Closes a thin loop from scored advice outcomes → proposed Decision Chart /
 * sim-loop gate thresholds, with hard guardrails and manual Apply / Revert.
 *
 * Knobs (v1):
 *   • rescueSellRegMin — Reg floor for Rescue→SELL (baseline 45)
 *   • studySdsMin      — SDS floor for operational BUY study evidence (baseline 40)
 *
 * Does NOT touch P(plan) ≥ 65 BUY floor (historically 76% win rate).
 */

import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";

export const GATE_LEARNING_STORAGE_KEY = "supernova.gateLearningLoop.v1";
export const GATE_LEARNING_CHANGED_EVENT = "supernova-gate-learning-changed";

/** Factory defaults — match decisionChartLogic / investDecisionSimLoop as of 2026-07-17. */
export const GATE_LEARNING_BASELINE = {
  rescueSellRegMin: 45,
  studySdsMin: 40,
} as const;

/** Hard clips — never propose outside these bands. */
export const GATE_LEARNING_GUARDRAILS = {
  rescueSellRegMin: { min: 40, max: 55 },
  studySdsMin: { min: 35, max: 50 },
} as const;

export const GATE_LEARNING_MIN_SCORED = 8;
export const GATE_LEARNING_REGRET_RATE = 0.55;
export const GATE_LEARNING_FALSE_SELL_RATE = 0.55;
export const GATE_LEARNING_BUY_WEAK_RATE = 0.45;
export const GATE_LEARNING_BUY_STRONG_RATE = 0.6;
export const GATE_LEARNING_STEP = 5;

export type GateLearningThresholds = {
  rescueSellRegMin: number;
  studySdsMin: number;
};

export type GateLearningProposalKind = "rescue_reg" | "study_sds";

export type GateLearningProposal = {
  kind: GateLearningProposalKind;
  from: number;
  to: number;
  reason: string;
  reasonIt: string;
  evidenceN: number;
  evidenceRate: number;
  computedAt: string;
};

export type GateLearningLogEntry = {
  at: string;
  action: "propose" | "apply" | "revert" | "clear";
  detail: string;
  thresholds?: GateLearningThresholds;
};

export type GateLearningState = {
  version: 1;
  /** Currently active gates (applied). */
  applied: GateLearningThresholds;
  /** Latest computed proposal set (not yet applied). */
  pending: GateLearningProposal[];
  /** Last time proposals were recomputed. */
  lastEvaluatedAt: string | null;
  /** Scored points used in last evaluation. */
  lastScoredN: number;
  log: GateLearningLogEntry[];
};

function clip(kind: keyof GateLearningThresholds, value: number): number {
  const g = GATE_LEARNING_GUARDRAILS[kind];
  return Math.max(g.min, Math.min(g.max, Math.round(value)));
}

function defaultState(): GateLearningState {
  return {
    version: 1,
    applied: { ...GATE_LEARNING_BASELINE },
    pending: [],
    lastEvaluatedAt: null,
    lastScoredN: 0,
    log: [],
  };
}

function safeParse(raw: string | null): GateLearningState | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<GateLearningState>;
    if (!j || j.version !== 1 || !j.applied) return null;
    return {
      version: 1,
      applied: {
        rescueSellRegMin: clip(
          "rescueSellRegMin",
          Number(j.applied.rescueSellRegMin) || GATE_LEARNING_BASELINE.rescueSellRegMin,
        ),
        studySdsMin: clip(
          "studySdsMin",
          Number(j.applied.studySdsMin) || GATE_LEARNING_BASELINE.studySdsMin,
        ),
      },
      pending: Array.isArray(j.pending) ? j.pending : [],
      lastEvaluatedAt: j.lastEvaluatedAt ?? null,
      lastScoredN: Number(j.lastScoredN) || 0,
      log: Array.isArray(j.log) ? j.log.slice(-40) : [],
    };
  } catch {
    return null;
  }
}

export function loadGateLearningState(): GateLearningState {
  if (typeof window === "undefined") return defaultState();
  return safeParse(localStorage.getItem(GATE_LEARNING_STORAGE_KEY)) ?? defaultState();
}

function persist(state: GateLearningState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GATE_LEARNING_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(GATE_LEARNING_CHANGED_EVENT));
}

export function getAppliedRescueSellRegMin(): number {
  return loadGateLearningState().applied.rescueSellRegMin;
}

export function getAppliedStudySdsMin(): number {
  return loadGateLearningState().applied.studySdsMin;
}

function pushLog(
  state: GateLearningState,
  action: GateLearningLogEntry["action"],
  detail: string,
): GateLearningState {
  const entry: GateLearningLogEntry = {
    at: new Date().toISOString(),
    action,
    detail,
    thresholds: { ...state.applied },
  };
  return { ...state, log: [...state.log, entry].slice(-40) };
}

/**
 * Derive pending proposals from scored advice points.
 * Pure w.r.t. applied thresholds (proposals are deltas from current applied).
 */
export function evaluateGateLearningProposals(
  points: AdviceCalibrationPoint[],
  applied: GateLearningThresholds = loadGateLearningState().applied,
): { pending: GateLearningProposal[]; scoredN: number } {
  const scored = points.filter((p) => p.outcome === "good" || p.outcome === "bad");
  const pending: GateLearningProposal[] = [];
  const now = new Date().toISOString();

  // ── Rescue Reg: regret of not selling losers vs false SELL ─────────────
  // Rescue-like: already in loss (pnl < −2) and action was review/hold.
  // Regret = price kept falling (priceChange ≤ −0.5) → we should have sold.
  const rescueLike = scored.filter(
    (p) =>
      (p.suggestedAction === "review" || p.suggestedAction === "hold") &&
      p.pnlPct != null &&
      p.pnlPct < -2,
  );
  const rescueRegret = rescueLike.filter(
    (p) => p.priceChangePct != null && p.priceChangePct <= -0.5,
  );
  const sells = scored.filter((p) => p.suggestedAction === "sell");
  const falseSells = sells.filter((p) => p.outcome === "bad");

  if (rescueLike.length >= GATE_LEARNING_MIN_SCORED) {
    const regretRate = rescueRegret.length / rescueLike.length;
    if (regretRate >= GATE_LEARNING_REGRET_RATE) {
      const to = clip("rescueSellRegMin", applied.rescueSellRegMin - GATE_LEARNING_STEP);
      if (to < applied.rescueSellRegMin) {
        pending.push({
          kind: "rescue_reg",
          from: applied.rescueSellRegMin,
          to,
          evidenceN: rescueLike.length,
          evidenceRate: Math.round(regretRate * 1000) / 10,
          computedAt: now,
          reason: `Rescue-like REVIEW/HOLD kept losing (${rescueRegret.length}/${rescueLike.length} = ${Math.round(regretRate * 100)}%). Lower Reg SELL floor so more losers exit.`,
          reasonIt: `Rescue-like REVIEW/HOLD hanno continuato a perdere (${rescueRegret.length}/${rescueLike.length} = ${Math.round(regretRate * 100)}%). Abbassa la soglia Reg SELL per uscire prima.`,
        });
      }
    }
  }

  if (sells.length >= GATE_LEARNING_MIN_SCORED) {
    const falseRate = falseSells.length / sells.length;
    if (falseRate >= GATE_LEARNING_FALSE_SELL_RATE) {
      const to = clip("rescueSellRegMin", applied.rescueSellRegMin + GATE_LEARNING_STEP);
      if (to > applied.rescueSellRegMin) {
        pending.push({
          kind: "rescue_reg",
          from: applied.rescueSellRegMin,
          to,
          evidenceN: sells.length,
          evidenceRate: Math.round(falseRate * 1000) / 10,
          computedAt: now,
          reason: `SELL advice often wrong (${falseSells.length}/${sells.length} = ${Math.round(falseRate * 100)}% bad). Raise Reg SELL floor to be stricter.`,
          reasonIt: `I SELL sbagliano spesso (${falseSells.length}/${sells.length} = ${Math.round(falseRate * 100)}% bad). Alza la soglia Reg SELL per essere più severi.`,
        });
      }
    }
  }

  // Prefer a single rescue_reg proposal: regret (lower) wins over false-sell (raise)
  // if both fire — drought of exits was the bigger product pain.
  const rescueProps = pending.filter((p) => p.kind === "rescue_reg");
  if (rescueProps.length > 1) {
    const keep = rescueProps.find((p) => p.to < p.from) ?? rescueProps[0];
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].kind === "rescue_reg" && pending[i] !== keep) pending.splice(i, 1);
    }
  }

  // ── Study SDS: BUY quality at high conviction ───────────────────────────
  const buys = scored.filter((p) => p.suggestedAction === "buy");
  const highBuys = buys.filter((p) => p.probPct >= 65);
  const highBuyPool = highBuys.length >= 5 ? highBuys : buys.filter((p) => p.probPct >= 60);
  if (highBuyPool.length >= 5) {
    const good = highBuyPool.filter((p) => p.outcome === "good").length;
    const rate = good / highBuyPool.length;
    if (rate >= GATE_LEARNING_BUY_STRONG_RATE && buys.length < GATE_LEARNING_MIN_SCORED) {
      // Strong when we buy high-P, but few buys overall → study gate may be starving entries
      const to = clip("studySdsMin", applied.studySdsMin - GATE_LEARNING_STEP);
      if (to < applied.studySdsMin) {
        pending.push({
          kind: "study_sds",
          from: applied.studySdsMin,
          to,
          evidenceN: highBuyPool.length,
          evidenceRate: Math.round(rate * 1000) / 10,
          computedAt: now,
          reason: `High-P BUY wins ${Math.round(rate * 100)}% (n=${highBuyPool.length}) but few BUY signals overall. Soften study SDS floor.`,
          reasonIt: `BUY ad alta P vincono al ${Math.round(rate * 100)}% (n=${highBuyPool.length}) ma i segnali BUY sono pochi. Ammorbidisci il floor SDS studio.`,
        });
      }
    } else if (rate <= GATE_LEARNING_BUY_WEAK_RATE && highBuyPool.length >= GATE_LEARNING_MIN_SCORED) {
      const to = clip("studySdsMin", applied.studySdsMin + GATE_LEARNING_STEP);
      if (to > applied.studySdsMin) {
        pending.push({
          kind: "study_sds",
          from: applied.studySdsMin,
          to,
          evidenceN: highBuyPool.length,
          evidenceRate: Math.round(rate * 1000) / 10,
          computedAt: now,
          reason: `High-P BUY weak (${Math.round(rate * 100)}% win, n=${highBuyPool.length}). Raise study SDS floor.`,
          reasonIt: `BUY ad alta P deboli (${Math.round(rate * 100)}% win, n=${highBuyPool.length}). Alza il floor SDS studio.`,
        });
      }
    }
  }

  return { pending, scoredN: scored.length };
}

/** Recompute pending proposals and persist (does not auto-apply). */
export function refreshGateLearningProposals(points: AdviceCalibrationPoint[]): GateLearningState {
  const prev = loadGateLearningState();
  const { pending, scoredN } = evaluateGateLearningProposals(points, prev.applied);
  let next: GateLearningState = {
    ...prev,
    pending,
    lastEvaluatedAt: new Date().toISOString(),
    lastScoredN: scoredN,
  };
  if (pending.length > 0) {
    const detail = pending.map((p) => `${p.kind}: ${p.from}→${p.to}`).join("; ");
    next = pushLog(next, "propose", detail);
  }
  persist(next);
  return next;
}

export function applyGateLearningProposals(): GateLearningState {
  const prev = loadGateLearningState();
  if (prev.pending.length === 0) return prev;
  const applied = { ...prev.applied };
  for (const p of prev.pending) {
    if (p.kind === "rescue_reg") applied.rescueSellRegMin = clip("rescueSellRegMin", p.to);
    if (p.kind === "study_sds") applied.studySdsMin = clip("studySdsMin", p.to);
  }
  const detail = prev.pending.map((p) => `${p.kind}: ${p.from}→${p.to}`).join("; ");
  let next: GateLearningState = {
    ...prev,
    applied,
    pending: [],
  };
  next = pushLog(next, "apply", detail);
  persist(next);
  return next;
}

export function revertGateLearningToBaseline(): GateLearningState {
  const prev = loadGateLearningState();
  let next: GateLearningState = {
    ...prev,
    applied: { ...GATE_LEARNING_BASELINE },
    pending: [],
  };
  next = pushLog(next, "revert", "Reset to baseline (Reg 45 / SDS 40)");
  persist(next);
  return next;
}

export function clearGateLearningPending(): GateLearningState {
  const prev = loadGateLearningState();
  let next: GateLearningState = { ...prev, pending: [] };
  next = pushLog(next, "clear", "Cleared pending proposals");
  persist(next);
  return next;
}

export function thresholdsDifferFromBaseline(t: GateLearningThresholds): boolean {
  return (
    t.rescueSellRegMin !== GATE_LEARNING_BASELINE.rescueSellRegMin ||
    t.studySdsMin !== GATE_LEARNING_BASELINE.studySdsMin
  );
}
