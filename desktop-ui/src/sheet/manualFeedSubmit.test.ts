import { describe, expect, it, beforeEach, vi } from "vitest";
import { loadManualFeedEvents } from "./manualFeedEvents";
import {
  parseManualFeedForSubmit,
  previewManualFeedEis,
  submitManualFeedRaw,
} from "./manualFeedSubmit";

describe("manualFeedSubmit", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    const ls = {
      store,
      getItem(k: string) {
        return store[k] ?? null;
      },
      setItem(k: string, v: string) {
        store[k] = v;
      },
      removeItem(k: string) {
        delete store[k];
      },
    };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      localStorage: ls,
      dispatchEvent: vi.fn(),
    });
  });

  it("saves labeled manual news with investigation context loss", () => {
    const result = submitManualFeedRaw({
      raw: `TICKER: LTRN
DATE: 2026-07-07
SOURCE: GlobeNewswire
NEWS: Phase 2 delay announced`,
      defaultTicker: "LTRN",
      priceMovePct: -4.7,
      investigationContext: "loss",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tickers).toEqual(["LTRN"]);
    const saved = loadManualFeedEvents();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.ticker).toBe("LTRN");
    expect(saved[0]?.investigationContext).toBe("loss");
    expect(saved[0]?.priceDropPct).toBe(-4.7);
  });

  it("does not inject today's Var.24h when research marks VAR_24H not supplied", () => {
    const rows = parseManualFeedForSubmit({
      raw: `TICKER: JSPR
EVENT_DATE: 2026-07-16
FIRST_TRADABLE: 2026-07-17
VAR_24H: NOT SUPPLIED — see DATA CONFLICT
OUTCOME: neutral
SENTIMENT: -1
CONFIDENCE: medium — price reaction unverified
NEWS: All-stock acquisition of Kira; de facto reverse merger; dilution to legacy common ~93.3%.
Prior leans negative_catalyst for legacy common.
DATA CONFLICT — RESOLVE BEFORE SCORING. Do not import either figure.`,
      defaultTicker: "JSPR",
      priceMovePct: -0.7,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.priceDropPct).toBeNull();
    const eis = previewManualFeedEis(rows[0]!);
    // Soft negative from dilution thesis — not amplified by unrelated −0.7% day move.
    expect(eis.score).toBeLessThan(0);
    expect(eis.score).toBeGreaterThan(-5);
  });
});
