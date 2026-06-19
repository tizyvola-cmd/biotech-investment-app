import { describe, expect, it } from "vitest";
import {
  LEDGER_VISIBLE_DAYS,
  addLedgerDays,
  buildLedgerDayWindow,
  isDayInLedgerWindow,
  ledgerWindowStartKey,
  resolveDefaultLedgerWindowEnd,
} from "./ledgerDayWindow";

describe("ledgerDayWindow", () => {
  it("builds 5 consecutive days ending on end key", () => {
    const window = buildLedgerDayWindow("2026-06-10", 5);
    expect(window).toHaveLength(LEDGER_VISIBLE_DAYS);
    expect(window[0]).toBe("2026-06-06");
    expect(window[4]).toBe("2026-06-10");
  });

  it("addLedgerDays shifts calendar dates", () => {
    expect(addLedgerDays("2026-06-10", -1)).toBe("2026-06-09");
    expect(addLedgerDays("2026-06-01", -1)).toBe("2026-05-31");
  });

  it("isDayInLedgerWindow marks inclusive range", () => {
    expect(isDayInLedgerWindow("2026-06-06", "2026-06-10")).toBe(true);
    expect(isDayInLedgerWindow("2026-06-05", "2026-06-10")).toBe(false);
    expect(isDayInLedgerWindow("2026-06-10", "2026-06-10")).toBe(true);
  });

  it("ledgerWindowStartKey is end minus 4", () => {
    expect(ledgerWindowStartKey("2026-06-10")).toBe("2026-06-06");
  });

  it("default end prefers today when ledger has past data", () => {
    expect(
      resolveDefaultLedgerWindowEnd(["2026-05-28", "2026-06-09"], "2026-06-10"),
    ).toBe("2026-06-10");
  });

  it("default end uses last ledger day when today is before first snapshot", () => {
    expect(
      resolveDefaultLedgerWindowEnd(["2026-06-01", "2026-06-05"], "2026-05-20"),
    ).toBe("2026-06-05");
  });
});
