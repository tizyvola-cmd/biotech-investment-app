import { describe, expect, it } from "vitest";
import {
  classifyTickerEisEvent,
  clinicalEventsLinkedToProduct,
  clinicalNewsEventsOnly,
  filterEventsLast24h,
  filterEventsLastDays,
  isClinicalNewsEvent,
  partitionTickerEisEvents,
  pickEisLaneEvents,
  pickLatestEisNewsEvents,
  resolveEisBannerDualScores,
  sortEventsByImpact,
} from "./tickerImpactEvents";
import type { TickerEisEventDetail } from "./tickerEisSummary";

function ev(
  partial: Partial<TickerEisEventDetail> & Pick<TickerEisEventDetail, "breakdown">,
): TickerEisEventDetail {
  return {
    eventDate: "2025-01-15",
    title: "Study readout",
    sourceType: "clinical",
    sourceLabel: "Clinical",
    nctId: null,
    studyTitle: "Phase 2",
    studyUrl: null,
    indicators: [],
    impactNote: null,
    link: null,
    summary: null,
    ...partial,
  };
}

describe("filterEventsLast24h", () => {
  it("keeps events within the last 24 hours", () => {
    const now = Date.parse("2026-07-02T12:00:00");
    const recent = ev({
      eventDate: "2026-07-02",
      breakdown: { score: 3, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    const old = ev({
      eventDate: "2026-06-28",
      breakdown: { score: 5, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(filterEventsLast24h([old, recent], now)).toEqual([recent]);
  });
});

describe("filterEventsLastDays", () => {
  it("keeps events within the last 7 calendar days", () => {
    const now = Date.parse("2026-07-02T12:00:00");
    const withinWeek = ev({
      eventDate: "2026-06-28",
      breakdown: { score: 4, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    const older = ev({
      eventDate: "2026-06-20",
      breakdown: { score: 6, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(filterEventsLastDays([older, withinWeek], 7, now)).toEqual([withinWeek]);
  });
});

describe("tickerImpactEvents", () => {
  it("classifies SEC 8-K as regulatory", () => {
    const item = ev({
      sourceType: "sec_8k",
      sourceLabel: "SEC 8-K",
      title: "Material agreement",
      breakdown: { score: 8, delta_p_1d: 5, delta_p_3d: 3, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(classifyTickerEisEvent(item)).toBe("regulatory");
  });

  it("classifies PDUFA in title as regulatory", () => {
    const item = ev({
      title: "PDUFA date confirmed",
      breakdown: { score: 6, delta_p_1d: 2, delta_p_3d: 1, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(classifyTickerEisEvent(item)).toBe("regulatory");
  });

  it("sorts by absolute score descending", () => {
    const low = ev({ breakdown: { score: 2, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } } });
    const high = ev({ breakdown: { score: -12, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } } });
    expect(sortEventsByImpact([low, high])[0]).toBe(high);
  });

  it("partitions clinical and regulatory buckets", () => {
    const clinical = ev({
      breakdown: {
        score: 3,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_term: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    const regulatory = ev({
      sourceType: "sec_8k",
      breakdown: { score: 5, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    const parts = partitionTickerEisEvents([clinical, regulatory]);
    expect(parts.clinical).toHaveLength(1);
    expect(parts.regulatory).toHaveLength(1);
  });

  it("CD popup keeps only news that name the product or share its NCT", () => {
    const zero = {
      score: 0,
      delta_p_1d: 0,
      delta_p_3d: 0,
      vol_term: 0,
      sent_term: 0,
      kpi_score: null,
      weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
    };
    const productNews = ev({
      sourceType: "press_release",
      title: "CHS-114 combination shows early activity",
      nctId: "NCT09999999",
      breakdown: zero,
    });
    const sameNct = ev({
      sourceType: "ctgov",
      title: "Enrollment update in advanced solid tumors",
      nctId: "NCT05635643",
      breakdown: zero,
    });
    const tickerWide = ev({
      sourceType: "press_release",
      title: "Coherus Oncology presents at Morgan Stanley conference",
      summary: "Study of SRF617 in patients with advanced solid tumors",
      nctId: null,
      breakdown: zero,
    });
    const filing = ev({
      sourceType: "sec_8k",
      title: "CHS-114 mentioned in 8-K",
      breakdown: zero,
    });
    const kept = clinicalEventsLinkedToProduct([productNews, sameNct, tickerWide, filing], {
      productName: "CHS-114",
      nctId: "NCT05635643",
    });
    expect(kept.map((e) => e.title)).toEqual([
      "CHS-114 combination shows early activity",
      "Enrollment update in advanced solid tumors",
    ]);
  });

  it("clinical news tab keeps trial/press/CD and drops 8-K", () => {
    const press = ev({
      sourceType: "press_release",
      title: "Phase 3 primary endpoint met",
      breakdown: { score: 3, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    const cd = ev({
      sourceType: "cd_milestone",
      title: "Primary completion",
      breakdown: { score: 1, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    const filing = ev({
      sourceType: "sec_8k",
      title: "Results of Operations and Financial Condition",
      breakdown: { score: 5, delta_p_1d: 0, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(isClinicalNewsEvent(press)).toBe(true);
    expect(isClinicalNewsEvent(cd)).toBe(true);
    expect(isClinicalNewsEvent(filing)).toBe(false);
    expect(clinicalNewsEventsOnly([press, cd, filing])).toEqual([press, cd]);
  });

  it("keeps manual 24h research in the EIS lane even with regulatory KPI indicators", () => {
    const manual = ev({
      sourceType: "manual",
      title: "CPIX — Closing of the Sale to Apotex for $100M",
      indicators: [{ kpi_type: "regulatory", label: "PDUFA" } as never],
      breakdown: { score: 7.5, delta_p_1d: 8.95, delta_p_3d: 0, vol_term: 0, sent_term: 0, kpi_score: null, weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 } },
    });
    expect(classifyTickerEisEvent(manual)).toBe("clinical");
    const parts = partitionTickerEisEvents([manual]);
    expect(parts.clinical).toHaveLength(1);
    expect(parts.regulatory).toHaveLength(0);
  });

  it("never mirrors regulatory events into the EIS lane", () => {
    const onlyReg = ev({
      sourceType: "sec_8k",
      title: "Material Events",
      summary: "Company disclosed a material agreement.",
      link: "https://example.com/8k",
      breakdown: {
        score: 12,
        delta_p_1d: 4,
        delta_p_3d: 2,
        vol_term: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    const clinical = ev({
      title: "Topline readout",
      breakdown: {
        score: 3,
        delta_p_1d: 1,
        delta_p_3d: 1,
        vol_term: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    expect(pickEisLaneEvents([onlyReg], 2)).toEqual([]);
    expect(pickEisLaneEvents([onlyReg, clinical], 2)).toEqual([clinical]);
  });

  it("latest news prefers the 7-day window then falls back to recency", () => {
    const now = Date.parse("2026-07-02T12:00:00");
    const recent = ev({
      eventDate: "2026-06-30",
      title: "Recent EIS",
      summary: "Recent summary",
      breakdown: {
        score: 3,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_term: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    const older = ev({
      eventDate: "2026-05-01",
      title: "Older EIS",
      breakdown: {
        score: 9,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_term: 0,
        sent_term: 0,
        kpi_score: null,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    expect(pickLatestEisNewsEvents([older, recent], 8, now)).toEqual([recent]);
    expect(pickLatestEisNewsEvents([older], 8, now)).toEqual([older]);
  });
});

describe("resolveEisBannerDualScores", () => {
  it("includes regulatory events in Market (not only the clinical partition)", () => {
    const clinical = ev({
      breakdown: {
        score: 1.2,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_term: 0,
        sent_term: 0,
        kpi_score: 0.4,
        eis_intrinsic: 4,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    const regulatory = ev({
      sourceType: "cd_milestone",
      title: "Primary completion",
      breakdown: {
        score: 2.3,
        delta_p_1d: 0,
        delta_p_3d: 0,
        vol_term: 0,
        sent_term: 0,
        kpi_score: 0.2,
        eis_intrinsic: 2,
        weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
      },
    });
    const dual = resolveEisBannerDualScores([clinical, regulatory], null);
    expect(dual.market).toBeCloseTo(3.5, 5);
    expect(dual.clinical).toBeCloseTo(6, 5);
  });

  it("falls back to headline score when the feed has no events", () => {
    const dual = resolveEisBannerDualScores([], 4.4);
    expect(dual.market).toBe(4.4);
    expect(dual.clinical).toBeNull();
  });
});
