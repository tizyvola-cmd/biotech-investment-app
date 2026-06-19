import { beforeEach, describe, expect, it } from "vitest";
import { runUnivariateScreening, bucketDaysToCd, bucketPrecdSlopeSign } from "./lossRiskScreening";
import { __resetSnapshotStoreForTests } from "../calibration/featureSnapshotStore";
import { __resetPatternStoreForTests } from "./patternProposalStore";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function row(args: {
  ticker: string;
  pnlPct: number | null;
  pplanPct?: number | null;
  daysToCd?: number;
  entrySlope20d?: number;
}): SimOutcomeRow {
  return {
    row_key: `${args.ticker}|cd`,
    ticker: args.ticker,
    completion_date: "2026-06-01",
    days_to_cd: args.daysToCd ?? 30,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: 1000,
    pnl_eur: args.pnlPct == null ? null : ((args.pnlPct ?? 0) / 100) * 1000,
    pnl_pct: args.pnlPct,
    outcome: args.pnlPct == null ? "open" : args.pnlPct > 0 ? "win" : "loss",
    outcome_label: args.pnlPct == null ? "Open" : args.pnlPct > 0 ? "Win" : "Loss",
    is_win: args.pnlPct != null && args.pnlPct > 0,
    affidabilita_pct: args.pplanPct ?? 60,
    entry_affidabilita_pct: args.pplanPct ?? 60,
    entry_slope_20d: args.entrySlope20d ?? null,
  } as SimOutcomeRow;
}

beforeEach(() => {
  __resetSnapshotStoreForTests();
  __resetPatternStoreForTests();
});

describe("bucketDaysToCd", () => {
  it("buckets days correctly", () => {
    expect(bucketDaysToCd(null)).toBe("DTC n/a");
    expect(bucketDaysToCd(5)).toBe("DTC <14d");
    expect(bucketDaysToCd(14)).toBe("DTC 14-30d");
    expect(bucketDaysToCd(30)).toBe("DTC 30-60d");
    expect(bucketDaysToCd(60)).toBe("DTC 60-90d");
    expect(bucketDaysToCd(120)).toBe("DTC ≥90d");
  });
});

describe("bucketPrecdSlopeSign", () => {
  it("classifies slope sign with a flat band around 0", () => {
    expect(bucketPrecdSlopeSign(null)).toBe("Slope n/a");
    expect(bucketPrecdSlopeSign(-1.5)).toBe("Slope down");
    expect(bucketPrecdSlopeSign(-0.1)).toBe("Slope flat");
    expect(bucketPrecdSlopeSign(0.2)).toBe("Slope flat");
    expect(bucketPrecdSlopeSign(0.5)).toBe("Slope up");
  });
});

describe("runUnivariateScreening — Phase A", () => {
  it("returns empty result with no trades", () => {
    const r = runUnivariateScreening([]);
    expect(r.totalTrades).toBe(0);
    expect(r.globalLossRate).toBe(0);
    expect(r.features.length).toBeGreaterThan(0); // all dimensions, all empty
    for (const f of r.features) {
      expect(f.totalN).toBe(0);
      expect(f.hasVariance).toBe(false);
    }
  });

  it("shrinks raw 100% loss rate on tiny bucket toward base rate", () => {
    // 1 trade in P(plan) <30% with a loss, 10 wins elsewhere
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 10; i++) {
      trades.push(row({ ticker: `W${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    trades.push(row({ ticker: "LOSS", pnlPct: -10, pplanPct: 20 }));

    const r = runUnivariateScreening(trades);
    const pplan = r.features.find((f) => f.dimension === "pplanBucket");
    expect(pplan).toBeDefined();

    const low = pplan!.buckets.find((b) => b.bucket === "P(plan) <30%");
    expect(low).toBeDefined();
    expect(low!.n).toBe(1);
    expect(low!.losses).toBe(1);
    expect(low!.rawLossRate).toBe(1.0);
    // KEY: shrunk loss rate must be much lower than 100%
    expect(low!.shrunkLossRate).toBeLessThan(0.5);
    // Confidence must be LOW with n=1
    expect(low!.confidence).toBe("low");
    // Not eligible for pattern at n=1
    expect(low!.eligibleForPattern).toBe(false);
  });

  it("ranks features by maxAbsLift descending and puts hasVariance dimensions first", () => {
    // Build mixed cohort: P(plan) is highly discriminating (5/5 wins in 50-70%, 5/5 losses in <30%)
    // daysToCdBucket is non-discriminating (every bucket has the same loss rate)
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `WIN${i}`, pnlPct: 10, pplanPct: 60, daysToCd: 10 + i * 20 }));
    }
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `LOSS${i}`, pnlPct: -10, pplanPct: 20, daysToCd: 10 + i * 20 }));
    }
    const r = runUnivariateScreening(trades);
    expect(r.totalTrades).toBe(10);
    expect(r.globalLossRate).toBeCloseTo(0.5);

    // Ranking: pplanBucket should be near the top
    const ranked = r.features.map((f) => f.dimension);
    const pplanIdx = ranked.indexOf("pplanBucket");
    const dtcIdx = ranked.indexOf("daysToCdBucket");
    expect(pplanIdx).toBeGreaterThanOrEqual(0);
    expect(dtcIdx).toBeGreaterThanOrEqual(0);
    // pplan max|lift-1| should be larger than daysToCd's
    const pplanFeature = r.features[pplanIdx];
    const dtcFeature = r.features[dtcIdx];
    expect(pplanFeature.maxAbsLift).toBeGreaterThan(dtcFeature.maxAbsLift);
  });

  it("excludes trades without a feature value from that feature's screening", () => {
    // Some trades have entry_slope_20d set, some don't.
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `WS${i}`, pnlPct: 10, entrySlope20d: 0.5 }));
    }
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `NO${i}`, pnlPct: -10 })); // no slope
    }
    const r = runUnivariateScreening(trades);
    const slope = r.features.find((f) => f.dimension === "precdSlopeSign");
    expect(slope).toBeDefined();
    expect(slope!.totalN).toBe(5); // only the 5 with values
    const pplan = r.features.find((f) => f.dimension === "pplanBucket");
    // pplan has values on all 10 (default 60% from row factory)
    expect(pplan!.totalN).toBe(10);
  });

  it("marks bucket eligibleForPattern only when n >= minNForSizing", () => {
    // 8 wins + 3 losses in P(plan) 50-70%
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 8; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 8, pplanPct: 60 }));
    for (let i = 0; i < 3; i++) trades.push(row({ ticker: `L${i}`, pnlPct: -8, pplanPct: 60 }));
    // 1 isolated loss in P(plan) <30%
    trades.push(row({ ticker: "LX", pnlPct: -5, pplanPct: 20 }));

    const r = runUnivariateScreening(trades);
    const pplan = r.features.find((f) => f.dimension === "pplanBucket");
    const mid = pplan!.buckets.find((b) => b.bucket === "P(plan) 50-70%");
    const low = pplan!.buckets.find((b) => b.bucket === "P(plan) <30%");
    expect(mid!.n).toBe(11);
    expect(mid!.eligibleForPattern).toBe(true);
    expect(low!.n).toBe(1);
    expect(low!.eligibleForPattern).toBe(false);
  });

  it("never returns NaN on lift even when prior is 0", () => {
    // All wins, prior = 0
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 8, pplanPct: 60 }));
    const r = runUnivariateScreening(trades);
    for (const f of r.features) {
      for (const b of f.buckets) {
        expect(Number.isFinite(b.lift)).toBe(true);
        expect(Number.isFinite(b.shrunkLossRate)).toBe(true);
      }
    }
  });
});
