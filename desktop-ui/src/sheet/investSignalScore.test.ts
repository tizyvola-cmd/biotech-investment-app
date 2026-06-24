import { describe, expect, it } from "vitest";
import {
  computeScoreBreakdown,
  SCORE_COMPONENT_MAX,
  scoreReliabilityTier,
  signalMetricsFromSimRow,
  type ScoreBreakdownOptions,
} from "./investSignalScore";
import type { SignAccuracyCurveView } from "./signAccuracyCurve";
import { readPred5Pp, readPred5RelativePp } from "./simulationPlanGain";

function samplePreCdRow(): Record<string, unknown> {
  return {
    Ticker: "PTGX",
    "Completion Date": "15/06/2026",
    "Affidabilità\n+5gg (%)": 0.7,
    "R² fit": 0.861,
    "slope≈5g": 0.35,
    "slope≈20g": 0.28,
    "Δ% vs Pred−60\nPred\n−60": 0,
    "Δ% vs Pred−60\nPred\n−30": -0.0149,
    "Δ% vs Pred−60\nPred\n−10": -0.0612,
    "Δ% vs Pred−60\nPred\n+4": -0.0213,
    "Δ% vs Pred−60\nPred\n+7": -0.0213,
  };
}

const mockSignCurveView: SignAccuracyCurveView = {
  points: [
    {
      offset: -60,
      label: "-60",
      retroSignPct: 62,
      simSignPct: 58,
      retroPricePct: 95,
      simPricePct: 98,
      retroN: 120,
      simN: 45,
      zone: "pre_cd",
    },
    {
      offset: -10,
      label: "-10",
      retroSignPct: 60,
      simSignPct: 60,
      retroPricePct: 92,
      simPricePct: 99,
      retroN: 80,
      simN: 30,
      zone: "pre_cd",
    },
    {
      offset: -3,
      label: "-3",
      retroSignPct: 55,
      simSignPct: 85,
      retroPricePct: 88,
      simPricePct: 100,
      retroN: 70,
      simN: 28,
      zone: "pre_cd",
    },
  ],
  xOffsets: [-60, -10, -3],
  retro: null,
  simulation: {
    labelIt: "Simulation",
    labelEn: "Simulation",
    nEvents: 12,
    nSessions: 103,
    overallSignPct: 65,
    overallSignPreCdPct: 64,
    overallPricePct: 97,
  },
  runIso: null,
  preCdHitPct: 64,
  metric: "daily_dod",
};

describe("investSignalScore pre-CD", () => {
  it("readPred5RelativePp uses curve forward, not post-CD anchor", () => {
    const row = samplePreCdRow();
    const abs = readPred5Pp(row);
    const rel = readPred5RelativePp(row);
    expect(abs).not.toBeNull();
    expect(rel).not.toBeNull();
    expect(rel!).toBeGreaterThan(0);
    expect(Math.abs(rel! - abs!)).toBeGreaterThan(0.05);
  });

  it("ignores stale pred5_live when curve forward is available", () => {
    const row = {
      ...samplePreCdRow(),
      pred5_live: -2.13,
      live_updated_at: new Date().toISOString().slice(0, 10),
    };
    const m = signalMetricsFromSimRow(row, Object.keys(row));
    expect(m.pred5Pp).toBeGreaterThan(0);
    expect(m.score).toBeGreaterThanOrEqual(55);
  });

  it("good pre-CD fit scores above watch threshold", () => {
    const row = samplePreCdRow();
    const m = signalMetricsFromSimRow(row, Object.keys(row));
    expect(m.score).not.toBeNull();
    expect(m.score!).toBeGreaterThanOrEqual(50);
    const b = computeScoreBreakdown(0.7, 0.861, m.pred5Pp, m.daysToCd, 0.35);
    expect(b.r2Score).toBeGreaterThan(15);
    expect(b.predScore).toBeGreaterThan(2);
  });

  it("hot zone (≤60d / ~2 mesi) gets max timing points", () => {
    for (const d of [60, 45, 30, 10, 5, 3]) {
      const b = computeScoreBreakdown(0.6, 0.7, 2, d, 0.25, 2);
      expect(b.timingScore).toBe(SCORE_COMPONENT_MAX.timing);
    }
    const at60 = computeScoreBreakdown(0.6, 0.7, 2, 60, 0.25, 2);
    expect(at60.timingLabel).toMatch(/hot 60d/i);
    const peak = computeScoreBreakdown(0.6, 0.7, 2, 7, 0.25, 2);
    expect(peak.timingLabel).toMatch(/peak T−7d/i);
  });

  it("watch zone (72d) stays high but below hot max", () => {
    const b = computeScoreBreakdown(0.6, 0.7, 2, 72, 0.25, 2);
    expect(b.timingScore).toBeGreaterThanOrEqual(9);
    expect(b.timingScore).toBeLessThan(SCORE_COMPONENT_MAX.timing);
    expect(b.timingLabel).toMatch(/watch/i);
  });

  it("watch zone (99d) gets non-zero forward pred via extrapolation", () => {
    const row = {
      Ticker: "RYTM",
      "Completion Date": "15/09/2026",
      "Affidabilità\ncalib %": 0.64,
      "R² fit": 0.78,
      "slope≈5g": 0.12,
      "Δ% vs Pred−60\nPred\n−60": 0,
      "Δ% vs Pred−60\nPred\n−30": 0.04,
      "Δ% vs Pred−60\nPred\n−10": 0.08,
      "Δ% vs Pred−60\nPred\n+4": 0.12,
      "Δ% vs Pred−60\nPred\n+7": 0.14,
    };
    const pred5 = readPred5RelativePp(row);
    expect(pred5).not.toBeNull();
    expect(Math.abs(pred5!)).toBeGreaterThanOrEqual(0.05);
    const m = signalMetricsFromSimRow(row, Object.keys(row));
    const b = computeScoreBreakdown(
      m.affidPct != null ? m.affidPct / 100 : null,
      m.r2,
      pred5,
      99,
      0.12,
      2,
    );
    expect(b.predScore).toBeGreaterThan(0);
    expect(b.slopeAlign).not.toBe(0);
  });

  it("prefers Affidabilità calib over +5gg column", () => {
    const row = {
      ...samplePreCdRow(),
      "Affidabilità\ncalib %": 0.82,
      "Affidabilità\n+5gg (%)": 0.35,
    };
    const cols = Object.keys(row);
    const mLow = signalMetricsFromSimRow(
      { ...row, "Affidabilità\ncalib %": 0.35, "Affidabilità\n+5gg (%)": 0.82 },
      cols,
    );
    const mHigh = signalMetricsFromSimRow(row, cols);
    expect(mHigh.score).not.toBeNull();
    expect(mHigh.score!).toBeGreaterThan(mLow.score ?? 0);
  });

  it("accuracy rewards small model vs real gap when no cohort curve", () => {
    const tight = computeScoreBreakdown(0.6, 0.5, 1.5, 20, 0.2, 0.8);
    const wide = computeScoreBreakdown(0.6, 0.5, 1.5, 20, 0.2, 22);
    expect(tight.accuracyScore).toBe(SCORE_COMPONENT_MAX.accuracy);
    expect(wide.accuracyScore).toBeLessThan(tight.accuracyScore);
    expect(tight.total).toBeGreaterThan(wide.total);
  });

  it("accuracy uses simulation price accuracy at T-60 (~98%)", () => {
    const opts: ScoreBreakdownOptions = { signCurveView: mockSignCurveView };
    const b = computeScoreBreakdown(0.6, 0.7, 2, 60, 0.25, -14.7, 0.2, opts);
    expect(b.accuracyScore).toBeGreaterThanOrEqual(13);
    expect(b.accuracyLabel).toMatch(/Simulation price acc 98%/i);
  });

  it("large live gap only slightly reduces cohort-based accuracy", () => {
    const opts: ScoreBreakdownOptions = { signCurveView: mockSignCurveView };
    const tight = computeScoreBreakdown(0.6, 0.7, 2, 60, 0.25, 2, 0.2, opts);
    const wide = computeScoreBreakdown(0.6, 0.7, 2, 60, 0.25, -18, 0.2, opts);
    expect(tight.accuracyScore).toBe(SCORE_COMPONENT_MAX.accuracy);
    expect(wide.accuracyScore).toBeGreaterThanOrEqual(12);
    expect(tight.accuracyScore).toBeGreaterThan(wide.accuracyScore);
  });

  it("score reliability tiers map to intuitive bands", () => {
    expect(scoreReliabilityTier(67).tier).toBe("alta");
    expect(scoreReliabilityTier(55).tier).toBe("buona");
    expect(scoreReliabilityTier(42).tier).toBe("moderata");
    expect(scoreReliabilityTier(28).tier).toBe("bassa");
    expect(scoreReliabilityTier(15).tier).toBe("scarsa");
  });

  it("align uses simulation direction hit in hot zone (~T-60)", () => {
    const opts: ScoreBreakdownOptions = { signCurveView: mockSignCurveView };
    const b = computeScoreBreakdown(0.6, 0.7, 2, 60, 0.25, 2, 0.2, opts);
    expect(b.slopeAlign).toBeGreaterThanOrEqual(7.5);
    expect(b.slopeAlignLabel).toMatch(/Simulation dir hit 58%/i);
  });

  it("align peaks near max at T-3 when simulation hit is high", () => {
    const opts: ScoreBreakdownOptions = { signCurveView: mockSignCurveView };
    const b = computeScoreBreakdown(0.6, 0.7, 2, 3, 0.25, 2, 0.2, opts);
    expect(b.slopeAlign).toBe(SCORE_COMPONENT_MAX.align);
    expect(b.slopeAlignLabel).toMatch(/Simulation dir hit 85%/i);
  });
});
