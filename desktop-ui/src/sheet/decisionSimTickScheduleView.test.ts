import { describe, expect, it } from "vitest";
import {
  decisionSimMarketHourKey,
  formatRomeScheduleSlot,
  getRomeClockParts,
  nextDailyEvaluationSlot,
  nextExperimentMarketSlot,
} from "./investDecisionSimSchedule";
import { describeDecisionSimTickSchedule } from "./decisionSimTickScheduleView";
import type { DecisionSimState } from "./investDecisionSimLoop";
import { defaultDecisionSimState } from "./investDecisionSimStorage";

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

function baseState(overrides: Partial<DecisionSimState> = {}): DecisionSimState {
  return { ...defaultDecisionSimState(), ...overrides };
}

describe("nextExperimentMarketSlot", () => {
  it("returns current hour when in window and not excluded", () => {
    const at = romeWallToUtc("2026-06-10", 17, 0);
    const slot = nextExperimentMarketSlot(at);
    expect(slot?.hourKey).toBe("2026-06-10T17");
  });

  it("skips excluded hour and returns next", () => {
    const at = romeWallToUtc("2026-06-10", 17, 0);
    const slot = nextExperimentMarketSlot(at, "2026-06-10T17");
    expect(slot?.hourKey).toBe("2026-06-10T18");
  });
});

describe("nextDailyEvaluationSlot", () => {
  it("returns today 18:00 when before evaluation hour", () => {
    const at = romeWallToUtc("2026-06-10", 10);
    const slot = nextDailyEvaluationSlot(at);
    expect(slot).toEqual({ ymd: "2026-06-10", hour: 18 });
  });

  it("skips today when day already evaluated", () => {
    const at = romeWallToUtc("2026-06-10", 10);
    const slot = nextDailyEvaluationSlot(at, "2026-06-10");
    expect(slot?.ymd).toBe("2026-06-11");
    expect(slot?.hour).toBe(18);
  });
});

describe("describeDecisionSimTickSchedule", () => {
  it("marks due_now inside experiment window without tick this hour", () => {
    const at = romeWallToUtc("2026-06-10", 17);
    const view = describeDecisionSimTickSchedule(
      baseState({
        config: {
          ...defaultDecisionSimState().config,
          enabled: true,
          experimentMode: true,
        },
        lastTickAt: null,
      }),
      at,
      "en",
    );
    expect(view.status).toBe("due_now");
    expect(view.nextSlotLabel).toBe(formatRomeScheduleSlot("2026-06-10", 17, at, "en"));
  });

  it("waits for next hour after tick in same slot", () => {
    const at = romeWallToUtc("2026-06-10", 17, 30);
    const lastTick = romeWallToUtc("2026-06-10", 17, 0).toISOString();
    const view = describeDecisionSimTickSchedule(
      baseState({
        config: {
          ...defaultDecisionSimState().config,
          enabled: true,
          experimentMode: true,
        },
        lastTickAt: lastTick,
      }),
      at,
      "en",
    );
    expect(view.status).toBe("waiting");
    expect(view.nextSlotLabel).toBe(formatRomeScheduleSlot("2026-06-10", 18, at, "en"));
  });

  it("reports outside_window on weekend", () => {
    const at = romeWallToUtc("2026-06-13", 16);
    const view = describeDecisionSimTickSchedule(
      baseState({
        config: {
          ...defaultDecisionSimState().config,
          enabled: true,
          experimentMode: true,
        },
      }),
      at,
      "en",
    );
    expect(view.status).toBe("outside_window");
    expect(view.nextSlotLabel).toMatch(/Mon|lun/i);
  });
});
