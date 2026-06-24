import { describe, expect, it } from "vitest";
import {
  planGapMisleadingBeat,
  planGapPctForDisplay,
  shouldUseDailyBenefitFallback,
} from "./pulsePlanGapDisplay";

describe("pulsePlanGapDisplay", () => {
  it("suppresses gap pct on micro-capital positions", () => {
    expect(planGapPctForDisplay(14.4, 4.5)).toBeNull();
    expect(planGapPctForDisplay(3.6, 12_500)).toBe(3.6);
  });

  it("flags misleading beat when deep loss but positive gap", () => {
    expect(planGapMisleadingBeat(-89.2, 1)).toBe(true);
    expect(planGapMisleadingBeat(65, 451)).toBe(false);
    expect(planGapMisleadingBeat(-89.2, -2)).toBe(false);
  });

  it("blocks 24h benefit fallback on micro / deep-loss rows", () => {
    expect(shouldUseDailyBenefitFallback({ capitalEur: 4.5, pnlPct: -89 })).toBe(false);
    expect(shouldUseDailyBenefitFallback({ capitalEur: 5000, pnlPct: 65 })).toBe(true);
  });
});
