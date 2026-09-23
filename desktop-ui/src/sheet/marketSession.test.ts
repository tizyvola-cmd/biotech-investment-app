import { describe, expect, it } from "vitest";
import {
  formatSessionDayKey,
  isUsEquitySessionDay,
  lastUsEquityCloseSessionKey,
  lastUsEquitySessionDayKey,
  nyseSessionsElapsedSince,
  nySessionCloseIso,
  portfolioDailyPnlSessionContext,
  portfolioHistoryMarkIso,
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

  it("close session key stays on last close through weekend and intraday", () => {
    const sun = new Date("2026-07-05T16:00:00Z");
    expect(lastUsEquityCloseSessionKey(sun)).toBe("2026-07-02");

    const tueMid = new Date("2026-07-07T18:00:00Z");
    expect(lastUsEquityCloseSessionKey(tueMid)).toBe("2026-07-06");

    const tueAfterClose = new Date("2026-07-07T22:00:00Z");
    expect(lastUsEquityCloseSessionKey(tueAfterClose)).toBe("2026-07-07");
  });

  it("portfolio history marks use last close off-session, wall clock in RTH", () => {
    const sun = new Date("2026-08-09T09:56:30.000Z"); // Sunday UTC
    expect(isUsEquitySessionDay(sun)).toBe(false);
    expect(portfolioHistoryMarkIso(sun)).toBe(nySessionCloseIso("2026-08-07"));

    // Fri 14:00 ET (EDT) — still regular session → wall clock
    const friRth = new Date("2026-08-07T18:00:00.000Z");
    expect(isUsEquitySessionDay(friRth)).toBe(true);
    expect(portfolioHistoryMarkIso(friRth)).toBe(friRth.toISOString());

    // Fri 17:00 ET — after close → pin to 16:00 ET
    const friAh = new Date("2026-08-07T21:00:00.000Z");
    expect(portfolioHistoryMarkIso(friAh)).toBe(nySessionCloseIso("2026-08-07"));
  });

  it("counts NYSE sessions elapsed after the buy day", () => {
    const buyMon = "2026-08-10T18:00:00.000Z"; // Mon 14:00 ET
    expect(nyseSessionsElapsedSince(buyMon, new Date("2026-08-10T20:00:00.000Z"))).toBe(0);
    expect(nyseSessionsElapsedSince(buyMon, new Date("2026-08-12T20:00:00.000Z"))).toBe(2);
    expect(nyseSessionsElapsedSince(buyMon, new Date("2026-08-13T20:00:00.000Z"))).toBe(3);
    // Friday buy → Monday is only 1 session, not 3 calendar days
    expect(
      nyseSessionsElapsedSince("2026-08-07T18:00:00.000Z", new Date("2026-08-10T20:00:00.000Z")),
    ).toBe(1);
  });
});
