import { describe, expect, it } from "vitest";
import { mergeInvestSimInputs } from "./investSimKeys";
import type { InvestSimInputEntry } from "./investSimStorage";

describe("mergeInvestSimInputs sold position", () => {
  it("does not reopen a row closed with soldAt when merging stale disk capital", () => {
    const sold: InvestSimInputEntry = {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: "2026-05-29T10:00:00.000Z",
      investedAt: "2026-05-01T10:00:00.000Z",
    };
    const diskOpen: InvestSimInputEntry = {
      buyPrice: 12.5,
      capital: 5000,
      ignoreSheet: false,
    };
    const merged = mergeInvestSimInputs(
      { "TLX|2026-06-30": diskOpen },
      { "TLX|2026-06-30": sold },
    );
    const row = merged["TLX|2026-06-30"];
    expect(row?.capital).toBe(0);
    expect(row?.ignoreSheet).toBe(true);
    expect(row?.soldAt).toBeTruthy();
  });
});
