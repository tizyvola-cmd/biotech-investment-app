import { describe, expect, it, beforeEach } from "vitest";
import {
  applyMobileVisitDeltas,
  buildMobileVisitBaselineFromLive,
  captureMobileVisitBaseline,
  isMobileVisitBaselinePoisoned,
  deltaPnlEurSinceMobileVisit,
} from "./mobileVisitBaseline";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
}

describe("mobileVisitBaseline", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      configurable: true,
    });
  });

  it("flags a leave snapshot written seconds ago at the same MTM", () => {
    const live = [
      { key: "A|1", pnlEur: 100 },
      { key: "B|1", pnlEur: 200 },
    ];
    const prior = {
      savedAt: new Date().toISOString(),
      portfolioPnlEur: 300,
      tickers: { "A|1": { pnlEur: 100 }, "B|1": { pnlEur: 200 } },
    };
    expect(isMobileVisitBaselinePoisoned(prior, live)).toBe(true);
  });

  it("keeps a real prior visit and computes non-zero Δ", () => {
    const prior = {
      savedAt: "2026-08-09T18:00:00.000Z",
      portfolioPnlEur: 400,
      tickers: { "MSLE|2026-08-30": { pnlEur: 400 } },
    };
    localStorage.setItem("supernova_mobile_visit_leave_v1", JSON.stringify(prior));
    const live = [{ key: "MSLE|2026-08-30", pnlEur: 585 }];
    const baseline = captureMobileVisitBaseline(live);
    expect(baseline?.tickers["MSLE|2026-08-30"]?.pnlEur).toBe(400);
    expect(deltaPnlEurSinceMobileVisit("MSLE|2026-08-30", 585, baseline)).toBe(185);
    const rows = applyMobileVisitDeltas(
      [{ key: "MSLE|2026-08-30", pnlEur: 585, deltaPnlEurSinceVisit: 0 }],
      baseline,
    );
    expect(rows[0]!.deltaPnlEurSinceVisit).toBe(185);
  });

  it("seeds session freeze from live when leave is poisoned so later marks can move Δ", () => {
    const live = [
      { key: "A|1", pnlEur: 50 },
      { key: "B|1", pnlEur: 70 },
    ];
    localStorage.setItem(
      "supernova_mobile_visit_leave_v1",
      JSON.stringify(buildMobileVisitBaselineFromLive(live)),
    );
    const baseline = captureMobileVisitBaseline(live);
    expect(baseline).not.toBeNull();
    expect(deltaPnlEurSinceMobileVisit("A|1", 50, baseline)).toBe(0);
    expect(deltaPnlEurSinceMobileVisit("A|1", 80, baseline)).toBe(30);
  });
});
