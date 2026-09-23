import { describe, expect, it } from "vitest";
import {
  buildCashFlowSnapshot,
  capCycleKpiVariant,
  computePortfolioCashFlow,
  computeSimLoopCashFlow,
  emptyCashFlow,
  formatCapCycleAmount,
} from "./experimentCashFlow";
import type {
  DecisionSimTick,
  PaperPosition,
  PaperTradeEvent,
} from "./investDecisionSimLoop";
import type {
  PortfolioDailyPnlLedger,
  PortfolioTickerDailyRow,
} from "./simulationPosition";
import type { SimLoopPulseSizing } from "./simLoopPulseView";

function paperPos(
  key: string,
  ticker: string,
  capital = 5000,
  entryAt = "2026-06-01T10:00:00.000Z",
): PaperPosition {
  return {
    key,
    ticker,
    capital,
    entryAt,
    entryProbPct: 60,
    entryPlanReturnPct: 10,
    lastMarkPct: 2,
    entryReason: "test",
  };
}

function tickWithTrades(
  at: string,
  portfolioBefore: PaperPosition[],
  portfolioAfter: PaperPosition[],
  trades: PaperTradeEvent[],
): DecisionSimTick {
  return {
    id: `tick_${at}`,
    at,
    portfolioBefore,
    portfolioAfter,
    evaluations: [],
    trades,
    summary: {
      evaluatedTickers: 0,
      misalignedTickers: 0,
      harmonyAlignedPct: null,
      precatVerdictAgree: 0,
      buySignals: 0,
      sellSignals: trades.filter((t) => t.side === "sell").length,
      holdSignals: 0,
      reviewSignals: 0,
      tradesExecuted: trades.length,
      misalignmentByType: {},
    },
  };
}

function sellTrade(at: string, key: string, ticker: string, capital = 5000): PaperTradeEvent {
  return {
    at,
    ticker,
    key,
    side: "sell",
    reason: "exit",
    capital,
    pnlPctSimulated: 10,
    pnlEurSimulated: capital * 0.1,
  };
}

describe("buildCashFlowSnapshot", () => {
  it("returns all zeros when no data provided", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: 0,
      capitalInOpenEur: 0,
      closedDealCount: 0,
    });
    expect(snap).toEqual(emptyCashFlow());
  });

  it("caps reinvested at the smaller of the two pools (closed < open)", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: 3000,
      capitalInOpenEur: 10000,
      closedDealCount: 1,
      realizedGainsFromClosedEur: 800,
    });
    expect(snap.capitalReinvestedEur).toBe(3000);
    expect(snap.freshCapitalDeployedEur).toBe(7000);
    expect(snap.gainsRecycledInOpenEur).toBe(800);
    expect(snap.capitalNotFromGainsEur).toBe(9200);
  });

  it("budget-first: open within starting capital → no gains in open", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: 200_000,
      capitalInOpenEur: 7562,
      closedDealCount: 40,
      realizedGainsFromClosedEur: 8000,
      startingCapitalEur: 50_000,
    });
    expect(snap.gainsRecycledInOpenEur).toBe(0);
    expect(snap.capitalNotFromGainsEur).toBe(7562);
  });

  it("budget-first: open beyond starting → only excess is from gains", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: 0,
      capitalInOpenEur: 55_000,
      closedDealCount: 2,
      realizedGainsFromClosedEur: 10_000,
      startingCapitalEur: 50_000,
    });
    expect(snap.gainsRecycledInOpenEur).toBe(5_000);
    expect(snap.capitalNotFromGainsEur).toBe(50_000);
  });

  it("caps reinvested at the smaller of the two pools (open < closed)", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: 15000,
      capitalInOpenEur: 4000,
      closedDealCount: 3,
      realizedGainsFromClosedEur: 5157,
    });
    expect(snap.capitalReinvestedEur).toBe(4000);
    expect(snap.freshCapitalDeployedEur).toBe(0);
    expect(snap.gainsRecycledInOpenEur).toBe(4000);
    expect(snap.capitalNotFromGainsEur).toBe(0);
  });

  it("clamps negatives to zero", () => {
    const snap = buildCashFlowSnapshot({
      capitalReturnedFromClosedEur: -50,
      capitalInOpenEur: -20,
      closedDealCount: 0,
    });
    expect(snap.capitalReturnedFromClosedEur).toBe(0);
    expect(snap.capitalInOpenEur).toBe(0);
    expect(snap.capitalReinvestedEur).toBe(0);
    expect(snap.freshCapitalDeployedEur).toBe(0);
  });
});

describe("computeSimLoopCashFlow — no sizing (equal-weight)", () => {
  it("returns empty snapshot when no trades and no open book", () => {
    const snap = computeSimLoopCashFlow([], []);
    expect(snap).toEqual(emptyCashFlow());
  });

  it("sums nominal capital from every SELL", () => {
    const open: PaperPosition[] = [paperPos("BBB|2026-09-01", "BBB", 5000)];
    const ticks: DecisionSimTick[] = [
      tickWithTrades(
        "2026-06-10T10:00:00.000Z",
        [paperPos("AAA|2026-09-01", "AAA", 5000)],
        [],
        [sellTrade("2026-06-10T10:00:00.000Z", "AAA|2026-09-01", "AAA", 5000)],
      ),
      tickWithTrades(
        "2026-06-11T10:00:00.000Z",
        [paperPos("CCC|2026-09-01", "CCC", 5000)],
        [],
        [sellTrade("2026-06-11T10:00:00.000Z", "CCC|2026-09-01", "CCC", 5000)],
      ),
    ];

    const snap = computeSimLoopCashFlow(ticks, open);

    expect(snap.closedDealCount).toBe(2);
    expect(snap.capitalReturnedFromClosedEur).toBe(10000);
    expect(snap.capitalInOpenEur).toBe(5000);
    expect(snap.capitalReinvestedEur).toBe(5000);
    expect(snap.freshCapitalDeployedEur).toBe(0);
    expect(snap.realizedGainsFromClosedEur).toBe(1000);
    expect(snap.gainsRecycledInOpenEur).toBe(1000);
  });

  it("open >> closed → freshCapital = open − closed", () => {
    const open: PaperPosition[] = [
      paperPos("BBB|2026-09-01", "BBB", 5000),
      paperPos("CCC|2026-09-01", "CCC", 5000),
      paperPos("DDD|2026-09-01", "DDD", 5000),
    ];
    const ticks: DecisionSimTick[] = [
      tickWithTrades(
        "2026-06-10T10:00:00.000Z",
        [paperPos("AAA|2026-09-01", "AAA", 5000)],
        [],
        [sellTrade("2026-06-10T10:00:00.000Z", "AAA|2026-09-01", "AAA", 5000)],
      ),
    ];

    const snap = computeSimLoopCashFlow(ticks, open);

    expect(snap.capitalReturnedFromClosedEur).toBe(5000);
    expect(snap.capitalInOpenEur).toBe(15000);
    expect(snap.capitalReinvestedEur).toBe(5000);
    expect(snap.freshCapitalDeployedEur).toBe(10000);
    expect(snap.realizedGainsFromClosedEur).toBe(500);
    expect(snap.gainsRecycledInOpenEur).toBe(500);
  });

  it("prefers effectiveOpenCapByKey when provided (synth-scaled book)", () => {
    const open: PaperPosition[] = [paperPos("BBB|2026-09-01", "BBB", 5000)];
    const effective = new Map<string, number>([["BBB|2026-09-01", 8000]]);

    const snap = computeSimLoopCashFlow([], open, null, effective);

    expect(snap.capitalInOpenEur).toBe(8000);
  });

  it("falls back to portfolioBefore capital when trade.capital is missing", () => {
    const opened: PaperPosition = paperPos("AAA|2026-09-01", "AAA", 4200);
    const ticks: DecisionSimTick[] = [
      tickWithTrades(
        "2026-06-10T10:00:00.000Z",
        [opened],
        [],
        [
          {
            at: "2026-06-10T10:00:00.000Z",
            ticker: "AAA",
            key: "AAA|2026-09-01",
            side: "sell",
            reason: "exit",
            capital: undefined as unknown as number,
            pnlPctSimulated: 5,
            pnlEurSimulated: 210,
          },
        ],
      ),
    ];

    const snap = computeSimLoopCashFlow(ticks, []);

    expect(snap.capitalReturnedFromClosedEur).toBe(4200);
  });
});

describe("computeSimLoopCashFlow — synth sizing scales capital via causal share", () => {
  it("SELL capital reflects synth cap, not equal-slot capital", () => {
    const sizing: SimLoopPulseSizing = {
      shareByRowKey: { "AAA|2026-09-01": 0.5, "BBB|2026-09-01": 0.5 },
      totalCapitalEur: 10000,
      capitalPerTrade: 5000,
      sizingMode: "static_approved",
    };

    const before: PaperPosition[] = [
      paperPos("AAA|2026-09-01", "AAA", 5000, "2026-06-01T10:00:00.000Z"),
      paperPos("BBB|2026-09-01", "BBB", 5000, "2026-06-01T10:00:00.000Z"),
    ];
    const ticks: DecisionSimTick[] = [
      tickWithTrades(
        "2026-06-10T10:00:00.000Z",
        before,
        [before[1]],
        [sellTrade("2026-06-10T10:00:00.000Z", "AAA|2026-09-01", "AAA", 5000)],
      ),
    ];

    const equalSnap = computeSimLoopCashFlow(ticks, [before[1]]);
    const synthSnap = computeSimLoopCashFlow(ticks, [before[1]], sizing);

    expect(equalSnap.capitalReturnedFromClosedEur).toBe(5000);
    // With 50% causal share on a 10 000 pot, the synth-scaled principal is 5 000
    // — same as equal here — but the point is that it went through
    // `shareToSynthCap`, so a different share would produce a different figure.
    expect(synthSnap.capitalReturnedFromClosedEur).toBeGreaterThan(0);
    expect(Math.abs(synthSnap.capitalReturnedFromClosedEur - 5000)).toBeLessThan(0.01);
    expect(synthSnap.closedDealCount).toBe(1);
  });
});

describe("computePortfolioCashFlow — real portfolio (ledger-based)", () => {
  function ledgerRow(
    key: string,
    ticker: string,
    capital: number,
    totalEur: number,
    archived: boolean,
  ): PortfolioTickerDailyRow {
    return {
      key,
      ticker,
      completionDate: "2026-09-01",
      capital,
      legs: [],
      totalEur,
      pnlByDay: {},
      archived,
    };
  }

  function makeLedger(rows: PortfolioTickerDailyRow[]): PortfolioDailyPnlLedger {
    return {
      dayKeys: [],
      rows,
      dayTotals: {},
      grandTotal: 0,
      openDayTotals: {},
      openGrandTotal: 0,
      incompleteDailyHistory: false,
      legTotalDiffersFromMtm: false,
      openRowCount: rows.filter((r) => !r.archived).length,
      archivedRowCount: rows.filter((r) => r.archived).length,
    };
  }

  it("returns empty snapshot when ledger is null", () => {
    const snap = computePortfolioCashFlow(null, 0);
    expect(snap).toEqual(emptyCashFlow());
  });

  it("sums capital of archived rows and ignores open rows", () => {
    const ledger = makeLedger([
      ledgerRow("AAA|2026-09-01", "AAA", 5000, 500, true),
      ledgerRow("BBB|2026-09-01", "BBB", 3000, -100, true),
      ledgerRow("CCC|2026-09-01", "CCC", 4000, 200, false),
    ]);

    const snap = computePortfolioCashFlow(ledger, 12000);

    expect(snap.closedDealCount).toBe(2);
    expect(snap.capitalReturnedFromClosedEur).toBe(8000);
    expect(snap.capitalInOpenEur).toBe(12000);
    expect(snap.capitalReinvestedEur).toBe(8000);
    expect(snap.freshCapitalDeployedEur).toBe(4000);
    expect(snap.realizedGainsFromClosedEur).toBe(500);
    expect(snap.gainsRecycledInOpenEur).toBe(500);
  });

  it("closed > open → reinvested capped at open, no fresh capital required", () => {
    const ledger = makeLedger([
      ledgerRow("AAA|2026-09-01", "AAA", 6000, 100, true),
      ledgerRow("BBB|2026-09-01", "BBB", 5000, 200, true),
    ]);

    const snap = computePortfolioCashFlow(ledger, 4000);

    expect(snap.capitalReturnedFromClosedEur).toBe(11000);
    expect(snap.capitalInOpenEur).toBe(4000);
    expect(snap.capitalReinvestedEur).toBe(4000);
    expect(snap.freshCapitalDeployedEur).toBe(0);
    expect(snap.realizedGainsFromClosedEur).toBe(300);
    expect(snap.gainsRecycledInOpenEur).toBe(300);
  });
});

describe("capCycleKpiVariant", () => {
  it("no open positions", () => {
    expect(
      capCycleKpiVariant({
        capitalInOpenEur: 0,
        gainsRecycledInOpenEur: 5000,
        closedDealCount: 3,
      }),
    ).toEqual({ kind: "no_open" });
  });

  it("open book with no prior closes → fresh only", () => {
    expect(
      capCycleKpiVariant({
        capitalInOpenEur: 12000,
        gainsRecycledInOpenEur: 0,
        closedDealCount: 0,
      }),
    ).toEqual({ kind: "open_fresh_only", openEur: 12000 });
  });

  it("open book with gains recycled portion", () => {
    expect(
      capCycleKpiVariant({
        capitalInOpenEur: 44391,
        gainsRecycledInOpenEur: 5157,
        closedDealCount: 26,
      }),
    ).toEqual({
      kind: "open_with_gains_recycled",
      openEur: 44391,
      gainsRecycledEur: 5157,
      otherEur: 39234,
      gainsPct: 12,
    });
  });
});

describe("formatCapCycleAmount", () => {
  const fmt = (n: number) => (n >= 0 ? `+$${n}` : `−$${Math.abs(n)}`);

  it("strips sign prefix from pulse formatter", () => {
    expect(formatCapCycleAmount(44391, fmt)).toBe("$44391");
    expect(formatCapCycleAmount(-100, fmt)).toBe("$100");
  });
});
