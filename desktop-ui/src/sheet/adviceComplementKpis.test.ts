import { describe, expect, it } from "vitest";
import {
  buildAdviceComplementKpis,
  computePaperRecCapture,
  summarizeClosedPnlAdvice,
} from "./adviceComplementKpis";
import { buildUnifiedAdviceSuccess } from "./unifiedAdviceSuccess";
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";

const liveAdvice: AdviceCalibrationSummary = {
  lowProb: { count: 0, good: 0, bad: 0, successRatePct: null },
  highProb: { count: 4, good: 4, bad: 0, successRatePct: 100 },
  scoredCount: 13,
  pendingCount: 3,
  goodCount: 12,
  badCount: 1,
  overallSuccessRatePct: 92.3,
};

describe("adviceComplementKpis", () => {
  it("computes capture as actual / potential 24h on executable recs", () => {
    const cap = computePaperRecCapture({
      monitorRows: [
        { suggestedAction: "buy", pnlPct24h: 2, inPaperPortfolio: false },
        { suggestedAction: "hold", pnlPct24h: 5, inPaperPortfolio: true },
        { suggestedAction: "hold", pnlPct24h: 1, inPaperPortfolio: false },
      ],
      capitalPerTrade: 5000,
      actualPnlEur: 350,
    });
    expect(cap.potentialEur).toBe(350);
    expect(cap.capturePct).toBe(100);
  });

  it("summarizes closed paper deals win rate", () => {
    const s = summarizeClosedPnlAdvice({
      rawPnlEur: 120,
      capitalEur: 5000,
      dealCount: 2,
      tickers: ["A", "B"],
      deals: [],
      winCount: 1,
      lossCount: 1,
    });
    expect(s.winRatePct).toBe(50);
  });

  it("builds complement bundle with direction vs portfolio metrics", () => {
    const unified = buildUnifiedAdviceSuccess({
      live: liveAdvice,
      paperGood: 0,
      paperBad: 0,
    });
    const k = buildAdviceComplementKpis({
      unified,
      liveAdvice,
      monitorRows: [{ suggestedAction: "buy", pnlPct24h: 1.2 }],
      capitalPerTrade: 5000,
      livePiggy: {
        openCapitalEur: 40000,
        openMtmPnlEur: 500,
        closedPnlEur: 164,
        totalPnlEur: 664,
        openPositionCount: 8,
        closedTradeCount: 1,
      },
      closedPiggy: {
        rawPnlEur: 164,
        capitalEur: 5000,
        dealCount: 1,
        tickers: ["X"],
        deals: [],
        winCount: 1,
        lossCount: 0,
      },
    });
    expect(k.direction24hPct).toBe(92.3);
    expect(k.paperReturn.returnPct).toBeCloseTo(1.5, 0);
    expect(k.closedPnl.winRatePct).toBe(100);
  });
});
