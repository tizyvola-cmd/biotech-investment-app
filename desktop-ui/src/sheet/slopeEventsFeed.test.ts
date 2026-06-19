import { describe, expect, it } from "vitest";
import {
  dedupeSlopeFeedByTickerCdKind,
  slopeEventToFeedRow,
  type UnifiedSlopeFeedRow,
} from "./slopeEventsFeed";
import type { SlopeEventRecord } from "./slopeEventLog";

function slopeRow(
  overrides: Partial<SlopeEventRecord> & Pick<SlopeEventRecord, "ticker" | "cd" | "kind" | "detected_at">,
): UnifiedSlopeFeedRow {
  const base: SlopeEventRecord = {
    days_to_cd_at_detection: 30,
    slope5d: -0.03,
    slope20d: 0.27,
    delta_pp_per_day: -0.06,
    run_up_30d: null,
    regime: "flat",
    pred_pct_median: null,
    had_open_position: true,
    price_at_detection: null,
    confirmed: null,
    actual_pnl_pct: null,
    confirmed_slope5d: null,
    resolution_at: null,
    ...overrides,
    id: overrides.id ?? `${overrides.ticker}-${overrides.detected_at}`,
  };
  return slopeEventToFeedRow(base);
}

describe("dedupeSlopeFeedByTickerCdKind", () => {
  it("keeps only the latest event per ticker+cd+kind", () => {
    const older = slopeRow({
      ticker: "VYGR",
      cd: "22/06/2026",
      kind: "slope_dec",
      detected_at: 1_000,
      id: "old",
    });
    const newer = slopeRow({
      ticker: "VYGR",
      cd: "2026-06-22",
      kind: "slope_dec",
      detected_at: 9_000,
      id: "new",
    });
    const out = dedupeSlopeFeedByTickerCdKind([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new");
  });

  it("keeps distinct kinds for the same ticker", () => {
    const rev = slopeRow({
      ticker: "VYGR",
      cd: "22/06/2026",
      kind: "slope_rev",
      detected_at: 5_000,
    });
    const dec = slopeRow({
      ticker: "VYGR",
      cd: "22/06/2026",
      kind: "slope_dec",
      detected_at: 4_000,
    });
    const out = dedupeSlopeFeedByTickerCdKind([rev, dec]);
    expect(out).toHaveLength(2);
  });
});
