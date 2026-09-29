import { describe, expect, it } from "vitest";
import {
  computeIssuerResilience,
  issuerResilienceFromSimRow,
  marketCapUsdFromSimRow,
  parseMarketCapUsd,
} from "./issuerResilience";

describe("parseMarketCapUsd", () => {
  it("parses B/M suffixes and raw USD numbers", () => {
    expect(parseMarketCapUsd("1.2B")).toBeCloseTo(1.2e9, -5);
    expect(parseMarketCapUsd("800M")).toBeCloseTo(800e6, -4);
    expect(parseMarketCapUsd(36_618_748)).toBe(36_618_748);
  });
});

describe("computeIssuerResilience", () => {
  it("flags MSLE-like small/illiquid as fragile", () => {
    const p = computeIssuerResilience({
      marketCapUsd: 80e6,
      advShares20d: 40_000,
      beta: 2.4,
      liquidityScore: 0.3,
      clinicalPhase: "Phase 2",
    });
    expect(p.band).toBe("fragile");
    expect(p.score).toBeLessThan(40);
  });

  it("flags BIIB-like large/liquid/commercial as resilient", () => {
    const p = computeIssuerResilience({
      marketCapUsd: 25e9,
      advShares20d: 2_500_000,
      beta: 0.7,
      liquidityScore: 0.8,
      clinicalPhase: "Approved / commercial",
    });
    expect(p.band).toBe("resilient");
    expect(p.score).toBeGreaterThanOrEqual(65);
    expect(p.commercialPhase).toBe(true);
  });
});

describe("marketCapUsdFromSimRow", () => {
  it("reads Market Cap from sim row", () => {
    expect(marketCapUsdFromSimRow({ "Market Cap": "90M" })).toBeCloseTo(90e6, -4);
    expect(marketCapUsdFromSimRow(null)).toBeNull();
  });
});

describe("issuerResilienceFromSimRow", () => {
  it("reads Market Cap + ADV from sim row", () => {
    const p = issuerResilienceFromSimRow({
      "Market Cap": "90M",
      adv_shares_20d: 45_000,
      "Beta (5Y vs mercato)": 2.1,
      "Studio Phase": "Phase 1",
    });
    expect(p?.band).toBe("fragile");
  });
});
