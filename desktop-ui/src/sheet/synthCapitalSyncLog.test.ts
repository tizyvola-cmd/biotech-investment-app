import { describe, expect, it } from "vitest";
import {
  hasSynthCapChanged,
  buildSynthSyncSummary,
  planManualSynthSyncs,
  planSynthCapitalRevert,
  planSynthCapitalSyncs,
  synthesizeBatchFromLog,
  synthCapEurFromShare,
} from "./synthCapitalSyncLog";
import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";

function alloc(shareByKey: Record<string, number>): SimLoopSynthAllocation {
  return {
    shareByRowKey: shareByKey,
    simLoopApprovedShareByRowKey: shareByKey,
    portfolioShareByRowKey: shareByKey,
    portfolioDisplayShareByRowKey: shareByKey,
    simLoopDisplayShareByRowKey: shareByKey,
    totalCapitalEur: 50_000,
    targetGainEur: 0,
  };
}

describe("synthCapitalSyncLog", () => {
  it("rounds synth cap from share × pot", () => {
    expect(synthCapEurFromShare(0.231, 50_000)).toBe(11_550);
  });

  it("detects meaningful synth euro drift", () => {
    expect(
      hasSynthCapChanged(
        { synthEur: 7891, synthShare: 0.158, topCapitalEur: 50_000, at: "t0" },
        { synthEur: 8000, synthShare: 0.158, topCapitalEur: 50_000, at: "t1" },
      ),
    ).toBe(true);
    expect(
      hasSynthCapChanged(
        { synthEur: 7891, synthShare: 0.158, topCapitalEur: 50_000, at: "t0" },
        { synthEur: 7891, synthShare: 0.158, topCapitalEur: 50_000, at: "t1" },
      ),
    ).toBe(false);
  });

  it("baselines snapshot without capital update on first sight", () => {
    const plan = planSynthCapitalSyncs({
      synthAlloc: alloc({ "AAA|2026-01-01": 0.2 }),
      topCapitalEur: 50_000,
      inputs: { "AAA|2026-01-01": { capital: 7891 } },
      positions: [{ key: "AAA|2026-01-01", ticker: "AAA", capital: 7891 }],
      inPortfolioByKey: { "AAA|2026-01-01": true },
      prevSnapshot: {},
      at: "2026-06-18T10:00:00.000Z",
    });
    expect(plan.entries).toHaveLength(0);
    expect(plan.snapshotChanged).toBe(true);
    expect(plan.snapshot["AAA|2026-01-01"]?.synthEur).toBe(10_000);
  });

  it("updates capital and logs when synth changes", () => {
    const prev = {
      "AAA|2026-01-01": {
        synthEur: 7891,
        synthShare: 0.158,
        topCapitalEur: 50_000,
        at: "t0",
      },
    };
    const plan = planSynthCapitalSyncs({
      synthAlloc: alloc({ "AAA|2026-01-01": 0.2 }),
      topCapitalEur: 50_000,
      inputs: { "AAA|2026-01-01": { capital: 7891 } },
      positions: [{ key: "AAA|2026-01-01", ticker: "AAA", capital: 7891 }],
      inPortfolioByKey: { "AAA|2026-01-01": true },
      prevSnapshot: prev,
      at: "2026-06-18T11:00:00.000Z",
    });
    expect(plan.capitalUpdates["AAA|2026-01-01"]).toBe(10_000);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.fromCapitalEur).toBe(7891);
    expect(plan.entries[0]?.toCapitalEur).toBe(10_000);
  });

  it("manual sync always updates capital to current synth on winners", () => {
    const plan = planManualSynthSyncs({
      synthAlloc: alloc({ "AAA|2026-01-01": 0.231 }),
      topCapitalEur: 50_000,
      inputs: { "AAA|2026-01-01": { capital: 7891 } },
      positions: [{ key: "AAA|2026-01-01", ticker: "AAA" }],
      inPortfolioByKey: { "AAA|2026-01-01": true },
      pnlPctByKey: { "AAA|2026-01-01": 4.2 },
      source: "manual",
    });
    expect(plan.capitalUpdates["AAA|2026-01-01"]).toBe(11_550);
    expect(plan.entries[0]?.source).toBe("manual");
  });

  it("does not upsize synth on underwater portfolio rows", () => {
    const plan = planManualSynthSyncs({
      synthAlloc: alloc({ "AAA|2026-01-01": 0.231 }),
      topCapitalEur: 50_000,
      inputs: { "AAA|2026-01-01": { capital: 7891 } },
      positions: [{ key: "AAA|2026-01-01", ticker: "AAA" }],
      inPortfolioByKey: { "AAA|2026-01-01": true },
      pnlPctByKey: { "AAA|2026-01-01": -8.4 },
      source: "bulk",
    });
    expect(plan.capitalUpdates["AAA|2026-01-01"]).toBeUndefined();
    expect(plan.entries).toHaveLength(0);
    expect(plan.snapshot["AAA|2026-01-01"]?.synthEur).toBe(7891);
  });

  it("reverts capital to value before the last sync command", () => {
    const log = {
      "AAA|2026-01-01": [
        {
          at: "t2",
          rowKey: "AAA|2026-01-01",
          ticker: "AAA",
          fromCapitalEur: 9890,
          toCapitalEur: 11_545,
          synthEur: 11_545,
          synthSharePct: 23.1,
          topCapitalEur: 50_000,
          source: "manual" as const,
        },
        {
          at: "t1",
          rowKey: "AAA|2026-01-01",
          ticker: "AAA",
          fromCapitalEur: 7891,
          toCapitalEur: 9890,
          synthEur: 9890,
          synthSharePct: 19.8,
          topCapitalEur: 50_000,
          source: "bulk" as const,
        },
      ],
    };
    const batch = {
      at: "t2",
      source: "manual" as const,
      rows: {
        "AAA|2026-01-01": { fromCapitalEur: 9890, toCapitalEur: 11_545 },
      },
    };
    const plan = planSynthCapitalRevert(
      log,
      { "AAA|2026-01-01": { capital: 11_545 } },
      batch,
    );
    expect(plan.capitalUpdates["AAA|2026-01-01"]).toBe(9890);
    expect(plan.rowsReverted).toBe(1);
    expect(plan.logAfter["AAA|2026-01-01"]).toHaveLength(1);
    expect(plan.logAfter["AAA|2026-01-01"]?.[0]?.fromCapitalEur).toBe(7891);
  });

  it("reverts bulk batch to pre-sync capital on all rows", () => {
    const log = {
      "AAA|2026-01-01": [
        {
          at: "t1",
          rowKey: "AAA|2026-01-01",
          ticker: "AAA",
          fromCapitalEur: 5000,
          toCapitalEur: 11_528,
          synthEur: 11_528,
          synthSharePct: 23.1,
          topCapitalEur: 50_000,
          source: "bulk" as const,
        },
      ],
      "BBB|2026-02-01": [
        {
          at: "t1",
          rowKey: "BBB|2026-02-01",
          ticker: "BBB",
          fromCapitalEur: 4643,
          toCapitalEur: 9890,
          synthEur: 9890,
          synthSharePct: 19.8,
          topCapitalEur: 50_000,
          source: "bulk" as const,
        },
      ],
    };
    const batch = {
      at: "t1",
      source: "bulk" as const,
      rows: {
        "AAA|2026-01-01": { fromCapitalEur: 5000, toCapitalEur: 11_528 },
        "BBB|2026-02-01": { fromCapitalEur: 4643, toCapitalEur: 9890 },
      },
    };
    const plan = planSynthCapitalRevert(
      log,
      {
        "AAA|2026-01-01": { capital: 11_528 },
        "BBB|2026-02-01": { capital: 9890 },
      },
      batch,
    );
    expect(plan.capitalUpdates["AAA|2026-01-01"]).toBe(5000);
    expect(plan.capitalUpdates["BBB|2026-02-01"]).toBe(4643);
    expect(plan.rowsReverted).toBe(2);
  });

  it("synthesizes a revert batch from legacy row logs sharing the same timestamp", () => {
    const log = {
      "AAA|2026-01-01": [
        {
          at: "2026-06-19T08:00:00.000Z",
          rowKey: "AAA|2026-01-01",
          ticker: "AAA",
          fromCapitalEur: 5000,
          toCapitalEur: 11_528,
          synthEur: 11_528,
          synthSharePct: 23.1,
          topCapitalEur: 50_000,
          source: "bulk" as const,
        },
      ],
      "BBB|2026-02-01": [
        {
          at: "2026-06-19T08:00:00.000Z",
          rowKey: "BBB|2026-02-01",
          ticker: "BBB",
          fromCapitalEur: 4643,
          toCapitalEur: 9890,
          synthEur: 9890,
          synthSharePct: 19.8,
          topCapitalEur: 50_000,
          source: "bulk" as const,
        },
      ],
    };
    const batch = synthesizeBatchFromLog(log);
    expect(batch?.rows["AAA|2026-01-01"]?.fromCapitalEur).toBe(5000);
    expect(batch?.rows["BBB|2026-02-01"]?.fromCapitalEur).toBe(4643);
  });

  it("builds upsized vs trimmed summary from sync entries", () => {
    const summary = buildSynthSyncSummary(
      [
        {
          at: "2026-06-19T10:00:00.000Z",
          rowKey: "AAA|2026-01-01",
          ticker: "AAA",
          fromCapitalEur: 5000,
          toCapitalEur: 8000,
          synthEur: 8000,
          synthSharePct: 16,
          topCapitalEur: 50_000,
          source: "bulk",
        },
        {
          at: "2026-06-19T10:00:00.000Z",
          rowKey: "BBB|2026-02-01",
          ticker: "BBB",
          fromCapitalEur: 9000,
          toCapitalEur: 6000,
          synthEur: 6000,
          synthSharePct: 12,
          topCapitalEur: 50_000,
          source: "bulk",
        },
      ],
      "bulk",
    );
    expect(summary?.upsized).toHaveLength(1);
    expect(summary?.trimmed).toHaveLength(1);
    expect(summary?.upsized[0]?.ticker).toBe("AAA");
    expect(summary?.trimmed[0]?.ticker).toBe("BBB");
    expect(summary?.source).toBe("bulk");
  });
});
