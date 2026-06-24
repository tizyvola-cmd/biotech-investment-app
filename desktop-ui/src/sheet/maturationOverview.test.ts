import { describe, expect, it } from "vitest";
import {
  buildMaturationOverview,
  clampMaturationChartValue,
  computeMaturationChartYDomain,
} from "./maturationOverview";
import { defaultExperimentPiggyBank } from "./investDecisionSimExperiment";
import type { PortfolioDailyPnlLedger } from "./simulationPosition";

describe("maturationOverview", () => {
  it("clamps corrupt chart values", () => {
    expect(clampMaturationChartValue(5_000_000)).toBeNull();
    expect(clampMaturationChartValue(-2301)).toBe(-2301);
  });

  it("builds Y domain in € scale when outliers are ignored", () => {
    const [min, max] = computeMaturationChartYDomain([-2301, 1246, 5_000_000, 3949]);
    expect(max).toBeLessThan(20_000);
    expect(min).toBeGreaterThan(-20_000);
  });

  it("summarizes actual, equal sim, and synth groups", () => {
    const ledger: PortfolioDailyPnlLedger = {
      dayKeys: ["2026-06-19"],
      rows: [
        {
          key: "A|cd",
          ticker: "A",
          completionDate: "cd",
          capital: 5000,
          legs: [],
          totalEur: 500,
          pnlByDay: { "2026-06-19": 100 },
          archived: false,
        },
        {
          key: "B|cd",
          ticker: "B",
          completionDate: "cd",
          capital: 5000,
          legs: [],
          totalEur: -200,
          pnlByDay: {},
          archived: true,
        },
      ],
      dayTotals: { "2026-06-19": 100 },
      grandTotal: 300,
      openDayTotals: { "2026-06-19": 100 },
      openGrandTotal: 500,
      incompleteDailyHistory: false,
      legTotalDiffersFromMtm: false,
      openRowCount: 1,
      archivedRowCount: 1,
    };

    const piggy = {
      ...defaultExperimentPiggyBank(),
      closedPnlEur: 1246,
      openMtmPnlEur: -3547,
      totalPnlEur: -2301,
      closedTradeCount: 35,
      openPositionCount: 12,
    };

    const overview = buildMaturationOverview({
      ledger,
      simTable: null,
      livePiggy: piggy,
      paperPortfolio: [
        {
          key: "A|cd",
          ticker: "A",
          capital: 5000,
          entryAt: "2026-06-01T10:00:00.000Z",
          entryReason: "buy",
          entryPlanReturnPct: 10,
          lastMarkPct: -5,
        },
      ],
      liveEvaluations: [],
      ticks: [],
      synthLatest: { closedPnlEur: 1001, openMtmEur: 3949 },
      synthSizing: { shareByRowKey: { "A|cd": 0.2 }, totalCapitalEur: 60_000 },
    });

    expect(overview).toHaveLength(3);
    expect(overview[0]?.id).toBe("actual");
    expect(overview[0]?.openDeals).toBe(1);
    expect(overview[0]?.closedDeals).toBe(1);
    expect(overview[1]?.totalPnlEur).toBe(-2301);
    expect(overview[2]?.openMtmEur).toBe(3949);
  });
});
