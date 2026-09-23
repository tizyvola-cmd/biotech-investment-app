import { describe, expect, it } from "vitest";
import {
  isSoftBuyBlockedByRecentSell,
  latestBookSoldAtIso,
  softBuyBlockedByBookSell,
  SOFT_BUY_POST_SELL_COOLDOWN_DAYS,
} from "./softBuyPostSellCooldown";
import { deriveSuggestedAction } from "./investDecisionSimLoop";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";

function baseOpp(over: Partial<PortfolioLossAnalysisItem> = {}): PortfolioLossAnalysisItem {
  return {
    key: "NRIX|2026-09-01",
    ticker: "NRIX",
    company: "Nurix",
    profile: "opportunity",
    hasPosition: false,
    capital: 0,
    pnlEur: null,
    pnlPct: null,
    pnlEur24h: null,
    pnlPct24h: 1.2,
    recoveryProbabilityPct: 62,
    sdsScore: 45,
    investVerdict: "wait",
    exitDecision: "hold",
    precatKind: null,
    planReturnPct: 8,
    seriesKey: null,
    ...over,
  } as PortfolioLossAnalysisItem;
}

describe("softBuyPostSellCooldown", () => {
  it("blocks Soft BUY within cooldown window", () => {
    const soldAt = "2026-08-06T07:00:00.000Z";
    const now = new Date("2026-08-06T08:00:00.000Z");
    expect(isSoftBuyBlockedByRecentSell(soldAt, now)).toBe(true);
    const after = new Date(
      Date.parse(soldAt) + SOFT_BUY_POST_SELL_COOLDOWN_DAYS * 24 * 3600_000 + 1000,
    );
    expect(isSoftBuyBlockedByRecentSell(soldAt, after)).toBe(false);
  });

  it("finds latest soldAt across warrant/common siblings", () => {
    const iso = latestBookSoldAtIso(
      {
        "JSPR|2026-12-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-08-01T12:00:00.000Z",
          closedCapital: 2000,
          closedPnlEur: 0,
        },
        "JSPRW|2026-12-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-08-05T16:00:00.000Z",
          closedCapital: 2000,
          closedPnlEur: 120,
        },
      },
      { key: "JSPR|2026-12-01", ticker: "JSPR" },
    );
    expect(iso).toBe("2026-08-05T16:00:00.000Z");
  });

  it("deriveSuggestedAction does not Soft BUY a just-sold book name", () => {
    const item = baseOpp();
    const enhance = {
      recentlySoldBlocked: softBuyBlockedByBookSell(
        {
          "NRIX|2026-09-01": {
            buyPrice: 0,
            capital: 0,
            ignoreSheet: true,
            soldAt: new Date().toISOString(),
            closedCapital: 1000,
            closedPnlEur: 18,
          },
        },
        { key: item.key, ticker: item.ticker },
      ),
      priorSessionPcts: [1.5],
      simRow: { "Var. Giorn. %": 1.2 },
    };
    expect(enhance.recentlySoldBlocked).toBe(true);
    expect(deriveSuggestedAction(item, false, null, null, enhance)).not.toBe("buy");
  });
});
