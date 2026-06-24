import { describe, expect, it } from "vitest";
import {
  buildEisMagnitudeView,
  mergeEisMagnitudeAnalysis,
  resolveEisScatterBundle,
  synthesizeScatterFromSplit,
} from "./eisSignalImpactView";
import type { EisMagnitudeAnalysisDoc } from "../data/signalCalibrationData";

describe("resolveEisScatterBundle", () => {
  it("falls back to correlation.regression_1d when scatter payload is missing", () => {
    const analysis: EisMagnitudeAnalysisDoc = {
      n_events_scored: 10,
      n_with_price_1d: 8,
      correlation: {
        n_1d: 8,
        pearson_eis_vs_delta_p_1d: 0.86,
        regression_1d: {
          n: 8,
          slope: 1.2,
          intercept: -0.5,
          r: 0.86,
          line: [
            { x: -1, y: -1.7 },
            { x: 2, y: 1.9 },
          ],
        },
      },
    };
    const { bundle } = resolveEisScatterBundle(analysis, "delta_p_1d");
    expect(bundle?.regression?.slope).toBe(1.2);
    expect(bundle?.regression?.line).toHaveLength(2);
  });

  it("synthesizes scatter from median split when scatter and regression missing", () => {
    const analysis: EisMagnitudeAnalysisDoc = {
      n_events_scored: 74,
      n_with_price_1d: 74,
      correlation: { n_1d: 74, pearson_eis_vs_delta_p_1d: 0.864 },
      split: {
        threshold: -0.07,
        low_eis: { n_with_price: 47, avg_move_pp: -8.54 },
        high_eis: { n_with_price: 27, avg_move_pp: 7.13 },
      },
    };
    const synth = synthesizeScatterFromSplit(analysis, "delta_p_1d");
    expect(synth?.points?.length).toBeGreaterThanOrEqual(3);
    expect(synth?.regression?.line?.length).toBe(2);
    const view = buildEisMagnitudeView({ eis_magnitude_analysis: analysis });
    expect(view.chartsNeedLiveApi).toBe(false);
    expect(view.scatter1d?.regression?.line?.length).toBe(2);
  });
});

describe("buildEisMagnitudeView", () => {
  it("merges live scatter over stale bundled snapshot", () => {
    const bundled: EisMagnitudeAnalysisDoc = {
      n_events_scored: 74,
      n_with_price_1d: 74,
      correlation: { n_1d: 74, pearson_eis_vs_delta_p_1d: 0.864 },
    };
    const live: EisMagnitudeAnalysisDoc = {
      n_events_scored: 74,
      scatter: {
        delta_p_1d: {
          points: [{ x: 1, y: 2, ticker: "ABC" }],
          regression: { n: 1, slope: 1, intercept: 0, r: 1, line: [] },
          n_total: 1,
        },
      },
      temporal_regression: [
        {
          window: "61–90d",
          regression_1d: { n: 5, slope: 2.1, r: 0.97, line: [] },
          n_with_price_1d: 5,
        },
      ],
    };
    const merged = mergeEisMagnitudeAnalysis(bundled, live);
    const view = buildEisMagnitudeView(
      { eis_magnitude_analysis: bundled },
      merged ?? undefined,
    );
    expect(view.scatter1d?.points).toHaveLength(1);
    expect(view.slopeChartRows.some((r) => r.window === "61–90d" && r.slope1d === 2.1)).toBe(true);
    expect(view.chartsNeedLiveApi).toBe(false);
  });

  it("prefers full scatter over synthesized median-split cache", () => {
    const synthesized: EisMagnitudeAnalysisDoc = {
      n_events_scored: 74,
      n_with_price_1d: 74,
      scatter: {
        delta_p_1d: {
          points: [
            { x: -0.4, y: -8, ticker: "low EIS" },
            { x: 0, y: 0, ticker: "median" },
            { x: 0.4, y: 7, ticker: "high EIS" },
          ],
          regression: { n: 74, slope: 22, intercept: 0, r: 0.86, line: [] },
        },
      },
    };
    const full: EisMagnitudeAnalysisDoc = {
      n_events_scored: 74,
      n_with_price_1d: 74,
      scatter: {
        delta_p_1d: {
          points: Array.from({ length: 20 }, (_, i) => ({ x: i * 0.1, y: i, ticker: `T${i}` })),
          regression: { n: 74, slope: 22, intercept: 0, r: 0.86, line: [] },
        },
      },
    };
    const merged = mergeEisMagnitudeAnalysis(synthesized, full);
    expect(merged?.scatter?.delta_p_1d?.points).toHaveLength(20);
  });
});
