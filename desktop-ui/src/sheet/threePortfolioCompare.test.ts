import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { CalibrationSnapshot } from "../calibration/calibrationTypes";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import {
  allocateEqual,
  allocateFromShares,
  computeSynthGainImpact,
  allocateRiskWeighted,
  buildThreePortfolioComparison,
  evPerEur,
  realizedReturnPerEur,
  type ComparisonDeal,
} from "./threePortfolioCompare";

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeDeal(
  ticker: string,
  winRate: number,
  payoffWinPct = 10,
  payoffLossPct = -8,
  realizedReturnPct: number | null = null,
  realizedReturnPct24h: number | null = null,
): ComparisonDeal {
  return {
    ticker,
    rowKey: `${ticker}|2030-01-01`,
    label: `${ticker} · Phase 2`,
    cells: {
      clinicalPhase: "Phase 2",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 30-50%",
    },
    sdsValue: null,
    winRate,
    rawWinRate: winRate,
    confidence: "medium",
    winRateDimension: "clinicalPhase",
    winRateN: 10,
    payoffWinPct,
    payoffLossPct,
    payoffSource: "step1",
    lossRisk: null,
    riskScore: null,
    realizedReturnPct,
    realizedReturnPct24h,
  };
}

const SNAPSHOT_EMPTY: CalibrationSnapshot = {
  computedAt: "2030-01-01T00:00:00Z",
  totalTrades: 0,
  globalPrior: 0.5,
  dimensions: {
    clinicalPhase: { dimension: "clinicalPhase", prior: 0.5, totalN: 0, hasVariance: false, cells: [] },
    clinicalIndication: { dimension: "clinicalIndication", prior: 0.5, totalN: 0, hasVariance: false, cells: [] },
    sdsBucket: { dimension: "sdsBucket", prior: 0.5, totalN: 0, hasVariance: false, cells: [] },
    pplanBucket: { dimension: "pplanBucket", prior: 0.5, totalN: 0, hasVariance: false, cells: [] },
  },
};

const SDS_BREAKDOWN_EMPTY: SdsGainBreakdown = {
  rows: [],
  computedAt: "2030-01-01T00:00:00Z",
  totalClosed: 0,
  totalOpen: 0,
  globalDeliveredAvgPnlPct: null,
  globalPromisedExpectedRoiPct: null,
};

// ── evPerEur ──────────────────────────────────────────────────────────────

describe("evPerEur", () => {
  it("returns EV fraction matching the standard formula", () => {
    const d = makeDeal("ABC", 0.6, 10, -10);
    // EV_pct = 0.6 * 10 + 0.4 * (-10) = 6 − 4 = 2 → 0.02 per €
    expect(evPerEur(d)).toBeCloseTo(0.02, 6);
  });

  it("returns 0 at break-even (50% with symmetric payoff)", () => {
    const d = makeDeal("ABC", 0.5, 10, -10);
    expect(evPerEur(d)).toBeCloseTo(0, 6);
  });

  it("is negative when win rate << 50% with symmetric payoff", () => {
    const d = makeDeal("BAD", 0.3, 10, -10);
    expect(evPerEur(d)).toBeLessThan(0);
  });

  it("scales linearly: EV(2x cap) = 2 × EV(1x cap)", () => {
    const d = makeDeal("LIN", 0.55, 12, -8);
    const ev1 = 1000 * evPerEur(d);
    const ev2 = 2000 * evPerEur(d);
    expect(ev2 / ev1).toBeCloseTo(2, 6);
  });
});

// ── realizedReturnPerEur ──────────────────────────────────────────────────

describe("realizedReturnPerEur", () => {
  it("returns realizedReturnPct/100 when the deal is held", () => {
    const d = makeDeal("HELD", 0.5, 10, -8, 4.2);
    expect(realizedReturnPerEur(d)).toBeCloseTo(0.042, 6);
  });

  it("returns 0 when realizedReturnPct is null (deal not entered anywhere)", () => {
    const d = makeDeal("NEW", 0.7, 10, -8, null);
    expect(realizedReturnPerEur(d)).toBe(0);
  });

  it("returns 0 when realizedReturnPct is non-finite", () => {
    const d = makeDeal("NAN", 0.5, 10, -8, Number.NaN);
    expect(realizedReturnPerEur(d)).toBe(0);
  });
});

// ── allocateEqual ─────────────────────────────────────────────────────────

describe("allocateEqual", () => {
  it("splits total capital evenly across all deals", () => {
    const deals = [makeDeal("A", 0.5), makeDeal("B", 0.6), makeDeal("C", 0.7)];
    const out = allocateEqual(deals, 6000);
    expect(out.capByTicker.A).toBeCloseTo(2000, 6);
    expect(out.capByTicker.B).toBeCloseTo(2000, 6);
    expect(out.capByTicker.C).toBeCloseTo(2000, 6);
    expect(out.totalCapitalEur).toBeCloseTo(6000, 6);
    expect(out.positionsCount).toBe(3);
  });

  it("returns empty allocation when no deals", () => {
    const out = allocateEqual([], 5000);
    expect(out.totalCapitalEur).toBe(0);
    expect(out.totalEvEur).toBe(0);
    expect(out.positionsCount).toBe(0);
  });

  it("returns empty allocation when capital ≤ 0", () => {
    const deals = [makeDeal("A", 0.6)];
    const out = allocateEqual(deals, 0);
    expect(out.totalCapitalEur).toBe(0);
  });

  it("sums EV across deals correctly (linearity)", () => {
    const deals = [
      makeDeal("A", 0.6, 10, -10), // ev/€ = 0.02
      makeDeal("B", 0.4, 10, -10), // ev/€ = -0.02
    ];
    const out = allocateEqual(deals, 2000);
    // Each gets 1000; EV_A = 1000*0.02 = 20, EV_B = 1000*(-0.02) = -20; sum = 0.
    expect(out.totalEvEur).toBeCloseTo(0, 6);
  });

  it("computes realized P&L per ticker from each deal's realizedReturnPct", () => {
    const deals = [
      makeDeal("UP", 0.6, 10, -10, 4), // +4% realized
      makeDeal("DN", 0.5, 10, -10, -2), // -2% realized
    ];
    const out = allocateEqual(deals, 2000);
    // Each gets 1000; realized UP = 1000*4/100 = 40, realized DN = 1000*-2/100 = -20.
    expect(out.realizedEurByTicker.UP).toBeCloseTo(40, 6);
    expect(out.realizedEurByTicker.DN).toBeCloseTo(-20, 6);
    expect(out.totalRealizedEur).toBeCloseTo(20, 6);
    expect(out.realizedPositionsCount).toBe(2);
  });

  it("attributes 0 € to deals that were never entered (realizedReturnPct=null)", () => {
    const deals = [
      makeDeal("HELD", 0.6, 10, -10, 5),
      makeDeal("FRESH", 0.7, 10, -10, null),
    ];
    const out = allocateEqual(deals, 2000);
    expect(out.realizedEurByTicker.HELD).toBeCloseTo(50, 6); // 1000 * 5%
    expect(out.realizedEurByTicker.FRESH).toBe(0);
    expect(out.totalRealizedEur).toBeCloseTo(50, 6);
    // Both have cap > 0 so positionsCount = 2, but only 1 actually contributes realized.
    expect(out.positionsCount).toBe(2);
    expect(out.realizedPositionsCount).toBe(1);
  });
});

// ── allocateRiskWeighted ──────────────────────────────────────────────────

describe("allocateRiskWeighted", () => {
  it("allocates more capital to higher win-rate deals", () => {
    const deals = [makeDeal("LOW", 0.3), makeDeal("HIGH", 0.7)];
    const out = allocateRiskWeighted(deals, 1000);
    // weights = [0.3, 0.7], sum = 1.0 → LOW gets 300, HIGH gets 700.
    expect(out.capByTicker.LOW).toBeCloseTo(300, 6);
    expect(out.capByTicker.HIGH).toBeCloseTo(700, 6);
    expect(out.totalCapitalEur).toBeCloseTo(1000, 6);
    expect(out.positionsCount).toBe(2);
  });

  it("treats negative win rate as 0 (no capital)", () => {
    const deals = [
      makeDeal("OK", 0.5),
      // Synthetic case (shouldn't happen with shrinkage, but guard anyway)
      { ...makeDeal("BAD", -0.2), winRate: -0.2 },
    ];
    const out = allocateRiskWeighted(deals, 1000);
    expect(out.capByTicker.OK).toBeCloseTo(1000, 6);
    expect(out.capByTicker.BAD).toBeCloseTo(0, 6);
  });

  it("falls back to equal split when all win rates are zero", () => {
    const deals = [
      { ...makeDeal("Z1", 0), winRate: 0 },
      { ...makeDeal("Z2", 0), winRate: 0 },
    ];
    const out = allocateRiskWeighted(deals, 1000);
    expect(out.capByTicker.Z1).toBeCloseTo(500, 6);
    expect(out.capByTicker.Z2).toBeCloseTo(500, 6);
  });

  it("preserves total capital invariant (weighted sums to capital)", () => {
    const deals = [
      makeDeal("A", 0.45),
      makeDeal("B", 0.55),
      makeDeal("C", 0.7),
      makeDeal("D", 0.35),
    ];
    const out = allocateRiskWeighted(deals, 5000);
    const sum =
      out.capByTicker.A +
      out.capByTicker.B +
      out.capByTicker.C +
      out.capByTicker.D;
    expect(sum).toBeCloseTo(5000, 4);
  });

  it("computes realized P&L with risk-weighted capital allocation", () => {
    const deals = [
      makeDeal("LOW", 0.3, 10, -10, 6), // 30% weight → 300 cap → +18 realized
      makeDeal("HIGH", 0.7, 10, -10, 4), // 70% weight → 700 cap → +28 realized
    ];
    const out = allocateRiskWeighted(deals, 1000);
    expect(out.realizedEurByTicker.LOW).toBeCloseTo(18, 6);
    expect(out.realizedEurByTicker.HIGH).toBeCloseTo(28, 6);
    expect(out.totalRealizedEur).toBeCloseTo(46, 6);
  });
});

// ── buildThreePortfolioComparison ─────────────────────────────────────────

describe("buildThreePortfolioComparison", () => {
  const simTable: SheetTable = {
    rows: [
      {
        Ticker: "ABCD",
        "Catalyst Date": "2030-06-01",
        Plan_Prob_Pct: 65,
        "Clinical Phase": "Phase 2",
        Indication: "Oncology",
      },
      {
        Ticker: "EFGH",
        "Catalyst Date": "2030-07-15",
        Plan_Prob_Pct: 30,
        "Clinical Phase": "Phase 1",
        Indication: "Neurology",
      },
    ],
  } as unknown as SheetTable;

  function openRow(ticker: string, cd: string, capEur = 800): SimOutcomeRow {
    return {
      row_key: `${ticker}|${cd}`,
      ticker,
      completion_date: cd,
      days_to_cd: 30,
      cd_passed: false,
      timing_bucket: "pre_cd",
      timing_label: "Pre-CD",
      capital_eur: capEur,
      pnl_eur: null,
      pnl_pct: null,
      outcome: "open",
      outcome_label: "Open",
      is_win: false,
      affidabilita_pct: 50,
    } as SimOutcomeRow;
  }

  const closedRows: SimOutcomeRow[] = [
    openRow("ABCD", "2030-06-01", 800),
  ];

  it("populates mine and sim loop universes", () => {
    const out = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    expect(out.mineDeals.length).toBe(1);
    expect(out.mineDeals[0].ticker).toBe("ABCD");
    expect(out.simLoopDeals.length).toBe(2);
    const tickers = new Set(out.simLoopDeals.map((d) => d.ticker));
    expect(tickers.has("ABCD")).toBe(true);
    expect(tickers.has("EFGH")).toBe(true);
  });

  it("returns the same total capital across the three scenarios", () => {
    const out = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    expect(out.mine.totalCapitalEur).toBeCloseTo(5000, 4);
    expect(out.simLoopEqual.totalCapitalEur).toBeCloseTo(5000, 4);
    expect(out.simLoopWeighted.totalCapitalEur).toBeCloseTo(5000, 4);
  });

  it("produces deterministic EV totals", () => {
    const a = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    const b = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    expect(a.mine.totalEvEur).toBe(b.mine.totalEvEur);
    expect(a.simLoopEqual.totalEvEur).toBe(b.simLoopEqual.totalEvEur);
    expect(a.simLoopWeighted.totalEvEur).toBe(b.simLoopWeighted.totalEvEur);
  });

  it("union allDeals dedupes by rowKey", () => {
    const out = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    // ABCD is in both universes — should appear once in allDeals
    const abcdCount = out.allDeals.filter((d) => d.ticker === "ABCD").length;
    expect(abcdCount).toBe(1);
    // EFGH only in sim loop
    expect(out.allDeals.some((d) => d.ticker === "EFGH")).toBe(true);
  });

  it("handles empty closedRows (no mine deals)", () => {
    const out = buildThreePortfolioComparison({
      closedRows: [],
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    expect(out.mineDeals.length).toBe(0);
    expect(out.mine.totalCapitalEur).toBe(0);
    expect(out.mine.positionsCount).toBe(0);
    // Sim loop unaffected
    expect(out.simLoopDeals.length).toBe(2);
  });

  it("handles empty simTable (no sim loop deals)", () => {
    const out = buildThreePortfolioComparison({
      closedRows,
      simTable: null,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
    });
    expect(out.simLoopDeals.length).toBe(0);
    expect(out.simLoopEqual.totalCapitalEur).toBe(0);
    expect(out.simLoopWeighted.totalCapitalEur).toBe(0);
  });

  it("includes open paper book when monitor has no BUY rows", () => {
    const out = buildThreePortfolioComparison({
      closedRows,
      simTable,
      sdsRows: null,
      calibrationSnapshot: SNAPSHOT_EMPTY,
      sdsBreakdown: SDS_BREAKDOWN_EMPTY,
      totalCapitalEur: 5000,
      paperPortfolio: [
        {
          key: "ABCD|2030-06-01",
          ticker: "ABCD",
          entryAt: "2030-05-01T00:00:00Z",
          capital: 5000,
          entryReason: "test",
          entryPlanReturnPct: 10,
          lastMarkPct: 12.5,
        },
      ],
    });
    expect(out.simLoopDeals.length).toBe(1);
    expect(out.simLoopDeals[0]?.ticker).toBe("ABCD");
    expect(out.simLoopDeals[0]?.realizedReturnPct).toBe(12.5);
    expect(out.simLoopEqual.totalCapitalEur).toBeCloseTo(5000, 4);
    expect(out.simLoopEqual.totalRealizedEur).toBeCloseTo(625, 0);
  });

  it("computeSynthGainImpact measures synth uplift vs equal baseline", () => {
    const impact = computeSynthGainImpact(680, 50_000, 2001, 50_000);
    expect(impact.baselineGainPct).toBeCloseTo(680 / 50_000, 6);
    expect(impact.synthGainPct).toBeCloseTo(2001 / 50_000, 6);
    expect(impact.deltaPnlEur).toBe(1321);
    expect(impact.deltaGainPp).toBeCloseTo(((2001 - 680) / 50_000) * 100, 4);
    expect(impact.relativeGainUpliftPct).toBeCloseTo((1321 / 680) * 100, 2);
  });

  it("allocateFromShares normalises arbitrary rowKey shares", () => {
    const deals = [
      makeDeal("AAA", 0.7, 10, -8, 5),
      makeDeal("BBB", 0.6, 8, -6, 2),
    ];
    const out = allocateFromShares(deals, 10_000, {
      [deals[0]!.rowKey]: 3,
      [deals[1]!.rowKey]: 1,
    });
    expect(out.totalCapitalEur).toBeCloseTo(10_000, 4);
    expect(out.capByTicker.AAA).toBeCloseTo(7500, 0);
    expect(out.capByTicker.BBB).toBeCloseTo(2500, 0);
  });
});
