import { describe, expect, it } from "vitest";
import {
  givebackAlertEligibleSinceInvestedAt,
  pulseTickerGivebackBell,
} from "./pulseLossOfWinsBell";

/** Mid-session Tuesday — RTH eligible immediately. */
const RTH_BUY = "2026-08-11T15:00:00.000Z";

describe("mobile pulseTickerGivebackBell", () => {
  it("does not ring on AH Soft BUY with underwater mark and no real peak", () => {
    const buy = "2026-08-12T21:00:00.000Z"; // Wed after close
    const now = new Date("2026-08-12T22:00:00.000Z");
    expect(givebackAlertEligibleSinceInvestedAt(buy, now)).toBe(false);
    expect(
      pulseTickerGivebackBell(-700, null, undefined, undefined, {
        investedAt: buy,
        now,
      }).hit,
    ).toBe(false);
    expect(
      pulseTickerGivebackBell(-700, 500, undefined, undefined, {
        investedAt: buy,
        now,
      }).hit,
    ).toBe(false);
  });

  it("suppresses when investedAt is missing (fail closed)", () => {
    expect(pulseTickerGivebackBell(-200, 500).hit).toBe(false);
  });

  it("rings only when underwater with a real peak after eligibility", () => {
    expect(
      pulseTickerGivebackBell(-50, 400, undefined, undefined, {
        investedAt: RTH_BUY,
      }).hit,
    ).toBe(true);
    expect(
      pulseTickerGivebackBell(280, 400, undefined, undefined, {
        investedAt: RTH_BUY,
      }).hit,
    ).toBe(false);
  });
});
