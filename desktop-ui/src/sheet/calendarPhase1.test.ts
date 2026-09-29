import { describe, expect, it } from "vitest";
import {
  CALENDAR_FORWARD_HORIZON_DAYS,
  CALENDAR_NEAR_COMPLETE_DAYS,
  calendarSortAnchorIso,
  designationsFromText,
  isCalendarNearCompletePin,
  isCalendarOpenWindowUnderway,
  isWithinCalendarForwardHorizon,
  isWithinMigrateHorizon,
  migrationAnchorIso,
  normalizeFdaDesignationLabel,
} from "./calendarPhase1";

const TODAY = new Date("2026-09-11T12:00:00Z");

describe("calendarPhase1 horizon", () => {
  it("keeps exact dates within 6 months", () => {
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2026-10-01", window_end: "2026-10-01" },
        TODAY,
      ),
    ).toBe(true);
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2027-04-01", window_end: "2027-04-01" },
        TODAY,
      ),
    ).toBe(false);
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2028-01-01", window_end: "2028-01-01" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("drops past exact dates", () => {
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2026-08-01", window_end: "2026-08-01" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("drops fully past open windows", () => {
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2026-01-01", window_end: "2026-06-30" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("keeps open windows still alive within horizon", () => {
    expect(
      isWithinCalendarForwardHorizon(
        { window_start: "2026-07-01", window_end: "2026-12-31" },
        TODAY,
      ),
    ).toBe(true);
  });

  it("exposes 180-day forward constant", () => {
    expect(CALENDAR_FORWARD_HORIZON_DAYS).toBe(180);
  });
});

describe("calendar near-complete pin", () => {
  it("pins exact days within ~30d", () => {
    expect(
      isCalendarNearCompletePin(
        { window_start: "2026-09-25", window_end: "2026-09-25" },
        TODAY,
      ),
    ).toBe(true);
  });

  it("does not pin long Q windows already underway ending soon", () => {
    // Jul–Sep readout: start in past, end in ~19d — used to flood Calendar top as "11d"
    expect(
      isCalendarNearCompletePin(
        { window_start: "2026-07-01", window_end: "2026-09-30" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("marks long Q windows already underway for bottom section", () => {
    expect(
      isCalendarOpenWindowUnderway(
        { window_start: "2026-07-01", window_end: "2026-09-30" },
        TODAY,
      ),
    ).toBe(true);
    expect(
      isCalendarOpenWindowUnderway(
        { window_start: "2026-10-01", window_end: "2026-10-01" },
        TODAY,
      ),
    ).toBe(false);
  });

  it("pins short/near windows completing within ~30d", () => {
    expect(
      isCalendarNearCompletePin(
        { window_start: "2026-09-20", window_end: "2026-10-05" },
        TODAY,
      ),
    ).toBe(true);
  });

  it("sorts in-progress windows by end, future windows by start", () => {
    expect(
      calendarSortAnchorIso(
        { window_start: "2026-07-01", window_end: "2026-09-30" },
        TODAY,
      ),
    ).toBe("2026-09-30");
    expect(
      calendarSortAnchorIso(
        { window_start: "2026-11-01", window_end: "2026-11-01" },
        TODAY,
      ),
    ).toBe("2026-11-01");
  });

  it("exposes 30-day near-complete constant", () => {
    expect(CALENDAR_NEAR_COMPLETE_DAYS).toBe(30);
  });
});

describe("migration anchor (fuzzy = start)", () => {
  it("uses window_start for ranges", () => {
    expect(
      migrationAnchorIso({ window_start: "2026-07-01", window_end: "2026-12-31" }),
    ).toBe("2026-07-01");
  });

  it("≤20d Catalyst migrate uses start", () => {
    expect(
      isWithinMigrateHorizon(
        { window_start: "2026-07-01", window_end: "2026-12-31" },
        TODAY,
      ),
    ).toBe(false);
    expect(
      isWithinMigrateHorizon(
        { window_start: "2026-09-20", window_end: "2026-09-20" },
        TODAY,
      ),
    ).toBe(true);
    // ~45d is beyond Catalyst 20d — stays on Calendar only
    expect(
      isWithinMigrateHorizon(
        { window_start: "2026-10-26", window_end: "2026-10-26" },
        TODAY,
      ),
    ).toBe(false);
    // ~25d stays on Calendar (beyond 20d Catalyst window)
    expect(
      isWithinMigrateHorizon(
        { window_start: "2026-10-06", window_end: "2026-10-06" },
        TODAY,
      ),
    ).toBe(false);
    // ~15d migrates to Catalyst
    expect(
      isWithinMigrateHorizon(
        { window_start: "2026-09-26", window_end: "2026-09-26" },
        TODAY,
      ),
    ).toBe(true);
  });
});

describe("designationsFromText", () => {
  it("extracts standard FDA designations", () => {
    expect(
      designationsFromText("FDA granted Breakthrough Therapy and Fast Track"),
    ).toEqual(["Breakthrough Therapy", "Fast Track"]);
  });
});

describe("normalizeFdaDesignationLabel", () => {
  it("expands CamelCase AI labels", () => {
    expect(normalizeFdaDesignationLabel("BreakthroughTherapy")).toBe("Breakthrough Therapy");
    expect(normalizeFdaDesignationLabel("orphan_drug")).toBe("Orphan Drug");
    expect(normalizeFdaDesignationLabel("N/D")).toBeNull();
  });
});
