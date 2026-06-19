import { describe, expect, it } from "vitest";
import {
  pickReliabilityMetrics,
  reliabilityScoreMinForDays,
  passesReliabilityForSolidity,
} from "./entrySolidityReliability";
import type { Top2PickSignal } from "./top2PortfolioPick";

describe("entrySolidityReliability", () => {
  it("uses signalMetricsFromSimRow when simRow present", () => {
    const row = {
      Ticker: "PTGX",
      "Completion Date": "15/06/2026",
      "Affidabilità\n+5gg (%)": 0.7,
      "R² fit": 0.861,
      "slope≈5g": 0.35,
      "Δ% vs Pred−60\nPred\n−60": 0,
      "Δ% vs Pred−60\nPred\n−30": -0.0149,
      "Δ% vs Pred−60\nPred\n−10": -0.0612,
      "Δ% vs Pred−60\nPred\n+4": -0.0213,
      "Δ% vs Pred−60\nPred\n+7": -0.0213,
    };
    const pick = {
      ticker: "PTGX",
      cd: "15/06/2026",
      days: 7,
      hasPosition: false,
      pred5: 0.5,
      precatExpectedReturn: 1,
      upsideScore: 0,
      simRow: row,
    } as Top2PickSignal;
    const m = pickReliabilityMetrics(pick);
    expect(m?.score).not.toBeNull();
    expect(m!.score!).toBeGreaterThanOrEqual(50);
  });

  it("hot zone min score is score_forte_min", () => {
    expect(reliabilityScoreMinForDays(30)).toBe(50);
    expect(reliabilityScoreMinForDays(82)).toBe(35);
  });

  it("rejects when score below zone minimum", () => {
    const pick = {
      ticker: "X",
      cd: "01/06/2026",
      hasPosition: false,
      days: 30,
      pred5: 0.1,
      precatExpectedReturn: 0,
      upsideScore: 0,
      affid: 0.2,
      r2: 0.2,
    } as Top2PickSignal;
    expect(passesReliabilityForSolidity(pick)).toBe(false);
  });
});
