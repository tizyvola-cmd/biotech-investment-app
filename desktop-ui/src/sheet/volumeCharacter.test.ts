import { describe, expect, it } from "vitest";
import {
  TAG_AMBIGUOUS,
  TAG_ANTICIPATORY_ACCUMULATION,
  TAG_ANTICIPATORY_DISTRIBUTION,
  TAG_REACTIVE,
  classifyBarAt,
  classifyPeakAnomaly,
  clvAt,
  rvolAt,
  volumeCharacterLabel,
  type OhlcvBar,
} from "./volumeCharacter";

function bar(
  day: string,
  close: number,
  volume: number,
  high?: number,
  low?: number,
): OhlcvBar {
  return {
    date: day,
    open: close,
    high: high ?? close * 1.01,
    low: low ?? close * 0.99,
    close,
    volume,
  };
}

const DAYS = [
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
];

function flat(n = 25, vol = 100_000, close = 10): OhlcvBar[] {
  return DAYS.slice(-n).map((d) => bar(d, close, vol));
}

describe("volumeCharacter", () => {
  it("rvol uses median of prior sessions only", () => {
    const bars = flat(22);
    bars[5]!.volume = 5_000_000;
    bars[bars.length - 1]!.volume = 400_000;
    const r = rvolAt(bars, bars.length - 1);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(3.5);
    expect(r!).toBeLessThan(4.5);
  });

  it("clv signs", () => {
    expect(clvAt(bar("2026-09-02", 9.9, 1, 10, 8))!).toBeGreaterThan(0.5);
    expect(clvAt(bar("2026-09-02", 8.1, 1, 10, 8))!).toBeLessThan(-0.5);
  });

  it("tags anticipatory accumulation", () => {
    const bars = flat(25);
    for (let i = bars.length - 10; i < bars.length; i++) {
      bars[i]!.close = 10 + (i - (bars.length - 10)) * 0.15;
      bars[i]!.volume = 150_000;
      bars[i]!.high = bars[i]!.close + 0.05;
      bars[i]!.low = bars[i]!.close - 0.05;
    }
    bars[bars.length - 1]!.volume = 500_000;
    bars[bars.length - 1]!.high = 12;
    bars[bars.length - 1]!.low = 10.5;
    bars[bars.length - 1]!.close = 11.9;
    const out = classifyBarAt(bars, bars.length - 1, []);
    expect(out?.tag).toBe(TAG_ANTICIPATORY_ACCUMULATION);
  });

  it("tags anticipatory distribution", () => {
    const bars = flat(25, 100_000, 12);
    for (let i = bars.length - 10; i < bars.length; i++) {
      bars[i]!.close = 12 - (i - (bars.length - 10)) * 0.15;
      bars[i]!.volume = 150_000;
      bars[i]!.high = bars[i]!.close + 0.05;
      bars[i]!.low = bars[i]!.close - 0.05;
    }
    bars[bars.length - 1]!.volume = 500_000;
    bars[bars.length - 1]!.high = 11;
    bars[bars.length - 1]!.low = 9.5;
    bars[bars.length - 1]!.close = 9.6;
    expect(classifyBarAt(bars, bars.length - 1, [])?.tag).toBe(TAG_ANTICIPATORY_DISTRIBUTION);
  });

  it("tags reactive when EIS on peak day", () => {
    const bars = flat(25);
    bars[bars.length - 1]!.volume = 500_000;
    bars[bars.length - 1]!.high = 12;
    bars[bars.length - 1]!.low = 10.5;
    bars[bars.length - 1]!.close = 11.9;
    expect(classifyBarAt(bars, bars.length - 1, [bars[bars.length - 1]!.date])?.tag).toBe(
      TAG_REACTIVE,
    );
  });

  it("tags ambiguous without directional bias", () => {
    const bars = flat(25);
    bars[bars.length - 1]!.volume = 400_000;
    bars[bars.length - 1]!.high = 10.2;
    bars[bars.length - 1]!.low = 9.8;
    bars[bars.length - 1]!.close = 10;
    expect(classifyBarAt(bars, bars.length - 1, [])?.tag).toBe(TAG_AMBIGUOUS);
  });

  it("peak anomaly prefers highest RVOL in lookback", () => {
    const bars = flat(25);
    bars[bars.length - 2]!.volume = 800_000;
    bars[bars.length - 2]!.high = 11;
    bars[bars.length - 2]!.low = 10;
    bars[bars.length - 2]!.close = 10.95;
    const out = classifyPeakAnomaly(bars, [], 5);
    expect(out?.date).toBe(bars[bars.length - 2]!.date);
  });

  it("uses plain-language chip labels", () => {
    expect(volumeCharacterLabel(TAG_REACTIVE, true)).toBe("Dopo news");
    expect(volumeCharacterLabel(TAG_ANTICIPATORY_ACCUMULATION, true)).toBe("Compra prima");
    expect(volumeCharacterLabel(TAG_ANTICIPATORY_DISTRIBUTION, true)).toBe("Vendita prima");
    expect(volumeCharacterLabel(TAG_AMBIGUOUS, true)).toBe("Non chiaro");
    expect(volumeCharacterLabel(TAG_REACTIVE, false)).toBe("After news");
  });
});
