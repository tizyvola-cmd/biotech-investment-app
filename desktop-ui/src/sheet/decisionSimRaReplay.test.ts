import { describe, expect, it } from "vitest";
import {
  wouldRaSimBuy,
  wouldRaSimSell,
  raEffectivePaperAction,
  type EntryRaVerdictEntry,
} from "./decisionSimRaReplay";
import {
  deriveRaEntryInvestVerdict,
  type RaEntryInvestVerdictResult,
} from "./raEntryInvestVerdict";

function mockRa(verdict: RaEntryInvestVerdictResult["verdict"]): EntryRaVerdictEntry {
  const thresholds = {
    investMinScore: 50,
    divestBelowScore: 35,
    tier: "strong" as const,
    source: "default" as const,
    snapshotWeek: null,
  };
  const entryGate = deriveRaEntryInvestVerdict({
    entryRa: 55,
    hasPosition: false,
    thresholds,
  });
  return {
    entryRa: 55,
    result: {
      verdict,
      confidence: "high",
      thresholds,
      downgraded: false,
    },
    entryGate: verdict === "buy" ? { ...entryGate, verdict: "buy" } : entryGate,
  };
}

describe("decisionSimRaReplay", () => {
  const raBuy = new Map([["A", mockRa("buy")]]);
  const raReduce = new Map([
    [
      "A",
      {
        entryRa: 30,
        result: deriveRaEntryInvestVerdict({ entryRa: 30, hasPosition: true }),
        entryGate: deriveRaEntryInvestVerdict({ entryRa: 30, hasPosition: false }),
      },
    ],
  ]);

  it("allows paper buy only when Top2 buy and RA buy", () => {
    expect(
      wouldRaSimBuy({ suggestedAction: "buy", key: "A" }, raBuy),
    ).toBe(true);
    expect(
      wouldRaSimBuy({ suggestedAction: "buy", key: "A" }, raReduce),
    ).toBe(false);
    expect(
      wouldRaSimBuy({ suggestedAction: "hold", key: "A" }, raBuy),
    ).toBe(false);
  });

  it("allows paper sell on Top2 sell or RA reduce in paper", () => {
    expect(
      wouldRaSimSell(
        { suggestedAction: "sell", key: "A", inPaperPortfolio: true },
        raBuy,
        true,
      ),
    ).toBe(true);
    expect(
      wouldRaSimSell(
        { suggestedAction: "hold", key: "A", inPaperPortfolio: true },
        raReduce,
        true,
      ),
    ).toBe(true);
    expect(
      wouldRaSimSell(
        { suggestedAction: "hold", key: "A", inPaperPortfolio: true },
        raBuy,
        true,
      ),
    ).toBe(false);
  });

  it("maps effective paper action for calibration", () => {
    expect(
      raEffectivePaperAction(
        { suggestedAction: "buy", key: "A", inPaperPortfolio: false },
        raBuy,
      ),
    ).toBe("buy");
    expect(
      raEffectivePaperAction(
        { suggestedAction: "buy", key: "A", inPaperPortfolio: false },
        raReduce,
      ),
    ).toBe("hold");
  });
});
