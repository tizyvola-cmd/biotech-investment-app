import { describe, expect, it } from "vitest";
import {
  countOffPortfolioByCdHorizon,
  countPositionsByCdHorizon,
  filterOffPortfolioByCdHorizonSimRows,
  filterPositionsByCdHorizon,
} from "./simCdHorizonScope";
import type { InvestSimInputs } from "./investSimStorage";
import type { SimulationPosition } from "./simulationPosition";

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

    const offBook = countOffPortfolioByCdHorizon(rows, inputs, {
      watchIncludesBeyond: true,
    });
    expect(offBook.hot).toBe(1);
    expect(offBook.watch).toBe(2);

    const hot = filterOffPortfolioByCdHorizonSimRows(rows, inputs, "hot");
    expect(hot.map((r) => r.Ticker)).toEqual(["HOT1"]);

    const watch = filterOffPortfolioByCdHorizonSimRows(rows, inputs, "watch");
    expect(watch.map((r) => r.Ticker)).toEqual(["WATCH1"]);
  });

  it("counts past-CD hype sidecars in Off Book", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fmt = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    };
    const rows = [
      row("HOT1", fmt(30)),
      {
        Ticker: "OLDH",
        "Completion Date": fmt(-12),
        hype_volume_funnel: true,
      },
    ];
    const offBook = countOffPortfolioByCdHorizon(rows, inputs, {
      watchIncludesBeyond: true,
    });
    expect(offBook.hot).toBe(1);
    expect(offBook.watch).toBe(1);
  });
});

function pos(ticker: string, cd: string): SimulationPosition {
  return {
    key: `${ticker}|${cd}`,
    ticker,
    name: ticker,
    completionDate: cd,
    currPrice: 1,
    buyPrice: 0,
    capital: 0,
    shares: 0,
    valueNow: 0,
    pnlEur: 0,
    pnlPct: 0,
    pnlUnavailable: false,
  };
}

describe("filterPositionsByCdHorizon Pick stocks", () => {
  it("puts far-CD hype and past catalyst-day names on Early, not Primary", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fmt = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offsetDays);
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    };

    const hotCd = fmt(28);
    const watchCd = fmt(90);
    const beyondCd = fmt(360);
    const pastCd = fmt(-30);

    const positions = [
      pos("HOT1", hotCd),
      pos("WATCH1", watchCd),
      pos("CANF", beyondCd),
      pos("BDSX", pastCd),
    ];
    const simRowByKey = new Map<string, Record<string, unknown>>([
      [`HOT1|${hotCd}`, { Ticker: "HOT1", "Completion Date": hotCd }],
      [`WATCH1|${watchCd}`, { Ticker: "WATCH1", "Completion Date": watchCd }],
      [
        `CANF|${beyondCd}`,
        { Ticker: "CANF", "Completion Date": beyondCd, hype_volume_funnel: true },
      ],
      [
        `BDSX|${pastCd}`,
        { Ticker: "BDSX", "Completion Date": pastCd, guidance_calendar_catalyst: true },
      ],
    ]);
    const emptyInputs: InvestSimInputs = {};
    const noCharts = new Map();

    const hot = filterPositionsByCdHorizon(
      positions,
      "hot",
      simRowByKey,
      emptyInputs,
      noCharts,
    );
    expect(hot.map((p) => p.ticker)).toEqual(["HOT1"]);

    const watch = filterPositionsByCdHorizon(
      positions,
      "watch",
      simRowByKey,
      emptyInputs,
      noCharts,
    );
    expect(watch.map((p) => p.ticker).sort()).toEqual(["BDSX", "CANF", "WATCH1"]);

    const counts = countPositionsByCdHorizon(
      positions,
      simRowByKey,
      emptyInputs,
      noCharts,
    );
    expect(counts.hot).toBe(1);
    expect(counts.watch).toBe(3);
  });
});
