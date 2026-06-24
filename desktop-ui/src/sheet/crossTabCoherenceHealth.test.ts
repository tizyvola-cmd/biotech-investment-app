import { describe, expect, it } from "vitest";
import { assessCrossTabCoherenceHealth } from "./crossTabCoherenceHealth";
import type { CrossTabCoherenceReport } from "./crossTabCoherence";

function baseReport(over: Partial<CrossTabCoherenceReport> = {}): CrossTabCoherenceReport {
  return {
    strictHot: 0,
    strictWatch: 0,
    strictHotKeys: [],
    strictWatchKeys: [],
    relaxedHot: 0,
    relaxedWatch: 0,
    sliderRelaxedHot: 0,
    divergentTickers: [],
    upsideThresholdPct: 1.5,
    minAffidabilitaPct: 85,
    store: {
      hotKeys: [],
      watchKeys: [],
      top2BuyKeys: [],
      publishedBy: "dashboard-strict",
      updatedAt: Date.now(),
    },
    storeAgeMinutes: 10,
    slopeFeedPortfolioRows: 0,
    openPositions: 0,
    buyPriceWarningTickers: [],
    ...over,
  };
}

describe("assessCrossTabCoherenceHealth", () => {
  it("overall ok when store matches strict and no warnings", () => {
    const h = assessCrossTabCoherenceHealth(baseReport());
    expect(h.overall).toBe("ok");
    expect(h.criticalIssues).toHaveLength(0);
  });

  it("error when buy price warnings present", () => {
    const h = assessCrossTabCoherenceHealth(
      baseReport({ buyPriceWarningTickers: ["OLMA"] }),
    );
    expect(h.overall).toBe("error");
    expect(h.metricLevels.buyWarn).toBe("error");
    expect(h.criticalIssues.some((i) => i.id === "buyPriceInputs")).toBe(true);
  });

  it("error when store hot keys differ from strict", () => {
    const h = assessCrossTabCoherenceHealth(
      baseReport({
        strictHot: 1,
        strictHotKeys: ["co:BCAB|2026-06-01"],
        store: {
          hotKeys: ["co:VRTX|2026-07-01"],
          watchKeys: [],
          top2BuyKeys: [],
          publishedBy: "dashboard-strict",
          updatedAt: Date.now(),
        },
      }),
    );
    expect(h.overall).toBe("error");
    expect(h.metricLevels.storeAlignment).toBe("error");
  });

  it("ok when store and strict use same series key (PLSE)", () => {
    const key = "co:PLSE|2026-06-25";
    const h = assessCrossTabCoherenceHealth(
      baseReport({
        strictHot: 1,
        strictHotKeys: [key],
        store: {
          hotKeys: [key],
          watchKeys: [],
          top2BuyKeys: [],
          publishedBy: "dashboard-strict",
          updatedAt: Date.now(),
        },
      }),
    );
    expect(h.overall).toBe("ok");
    expect(h.criticalIssues).toHaveLength(0);
  });

  it("warn not critical when store hot but strict empty (stale store)", () => {
    const h = assessCrossTabCoherenceHealth(
      baseReport({
        strictHot: 0,
        strictHotKeys: [],
        store: {
          hotKeys: ["co:PLSE|2026-06-25"],
          watchKeys: [],
          top2BuyKeys: [],
          publishedBy: "dashboard-strict",
          updatedAt: Date.now(),
        },
      }),
    );
    expect(h.overall).toBe("warn");
    expect(h.criticalIssues).toHaveLength(0);
    expect(h.warningIssues.some((i) => i.id === "storeAlignment")).toBe(true);
  });

  it("warn when relaxed-only tickers exist but not in store", () => {
    const h = assessCrossTabCoherenceHealth(
      baseReport({
        relaxedHot: 2,
        divergentTickers: ["VRTX", "VWA"],
      }),
    );
    expect(h.overall).toBe("warn");
    expect(h.metricLevels.relaxedHot).toBe("warn");
    expect(h.criticalIssues).toHaveLength(0);
  });

  it("error when legacy preview publisher has hot keys", () => {
    const h = assessCrossTabCoherenceHealth(
      baseReport({
        store: {
          hotKeys: ["VRTX"],
          watchKeys: [],
          top2BuyKeys: [],
          publishedBy: "dashboard-preview",
          updatedAt: Date.now(),
        },
      }),
    );
    expect(h.overall).toBe("error");
    expect(h.criticalIssues.some((i) => i.id === "publishSource")).toBe(true);
  });
});
