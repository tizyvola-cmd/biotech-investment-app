import { describe, expect, it } from "vitest";
import {
  evaluateSoftBuyGateStrength,
  softBuyCapitalFromGateStrength,
  softBuyCapitalMultFromTier,
  softBuyGateTier,
} from "./softBuyGateStrength";

describe("softBuyGateStrength", () => {
  it("tiers: 1–2 weak · 3 mid · 4–5 strong", () => {
    expect(softBuyGateTier(1)).toBe("weak");
    expect(softBuyGateTier(2)).toBe("weak");
    expect(softBuyGateTier(3)).toBe("mid");
    expect(softBuyGateTier(5)).toBe("strong");
  });

  it("Grade 3 capital: strong 100% · mid 70% · weak 40% of base", () => {
    expect(softBuyCapitalMultFromTier("strong")).toBe(1);
    expect(softBuyCapitalMultFromTier("mid")).toBe(0.7);
    expect(softBuyCapitalMultFromTier("weak")).toBe(0.4);
    expect(softBuyCapitalFromGateStrength(5000, "strong")).toBe(5000);
    expect(softBuyCapitalFromGateStrength(5000, "mid")).toBe(3500);
    expect(softBuyCapitalFromGateStrength(5000, "weak")).toBe(2000);
    expect(softBuyCapitalFromGateStrength(5000, null)).toBe(3500);
  });

  it("wind-only Soft BUY thesis → few ticks (lighter signal)", () => {
    const s = evaluateSoftBuyGateStrength(
      {
        ticker: "CRDL",
        key: "CRDL|2026-08-01",
        sdsScore: 30,
        pplan: 59,
        investVerdict: "no",
        precatKind: "watch",
        pnlPct24h: 1.2,
      },
      {
        simRow: {
          Ticker: "CRDL",
          cont_g10: 15,
          cont_sell_edge: -1,
          p_continuation: 44, // display P(cont)=56
          "Var. Giorn. %": 1.2,
        },
        recentlySoldBlocked: false,
      },
    );
    // SDS/P + wind + clean (tape/precat/cooldown) — Top2 NO and rising missing
    expect(s.gates.find((g) => g.id === "wind")?.pass).toBe(true);
    expect(s.gates.find((g) => g.id === "sds_p")?.pass).toBe(true);
    expect(s.gates.find((g) => g.id === "top2")?.pass).toBe(false);
    expect(s.ticks).toBeLessThanOrEqual(3);
    expect(s.tier === "weak" || s.tier === "mid").toBe(true);
  });

  it("full gate stack → strong tier", () => {
    const s = evaluateSoftBuyGateStrength(
      {
        ticker: "OK",
        key: "OK|2026-08-01",
        sdsScore: 35,
        pplan: 62,
        investVerdict: "yes",
        precatKind: "enter",
        pnlPct24h: 1.5,
      },
      {
        simRow: {
          Ticker: "OK",
          cont_g10: 12,
          cont_sell_edge: -2,
          p_continuation: 40,
          "Var. Giorn. %": 1.5,
          "Var. 7d %": 3,
          "Var. 3M %": 5,
          "Var. 6M %": 8,
        },
        priorSessionPcts: [1.2],
        recentlySoldBlocked: false,
      },
    );
    expect(s.gates.find((g) => g.id === "top2")?.pass).toBe(true);
    expect(s.ticks).toBeGreaterThanOrEqual(4);
    expect(s.tier).toBe("strong");
  });
});
