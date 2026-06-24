import { describe, expect, it } from "vitest";
import {
  inWatchEntryWindow,
  qualifiesWatchZoneEnter,
  resolveWatchEntryThresholds,
  resolveWatchTimingPredMin,
  watchPrecatProbOverride,
  WATCH_FWD_PROVISIONAL_MIN,
} from "./watchZoneEntryPolicy";

describe("watchZoneEntryPolicy", () => {
  it("watch window is T-61…T-120", () => {
    expect(inWatchEntryWindow(60)).toBe(false);
    expect(inWatchEntryWindow(61)).toBe(true);
    expect(inWatchEntryWindow(110)).toBe(true);
    expect(inWatchEntryWindow(121)).toBe(false);
  });

  it("provisional target lowers fwd min", () => {
    const th = resolveWatchEntryThresholds(110, { targetProvisional: true });
    expect(th?.fwdMin).toBe(WATCH_FWD_PROVISIONAL_MIN);
  });

  it("strong match + provisional lowers timing floor", () => {
    expect(
      resolveWatchTimingPredMin({
        daysToCd: 110,
        targetProvisional: true,
        matchPct: 78,
        dailyPct24h: 2.4,
      }),
    ).toBeLessThanOrEqual(25);
    expect(
      resolveWatchTimingPredMin({
        daysToCd: 110,
        targetProvisional: true,
        matchPct: 78,
      }),
    ).toBeLessThanOrEqual(30);
  });

  it("far watch timing floor respects achievable ceiling at T-90", () => {
    const floor = resolveWatchTimingPredMin({ daysToCd: 90 });
    expect(floor).toBeLessThanOrEqual(30);
    expect(floor).toBeGreaterThanOrEqual(22);
  });

  it("watchPrecatProbOverride requires momentum signal", () => {
    expect(
      watchPrecatProbOverride({
        daysToCd: 110,
        probPct: 63,
        matchPct: 78,
        precatKind: "too_early",
        targetProvisional: true,
      }),
    ).toBe(true);
    expect(
      watchPrecatProbOverride({
        daysToCd: 110,
        probPct: 63,
        matchPct: 78,
        precatKind: "too_early",
      }),
    ).toBe(false);
  });

  it("CCCC-like qualifies via timing bypass (strong match + provisional + daily)", () => {
    const simRow = { "R²": 0.7, "Affidabilità %": 72 };
    const q = qualifiesWatchZoneEnter({
      daysToCd: 110,
      probPct: 68,
      forwardPct: 1.9,
      dailyPct24h: 2.4,
      matchPct: 78,
      targetProvisional: true,
      simRow,
    });
    expect(q.qualified).toBe(true);
  });

  it("weak profile still blocked without momentum", () => {
    const simRow = { "R²": 0.45, "Affidabilità %": 40 };
    const q = qualifiesWatchZoneEnter({
      daysToCd: 110,
      probPct: 63,
      forwardPct: 1.9,
      dailyPct24h: 0.2,
      matchPct: 45,
      targetProvisional: false,
      simRow,
    });
    expect(q.qualified).toBe(false);
  });
});
