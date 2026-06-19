import { describe, expect, it } from "vitest";
import {
  displaySynthSharesByRowKey,
  SIM_TABLE_SYNTH_MAX_SHARE,
} from "./approvedWeightPortfolioShares";
import type { ComparisonDeal } from "./threePortfolioCompare";

function deal(rowKey: string): ComparisonDeal {
  const ticker = rowKey.split("|")[0] ?? rowKey;
  return {
    rowKey,
    ticker,
    cells: {
      clinicalPhase: "P3",
      clinicalIndication: "onc",
      sdsBucket: "mid",
      pplanBucket: "mid",
    },
  } as ComparisonDeal;
}

describe("displaySynthSharesByRowKey", () => {
  it("never exceeds 25% per deal for concentrated Weight Sim Exp", () => {
    const deals = [
      deal("PTCT|2026-09-30"),
      deal("BDSX|2026-07-01"),
      deal("GPCR|2026-08-01"),
      deal("MLTX|2026-06-01"),
      deal("RYTM|2026-10-01"),
    ];
    const raw = [0.6385, 0.1744, 0.0554, 0.079, 0.0527];
    const map = displaySynthSharesByRowKey(deals, raw);
    for (const share of Object.values(map)) {
      expect(share).toBeLessThanOrEqual(SIM_TABLE_SYNTH_MAX_SHARE + 1e-9);
    }
    expect(map["PTCT|2026-09-30"]).toBeCloseTo(0.25, 5);
  });
});
