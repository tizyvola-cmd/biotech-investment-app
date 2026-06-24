import { describe, expect, it } from "vitest";
import {
  isPortfolioPnlLoss,
  pickTop2SellCandidates,
  type Top2PickSignal,
} from "./top2PortfolioPick";

function mockSignal(
  partial: Partial<Top2PickSignal> & Pick<Top2PickSignal, "ticker" | "cd">,
): Top2PickSignal {
  return {
    hasPosition: true,
    planReturnPct: 8,
    planCdReturnPct: 6,
    precatExpectedReturn: null,
    pred5: 2,
    slope20d: 0.5,
    stabilityVerdict: "persistent",
    precatKind: "enter",
    upsideScore: 0,
    ...partial,
  };
}

describe("pickTop2SellCandidates", () => {
  it("includes P&L loss positions even when slope is rising (no sustained decline)", () => {
    const signals = [
      mockSignal({
        ticker: "OLMA",
        cd: "30/06/2026",
        pnlEur: -274,
        pnlPct: -5.47,
        slope20d: 0.4,
        planReturnPct: 9,
      }),
      mockSignal({
        ticker: "TELA",
        cd: "30/06/2026",
        pnlEur: -181,
        pnlPct: -3.63,
        slope20d: 0.3,
        planReturnPct: 10,
      }),
      mockSignal({
        ticker: "BCAB",
        cd: "30/06/2026",
        hasPosition: true,
        pnlEur: 523,
        pnlPct: 10.5,
        slope20d: 0.6,
      }),
    ];

    const sell = pickTop2SellCandidates(signals, new Set());
    expect(sell.map((s) => s.ticker)).toEqual(["OLMA", "TELA"]);
    expect(sell.every((s) => isPortfolioPnlLoss(s))).toBe(true);
  });

  it("prioritizes sustained decline over P&L loss when both exist", () => {
    const signals = [
      mockSignal({
        ticker: "LOSS",
        cd: "30/06/2026",
        pnlEur: -50,
        pnlPct: -1,
        slope20d: 0.2,
        planReturnPct: 5,
      }),
      mockSignal({
        ticker: "DECLINE",
        cd: "30/06/2026",
        pnlEur: -10,
        pnlPct: -0.2,
        slope20d: -0.5,
        slopeRotationFlag: 0,
        planReturnPct: -2,
        stabilityVerdict: "exit",
        simRow: {
          "Slope 5d": -0.6,
          "Slope 20d": -0.5,
          "Slope 45d": -0.4,
        },
      }),
    ];

    const sell = pickTop2SellCandidates(signals, new Set());
    expect(sell[0]?.ticker).toBe("DECLINE");
  });
});
