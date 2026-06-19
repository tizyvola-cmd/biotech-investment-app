import { describe, expect, it } from "vitest";
import { buildCdPatternTickerRecommendation } from "./cdPatternRecommendation";
import type { ChartPoint } from "../types";

function modelPoint(offset: number, pct: number): ChartPoint {
  return { offset, pct_foglio: pct, nodo: "standard" };
}

describe("buildCdPatternTickerRecommendation segmentRoiPct", () => {
  it("uses full arc window on model curve, not partial to today", () => {
    const futureCd = new Date();
    futureCd.setDate(futureCd.getDate() + 19);
    const iso = futureCd.toISOString().slice(0, 10);

    const chartPoints = [
      modelPoint(-30, 0),
      modelPoint(-19, 3),
      modelPoint(-10, 7),
    ];

    const rec = buildCdPatternTickerRecommendation({
      row: { Ticker: "TLX", "Completion Date": iso, Company: "Telix" },
      chartPoints,
      investInputs: {},
      sdsRows: [],
      migByKey: new Map(),
      includeEis: false,
    });

    expect(rec?.window.id).toBe("w2");
    expect(rec?.segmentRoiPct).toBe(7);
  });

  it("uses sheet Clinical KPI when feed has no events", () => {
    const futureCd = new Date();
    futureCd.setDate(futureCd.getDate() + 77);
    const iso = futureCd.toISOString().slice(0, 10);

    const rec = buildCdPatternTickerRecommendation({
      row: { Ticker: "WVE", "Completion Date": iso, "Clinical KPI": 12 },
      chartPoints: [modelPoint(-77, 0.1), modelPoint(-60, 0.2)],
      investInputs: {},
      sdsRows: [],
      migByKey: new Map(),
      includeEis: true,
    });

    expect(rec?.nearestEis).not.toBeNull();
    expect(rec?.nearestEis?.score).toBe(12);
    expect(rec?.nearestEis?.title).toMatch(/Clinical KPI|KPI clinico/i);
  });

  it("returns null when chart lacks window boundary model points", () => {
    const futureCd = new Date();
    futureCd.setDate(futureCd.getDate() + 19);
    const iso = futureCd.toISOString().slice(0, 10);

    const rec = buildCdPatternTickerRecommendation({
      row: { Ticker: "TLX", "Completion Date": iso },
      chartPoints: [modelPoint(-19, 7)],
      investInputs: {},
      sdsRows: [],
      migByKey: new Map(),
      includeEis: false,
    });

    expect(rec?.segmentRoiPct).toBeNull();
  });
});
