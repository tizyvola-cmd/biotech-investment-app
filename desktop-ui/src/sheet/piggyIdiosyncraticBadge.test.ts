import { describe, expect, it } from "vitest";
import {
  classifyPiggyMoveChannel,
  resolvePiggyChipMoveBadge,
  xbiDayReturnPctFromSnapshot,
} from "./piggyIdiosyncraticBadge";
import type { MarketContextSnapshotDoc } from "./marketContextScore";

describe("classifyPiggyMoveChannel", () => {
  it("flags idiosyncratic when XBI flat and ticker moves", () => {
    expect(classifyPiggyMoveChannel(-2.4, 0.1)).toBe("idiosyncratic");
    expect(classifyPiggyMoveChannel(3.2, -0.2)).toBe("idiosyncratic");
  });

  it("returns null when ticker move is small", () => {
    expect(classifyPiggyMoveChannel(-0.8, 0.1)).toBeNull();
  });

  it("flags market when ticker moves with XBI", () => {
    expect(classifyPiggyMoveChannel(-2.0, -1.5)).toBe("market");
    expect(classifyPiggyMoveChannel(2.5, 1.8)).toBe("market");
  });

  it("flags idiosyncratic when opposite XBI", () => {
    expect(classifyPiggyMoveChannel(-3.0, 1.2)).toBe("idiosyncratic");
  });
});

describe("resolvePiggyChipMoveBadge", () => {
  it("only surfaces idio badge when market is flat", () => {
    const idio = resolvePiggyChipMoveBadge(-2.4, 0.1);
    expect(idio?.channel).toBe("idiosyncratic");
    expect(idio?.labelEn).toBe("idio");

    // Market moving + aligned → no dense chip badge
    expect(resolvePiggyChipMoveBadge(-2.0, -1.5)).toBeNull();
  });
});

describe("xbiDayReturnPctFromSnapshot", () => {
  it("computes last session return from closes", () => {
    const doc: MarketContextSnapshotDoc = {
      series: {
        XBI: [
          { date: "2026-07-18", close: 100 },
          { date: "2026-07-21", close: 100.5 },
        ],
      },
    };
    expect(xbiDayReturnPctFromSnapshot(doc)).toBe(0.5);
  });
});
