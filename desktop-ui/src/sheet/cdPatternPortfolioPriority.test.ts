import { describe, expect, it } from "vitest";
import type { CdPatternTickerRecommendation } from "./cdPatternRecommendation";
import { CD_PATTERN_WINDOWS } from "./cdPatternHorizons";
import {
  cdProximityUrgency,
  computeCdPatternPriorityIndex,
  sortCdPatternByPortfolioPriority,
  sortCdPatternByMatchScore,
} from "./cdPatternPortfolioPriority";

function mockRec(overrides: Partial<CdPatternTickerRecommendation> = {}): CdPatternTickerRecommendation {
  return {
    key: "TK|2026-06-01",
    ticker: "TK",
    company: null,
    completionDate: "2026-06-01",
    daysToCd: 10,
    nowOffset: -10,
    window: CD_PATTERN_WINDOWS[2]!,
    arcPositionLabel: "",
    segmentRoiPct: 5,
    radarCurrent: [80, 80, 80, 80, 80],
    radarTarget: [100, 100, 100, 100, 100],
    axes: [],
    matchPct: 80,
    verdict: "strong",
    nearestEis: null,
    ...overrides,
  };
}

describe("cdPatternPortfolioPriority", () => {
  it("ranks closer CD higher urgency", () => {
    expect(cdProximityUrgency(5)).toBeGreaterThan(cdProximityUrgency(45));
  });

  it("portfolio low-match near CD gets attention boost", () => {
    const hotWeak = computeCdPatternPriorityIndex({
      rec: mockRec({ matchPct: 40, daysToCd: 5, verdict: "weak", window: CD_PATTERN_WINDOWS[4]! }),
      inPortfolio: true,
    });
    const hotStrong = computeCdPatternPriorityIndex({
      rec: mockRec({ matchPct: 85, daysToCd: 5, verdict: "strong", window: CD_PATTERN_WINDOWS[4]! }),
      inPortfolio: true,
    });
    expect(hotWeak).toBeGreaterThan(40);
    expect(hotStrong).toBeGreaterThan(hotWeak);
  });

  it("sorts portfolio before non-portfolio", () => {
    const a = mockRec({ key: "A|cd", ticker: "A" });
    const b = mockRec({ key: "B|cd", ticker: "B", matchPct: 99 });
    const pf = new Map<string, boolean>([["A|cd", true]]);
    const sorted = sortCdPatternByPortfolioPriority([b, a], pf);
    expect(sorted[0]!.ticker).toBe("A");
  });

  it("sorts by match pct descending", () => {
    const low = mockRec({ key: "L|cd", ticker: "L", matchPct: 50 });
    const high = mockRec({ key: "H|cd", ticker: "H", matchPct: 97 });
    const mid = mockRec({ key: "M|cd", ticker: "M", matchPct: 75 });
    const sorted = sortCdPatternByMatchScore([low, mid, high]);
    expect(sorted.map((r) => r.ticker)).toEqual(["H", "M", "L"]);
  });
});
