import { describe, expect, it } from "vitest";

import {

  aggregateAdviceCalibrationBuckets,

  buildAdviceCalibrationFromPaperSells,
  buildAdviceForecastErrorScatter,

  buildAdviceCalibrationFromLiveRows,

  buildAdviceCalibrationFromLog,

  classifyAdviceOutcome,

  classifyPnlOutcome,

  computeAdviceForecastErrorPct,

  probToAdviceBucket,

  signedExpectedReturnForAdvice,

  summarizeAdviceCalibration,

} from "./investDecisionSimAdviceCalibration";

import type { ExperimentAdviceEvent } from "./investDecisionSimExperiment";

import type { DecisionSimTick } from "./investDecisionSimLoop";



describe("investDecisionSimAdviceCalibration", () => {

  it("maps probability to buckets", () => {

    expect(probToAdviceBucket(48).id).toBe("lt50");

    expect(probToAdviceBucket(77).id).toBe("70-79");

  });



  it("classifies advice outcomes by action and stock move", () => {

    expect(classifyAdviceOutcome("buy", 1.4)).toBe("good");

    expect(classifyAdviceOutcome("buy", -1.2)).toBe("bad");

    expect(classifyAdviceOutcome("buy", 0.2)).toBe("pending");

    expect(classifyAdviceOutcome("sell", -2.1)).toBe("good");

    expect(classifyAdviceOutcome("sell", 1.5)).toBe("bad");

    expect(classifyAdviceOutcome("hold", 0.8)).toBe("good");

    expect(classifyAdviceOutcome("hold", 2.3)).toBe("good");

    expect(classifyAdviceOutcome("hold", -3.5)).toBe("bad");

    expect(classifyAdviceOutcome("hold", 6)).toBe("pending");

    expect(classifyPnlOutcome(3)).toBe("good");

    expect(classifyPnlOutcome(-4)).toBe("bad");

  });



  it("computes signed forecast error vs plan target", () => {

    expect(signedExpectedReturnForAdvice("buy", 10)).toBe(10);

    expect(computeAdviceForecastErrorPct("buy", 10, 3).forecastErrorPct).toBe(-7);

    expect(computeAdviceForecastErrorPct("buy", 10, 14).forecastErrorPct).toBe(4);

    expect(signedExpectedReturnForAdvice("hold", 10)).toBe(0);

    expect(computeAdviceForecastErrorPct("hold", 10, -1.5).forecastErrorPct).toBe(-1.5);

  });



  it("builds live calibration for buy, sell and hold with action-aware scoring", () => {

    const points = buildAdviceCalibrationFromLiveRows(

      [

        {

          key: "a",

          ticker: "VERA",

          suggestedAction: "buy",

          inPaperPortfolio: false,

          probPct: 48,

          planReturnPct: 8,

          pnlPct: null,

          pnlPct24h: 1.4,

        },

        {

          key: "b",

          ticker: "DSGN",

          suggestedAction: "hold",

          inPaperPortfolio: true,

          hasPosition: true,

          probPct: 72,

          probPctAtAdvice: 62,

          planReturnPct: 5,

          pnlPct: -4.1,

          pnlPct24h: -4.1,

        },

        {

          key: "c",

          ticker: "AGIO",

          suggestedAction: "sell",

          inPaperPortfolio: false,

          hasPosition: true,

          probPct: 81,

          planReturnPct: -6,

          pnlPct: -2,

          pnlPct24h: -2,

        },

      ],

      "en",

    );

    expect(points).toHaveLength(3);

    expect(points.find((p) => p.ticker === "VERA")?.outcome).toBe("good");

    expect(points.find((p) => p.ticker === "VERA")?.forecastErrorPct).toBe(-6.6);

    expect(points.find((p) => p.ticker === "DSGN")?.outcome).toBe("bad");

    expect(points.find((p) => p.ticker === "AGIO")?.outcome).toBe("good");

  });



  it("aggregates bucket success rates from experiment log", () => {

    const adviceLog: ExperimentAdviceEvent[] = [

      {

        at: "2026-06-12T10:00:00.000Z",

        tickId: "t1",

        ticker: "AAA",

        key: "a",

        kind: "bad_buy",

        capitalEur: 5000,

        pnlEur: -200,

        pnlPct: -4,

        probPctAtAdvice: 48,

        note: "test",

      },

      {

        at: "2026-06-12T11:00:00.000Z",

        tickId: "t2",

        ticker: "BBB",

        key: "b",

        kind: "good_buy",

        capitalEur: 5000,

        pnlEur: 150,

        pnlPct: 3,

        probPctAtAdvice: 75,

        note: "test",

      },

    ];

    const ticks: DecisionSimTick[] = [

      {

        id: "t1",

        at: "2026-06-12T10:00:00.000Z",

        evaluations: [

          {

            key: "a",

            ticker: "AAA",

            planReturnPct: 12,

          } as DecisionSimTick["evaluations"][number],

        ],

      } as DecisionSimTick,

    ];

    const points = buildAdviceCalibrationFromLog(adviceLog, ticks, "en");

    const buckets = aggregateAdviceCalibrationBuckets(points, "en");

    const low = buckets.find((b) => b.bucketId === "lt50");

    const high = buckets.find((b) => b.bucketId === "70-79");

    expect(low?.badCount).toBe(1);

    expect(low?.successRatePct).toBe(0);

    expect(high?.goodCount).toBe(1);

    expect(high?.successRatePct).toBe(100);


    const summary = summarizeAdviceCalibration(points);

    expect(summary.lowProb.bad).toBe(1);

    expect(summary.highProb.good).toBe(1);

  });




  it("builds forecast-error scatter with prob on X and signed error on Y", () => {

    const points = buildAdviceCalibrationFromLiveRows(

      [

        {

          key: "a",

          ticker: "AAA",

          suggestedAction: "buy",

          inPaperPortfolio: false,

          probPct: 52,

          planReturnPct: 10,

          pnlPct24h: 3,

        },

        {

          key: "b",

          ticker: "BBB",

          suggestedAction: "buy",

          inPaperPortfolio: false,

          probPct: 58,

          planReturnPct: 8,

          pnlPct24h: -4,

        },

        {

          key: "c",

          ticker: "CCC",

          suggestedAction: "buy",

          inPaperPortfolio: false,

          probPct: 74,

          planReturnPct: 6,

          pnlPct24h: 2.5,

        },

        {

          key: "d",

          ticker: "DDD",

          suggestedAction: "buy",

          inPaperPortfolio: false,

          probPct: 76,

          planReturnPct: 5,

          pnlPct24h: 1.2,

        },

      ],

      "en",

    );

    const dots = buildAdviceForecastErrorScatter(points);

    expect(dots).toHaveLength(4);

    expect(dots.find((d) => d.ticker === "AAA")?.y).toBe(-7);

    expect(dots.find((d) => d.ticker === "BBB")?.y).toBe(-12);

    expect(dots.every((d) => d.x >= 0 && d.x <= 100)).toBe(true);

  });

  it("scores executed paper SELL with post-move 24h from the next tick", () => {
    const points = buildAdviceCalibrationFromPaperSells(
      [
        {
          id: "t1",
          at: "2026-06-12T14:31:00.000Z",
          evaluations: [
            {
              key: "x|cd",
              ticker: "XYZ",
              suggestedAction: "sell",
              planReturnPct: -4,
              pnlPct24h: 2.5,
            } as never,
          ],
          portfolioBefore: [
            {
              key: "x|cd",
              ticker: "XYZ",
              capital: 5000,
              entryAt: "2026-06-12T10:00:00.000Z",
              entryProbPct: 72,
            } as never,
          ],
          portfolioAfter: [],
          trades: [
            {
              at: "2026-06-12T14:31:00.000Z",
              ticker: "XYZ",
              key: "x|cd",
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: 1.2,
              pnlEurSimulated: 60,
            },
          ],
          summary: {} as never,
        },
        {
          id: "t2",
          at: "2026-06-12T15:31:00.000Z",
          evaluations: [
            {
              key: "x|cd",
              ticker: "XYZ",
              pnlPct24h: -1.8,
            } as never,
          ],
          portfolioBefore: [],
          portfolioAfter: [],
          trades: [],
          summary: {} as never,
        },
      ],
      () => 3.5,
      "en",
    );
    expect(points).toHaveLength(1);
    expect(points[0]?.suggestedAction).toBe("sell");
    expect(points[0]?.priceChangePct).toBe(-1.8);
    expect(points[0]?.outcome).toBe("good");
  });

  it("does not re-score old compact sells with today's live Var. Giorn. %", () => {
    const points = buildAdviceCalibrationFromPaperSells(
      [
        {
          id: "t1",
          at: "2026-06-01T14:31:00.000Z",
          evaluations: [],
          portfolioBefore: [
            {
              key: "x|cd",
              ticker: "XYZ",
              capital: 5000,
              entryAt: "2026-06-01T10:00:00.000Z",
              entryProbPct: 72,
            } as never,
          ],
          portfolioAfter: [],
          trades: [
            {
              at: "2026-06-01T14:31:00.000Z",
              ticker: "XYZ",
              key: "x|cd",
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: 1.2,
              pnlEurSimulated: 60,
            },
          ],
          summary: {} as never,
        },
      ],
      () => 3.5,
      "en",
    );
    expect(points).toHaveLength(0);
  });

  it("includes paper SELL in scatter even without plan target", () => {
    const points = buildAdviceCalibrationFromPaperSells(
      [
        {
          id: "t1",
          at: "2026-06-12T14:31:00.000Z",
          evaluations: [
            {
              key: "x|cd",
              ticker: "XYZ",
              suggestedAction: "sell",
              planReturnPct: null,
              probPct: 68,
              pnlPct24h: -1.2,
            } as never,
          ],
          portfolioBefore: [
            {
              key: "x|cd",
              ticker: "XYZ",
              capital: 5000,
              entryAt: "2026-06-12T10:00:00.000Z",
              entryProbPct: 68,
            } as never,
          ],
          portfolioAfter: [],
          trades: [
            {
              at: "2026-06-12T14:31:00.000Z",
              ticker: "XYZ",
              key: "x|cd",
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: 1.2,
              pnlEurSimulated: 60,
            },
          ],
          summary: {} as never,
        },
        {
          id: "t2",
          at: "2026-06-12T15:31:00.000Z",
          evaluations: [
            {
              key: "x|cd",
              ticker: "XYZ",
              pnlPct24h: -1.2,
            } as never,
          ],
          portfolioBefore: [],
          portfolioAfter: [],
          trades: [],
          summary: {} as never,
        },
      ],
      () => null,
      "en",
    );
    const dots = buildAdviceForecastErrorScatter(points);
    expect(dots).toHaveLength(1);
    expect(dots[0]?.suggestedAction).toBe("sell");
    expect(dots[0]?.y).toBe(-1.2);
  });

  it("maps review+exit with position to SELL calibration", () => {
    const points = buildAdviceCalibrationFromLiveRows(
      [
        {
          key: "z",
          ticker: "ZZZ",
          suggestedAction: "review",
          exitDecision: "exit",
          inPaperPortfolio: false,
          hasPosition: true,
          probPct: 55,
          planReturnPct: null,
          pnlPct24h: -1.1,
        },
      ],
      "en",
    );
    expect(points).toHaveLength(1);
    expect(points[0]?.suggestedAction).toBe("sell");
    expect(buildAdviceForecastErrorScatter(points)[0]?.suggestedAction).toBe("sell");
  });

});

