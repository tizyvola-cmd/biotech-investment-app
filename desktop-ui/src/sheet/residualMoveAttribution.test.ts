import { describe, expect, it } from "vitest";
import {
  buildResidualMoveBreakdown,
  detectSplitContaminationSuspect,
  formatResidualCompactSummary,
  formatResidualSummary,
  residualDominantChannel,
  RESIDUAL_EXPLAINED_MIN_SHARE_PCT,
  RESIDUAL_INVESTIGATION_THRESHOLD_PCT,
} from "./residualMoveAttribution";

describe("residualMoveAttribution", () => {
  it("flags split contamination on extreme single-day moves", () => {
    expect(detectSplitContaminationSuspect(-42)).toBe(true);
    expect(detectSplitContaminationSuspect(-5, [-1, 1.2, -0.8, 2])).toBe(false);
    expect(detectSplitContaminationSuspect(-18, [-1, 1, -0.5, 2])).toBe(true);
  });

  it("decomposes observed move with market and EIS channels", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -8,
      externalAlignmentScore: 20,
      eisEventDeltaSum: -2,
      curveGapPct: -5,
      eventCountInWindow: 2,
    });
    expect(b).not.toBeNull();
    expect(b!.marketExplainedPct).toBeLessThan(0);
    expect(b!.eisExplainedPct).toBeLessThan(0);
    expect(Math.abs(b!.unexplainedPct)).toBeLessThan(8);
    expect(b!.explainedSharePct).toBeGreaterThan(0);
  });

  it("requests investigation when residual is large and explained share low", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -6,
      externalAlignmentScore: 10,
      eisEventDeltaSum: 0,
      eventCountInWindow: 0,
    });
    expect(b!.flags.needsInvestigation).toBe(true);
    expect(Math.abs(b!.unexplainedPct)).toBeGreaterThanOrEqual(
      RESIDUAL_INVESTIGATION_THRESHOLD_PCT,
    );
    expect(b!.explainedSharePct).toBeLessThan(RESIDUAL_EXPLAINED_MIN_SHARE_PCT);
  });

  it("suppresses investigation when split contamination suspected", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -40,
      externalAlignmentScore: 5,
    });
    expect(b!.flags.splitContaminationSuspect).toBe(true);
    expect(b!.flags.needsInvestigation).toBe(false);
  });

  it("returns null for negligible moves", () => {
    expect(buildResidualMoveBreakdown({ observedPct: 0.02 })).toBeNull();
    expect(buildResidualMoveBreakdown({ observedPct: null })).toBeNull();
  });

  it("market-only day: alignment share with EIS/model at zero is low-confidence", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -4,
      externalAlignmentScore: 87.5,
      eisEventDeltaSum: null,
      eventCountInWindow: 0,
      curveGapPct: null,
    });
    expect(b).not.toBeNull();
    expect(b!.marketExplainedPct).toBe(-3.5);
    expect(b!.eisExplainedPct).toBe(0);
    expect(b!.modelExplainedPct).toBe(0);
    expect(b!.explainedPct).toBe(-3.5);
    expect(b!.unexplainedPct).toBe(-0.5);
    expect(b!.explainedSharePct).toBe(87.5);
    expect(residualDominantChannel(b!)).toBe("market");
    expect(b!.flags.marketOnly).toBe(true);
    expect(b!.flags.lowConfidence).toBe(true);
    expect(b!.flags.needsInvestigation).toBe(false);
    expect(formatResidualSummary(b!, "en")).toContain("alignment only");
    expect(formatResidualSummary(b!, "it")).toContain("solo allineamento");
  });

  it("multi-channel day is not marketOnly", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -8,
      externalAlignmentScore: 20,
      eisEventDeltaSum: -2,
      eventCountInWindow: 2,
      curveGapPct: -5,
    });
    expect(b!.flags.marketOnly).toBe(false);
  });

  it("does not flip positive ΔP into a negative News/EIS slice on a down day", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -47.1,
      externalAlignmentScore: 0,
      eisEventDeltaSum: 3.2,
      eventCountInWindow: 1,
    });
    expect(b!.eisPricedPct).toBe(0);
    expect(b!.eisExplainedPct).toBe(0);
  });

  it("skips manual dilution share on split-suspect days (JSPR-style)", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -47.1,
      externalAlignmentScore: 0,
      eisEventDeltaSum: null,
      eventCountInWindow: 0,
      manualCompanyBoostShare: 0.25,
    });
    expect(b!.flags.splitContaminationSuspect).toBe(true);
    expect(b!.eisManualBoostPct).toBe(0);
    expect(b!.eisExplainedPct).toBe(0);
    expect(Math.abs(b!.unexplainedPct)).toBeGreaterThan(40);
  });

  it("applies capped manual company share on ordinary down days", () => {
    const b = buildResidualMoveBreakdown({
      observedPct: -10,
      externalAlignmentScore: 0,
      eisEventDeltaSum: null,
      eventCountInWindow: 0,
      manualCompanyBoostShare: 0.25,
    });
    expect(b!.flags.splitContaminationSuspect).toBe(false);
    expect(b!.eisManualBoostPct).toBe(-2.5);
    expect(b!.eisExplainedPct).toBe(-2.5);
  });

  describe("formatResidualCompactSummary", () => {
    it("uses honest XBI label for market-only days", () => {
      const b = buildResidualMoveBreakdown({
        observedPct: -4,
        externalAlignmentScore: 87.5,
      })!;
      const s = formatResidualCompactSummary(b, "en");
      expect(s).toMatch(/^XBI ~\d+% · Res [+-]\d+\.\d+%$/);
      expect(s.length).toBeLessThan(28);
      expect(s).not.toContain("Expl");
      expect(s).not.toContain("investigate");
    });

    it("uses XBI label in Italian market-only compact too", () => {
      const b = buildResidualMoveBreakdown({
        observedPct: -4,
        externalAlignmentScore: 87.5,
      })!;
      const s = formatResidualCompactSummary(b, "it");
      expect(s).toMatch(/^XBI ~\d+% · Res [+-]\d+\.\d+%$/);
    });

    it("renders Expl/Res when EIS channel contributes", () => {
      const b = buildResidualMoveBreakdown({
        observedPct: -8,
        externalAlignmentScore: 20,
        eisEventDeltaSum: -2,
        eventCountInWindow: 2,
      })!;
      expect(b.flags.marketOnly).toBe(false);
      expect(formatResidualCompactSummary(b, "en")).toMatch(/^Expl \d+% · Res /);
      expect(formatResidualCompactSummary(b, "it")).toMatch(/^Spieg \d+% · Res /);
    });

    it("returns short split marker when contamination is suspected", () => {
      const b = buildResidualMoveBreakdown({
        observedPct: -42,
        externalAlignmentScore: 5,
      })!;
      expect(b.flags.splitContaminationSuspect).toBe(true);
      expect(formatResidualCompactSummary(b, "en")).toBe("Split? verify");
      expect(formatResidualCompactSummary(b, "it")).toBe("Split? verifica");
    });

    it("stays compact even when investigation is flagged (no arrow suffix)", () => {
      const b = buildResidualMoveBreakdown({
        observedPct: -6,
        externalAlignmentScore: 10,
      })!;
      expect(b.flags.needsInvestigation).toBe(true);
      const s = formatResidualCompactSummary(b, "en");
      expect(s).not.toContain("→");
      expect(s).not.toContain("investigate");
    });
  });
});
