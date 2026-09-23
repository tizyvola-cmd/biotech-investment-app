import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WHATIF_CROWN_HIT_STORAGE_KEY,
  WHATIF_GRADE3_MIN_HISTORY_DAYS,
  WHATIF_GRADE3_MIN_HISTORY_HITS,
  clearWhatIfCrownHitStore,
  crownHitDedupeKey,
  dismissWhatIfGrade3ReadyWindow,
  emptyWhatIfCrownHitStore,
  evaluateWhatIfGrade3Gate,
  listWhatIfCrownHitsForSession,
  loadWhatIfCrownHitStore,
  recordWhatIfCrownHits,
  shouldShowWhatIfGrade3ReadyWindow,
  summarizeWhatIfCrownSession,
  backfillWhatIfCrownReadouts,
  type WhatIfCrownHitCandidate,
} from "./whatIfCrownHitStore";
import { buildWhatIfCrownReadoutFromSimRow } from "./whatIfCrownReadout";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

function strongStats(endPnl = 400) {
  return {
    strong: true as const,
    endPnl,
    pathMax: endPnl,
    pathMin: 0,
    oscillating: false,
  };
}

describe("whatIfCrownHitStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memStorage());
    vi.stubGlobal("window", { localStorage: globalThis.localStorage, dispatchEvent: () => true });
    clearWhatIfCrownHitStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes by sessionDate|ticker and refreshes endPnl", () => {
    const c1: WhatIfCrownHitCandidate = {
      ticker: "MSLE",
      simKey: "MSLE|2026-08-30",
      inPortfolio: true,
      stats: strongStats(400),
    };
    const first = recordWhatIfCrownHits("2026-07-22", [c1], "2026-07-22T18:00:00.000Z");
    expect(first.inserted).toHaveLength(1);
    expect(first.inserted[0]!.capturedAt).toBe("2026-07-22T18:00:00.000Z");

    const c2: WhatIfCrownHitCandidate = {
      ...c1,
      stats: strongStats(720),
    };
    const second = recordWhatIfCrownHits("2026-07-22", [c2], "2026-07-22T20:00:00.000Z");
    expect(second.inserted).toHaveLength(0);
    expect(second.updated).toBe(1);

    const today = listWhatIfCrownHitsForSession("2026-07-22");
    expect(today).toHaveLength(1);
    expect(today[0]!.endPnl).toBe(720);
    expect(today[0]!.capturedAt).toBe("2026-07-22T18:00:00.000Z");
    expect(today[0]!.updatedAt).toBe("2026-07-22T20:00:00.000Z");
    expect(crownHitDedupeKey("2026-07-22", "msle")).toBe("2026-07-22|MSLE");
  });

  it("ignores Strong off-book and PF non-Strong", () => {
    const r = recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "ZVSA",
        inPortfolio: false,
        stats: strongStats(800),
      },
      {
        ticker: "BNTX",
        inPortfolio: true,
        stats: { ...strongStats(20), strong: false },
      },
    ]);
    expect(r.inserted).toHaveLength(0);
    expect(loadWhatIfCrownHitStore()).toEqual(emptyWhatIfCrownHitStore());
  });

  it("ignores PF path-Strong when sheet day is red", () => {
    const r = recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "SYRE",
        inPortfolio: true,
        dailyPct24h: -3,
        stats: strongStats(400),
      },
    ]);
    expect(r.inserted).toHaveLength(0);
  });

  it("summarizes session KPI and history", () => {
    recordWhatIfCrownHits("2026-07-21", [
      { ticker: "AAA", inPortfolio: true, stats: strongStats(200) },
    ]);
    recordWhatIfCrownHits("2026-07-22", [
      { ticker: "MSLE", inPortfolio: true, stats: strongStats(500) },
      { ticker: "VIR", inPortfolio: true, stats: strongStats(300) },
    ]);
    const s = summarizeWhatIfCrownSession("2026-07-22", 9);
    expect(s.crownHits).toBe(2);
    expect(s.portfolioWithData).toBe(9);
    expect(s.tickers).toEqual(["MSLE", "VIR"]);
    expect(s.historyDays).toBe(2);
    expect(s.historyHits).toBe(3);
    expect(localStorage.getItem(WHATIF_CROWN_HIT_STORAGE_KEY)).toBeTruthy();
  });

  it("opens Grado 3 gate only after day + hit thresholds", () => {
    const early = evaluateWhatIfGrade3Gate({ historyDays: 3, historyHits: 2 });
    expect(early.ready).toBe(false);
    expect(early.progress).toBeLessThan(1);

    const ready = evaluateWhatIfGrade3Gate({
      historyDays: WHATIF_GRADE3_MIN_HISTORY_DAYS,
      historyHits: WHATIF_GRADE3_MIN_HISTORY_HITS,
    });
    expect(ready.ready).toBe(true);
    expect(ready.progress).toBe(1);
    expect(shouldShowWhatIfGrade3ReadyWindow(ready)).toBe(true);

    dismissWhatIfGrade3ReadyWindow(ready);
    expect(shouldShowWhatIfGrade3ReadyWindow(ready)).toBe(false);

    const grown = evaluateWhatIfGrade3Gate({
      historyDays: WHATIF_GRADE3_MIN_HISTORY_DAYS + 1,
      historyHits: WHATIF_GRADE3_MIN_HISTORY_HITS,
    });
    expect(shouldShowWhatIfGrade3ReadyWindow(grown)).toBe(true);
  });

  it("stores readout on first insert only and backfills legacy hits", () => {
    const row = { SDS: 55, EIS: 44, Plan_Prob_Pct: 60, Ticker: "MSLE" };
    const readout = buildWhatIfCrownReadoutFromSimRow(row, {
      source: "capture",
      frozenAt: "2026-07-22T10:00:00.000Z",
      ticker: "MSLE",
    });
    recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "MSLE",
        inPortfolio: true,
        stats: strongStats(300),
        readout,
      },
    ]);
    const hit = listWhatIfCrownHitsForSession("2026-07-22")[0]!;
    expect(hit.readout?.sds).toBe(55);
    expect(hit.readout?.pPlan).toBe(60);

    const updatedReadout = buildWhatIfCrownReadoutFromSimRow(
      { SDS: 99, Plan_Prob_Pct: 80, Ticker: "MSLE" },
      { source: "capture", frozenAt: "2026-07-22T12:00:00.000Z", ticker: "MSLE" },
    );
    recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "MSLE",
        inPortfolio: true,
        stats: strongStats(500),
        readout: updatedReadout,
      },
    ]);
    expect(listWhatIfCrownHitsForSession("2026-07-22")[0]!.readout?.sds).toBe(55);

    clearWhatIfCrownHitStore();
    recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "OLD",
        inPortfolio: true,
        stats: strongStats(100),
        readout: {
          sds: null,
          eis: null,
          pPlan: null,
          precatKind: "avoid",
          pCont: 64,
          contG10: null,
          exhaustEdge: null,
          dailyPct24h: null,
          miiAngleDeg: null,
          frozenAt: "t0",
          source: "backfill",
        },
      },
    ]);
    const { filled } = backfillWhatIfCrownReadouts(
      () => ({ ...row, Ticker: "OLD" }),
      loadWhatIfCrownHitStore(),
      undefined,
      {
        sdsByTicker: new Map([["OLD", { sds: 55 }]]),
      },
    );
    expect(filled).toBe(1);
    const enriched = listWhatIfCrownHitsForSession("2026-07-22")[0]!;
    expect(enriched.readout?.sds).toBe(55);
    expect(enriched.readout?.pPlan).toBe(60);
    expect(enriched.readout?.pCont).toBe(64);
  });

  it("backfill preserves capture source on partial live readouts", () => {
    clearWhatIfCrownHitStore();
    recordWhatIfCrownHits("2026-07-22", [
      {
        ticker: "LIVE",
        inPortfolio: true,
        stats: strongStats(200),
        readout: {
          sds: 70,
          eis: null,
          pPlan: null,
          precatKind: "rising",
          pCont: 55,
          contG10: null,
          exhaustEdge: null,
          dailyPct24h: 3,
          miiAngleDeg: null,
          frozenAt: "2026-07-22T14:00:00.000Z",
          source: "capture",
        },
      },
    ]);
    const { filled } = backfillWhatIfCrownReadouts(
      () => ({ SDS: 99, EIS: 88, Plan_Prob_Pct: 77, Ticker: "LIVE" }),
      loadWhatIfCrownHitStore(),
    );
    expect(filled).toBe(1);
    const hit = listWhatIfCrownHitsForSession("2026-07-22")[0]!;
    expect(hit.readout?.source).toBe("capture");
    expect(hit.readout?.sds).toBe(70);
    expect(hit.readout?.eis).toBe(88);
    expect(hit.readout?.pPlan).toBe(77);
  });
});
