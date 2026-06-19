import { describe, expect, it } from "vitest";
import {
  buildQuartileWindowStats,
  buildRaCdOffsetTrend,
  buildRaCdReliabilityScatterPoints,
  buildRaScoreQuartileBands,
  buildRaThresholdHeatmap,
  buildTickerRaQuartileMap,
  computeBestRaTemporalWindow,
  formatQuartileWindowLabel,
  pickBestRaCdOffsetTrend,
  reliabilityFromInvestTarget,
  scatterPointMatchesFocus,
  scatterPriceChgYDomain,
  type RaCalibrationSignal,
} from "./rascoreCalibrationCompute";

function sig(
  raScore: number,
  up7: boolean,
  up24: boolean,
  cdLong: Partial<Record<number, boolean>> = {},
  cdShort: Partial<Record<number, boolean>> = {},
  ticker?: string,
): RaCalibrationSignal {
  const priceChgLongByOffset: Partial<Record<number, number>> = {};
  const priceChgShortByOffset: Partial<Record<number, number>> = {};
  for (const [off, up] of Object.entries(cdLong)) {
    priceChgLongByOffset[Number(off)] = up ? 5 : -2;
  }
  for (const [off, up] of Object.entries(cdShort)) {
    priceChgShortByOffset[Number(off)] = up ? 3 : -1;
  }
  return {
    ticker,
    raScore,
    priceUp7d: up7,
    priceUp24h: up24,
    priceChgLongByOffset,
    priceChgShortByOffset,
    priceUpLongByOffset: cdLong,
    priceUpShortByOffset: cdShort,
  };
}

describe("buildQuartileWindowStats", () => {
  it("splits cohort into four 25% windows by RA score rank", () => {
    const signals = Array.from({ length: 8 }, (_, i) =>
      sig(20 + i * 5, i >= 4, i >= 6),
    );
    const windows = buildQuartileWindowStats(signals);

    expect(windows).toHaveLength(4);
    expect(windows.map((w) => w.n)).toEqual([2, 2, 2, 2]);
    expect(windows[0]!.raMin).toBe(20);
    expect(windows[0]!.raMax).toBe(25);
    expect(windows[3]!.raMin).toBe(50);
    expect(windows[3]!.raMax).toBe(55);
  });

  it("computes price-up rates per horizon inside each window", () => {
    const signals = [
      sig(10, false, false),
      sig(20, false, false),
      sig(30, true, false),
      sig(40, true, true),
      sig(50, true, true),
      sig(60, true, true),
      sig(70, false, true),
      sig(80, true, true),
    ];
    const windows = buildQuartileWindowStats(signals);

    expect(windows[0]!.pct7d).toBe(0);
    expect(windows[3]!.pct7d).toBe(50);
    expect(windows[3]!.pct24h).toBe(100);
  });

  it("picks best quartile at CD anchor by long price-up to T+7", () => {
    const signals = Array.from({ length: 8 }, (_, i) =>
      sig(
        10 + i * 8,
        false,
        false,
        { [-30]: i >= 6 },
        { [-30]: i >= 6 },
      ),
    );
    const best = computeBestRaTemporalWindow(signals);
    expect(best?.offset).toBe(-30);
    expect(best?.quartileLabel).toBe("Q4");
    expect(best?.longPct).toBe(100);
    expect(best?.shortPct).toBe(100);
  });

  it("formats window label with RA range", () => {
    const windows = buildQuartileWindowStats([
      sig(10, true, true),
      sig(20, true, false),
      sig(30, true, false),
      sig(40, true, false),
    ]);
    expect(formatQuartileWindowLabel(windows[0]!)).toBe("Q1 (RA 10–10)");
    expect(formatQuartileWindowLabel(windows[3]!)).toBe("Q4 (RA 40–40)");
  });
});

describe("buildRaCdReliabilityScatterPoints", () => {
  it("emits one point per company per CD anchor with reliability from 55% target", () => {
    const signals: RaCalibrationSignal[] = [
      {
        raScore: 62,
        ticker: "AGIO",
        priceUp7d: true,
        priceUp24h: true,
        priceChgLongByOffset: { [-30]: 60, [7]: 10 },
        priceChgShortByOffset: { [-30]: 5 },
        priceUpLongByOffset: { [-30]: true, [7]: true },
        priceUpShortByOffset: { [-30]: true },
      },
      {
        raScore: 28,
        ticker: "MRNA",
        priceUp7d: false,
        priceUp24h: false,
        priceChgLongByOffset: { [-30]: -8 },
        priceChgShortByOffset: {},
        priceUpLongByOffset: { [-30]: false },
        priceUpShortByOffset: {},
      },
    ];
    const pts = buildRaCdReliabilityScatterPoints(signals, "long");
    expect(pts).toHaveLength(3);
    const agio = pts.find((p) => p.ticker === "AGIO" && p.offset === -30)!;
    expect(agio.y).toBe(60);
    expect(agio.reliability).toBe(reliabilityFromInvestTarget(60));
    expect(agio.raScore).toBe(62);
    const mrna = pts.find((p) => p.ticker === "MRNA")!;
    expect(mrna.priceUp).toBe(false);
    expect(mrna.reliability).toBe(reliabilityFromInvestTarget(-8));
  });
});

describe("buildRaCdOffsetTrend", () => {
  it("aggregates cohort price-up and rho per CD anchor", () => {
    const signals: RaCalibrationSignal[] = [
      {
        raScore: 70,
        ticker: "A",
        priceUp7d: true,
        priceUp24h: true,
        priceChgLongByOffset: { [-30]: 20, [-7]: 60 },
        priceChgShortByOffset: {},
        priceUpLongByOffset: { [-30]: true, [-7]: true },
        priceUpShortByOffset: {},
      },
      {
        raScore: 30,
        ticker: "B",
        priceUp7d: false,
        priceUp24h: false,
        priceChgLongByOffset: { [-30]: -5, [-7]: 10 },
        priceChgShortByOffset: {},
        priceUpLongByOffset: { [-30]: false, [-7]: true },
        priceUpShortByOffset: {},
      },
      {
        raScore: 50,
        ticker: "C",
        priceUp7d: true,
        priceUp24h: true,
        priceChgLongByOffset: { [-30]: 8, [-7]: 80 },
        priceChgShortByOffset: {},
        priceUpLongByOffset: { [-30]: true, [-7]: true },
        priceUpShortByOffset: {},
      },
    ];
    const pts = buildRaCdReliabilityScatterPoints(signals, "long");
    const trend = buildRaCdOffsetTrend(pts);
    const t30 = trend.find((r) => r.offset === -30)!;
    expect(t30.n).toBe(3);
    expect(t30.pctPriceUp).toBeCloseTo(66.7, 0);
    expect(t30.pctAbove55).toBe(0);
    expect(t30.rhoRaPrice).not.toBeNull();
    const best = pickBestRaCdOffsetTrend(trend);
    expect(best?.offset).toBe(-7);
    expect(best?.pctPriceUp).toBe(100);
  });
});

describe("scatterPriceChgYDomain", () => {
  it("adds headroom when cohort trend peaks at 100%", () => {
    const { min, max } = scatterPriceChgYDomain([0, 28, 5, 100, -12]);
    expect(min).toBeLessThanOrEqual(0);
    expect(max).toBeGreaterThanOrEqual(110);
  });
});

describe("RA quartile scatter focus", () => {
  it("maps tickers to equal-count quartiles", () => {
    const signals = Array.from({ length: 8 }, (_, i) =>
      sig(10 + i * 10, false, false, {}, {}, `T${i}`),
    );
    const map = buildTickerRaQuartileMap(signals);
    expect(map.get("T0")).toBe(1);
    expect(map.get("T1")).toBe(1);
    expect(map.get("T7")).toBe(4);
    expect(buildRaScoreQuartileBands(signals)).toHaveLength(4);
  });

  it("filters scatter points by anchor and quartile", () => {
    const map = new Map([
      ["A", 1],
      ["B", 4],
    ] as const);
    const point = { offset: -30, ticker: "A" };
    expect(scatterPointMatchesFocus(point, map, null, null)).toBe(true);
    expect(scatterPointMatchesFocus(point, map, -30, null)).toBe(true);
    expect(scatterPointMatchesFocus(point, map, -7, null)).toBe(false);
    expect(scatterPointMatchesFocus(point, map, null, 1)).toBe(true);
    expect(scatterPointMatchesFocus(point, map, null, 4)).toBe(false);
    expect(scatterPointMatchesFocus(point, map, -30, 1)).toBe(true);
    expect(scatterPointMatchesFocus(point, map, -30, 4)).toBe(false);
  });

  it("buildRaThresholdHeatmap marks operational cells when rate and n suffice", () => {
    const signals: RaCalibrationSignal[] = [
      sig(55, true, true, { [-60]: true }, {}, "A"),
      sig(56, true, true, { [-60]: true }, {}, "B"),
      sig(57, true, false, { [-60]: true }, {}, "C"),
      sig(58, true, true, { [-60]: true }, {}, "D"),
      sig(30, false, false, { [-60]: false }, {}, "E"),
    ];
    const hm = buildRaThresholdHeatmap(signals, { offsets: [-60], thresholds: [50, 55] });
    const t50 = hm.cells.find((c) => c.offset === -60 && c.threshold === 50);
    expect(t50?.sampleN).toBe(4);
    expect(t50?.operational).toBe(true);
  });
});
