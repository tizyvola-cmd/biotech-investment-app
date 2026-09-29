import { describe, expect, it } from "vitest";
import type { SheetTable } from "../types";
import {
  buildOperationalRecResult,
  collectOperationalHighVolTickers,
} from "./operationalRecommendation";

function fmtOffset(offsetDays: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function table(rows: Record<string, unknown>[]): SheetTable {
  return {
    columns: ["Ticker", "Completion Date", "Var. Giorn. %"],
    rows,
  };
}

describe("collectOperationalHighVolTickers", () => {
  it("unions daily surge names with flagged T_double", () => {
    expect(
      collectOperationalHighVolTickers({
        highVolTickers: ["pmvp", ""],
        volumeAccelByTicker: {
          CRDL: { flagged: true, doublingMinutes: 12 },
          SRPT: { flagged: false, doublingMinutes: 80 },
        },
      }).sort(),
    ).toEqual(["CRDL", "PMVP"]);
  });
});

describe("buildOperationalRecResult Off Book universe", () => {
  it("lists past-CD High Vol Soft BUY that 0–120d 'all' would drop", () => {
    const simTable = table([
      {
        Ticker: "PMVP",
        "Completion Date": fmtOffset(-18),
        "Var. Giorn. %": 2.4,
      },
    ]);
    const result = buildOperationalRecResult({
      simTable,
      inputs: {},
      highVolTickers: ["PMVP"],
      volumeAccelByTicker: {
        PMVP: { flagged: true, doublingMinutes: 18, score: 0.05, rvol: 4 },
      },
    });
    expect(result.buys.map((b) => b.ticker)).toContain("PMVP");
    expect(result.buys.find((b) => b.ticker === "PMVP")?.isHighVol).toBe(true);
  });

  it("lists CD > 4 months Off Book Soft BUY High Vol", () => {
    const simTable = table([
      {
        Ticker: "MSLE",
        "Completion Date": fmtOffset(150),
        "Var. Giorn. %": 1.8,
      },
    ]);
    const result = buildOperationalRecResult({
      simTable,
      inputs: {},
      volumeAccelByTicker: {
        MSLE: { flagged: true, doublingMinutes: 22, score: 0.04, rvol: 3 },
      },
    });
    expect(result.buys.map((b) => b.ticker)).toContain("MSLE");
  });

  it("does not evaluate past-CD names that are not High Vol", () => {
    const simTable = table([
      {
        Ticker: "NRIX",
        "Completion Date": fmtOffset(-2),
        "Var. Giorn. %": 3,
      },
    ]);
    const result = buildOperationalRecResult({
      simTable,
      inputs: {},
    });
    expect(result.buys.map((b) => b.ticker)).not.toContain("NRIX");
    expect(
      [...result.byKey.keys()].some((k) => k.toUpperCase().startsWith("NRIX|")),
    ).toBe(false);
  });
});
