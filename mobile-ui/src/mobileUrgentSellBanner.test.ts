import { describe, expect, it } from "vitest";
import {
  buildUrgentSellItemsFromSnapshot,
  sortUrgentSellItems,
  urgentSellNeedsBanner,
  urgentSellSig,
  saveUrgentSellAck,
  loadUrgentSellAck,
} from "./mobileUrgentSellBanner";

describe("mobileUrgentSellBanner", () => {
  it("ranks G2 ahead of soft_g1", () => {
    const sorted = sortUrgentSellItems([
      { key: "B|1", ticker: "B", tag: "soft_g1", capitalEur: 1, pnlEur: -1 },
      { key: "A|1", ticker: "A", tag: "G2", capitalEur: 1, pnlEur: -2 },
    ]);
    expect(sorted[0]!.ticker).toBe("A");
  });

  it("builds items and fills capital from open book", () => {
    const items = buildUrgentSellItemsFromSnapshot({
      softSells: [
        { key: "CCCC|2026-01-01", ticker: "CCCC", tag: "G2", capitalEur: null, pnlEur: null },
      ],
      openByKey: new Map([
        ["CCCC|2026-01-01", { capitalEur: 2170, pnlEur: -15 }],
      ]),
    });
    expect(items[0]!.capitalEur).toBe(2170);
    expect(items[0]!.pnlEur).toBe(-15);
  });

  it("acks by sell-list signature", () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      configurable: true,
    });
    const items = [
      { key: "A|1", ticker: "A", tag: "G2", capitalEur: 1, pnlEur: -1 },
    ];
    expect(urgentSellNeedsBanner(items)).toBe(true);
    saveUrgentSellAck(items);
    expect(loadUrgentSellAck()).toBe(urgentSellSig(items));
    expect(urgentSellNeedsBanner(items)).toBe(false);
  });
});
