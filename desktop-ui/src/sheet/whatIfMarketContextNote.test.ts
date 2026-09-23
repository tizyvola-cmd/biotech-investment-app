import { describe, expect, it } from "vitest";
import {
  readWhatIfMarketContext,
  whatIfLowBreadthBannerText,
  WHATIF_LOW_BREADTH_MAX,
} from "./whatIfMarketContextNote";
import type { MarketContextSnapshotDoc } from "./marketContextScore";

function doc(breadth: number, mcs = 47): MarketContextSnapshotDoc {
  return {
    update_status: "ok",
    stale_days: 0,
    latest: {
      date: "2026-07-31",
      mcs_global: mcs,
      components: { breadth: { score: breadth } },
    },
  };
}

describe("whatIfMarketContextNote", () => {
  it("flags low breadth at/below threshold", () => {
    const low = readWhatIfMarketContext(doc(13));
    expect(low.lowBreadth).toBe(true);
    expect(low.breadth).toBe(13);
    expect(low.mcs).toBe(47);
    expect(WHATIF_LOW_BREADTH_MAX).toBe(25);

    const ok = readWhatIfMarketContext(doc(40));
    expect(ok.lowBreadth).toBe(false);
  });

  it("builds banner only for low-breadth sessions", () => {
    const low = readWhatIfMarketContext(doc(13, 47));
    const msg = whatIfLowBreadthBannerText(low, false, { greenCount: 2, universeWith24h: 33 });
    expect(msg).toContain("Breadth 13/100");
    expect(msg).toContain("MCS 47");
    expect(msg).toContain("2/33 green");
    expect(whatIfLowBreadthBannerText(readWhatIfMarketContext(doc(50)), false)).toBeNull();
  });
});
