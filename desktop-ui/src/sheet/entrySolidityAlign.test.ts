import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendAlignSolidityFailures,
  passesAlignForSolidity,
} from "./entrySolidityAlign";
import type { Top2PickSignal } from "./top2PortfolioPick";
import * as entrySolidityReliability from "./entrySolidityReliability";
import type { ScoreBreakdown } from "./investSignalScore";

function mockAlignBreakdown(slopeAlign: number, label: string): ScoreBreakdown {
  return {
    slopeAlign,
    slopeAlignLabel: label,
    affidScore: 0,
    r2Score: 0,
    timingScore: 0,
    timingLabel: "",
    predScore: 0,
    predLabel: "",
    accuracyScore: 0,
    accuracyLabel: "",
    gapPct: null,
    total: 0,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function pick(over: Partial<Top2PickSignal> = {}): Top2PickSignal {
  return {
    ticker: "TLX",
    cd: "01/06/2026",
    hasPosition: false,
    days: 30,
    pred5: 2,
    planReturnPct: 3,
    precatExpectedReturn: 2,
    upsideScore: 0,
    precatKind: "enter",
    precatOriginalKind: "enter",
    stabilityVerdict: "persistent",
    affid: 0.7,
    r2: 0.8,
    ...over,
  };
}

describe("entrySolidityAlign", () => {
  it("blocks when Score Align is contrarian (slope↔pred)", () => {
    vi.spyOn(entrySolidityReliability, "pickScoreBreakdown").mockReturnValue(
      mockAlignBreakdown(-4, "Contrarian slope 5d↔pred (-4 pt)"),
    );
    const s = pick({
      precatKind: "avoid",
      precatOriginalKind: "avoid",
      pred5: 2,
      simRow: { "slope≈5": -0.2 },
    });
    expect(passesAlignForSolidity(s)).toBe(false);
    const out: { code: string; detail?: string }[] = [];
    appendAlignSolidityFailures(out, s);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("align_contrarian");
  });

  it("passes when precat avoid but Align ≥ 0 (cohort / neutral)", () => {
    const s = pick({
      precatKind: "avoid",
      precatOriginalKind: "avoid",
      pred5: 0.1,
    });
    expect(passesAlignForSolidity(s)).toBe(true);
    const out: { code: string; detail?: string }[] = [];
    appendAlignSolidityFailures(out, s);
    expect(out).toHaveLength(0);
  });
});
