import { describe, expect, it } from "vitest";
import {
  formatSessionDayKey,
  isUsEquitySessionDay,
  lastUsEquitySessionDayKey,
  portfolioDailyPnlSessionContext,
} from "./marketSession";

describe("marketSession", () => {
  it("treats Saturday NY as closed", () => {
    const sat = new Date("2026-06-13T15:00:00Z");
    expect(isUsEquitySessionDay(sat)).toBe(false);
    expect(lastUsEquitySessionDayKey(sat)).toBe("2026-06-12");
  });

  it("treats Friday NY as open", () => {
    const fri = new Date("2026-06-12T15:00:00Z");
    expect(isUsEquitySessionDay(fri)).toBe(true);
    expect(lastUsEquitySessionDayKey(fri)).toBe("2026-06-12");
  });

  it("session context on weekend", () => {
    const sat = new Date("2026-06-13T15:00:00Z");
    const ctx = portfolioDailyPnlSessionContext(sat);
    expect(ctx.marketOpen).toBe(false);
    expect(ctx.lastSessionDayKey).toBe("2026-06-12");
  });

  it("formats session day label", () => {
    expect(formatSessionDayKey("2026-06-12", "it")).toMatch(/12\/06/);
    expect(formatSessionDayKey("2026-06-12", "en")).toMatch(/06\/12/);
  });
});
