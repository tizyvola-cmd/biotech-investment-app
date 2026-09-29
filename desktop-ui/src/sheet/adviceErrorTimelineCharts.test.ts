import { describe, expect, it } from "vitest";
import {
  buildAdviceErrorActionDots,
  buildAdviceErrorByAction,
  buildAdviceBuySellHorizonDots,
  buildAdviceErrorTimeBuckets,
  buildAdviceErrorTimeDots,
  chartableBuySellAdvicePoints,
  classifyMissSellLossTier,
  classifyOperationalAdviceError,
  filterAdvicePointsByActions,
  filterAdvicePointsByHorizon,
  isCriticalMissSellLoss,
  isMissBuyRally,
  stableAdvicePointAt,
  summarizeBuySellAdviceWindow,
  weekStartKey,
} from "./adviceErrorTimelineCharts";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import { buildAdviceCalibrationFromLog } from "./investDecisionSimAdviceCalibration";

function point(
  overrides: Partial<AdviceCalibrationPoint> & Pick<AdviceCalibrationPoint, "suggestedAction">,
): AdviceCalibrationPoint {
  return {
    id: "x",
    ticker: "TST",
    probPct: 55,
    bucketId: "50-59",
    bucketLabel: "50–59%",
    outcome: "good",
    pnlPct: null,
    priceChangePct: 2,
    expectedReturnPct: 1,
    forecastErrorPct: 1,
    source: "experiment",
    kind: "sell",
    at: "2026-05-01T10:00:00.000Z",
    suggestedAction: "buy",
    ...overrides,
  };
}

describe("adviceErrorTimelineCharts", () => {
  it("filters by action set", () => {
    const pts = [point({ suggestedAction: "buy" }), point({ suggestedAction: "sell", id: "y" })];
    const filtered = filterAdvicePointsByActions(pts, new Set(["sell"]));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.suggestedAction).toBe("sell");
  });

  it("builds weekly time buckets with improving success", () => {
    const pts = [
      point({ at: "2026-04-07T10:00:00Z", outcome: "bad", forecastErrorPct: -5 }),
      point({ at: "2026-04-08T10:00:00Z", outcome: "good", forecastErrorPct: 2 }),
      point({ at: "2026-05-15T10:00:00Z", outcome: "good", forecastErrorPct: 1 }),
      point({ at: "2026-05-16T10:00:00Z", outcome: "good", forecastErrorPct: 0.5 }),
    ];
    const buckets = buildAdviceErrorTimeBuckets(pts, "en");
    expect(buckets.length).toBe(2);
    expect(buckets[0]?.successPct).toBe(50);
    expect(buckets[1]?.successPct).toBe(100);
    expect(buckets[1]?.meanAbsErrorPct).toBeLessThan(buckets[0]?.meanAbsErrorPct ?? 999);
  });

  it("builds per-action error summary", () => {
    const pts = [
      point({ suggestedAction: "buy", outcome: "good", forecastErrorPct: 1 }),
      point({ suggestedAction: "sell", outcome: "bad", forecastErrorPct: -3, id: "b" }),
    ];
    const byAction = buildAdviceErrorByAction(pts);
    expect(byAction.find((b) => b.action === "buy")?.successPct).toBe(100);
    expect(byAction.find((b) => b.action === "sell")?.successPct).toBe(0);
  });

  it("weekStartKey aligns to Monday", () => {
    expect(weekStartKey("2026-05-15T10:00:00Z")).toBe("2026-05-11");
  });

  it("keeps live advice dots stable when at is empty", () => {
    const live = point({
      id: "live|ABC|buy",
      source: "live",
      at: "",
      suggestedAction: "buy",
    });
    const anchor = stableAdvicePointAt(live);
    const dotsA = buildAdviceErrorTimeDots([live], "en");
    const dotsB = buildAdviceErrorTimeDots([{ ...live, at: anchor }], "en");
    expect(dotsA[0]?.x).toBe(dotsB[0]?.x);
    expect(dotsA[0]?.xLabel).toBe(dotsB[0]?.xLabel);
  });

  it("builds buy/sell horizon dots with operational error kinds", () => {
    const now = new Date("2026-06-15T12:00:00.000Z").getTime();
    const pts = [
      point({
        at: "2026-06-15T10:00:00.000Z",
        suggestedAction: "buy",
        outcome: "good",
        priceChangePct: 2,
        kind: "buy_rec",
      }),
      point({
        at: "2026-06-15T08:00:00.000Z",
        suggestedAction: "sell",
        forecastErrorPct: -3,
        outcome: "bad",
        priceChangePct: 3,
        id: "s1",
      }),
      point({
        at: "2026-06-01T10:00:00.000Z",
        suggestedAction: "buy",
        outcome: "bad",
        priceChangePct: -2,
        id: "old",
      }),
    ];
    expect(filterAdvicePointsByHorizon(pts, "24h", now)).toHaveLength(2);
    const dots = buildAdviceBuySellHorizonDots(pts, "24h", "en", now);
    expect(dots).toHaveLength(2);
    expect(dots.find((d) => d.errorKind === "missBuy")?.visualClass).toBe("secondary");
    expect(dots.find((d) => d.errorKind === "wrongSell")?.visualClass).toBe("secondary");
  });

  it("flags critical miss-sell with loss tier and red visual class", () => {
    const now = new Date("2026-06-15T12:00:00.000Z").getTime();
    const missSell = point({
      at: "2026-06-15T09:00:00.000Z",
      suggestedAction: "sell",
      outcome: "good",
      forecastErrorPct: -4.2,
      priceChangePct: -4.2,
      source: "live",
      kind: "live",
      id: "miss-sell",
    });
    expect(isCriticalMissSellLoss(missSell)).toBe(true);
    expect(classifyMissSellLossTier(4.2)).toBe(1);
    expect(classifyMissSellLossTier(30)).toBe(2);
    expect(classifyMissSellLossTier(60)).toBe(3);
    expect(classifyMissSellLossTier(90)).toBe(4);

    const dots = buildAdviceBuySellHorizonDots([missSell], "all", "en", now);
    expect(dots[0]?.visualClass).toBe("criticalMissSell");
    expect(dots[0]?.missSellLossTier).toBe(1);
    expect(dots[0]?.secondaryPalette).toBeUndefined();
  });

  it("executed paper sell is not critical miss-sell", () => {
    const executed = point({
      suggestedAction: "sell",
      outcome: "bad",
      forecastErrorPct: -5,
      priceChangePct: -5,
      kind: "paper_sell",
      id: "paper",
    });
    expect(isCriticalMissSellLoss(executed)).toBe(false);
  });

  it("all history includes older buy/sell and uses price-change fallback", () => {
    const now = new Date("2026-06-15T12:00:00.000Z").getTime();
    const pts = [
      point({
        at: "2026-06-01T10:00:00.000Z",
        suggestedAction: "sell",
        outcome: "bad",
        forecastErrorPct: null,
        priceChangePct: 4.2,
        expectedReturnPct: 0,
        id: "sell-fallback",
      }),
      point({
        at: "2026-06-15T10:00:00.000Z",
        suggestedAction: "buy",
        outcome: "bad",
        forecastErrorPct: 1,
        priceChangePct: -1.2,
        id: "recent",
      }),
    ];
    expect(filterAdvicePointsByHorizon(pts, "all", now)).toHaveLength(2);
    expect(chartableBuySellAdvicePoints(pts)).toHaveLength(2);
    const dots24 = buildAdviceBuySellHorizonDots(pts, "24h", "en", now);
    const dotsAll = buildAdviceBuySellHorizonDots(pts, "all", "en", now);
    expect(dots24).toHaveLength(1);
    expect(dotsAll).toHaveLength(2);
    expect(dotsAll.find((d) => d.id === "sell-fallback")?.signedErrorPct).toBe(4.2);
    for (const d of dotsAll) {
      expect(d.x).toBeGreaterThanOrEqual(0.06);
      expect(d.x).toBeLessThanOrEqual(0.94);
    }
  });

  it("classifies operational errors", () => {
    expect(
      classifyOperationalAdviceError(
        point({ suggestedAction: "buy", outcome: "bad", priceChangePct: -2 }),
      ),
    ).toBe("wrongBuy");
    expect(
      classifyOperationalAdviceError(
        point({ suggestedAction: "sell", outcome: "bad", priceChangePct: 3 }),
      ),
    ).toBe("wrongSell");
    expect(
      classifyOperationalAdviceError(
        point({
          suggestedAction: "buy",
          outcome: "good",
          priceChangePct: 2,
          kind: "buy_rec",
        }),
      ),
    ).toBe("missBuy");
    expect(isMissBuyRally(point({ suggestedAction: "buy", outcome: "good", kind: "good_buy" }))).toBe(
      false,
    );
  });

  it("builds dot plot series for time and action", () => {
    const pts = [
      point({ at: "2026-04-07T10:00:00Z", outcome: "bad", forecastErrorPct: -5 }),
      point({ at: "2026-05-15T10:00:00Z", outcome: "good", forecastErrorPct: 2, suggestedAction: "sell", id: "b" }),
    ];
    const timeDots = buildAdviceErrorTimeDots(pts, "en");
    expect(timeDots).toHaveLength(2);
    expect(timeDots.find((d) => d.outcome === "bad")?.signedErrorPct).toBe(-5);
    expect(timeDots.find((d) => d.suggestedAction === "sell")?.signedErrorPct).toBe(2);
    const actionDots = buildAdviceErrorActionDots(pts);
    expect(actionDots.find((d) => d.suggestedAction === "sell")?.signedErrorPct).toBe(2);
  });

  it("includes experiment log bad advice in 24h horizon dots", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const logPoints = buildAdviceCalibrationFromLog(
      [
        {
          at: "2026-07-10T08:00:00.000Z",
          tickId: "t1",
          ticker: "AAA",
          key: "AAA|cd",
          kind: "bad_buy",
          capitalEur: 5000,
          pnlEur: -150,
          pnlPct: -3,
          probPctAtAdvice: 72,
          note: "open loss",
        },
        {
          at: "2026-07-04T08:00:00.000Z",
          tickId: "t0",
          ticker: "BBB",
          key: "BBB|cd",
          kind: "bad_buy",
          capitalEur: 5000,
          pnlEur: -100,
          pnlPct: -2,
          probPctAtAdvice: 65,
          note: "old",
        },
      ],
      [],
      "en",
    );
    const dots24 = buildAdviceBuySellHorizonDots(logPoints, "24h", "en", now);
    const dots7d = buildAdviceBuySellHorizonDots(logPoints, "7d", "en", now);
    expect(dots24).toHaveLength(1);
    expect(dots24[0]?.ticker).toBe("AAA");
    expect(dots7d).toHaveLength(2);
  });

  it("summarizes buy/sell totals vs operational errors", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const pts = [
      point({
        at: "2026-07-10T08:00:00.000Z",
        suggestedAction: "buy",
        outcome: "good",
        kind: "good_buy",
        id: "g1",
      }),
      point({
        at: "2026-07-10T09:00:00.000Z",
        suggestedAction: "buy",
        outcome: "bad",
        priceChangePct: -2,
        id: "b1",
      }),
      point({
        at: "2026-07-10T10:00:00.000Z",
        suggestedAction: "sell",
        outcome: "bad",
        priceChangePct: 3,
        id: "s1",
      }),
      point({
        at: "2026-07-10T11:00:00.000Z",
        suggestedAction: "sell",
        outcome: "good",
        priceChangePct: -1,
        kind: "paper_sell",
        id: "s2",
      }),
    ];
    const summary = summarizeBuySellAdviceWindow(pts, "24h", now);
    expect(summary.totalBuy).toBe(2);
    expect(summary.totalSell).toBe(2);
    expect(summary.executedSell).toBe(1);
    expect(summary.errorTotal).toBe(2);
    expect(summary.errorBuy).toBe(1);
    expect(summary.errorSell).toBe(1);
  });

  it("includes missed_buy from advice log as miss-buy error", () => {
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    const logPoints = buildAdviceCalibrationFromLog(
      [
        {
          at: "2026-07-10T08:00:00.000Z",
          tickId: "t1",
          ticker: "AAA",
          key: "AAA|cd",
          kind: "missed_buy",
          capitalEur: 5000,
          pnlEur: 250,
          pnlPct: 5,
          probPctAtAdvice: 72,
          note: "buy signal not executed",
        },
      ],
      [],
      "en",
    );
    expect(logPoints).toHaveLength(1);
    expect(classifyOperationalAdviceError(logPoints[0]!)).toBe("missBuy");
    const dots = buildAdviceBuySellHorizonDots(logPoints, "24h", "en", now);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.errorKind).toBe("missBuy");
  });
});
