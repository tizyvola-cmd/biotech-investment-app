import { describe, expect, it } from "vitest";
import {
  countOffPortfolioByCdHorizon,
  filterOffPortfolioByCdHorizonSimRows,
} from "./simCdHorizonScope";
import type { InvestSimInputs } from "./investSimStorage";

const inputs: InvestSimInputs = {};

function row(ticker: string, cd: string) {
  return { Ticker: ticker, "Completion Date": cd };
}

describe("simCdHorizonScope off-portfolio filters", () => {
  it("splits hot and watch off-portfolio rows", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fmt = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    };

    const rows = [row("HOT1", fmt(30)), row("WATCH1", fmt(90)), row("BEYOND", fmt(150))];

    const counts = countOffPortfolioByCdHorizon(rows, inputs);
    expect(counts.hot).toBe(1);
    expect(counts.watch).toBe(1);

    const hot = filterOffPortfolioByCdHorizonSimRows(rows, inputs, "hot");
    expect(hot.map((r) => r.Ticker)).toEqual(["HOT1"]);

    const watch = filterOffPortfolioByCdHorizonSimRows(rows, inputs, "watch");
    expect(watch.map((r) => r.Ticker)).toEqual(["WATCH1"]);
  });
});
