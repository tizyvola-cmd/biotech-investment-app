import { describe, expect, it } from "vitest";
import { buildBreakevenLogicFillSeries } from "../sheet/breakevenRecLogicFill";

describe("buildBreakevenLogicFillSeries", () => {
  it("attaches fill colors along the breakeven series", () => {
    const series = buildBreakevenLogicFillSeries(
      [
        { ts: "2026-01-01T12:00:00.000Z", label: "d0", planned: 0, actual: 0 },
        { ts: "2026-01-02T12:00:00.000Z", label: "d1", planned: 50, actual: 80 },
      ],
      [
        {
          key: "X|cd",
          ticker: "X",
          capital: 2000,
          pplan: 60,
          sds: 40,
          pcont: 55,
          pnlPct: -4,
          riskV2: 50,
          regRisk: 50,
        },
      ],
      [],
      "buy",
    );
    expect(series).toHaveLength(2);
    expect(series[1]!.fillColor).toMatch(/^rgba\(/);
    expect(series[1]!.actualFill).toBe(80);
  });
});
