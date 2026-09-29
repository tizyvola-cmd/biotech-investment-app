import { describe, expect, it } from "vitest";
import {
  aggregateGainBySoftLogicEra,
  aggregateGainBySoftLogicEraFromCurve,
  resolveSoftLogicEra,
  scoreableGateIds,
} from "./softLogicChronology";

describe("softLogicChronology", () => {
  it("May 2026 resolves to Gen 0 without P(cont)", () => {
    const era = resolveSoftLogicEra("2026-05-28T12:00:00.000Z");
    expect(era.id).toBe("classic_top2_pplan");
    expect(era.shortLabel).toBe("Gen 0");
    expect(era.gen).toBe(0);
    expect(scoreableGateIds(era, "buy").has("pcont")).toBe(false);
    expect(scoreableGateIds(era, "sell").has("pcont")).toBe(false);
    expect(scoreableGateIds(era, "buy").has("pplan")).toBe(true);
    expect(scoreableGateIds(era, "buy").has("sds")).toBe(true);
  });

  it("Gen 1/2 have no P(cont); Gen 3 includes P(cont); Gen 4 giveback", () => {
    const jul = resolveSoftLogicEra("2026-07-15T12:00:00.000Z");
    expect(jul.id).toBe("soft_g1_sds25");
    expect(jul.shortLabel).toBe("Gen 1");
    expect(scoreableGateIds(jul, "buy").has("pcont")).toBe(false);

    const vol = resolveSoftLogicEra("2026-07-28T12:00:00.000Z");
    expect(vol.id).toBe("soft_g1_volume_sds20");
    expect(vol.shortLabel).toBe("Gen 2");
    expect(scoreableGateIds(vol, "buy").has("pcont")).toBe(false);

    const pcont = resolveSoftLogicEra("2026-08-05T12:00:00.000Z");
    expect(pcont.id).toBe("soft_g1_pcont");
    expect(pcont.shortLabel).toBe("Gen 3");
    expect(scoreableGateIds(pcont, "buy").has("pcont")).toBe(true);
    expect(scoreableGateIds(pcont, "sell").has("pcont")).toBe(true);

    const g4 = resolveSoftLogicEra("2026-08-09T12:00:00.000Z");
    expect(g4.id).toBe("soft_g4_volume_giveback");
    expect(g4.shortLabel).toBe("Gen 4");
    expect(g4.sellGates.some((g) => g.id === "giveback")).toBe(true);
    expect(scoreableGateIds(g4, "sell").has("giveback")).toBe(false);
  });

  it("aggregates week deltas by declared era (legacy)", () => {
    const rows = aggregateGainBySoftLogicEra([
      { startTs: "2026-05-28T12:00:00.000Z", endTs: "2026-05-31T12:00:00.000Z", delta: 50 },
      { startTs: "2026-07-06T12:00:00.000Z", endTs: "2026-07-11T12:00:00.000Z", delta: -100 },
      { startTs: "2026-08-05T12:00:00.000Z", endTs: "2026-08-08T12:00:00.000Z", delta: 200 },
    ]);
    expect(rows.map((r) => r.era.id)).toEqual([
      "classic_top2_pplan",
      "soft_g1_sds25",
      "soft_g1_pcont",
    ]);
    expect(rows.find((r) => r.era.id === "classic_top2_pplan")!.delta).toBe(50);
    expect(rows.find((r) => r.era.id === "soft_g1_pcont")!.delta).toBe(200);
  });

  it("curve aggregation splits straddling weeks at the Gen cutover", () => {
    // Week that starts Gen 0 and ends Gen 1 must not dump the whole Δ into Gen 0.
    const rows = aggregateGainBySoftLogicEraFromCurve([
      { ts: "2026-06-29T12:00:00.000Z", value: 3098, capital: 46210 }, // Gen 0
      { ts: "2026-06-30T12:00:00.000Z", value: 2000, capital: 46210 }, // Gen 0
      { ts: "2026-07-01T12:00:00.000Z", value: 500, capital: 46210 }, // Gen 1 starts
      { ts: "2026-07-05T12:00:00.000Z", value: -410, capital: 46210 }, // Gen 1
      { ts: "2026-07-28T12:00:00.000Z", value: 20, capital: 40000 }, // Gen 2
      { ts: "2026-08-05T12:00:00.000Z", value: 50, capital: 40000 }, // Gen 3 cutover
      { ts: "2026-08-09T12:00:00.000Z", value: 86, capital: 40000 }, // Gen 4 cutover
    ]);
    const g0 = rows.find((r) => r.era.shortLabel === "Gen 0")!;
    const g1 = rows.find((r) => r.era.shortLabel === "Gen 1")!;
    const g2 = rows.find((r) => r.era.shortLabel === "Gen 2")!;
    const g3 = rows.find((r) => r.era.shortLabel === "Gen 3")!;
    const g4 = rows.find((r) => r.era.shortLabel === "Gen 4")!;
    // Gen 0: 3098→2000 = -1098
    expect(g0.delta).toBe(-1098);
    // Gen 1: 2000→500→-410 = -2410
    expect(g1.delta).toBe(-2410);
    // Gen 2: -410→20 = +430 (segment ending Jul 28)
    expect(g2.delta).toBe(430);
    // Gen 3: 20→50 = +30 (segment ending Aug 5)
    expect(g3.delta).toBe(30);
    // Gen 4: 50→86 = +36
    expect(g4.delta).toBe(36);
    expect(g4.gainPctOnInvested).toBe(0.1); // 36/40000
  });
});
