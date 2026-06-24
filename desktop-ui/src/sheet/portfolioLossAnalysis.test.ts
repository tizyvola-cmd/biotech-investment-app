import { describe, expect, it } from "vitest";
import type { ChartPoint } from "../types";
import { resolveLossExitForAlert, isUrgentPortfolioLossExit } from "./portfolioLossAnalysis";
import type { PortfolioLossAlert } from "./portfolioLossUrgent";

function chartPtsRising(): ChartPoint[] {
  const offsets = [-30, -20, -10, -7, -5, -3, 0, 4, 7];
  const pcts = [-8, -5, -2, 0, 2, 4, 6, 10, 12];
  return offsets.map((offset, i) => ({
    offset,
    pct_foglio: pcts[i],
    pct_curva: pcts[i],
    pct_reale: pcts[i] - 1,
  }));
}

describe("resolveLossExitForAlert", () => {
  it("holds when sheet slopes are negative but recalib chart path is rising with positive target", () => {
    const alert: PortfolioLossAlert = {
      key: "TLX|2026-06-30",
      ticker: "TLX",
      completionDate: "30/06/2026",
      pnlEur: -250,
      pnlPct: -5,
      capital: 5000,
      valueNow: 4750,
      buyPrice: 10.27,
      seriesKey: "co:TLX|2026-06-30",
    };
    const simRow: Record<string, unknown> = {
      Ticker: "TLX",
      "Completion Date": "30/06/2026",
      "Slope≈5 (pp/g)": -1.88,
      "Slope≈20 (pp/g)": -0.93,
      "Δ% vs Pred−60\nPred\n−5": "2%",
      "Δ% vs Pred−60\nPred\n−30": "-5%",
      "Δ% vs Pred−60\nPred\n−10": "0%",
      "Δ% vs Pred−60\nPred\n+7": "14%",
    };
    const columns = Object.keys(simRow);
    const inputs = {
      [alert.key]: { buyPrice: 10.27, capital: 5000, ignoreSheet: false },
    };

    const withoutCharts = resolveLossExitForAlert(
      alert,
      simRow,
      null,
      inputs,
      columns,
      "en",
    );
    const withCharts = resolveLossExitForAlert(
      alert,
      simRow,
      chartPtsRising(),
      inputs,
      columns,
      "en",
    );

    expect(withoutCharts.usedRecalibSlopes).toBe(false);
    expect(withCharts.usedRecalibSlopes).toBe(true);
    expect(withCharts.slope20d).not.toBe(withoutCharts.slope20d);
    expect(withCharts.curveRisingHold).toBe(true);
    expect(withCharts.recoveryProbabilityPct).toBeGreaterThanOrEqual(55);
    expect(withCharts.exitDecision).toBe("hold");
    expect(isUrgentPortfolioLossExit(withCharts)).toBe(false);
    expect(isUrgentPortfolioLossExit(withoutCharts)).toBe(true);
  });
});
