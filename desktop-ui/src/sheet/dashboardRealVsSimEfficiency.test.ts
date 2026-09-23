import { describe, expect, it } from "vitest";
import {
  buildDashboardRealVsSimEfficiency,
  dashboardRealVsSimSub,
} from "./dashboardRealVsSimEfficiency";
import { buildSimLoopActivityMetrics } from "./dashboardSimLoopActivity";
import { defaultDecisionSimState } from "./investDecisionSimStorage";

describe("dashboardRealVsSimEfficiency", () => {
  it("computes gap between real closed win rate and sim advice precision", () => {
    const kpi = buildDashboardRealVsSimEfficiency({
      closed: {
        winRatePct: 50,
        winCount: 12,
        lossCount: 8,
        sampleSize: 20,
        expectancyEurPerTrade: 10,
        realizedDailyPnlEur: null,
        lowSample: false,
      },
      simAdvicePct: 95.9,
      simGood: 27,
      simBad: 2,
      liveAdvice: {
        overallSuccessRatePct: 72,
        scoredCount: 8,
        pendingCount: 2,
        goodCount: 6,
        badCount: 2,
        lowProb: { count: 0, good: 0, bad: 0, successRatePct: null },
        midProb: { count: 0, good: 0, bad: 0, successRatePct: null },
        highProb: { count: 0, good: 0, bad: 0, successRatePct: null },
      },
    });
    expect(kpi.realClosedWinPct).toBe(50);
    expect(kpi.simAdvicePct).toBe(95.9);
    expect(kpi.gapRealVsSimPp).toBe(-45.9);
    expect(dashboardRealVsSimSub(kpi, "en")).toContain("sim 95.9%");
    expect(dashboardRealVsSimSub(kpi, "en")).toContain("Δ real−sim");
  });

  it("prepends sim loop activity fragment to sub-line", () => {
    const state = {
      ...defaultDecisionSimState(),
      ticks: [{ at: "2026-06-10T15:00:00Z", trades: [{ key: "x", action: "BUY" as const }] }],
      scorecard: {
        ...defaultDecisionSimState().scorecard,
        goodBuyCount: 5,
        badBuyCount: 2,
      },
    };
    const activity = buildSimLoopActivityMetrics(state);
    const kpi = buildDashboardRealVsSimEfficiency({
      closed: null,
      simAdvicePct: 71.4,
      simGood: 5,
      simBad: 2,
      liveAdvice: {
        overallSuccessRatePct: null,
        scoredCount: 0,
        pendingCount: 0,
        goodCount: 0,
        badCount: 0,
        lowProb: { count: 0, good: 0, bad: 0, successRatePct: null },
        midProb: { count: 0, good: 0, bad: 0, successRatePct: null },
        highProb: { count: 0, good: 0, bad: 0, successRatePct: null },
      },
      activity,
    });
    const sub = dashboardRealVsSimSub(kpi, "en");
    expect(sub).toMatch(/^1 tick · 1 move · 2 err/);
    expect(sub).toContain("sim 71.4%");
  });
});
