import { describe, expect, it } from "vitest";
import {
  FDA_ADCOM_CALENDAR,
  addMonthsIso,
  fdaAdcomHorizon,
  fdaAdcomTickers,
  formatFdaAdcomDays,
  formatFdaScore,
  rowsInFdaAdcomHorizon,
  sortFdaAdcomRows,
} from "./fdaAdcomCalendar";

describe("fdaAdcomCalendar", () => {
  it("lists only NASDAQ names and includes GRAL", () => {
    const tks = fdaAdcomTickers();
    expect(tks).toContain("GRAL");
    expect(tks).toContain("GILD");
    expect(tks).toContain("AZN");
    expect(new Set(FDA_ADCOM_CALENDAR.map((r) => r.id)).size).toBe(
      FDA_ADCOM_CALENDAR.length,
    );
  });

  it("rolls month-end dates when adding three months", () => {
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsIso("2026-09-01", 3)).toBe("2026-12-01");
  });

  it("keeps the 3-month window from today", () => {
    const today = new Date("2026-09-06T12:00:00");
    const { start, end } = fdaAdcomHorizon(today);
    expect(start).toBe("2026-09-06");
    expect(end).toBe("2026-12-06");
    const windowed = rowsInFdaAdcomHorizon(FDA_ADCOM_CALENDAR, today);
    expect(windowed.every((r) => r.date >= start && r.date <= end)).toBe(true);
    expect(windowed.some((r) => r.ticker === "GRAL")).toBe(true);
    expect(windowed.some((r) => r.ticker === "AZN")).toBe(false);
  });

  it("puts upcoming dates first when sorting", () => {
    const today = new Date("2026-09-06T12:00:00");
    const sorted = sortFdaAdcomRows(rowsInFdaAdcomHorizon(FDA_ADCOM_CALENDAR, today), today);
    expect(sorted[0]?.date).toBe("2026-09-16");
    expect(sorted.some((r) => r.ticker === "GRAL")).toBe(true);
  });

  it("formats FDA score like EIS polarity", () => {
    expect(formatFdaScore(4.2)).toBe("+4.2");
    expect(formatFdaScore(-3)).toBe("-3.0");
    expect(formatFdaScore(null)).toBe("—");
  });

  it("formats days until / past", () => {
    expect(formatFdaAdcomDays(0, true)).toBe("oggi");
    expect(formatFdaAdcomDays(10, true)).toBe("10g");
    expect(formatFdaAdcomDays(-3, true)).toBe("passato");
    expect(formatFdaAdcomDays(17, false)).toBe("17d");
  });
});
