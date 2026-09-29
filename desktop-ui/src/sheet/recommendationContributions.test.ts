import { describe, expect, it } from "vitest";
import {
  buildRecommendationBreakdownModel,
  contributionSharePct,
  demoRecommendationBreakdownModel,
  deriveContributions,
  deriveGapToFlip,
  deriveSwingFactor,
} from "./recommendationContributions";
import type { DecisionScoreInput } from "./decisionChartLogic";

const VIR_HOLD: DecisionScoreInput = {
  pplan: 61,
  sds: 26,
  eis: 50,
  eisRaw: 0,
  riskV2: 50,
  regRisk: 48,
  mcs: 15,
  pnlPct: 0,
  isRescue: false,
  status: "open",
};

describe("recommendationContributions", () => {
  it("demo fixture matches VIR-like HOLD brief values", () => {
    const m = demoRecommendationBreakdownModel(false);
    expect(m.call).toBe("HOLD");
    expect(m.compositeScore).toBe(61);
    expect(m.buyThreshold).toBe(65);
    expect(m.sellThreshold).toBe(40);
    expect(m.gapToFlip).toEqual({ direction: "buy", points: 4 });
  });

  it("derives signed gate-distance pulls sorted by magnitude", () => {
    const c = deriveContributions(VIR_HOLD, false);
    expect(c[0].key).toBe("mcs");
    expect(c[0].contribution).toBe(-35);
    expect(c.find((x) => x.key === "pplan")?.contribution).toBe(-4);
    // Loss Buy cap aligned to 40 → 50 − 40 = −10 (was −15 at cap 35).
    expect(c.find((x) => x.key === "riskV2")?.contribution).toBe(-10);
    // Comfortable Reg (< 55) omitted — no phantom pro-Buy green bar.
    expect(c.find((x) => x.key === "regRisk")).toBeUndefined();
  });

  it("computes contribution share percentages", () => {
    const c = deriveContributions(VIR_HOLD, false);
    const totalShare = c.reduce((s, row) => s + contributionSharePct(c, row.key), 0);
    expect(totalShare).toBeGreaterThanOrEqual(98);
    expect(totalShare).toBeLessThanOrEqual(102);
    // |pulls| = 35+24+10+4 = 73 → pplan share ≈ 5%
    expect(contributionSharePct(c, "pplan")).toBe(5);
  });

  it("Reg elevated band shows sell-side pressure only (negative)", () => {
    const s: DecisionScoreInput = { ...VIR_HOLD, regRisk: 62 };
    const c = deriveContributions(s, false);
    expect(c.find((x) => x.key === "regRisk")?.contribution).toBe(-7); // 62 − 55
  });

  it("Reg veto (≥70) keeps negative sell pressure", () => {
    const s: DecisionScoreInput = { ...VIR_HOLD, regRisk: 75 };
    const c = deriveContributions(s, false);
    expect(c.find((x) => x.key === "regRisk")?.contribution).toBe(-20); // 75 − 55
  });

  it("swing factor picks nearest buy blocker for HOLD", () => {
    const sf = deriveSwingFactor(VIR_HOLD, "hold", false);
    expect(sf?.key).toBe("pplan");
    expect(sf?.distance).toBe(4);
    expect(sf?.direction).toBe("buy");
  });

  it("gap to flip for HOLD is +4 to buy", () => {
    expect(deriveGapToFlip(VIR_HOLD, "hold")).toEqual({ direction: "buy", points: 4 });
  });

  it("builds full model from decision chart row", () => {
    const m = buildRecommendationBreakdownModel(
      {
        key: "k",
        ticker: "VIR",
        company: null,
        phaseLabel: null,
        pnlPct: 0,
        scores: VIR_HOLD,
        rec: "hold",
        diagnostic: "hold",
        insufficientScores: false,
      },
      false,
    );
    expect(m.contributions.length).toBeGreaterThan(0);
    expect(m.isGateDistanceApprox).toBe(true);
    expect(m.contributions.find((x) => x.key === "regRisk")).toBeUndefined();
  });
});
