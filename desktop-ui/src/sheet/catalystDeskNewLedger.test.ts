import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCatalystDeskNewLedger,
  listCatalystDeskNewToday,
  msUntilNextRomeMidnight,
  recordCatalystDeskTickers,
  romeDateKey,
} from "./catalystDeskNewLedger";

function stubStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage });
  _resetCatalystDeskNewLedger();
}

describe("catalystDeskNewLedger", () => {
  beforeEach(() => {
    stubStorage();
  });

  it("does not bookmark the bootstrap set", () => {
    const now = Date.parse("2026-09-06T10:00:00+02:00");
    const today = recordCatalystDeskTickers(["VRTX", "AMGN"], now);
    expect(today).toEqual([]);
    expect(listCatalystDeskNewToday(["VRTX", "AMGN"], now)).toEqual([]);
  });

  it("bookmarks a title first seen after bootstrap, only that Rome day", () => {
    const day1 = Date.parse("2026-09-06T10:00:00+02:00");
    recordCatalystDeskTickers(["VRTX"], day1);
    const added = recordCatalystDeskTickers(["VRTX", "GILD"], day1);
    expect(added).toEqual(["GILD"]);

    const day2 = Date.parse("2026-09-07T10:00:00+02:00");
    expect(listCatalystDeskNewToday(["VRTX", "GILD"], day2)).toEqual([]);
    const next = recordCatalystDeskTickers(["VRTX", "GILD", "GRAL"], day2);
    expect(next).toEqual(["GRAL"]);
  });

  it("the next Rome day drops yesterday’s bookmarks and keeps only new titles", () => {
    const sat = Date.parse("2026-09-06T11:00:00+02:00");
    recordCatalystDeskTickers(["VRTX"], sat);
    expect(recordCatalystDeskTickers(["VRTX", "AMGN"], sat)).toEqual(["AMGN"]);

    const sun = Date.parse("2026-09-07T08:00:00+02:00");
    expect(listCatalystDeskNewToday(["VRTX", "AMGN"], sun)).toEqual([]);
    expect(recordCatalystDeskTickers(["VRTX", "AMGN", "GRAL"], sun)).toEqual(["GRAL"]);
    expect(listCatalystDeskNewToday(["VRTX", "AMGN", "GRAL"], sun)).toEqual(["GRAL"]);
  });

  it("romeDateKey is YYYY-MM-DD", () => {
    expect(romeDateKey(Date.parse("2026-09-06T23:30:00+02:00"))).toBe("2026-09-06");
  });

  it("msUntilNextRomeMidnight is after now and before 24h", () => {
    const ms = msUntilNextRomeMidnight(Date.parse("2026-09-06T22:00:00+02:00"));
    expect(ms).toBeGreaterThan(60_000);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 250);
  });
});
