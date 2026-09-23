import { describe, expect, it } from "vitest";
import { resolveEventMarketEisHorizons } from "./eventMarketEisHorizons";

describe("resolveEventMarketEisHorizons", () => {
  it("reads explicit horizons", () => {
    const h = resolveEventMarketEisHorizons({
      eis: {
        score: 1,
        horizons: {
          h12: { score: 0.5, delta_pct: 1.2 },
          h24: { score: 1.1, delta_pct: 2.0 },
          h36: { score: null, delta_pct: null },
        },
      },
    });
    expect(h.h12.score).toBe(0.5);
    expect(h.h12.pending).toBe(false);
    expect(h.h24.deltaPct).toBe(2.0);
    expect(h.h36.pending).toBe(true);
  });

  it("falls back 24h to delta_p_1d", () => {
    const h = resolveEventMarketEisHorizons({
      price: { delta_p_1d: 3.5 },
      sentiment: 0,
    });
    expect(h.h24.deltaPct).toBe(3.5);
    expect(h.h24.score).not.toBeNull();
    expect(h.h12.pending).toBe(true);
  });
});
