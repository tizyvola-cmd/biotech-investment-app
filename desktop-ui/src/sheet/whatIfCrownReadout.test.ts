import { describe, expect, it } from "vitest";
import {
  buildWhatIfCrownReadoutFromSimRow,
  mergeWhatIfCrownReadouts,
  stickyWhatIfCrownReadoutSource,
  summarizeWhatIfGrade3Analysis,
} from "./whatIfCrownReadout";
import type { WhatIfCrownHitEvent } from "./whatIfCrownHitStore";

describe("whatIfCrownReadout", () => {
  it("builds readout from simulation row columns", () => {
    const row: Record<string, unknown> = {
      Ticker: "MSLE",
      SDS: 72,
      EIS: 65,
      Plan_Prob_Pct: 58,
      "Var. Giorn. %": 4.2,
    };
    const r = buildWhatIfCrownReadoutFromSimRow(row, {
      source: "capture",
      frozenAt: "2026-07-22T12:00:00.000Z",
      ticker: "MSLE",
    });
    expect(r).not.toBeNull();
    expect(r!.sds).toBe(72);
    expect(r!.eis).toBe(65);
    expect(r!.pPlan).toBe(58);
    expect(r!.dailyPct24h).toBe(4.2);
    expect(r!.source).toBe("capture");
  });

  it("builds readout from SDS snapshot when row has no SDS column", () => {
    const row = { Ticker: "MSLE", Plan_Prob_Pct: 62 };
    const r = buildWhatIfCrownReadoutFromSimRow(row, {
      ticker: "MSLE",
      ctx: { sdsByTicker: new Map([["MSLE", { sds: 48 }]]) },
    });
    expect(r?.sds).toBe(48);
    expect(r?.pPlan).toBe(62);
  });

  it("returns null when row is missing", () => {
    expect(buildWhatIfCrownReadoutFromSimRow(null)).toBeNull();
    expect(buildWhatIfCrownReadoutFromSimRow(undefined)).toBeNull();
  });

  it("merge keeps capture source when enriching from backfill", () => {
    const prev = buildWhatIfCrownReadoutFromSimRow(
      { SDS: 60, Ticker: "A" },
      { source: "capture", frozenAt: "t0", ticker: "A" },
    )!;
    const fresh = buildWhatIfCrownReadoutFromSimRow(
      { SDS: 99, EIS: 80, Plan_Prob_Pct: 70, Ticker: "A" },
      { source: "backfill", frozenAt: "t1", ticker: "A" },
    )!;
    const merged = mergeWhatIfCrownReadouts(prev, fresh)!;
    expect(stickyWhatIfCrownReadoutSource(prev, fresh)).toBe("capture");
    expect(merged.source).toBe("capture");
    expect(merged.sds).toBe(60);
    expect(merged.eis).toBe(80);
  });

  it("summarizes medians and precat breakdown", () => {
    const events: WhatIfCrownHitEvent[] = [
      {
        sessionDate: "2026-07-21",
        ticker: "A",
        simKey: null,
        endPnl: 400,
        pathMax: 500,
        pathMin: 0,
        oscillating: false,
        capturedAt: "t1",
        updatedAt: "t1",
        readout: {
          sds: 60,
          eis: 50,
          pPlan: 55,
          precatKind: "rising",
          pCont: 70,
          contG10: null,
          exhaustEdge: null,
          dailyPct24h: 2,
          miiAngleDeg: null,
          frozenAt: "t1",
          source: "capture",
        },
      },
      {
        sessionDate: "2026-07-22",
        ticker: "B",
        simKey: null,
        endPnl: 800,
        pathMax: 900,
        pathMin: 100,
        oscillating: false,
        capturedAt: "t2",
        updatedAt: "t2",
        readout: {
          sds: 80,
          eis: 70,
          pPlan: 65,
          precatKind: "rising",
          pCont: 80,
          contG10: null,
          exhaustEdge: null,
          dailyPct24h: 5,
          miiAngleDeg: null,
          frozenAt: "t2",
          source: "backfill",
        },
      },
    ];
    const a = summarizeWhatIfGrade3Analysis(events);
    expect(a.totalHits).toBe(2);
    expect(a.withReadout).toBe(2);
    expect(a.backfillCount).toBe(1);
    expect(a.partialReadout).toBe(0);
    expect(a.medians.sds).toBe(70);
    expect(a.medians.eis).toBe(60);
    expect(a.medians.endPnl).toBe(600);
    expect(a.precatBreakdown.rising).toBe(2);
  });
});
