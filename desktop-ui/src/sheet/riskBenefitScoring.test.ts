import { describe, expect, it } from "vitest";
import {
  approvedWinRateToBenefitPct,
  BENEFIT_BLEND_V2_WEIGHTS,
  deriveBenefitFillPctEnhanced,
  deriveClosedDealEntryBenefitComponents,
  deriveClosedDealEntryBenefitScore,
  emsTiltToBenefitPct,
  entrySdsToBenefitPct,
} from "./riskBenefitScoring";

describe("approvedWinRateToBenefitPct", () => {
  it("maps 50% to mid-low benefit", () => {
    expect(approvedWinRateToBenefitPct(0.5)).toBeCloseTo(23.08, 1);
  });
  it("maps 100% to full benefit", () => {
    expect(approvedWinRateToBenefitPct(1)).toBe(100);
  });
});

describe("emsTiltToBenefitPct", () => {
  it("neutral tilt is ~33%", () => {
    expect(emsTiltToBenefitPct(1)).toBeCloseTo(33.33, 1);
  });
});

describe("entrySdsToBenefitPct", () => {
  it("maps SDS linearly 0–100", () => {
    expect(entrySdsToBenefitPct(72)).toBe(72);
    expect(entrySdsToBenefitPct(120)).toBe(100);
  });
});

describe("deriveBenefitFillPctEnhanced", () => {
  it("prefers plan forward when available", () => {
    const r = deriveBenefitFillPctEnhanced({
      expectedReturnPct: 15,
      daysToTarget: 10,
      approvedWinRate: 0.7,
    });
    expect(r.source).toBe("plan_forward");
    expect(r.fillPct).toBeGreaterThan(0);
  });

  it("uses v2 approved blend with SDS and entry signals", () => {
    const r = deriveBenefitFillPctEnhanced({
      approvedWinRate: 0.75,
      entrySdsPct: 80,
      entryAffidabilitaPct: 80,
      entrySlope20d: 0.3,
    });
    expect(r.source).toBe("approved_blend");
    expect(r.fillPct).toBeGreaterThan(55);
    expect(r.sourceNoteEn).toContain("SDS");
  });

  it("falls back to EMS when SDS missing", () => {
    const r = deriveBenefitFillPctEnhanced({
      approvedWinRate: 0.6,
      emsTilt: 1.5,
      entryAffidabilitaPct: 70,
    });
    expect(r.source).toBe("approved_blend");
    expect(r.sourceNoteEn).toContain("EMS");
  });
});

describe("deriveClosedDealEntryBenefitComponents", () => {
  it("exposes per-component scores for validation charts", () => {
    const c = deriveClosedDealEntryBenefitComponents({
      approvedWinRate: 0.55,
      entryAffidabilitaPct: 80,
      entrySlope20d: 0.2,
      entrySdsPct: 65,
    });
    expect(c.benefitScore).toBe(
      deriveClosedDealEntryBenefitScore({
        approvedWinRate: 0.55,
        entryAffidabilitaPct: 80,
        entrySlope20d: 0.2,
        entrySdsPct: 65,
      }),
    );
    expect(c.entryPplanPct).toBe(80);
    expect(c.entrySdsPct).toBe(65);
    expect(c.pplanComponentPct).toBe(80);
    expect(c.sdsComponentPct).toBe(65);
    expect(c.winComponentPct).toBeGreaterThan(0);
    expect(c.winComponentPct).toBeLessThan(c.pplanComponentPct);
  });

  it("weights P(plan) more than P(win) in v2 blend", () => {
    const highPplan = deriveClosedDealEntryBenefitScore({
      approvedWinRate: 0.4,
      entryAffidabilitaPct: 90,
      entrySdsPct: 50,
    });
    const highWin = deriveClosedDealEntryBenefitScore({
      approvedWinRate: 0.95,
      entryAffidabilitaPct: 40,
      entrySdsPct: 50,
    });
    expect(highPplan).toBeGreaterThan(highWin);
    expect(BENEFIT_BLEND_V2_WEIGHTS.pplan).toBe(0.6);
    expect(BENEFIT_BLEND_V2_WEIGHTS.win).toBe(0.1);
  });
});

describe("deriveClosedDealEntryBenefitScore", () => {
  it("uses entry-only blend without SDS payoff shortcut", () => {
    const highPayoffStyle = deriveClosedDealEntryBenefitScore({
      approvedWinRate: 0.55,
      entryAffidabilitaPct: 85,
      entrySlope20d: 0.4,
      entrySdsPct: 70,
    });
    const lowPayoffStyle = deriveClosedDealEntryBenefitScore({
      approvedWinRate: 0.55,
      entryAffidabilitaPct: 45,
      entrySlope20d: -0.1,
      entrySdsPct: 30,
    });
    expect(highPayoffStyle).toBeGreaterThan(lowPayoffStyle);
    expect(highPayoffStyle).toBeLessThan(100);
  });
});
