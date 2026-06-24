import { describe, expect, it } from "vitest";
import {
  decisionSimMarketHourKey,
  decisionSimDailyEvaluationKey,
  getRomeClockParts,
  isDecisionSimMarketWindow,
  isDecisionSimDailyEvaluationWindow,
} from "./investDecisionSimSchedule";

/** Build a UTC instant that maps to the given Rome wall clock (DST-aware). */
function romeWallToUtc(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  for (let utcH = 0; utcH < 24; utcH += 1) {
    for (const utcM of [0, 30]) {
      const candidate = new Date(Date.UTC(y, m - 1, d, utcH, utcM));
      const parts = getRomeClockParts(candidate);
      if (parts.ymd === ymd && parts.hour === hour && parts.minute === minute) {
        return candidate;
      }
    }
  }
  throw new Error(`Could not map Rome ${ymd} ${hour}:${minute}`);
}

describe("investDecisionSimSchedule", () => {
  it("allows Mon–Fri 15–22 Rome", () => {
    const monAfternoon = romeWallToUtc("2026-06-08", 16);
    const friClose = romeWallToUtc("2026-06-12", 22);
    const sat = romeWallToUtc("2026-06-13", 16);
    const monEarly = romeWallToUtc("2026-06-08", 14);

    expect(isDecisionSimMarketWindow(monAfternoon)).toBe(true);
    expect(isDecisionSimMarketWindow(friClose)).toBe(true);
    expect(isDecisionSimMarketWindow(sat)).toBe(false);
    expect(isDecisionSimMarketWindow(monEarly)).toBe(false);
  });

  it("builds one hour key per Rome slot", () => {
    const at = romeWallToUtc("2026-06-10", 17, 30);
    expect(decisionSimMarketHourKey(at)).toBe("2026-06-10T17");
    expect(decisionSimMarketHourKey(romeWallToUtc("2026-06-10", 23))).toBeNull();
  });

  it("allows daily evaluation Mon–Fri at 18 Rome only", () => {
    expect(isDecisionSimDailyEvaluationWindow(romeWallToUtc("2026-06-10", 18))).toBe(true);
    expect(isDecisionSimDailyEvaluationWindow(romeWallToUtc("2026-06-10", 17))).toBe(false);
    expect(isDecisionSimDailyEvaluationWindow(romeWallToUtc("2026-06-13", 18))).toBe(false);
    expect(decisionSimDailyEvaluationKey(romeWallToUtc("2026-06-10", 18, 0))).toBe("2026-06-10");
  });
});
