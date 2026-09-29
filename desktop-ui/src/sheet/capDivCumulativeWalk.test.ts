import { describe, expect, it } from "vitest";
import {
  capDivWalkSessionContext,
  isCapDivDealEntryInFuture,
  resolveCapDivWalkDailyPct,
  resolveCapDivWalkTotalPct,
} from "./capDivCumulativeWalk";

describe("capDivCumulativeWalk", () => {
  it("zeros 24h on NYSE holiday (Jul 4 2026)", () => {
    const ctx = capDivWalkSessionContext(new Date("2026-07-04T15:00:00Z"));
    expect(ctx.freezeDailyWalk).toBe(true);
    expect(
      resolveCapDivWalkDailyPct(-10.66, "2026-07-03", ctx),
    ).toBe(0);
  });

  it("zeros 24h on weekend", () => {
    const ctx = capDivWalkSessionContext(new Date("2026-07-05T12:00:00Z"));
    expect(ctx.freezeDailyWalk).toBe(true);
    expect(resolveCapDivWalkDailyPct(5.2, "2026-06-20", ctx)).toBe(0);
  });

  it("passes 24h on regular trading day", () => {
    const ctx = capDivWalkSessionContext(new Date("2026-06-18T18:00:00Z"));
    expect(ctx.freezeDailyWalk).toBe(false);
    expect(resolveCapDivWalkDailyPct(-3.5, "2026-06-10", ctx)).toBe(-3.5);
  });

  it("zeros total and daily P&L for future entry dates", () => {
    const ctx = capDivWalkSessionContext(new Date("2026-07-02T18:00:00Z"));
    expect(isCapDivDealEntryInFuture("2026-07-03", ctx.nyTodayKey)).toBe(true);
    expect(resolveCapDivWalkTotalPct(12, "2026-07-03", ctx.nyTodayKey)).toBe(0);
    expect(resolveCapDivWalkDailyPct(8, "2026-07-03", ctx)).toBe(0);
  });

  it("allows P&L when entry is on or before today", () => {
    const ctx = capDivWalkSessionContext(new Date("2026-07-02T18:00:00Z"));
    expect(resolveCapDivWalkTotalPct(-4, "2026-07-02", ctx.nyTodayKey)).toBe(-4);
    expect(resolveCapDivWalkDailyPct(-4, "2026-07-02", ctx)).toBe(-4);
  });
});
