import { describe, expect, it } from "vitest";
import {
  buildCdHorizonPriceChanges,
  buildPriceLongFromObservation,
  nextRaCalibCdOffset,
  snapToRaCalibOffset,
} from "./rascoreCdHorizons";
import type { ChartPoint } from "../types";

function pricePoint(offset: number, usd: number): ChartPoint {
  return { offset, price_storico_usd: usd, nodo: "standard" };
}

describe("rascoreCdHorizons", () => {
  it("maps next CD anchor along the calibration chain", () => {
    expect(nextRaCalibCdOffset(-120)).toBe(-90);
    expect(nextRaCalibCdOffset(-60)).toBe(-45);
    expect(nextRaCalibCdOffset(-3)).toBe(4);
    expect(nextRaCalibCdOffset(7)).toBeNull();
  });

  it("computes long and short forward % from chart prices", () => {
    const pts = [
      pricePoint(-60, 100),
      pricePoint(-30, 110),
      pricePoint(-10, 105),
      pricePoint(7, 130),
    ];
    const row = { "Completion Date": "2020-01-01" };
    const { long, short } = buildCdHorizonPriceChanges(row, pts);

    expect(short[-60]).toBe(5);
    expect(long[-60]).toBe(30);
    expect(long[-30]).toBeCloseTo(18.18, 1);
  });

  it("uses anchor → today for long when T+7 is still in the future", () => {
    const pts = [
      pricePoint(-60, 100),
      pricePoint(-30, 110),
      pricePoint(-10, 105),
      pricePoint(-5, 108),
    ];
    const futureCd = new Date();
    futureCd.setDate(futureCd.getDate() + 5);
    const iso = futureCd.toISOString().slice(0, 10);
    const { long } = buildCdHorizonPriceChanges({ "Completion Date": iso }, pts);
    expect(long[-60]).toBe(8);
    expect(long[-30]).toBeCloseTo(-1.82, 1);
    expect(long[7]).toBeUndefined();
  });

  it("snaps current CD offset to nearest calibration knot", () => {
    expect(snapToRaCalibOffset(-100)).toBe(-90);
    expect(snapToRaCalibOffset(-45)).toBe(-45);
    expect(snapToRaCalibOffset(-8)).toBe(-7);
    expect(snapToRaCalibOffset(-9)).toBe(-10);
    expect(snapToRaCalibOffset(5)).toBe(4);
  });

  it("buildPriceLongFromObservation uses chart T+7 when calendar is still pre-CD", () => {
    const pts = [
      pricePoint(-10, 100),
      pricePoint(-8, 102),
      pricePoint(-5, 105),
      pricePoint(7, 120),
    ];
    const futureCd = new Date();
    futureCd.setDate(futureCd.getDate() + 8);
    const iso = futureCd.toISOString().slice(0, 10);
    const pct = buildPriceLongFromObservation({ "Completion Date": iso }, pts, -8);
    expect(pct).toBeCloseTo(17.65, 1);
  });
});
