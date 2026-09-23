import { describe, expect, it, beforeEach, vi } from "vitest";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import {
  GATE_LEARNING_BASELINE,
  evaluateGateLearningProposals,
  applyGateLearningProposals,
  revertGateLearningToBaseline,
  loadGateLearningState,
  refreshGateLearningProposals,
  GATE_LEARNING_STORAGE_KEY,
} from "./gateLearningLoop";

function pt(
  partial: Partial<AdviceCalibrationPoint> &
    Pick<AdviceCalibrationPoint, "id" | "suggestedAction" | "outcome">,
): AdviceCalibrationPoint {
  return {
    ticker: "X",
    probPct: 60,
    bucketId: "60-69",
    bucketLabel: "60–69",
    pnlPct: null,
    priceChangePct: null,
    expectedReturnPct: null,
    forecastErrorPct: null,
    source: "live",
    kind: "test",
    at: "2026-07-18T00:00:00Z",
    ...partial,
  };
}

describe("gateLearningLoop", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: () => true,
    });
    localStorage.removeItem(GATE_LEARNING_STORAGE_KEY);
  });

  it("proposes lower rescue Reg when rescue-like REVIEW keeps losing", () => {
    const points: AdviceCalibrationPoint[] = Array.from({ length: 10 }, (_, i) =>
      pt({
        id: `r${i}`,
        suggestedAction: "review",
        outcome: "bad",
        pnlPct: -4,
        priceChangePct: -1.2,
        probPct: 55,
      }),
    );
    const { pending } = evaluateGateLearningProposals(points, { ...GATE_LEARNING_BASELINE });
    const reg = pending.find((p) => p.kind === "rescue_reg");
    expect(reg).toBeTruthy();
    expect(reg!.to).toBe(40);
    expect(reg!.from).toBe(45);
  });

  it("proposes higher SDS when high-P BUY is weak", () => {
    const points: AdviceCalibrationPoint[] = Array.from({ length: 10 }, (_, i) =>
      pt({
        id: `b${i}`,
        suggestedAction: "buy",
        outcome: i < 3 ? "good" : "bad",
        probPct: 70,
        priceChangePct: i < 3 ? 1 : -1,
      }),
    );
    const { pending } = evaluateGateLearningProposals(points, { ...GATE_LEARNING_BASELINE });
    const sds = pending.find((p) => p.kind === "study_sds");
    expect(sds).toBeTruthy();
    expect(sds!.to).toBe(45);
  });

  it("apply then revert restores baseline", () => {
    const points: AdviceCalibrationPoint[] = Array.from({ length: 10 }, (_, i) =>
      pt({
        id: `r${i}`,
        suggestedAction: "review",
        outcome: "bad",
        pnlPct: -5,
        priceChangePct: -2,
      }),
    );
    refreshGateLearningProposals(points);
    applyGateLearningProposals();
    expect(loadGateLearningState().applied.rescueSellRegMin).toBe(40);
    revertGateLearningToBaseline();
    expect(loadGateLearningState().applied).toEqual({ ...GATE_LEARNING_BASELINE });
  });
});
