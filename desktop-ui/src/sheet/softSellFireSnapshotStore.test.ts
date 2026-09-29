import { describe, expect, it, beforeEach } from "vitest";
import {
  clearSoftSellFireSnapshotsForTests,
  getSoftSellFireSnapshot,
  recordSoftSellFireOnce,
} from "./softSellFireSnapshotStore";

const BASE = {
  key: "SKYE|cd",
  ticker: "SKYE",
  investedAt: "2026-08-10T14:00:00.000Z",
  ts: "2026-08-12T20:00:00.000Z",
  pnlPct: -1.6,
  pplan: 62,
  riskV2: 48,
  reg: 40,
  sessionsElapsed: 2,
  deepFloor: false,
  g1Hit: true,
  g2: false,
  reason: "pnl≤-2.5% · riskV2≥40",
};

describe("softSellFireSnapshotStore", () => {
  beforeEach(() => {
    clearSoftSellFireSnapshotsForTests();
  });

  it("first write wins for the same open run", () => {
    const first = recordSoftSellFireOnce(BASE);
    const second = recordSoftSellFireOnce({
      ...BASE,
      ts: "2026-08-13T20:00:00.000Z",
      pnlPct: -8,
    });
    expect(second).toEqual(first);
    expect(getSoftSellFireSnapshot("SKYE|cd", BASE.investedAt)?.pnlPct).toBe(-1.6);
  });

  it("keeps a new run after a different investedAt", () => {
    recordSoftSellFireOnce(BASE);
    recordSoftSellFireOnce({
      ...BASE,
      investedAt: "2026-08-20T14:00:00.000Z",
      pnlPct: -12,
      deepFloor: true,
    });
    expect(getSoftSellFireSnapshot("SKYE|cd", BASE.investedAt)?.pnlPct).toBe(-1.6);
    expect(
      getSoftSellFireSnapshot("SKYE|cd", "2026-08-20T14:00:00.000Z")?.pnlPct,
    ).toBe(-12);
  });
});
