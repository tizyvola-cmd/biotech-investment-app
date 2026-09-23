import { describe, expect, it } from "vitest";
import {
  buildMarketContextDecisionCtx,
  computeMcsStaleDays,
  computeTickerXbiCorr20d,
  mcsBand,
  mcsBandLabel,
  mcsBandWeatherIcon,
  scoreCorr20d,
} from "./marketContextScore";

describe("marketContextScore", () => {
  it("classifies MCS bands", () => {
    expect(mcsBand(70)).toBe("adverse");
    expect(mcsBand(20)).toBe("favorable");
    expect(mcsBand(50)).toBe("ambiguous");
    expect(mcsBand(null)).toBe("unknown");
  });

  it("maps bands to weather icons", () => {
    expect(mcsBandWeatherIcon("favorable")).toBe("☀");
    expect(mcsBandWeatherIcon("ambiguous")).toBe("⛅");
    expect(mcsBandWeatherIcon("adverse")).toBe("☁");
    expect(mcsBandWeatherIcon("unknown")).toBe("—");
  });

  it("computes corr score 0-100", () => {
    expect(scoreCorr20d(0.8)).toBe(80);
    expect(scoreCorr20d(-0.2)).toBe(0);
  });

  it("pearson corr on aligned returns", () => {
    const tk = [100, 101, 102, 103, 104, 105, 106];
    const xb = [200, 202, 204, 206, 208, 210, 212];
    const r = computeTickerXbiCorr20d(tk, xb);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.9);
  });

  it("builds decision ctx from snapshot", () => {
    const ctx = buildMarketContextDecisionCtx(
      {
        update_status: "ok",
        stale_days: 0,
        last_successful_update: "2026-08-06T12:00:00Z",
        latest: { date: "2026-08-06", mcs_global: 72 },
      },
      new Date("2026-08-06T15:00:00Z"),
    );
    expect(ctx.mcsAvailable).toBe(true);
    expect(ctx.mcs).toBe(72);
    expect(ctx.mcsBand).toBe("adverse");
    expect(ctx.mcsStaleDays).toBe(0);
  });

  it("recomputes stale_days on read (JSON field is frozen at write)", () => {
    const doc = {
      update_status: "ok" as const,
      stale_days: 0,
      last_successful_update: "2026-07-17T12:14:00Z",
      latest: { date: "2026-07-17", mcs_global: 47 },
    };
    expect(computeMcsStaleDays(doc, new Date("2026-08-06T08:00:00Z"))).toBe(19);
    const ctx = buildMarketContextDecisionCtx(doc, new Date("2026-08-06T08:00:00Z"));
    expect(ctx.mcsStaleDays).toBe(19);
    expect(ctx.mcsBand).toBe("ambiguous");
  });

  it("labels stress bands clearly", () => {
    expect(mcsBandLabel("adverse", true)).toBe("Stress esterno");
    expect(mcsBandLabel("favorable", true)).toBe("Mercato calmo");
    expect(mcsBandLabel("ambiguous", false)).toBe("Ambiguous");
  });
});
