import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateAxisScores,
  applyManualAxisScore,
  clearBenchmarkOverlayForTests,
  listBenchmarkOverlayForTests,
  loadThermometerBenchmarks,
  nearestBenchmarks,
  resetThermometerBenchmarkCacheForTests,
  scoreArticleThermometer,
  scoreFromTaxonomyDim,
  taxonomyDimToAxis,
} from "./eisThermometer";

describe("eisThermometer", () => {
  afterEach(() => {
    clearBenchmarkOverlayForTests();
    resetThermometerBenchmarkCacheForTests();
  });

  it("maps taxonomy dims to three axes", () => {
    expect(taxonomyDimToAxis("clinical")).toBe("clinical");
    expect(taxonomyDimToAxis("market_access")).toBe("market_access");
    expect(taxonomyDimToAxis("financial")).toBe("financial");
    expect(taxonomyDimToAxis("corporate")).toBe("financial");
  });

  it("loads seed benchmarks with taxonomy anchors", () => {
    resetThermometerBenchmarkCacheForTests();
    const list = loadThermometerBenchmarks();
    expect(list.length).toBeGreaterThan(10);
    expect(list.some((b) => b.taxonomyEventId === "CLIN_PRIMARY_MET")).toBe(true);
    expect(list.some((b) => b.taxonomyEventId === "FIN_GOING_CONCERN")).toBe(true);
    expect(list.some((b) => b.taxonomyEventId === "CORP_MNA_TARGET_PREMIUM")).toBe(true);
    expect(list.some((b) => b.axis === "market_access")).toBe(true);
    // Catalog coverage: previously unmapped IDs
    expect(list.some((b) => b.taxonomyEventId === "CLIN_SECONDARY_MET")).toBe(true);
    expect(list.some((b) => b.taxonomyEventId === "ACCESS_HTA_FAVORABLE")).toBe(true);
    expect(list.some((b) => b.taxonomyEventId === "CORP_EXEC_DEPARTURE")).toBe(true);
  });

  it("Option B: event_id anchor beats raw ±3 scale", () => {
    const scored = scoreFromTaxonomyDim("clinical", {
      event_id: "CLIN_PRIMARY_MET",
      score: 2.5,
      base_weight: 2.5,
      event_type: "primary met",
    });
    expect(scored.score).toBe(0.85);
    expect(scored.axis).toBe("clinical");
    expect(scored.subtype).toBe("trial_readout");
    expect(scored.matchSource).toBe("event_id");
    expect(scored.confidence).toBe("seed");
    expect(scored.nearest.length).toBeGreaterThan(0);
  });

  it("falls back to taxonomy×(1/3) without anchor", () => {
    const scored = scoreFromTaxonomyDim("financial", {
      event_id: "FIN_UNKNOWN_XYZ",
      score: 1.5,
      base_weight: 1.5,
    });
    expect(scored.score).toBe(0.5); // 1.5 * 1/3
    expect(scored.matchSource).toBe("fallback");
    expect(scored.confidence).toBe("provisional");
  });

  it("folds corporate into financial axis", () => {
    const art = scoreArticleThermometer({
      corporate: {
        event_id: "CORP_MNA_TARGET_PREMIUM",
        score: 2.5,
        base_weight: 2.5,
      },
    });
    expect(art.financial.score).toBe(0.7);
    expect(art.clinical.score).toBeNull();
    expect(art.market_access.score).toBeNull();
  });

  it("keeps market access on its own axis", () => {
    resetThermometerBenchmarkCacheForTests();
    const art = scoreArticleThermometer({
      market_access: {
        event_id: "ACCESS_PAYER_FAVORABLE",
        score: 1.5,
        base_weight: 1.5,
        evidence: "Favorable PBM formulary placement preferred tier",
      },
    });
    expect(art.market_access.relevant).toBe(true);
    expect(art.market_access.score).not.toBeNull();
    expect(art.clinical.score).toBeNull();
  });

  it("aggregates same-axis hits with secondary cap", () => {
    const a = scoreFromTaxonomyDim("financial", {
      event_id: "FIN_DILUTIVE_OFFERING",
      score: -1.5,
      base_weight: -1.5,
    });
    const b = scoreFromTaxonomyDim("corporate", {
      event_id: "CORP_PARTNERSHIP_SIGNED",
      score: 2.0,
      base_weight: 2.0,
    });
    // |+0.40| partnership vs |-0.35| dilutive — partnership leads
    const agg = aggregateAxisScores([a, b], "financial");
    expect(agg.score).not.toBeNull();
    expect(Math.abs(agg.score!)).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs(agg.score!)).toBeLessThanOrEqual(0.55);
  });

  it("nearest benchmarks stay on-axis", () => {
    const near = nearestBenchmarks("clinical", 0.8, 3);
    expect(near.every((b) => b.axis === "clinical")).toBe(true);
  });

  it("refines Ph3 miss vs Ph2 miss from evidence text", () => {
    resetThermometerBenchmarkCacheForTests();
    const ph3 = scoreFromTaxonomyDim("clinical", {
      event_id: "CLIN_PRIMARY_MISSED",
      score: -2.5,
      base_weight: -2.5,
      evidence: "Phase 3 topline primary endpoint missed",
    });
    expect(ph3.score).toBe(-0.75);
    const ph2 = scoreFromTaxonomyDim("clinical", {
      event_id: "CLIN_PRIMARY_MISSED",
      score: -2.0,
      base_weight: -2.0,
      evidence: "Phase 2 topline negative missed endpoint",
    });
    expect(ph2.score).toBe(-0.5);
  });

  it("scores financial earnings on financial axis only", () => {
    resetThermometerBenchmarkCacheForTests();
    const art = scoreArticleThermometer({
      financial: {
        event_id: "FIN_EARNINGS_REPORTED",
        score: 0.35,
        base_weight: 0.35,
        evidence: "Net revenue of $0.6 million",
      },
      clinical: {
        unclassified: true,
        score: 0,
      },
    });
    expect(art.financial.relevant).toBe(true);
    expect(art.clinical.relevant).toBe(false);
    expect(art.market_access.relevant).toBe(false);
  });

  it("human confirm writes back into local benchmark overlay", () => {
    const scored = scoreFromTaxonomyDim("clinical", {
      event_id: "CLIN_PRIMARY_MET",
      score: 2.5,
      base_weight: 2.5,
    });
    expect(listBenchmarkOverlayForTests()).toHaveLength(0);
    const confirmed = applyManualAxisScore(scored, 0.85, {
      confirmOnly: true,
      articleKey: "test-article-1",
    });
    expect(confirmed.confidence).toBe("confirmed");
    const overlay = listBenchmarkOverlayForTests();
    expect(overlay.length).toBe(1);
    expect(overlay[0]!.confidence).toBe("confirmed");
    expect(overlay[0]!.anchorScore).toBe(0.85);
    expect(overlay[0]!.taxonomyEventId).toBe("CLIN_PRIMARY_MET");
  });

  it("uses server thermometer_importance as matchSource", () => {
    const scored = scoreFromTaxonomyDim("clinical", {
      event_id: "CLIN_PRIMARY_MET",
      score: 2.5,
      base_weight: 2.5,
      thermometer_importance: 0.85,
    });
    expect(scored.matchSource).toBe("server_importance");
    expect(scored.score).toBe(0.85);
  });
});
