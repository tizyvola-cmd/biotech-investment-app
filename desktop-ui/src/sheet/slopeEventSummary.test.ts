import { describe, expect, it } from "vitest";
import type { SlopeEventKind, SlopeEventRecord } from "./slopeEventLog";
import {
  resolveSlopeErrorTone,
  summarizeSlopeFeedRow,
} from "./slopeEventSummary";
import type { UnifiedSlopeFeedRow } from "./slopeEventsFeed";

function slopeRow(
  kind: SlopeEventKind,
  slope5d: number,
  slope20d: number,
  delta: number,
): UnifiedSlopeFeedRow {
  return {
    source: "slope",
    id: "test",
    ticker: "TLX",
    cd: "2026-06-30",
    detected_at: Date.now(),
    kind,
    detail: "",
    had_open_position: true,
    hasActiveChart: false,
    slopeEvent: {
      id: "test",
      ticker: "TLX",
      cd: "2026-06-30",
      detected_at: Date.now(),
      kind,
      slope5d,
      slope20d,
      delta_pp_per_day: delta,
      days_to_cd_at_detection: 30,
      had_open_position: true,
      price_at_detection: 9.5,
    } as SlopeEventRecord,
  };
}

describe("resolveSlopeErrorTone", () => {
  it("deceleration → slowdown (yellow)", () => {
    expect(resolveSlopeErrorTone(slopeRow("slope_dec", -0.2, -0.5, -0.3))).toBe("slowdown");
  });

  it("acceleration → positive (green)", () => {
    expect(resolveSlopeErrorTone(slopeRow("slope_acc", 0.6, 0.2, 0.4))).toBe("positive");
  });

  it("reversal to positive 5d slope → positive (TLX-like)", () => {
    expect(resolveSlopeErrorTone(slopeRow("slope_rev", 0.38, -0.88, 1.26))).toBe("positive");
  });

  it("reversal to negative 5d slope → negative", () => {
    expect(resolveSlopeErrorTone(slopeRow("slope_rev", -0.08, 0.4, -0.48))).toBe("negative");
  });

  it("summarize applies tone to shiftCls and badge", () => {
    const s = summarizeSlopeFeedRow(slopeRow("slope_rev", 0.38, -0.88, 1.26), "en");
    expect(s.shiftCls).toContain("signal-up");
    expect(s.kindMeta.pillCls).toContain("signal-up");
  });
});
