import { describe, expect, it, beforeEach } from "vitest";
import type { SearchInterestRow } from "../api/supernova";
import {
  isSearchInterestScored,
  missingSearchInterestTickers,
  peekSearchInterestRows,
  rememberSearchInterestRows,
  searchInterestStoreSize,
  subscribeSearchInterestStore,
} from "./searchInterestStore";

function row(ticker: string, score: number): SearchInterestRow {
  return {
    ticker,
    interest_score: score,
    rolling_baseline_20d: score,
    interest_delta_pct: 0,
  };
}

describe("searchInterestStore", () => {
  beforeEach(() => {
    // Overwrite with empty by remembering nothing useful — store is module-global,
    // so replace known keys with empty-unscored then scored tests re-fill.
    rememberSearchInterestRows({
      ZZTEST: { ticker: "ZZTEST" },
      AAWIND: { ticker: "AAWIND" },
      BBTOP: { ticker: "BBTOP" },
    });
  });

  it("remembers scored rows and peeks by ticker list", () => {
    rememberSearchInterestRows({
      aawind: row("AAWIND", 12),
      bbtop: row("BBTOP", 40),
    });
    expect(isSearchInterestScored(peekSearchInterestRows(["AAWIND"])["AAWIND"])).toBe(true);
    expect(peekSearchInterestRows(["AAWIND", "BBTOP", "MISSING"])).toEqual({
      AAWIND: expect.objectContaining({ interest_score: 12 }),
      BBTOP: expect.objectContaining({ interest_score: 40 }),
    });
    expect(missingSearchInterestTickers(["AAWIND", "MISSING", "BBTOP"])).toEqual(["MISSING"]);
    expect(searchInterestStoreSize()).toBeGreaterThanOrEqual(2);
  });

  it("does not replace a scored print with an empty one", () => {
    rememberSearchInterestRows({ AAWIND: row("AAWIND", 22) });
    rememberSearchInterestRows({ AAWIND: { ticker: "AAWIND" } });
    expect(peekSearchInterestRows(["AAWIND"])["AAWIND"]?.interest_score).toBe(22);
  });

  it("notifies subscribers when new scores arrive", () => {
    let n = 0;
    const unsub = subscribeSearchInterestStore(() => {
      n += 1;
    });
    rememberSearchInterestRows({ AAWIND: row("AAWIND", 5) });
    expect(n).toBeGreaterThanOrEqual(1);
    unsub();
  });
});
