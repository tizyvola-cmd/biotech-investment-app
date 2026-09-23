import { describe, expect, it } from "vitest";
import {
  explainRecommendation,
  getRecommendation,
  getDiagnosticNote,
  hasStudySetupEvidence,
  regRiskFromSignedScore,
  regRiskDisplayBarColor,
  resolveDecisionChartRec,
  resolveHeroDecisionRec,
  type DecisionScoreInput,
} from "./decisionChartLogic";

describe("decisionChartLogic", () => {
  it("maps regulatory signed score to 0-100 risk", () => {
    expect(regRiskFromSignedScore(-100)).toBe(0);
    expect(regRiskFromSignedScore(50)).toBe(75);
    expect(regRiskFromSignedScore(null)).toBeNull();
  });

  it("reg risk display color is green below neutral (50)", () => {
    expect(regRiskDisplayBarColor(46)).toBe("#10b981");
    expect(regRiskDisplayBarColor(50)).toBe("#64748b");
    expect(regRiskDisplayBarColor(75)).toBe("#e11d48");
  });

  it("vetoes sell on high regulatory risk", () => {
    const s: DecisionScoreInput = {
      pplan: 80,
      sds: 70,
      eis: 60,
      eisRaw: 10,
      riskV2: 10,
      regRisk: 75,
      mcs: 50,
      pnlPct: 5,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("sell");
  });

  it("rescue with favorable MCS stays review when soft SELL band misses", () => {
    const s: DecisionScoreInput = {
      pplan: 55,
      sds: 50,
      eis: 40,
      eisRaw: -10,
      riskV2: 35,
      regRisk: 20,
      mcs: 60,
      pnlPct: -3,
      isRescue: true,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("review");
  });

  it("soft SELL G1 escapes MCS-friendly rescue when P&L≤−4 and risk≥40", () => {
    const s: DecisionScoreInput = {
      pplan: 55,
      sds: 50,
      eis: 40,
      eisRaw: -10,
      riskV2: 40,
      regRisk: 20,
      mcs: 60,
      pnlPct: -5,
      isRescue: true,
      status: "open",
      hasPosition: true,
    };
    expect(getRecommendation(s)).toBe("sell");
    expect(explainRecommendation(s, "sell", true).trigger).toMatch(/Soft SELL G1/);
  });

  it("soft BUY G1 promotes off-book SDS≥20 · P≥50 · rising ≥2d", () => {
    const s: DecisionScoreInput = {
      pplan: 56,
      sds: 28,
      eis: null,
      eisRaw: null,
      riskV2: 30,
      regRisk: 20,
      mcs: 50,
      pnlPct: 1,
      isRescue: false,
      status: "open",
      hasPosition: false,
      risingStreakOk: true,
    };
    expect(getRecommendation(s)).toBe("buy");
  });

  it("soft BUY G1 does not fire without rising ≥2 sessions (what-if gate)", () => {
    const s: DecisionScoreInput = {
      pplan: 56,
      sds: 28,
      eis: null,
      eisRaw: null,
      riskV2: 30,
      regRisk: 20,
      mcs: 50,
      pnlPct: -4.7,
      isRescue: false,
      status: "open",
      hasPosition: false,
      risingStreakOk: false,
    };
    expect(getRecommendation(s)).not.toBe("buy");
  });

  it("soft BUY G1 does not fire when continuationOk is false (exhausted / weak P(cont))", () => {
    const s: DecisionScoreInput = {
      pplan: 56,
      sds: 28,
      eis: null,
      eisRaw: null,
      riskV2: 30,
      regRisk: 20,
      mcs: 50,
      pnlPct: 1,
      isRescue: false,
      status: "open",
      hasPosition: false,
      risingStreakOk: true,
      continuationOk: false,
    };
    expect(getRecommendation(s)).not.toBe("buy");
  });

  it("fragile deep loser exits Uncertain toward Sell (MSLE-like)", () => {
    const s: DecisionScoreInput = {
      pplan: 48,
      sds: 45,
      eis: 55,
      eisRaw: 3,
      riskV2: 42,
      regRisk: 35,
      mcs: 40,
      pnlPct: -9.7,
      isRescue: true,
      status: "open",
      resilience: "fragile",
      resilienceScore: 28,
    };
    expect(getRecommendation(s)).toBe("sell");
  });

  it("resilient green MTM prefers Hold over default Uncertain (BIIB-like)", () => {
    const s: DecisionScoreInput = {
      pplan: 48,
      sds: 55,
      eis: 50,
      eisRaw: 1,
      riskV2: 35,
      regRisk: 30,
      mcs: 50,
      pnlPct: 1.2,
      isRescue: false,
      status: "open",
      resilience: "resilient",
      resilienceScore: 78,
    };
    expect(getRecommendation(s)).toBe("hold");
  });

  it("operational action wins over score buckets (same arbiter as Pulse)", () => {
    const s: DecisionScoreInput = {
      pplan: 67,
      sds: 60,
      eis: 50,
      eisRaw: 0,
      riskV2: 27,
      regRisk: 46,
      mcs: 16,
      pnlPct: 0,
      isRescue: false,
      status: "open",
      hasPosition: false,
    };
    expect(getRecommendation(s)).toBe("buy");
    // HOLD from deriveSuggestedAction must not be overridden by score BUY.
    expect(resolveDecisionChartRec(s, "hold")).toBe("hold");
    expect(resolveDecisionChartRec(s, "buy")).toBe("buy");
    expect(resolveDecisionChartRec(s, "sell")).toBe("sell");
    expect(resolveDecisionChartRec(s, "review")).toBe("review");
  });

  it("open-book BUY from loop displays as HOLD on the chart", () => {
    const s: DecisionScoreInput = {
      pplan: 67,
      sds: 60,
      eis: 50,
      eisRaw: 0,
      riskV2: 27,
      regRisk: 46,
      mcs: 16,
      pnlPct: 1.9,
      isRescue: false,
      status: "open",
      hasPosition: true,
    };
    expect(resolveDecisionChartRec(s, "buy")).toBe("hold");
  });

  it("keeps sim-loop Sell on profitable open (continuation take-profit aligns Home/Eval)", () => {
    const s: DecisionScoreInput = {
      pplan: 55,
      sds: 50,
      eis: 50,
      eisRaw: 0,
      riskV2: 40,
      regRisk: 40,
      mcs: 40,
      pnlPct: 2.7,
      isRescue: false,
      status: "open",
      hasPosition: true,
    };
    expect(getRecommendation(s)).toBe("hold");
    // Operational SELL with MTM > 0 = exhaustion take-profit — Evaluation must match Home.
    expect(resolveDecisionChartRec(s, "sell")).toBe("sell");
  });

  it("does not paint score Sell on profitable open when sim is review", () => {
    const s: DecisionScoreInput = {
      pplan: 32,
      sds: 40,
      eis: 40,
      eisRaw: -5,
      riskV2: 50,
      regRisk: 40,
      mcs: 40,
      pnlPct: 2.7,
      isRescue: false,
      status: "open",
      hasPosition: true,
    };
    expect(getRecommendation(s)).toBe("sell");
    // With operational REVIEW, chart follows the loop (not score Sell).
    expect(resolveDecisionChartRec(s, "review")).toBe("review");
    // Without operational action, score Sell is demoted when MTM > 0.
    expect(resolveDecisionChartRec(s, null)).toBe("hold");
  });

  it("keeps operational REVIEW (no score override)", () => {
    const s: DecisionScoreInput = {
      pplan: 67,
      sds: 60,
      eis: 50,
      eisRaw: 0,
      riskV2: 27,
      regRisk: 46,
      mcs: 16,
      pnlPct: 0,
      isRescue: false,
      status: "open",
      hasPosition: false,
    };
    expect(resolveDecisionChartRec(s, "review")).toBe("review");
  });

  it("maps strong 24h drop with risk to sell", () => {
    const s: DecisionScoreInput = {
      pplan: 42,
      sds: 48,
      eis: 40,
      eisRaw: -10,
      riskV2: 50,
      regRisk: 40,
      mcs: 30,
      pnlPct: -10.2,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("sell");
  });

  it("maps strong 24h gain with setup scores to buy", () => {
    const s: DecisionScoreInput = {
      pplan: 55,
      sds: 52,
      eis: 55,
      eisRaw: 5,
      riskV2: 30,
      regRisk: 40,
      mcs: 50,
      pnlPct: 9.3,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("buy");
  });

  it("does NOT buy on Δ≥+5% alone when SDS/EIS are weak (NRXP-style momentum)", () => {
    const s: DecisionScoreInput = {
      pplan: 55,
      sds: 43,
      eis: 50,
      eisRaw: 0,
      riskV2: 30,
      regRisk: 40,
      mcs: 50,
      pnlPct: 9.3,
      isRescue: false,
      status: "open",
    };
    expect(hasStudySetupEvidence(s)).toBe(false);
    expect(getRecommendation(s)).toBe("hold");
  });

  it("maps pplan below 40 to sell (spectrum sell zone)", () => {
    const s: DecisionScoreInput = {
      pplan: 33,
      sds: 20,
      eis: 50,
      eisRaw: 0,
      riskV2: 40,
      regRisk: 45,
      mcs: 20,
      pnlPct: 0,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("sell");
    expect(explainRecommendation(s, "sell", false).trigger).toContain("P(plan) 33 < 40");
  });

  it("keeps pplan 40-49 as review", () => {
    const s: DecisionScoreInput = {
      pplan: 45,
      sds: 30,
      eis: 50,
      eisRaw: 0,
      riskV2: 40,
      regRisk: 45,
      mcs: 20,
      pnlPct: 0,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("review");
  });

  it("builds diagnostic note", () => {
    const s: DecisionScoreInput = {
      pplan: 68,
      sds: null,
      eis: null,
      eisRaw: null,
      riskV2: null,
      regRisk: null,
      mcs: null,
      pnlPct: -1,
      isRescue: false,
      status: "open",
    };
    const note = getDiagnosticNote(s, "hold");
    expect(note).toContain("P(plan) alto");
    expect(note).toContain("MCS non ancora disponibile");
  });

  it("explains hold when P(plan) ≥60 but Loss too high for Buy", () => {
    const s: DecisionScoreInput = {
      pplan: 61,
      sds: 26,
      eis: 50,
      eisRaw: 0,
      riskV2: 50,
      regRisk: 48,
      mcs: 15,
      pnlPct: 2.3,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
    const ex = explainRecommendation(s, "hold", true);
    expect(ex.trigger).toContain("61");
    expect(ex.trigger).toContain("60");
    expect(ex.buyGaps.some((g) => g.includes("40"))).toBe(true);
  });

  it("primary Buy at P(plan) ≥65 + Loss ≤40 (solid band, no SDS required)", () => {
    const s: DecisionScoreInput = {
      pplan: 67,
      sds: 45,
      eis: 42,
      eisRaw: 0,
      riskV2: 32,
      regRisk: 46,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("buy");
    const ex = explainRecommendation(s, "buy", true);
    expect(ex.trigger).toContain("65");
    expect(ex.trigger).toContain("67");
  });

  it("primary Buy at marginal P 60–64 + Loss ≤40 only with SDS ≥50", () => {
    const s: DecisionScoreInput = {
      pplan: 62,
      sds: 52,
      eis: 42,
      eisRaw: 0,
      riskV2: 32,
      regRisk: 46,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(hasStudySetupEvidence(s)).toBe(true);
    expect(getRecommendation(s)).toBe("buy");
  });

  it("NRXP lesson: marginal P≈60 + Loss≤40 + weak SDS + empty EIS → Hold", () => {
    // Live NRXP-like: P~60, SDS~43, EIS null/0, Reg~42 — relative strength vs
    // falling XBI looked bullish but study/event evidence was absent.
    const s: DecisionScoreInput = {
      pplan: 60,
      sds: 43,
      eis: 50,
      eisRaw: 0,
      riskV2: 35,
      regRisk: 42,
      mcs: 30,
      pnlPct: 3,
      isRescue: false,
      status: "open",
    };
    expect(hasStudySetupEvidence(s)).toBe(false);
    expect(getRecommendation(s)).toBe("hold");
    const ex = explainRecommendation(s, "hold", true);
    expect(ex.buyGaps.some((g) => /SDS|EIS|marginal|marginale/i.test(g))).toBe(true);
  });

  it("NRXP lesson: high Loss (~52) with P≈60 stays Hold (not reg-swing)", () => {
    const s: DecisionScoreInput = {
      pplan: 60,
      sds: 43,
      eis: null,
      eisRaw: null,
      riskV2: 52,
      regRisk: 42,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
  });

  it("hero keeps Soft BUY (not Hold) when Register Buy is gated", () => {
    expect(resolveHeroDecisionRec("buy", { buyGated: true })).toBe("buy");
    expect(resolveHeroDecisionRec("buy", { buyGated: false })).toBe("buy");
    expect(resolveHeroDecisionRec("hold", { buyGated: true })).toBe("hold");
  });

  it("reg-swing Buy when Loss 41–45, Reg ≤45, and SDS ≥50", () => {
    const s: DecisionScoreInput = {
      pplan: 62,
      sds: 52,
      eis: 42,
      eisRaw: 0,
      riskV2: 42,
      regRisk: 45,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("buy");
    const ex = explainRecommendation(s, "buy", true);
    expect(ex.trigger).toContain("reg-swing");
  });

  it("reg-swing does NOT promote when study setup missing (SDS/EIS weak)", () => {
    const s: DecisionScoreInput = {
      pplan: 62,
      sds: 45,
      eis: 42,
      eisRaw: 0,
      riskV2: 42,
      regRisk: 45,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
  });

  it("reg-swing does NOT promote when Reg > 45 (with Loss 41–45)", () => {
    const s: DecisionScoreInput = {
      pplan: 62,
      sds: 52,
      eis: 42,
      eisRaw: 0,
      riskV2: 42,
      regRisk: 48,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
    const ex = explainRecommendation(s, "hold", true);
    expect(ex.buyGaps.some((g) => g.includes("Reg-swing"))).toBe(true);
  });

  it("reg-swing does NOT promote when Loss > 45", () => {
    const s: DecisionScoreInput = {
      pplan: 62,
      sds: 52,
      eis: 42,
      eisRaw: 0,
      riskV2: 46,
      regRisk: 20,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
  });

  it("P(plan) 58 stays Hold (below Buy floor 60)", () => {
    const s: DecisionScoreInput = {
      pplan: 58,
      sds: 45,
      eis: 42,
      eisRaw: 0,
      riskV2: 30,
      regRisk: 15,
      mcs: 30,
      pnlPct: null,
      isRescue: false,
      status: "open",
    };
    expect(getRecommendation(s)).toBe("hold");
  });

  it("low_liq_noise forces REVIEW even when other scores would say SELL", () => {
    // ERNAW real case (2026-07-15): sub-dime warrant closed −22.6% on 50k
    // share volume while the correlated common ERNA closed +11% on the
    // same positive catalyst. Without the flag, decisionChartLogic would
    // hit pnl_sell (−22% + weak scores) and label the warrant SELL.
    const s: DecisionScoreInput = {
      pplan: 30,
      sds: null,
      eis: null,
      eisRaw: null,
      riskV2: 70,
      regRisk: 50,
      mcs: null,
      pnlPct: -22.6,
      isRescue: true,
      status: "open",
      lowLiqNoise: true,
      lowLiqReason: "price=$0.0851<$1; |Δ|=22.6%",
    };
    expect(getRecommendation(s)).toBe("review");
  });

  it("low_liq_noise forces REVIEW even when scores would say BUY", () => {
    // Symmetric test: a sub-dime warrant that spikes +40% on parabolic
    // volume should also NOT be promoted to BUY — the |Δ| is dominated
    // by microstructure, not by information about the issuer.
    const s: DecisionScoreInput = {
      pplan: 75,
      sds: 65,
      eis: 60,
      eisRaw: 10,
      riskV2: 20,
      regRisk: 25,
      mcs: 60,
      pnlPct: 40,
      isRescue: false,
      status: "open",
      lowLiqNoise: true,
      lowLiqReason: "price=$0.42<$1; |Δ|=40.0%",
    };
    expect(getRecommendation(s)).toBe("review");
  });

  it("low_liq_noise=false is a no-op (falls through to normal rules)", () => {
    const s: DecisionScoreInput = {
      pplan: 75,
      sds: 65,
      eis: 60,
      eisRaw: 10,
      riskV2: 20,
      regRisk: 25,
      mcs: 60,
      pnlPct: 3,
      isRescue: false,
      status: "open",
      lowLiqNoise: false,
    };
    expect(getRecommendation(s)).toBe("buy");
  });

  it("low_liq_noise=undefined (backward compat) also falls through", () => {
    const s: DecisionScoreInput = {
      pplan: 75,
      sds: 65,
      eis: 60,
      eisRaw: 10,
      riskV2: 20,
      regRisk: 25,
      mcs: 60,
      pnlPct: 3,
      isRescue: false,
      status: "open",
      // lowLiqNoise intentionally omitted to simulate legacy callers.
    };
    expect(getRecommendation(s)).toBe("buy");
  });
});
