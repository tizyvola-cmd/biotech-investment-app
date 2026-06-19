import { describe, expect, it } from "vitest";
import {
  isDealPenalized,
  computeManualAllocationCompanyRows,
  computeManualAllocationIndices,
  synthesizePatternFromManualAllocation,
  type ManualAllocationSynthesizerInput,
} from "./manualAllocationPatternSynthesizer";
import type { PhaseAResult } from "../riskPattern/riskPatternTypes";
import type { RowFeatures } from "../riskPattern/lossRiskScreening";

function feat(rowKey: string, overrides: Partial<RowFeatures> = {}): RowFeatures {
  return {
    rowKey,
    sdsBucket: "SDS <40 (Low)",
    clinicalPhase: "Phase 2",
    clinicalIndication: "Oncology",
    pplanBucket: "P(plan) <30%",
    daysToCdBucket: "DTC 14-30d",
    precdSlopeSign: "Slope down",
    ...overrides,
  };
}

function input(
  deals: ManualAllocationSynthesizerInput["deals"],
): ManualAllocationSynthesizerInput {
  return { universe: "portfolio", enabled: true, deals };
}

describe("isDealPenalized", () => {
  it("flags zeroed deals when baseline was positive", () => {
    expect(isDealPenalized(0.2, 0, true)).toBe(true);
  });

  it("ignores coincident curves when user did not adjust", () => {
    expect(isDealPenalized(0.15, 0.15, false)).toBe(false);
  });

  it("flags material down-weight after user adjustment", () => {
    expect(isDealPenalized(0.2, 0.05, true)).toBe(true);
  });
});

describe("synthesizePatternFromManualAllocation", () => {
  it("finds a pattern on open deals down-weighted by SDS bucket", () => {
    const deals = [
      {
        rowKey: "AAA|cd1",
        ticker: "AAA",
        baselineShare: 0.25,
        manualShare: 0.02,
        userAdjusted: true,
      },
      {
        rowKey: "BBB|cd2",
        ticker: "BBB",
        baselineShare: 0.25,
        manualShare: 0.23,
        userAdjusted: false,
      },
    ];
    const features = new Map<string, RowFeatures>([
      ["AAA|cd1", feat("AAA|cd1", { sdsBucket: "SDS <40 (Low)" })],
      ["BBB|cd2", feat("BBB|cd2", { sdsBucket: "SDS ≥70 (Premium)" })],
    ]);

    const result = synthesizePatternFromManualAllocation(input(deals), features);
    expect(result).not.toBeNull();
    expect(result!.penalizedTickers).toContain("AAA");
    expect(result!.openBookStats.precision).toBeGreaterThan(0);
    expect(result!.pattern.conditions.some((c) => c.dimension === "sdsBucket")).toBe(true);
    expect(result!.companyRows.some((r) => r.ticker === "AAA" && r.patternMatches)).toBe(true);
    expect(result!.companyRows.find((r) => r.ticker === "BBB")?.patternMatches).toBe(false);
  });

  it("returns null when manual mode is off or no penalized deals", () => {
    const deals = [
      {
        rowKey: "AAA|cd1",
        ticker: "AAA",
        baselineShare: 0.5,
        manualShare: 0.5,
        userAdjusted: false,
      },
    ];
    const features = new Map([["AAA|cd1", feat("AAA|cd1")]]);
    expect(synthesizePatternFromManualAllocation(input(deals), features)).toBeNull();
    expect(
      synthesizePatternFromManualAllocation(
        { universe: "portfolio", enabled: false, deals },
        features,
      ),
    ).toBeNull();
  });

  it("builds index rows with Phase A closed loss rates", () => {
    const deals = [
      {
        rowKey: "AAA|cd1",
        ticker: "AAA",
        baselineShare: 0.25,
        manualShare: 0.02,
        userAdjusted: true,
      },
      {
        rowKey: "BBB|cd2",
        ticker: "BBB",
        baselineShare: 0.25,
        manualShare: 0.23,
        userAdjusted: false,
      },
    ];
    const features = new Map<string, RowFeatures>([
      ["AAA|cd1", feat("AAA|cd1", { sdsBucket: "SDS <40 (Low)" })],
      ["BBB|cd2", feat("BBB|cd2", { sdsBucket: "SDS ≥70 (Premium)" })],
    ]);
    const result = synthesizePatternFromManualAllocation(input(deals), features);
    expect(result).not.toBeNull();

    const phaseA: PhaseAResult = {
      computedAt: new Date().toISOString(),
      totalTrades: 10,
      globalLossRate: 0.3,
      features: [
        {
          dimension: "sdsBucket",
          baseLossRate: 0.3,
          totalN: 10,
          maxAbsLift: 0.5,
          hasVariance: true,
          buckets: [
            {
              dimension: "sdsBucket",
              bucket: "SDS <40 (Low)",
              n: 5,
              losses: 4,
              rawLossRate: 0.8,
              shrunkLossRate: 0.65,
              lift: 2.1,
              confidence: "medium",
              eligibleForPattern: true,
            },
          ],
        },
      ],
    };

    const rows = computeManualAllocationIndices(
      input(deals),
      result,
      features,
      phaseA,
    );
    const lowRow = rows.find((r) => r.cell === "SDS <40 (Low)");
    expect(lowRow).toBeDefined();
    expect(lowRow!.closedLossRate).toBeCloseTo(0.65);
    expect(lowRow!.inSuggestedPattern).toBe(true);
    expect(lowRow!.shareDeltaPp).toBeLessThan(0);
  });

  it("builds per-company rows with ticker, share %, and pattern label", () => {
    const deals = [
      {
        rowKey: "AAA|cd1",
        ticker: "AAA",
        baselineShare: 0.25,
        manualShare: 0.02,
        userAdjusted: true,
      },
      {
        rowKey: "BBB|cd2",
        ticker: "BBB",
        baselineShare: 0.25,
        manualShare: 0.23,
        userAdjusted: false,
      },
    ];
    const features = new Map<string, RowFeatures>([
      ["AAA|cd1", feat("AAA|cd1", { sdsBucket: "SDS <40 (Low)" })],
      ["BBB|cd2", feat("BBB|cd2", { sdsBucket: "SDS ≥70 (Premium)" })],
    ]);
    const result = synthesizePatternFromManualAllocation(input(deals), features);
    expect(result).not.toBeNull();

    const companyRows = computeManualAllocationCompanyRows(input(deals), result, features);
    const aaa = companyRows.find((r) => r.ticker === "AAA");
    expect(aaa).toBeDefined();
    expect(aaa!.manualSharePct).toBeCloseTo(2, 5);
    expect(aaa!.baselineSharePct).toBeCloseTo(25, 5);
    expect(aaa!.penalized).toBe(true);
    expect(aaa!.patternMatches).toBe(true);
    expect(aaa!.patternLabel).toContain("SDS");
  });
});
