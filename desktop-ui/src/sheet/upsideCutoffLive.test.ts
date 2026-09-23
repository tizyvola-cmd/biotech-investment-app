import { describe, expect, it } from "vitest";
import { buildUpsideCutoffLiveSummary } from "./upsideCutoffLive";
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";

function table(rows: Record<string, unknown>[]): SheetTable {
  return { sheet: "Simulation", columns: Object.keys(rows[0] ?? {}), rows };
}

/** CD ~45d ahead so rows stay in hot/watch monitor for the cutoff filter. */
function cdInMonitor(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 45);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("buildUpsideCutoffLiveSummary", () => {
  it("computes PF capture and sweet-spot AND rule", () => {
    const cd = cdInMonitor();
    const simTable = table([
      {
        Ticker: "WIN",
        "Completion Date": cd,
        "Var. Giorn. %": 3,
        "Capitale Investito ($)": 0,
      },
      {
        Ticker: "HELD",
        "Completion Date": cd,
        "Var. Giorn. %": 1,
        "Capitale Investito ($)": 5000,
        "Prezzo Acquisto ($)": 10,
        "Prezzo Corrente ($)": 10.1,
      },
      {
        Ticker: "LOSE",
        "Completion Date": cd,
        "Var. Giorn. %": -2,
        "Capitale Investito ($)": 0,
      },
    ]);
    const inputs: InvestSimInputs = {
      [`HELD|${cd}`]: { buyPrice: 10, capital: 5000 },
    };
    const scores = new Map([
      [`WIN|${cd}`, { key: `WIN|${cd}`, sds: 30, pplan: 60 }],
      [`LOSE|${cd}`, { key: `LOSE|${cd}`, sds: 30, pplan: 60 }],
      [`HELD|${cd}`, { key: `HELD|${cd}`, sds: 40, pplan: 55 }],
    ]);
    const s = buildUpsideCutoffLiveSummary(simTable, inputs, scores);
    expect(s).not.toBeNull();
    expect(s!.sweetSpot.n).toBeGreaterThanOrEqual(1);
    expect(s!.growthStreak).toBeDefined();
    expect(s!.growthStreak.rule).toMatch(/↑≥2d/);
    // Without chart prior-day prices, growth streak stays empty (fail closed).
    expect(s!.growthStreak.n).toBe(0);
    expect(s!.pfCapturePct).not.toBeNull();
  });

  it("fills growth streak when Yahoo prior-session % is green", () => {
    const cd = cdInMonitor();
    const simTable = table([
      {
        Ticker: "WIN",
        "Completion Date": cd,
        "Var. Giorn. %": 3,
        "Capitale Investito ($)": 0,
      },
      {
        Ticker: "FLAT",
        "Completion Date": cd,
        "Var. Giorn. %": 2,
        "Capitale Investito ($)": 0,
      },
    ]);
    const scores = new Map([
      [`WIN|${cd}`, { key: `WIN|${cd}`, sds: 30, pplan: 60 }],
      [`FLAT|${cd}`, { key: `FLAT|${cd}`, sds: 30, pplan: 60 }],
    ]);
    const s = buildUpsideCutoffLiveSummary(simTable, {}, scores, null, {
      WIN: 1.5,
      FLAT: -0.4,
    });
    expect(s!.growthStreak.n).toBe(1);
    expect(s!.growthStreak.tickers).toEqual(["WIN"]);
  });
});
