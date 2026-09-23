import { describe, expect, it } from "vitest";
import {
  buildBreakevenWeekSessions,
  isoWeekId,
  weekGainPctOnInvested,
  weekInvestedCapital,
  weekLogicGainAlign,
} from "./breakevenWeekSessions";
import type { BreakevenLogicPosition } from "./breakevenRecLogicFill";

const positions: BreakevenLogicPosition[] = [
  {
    key: "AAA|cd",
    ticker: "AAA",
    capital: 1000,
    pplan: 62,
    sds: 40,
    pcont: 55,
    pnlPct: -5,
    riskV2: 50,
    regRisk: 48,
  },
];

describe("breakevenWeekSessions", () => {
  it("builds ISO week ids", () => {
    expect(isoWeekId("2026-08-03T12:00:00.000Z")).toMatch(/^2026-W/);
  });

  it("aligns Soft BUY with rising weeks and Soft SELL with falling", () => {
    expect(weekLogicGainAlign("buy", 100)).toBe("aligned");
    expect(weekLogicGainAlign("buy", -50)).toBe("mismatch");
    expect(weekLogicGainAlign("sell", -40)).toBe("aligned");
    expect(weekLogicGainAlign("sell", 80)).toBe("mismatch");
  });

  it("May week uses classic era — no P(cont) in buy/sell indices", () => {
    const points = [
      { ts: "2026-05-28T12:00:00.000Z", day: "28 May", value: 67, capital: 20000 },
      { ts: "2026-05-29T12:00:00.000Z", day: "29 May", value: 80, capital: 20000 },
      { ts: "2026-05-31T12:00:00.000Z", day: "31 May", value: 117, capital: 20500 },
    ];
    const sessions = buildBreakevenWeekSessions(points, positions, [], "en");
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.era.id).toBe("classic_top2_pplan");
    expect(s.buyIndices.map((r) => r.id)).toEqual(["sds", "pplan"]);
    expect(s.buyIndices.some((r) => r.id === "pcont")).toBe(false);
    expect(s.sellIndices.some((r) => r.id === "pcont")).toBe(false);
    expect(s.buyStructuralGates.some((g) => g.id === "top2")).toBe(true);
    expect(s.investedCapital).toBe(20000);
    expect(s.delta).toBe(50);
    expect(s.gainPctOnInvested).toBe(0.3); // 50/20000 = 0.25% → 0.3 rounded to 1 decimal? 50/20000*100 = 0.25 → round to 0.3
  });

  it("computes invested capital and % gain", () => {
    expect(weekInvestedCapital([{ ts: "a", day: "a", value: 1, capital: 1000 }])).toBe(1000);
    expect(weekGainPctOnInvested(-3508, 24306)).toBe(-14.4);
  });

  it("Jul volume week has SDS≥20 gates without P(cont); Aug 5+ adds P(cont)", () => {
    const points = [
      { ts: "2026-07-27T12:00:00.000Z", day: "27 Jul", value: -200 },
      { ts: "2026-07-29T12:00:00.000Z", day: "29 Jul", value: -100 },
      // Same ISO week straddles volume → P(cont) cutover; mid point is Aug 5.
      { ts: "2026-08-03T12:00:00.000Z", day: "3 Aug", value: 50 },
      { ts: "2026-08-05T12:00:00.000Z", day: "5 Aug", value: 120 },
      { ts: "2026-08-10T12:00:00.000Z", day: "10 Aug", value: 150 },
      { ts: "2026-08-12T12:00:00.000Z", day: "12 Aug", value: 180 },
    ];
    const sessions = buildBreakevenWeekSessions(points, positions, [], "en");
    expect(sessions.length).toBeGreaterThanOrEqual(3);

    const jul = sessions.find((s) => s.startTs.startsWith("2026-07-27"))!;
    expect(jul.era.id).toBe("soft_g1_volume_sds20");
    expect(jul.buyIndices.map((r) => r.id)).toEqual(["sds", "pplan"]);
    expect(jul.buyIndices.some((r) => r.id === "pcont")).toBe(false);
    expect(jul.sellIndices.some((r) => r.id === "pcont")).toBe(false);
    expect(jul.sellStructuralGates.some((g) => g.id === "urgent_g2")).toBe(true);

    const cutover = sessions.find((s) => s.startTs.startsWith("2026-08-03"))!;
    expect(cutover.era.id).toBe("soft_g1_pcont");
    expect(cutover.eraChanged).toBe(true);
    expect(cutover.buyIndices.some((r) => r.id === "pcont")).toBe(true);

    const aug = sessions.find((s) => s.startTs.startsWith("2026-08-10"))!;
    expect(aug.era.id).toBe("soft_g4_volume_giveback");
    expect(aug.sellStructuralGates.some((g) => g.id === "giveback")).toBe(true);
    expect(aug.buyIndices.some((r) => r.id === "pcont")).toBe(true);
  });
});
