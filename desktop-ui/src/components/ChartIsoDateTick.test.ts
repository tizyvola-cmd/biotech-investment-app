import { describe, expect, it } from "vitest";
import { chartTickShowsYear } from "./ChartIsoDateTick";

describe("chartTickShowsYear", () => {
  it("shows the year on the first tick even in March", () => {
    expect(chartTickShowsYear("2026-03-04", 0)).toBe(true);
    expect(chartTickShowsYear("2026-04-17", 3)).toBe(false);
  });

  it("shows the year again in January of the next year", () => {
    expect(chartTickShowsYear("2027-01-08", 12)).toBe(true);
    expect(chartTickShowsYear("2027-02-12", 13)).toBe(false);
  });
});
