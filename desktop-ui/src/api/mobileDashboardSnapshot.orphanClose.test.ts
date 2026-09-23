import { describe, expect, it } from "vitest";
import { closeOrphanOpensNotInLocal } from "./mobileDashboardSnapshot";
import type { InvestSimInputs } from "../sheet/investSimStorage";

describe("closeOrphanOpensNotInLocal", () => {
  it("closes remote-only opens not in the Pulse key set", () => {
    const merged: InvestSimInputs = {
      "INBX|2026-01-01": {
        buyPrice: 10,
        capital: 3000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
      "ETON|2026-01-01": {
        buyPrice: 5,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const out = closeOrphanOpensNotInLocal(
      merged,
      new Set(["INBX|2026-01-01"]),
      { nowMs: Date.parse("2026-08-10T20:00:00.000Z") },
    );
    expect(out["INBX|2026-01-01"]?.capital).toBe(3000);
    expect(out["ETON|2026-01-01"]?.ignoreSheet).toBe(true);
    expect(out["ETON|2026-01-01"]?.soldAt).toBeTruthy();
  });

  it("keeps a recent mobile Soft BUY missing from Pulse", () => {
    const now = Date.parse("2026-08-10T20:00:00.000Z");
    const merged: InvestSimInputs = {
      "INBX|2026-01-01": {
        buyPrice: 10,
        capital: 3000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
      "KZIA|2026-12-01": {
        buyPrice: 8,
        capital: 5000,
        ignoreSheet: false,
        investedAt: new Date(now - 60_000).toISOString(),
      },
    };
    const out = closeOrphanOpensNotInLocal(
      merged,
      new Set(["INBX|2026-01-01"]),
      { nowMs: now },
    );
    expect(out["KZIA|2026-12-01"]?.capital).toBe(5000);
  });

  it("does not mass-close when local open set is empty", () => {
    const merged: InvestSimInputs = {
      "SRPT|2026-10-31": {
        buyPrice: 18,
        capital: 1450,
        ignoreSheet: false,
        investedAt: "2026-08-12T09:43:29.863Z",
      },
      "MSLE|2026-08-30": {
        buyPrice: 9,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-07-09T11:20:44.422Z",
      },
    };
    const out = closeOrphanOpensNotInLocal(merged, new Set(), {
      nowMs: Date.parse("2026-08-12T10:34:09.939Z"),
    });
    expect(out["SRPT|2026-10-31"]?.capital).toBe(1450);
    expect(out["MSLE|2026-08-30"]?.ignoreSheet).toBeFalsy();
  });
});
