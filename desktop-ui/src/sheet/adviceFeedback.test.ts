import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  ADVICE_FEEDBACK_DEMOTE_BAD_RATE,
  ADVICE_FEEDBACK_MIN_ACTION_SAMPLES,
  ADVICE_FEEDBACK_MULTIPLIER_MAX,
  ADVICE_FEEDBACK_MULTIPLIER_MIN,
  applyAdviceFeedback,
  buildAdviceFeedback,
  clearAdviceFeedback,
  correctProbabilityPct,
  demoteAction,
  loadAdviceFeedback,
  saveAdviceFeedback,
  shouldAutoApplyAdviceFeedback,
  applyAdviceFeedbackAutoIfDue,
  adviceFeedbackRulesKey,
} from "./adviceFeedback";
import {
  aggregateAdviceCalibrationBuckets,
  type AdviceActionKind,
  type AdviceCalibrationPoint,
  type BadAdviceDiagnosis,
} from "./investDecisionSimAdviceCalibration";

function installBrowserShim(): { restore: () => void } {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const w = {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    constructor(
      public type: string,
      public init?: unknown,
    ) {}
  };
  return {
    restore: () => {
      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    },
  };
}

function makePoint(
  i: number,
  probPct: number,
  outcome: "good" | "bad" | "pending",
  action: AdviceActionKind = "buy",
): AdviceCalibrationPoint {
  const bucketId = probPct < 50 ? "lt50" : probPct < 60 ? "50-59" : probPct < 70 ? "60-69" : probPct < 80 ? "70-79" : "80+";
  return {
    id: `tick-${i}|key-${i}`,
    ticker: `T${i}`,
    probPct,
    bucketId,
    bucketLabel: bucketId,
    outcome,
    pnlPct: null,
    priceChangePct: null,
    expectedReturnPct: null,
    forecastErrorPct: null,
    suggestedAction: action,
    source: "live",
    kind: "test",
    at: `2026-06-${(i % 28) + 1}`.padStart(10, "0"),
  };
}

describe("adviceFeedback", () => {
  describe("buildAdviceFeedback - bucket multipliers", () => {
    it("returns no bucket correction when too few samples", () => {
      const points: AdviceCalibrationPoint[] = [
        makePoint(1, 55, "good"),
        makePoint(2, 55, "bad"),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      expect(fb.bucketCorrections.size).toBe(0);
    });

    it("computes multiplier = success_rate / avg_declared", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 5 }, (_, i) => makePoint(i, 55, "good")),
        ...Array.from({ length: 5 }, (_, i) => makePoint(i + 5, 55, "bad")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const corr = fb.bucketCorrections.get("50-59");
      expect(corr).toBeDefined();
      expect(corr!.multiplier).toBeCloseTo(50 / 55, 2);
      expect(corr!.samples).toBe(10);
    });

    it("clips multiplier to [min, max]", () => {
      const points: AdviceCalibrationPoint[] = Array.from(
        { length: 10 },
        (_, i) => makePoint(i, 55, "good"),
      );
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const corr = fb.bucketCorrections.get("50-59");
      expect(corr!.multiplier).toBeLessThanOrEqual(ADVICE_FEEDBACK_MULTIPLIER_MAX);
      expect(corr!.multiplier).toBeGreaterThanOrEqual(ADVICE_FEEDBACK_MULTIPLIER_MIN);
      expect(corr!.multiplierRaw).toBeCloseTo(100 / 55, 2);
    });
  });

  describe("buildAdviceFeedback - action demotions", () => {
    it("does not demote when bad-rate is below threshold", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 6 }, (_, i) => makePoint(i, 55, "good", "sell")),
        ...Array.from({ length: 4 }, (_, i) => makePoint(i + 6, 55, "bad", "sell")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      expect(fb.actionDemotions.size).toBe(0);
    });

    it("demotes SELL→REVIEW when bad-rate ≥ threshold and samples ≥ min", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 3 }, (_, i) => makePoint(i, 55, "good", "sell")),
        ...Array.from({ length: 7 }, (_, i) => makePoint(i + 3, 55, "bad", "sell")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const rule = fb.actionDemotions.get("50-59|sell");
      expect(rule).toBeDefined();
      expect(rule!.from).toBe("sell");
      expect(rule!.to).toBe("review");
      expect(rule!.badRate).toBeGreaterThanOrEqual(ADVICE_FEEDBACK_DEMOTE_BAD_RATE);
      expect(rule!.samples).toBeGreaterThanOrEqual(ADVICE_FEEDBACK_MIN_ACTION_SAMPLES);
    });

    it("picks the dominant root cause from supplied diagnoses", () => {
      const points: AdviceCalibrationPoint[] = Array.from({ length: 10 }, (_, i) =>
        makePoint(i, 55, i < 7 ? "bad" : "good", "sell"),
      );
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const diag: Map<string, BadAdviceDiagnosis> = new Map();
      points
        .filter((p) => p.outcome === "bad")
        .forEach((p, idx) => {
          diag.set(p.id, {
            category: idx < 5 ? "direction_wrong" : "noise_24h",
            summaryIt: "",
            summaryEn: "",
          });
        });
      const fb = buildAdviceFeedback(points, buckets, diag);
      const rule = fb.actionDemotions.get("50-59|sell");
      expect(rule?.dominantRootCause).toBe("direction_wrong");
    });
  });

  describe("correctProbabilityPct", () => {
    it("returns identity when no feedback or bucket not covered", () => {
      const fb = buildAdviceFeedback([], []);
      const r = correctProbabilityPct(53, fb);
      expect(r.correctedPct).toBe(53);
      expect(r.applied).toBe(false);
      expect(r.multiplier).toBe(1);
    });

    it("applies multiplier when bucket has correction", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 5 }, (_, i) => makePoint(i, 55, "good")),
        ...Array.from({ length: 5 }, (_, i) => makePoint(i + 5, 55, "bad")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const r = correctProbabilityPct(55, fb);
      expect(r.bucketId).toBe("50-59");
      expect(r.applied).toBe(true);
      expect(r.correctedPct).toBeLessThan(55);
      expect(r.correctedPct).toBeGreaterThan(0);
    });

    it("treats sub-epsilon corrections as not-applied", () => {
      // 5 good + 5 bad at P(plan)=50 ⇒ success_rate = 50, avg = 50,
      // multiplier = 1.0 ⇒ no material correction.
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 5 }, (_, i) => makePoint(i, 50, "good")),
        ...Array.from({ length: 5 }, (_, i) => makePoint(i + 5, 50, "bad")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const r = correctProbabilityPct(50, fb);
      expect(r.applied).toBe(false);
      expect(r.correctedPct).toBe(50);
    });
  });

  describe("demoteAction", () => {
    it("returns null when no demotion rule applies", () => {
      const fb = buildAdviceFeedback([], []);
      expect(demoteAction("buy", 75, fb).demotedTo).toBeNull();
    });

    it("returns the target action and rule when triggered", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 2 }, (_, i) => makePoint(i, 55, "good", "buy")),
        ...Array.from({ length: 8 }, (_, i) => makePoint(i + 2, 55, "bad", "buy")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const r = demoteAction("buy", 55, fb);
      expect(r.demotedTo).toBe("review");
      expect(r.reason?.from).toBe("buy");
    });
  });

  describe("applyAdviceFeedback (combined)", () => {
    it("returns null when no feedback active", () => {
      const fb = buildAdviceFeedback([], []);
      expect(applyAdviceFeedback("buy", 55, fb)).toBeNull();
    });

    it("returns a record with both correction and demotion when both fire", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 2 }, (_, i) => makePoint(i, 55, "good", "buy")),
        ...Array.from({ length: 8 }, (_, i) => makePoint(i + 2, 55, "bad", "buy")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      const r = applyAdviceFeedback("buy", 55, fb);
      expect(r).not.toBeNull();
      expect(r!.probPctRaw).toBe(55);
      expect(r!.probPctCorrected).toBeLessThan(55);
      expect(r!.actionEffective).toBe("review");
      expect(r!.demotion).not.toBeNull();
    });
  });

  describe("persistence", () => {
    let shim: { restore: () => void } | null = null;
    beforeEach(() => {
      shim = installBrowserShim();
      clearAdviceFeedback();
    });
    afterEach(() => {
      shim?.restore();
      shim = null;
    });

    it("round-trips an applied feedback through localStorage", () => {
      const points: AdviceCalibrationPoint[] = [
        ...Array.from({ length: 5 }, (_, i) => makePoint(i, 55, "good")),
        ...Array.from({ length: 5 }, (_, i) => makePoint(i + 5, 55, "bad")),
      ];
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      const fb = buildAdviceFeedback(points, buckets);
      saveAdviceFeedback(fb);
      const reloaded = loadAdviceFeedback();
      expect(reloaded).not.toBeNull();
      expect(reloaded!.bucketCorrections.get("50-59")?.multiplier).toBeCloseTo(
        fb.bucketCorrections.get("50-59")!.multiplier,
        4,
      );
    });

    it("returns null after clearing", () => {
      const points: AdviceCalibrationPoint[] = Array.from({ length: 10 }, (_, i) =>
        makePoint(i, 55, i < 5 ? "good" : "bad"),
      );
      const buckets = aggregateAdviceCalibrationBuckets(points, "en");
      saveAdviceFeedback(buildAdviceFeedback(points, buckets));
      clearAdviceFeedback();
      expect(loadAdviceFeedback()).toBeNull();
    });
  });
});

describe("adviceFeedback auto-apply", () => {
  function feedbackWithDemotion(): ReturnType<typeof buildAdviceFeedback> {
    const points: AdviceCalibrationPoint[] = [
      ...Array.from({ length: 3 }, (_, i) => makePoint(i, 55, "good", "sell")),
      ...Array.from({ length: 7 }, (_, i) => makePoint(i + 3, 55, "bad", "sell")),
    ];
    return buildAdviceFeedback(points, aggregateAdviceCalibrationBuckets(points, "en"));
  }

  it("adviceFeedbackRulesKey ignores generatedAt", () => {
    const fb = feedbackWithDemotion();
    const fb2 = { ...fb, generatedAt: "2099-01-01T00:00:00.000Z", scoredPoints: 999 };
    expect(adviceFeedbackRulesKey(fb)).toBe(adviceFeedbackRulesKey(fb2));
  });

  it("shouldAutoApply when demotions exist and nothing stored", () => {
    const pending = feedbackWithDemotion();
    expect(shouldAutoApplyAdviceFeedback(pending, null)).toBe(true);
  });

  it("should not auto-apply when rules unchanged", () => {
    const pending = feedbackWithDemotion();
    expect(shouldAutoApplyAdviceFeedback(pending, pending)).toBe(false);
  });

  describe("applyAdviceFeedbackAutoIfDue persists when due", () => {
    let shim: ReturnType<typeof installBrowserShim>;
    beforeEach(() => {
      shim = installBrowserShim();
    });
    afterEach(() => {
      shim.restore();
    });

    it("writes once then skips unchanged rules", () => {
      const pending = feedbackWithDemotion();
      const result = applyAdviceFeedbackAutoIfDue(pending, null);
      expect(result.applied).toBe(true);
      expect(loadAdviceFeedback()).not.toBeNull();
      expect(applyAdviceFeedbackAutoIfDue(pending, loadAdviceFeedback()).applied).toBe(false);
    });
  });
});
