import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSnapshotStoreForTests,
  getFrozenFeatures,
} from "../calibration/featureSnapshotStore";
import { capturePaperBuyEntrySnapshots } from "./paperBuyEntrySnapshot";
import type { TickerSimEvaluation } from "./investDecisionSimLoop";

function ev(partial: Partial<TickerSimEvaluation> & Pick<TickerSimEvaluation, "key" | "ticker">): TickerSimEvaluation {
  return {
    hasPosition: false,
    inPaperPortfolio: false,
    daysToCd: 30,
    readings: {
      supernovaPeakPct: null,
      planTargetPct: null,
      planCdPct: null,
      precatKind: "enter",
      slope5d: null,
      slope20d: null,
      pred5Pp: null,
      curveGapPct: null,
      harmonyMaxGapPp: null,
      harmonyAligned: null,
      stabilityVerdict: "hold",
    },
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: "hold",
    investVerdict: "yes",
    entryVerdict: "yes",
    exitVerdict: null,
    probPct: 62,
    suggestedAction: "buy",
    planReturnPct: 8,
    pnlPct24h: 1,
    pnlPct: null,
    precatVerdictAgree: true,
    exitReason: "",
    compositeScore: 55,
    scoringZone: "hot",
    scoreBreakdown: {} as TickerSimEvaluation["scoreBreakdown"],
    compositeDampened: false,
    ...partial,
  };
}

describe("capturePaperBuyEntrySnapshots", () => {
  beforeEach(() => {
    __resetSnapshotStoreForTests();
  });

  it("freezes P and SDS at paper BUY and does not overwrite later", () => {
    const evaluation = ev({ key: "AAA|2026-09-01", ticker: "AAA", probPct: 58 });
    const first = capturePaperBuyEntrySnapshots({
      trades: [
        {
          at: "2026-07-01T15:00:00Z",
          ticker: "AAA",
          key: "AAA|2026-09-01",
          side: "buy",
          reason: "test",
          capital: 5000,
          pnlPctSimulated: null,
          pnlEurSimulated: null,
        },
      ],
      evaluations: [evaluation],
      simRowByKey: new Map([
        ["AAA|2026-09-01", { Ticker: "AAA", "Studio Phase": "PHASE3" }],
      ]),
      sdsRows: [
        { ticker: "AAA", sds: 41, zone_label: "watch", zone_color: "", zone_action: "" },
      ],
      autoRegSnap: null,
      lang: "en",
    });
    expect(first.get("AAA|2026-09-01")?.sds).toBe(41);
    expect(first.get("AAA|2026-09-01")?.pplanPct).toBe(58);
    const frozen = getFrozenFeatures("AAA|2026-09-01");
    expect(frozen?.sds).toBe(41);
    expect(frozen?.pplanPct).toBe(58);
    expect(frozen?.clinicalPhase).toBe("PHASE3");

    capturePaperBuyEntrySnapshots({
      trades: [
        {
          at: "2026-07-02T15:00:00Z",
          ticker: "AAA",
          key: "AAA|2026-09-01",
          side: "buy",
          reason: "test2",
          capital: 5000,
          pnlPctSimulated: null,
          pnlEurSimulated: null,
        },
      ],
      evaluations: [ev({ key: "AAA|2026-09-01", ticker: "AAA", probPct: 90 })],
      simRowByKey: new Map(),
      sdsRows: [
        { ticker: "AAA", sds: 90, zone_label: "hot", zone_color: "", zone_action: "" },
      ],
      autoRegSnap: null,
      lang: "en",
    });
    expect(getFrozenFeatures("AAA|2026-09-01")?.sds).toBe(41);
    expect(getFrozenFeatures("AAA|2026-09-01")?.pplanPct).toBe(58);
  });
});
