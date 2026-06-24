import { describe, expect, it } from "vitest";
import type { RaCalibrationSignal } from "./rascoreCalibrationCompute";
import {
  buildRaTemporalCorrelation,
  pickPeakPreCdCorrelation,
} from "./rascoreTemporalCorrelation";
import { pearsonR } from "./statSignificance";

function mkSignal(
  ticker: string,
  raByOffset: Record<number, number>,
  priceByOffset: Record<number, number>,
): RaCalibrationSignal {
  return {
    raScore: raByOffset[-30] ?? 50,
    ticker,
    priceUp7d: true,
    priceUp24h: true,
    priceChgLongByOffset: priceByOffset,
    priceChgShortByOffset: {},
    priceUpLongByOffset: Object.fromEntries(
      Object.entries(priceByOffset).map(([k, v]) => [Number(k), v > 0]),
    ),
    priceUpShortByOffset: {},
    raScoreByOffset: raByOffset,
  };
}

describe("pearsonR", () => {
  it("returns perfect positive correlation", () => {
    expect(pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBe(1);
  });

  it("returns null for n < 3", () => {
    expect(pearsonR([1, 2], [3, 4])).toBeNull();
  });
});

describe("buildRaTemporalCorrelation", () => {
  it("computes positive rho when RA and price move together at T-30", () => {
    const signals = [
      mkSignal("AAA", { [-30]: 80 }, { [-30]: 60 }),
      mkSignal("BBB", { [-30]: 70 }, { [-30]: 40 }),
      mkSignal("CCC", { [-30]: 60 }, { [-30]: 20 }),
      mkSignal("DDD", { [-30]: 50 }, { [-30]: 5 }),
      mkSignal("EEE", { [-30]: 40 }, { [-30]: -10 }),
    ];
    const result = buildRaTemporalCorrelation({ signals, scoreMode: "full" });
    const t30 = result.fullRaSeries?.anchors.find((a) => a.offset === -30);
    expect(t30?.n).toBe(5);
    expect(t30?.rho).not.toBeNull();
    expect(t30!.rho!).toBeGreaterThan(0.9);
  });

  it("picks peak pre-CD by absolute rho", () => {
    const signals = [
      mkSignal("A", { [-60]: 50, [-30]: 40 }, { [-60]: 5, [-30]: 50 }),
      mkSignal("B", { [-60]: 55, [-30]: 50 }, { [-60]: -5, [-30]: 40 }),
      mkSignal("C", { [-60]: 60, [-30]: 60 }, { [-60]: 8, [-30]: 30 }),
      mkSignal("D", { [-60]: 65, [-30]: 70 }, { [-60]: -2, [-30]: 20 }),
      mkSignal("E", { [-60]: 70, [-30]: 80 }, { [-60]: 3, [-30]: 10 }),
    ];
    const series = buildRaTemporalCorrelation({ signals }).series;
    const peak = pickPeakPreCdCorrelation(series);
    expect(peak?.offset).toBe(-30);
    expect(Math.abs(peak!.rho)).toBeGreaterThan(0.9);
  });

  it("pools neighboring knots when each knot has only one ticker", () => {
    const signals = [
      mkSignal("A", { [-120]: 80 }, { [-120]: 50 }),
      mkSignal("B", { [-90]: 70 }, { [-90]: 40 }),
      mkSignal("C", { [-60]: 60 }, { [-60]: 30 }),
    ];
    const result = buildRaTemporalCorrelation({ signals, scoreMode: "full" });
    const t90 = result.fullRaSeries?.anchors.find((a) => a.offset === -90);
    expect(t90?.n).toBe(1);
    expect(t90?.nUsed).toBeGreaterThanOrEqual(3);
    expect(t90?.windowPooled).toBe(true);
    expect(t90?.rho).not.toBeNull();
  });

  it("stacks multiple tickers at early knots when each has multi-offset history", () => {
    const signals = [
      mkSignal("A", { [-120]: 80, [-90]: 75, [-60]: 70 }, { [-120]: 50, [-90]: 45, [-60]: 40 }),
      mkSignal("B", { [-120]: 70, [-90]: 65, [-60]: 60 }, { [-120]: 40, [-90]: 35, [-60]: 30 }),
      mkSignal("C", { [-120]: 60, [-90]: 55, [-60]: 50 }, { [-120]: 30, [-90]: 25, [-60]: 20 }),
    ];
    const result = buildRaTemporalCorrelation({ signals, scoreMode: "full" });
    const t120 = result.fullRaSeries?.anchors.find((a) => a.offset === -120);
    expect(t120?.n).toBe(3);
    expect(t120?.rho).not.toBeNull();
    expect(t120?.windowPooled).toBe(false);
  });
});
