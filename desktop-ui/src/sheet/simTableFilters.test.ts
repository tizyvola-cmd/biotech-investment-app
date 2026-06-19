import { describe, expect, it } from "vitest";
import { normalizedRowKey } from "./investSimKeys";
import type { SimulationPosition } from "./simulationPosition";
import type { InvestSimInputs } from "./investSimStorage";
import {
  buildSimTableFilterCounts,
  filterActivePortfolioPositions,
  filterSimTablePositions,
} from "./simTableFilters";
import type { TopOppsSnapshot } from "./topOppsStore";

const emptyTopOpps = (): TopOppsSnapshot => ({
  hotKeys: [],
  watchKeys: [],
  top2BuyKeys: [],
  keys: [],
  keySet: new Set(),
  hotKeySet: new Set(),
  watchKeySet: new Set(),
  top2BuyKeySet: new Set(),
  publishedBy: null,
  updatedAt: 0,
});

function pos(ticker: string, cd: string, capital: number): SimulationPosition {
  return {
    key: normalizedRowKey(ticker, cd),
    ticker,
    name: ticker,
    completionDate: cd,
    currPrice: 10,
    buyPrice: 10,
    capital,
    shares: capital / 10,
    valueNow: capital,
    pnlEur: 0,
    pnlPct: 0,
    pnlUnavailable: false,
  };
}

describe("simTableFilters portfolio scope", () => {
  it("portfolio filter uses allPositions when provided (cross CD horizon)", () => {
    const near = pos("OLMA", "30/06/2026", 5000);
    const far = pos("BIIB", "15/09/2026", 5000);
    const watch = pos("PTGX", "15/08/2026", 0);
    const watchPool = [watch];
    const all = [near, far, watch];
    const rowByKey = new Map<string, Record<string, unknown>>([
      [near.key, { Ticker: "OLMA", "Completion Date": "30/06/2026" }],
      [far.key, { Ticker: "BIIB", "Completion Date": "15/09/2026" }],
      [watch.key, { Ticker: "PTGX", "Completion Date": "15/08/2026" }],
    ]);
    const inputs: InvestSimInputs = {
      [near.key]: { buyPrice: 10, capital: 5000, ignoreSheet: false },
      [far.key]: { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };

    const counts = buildSimTableFilterCounts(
      watchPool,
      rowByKey,
      inputs,
      emptyTopOpps(),
      [],
      new Map(),
      [],
      all,
    );
    expect(counts.portfolio).toBe(2);

    const filtered = filterSimTablePositions(
      watchPool,
      "portfolio",
      rowByKey,
      inputs,
      emptyTopOpps(),
      [],
      new Map(),
      [],
      all,
    );
    expect(filtered.map((p) => p.ticker).sort()).toEqual(["BIIB", "OLMA"]);
    expect(filterActivePortfolioPositions(watchPool, rowByKey, inputs)).toHaveLength(0);
  });
});
