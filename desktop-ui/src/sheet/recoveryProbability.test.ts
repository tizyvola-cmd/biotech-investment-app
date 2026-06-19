import { describe, expect, it } from "vitest";
import {
  computeEntryOutlook,
  computeRecoveryOutlook,
  stripProbabilityFromReason,
} from "./recoveryProbability";

describe("stripProbabilityFromReason", () => {
  it("removes P(plan) from inline reason", () => {
    expect(
      stripProbabilityFromReason("Enter now · P(plan) 73% · target +14.5% · WATCH"),
    ).toBe("Enter now · target +14.5% · WATCH");
  });
});

describe("recoveryProbability", () => {
  it("TELA-like weak setup: covers loss on paper but low P(recovery) → review/exit", () => {
    const out = computeRecoveryOutlook({
      lang: "it",
      inLoss: true,
      pnlPct: -3.63,
      forwardPct: 5.2,
      curveGapPct: -6.32,
      matchPct: 57,
      sdsScore: 29,
      miiAngleDeg: -8.7,
      stabilityVerdict: "watch",
      curveRisingHold: true,
      daysToCd: 20,
      eisSuperScore: 0,
    });
    expect(out.coversLoss).toBe(true);
    expect(out.probabilityPct).toBeLessThan(55);
    expect(["review", "exit"]).toContain(out.suggestedDecision);
  });

  it("strong rising profile with small loss → hold", () => {
    const out = computeRecoveryOutlook({
      lang: "en",
      inLoss: true,
      pnlPct: -2,
      forwardPct: 8,
      curveGapPct: -0.5,
      matchPct: 78,
      sdsScore: 62,
      miiAngleDeg: 6,
      stabilityVerdict: "persistent",
      curveRisingHold: true,
      daysToCd: 18,
      windowCorr: 0.45,
      eisSuperScore: 12,
    });
    expect(out.coversLoss).toBe(true);
    expect(out.probabilityPct).toBeGreaterThanOrEqual(55);
    expect(out.suggestedDecision).toBe("hold");
  });

  it("entry outlook skips weak forward", () => {
    const out = computeEntryOutlook({
      lang: "it",
      forwardPct: -1,
      curveGapPct: null,
      matchPct: 40,
      sdsScore: 20,
      sdsVeto: true,
      miiAngleDeg: -5,
      stabilityVerdict: "watch",
      curveRisingHold: false,
      daysToCd: 30,
    });
    expect(out.suggestedDecision).toBe("exit");
  });

  it("PBYI-like outside op window: tiny forward → skip entry", () => {
    const out = computeEntryOutlook({
      lang: "en",
      forwardPct: 0.4,
      curveGapPct: -2,
      matchPct: 79,
      sdsScore: 47,
      miiAngleDeg: -1.7,
      stabilityVerdict: "watch",
      curveRisingHold: true,
      daysToCd: 11,
      segmentRoiPct: -3.2,
    });
    expect(out.probabilityPct).toBeLessThan(60);
    expect(out.suggestedDecision).not.toBe("hold");
  });

  it("PBYI-like momentum polygon: flat forward + match 79 + 24h gain in op window → enter", () => {
    const out = computeEntryOutlook({
      lang: "en",
      forwardPct: 0.4,
      curveGapPct: -2,
      matchPct: 79,
      sdsScore: 47,
      miiAngleDeg: -1.7,
      stabilityVerdict: "watch",
      curveRisingHold: true,
      daysToCd: 19,
      segmentRoiPct: -3.2,
      dailyPct24h: 1.1,
    });
    expect(out.probabilityPct).toBeGreaterThanOrEqual(58);
    expect(out.suggestedDecision).toBe("hold");
  });

  it("VYGR-like moderate momentum polygon → review or enter", () => {
    const out = computeEntryOutlook({
      lang: "en",
      forwardPct: 0.5,
      curveGapPct: -1,
      matchPct: 54,
      sdsScore: 45,
      miiAngleDeg: 0,
      stabilityVerdict: "watch",
      curveRisingHold: true,
      daysToCd: 22,
      segmentRoiPct: -2.1,
      dailyPct24h: 1.9,
    });
    expect(out.probabilityPct).toBeGreaterThan(50);
    expect(["hold", "review"]).toContain(out.suggestedDecision);
  });

  it("OLMA-like operational gainer: low match but strong target + 24h → enter", () => {
    const base = {
      lang: "it" as const,
      forwardPct: 5,
      curveGapPct: -1,
      matchPct: 31,
      sdsScore: 40,
      miiAngleDeg: 2,
      stabilityVerdict: "watch" as const,
      curveRisingHold: true,
      daysToCd: 19,
    };
    const without = computeEntryOutlook(base);
    const withDaily = computeEntryOutlook({ ...base, dailyPct24h: 1.9 });
    expect(withDaily.probabilityPct).toBeGreaterThan(without.probabilityPct);
    expect(withDaily.probabilityPct).toBeGreaterThanOrEqual(53.5);
    expect(withDaily.suggestedDecision).toBe("hold");
  });

  it("24h momentum boost when arc negative but price up strongly", () => {
    const base = {
      lang: "en" as const,
      forwardPct: 1.2,
      curveGapPct: -1,
      matchPct: 75,
      sdsScore: 50,
      miiAngleDeg: 2,
      stabilityVerdict: "watch" as const,
      curveRisingHold: true,
      daysToCd: 14,
      segmentRoiPct: -3.5,
    };
    const without = computeEntryOutlook(base);
    const withMomentum = computeEntryOutlook({ ...base, dailyPct24h: 2.8 });
    expect(withMomentum.probabilityPct).toBeGreaterThan(without.probabilityPct);
  });

  it("entry outlook enter on strong plan probability", () => {
    const out = computeEntryOutlook({
      lang: "it",
      forwardPct: 12,
      curveGapPct: 0.5,
      matchPct: 82,
      sdsScore: 68,
      miiAngleDeg: 8,
      stabilityVerdict: "entry",
      curveRisingHold: true,
      daysToCd: 14,
      windowCorr: 0.5,
    });
    expect(out.suggestedDecision).toBe("hold");
    expect(out.probabilityPct).toBeGreaterThanOrEqual(60);
  });

  it("lowers entry probability when spot is far above model curve", () => {
    const moderateGap = computeEntryOutlook({
      lang: "it",
      forwardPct: 8,
      curveGapPct: 0.5,
      matchPct: 75,
      sdsScore: 60,
      miiAngleDeg: 5,
      stabilityVerdict: "entry",
      curveRisingHold: true,
      daysToCd: 20,
    });
    const overextended = computeEntryOutlook({
      lang: "it",
      forwardPct: 8,
      curveGapPct: 9.3,
      matchPct: 75,
      sdsScore: 60,
      miiAngleDeg: 5,
      stabilityVerdict: "entry",
      curveRisingHold: true,
      daysToCd: 20,
      misalignmentIds: ["spot_vs_model"],
    });
    expect(overextended.probabilityPct).toBeLessThan(moderateGap.probabilityPct);
  });

  it("isotonic shrink moderates raw P(plan) in 70–79 band", () => {
    const out = computeEntryOutlook({
      lang: "it",
      forwardPct: 10,
      curveGapPct: 0.5,
      matchPct: 78,
      sdsScore: 65,
      miiAngleDeg: 6,
      stabilityVerdict: "entry",
      curveRisingHold: true,
      daysToCd: 18,
    });
    expect(out.probabilityPct).toBeLessThan(75);
    expect(out.probabilityPct).toBeGreaterThanOrEqual(57);
  });

  it("Learning Lab windowCorr raises recovery probability vs null", () => {
    const base = {
      lang: "it" as const,
      inLoss: true,
      pnlPct: -3.63,
      forwardPct: 5.2,
      curveGapPct: -6.32,
      matchPct: 57,
      sdsScore: 29,
      miiAngleDeg: -8.7,
      stabilityVerdict: "watch" as const,
      curveRisingHold: true,
      daysToCd: 20,
      eisSuperScore: 0,
    };
    const without = computeRecoveryOutlook(base);
    const withLab = computeRecoveryOutlook({ ...base, windowCorr: 0.45 });
    expect(withLab.probabilityPct).toBeGreaterThan(without.probabilityPct);
  });
});
