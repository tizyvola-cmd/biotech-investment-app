import { describe, expect, it } from "vitest";
import {
  applyLossAwareSynthCapEur,
  applyLossAwareSynthShare,
  effectiveSynthMovePct,
} from "./synthLossAwareCap";

describe("synthLossAwareCap", () => {
  it("uses total P&L not 24h bounce on open losers", () => {
    expect(
      effectiveSynthMovePct({
        movePct24h: 5,
        totalPnlPct: -12,
        isOpenPortfolio: true,
      }),
    ).toBe(-12);
  });

  it("keeps 24h move for winners and sim-loop hypotheticals", () => {
    expect(
      effectiveSynthMovePct({
        movePct24h: 5,
        totalPnlPct: 8,
        isOpenPortfolio: true,
      }),
    ).toBe(5);
    expect(
      effectiveSynthMovePct({
        movePct24h: 5,
        totalPnlPct: -12,
        isOpenPortfolio: false,
      }),
    ).toBe(5);
  });

  it("never upsizes capital on underwater positions", () => {
    expect(applyLossAwareSynthCapEur(7891, 11545, -8)).toBe(7891);
    expect(applyLossAwareSynthCapEur(7891, 5000, -8)).toBe(5000);
  });

  it("allows upsize on winners", () => {
    expect(applyLossAwareSynthCapEur(7891, 11545, 4)).toBe(11545);
  });

  it("caps display share at current book on losers", () => {
    const share = applyLossAwareSynthShare(0.23, 7891, 50_000, -6);
    expect(share * 50_000).toBeCloseTo(7891, 0);
  });
});
