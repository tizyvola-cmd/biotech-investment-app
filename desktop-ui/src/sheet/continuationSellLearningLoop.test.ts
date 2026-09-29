import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartPoint } from "../types";
import {
  buildContSellLearningView,
  CONT_SELL_LEARNING_SIGNALS_KEY,
  CONT_SELL_STRETCH_BASELINE,
  proposeContSellStretch,
  scoreContSellDrawdownFromChart,
  type ContSellSignalFreeze,
} from "./continuationSellLearningLoop";
import {
  CONT_SELL_LEARNING_STRETCH_KEY,
  contSellPassesStretch,
  defaultContSellStretchState,
  saveContSellStretchState,
} from "./continuationSellStretchStore";
import { shouldContinuationExhaustedSell } from "./continuationScore";

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  });
});

afterEach(() => {
  mem.clear();
  vi.unstubAllGlobals();
});

function mkPts(startOff: number, prices: number[]): ChartPoint[] {
  return prices.map((y, i) => ({
    offset: startOff + i,
    price_storico_usd: y,
  }));
}

describe("scoreContSellDrawdownFromChart", () => {
  it("hits when min close within 5 sessions drops ≥5% from freeze", () => {
    const freezeOff = -20;
    const pts = mkPts(freezeOff, [10, 9.8, 9.2, 9.0, 9.1, 9.3]);
    const scored = scoreContSellDrawdownFromChart(pts, freezeOff, 10);
    expect(scored).not.toBeNull();
    expect(scored!.hit).toBe(true);
    expect(scored!.maxDrawdownPct).toBeLessThanOrEqual(-5);
  });

  it("misses when price holds within 5%", () => {
    const freezeOff = -20;
    const pts = mkPts(freezeOff, [10, 10.1, 9.9, 9.8, 9.7, 9.85]);
    const scored = scoreContSellDrawdownFromChart(pts, freezeOff, 10);
    expect(scored!.hit).toBe(false);
  });

  it("pending when fewer than 5 forward sessions", () => {
    const freezeOff = -20;
    const pts = mkPts(freezeOff, [10, 9.5, 9.2]);
    expect(scoreContSellDrawdownFromChart(pts, freezeOff, 10)).toBeNull();
  });
});

describe("contSellPassesStretch / live soft-sell", () => {
  it("baseline matches edge > 0 and g10 ≥ 5", () => {
    expect(
      contSellPassesStretch({ g10: 12, edge: 3 }, CONT_SELL_STRETCH_BASELINE),
    ).toBe(true);
    expect(
      contSellPassesStretch({ g10: 12, edge: 0 }, CONT_SELL_STRETCH_BASELINE),
    ).toBe(false);
    expect(
      contSellPassesStretch({ g10: 2, edge: 4 }, CONT_SELL_STRETCH_BASELINE),
    ).toBe(false);
  });

  it("raised edgeMin filters weak edges", () => {
    expect(
      contSellPassesStretch(
        { g10: 12, edge: 0.5 },
        { edgeMin: 2, edgeStretch: 1, g10MinOffset: 0 },
      ),
    ).toBe(false);
    expect(
      contSellPassesStretch(
        { g10: 12, edge: 3 },
        { edgeMin: 2, edgeStretch: 1, g10MinOffset: 0 },
      ),
    ).toBe(true);
  });

  it("shouldContinuationExhaustedSell uses stretch store", () => {
    saveContSellStretchState({
      ...defaultContSellStretchState(),
      applied: { edgeMin: 2, edgeStretch: 1, g10MinOffset: 0 },
    });
    const row = { cont_g10: 12, cont_sell_edge: 1.5 };
    expect(
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: 4,
        simRow: row,
      }),
    ).toBe(false);
    expect(
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: 4,
        simRow: { cont_g10: 12, cont_sell_edge: 3 },
      }),
    ).toBe(true);
  });
});

describe("proposeContSellStretch", () => {
  function freeze(
    partial: Partial<ContSellSignalFreeze> & Pick<ContSellSignalFreeze, "id" | "edge" | "hit">,
  ): ContSellSignalFreeze {
    return {
      key: partial.id,
      ticker: "T",
      asofDay: "2026-08-01",
      kind: "exhaustion",
      g10: 12,
      pCont: 55,
      pBase: 48,
      priceAtFreeze: 10,
      freezeOffset: -30,
      maxDrawdownPct: partial.hit ? -6 : -1,
      forwardMovePct: partial.hit ? -4 : 1,
      scoredAt: "2026-08-08T00:00:00.000Z",
      ...partial,
    };
  }

  it("raises edgeMin when hit rate is poor under current gate", () => {
    const signals = Array.from({ length: 10 }, (_, i) =>
      freeze({
        id: `k${i}`,
        edge: 3,
        hit: i < 3, // 30% hit
      }),
    );
    const proposal = proposeContSellStretch(signals, CONT_SELL_STRETCH_BASELINE);
    expect(proposal).not.toBeNull();
    expect(proposal!.to.edgeMin).toBeGreaterThan(CONT_SELL_STRETCH_BASELINE.edgeMin);
  });
});

describe("buildContSellLearningView", () => {
  it("reports stretch delta vs raw", () => {
    const signals: ContSellSignalFreeze[] = [
      {
        id: "a",
        key: "a",
        ticker: "A",
        asofDay: "2026-08-01",
        kind: "exhaustion",
        g10: 12,
        edge: 0.5,
        pCont: 50,
        pBase: 49,
        priceAtFreeze: 10,
        freezeOffset: -20,
        hit: false,
        maxDrawdownPct: -1,
        forwardMovePct: 0,
        scoredAt: "x",
      },
      {
        id: "b",
        key: "b",
        ticker: "B",
        asofDay: "2026-08-01",
        kind: "exhaustion",
        g10: 12,
        edge: 4,
        pCont: 60,
        pBase: 48,
        priceAtFreeze: 10,
        freezeOffset: -20,
        hit: true,
        maxDrawdownPct: -7,
        forwardMovePct: -5,
        scoredAt: "x",
      },
    ];
    const view = buildContSellLearningView(signals, {
      ...defaultContSellStretchState(),
      applied: { edgeMin: 2, edgeStretch: 1, g10MinOffset: 0 },
    });
    // Raw passes both (edge>0); stretch only b → stretch hit 100% vs raw 50%
    expect(view.rawHitPct).toBe(50);
    expect(view.stretchHitPct).toBe(100);
    expect(view.verdict).toBe("improved");
  });
});
