import { describe, expect, it } from "vitest";
import {
  buildMissedOpportunityAudit,
  buildMissedOppErrorTrend,
  buildMissedOppPnlDailySeries,
  buildMissedOppPnlTrend,
  computeMissedOppDailyPnl,
  inferMissBlockers,
  inMissedOppOperationalWindow,
  inMissedOppWatchWindow,
  MISSED_OPP_CAPITAL_EUR,
  MISSED_OPP_ERROR_TREND_START_DATE,
  MISSED_OPP_GAIN_24H_MIN_PCT,
  MISSED_OPP_OP_MAX_DAYS,
  MISSED_OPP_OP_MIN_DAYS,
  pnlEurFrom24hPct,
  type MissedOppDailySnapshot,
  type MissedOppRow,
} from "./missedOpportunityAudit";

describe("inferMissBlockers", () => {
  it("flags low forward target", () => {
    const blockers = inferMissBlockers({
      lang: "en",
      exitDecision: "exit",
      planReturnPct: 0.4,
      probPct: 74,
      matchPct: 79,
      segmentRoiPct: -3.2,
      stabilityVerdict: "watch",
      precatKind: "enter",
      recoverySummary: null,
    });
    expect(blockers.some((b) => b.includes("0.4"))).toBe(true);
    expect(blockers.some((b) => b.includes("-3.2"))).toBe(true);
  });
});

describe("inMissedOppWatchWindow", () => {
  it("is T-61 through T-120", () => {
    expect(inMissedOppWatchWindow(60)).toBe(false);
    expect(inMissedOppWatchWindow(61)).toBe(true);
    expect(inMissedOppWatchWindow(120)).toBe(true);
    expect(inMissedOppWatchWindow(121)).toBe(false);
  });
});

describe("inMissedOppOperationalWindow", () => {
  it("is T-14 through T-90", () => {
    expect(MISSED_OPP_OP_MIN_DAYS).toBe(14);
    expect(MISSED_OPP_OP_MAX_DAYS).toBe(90);
    expect(inMissedOppOperationalWindow(13)).toBe(false);
    expect(inMissedOppOperationalWindow(14)).toBe(true);
    expect(inMissedOppOperationalWindow(75)).toBe(true);
    expect(inMissedOppOperationalWindow(90)).toBe(true);
    expect(inMissedOppOperationalWindow(91)).toBe(false);
  });
});

describe("buildMissedOpportunityAudit", () => {
  it("classifies gainer without Enter as missed", () => {
    const simTable = {
      sheet: "simulation",
      columns: ["Ticker", "Completion Date", "Var. Giorn. %"],
      rows: [
        {
          Ticker: "RISE",
          "Completion Date": "2026-06-20",
          "Var. Giorn. %": 2.5,
          "Slope 20g": 0.01,
          "Slope 5g": 0.01,
        },
        {
          Ticker: "FLAT",
          "Completion Date": "2026-06-25",
          "Var. Giorn. %": 0.1,
        },
      ],
    };
    const summary = buildMissedOpportunityAudit({
      simTable,
      inputs: {},
      pointsBySeriesKey: new Map(),
      lang: "en",
      probOptions: null,
    });
    expect(summary.with24hN).toBe(2);
    expect(summary.gainersN).toBe(1);
    expect(summary.missedN + summary.detectedN).toBeLessThanOrEqual(summary.gainersN);
    expect(MISSED_OPP_GAIN_24H_MIN_PCT).toBe(0.5);
  });
});

describe("computeMissedOppDailyPnl", () => {
  const baseRow = (over: Partial<MissedOppRow>): MissedOppRow => ({
    key: "x",
    ticker: "X",
    company: null,
    completionDate: "2026-06-20",
    dailyPct24h: 2,
    daysToCd: 30,
    bucket: "detected",
    suggested: false,
    exitDecision: "hold",
    probPct: 70,
    planReturnPct: 5,
    matchPct: 80,
    segmentRoiPct: 2,
    blockers: [],
    inPortfolio: false,
    inMonitorWindow: true,
    inOperationalWindow: true,
    inWatchWindow: false,
    ...over,
  });

  it("sums gainers and recommendation-followed rows at €5000 each", () => {
    const rows = [
      baseRow({ dailyPct24h: 2, suggested: true }),
      baseRow({ key: "y", dailyPct24h: 1, inPortfolio: true }),
      baseRow({ key: "z", dailyPct24h: 0.2, suggested: false }),
    ];
    const pnl = computeMissedOppDailyPnl(rows);
    expect(pnlEurFrom24hPct(MISSED_OPP_CAPITAL_EUR, 2)).toBe(100);
    expect(pnl.pnlAllGainersEur).toBe(150);
    expect(pnl.pnlRecommendationsEur).toBe(150);
  });
});

describe("buildMissedOppPnlTrend", () => {
  it("accumulates daily EUR snapshots", () => {
    const trend = buildMissedOppPnlTrend([
      { date: "2026-06-08", recallPct: null, missedN: 0, detectedN: 0, gainersN: 2, pnlAllGainersEur: 100, pnlRecommendationsEur: 80, pnlActualEur: 50 },
      { date: "2026-06-09", recallPct: null, missedN: 0, detectedN: 0, gainersN: 1, pnlAllGainersEur: 200, pnlRecommendationsEur: 120, pnlActualEur: -30 },
    ]);
    expect(trend).toHaveLength(2);
    expect(trend[1].cumAllGainers).toBe(300);
    expect(trend[1].cumRecommendations).toBe(200);
    expect(trend[1].cumActual).toBe(20);
  });
});

describe("buildMissedOppPnlDailySeries", () => {
  it("tracks day-over-day actual delta and capture rate", () => {
    const daily = buildMissedOppPnlDailySeries([
      { date: "2026-06-11", recallPct: null, missedN: 0, detectedN: 0, gainersN: 2, pnlAllGainersEur: 800, pnlRecommendationsEur: 500, pnlActualEur: 300 },
      { date: "2026-06-12", recallPct: null, missedN: 0, detectedN: 0, gainersN: 1, pnlAllGainersEur: 1144, pnlRecommendationsEur: 608, pnlActualEur: 391 },
    ]);
    expect(daily).toHaveLength(2);
    expect(daily[0].deltaActual).toBeNull();
    expect(daily[1].deltaActual).toBe(91);
    expect(daily[1].capturePct).toBeCloseTo(64.3, 1);
    expect(daily[1].gapVsRecEur).toBe(217);
  });
});

describe("buildMissedOppErrorTrend", () => {
  const emptyBucket = {
    fpRatePct: null,
    missRatePct: null,
    fpAvgDropPct: null,
    missAvgGainPct: null,
    samples: 0,
    enterSamples: 0,
    gainerSamples: 0,
    fpDropSamples: 0,
    missGainSamples: 0,
  };

  const snap = (date: string, missAvgGainPct: number | null): MissedOppDailySnapshot => ({
    date,
    recallPct: null,
    missedN: 1,
    detectedN: 0,
    gainersN: 3,
    errorClose: {
      ...emptyBucket,
      missAvgGainPct,
      missGainSamples: missAvgGainPct != null ? 2 : 0,
    },
    errorFar: emptyBucket,
  });

  it(`starts at ${MISSED_OPP_ERROR_TREND_START_DATE}`, () => {
    const trend = buildMissedOppErrorTrend(
      [
        snap("2026-06-11", 2.1),
        snap("2026-06-16", 1.8),
        snap("2026-06-17", null),
        snap("2026-06-18", 1.6),
      ],
      "close",
    );
    expect(trend.map((p) => p.date)).toEqual(["06-17", "06-18"]);
    expect(trend[1]?.missAvgGainPctNeg).toBeCloseTo(-1.6, 5);
  });
});
