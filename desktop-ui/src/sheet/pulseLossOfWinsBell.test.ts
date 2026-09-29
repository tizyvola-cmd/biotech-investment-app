import { describe, expect, it } from "vitest";
import {
  pulseTickerGivebackBell,
  pulseTickerGivebackBellFromHistory,
  sumOpenWinsEur,
} from "./pulseLossOfWinsBell";
import type { InvestSimHistoryPoint } from "./investSimStorage";

describe("pulseTickerGivebackBell — parity with Trades −% G/L", () => {
  it("rings when giveback ≥ frac of peak wins (same as glWinAlertHit)", () => {
    expect(pulseTickerGivebackBell(175, 200, 0.1).hit).toBe(true);
    expect(pulseTickerGivebackBell(190, 200, 0.1).hit).toBe(false);
  });

  it("rings underwater after giving back ≥ frac of peak", () => {
    expect(pulseTickerGivebackBell(-10, 200, 0.1).hit).toBe(true);
  });

  it("respects a custom fraction (e.g. Alert % G/L = 25)", () => {
    expect(pulseTickerGivebackBell(160, 200, 0.25).hit).toBe(false);
    expect(pulseTickerGivebackBell(140, 200, 0.25).hit).toBe(true);
  });

  it("does not require investedAt (matches Trades column)", () => {
    expect(pulseTickerGivebackBell(100, 200, 0.1).hit).toBe(true);
  });

  it("reads peak from history", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-08-01T12:00:00.000Z",
        byTicker: { "AAA|2026-09-01": { pnl: 50 } },
      },
      {
        ts: "2026-08-05T12:00:00.000Z",
        byTicker: { "AAA|2026-09-01": { pnl: 200 } },
      },
      {
        ts: "2026-08-10T12:00:00.000Z",
        byTicker: { "AAA|2026-09-01": { pnl: 150 } },
      },
    ];
    const r = pulseTickerGivebackBellFromHistory(
      "AAA|2026-09-01",
      150,
      history,
      "2026-08-01T14:00:00.000Z",
      0.1,
    );
    expect(r.hit).toBe(true);
    expect(r.peakEff).toBe(200);
  });
});

describe("sumOpenWinsEur", () => {
  it("sums positive open MTM only", () => {
    expect(sumOpenWinsEur([{ pnlEur: 10 }, { pnlEur: -5 }, { pnlEur: 3 }])).toBe(13);
  });
});
