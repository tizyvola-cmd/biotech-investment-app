import { describe, expect, it } from "vitest";
import { buildMcsBannerSummary, xbiVolumeSurgeRatio } from "./marketContextBannerSummary";
import { buildMarketContextDecisionCtx, type MarketContextSnapshotDoc } from "./marketContextScore";

function sampleDoc(overrides?: Partial<MarketContextSnapshotDoc>): MarketContextSnapshotDoc {
  return {
    update_status: "ok",
    last_successful_update: "2026-08-28T18:47:00+00:00",
    latest: {
      date: "2026-08-28",
      mcs_global: 40,
      components: {
        sector: { score: 67, xbi_slope_5d_pct: -1.979 },
        macro: { score: 24, vix_level: 14.56 },
        breadth: { score: 30, proxy: true },
        fda: { score: 0 },
      },
    },
    series: {
      XBI: [
        { date: "2026-08-01", close: 170, volume: 5_000_000 },
        { date: "2026-08-28", close: 162, volume: 9_000_000 },
      ],
    },
    ...overrides,
  };
}

describe("marketContextBannerSummary", () => {
  it("attributes ambiguous session to dominant sector driver", () => {
    const doc = sampleDoc();
    const ctx = buildMarketContextDecisionCtx(doc);
    const s = buildMcsBannerSummary(doc, ctx);
    expect(s.dominantDriver).toBe("sector");
    expect(s.headlineEn).toContain("Mixed");
    expect(s.attributionEn).toContain("biotech sector");
    expect(s.attributionEn).toContain("-2.0");
  });

  it("flags volume surge when last bar exceeds threshold", () => {
    const doc = sampleDoc({
      series: {
        XBI: Array.from({ length: 22 }, (_, i) => ({
          date: `2026-08-${String(i + 1).padStart(2, "0")}`,
          close: 160 + i * 0.1,
          volume: i === 21 ? 12_000_000 : 5_000_000,
        })),
      },
    });
    const ratio = xbiVolumeSurgeRatio(doc);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1.3);
    const s = buildMcsBannerSummary(doc, buildMarketContextDecisionCtx(doc));
    expect(s.volumeSurge).toBe(true);
    expect(s.headlineIt).toContain("Volume investimenti");
  });
});
