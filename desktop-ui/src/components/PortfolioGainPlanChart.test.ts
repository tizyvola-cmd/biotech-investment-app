import { describe, expect, it } from "vitest";
import { buildGainPlanSeries, buildHypotheticalGainPlanRow } from "./PortfolioGainPlanChart";

describe("buildGainPlanSeries historical curve", () => {
  it("adds historical lookback for off-portfolio hypothetical rows", () => {
    const simRow: Record<string, unknown> = {
      Ticker: "DSGN",
      "Completion Date": "15/07/2026",
      "Current Price": 4.5,
    };
    const chartPoints = [
      { offset: -60, pct_foglio: -8, price_storico_usd: 3.5 },
      { offset: -45, pct_foglio: -3, price_storico_usd: 3.9 },
      { offset: -30, pct_foglio: 2, price_storico_usd: 4.2 },
    ];
    const row = buildHypotheticalGainPlanRow("DSGN|2026-07-15", simRow, chartPoints, 5000);
    expect(row).not.toBeNull();
    const series = buildGainPlanSeries(row!, []);
    const historical = series.filter((p) => p.historical != null && p.day < 0);
    expect(historical.length).toBeGreaterThan(0);
    expect(series.find((p) => p.day === 0)?.historical).toBe(0);
    expect(series.every((p) => p.actual == null)).toBe(true);
  });
});
