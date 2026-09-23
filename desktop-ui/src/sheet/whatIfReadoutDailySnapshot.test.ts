import { describe, expect, it } from "vitest";
import {
  appendUniverseReadoutDailySnapshots,
  crownReadoutFromDailyEntry,
  emptyWhatIfReadoutDailySnapshotStore,
  evaluateWhatIfForwardAnalysisGate,
  lookupDailyReadoutAsCrown,
  mergeReadoutDailyStoresAppendOnly,
  readoutDailyEntryFromCrownReadout,
} from "./whatIfReadoutDailySnapshot";
import type { WhatIfCrownReadout } from "./whatIfCrownReadout";
import type { SheetTable } from "../types";

const sampleReadout = (overrides: Partial<WhatIfCrownReadout> = {}): WhatIfCrownReadout => ({
  sds: 60,
  eis: 55,
  pPlan: 50,
  precatKind: "rising",
  pCont: 70,
  contG10: null,
  exhaustEdge: null,
  dailyPct24h: 2,
  miiAngleDeg: 12,
  frozenAt: "2026-07-22T10:00:00.000Z",
  source: "snapshot",
  ...overrides,
});

describe("whatIfReadoutDailySnapshot", () => {
  it("converts between daily entry and crown readout with snapshot source", () => {
    const r = sampleReadout();
    const entry = readoutDailyEntryFromCrownReadout(r, "MSLE|x");
    expect(entry.capturedAt).toBe("2026-07-22T10:00:00.000Z");
    expect(crownReadoutFromDailyEntry(entry).source).toBe("snapshot");
    expect(crownReadoutFromDailyEntry(entry).sds).toBe(60);
  });

  it("lookup returns null when missing", () => {
    const store = emptyWhatIfReadoutDailySnapshotStore();
    expect(lookupDailyReadoutAsCrown(store, "2026-07-22", "MSLE")).toBeNull();
  });

  it("merge is append-only and keeps earlier capturedAt on conflict", () => {
    const a = emptyWhatIfReadoutDailySnapshotStore();
    a.days["2026-07-22"] = {
      MSLE: readoutDailyEntryFromCrownReadout(
        sampleReadout({ sds: 60, frozenAt: "2026-07-22T09:00:00.000Z" }),
        null,
      ),
    };
    const b = emptyWhatIfReadoutDailySnapshotStore();
    b.days["2026-07-22"] = {
      MSLE: readoutDailyEntryFromCrownReadout(
        sampleReadout({ sds: 99, frozenAt: "2026-07-22T15:00:00.000Z" }),
        null,
      ),
      NEW: readoutDailyEntryFromCrownReadout(sampleReadout({ sds: 40 }), null),
    };
    const merged = mergeReadoutDailyStoresAppendOnly(a, b);
    expect(merged.days["2026-07-22"]!.MSLE!.sds).toBe(60);
    expect(merged.days["2026-07-22"]!.NEW!.sds).toBe(40);
  });

  it("appendUniverseReadoutDailySnapshots skips existing tickers", () => {
    const simTable: SheetTable = {
      sheet: "Simulation",
      columns: ["Ticker", "SDS", "Plan_Prob_Pct"],
      rows: [
        { Ticker: "MSLE", SDS: 72, Plan_Prob_Pct: 58, "Completion Date": "2026-12-01" },
        { Ticker: "ABCD", SDS: 40, Plan_Prob_Pct: 45, "Completion Date": "2026-11-01" },
      ],
    };
    const store = emptyWhatIfReadoutDailySnapshotStore();
    store.days["2026-08-31"] = {
      MSLE: readoutDailyEntryFromCrownReadout(sampleReadout({ sds: 55 }), "k1"),
    };

    const first = appendUniverseReadoutDailySnapshots({
      sessionDate: "2026-08-31",
      simTable,
      ctx: {},
      store,
      nowIso: "2026-08-31T14:00:00.000Z",
    });
    expect(first.appended).toBe(1);
    expect(first.store.days["2026-08-31"]!.MSLE!.sds).toBe(55);
    expect(first.store.days["2026-08-31"]!.ABCD!.sds).toBe(40);

    const second = appendUniverseReadoutDailySnapshots({
      sessionDate: "2026-08-31",
      simTable,
      ctx: {},
      store: first.store,
      nowIso: "2026-08-31T16:00:00.000Z",
    });
    expect(second.appended).toBe(0);
  });

  it("evaluateWhatIfForwardAnalysisGate tracks session days and completeness", () => {
    const store = emptyWhatIfReadoutDailySnapshotStore();
    for (let d = 1; d <= 5; d += 1) {
      const day = `2026-08-0${d}`;
      store.days[day] = {};
      for (let t = 0; t < 15; t += 1) {
        store.days[day]![`T${t}`] = readoutDailyEntryFromCrownReadout(
          sampleReadout({ frozenAt: `${day}T14:00:00.000Z` }),
          null,
        );
      }
    }
    const early = evaluateWhatIfForwardAnalysisGate(store);
    expect(early.ready).toBe(false);
    expect(early.summary.sessionDays).toBe(5);
    expect(early.summary.totalTickerSnapshots).toBe(75);

    for (let d = 6; d <= 10; d += 1) {
      const day = `2026-08-${d}`;
      store.days[day] = {};
      for (let t = 0; t < 25; t += 1) {
        store.days[day]![`T${t}`] = readoutDailyEntryFromCrownReadout(sampleReadout(), null);
      }
    }
    const ready = evaluateWhatIfForwardAnalysisGate(store);
    expect(ready.ready).toBe(true);
    expect(ready.summary.sessionDays).toBe(10);
    expect(ready.summary.totalTickerSnapshots).toBeGreaterThanOrEqual(200);
  });
});
