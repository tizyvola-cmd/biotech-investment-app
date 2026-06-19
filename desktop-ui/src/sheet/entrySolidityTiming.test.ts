import { describe, expect, it } from "vitest";
import {
  entryTimingAllowsInvestNow,
  entryTimingBand,
  entryTimingSolidityFailures,
  entryTimingSolidityPoints,
  ENTRY_TIMING_PEAK_MAX_DAYS,
  ENTRY_TIMING_PEAK_MIN_DAYS,
} from "./entrySolidityTiming";

describe("entrySolidityTiming", () => {
  it("peak T−11…T−3 scores +10", () => {
    for (let d = ENTRY_TIMING_PEAK_MIN_DAYS; d <= ENTRY_TIMING_PEAK_MAX_DAYS; d++) {
      expect(entryTimingSolidityPoints(d)).toBe(10);
      expect(entryTimingBand(d)).toBe("peak");
      expect(entryTimingAllowsInvestNow(d)).toBe(true);
    }
  });

  it("pre-peak 12–60 stays positive", () => {
    expect(entryTimingSolidityPoints(30)).toBeGreaterThan(2);
    expect(entryTimingSolidityPoints(60)).toBeGreaterThan(0);
    expect(entryTimingBand(45)).toBe("pre_peak");
    expect(entryTimingAllowsInvestNow(45)).toBe(true);
  });

  it("beyond 2 months is slightly negative", () => {
    expect(entryTimingSolidityPoints(72)).toBeLessThan(0);
    expect(entryTimingSolidityPoints(72)).toBeGreaterThan(-2);
    expect(entryTimingBand(82)).toBe("beyond_hot");
    expect(entryTimingAllowsInvestNow(82)).toBe(false);
  });

  it("binary zone T−2…T−0 is low and blocks invest now", () => {
    expect(entryTimingSolidityPoints(2)).toBe(2);
    expect(entryTimingAllowsInvestNow(2)).toBe(false);
    expect(entryTimingSolidityFailures(2).map((f) => f.code)).toEqual(["timing_binary"]);
  });

  it("watch list emits timing_beyond_hot not precat_too_early", () => {
    const fails = entryTimingSolidityFailures(84);
    expect(fails).toHaveLength(1);
    expect(fails[0]?.code).toBe("timing_beyond_hot");
  });
});
