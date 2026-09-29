import { describe, expect, it } from "vitest";
import { visitSnapshotLooksLikeSameSessionPoison } from "./dashboardVisitSnapshot";

describe("visitSnapshotLooksLikeSameSessionPoison", () => {
  it("flags a leave snapshot written seconds ago at the same portfolio MTM", () => {
    expect(
      visitSnapshotLooksLikeSameSessionPoison(
        {
          savedAt: new Date().toISOString(),
          portfolioPnlEur: 1004,
          tickers: {},
        },
        1004,
      ),
    ).toBe(true);
  });

  it("keeps a real prior from earlier in the day", () => {
    expect(
      visitSnapshotLooksLikeSameSessionPoison(
        {
          savedAt: "2026-08-10T08:00:00.000Z",
          portfolioPnlEur: 700,
          tickers: {},
        },
        1004,
        Date.parse("2026-08-10T20:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
