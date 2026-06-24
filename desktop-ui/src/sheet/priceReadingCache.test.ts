import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  computePriceReadingDelta,
  isPriorCalendarDay,
  loadPriceReadingCache,
  recordPriceReadingUpdates,
  seedPriceReadingCacheIfMissing,
  backfillSyntheticPricePrevious,
  resolveReadingDelta,
  syncPriceReadingCache,
} from "./priceReadingCache";

describe("priceReadingCache", () => {
  const mem: Record<string, string> = {};

  beforeEach(() => {
    for (const k of Object.keys(mem)) delete mem[k];
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
      clear: () => {
        for (const k of Object.keys(mem)) delete mem[k];
      },
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => mem[`sess:${k}`] ?? null,
      setItem: (k: string, v: string) => {
        mem[`sess:${k}`] = v;
      },
      removeItem: (k: string) => {
        delete mem[`sess:${k}`];
      },
      clear: () => {
        for (const k of Object.keys(mem)) {
          if (k.startsWith("sess:")) delete mem[k];
        }
      },
    });
  });

  it("returns null delta when only one measurement exists", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 100 }]);
    expect(computePriceReadingDelta("AAPL|2026-01-01", 100)).toEqual({
      pct: null,
      priorTs: null,
      currentTs: expect.any(String),
    });
  });

  it("computes pct vs penultima after refresh", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 100 }]);
    recordPriceReadingUpdates([{ key: "AAPL|2026-01-01", priceUsd: 105 }], {
      versionChanged: true,
    });
    const delta = computePriceReadingDelta("AAPL|2026-01-01", 105);
    expect(delta.pct).toBe(5);
    expect(delta.priorTs).toBeTruthy();
    expect(delta.currentTs).toBeTruthy();
  });

  it("updates metadata on version change without rolling previous when price unchanged", () => {
    seedPriceReadingCacheIfMissing([{ key: "A|cd", priceUsd: 10 }]);
    const first = loadPriceReadingCache()["A|cd"]!.current.ts;
    recordPriceReadingUpdates([{ key: "A|cd", priceUsd: 10 }], {
      simTableVersion: "v2",
      versionChanged: true,
    });
    const entry = loadPriceReadingCache()["A|cd"]!;
    expect(entry.previous).toBeNull();
    expect(entry.current.priceUsd).toBe(10);
    expect(entry.current.simTableVersion).toBe("v2");
    expect(computePriceReadingDelta("A|cd", 10).pct).toBeNull();
  });

  it("rolls previous on day roll even if price unchanged", () => {
    seedPriceReadingCacheIfMissing([{ key: "A|cd", priceUsd: 10 }]);
    const first = loadPriceReadingCache()["A|cd"]!.current.ts;
    recordPriceReadingUpdates([{ key: "A|cd", priceUsd: 10 }], {
      versionChanged: true,
      dayRoll: true,
    });
    const entry = loadPriceReadingCache()["A|cd"]!;
    expect(entry.previous?.priceUsd).toBe(10);
    expect(entry.previous?.ts).toBe(first);
    expect(computePriceReadingDelta("A|cd", 10).pct).toBe(0);
  });

  it("seedPriceReadingCacheIfMissing does not overwrite existing entries", () => {
    seedPriceReadingCacheIfMissing([{ key: "A|cd", priceUsd: 10 }]);
    seedPriceReadingCacheIfMissing([
      { key: "A|cd", priceUsd: 12 },
      { key: "B|cd", priceUsd: 20 },
    ]);
    const cache = loadPriceReadingCache();
    expect(cache["A|cd"]?.current.priceUsd).toBe(10);
    expect(cache["B|cd"]?.current.priceUsd).toBe(20);
  });

  it("resolveReadingDelta prefers price cache over portfolio fallback", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 100 }]);
    recordPriceReadingUpdates([{ key: "AAPL|2026-01-01", priceUsd: 105 }], {
      versionChanged: true,
    });
    const delta = resolveReadingDelta("AAPL|2026-01-01", 105, {
      pct: 2,
      priorTs: "2026-06-09T15:00:00.000Z",
      currentTs: null,
    });
    expect(delta.pct).toBe(5);
    expect(delta.source).toBe("last_read");
  });

  it("resolveReadingDelta uses market close when stale same-price roll yields 0%", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 100 }]);
    recordPriceReadingUpdates([{ key: "AAPL|2026-01-01", priceUsd: 100 }], {
      versionChanged: true,
      dayRoll: true,
    });
    const delta = resolveReadingDelta("AAPL|2026-01-01", 100, undefined, {
      marketDayClosePct: 3.5,
    });
    expect(delta.pct).toBe(3.5);
    expect(delta.source).toBe("market_close");
  });

  it("resolveReadingDelta uses market close when prior read is prior calendar day and delta is 0", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 100 }]);
    const cache = loadPriceReadingCache();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    cache["AAPL|2026-01-01"] = {
      current: {
        priceUsd: 100,
        ts: yesterday.toISOString(),
        simTableVersion: null,
      },
      previous: {
        priceUsd: 100,
        ts: yesterday.toISOString(),
        simTableVersion: null,
      },
    };
    const storage = localStorage as Storage;
    storage.setItem("biotech_sim_price_read_v3", JSON.stringify(cache));

    const delta = resolveReadingDelta("AAPL|2026-01-01", 100, undefined, {
      marketDayClosePct: 3.5,
    });
    expect(delta.pct).toBe(3.5);
    expect(delta.source).toBe("market_close");
  });

  it("syncPriceReadingCache rolls readings on new calendar day even if price hash unchanged", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const storage = localStorage as Storage;
    storage.setItem(
      "biotech_sim_price_read_v3",
      JSON.stringify({
        "A|cd": {
          current: { priceUsd: 10, ts: yesterday.toISOString(), simTableVersion: "v1" },
          previous: null,
        },
      }),
    );
    syncPriceReadingCache([{ key: "A|cd", priceUsd: 10, dailyPct: 2 }], {
      simTableVersion: "v1",
      versionChanged: false,
    });
    const entry = loadPriceReadingCache()["A|cd"]!;
    expect(entry.previous?.priceUsd).toBe(10);
    expect(entry.previous?.ts).toBe(yesterday.toISOString());
    expect(isPriorCalendarDay(entry.current.ts)).toBe(false);
  });

  it("backfills synthetic previous from Var. Giorn. % for existing cache", () => {
    seedPriceReadingCacheIfMissing([{ key: "AAPL|2026-01-01", priceUsd: 105 }]);
    backfillSyntheticPricePrevious([{ key: "AAPL|2026-01-01", priceUsd: 105, dailyPct: 5 }]);
    const delta = computePriceReadingDelta("AAPL|2026-01-01", 105);
    expect(delta.pct).toBe(5);
    expect(delta.priorTs).toBeTruthy();
  });

  it("seeds with synthetic previous when daily pct provided", () => {
    seedPriceReadingCacheIfMissing([{ key: "B|cd", priceUsd: 110, dailyPct: -2 }]);
    const delta = computePriceReadingDelta("B|cd", 110);
    expect(delta.pct).toBe(-2);
  });
});
