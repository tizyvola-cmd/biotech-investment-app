import { describe, expect, it } from "vitest";
import {
  buildDealUrgencyByKey,
  classifyDealTemperature,
  DEAL_HOT_MAX_DAYS,
} from "./recommendationDealUrgency";
import type { RecommendationGainIdea } from "./recommendationGainIdea";

function idea(gainEur: number, days: number): RecommendationGainIdea {
  return {
    gainEur,
    days,
    returnPct: 10,
    adjustedReturnPct: 10,
    capitalEur: 10_000,
    miiScale: 1,
    provisional: false,
    source: "plan_target",
    unavailableReason: null,
  };
}

describe("classifyDealTemperature", () => {
  it("marks ≤24h as hot", () => {
    expect(classifyDealTemperature(80, DEAL_HOT_MAX_DAYS)).toBe("hot");
    expect(classifyDealTemperature(120, 1)).toBe("hot");
  });

  it("marks >24h as cold", () => {
    expect(classifyDealTemperature(196, 17)).toBe("cold");
    expect(classifyDealTemperature(100, 49)).toBe("cold");
  });

  it("returns null for non-positive gain", () => {
    expect(classifyDealTemperature(0, 5)).toBeNull();
    expect(classifyDealTemperature(-10, 3)).toBeNull();
  });
});

describe("buildDealUrgencyByKey", () => {
  it("assigns flame to hot and ice to cold rows", () => {
    const map = buildDealUrgencyByKey([
      { key: "a", idea: idea(90, 1) },
      { key: "b", idea: idea(196, 17) },
      { key: "c", idea: idea(22, 69) },
    ]);
    expect(map.get("a")?.temperature).toBe("hot");
    expect(map.get("b")?.temperature).toBe("cold");
    expect(map.get("c")?.temperature).toBe("cold");
    expect(map.get("b")!.intensity).toBeGreaterThan(map.get("c")!.intensity);
  });
});
