import { describe, expect, it } from "vitest";
import { keepCatalystForTable } from "./TickerCatalystEventsTable";

describe("keepCatalystForTable", () => {
  const today = new Date("2026-09-03T12:00:00");

  it("keeps every future date", () => {
    expect(keepCatalystForTable("2026-12-01", today)).toBe(true);
    expect(keepCatalystForTable("2029-04-01", today)).toBe(true);
  });

  it("keeps today and recent past within 12 months", () => {
    expect(keepCatalystForTable("2026-09-03", today)).toBe(true);
    expect(keepCatalystForTable("2025-09-04", today)).toBe(true);
    expect(keepCatalystForTable("2025-09-03", today)).toBe(true);
  });

  it("drops past events older than 12 months", () => {
    expect(keepCatalystForTable("2025-09-02", today)).toBe(false);
    expect(keepCatalystForTable("2019-11-27", today)).toBe(false);
    expect(keepCatalystForTable("2022-03-15", today)).toBe(false);
  });
});
