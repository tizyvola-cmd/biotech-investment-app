import { beforeEach, describe, expect, it } from "vitest";
import {
  buildRedBellAlertItems,
  redBellAlertSig,
  redBellNeedsAlert,
  saveRedBellAck,
} from "./mobileRiskAlerts";

const RTH_BUY = "2026-08-11T15:00:00.000Z";

describe("buildRedBellAlertItems", () => {
  it("includes giveback ≥10% of peak G/L wins", () => {
    const items = buildRedBellAlertItems([
      {
        key: "AAA|1",
        ticker: "AAA",
        pnlEur: 350,
        peakPnlEur: 400,
        capitalEur: 1000,
        investedAt: RTH_BUY,
      },
      {
        key: "BBB|1",
        ticker: "BBB",
        pnlEur: 390,
        peakPnlEur: 400,
        capitalEur: 1000,
        investedAt: RTH_BUY,
      },
      {
        key: "CCC|1",
        ticker: "CCC",
        pnlEur: -10,
        peakPnlEur: 400,
        capitalEur: 1000,
        investedAt: RTH_BUY,
      },
    ]);
    // AAA: giveback 50 ≥ 40; BBB: 10 < 40; CCC: underwater giveback hit
    expect(items.map((i) => i.ticker).sort()).toEqual(["AAA", "CCC"]);
  });

  it("acks by signature so the same set does not re-alert", () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
      configurable: true,
    });
    const items = buildRedBellAlertItems([
      {
        key: "AAA|1",
        ticker: "AAA",
        pnlEur: 350,
        peakPnlEur: 400,
        capitalEur: 1000,
        investedAt: RTH_BUY,
      },
    ]);
    expect(redBellNeedsAlert(items)).toBe(true);
    saveRedBellAck(items);
    expect(redBellNeedsAlert(items)).toBe(false);
    expect(redBellAlertSig(items)).toBe("AAA|1");
  });
});
