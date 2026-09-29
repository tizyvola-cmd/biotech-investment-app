import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetCalendarMondayPullMarker,
  romeIsoWeekKey,
  shouldReattachCalendarMondayMorning,
  markCalendarMondayPullDone,
} from "./calendarTabWeeklyCache";

describe("romeIsoWeekKey", () => {
  it("keeps Mon–Sun of the same ISO week together", () => {
    // 2026-09-07 = Monday week 37; 2026-09-13 = Sunday week 37
    const mon = Date.parse("2026-09-07T12:00:00+02:00");
    const sun = Date.parse("2026-09-13T12:00:00+02:00");
    const nextMon = Date.parse("2026-09-14T12:00:00+02:00");
    expect(romeIsoWeekKey(mon)).toBe("2026-W37");
    expect(romeIsoWeekKey(sun)).toBe("2026-W37");
    expect(romeIsoWeekKey(nextMon)).toBe("2026-W38");
  });
});

describe("shouldReattachCalendarMondayMorning", () => {
  beforeEach(() => {
    _resetCalendarMondayPullMarker();
  });

  it("fires once on Monday after 10:30 Rome", () => {
    // 2026-09-07 was a Monday in Rome (CEST)
    const monMorning = Date.parse("2026-09-07T10:35:00+02:00");
    const monEarly = Date.parse("2026-09-07T09:00:00+02:00");
    const tue = Date.parse("2026-09-08T11:00:00+02:00");
    expect(shouldReattachCalendarMondayMorning(monEarly)).toBe(false);
    expect(shouldReattachCalendarMondayMorning(monMorning)).toBe(true);
    markCalendarMondayPullDone(monMorning);
    expect(shouldReattachCalendarMondayMorning(monMorning)).toBe(false);
    expect(shouldReattachCalendarMondayMorning(tue)).toBe(false);
  });

  it("catch-up on Tuesday if Monday pull was missed", () => {
    const tue = Date.parse("2026-09-08T11:00:00+02:00");
    expect(shouldReattachCalendarMondayMorning(tue)).toBe(true);
    markCalendarMondayPullDone(tue);
    expect(shouldReattachCalendarMondayMorning(tue)).toBe(false);
  });
});
