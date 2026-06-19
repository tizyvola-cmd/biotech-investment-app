/**
 * Invarianti di coerenza tra tab — eseguire con: npm run test:coherence
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { buildPrecatEntry } from "./precatCurve";
import {
  filterSlopeFeedByMaterialPriceGap,
  type UnifiedSlopeFeedRow,
} from "./slopeEventsFeed";
import {
  portfolioDailyPnlValues,
  portfolioPnlTone,
  portfolioTotalDisplayValues,
  resolvePnlTabCardTone,
} from "./portfolioGainLossStyle";
import {
  clampUpsideThresholdPct,
  UPSIDE_THRESHOLD_MAX_PCT,
  UPSIDE_THRESHOLD_MIN_PCT,
} from "./topOppsThreshold";
import { readPred5Pp, readPred5RelativePp } from "./simulationPlanGain";
import { extractCurveInputs } from "./precatCurve";
import { passesStrictTopPick } from "./topOppsStrictPick";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
} from "./simulationEntrySolidity";
import * as entrySolidityReliability from "./entrySolidityReliability";
import { resolveSimRowSlopeDisplay } from "./simTableSlopeDisplay";
import type { Top2PickSignal } from "./top2PortfolioPick";
import { SLOPE_MIN_PRICE_GAP_USD } from "./slopeEventsFeed";
import { isMaterialSlopePriceGap } from "./slopeStockPrices";
import { resolveCurveTrajectoryOutlook } from "./curveTrajectoryOutlook";
import {
  applyRegimeToPrecatKind,
  buildGatePayload,
  classifyRegime,
  effectivePrecatKindForPick,
} from "./marketContextGate";

function mockFeedRow(ticker: string): UnifiedSlopeFeedRow {
  return {
    source: "contrarian",
    id: `test-${ticker}`,
    ticker,
    cd: "30/06/2026",
    detected_at: Date.now(),
    kind: "contrarian",
    detail: "test",
    had_open_position: true,
    hasActiveChart: true,
    contrarianEvent: {
      id: `test-${ticker}`,
      ticker,
      cd: "30/06/2026",
      detected_at: Date.now(),
      days_to_cd_at_detection: 26,
      slope5d: 1.9,
      pred5: -2,
      divergence_type: "model_down",
      regime: "flat",
      had_open_position: true,
      confirmed: null,
      actual_pnl_pct: null,
      resolution_at: null,
    },
  };
}

describe("slope feed filter", () => {
  it("keeps rows when price gap is unknown (OLMA-style)", () => {
    const rows = [mockFeedRow("OLMA")];
    const out = filterSlopeFeedByMaterialPriceGap(rows, () => undefined);
    expect(out).toHaveLength(1);
  });

  it("drops rows when gap is below material threshold", () => {
    const rows = [mockFeedRow("TINY")];
    const out = filterSlopeFeedByMaterialPriceGap(rows, () => 0.15);
    expect(out).toHaveLength(0);
  });

  it("keeps rows when gap meets threshold", () => {
    const rows = [mockFeedRow("BCAB")];
    const out = filterSlopeFeedByMaterialPriceGap(rows, () => SLOPE_MIN_PRICE_GAP_USD + 0.01);
    expect(out).toHaveLength(1);
  });
});

describe("P&L tab colors", () => {
  it("total loss is loss tone even if daily is gain", () => {
    expect(portfolioPnlTone(-4000, -80)).toBe("loss");
    expect(portfolioPnlTone(50, 2)).toBe("gain");
    const total = portfolioTotalDisplayValues(-4000, -80, 50, 2);
    expect(total.tone).toBe("loss");
    const day = portfolioDailyPnlValues(50, 2);
    expect(day.tone).toBe("gain");
    expect(resolvePnlTabCardTone(-4000, -80)).toBe("loss");
  });
});

describe("precat labels vs position", () => {
  it("without position: do not add on negative slope", () => {
    const p = buildPrecatEntry(-0.5, -0.3, 0, 26, { hasPosition: false });
    expect(p.kind).toBe("avoid");
    expect(p.label).toMatch(/Don't add|Non aggiungere/i);
  });

  it("with position: consider exit on negative slope", () => {
    const p = buildPrecatEntry(-0.5, -0.3, 0, 26, { hasPosition: true });
    expect(p.kind).toBe("avoid");
    expect(p.label).toMatch(/Consider exit|Valuta uscita/i);
  });
});

describe("material slope price gap", () => {
  it("surfaces when model vs spot unknown (banner = table)", () => {
    expect(isMaterialSlopePriceGap(null, null)).toBe(true);
    expect(isMaterialSlopePriceGap(10, null)).toBe(true);
  });

  it("drops when known gap below threshold", () => {
    expect(isMaterialSlopePriceGap(10, 10.15)).toBe(false);
    expect(isMaterialSlopePriceGap(10, 10.21)).toBe(true);
  });
});

describe("readPred5RelativePp", () => {
  it("pre-CD: 5d forward on model curve, not post-CD T+5 anchor", () => {
    const row: Record<string, unknown> = {
      "Completion Date": "25/06/2026",
      "Δ% vs Pred−60\nPred\n−30": 0.02,
      "Δ% vs Pred−60\nPred\n−10": 0.06,
      "Δ% vs Pred−60\nPred\n+4": 0.08,
      "Δ% vs Pred−60\nPred\n+7": 0.14,
    };
    const abs = readPred5Pp(row);
    expect(abs).not.toBeNull();
    const rel = readPred5RelativePp(row);
    expect(rel).not.toBeNull();
    if (abs != null && rel != null) {
      expect(Math.abs(rel - abs)).toBeGreaterThan(0.05);
    }
  });

  it("uses Pred +4/+7 model grid, not cohort Pred empirica median", () => {
    const row: Record<string, unknown> = {
      "Completion Date": "25/06/2026",
      "Pred empirica\n+5gg (%)": 0.0001,
      "Δ% vs Pred−60\nPred\n+4": 0.08,
      "Δ% vs Pred−60\nPred\n+7": 0.14,
      "Δ% vs Pred−60\nPred\n−60": 0,
      "Δ% vs Pred−60\nPred\n−30": 0.02,
      "Δ% vs Pred−60\nPred\n−10": 0.06,
    };
    const abs = readPred5Pp(row);
    expect(abs).not.toBeNull();
    expect(Math.abs(abs!)).toBeGreaterThan(0.5);
    const cohortOnly = 0.0001 * 100;
    expect(Math.abs(abs! - cohortOnly)).toBeGreaterThan(0.5);
  });
});

describe("extractCurveInputs", () => {
  it("uses non-zero inferred slopes when sheet slope columns are zero", () => {
    const row: Record<string, unknown> = {
      "slope≈5g": 0,
      "slope≈20g": 0,
      "Pred -10": 0,
      "Pred -5": 10,
    };
    const c = extractCurveInputs(row);
    expect(Math.abs(c.slope5d ?? 0)).toBeGreaterThan(0.0001);
  });
});

describe("sim table slope display", () => {
  it("shows deceleration delta when slopes differ enough", () => {
    const row = { "slope≈5g": 0.2, "slope≈20g": 1.1 };
    const d = resolveSimRowSlopeDisplay(row, null, "en");
    expect(d?.kind).toBe("slope_dec");
    expect(d?.shiftLine).toMatch(/Δ/);
  });
});

describe("strict top pick", () => {
  const base = {
    ticker: "X",
    cd: "01/06/2026",
    hasPosition: false,
    days: 30,
    pred5: 2,
    planReturnPct: 3,
    precatExpectedReturn: 2,
    upsideScore: 0,
    precatKind: "enter",
    stabilityVerdict: "persistent",
    affid: 0.7,
    r2: 0.86,
  } as Top2PickSignal;

  it("rejects late precat", () => {
    expect(
      passesStrictTopPick(
        { ...base, precatKind: "late" },
        { upsideThresholdPct: 1.5, minScoreReliability: 0 },
      ),
    ).toBe(false);
  });

  it("accepts enter in peak timing window without pred5 gate", () => {
    expect(
      passesStrictTopPick(
        { ...base, pred5: 0.2 },
        { minScoreReliability: 0 },
      ),
    ).toBe(true);
  });

  it("rejects hold after macro gate", () => {
    expect(
      passesStrictTopPick(
        { ...base, precatKind: "hold", precatOriginalKind: "enter" },
        { upsideThresholdPct: 1.5, minScoreReliability: 0 },
      ),
    ).toBe(false);
  });

  it("accepts precat avoid when Score Align ≥ 0 (not binary slope avoid)", () => {
    expect(
      passesStrictTopPick(
        {
          ...base,
          precatKind: "avoid",
          precatOriginalKind: "avoid",
          pred5: 0.1,
        },
        { minScoreReliability: 0 },
      ),
    ).toBe(true);
  });
});

describe("simulation entry solidity", () => {
  const base = {
    ticker: "TLX",
    cd: "01/06/2026",
    hasPosition: false,
    days: 30,
    pred5: 2,
    planReturnPct: 3,
    precatExpectedReturn: 2,
    upsideScore: 0,
    precatKind: "hold" as const,
    precatOriginalKind: "enter" as const,
    stabilityVerdict: "persistent" as const,
    marketGate: {
      market_regime: "RISK_OFF" as const,
      regime_gate_fired: true,
      original_signal: "enter",
      gated_signal: "hold" as const,
      gate_reason: "XBI -5.9% over 5d — sector risk-off",
      entry_allowed: false,
      watch_allowed: true,
    },
  };

  it("surfaces macro-gated enter as blocked warning", () => {
    const sol = resolveSimulationEntrySolidity(base, {
      upsideThresholdPct: 1.5,
      minScoreReliability: 0,
    });
    expect(simulationSolidityVisible(sol)).toBe(true);
    expect(sol?.level).toBe("blocked");
    expect(sol?.failures.some((f) => f.code === "macro_gate_hold")).toBe(true);
  });

  it("SDS below watch is caution (not blocked) in CD watch zone", () => {
    const pick = {
      ...base,
      ticker: "VERA",
      days: 82,
      precatKind: "too_early" as const,
      precatOriginalKind: "too_early" as const,
      marketGate: undefined,
    };
    const sdsMap = new Map([
      ["VERA", { sds: 22, missing_data_pct: 0 }],
    ]);
    const sol = resolveSimulationEntrySolidity(pick, {
      upsideThresholdPct: 1.5,
      minScoreReliability: 0,
      sdsByTicker: sdsMap,
    });
    expect(simulationSolidityVisible(sol)).toBe(true);
    expect(sol?.level).toBe("caution");
    expect(sol?.failures.some((f) => f.code === "sds_below_watch")).toBe(true);
    expect(sol?.failures.some((f) => f.code === "timing_beyond_hot")).toBe(true);
    expect(sol?.failures.some((f) => f.code === "precat_too_early")).toBe(false);
    expect(sol?.timingIndex).toBeLessThan(0);
  });

  it("SDS veto stays blocked in CD watch zone", () => {
    const pick = {
      ...base,
      days: 90,
      precatKind: "too_early" as const,
      precatOriginalKind: "too_early" as const,
      marketGate: undefined,
    };
    const sdsMap = new Map([
      ["TLX", { sds: 40, veto: "CASH_CRISIS", missing_data_pct: 0 }],
    ]);
    const sol = resolveSimulationEntrySolidity(pick, {
      upsideThresholdPct: 1.5,
      minScoreReliability: 0,
      sdsByTicker: sdsMap,
    });
    expect(sol?.level).toBe("blocked");
  });

  it("surfaces align contrarian in CD watch zone (Score Align, not precat_avoid)", () => {
    vi.spyOn(entrySolidityReliability, "pickScoreBreakdown").mockReturnValue({
      slopeAlign: -4,
      slopeAlignLabel: "Contrarian slope 5d↔pred (-4 pt)",
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
    });
    const pick = {
      ...base,
      ticker: "PFE",
      days: 84,
      planReturnPct: null,
      precatKind: "avoid" as const,
      precatOriginalKind: "avoid" as const,
      pred5: 2,
      simRow: { "slope≈5": -0.25 },
      marketGate: undefined,
    };
    const sol = resolveSimulationEntrySolidity(pick, {
      upsideThresholdPct: 1.5,
      minScoreReliability: 0,
    });
    expect(simulationSolidityVisible(sol)).toBe(true);
    expect(sol?.level).toBe("blocked");
    expect(sol?.failures.some((f) => f.code === "align_contrarian")).toBe(true);
    expect(sol?.failures.some((f) => f.code === "precat_avoid")).toBe(false);
  });
});

describe("market context gate", () => {
  it("classifies risk-off on XBI 5d", () => {
    expect(
      classifyRegime({ xbi_5d_return: -4, xbi_20d_return: 0, tlt_5d_return: 0, vix_level: 20 }),
    ).toBe("RISK_OFF");
  });

  it("gates enter to hold in risk-off", () => {
    const { gated, fired } = applyRegimeToPrecatKind("enter", "RISK_OFF");
    expect(gated).toBe("hold");
    expect(fired).toBe(true);
  });

  it("effectivePrecatKindForPick uses gated signal", () => {
    const gate = buildGatePayload("enter", "RISK_OFF", { xbi_5d_return: -4.2 });
    expect(effectivePrecatKindForPick("enter", gate)).toBe("hold");
  });
});

describe("shared upside threshold", () => {
  it("clamps to configured band", () => {
    expect(clampUpsideThresholdPct(0.1)).toBe(UPSIDE_THRESHOLD_MIN_PCT);
    expect(clampUpsideThresholdPct(99)).toBe(UPSIDE_THRESHOLD_MAX_PCT);
    expect(clampUpsideThresholdPct(1.5)).toBe(1.5);
  });
});

describe("curve trajectory row outlook", () => {
  const cd = "28/06/2026";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 29));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags watch when recovery is 3x but curve fades before CD", () => {
    const row = { "Completion Date": cd };
    const points = [
      { offset: -30, pct_curva: 0, pct_foglio: 0 },
      { offset: -20, pct_curva: -4, pct_foglio: -4 },
      { offset: -10, pct_curva: 8, pct_foglio: 8 },
      { offset: 0, pct_curva: 6, pct_foglio: 6 },
    ];
    expect(resolveCurveTrajectoryOutlook(row, points)).toBe("warn");
  });

  it("flags gain when recovery is 3x and peak is strong into CD", () => {
    const row = { "Completion Date": cd };
    const points = [
      { offset: -30, pct_curva: 0, pct_foglio: 0 },
      { offset: -20, pct_curva: -4, pct_foglio: -4 },
      { offset: -10, pct_curva: 8, pct_foglio: 8 },
      { offset: 0, pct_curva: 12, pct_foglio: 12 },
    ];
    expect(resolveCurveTrajectoryOutlook(row, points)).toBe("gain");
  });

  it("flags loss when recovery is below 3x drawdown", () => {
    const row = { "Completion Date": cd };
    const points = [
      { offset: -30, pct_curva: 0, pct_foglio: 0 },
      { offset: -20, pct_curva: -8, pct_foglio: -8 },
      { offset: -10, pct_curva: -6, pct_foglio: -6 },
      { offset: 0, pct_curva: -5, pct_foglio: -5 },
    ];
    expect(resolveCurveTrajectoryOutlook(row, points)).toBe("loss");
  });

  it("flags gain on clean upward curve", () => {
    const row = { "Completion Date": cd };
    const points = [
      { offset: -30, pct_curva: 0, pct_foglio: 0 },
      { offset: -15, pct_curva: 6, pct_foglio: 6 },
      { offset: 0, pct_curva: 14, pct_foglio: 14 },
    ];
    expect(resolveCurveTrajectoryOutlook(row, points)).toBe("gain");
  });
});
