import { describe, expect, it } from "vitest";
import { stockMove3dPctAfterAssignment } from "./mcsEntryMove3d";
import { getMcsForDate, type MarketContextSnapshotDoc } from "./marketContextScore";
import type { InvestSimHistoryPoint } from "./investSimStorage";

describe("getMcsForDate", () => {
  const doc: MarketContextSnapshotDoc = {
    history: [
      { date: "2026-06-10", mcs_global: 40 },
      { date: "2026-06-11", mcs_global: 42 },
      { date: "2026-06-12", mcs_global: 44 },
    ],
    latest: { date: "2026-06-12", mcs_global: 44 },
  };

  it("returns exact day MCS", () => {
    expect(getMcsForDate(doc, "2026-06-11T15:00:00Z")?.mcs_global).toBe(42);
  });

  it("walks back to prior trading day when weekend gap", () => {
    expect(getMcsForDate(doc, "2026-06-13")?.mcs_global).toBe(44);
    expect(getMcsForDate(doc, "2026-06-09")).toBeNull();
  });
});

describe("stockMove3dPctAfterAssignment", () => {
  const history: InvestSimHistoryPoint[] = [
    {
      ts: "2026-06-10T16:00:00.000Z",
      byTicker: { "ABC|2026-07-01": { value: 1000, pnl: 0, pnlPct: 0 } },
    },
    {
      ts: "2026-06-11T16:00:00.000Z",
      byTicker: { "ABC|2026-07-01": { value: 1010, pnl: 10, pnlPct: 1 } },
    },
    {
      ts: "2026-06-12T16:00:00.000Z",
      byTicker: { "ABC|2026-07-01": { value: 1020, pnl: 20, pnlPct: 2 } },
    },
    {
      ts: "2026-06-13T16:00:00.000Z",
      byTicker: { "ABC|2026-07-01": { value: 1030, pnl: 30, pnlPct: 3 } },
    },
  ];

  it("computes cumulative move through 3rd day after assignment", () => {
    const move = stockMove3dPctAfterAssignment(
      history,
      "ABC|2026-07-01",
      "2026-06-10T10:00:00.000Z",
    );
    expect(move).toBe(3);
  });
});
