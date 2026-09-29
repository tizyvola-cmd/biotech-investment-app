import { describe, expect, it, beforeEach } from "vitest";
import {
  clampRecIsoToSeries,
  ensureClosedRecEpisodesDrawable,
  ensureOpenRecHasDrawableSpan,
  loadTickerOperationalRecEpisodes,
  mergeRecEpisodes,
  pointInRecWindow,
  recBoundariesForPoints,
  recFillForPoints,
  syncTickerOperationalRec,
} from "./tickerOperationalRecEpisodes";

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
  });
});

describe("syncTickerOperationalRec", () => {
  it("opens BUY, then closes on HOLD with an end timestamp", () => {
    syncTickerOperationalRec("INBX", "buy", "2026-09-01");
    const open = loadTickerOperationalRecEpisodes("INBX");
    expect(open).toHaveLength(1);
    expect(open[0]?.rec).toBe("buy");
    expect(open[0]?.endIso).toBeNull();

    syncTickerOperationalRec("INBX", "hold", "2026-09-03");
    const closed = loadTickerOperationalRecEpisodes("INBX");
    expect(closed[0]?.endIso).toBe("2026-09-03");
  });

  it("flips BUY → SELL as a close + new episode", () => {
    syncTickerOperationalRec("AAA", "buy", "2026-08-01");
    syncTickerOperationalRec("AAA", "sell", "2026-08-10");
    const eps = loadTickerOperationalRecEpisodes("AAA");
    expect(eps.map((e) => e.rec)).toEqual(["buy", "sell"]);
    expect(eps[0]?.endIso).toBe("2026-08-10");
    expect(eps[1]?.endIso).toBeNull();
  });

  it("does not restart an open BUY on later ticks", () => {
    syncTickerOperationalRec("BBB", "buy", "2026-09-01T10:00:00");
    syncTickerOperationalRec("BBB", "buy", "2026-09-01T15:00:00");
    expect(loadTickerOperationalRecEpisodes("BBB")).toHaveLength(1);
    expect(loadTickerOperationalRecEpisodes("BBB")[0]?.startIso).toBe("2026-09-01T10:00:00");
  });

  it("backdates an open BUY when preferStartIso is earlier", () => {
    syncTickerOperationalRec("CCC", "buy", "2026-09-10");
    syncTickerOperationalRec("CCC", "buy", "2026-09-10", {
      preferStartIso: "2026-09-01",
    });
    expect(loadTickerOperationalRecEpisodes("CCC")[0]?.startIso).toBe("2026-09-01");
  });
});

describe("ensureOpenRecHasDrawableSpan", () => {
  it("stretches a short open BUY to a drawable multi-bar window", () => {
    const pts = [
      { key: "2026-08-30" },
      { key: "2026-08-31" },
      { key: "2026-09-01" },
    ];
    const stretched = ensureOpenRecHasDrawableSpan(pts, [
      { rec: "buy", startIso: "2026-09-01", endIso: null },
    ]);
    expect(stretched[0]?.startIso).toBe("2026-08-30");
  });

  it("clamps Soft BUY starting after last chart day onto the series (6M lag)", () => {
    const pts = [
      { key: "2026-08-28" },
      { key: "2026-08-29" },
      { key: "2026-08-30" },
      { key: "2026-08-31" },
    ];
    const fixed = ensureOpenRecHasDrawableSpan(pts, [
      { rec: "buy", startIso: "2026-09-01", endIso: null },
    ]);
    expect(fixed[0]?.startIso).toBe("2026-08-28");
    const fill = recFillForPoints(
      pts.map((p) => ({ ...p, tickerPrice: 10 })),
      fixed,
    );
    expect(fill.filter((f) => f.buyFill != null).length).toBeGreaterThanOrEqual(2);
  });
});

describe("mergeRecEpisodes", () => {
  it("adds historical windows the app never saw live", () => {
    const merged = mergeRecEpisodes(
      [{ rec: "buy", startIso: "2026-08-20", endIso: null }],
      [
        { rec: "buy", startIso: "2026-05-04", endIso: "2026-05-19" },
        { rec: "sell", startIso: "2026-06-02", endIso: "2026-06-08" },
      ],
    );
    expect(merged.map((e) => [e.rec, e.startIso])).toEqual([
      ["buy", "2026-05-04"],
      ["sell", "2026-06-02"],
      ["buy", "2026-08-20"],
    ]);
  });

  it("keeps the persisted episode when a derived one overlaps it", () => {
    const merged = mergeRecEpisodes(
      [{ rec: "buy", startIso: "2026-08-10", endIso: null }],
      [{ rec: "buy", startIso: "2026-08-24T09:00:00", endIso: null }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.startIso).toBe("2026-08-10");
  });
});

describe("ensureClosedRecEpisodesDrawable", () => {
  it("stretches a single-bar closed window so the Area paints", () => {
    const pts = [{ key: "2026-08-01" }, { key: "2026-08-02" }, { key: "2026-08-03" }];
    const fixed = ensureClosedRecEpisodesDrawable(pts, [
      { rec: "buy", startIso: "2026-08-02", endIso: "2026-08-02" },
    ]);
    expect(fixed[0]?.endIso).toBe("2026-08-03");
    const fill = recFillForPoints(
      pts.map((p) => ({ ...p, tickerPrice: 10 })),
      fixed,
    );
    expect(fill.filter((f) => f.buyFill != null)).toHaveLength(2);
  });

  it("leaves off-screen and open windows untouched", () => {
    const pts = [{ key: "2026-08-01" }, { key: "2026-08-02" }];
    const offScreen = { rec: "sell" as const, startIso: "2026-01-01", endIso: "2026-01-05" };
    const open = { rec: "buy" as const, startIso: "2026-08-02", endIso: null };
    expect(ensureClosedRecEpisodesDrawable(pts, [offScreen, open])).toEqual([offScreen, open]);
  });
});

describe("clampRecIsoToSeries", () => {
  it("pins asOf after last bar back to last bar", () => {
    expect(
      clampRecIsoToSeries("2026-09-01", [{ key: "2026-08-30" }, { key: "2026-08-31" }]),
    ).toBe("2026-08-31");
  });
});

describe("recFillForPoints / boundaries", () => {
  it("fills buy under the curve only inside the episode", () => {
    const pts = [
      { key: "2026-08-01", tickerPrice: 10 },
      { key: "2026-08-02", tickerPrice: 11 },
      { key: "2026-08-03", tickerPrice: 12 },
    ];
    const fill = recFillForPoints(pts, [
      { rec: "buy", startIso: "2026-08-02", endIso: "2026-08-02" },
    ]);
    expect(fill.map((f) => f.buyFill)).toEqual([null, 11, null]);
    expect(fill.every((f) => f.sellFill == null)).toBe(true);
  });

  it("on a BUY→SELL flip day, the later episode owns the fill", () => {
    const pts = [
      { key: "2026-08-09", tickerPrice: 10 },
      { key: "2026-08-10", tickerPrice: 11 },
      { key: "2026-08-11", tickerPrice: 12 },
    ];
    const fill = recFillForPoints(pts, [
      { rec: "buy", startIso: "2026-08-09", endIso: "2026-08-10" },
      { rec: "sell", startIso: "2026-08-10", endIso: null },
    ]);
    expect(fill.map((f) => f.buyFill)).toEqual([10, null, null]);
    expect(fill.map((f) => f.sellFill)).toEqual([null, 11, 12]);
  });

  it("can fill under volume using a height accessor", () => {
    const pts = [
      { key: "2026-08-24", volumePlot: 1_000_000 },
      { key: "2026-08-25", volumePlot: 1_200_000 },
      { key: "2026-08-26", volumePlot: 900_000 },
    ];
    const fill = recFillForPoints(
      pts,
      [{ rec: "sell", startIso: "2026-08-24", endIso: "2026-08-25" }],
      (p) => p.volumePlot,
    );
    expect(fill.map((f) => f.sellFill)).toEqual([1_000_000, 1_200_000, null]);
    expect(fill.every((f) => f.buyFill == null)).toBe(true);
  });

  it("marks start and end on distinct visible points", () => {
    const pts = [{ key: "2026-08-01" }, { key: "2026-08-02" }, { key: "2026-08-03" }];
    const marks = recBoundariesForPoints(pts, [
      { rec: "sell", startIso: "2026-08-01", endIso: "2026-08-03" },
    ]);
    expect(marks).toEqual([
      { pointKey: "2026-08-01", kind: "start", rec: "sell" },
      { pointKey: "2026-08-03", kind: "end", rec: "sell" },
    ]);
  });
});

describe("pointInRecWindow", () => {
  it("includes the whole daily bar when start/end are dates", () => {
    expect(pointInRecWindow("2026-09-01", "2026-09-01", "2026-09-01")).toBe(true);
    expect(pointInRecWindow("2026-09-02", "2026-09-01", "2026-09-01")).toBe(false);
  });
});
