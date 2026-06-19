import { describe, expect, it } from "vitest";
import {
  computeRecommendationGainIdea,
  formatRecommendationGainIdeaShort,
  gainIdeaUnavailableMessage,
  miiGainScale,
  recommendationGainIdeaTooltip,
} from "./recommendationGainIdea";
import { forwardBuyGainOutlookPositive } from "./investDecisionSimLoop";
describe("recommendationGainIdea", () => {
  it("scales gain down for weak MII", () => {
    expect(miiGainScale(8)).toBeGreaterThan(miiGainScale(-6));
    const strong = computeRecommendationGainIdea({
      simRow: null,
      chartPoints: null,
      planReturnPct: 10,
      daysToTarget: 7,
      capitalEur: 5000,
      miiAngleDeg: 6,
    });
    const weak = computeRecommendationGainIdea({
      simRow: null,
      chartPoints: null,
      planReturnPct: 10,
      daysToTarget: 7,
      capitalEur: 5000,
      miiAngleDeg: -8,
    });
    expect(strong.gainEur).not.toBeNull();
    expect(weak.gainEur).not.toBeNull();
    expect(strong.gainEur!).toBeGreaterThan(weak.gainEur!);
  });

  it("requires positive forward outlook for buy gate helper", () => {
    expect(
      forwardBuyGainOutlookPositive({
        planReturnPct: -3,
        curvePeakReturnPct: -2,
        daysToCurvePeak: 31,
        pred5Pp: -0.2,
        curveRisingHold: false,
        slope5d: -0.1,
      }),
    ).toBe(false);
    expect(
      forwardBuyGainOutlookPositive({
        planReturnPct: 8,
        curvePeakReturnPct: 10,
        daysToCurvePeak: 20,
        pred5Pp: 0.4,
        curveRisingHold: false,
        slope5d: 0.1,
      }),
    ).toBe(true);
  });

  it("formats short label", () => {
    const idea = computeRecommendationGainIdea({
      simRow: null,
      chartPoints: null,
      planReturnPct: 8,
      daysToTarget: 5,
      capitalEur: 5000,
      miiAngleDeg: 2,
    });
    expect(formatRecommendationGainIdeaShort(idea, "it")).toMatch(/in 5g/);
    expect(formatRecommendationGainIdeaShort(idea, "en")).toMatch(/in 5d/);
    expect(idea.unavailableReason).toBeNull();
  });

  it("reports missing sim row when no plan fallback", () => {
    const idea = computeRecommendationGainIdea({
      simRow: null,
      chartPoints: null,
      capitalEur: 5000,
    });
    expect(idea.gainEur).toBeNull();
    expect(idea.unavailableReason).toBe("missing_sim_row");
    expect(recommendationGainIdeaTooltip(idea, "it")).toMatch(/riga simulazione assente/i);
  });

  it("reports missing chart series", () => {
    const idea = computeRecommendationGainIdea({
      simRow: { "Completion Date": "2026-12-01" },
      chartPoints: null,
      capitalEur: 5000,
    });
    expect(idea.unavailableReason).toBe("missing_chart_series");
    expect(gainIdeaUnavailableMessage("missing_chart_series", "en")).toMatch(/not loaded/i);
  });

  it("reports cd passed", () => {
    const idea = computeRecommendationGainIdea({
      simRow: { "Completion Date": "2020-01-01" },
      chartPoints: [{ offset: 0 }],
      capitalEur: 5000,
    });
    expect(idea.unavailableReason).toBe("cd_passed");
  });
});
