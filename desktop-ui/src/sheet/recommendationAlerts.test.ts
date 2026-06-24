import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  ackRecommendationAlerts,
  detectNewRecommendationAlerts,
  meetsRecommendationAlertConfidence,
  RECOMMENDATION_ALERT_MIN_PROB_PCT,
  recommendationActionSignature,
  recommendationSignature,
} from "./recommendationAlerts";
import type { SuggestionMonitorRow } from "./suggestionMonitor";

function sigRow(
  overrides: Partial<
    Pick<
      SuggestionMonitorRow,
      "suggestedAction" | "exitDecision" | "investVerdict" | "probPct" | "planReturnPct" | "readings"
    >
  > = {},
): Pick<
  SuggestionMonitorRow,
  "suggestedAction" | "exitDecision" | "investVerdict" | "probPct" | "planReturnPct" | "readings"
> {
  return {
    suggestedAction: "buy",
    exitDecision: "hold",
    investVerdict: "yes",
    probPct: 62,
    planReturnPct: 8,
    readings: { precatKind: "enter" } as SuggestionMonitorRow["readings"],
    ...overrides,
  };
}

describe("recommendationAlerts", () => {
  it("builds stable signature from recommendation fields", () => {
    expect(recommendationSignature(sigRow())).toBe("buy|hold|yes|62|enter|8.0");
  });

  it("changes signature when action flips", () => {
    const buy = recommendationSignature(sigRow());
    const sell = recommendationSignature(sigRow({ suggestedAction: "sell", exitDecision: "exit" }));
    expect(buy).not.toBe(sell);
  });

  it("action signature is stable when prob or exit drifts", () => {
    const a = recommendationActionSignature(sigRow({ probPct: 76, exitDecision: "watch" }));
    const b = recommendationActionSignature(sigRow({ probPct: 62, exitDecision: "accumulate" }));
    expect(a).toBe("buy");
    expect(b).toBe("buy");
    expect(recommendationSignature(sigRow({ probPct: 76 }))).not.toBe(
      recommendationSignature(sigRow({ probPct: 62 })),
    );
  });

  it("action signature changes when recommendation flips", () => {
    expect(recommendationActionSignature(sigRow({ suggestedAction: "buy" }))).toBe("buy");
    expect(recommendationActionSignature(sigRow({ suggestedAction: "sell" }))).toBe("sell");
  });

  it("requires P(plan) at or above alert threshold", () => {
    expect(RECOMMENDATION_ALERT_MIN_PROB_PCT).toBe(60);
    expect(meetsRecommendationAlertConfidence({ probPct: 57, synthExposureKind: "none", hasPosition: false, inPaperPortfolio: false, profile: "opportunity" })).toBe(false);
    expect(meetsRecommendationAlertConfidence({ probPct: 60, synthExposureKind: "none", hasPosition: false, inPaperPortfolio: false, profile: "opportunity" })).toBe(true);
    expect(meetsRecommendationAlertConfidence({ probPct: 72, synthExposureKind: "none", hasPosition: false, inPaperPortfolio: false, profile: "opportunity" })).toBe(true);
    expect(meetsRecommendationAlertConfidence({ probPct: null, synthExposureKind: "none", hasPosition: false, inPaperPortfolio: false, profile: "opportunity" })).toBe(false);
    expect(
      meetsRecommendationAlertConfidence({
        probPct: 40,
        synthExposureKind: "trim_review",
        hasPosition: true,
        inPaperPortfolio: false,
        profile: "portfolio",
      }),
    ).toBe(true);
  });
});

describe("detectNewRecommendationAlerts action ack", () => {
  const localStore = new Map<string, string>();

  beforeEach(() => {
    localStore.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => localStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        localStore.set(k, v);
      },
    });
    vi.stubGlobal("window", {});
    localStorage.setItem("supernova_recommendation_alerts_bootstrapped_v1", "1");
  });

  it("does not re-alert after ack when only prob or exit changes", () => {
    const alert = {
      key: "AGIO|2026-06-30",
      ticker: "AGIO",
      completionDate: "30/06/2026",
      seriesKey: null,
      suggestedAction: "hold" as const,
      signature: "hold|hold|yes|76|enter|0.7",
      alertKind: "standard" as const,
      synthTargetCapEur: null,
    };
    ackRecommendationAlerts([alert]);
    const driftedSig = "hold|watch|yes|62|enter|0.7";
    localStorage.setItem(
      "supernova_recommendation_alerts_seen_v1",
      JSON.stringify({ [alert.key]: driftedSig }),
    );
    localStorage.setItem(
      "supernova_recommendation_alerts_action_seen_v1",
      JSON.stringify({ [alert.key]: "hold" }),
    );
    expect(
      detectNewRecommendationAlerts({
        simTable: { sheet: "Simulation", columns: [], rows: [] },
        inputs: {},
        pointsBySeriesKey: new Map(),
        lang: "en",
        probOptions: null,
        paperPortfolio: [],
      }),
    ).toEqual([]);
  });
});
