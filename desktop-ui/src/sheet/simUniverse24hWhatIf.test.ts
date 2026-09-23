import { describe, expect, it } from "vitest";
import type { SheetTable } from "../types";
import {
  buildSimUniverse24hWhatIf,
  buildWhatIfHourlyPnlSeries,
  buildWindHourlyPctSeries,
  computeWhatIfCurveStats,
  filterWhatIfRowsByBook,
  isWhatIfPortfolioStrongHit,
  isWhatIf24hGainer,
  isWhatIfStrongFaded,
  isWhatIfStrongNow,
  isWhatIfStrongWindContinuation,
  resolveWhatIfPriceBaselines,
  whatIfLastHourlyValues,
  whatIfPerformanceColor,
  whatIfSparklinePath,
  SIM_UNIVERSE_WHATIF_CAPITAL,
  simUniverseWhatIfTopBars,
} from "./simUniverse24hWhatIf";

function table(rows: Record<string, unknown>[]): SheetTable {
  return { name: "Simulation", headers: [], rows };
}

describe("buildSimUniverse24hWhatIf", () => {
  it("splits portfolio vs all and reports capture of upside", () => {
    const sim = table([
      {
        Ticker: "AAA",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": 2,
        Company: "Alpha",
      },
      {
        Ticker: "BBB",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": 4,
        Company: "Beta",
      },
      {
        Ticker: "CCC",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": -1,
        Company: "Gamma",
      },
    ]);
    const inputs = {
      "AAA|2026-09-01": { capital: 1000, buyPrice: 10 },
    };
    const w = buildSimUniverse24hWhatIf(sim, inputs);
    expect(w).not.toBeNull();
    expect(w!.capitalPerTicker).toBe(SIM_UNIVERSE_WHATIF_CAPITAL);
    expect(w!.all.n).toBe(3);
    expect(w!.all.nUp24h).toBe(2);
    expect(w!.offPortfolio.nUp24h).toBe(1);
    expect(w!.portfolio.nWith24h).toBe(1);
    expect(w!.offPortfolio.nWith24h).toBe(2);
    expect(w!.all.pnlEur).toBe(250);
    expect(w!.all.upsideEur).toBe(300);
    expect(w!.portfolio.upsideEur).toBe(100);
    expect(w!.missedUpsideEur).toBe(200);
    expect(w!.capturePct).toBeCloseTo(33.3, 0);
  });

  it("keeps Simulation names even without Var. Giorn. %", () => {
    const sim = table([
      { Ticker: "AAA", "Completion Date": "2026-09-01", "Var. Giorn. %": 2 },
      { Ticker: "DDD", "Completion Date": "2026-09-01" },
    ]);
    const w = buildSimUniverse24hWhatIf(sim, {});
    expect(w!.all.n).toBe(2);
    expect(w!.all.nWith24h).toBe(1);
    expect(w!.rows.find((r) => r.ticker === "DDD")?.pnlEur).toBeNull();
  });

  it("skips Simulation footer rows (pool M2 metrics prose)", () => {
    const sim = table([
      { Ticker: "AAA", "Completion Date": "2026-09-01", "Var. Giorn. %": 2 },
      {
        Ticker:
          "Metriche **pool M2** (valori **identici** su ogni riga del run; aggregati su predizioni",
        "Completion Date": "",
        "Var. Giorn. %": 0,
      },
    ]);
    const w = buildSimUniverse24hWhatIf(sim, {});
    expect(w!.all.n).toBe(1);
    expect(w!.rows.map((r) => r.ticker)).toEqual(["AAA"]);
  });

  it("detects 24h gainers for off-book filter", () => {
    expect(isWhatIf24hGainer({ dailyPct24h: 0.1 })).toBe(true);
    expect(isWhatIf24hGainer({ dailyPct24h: 0 })).toBe(false);
    expect(isWhatIf24hGainer({ dailyPct24h: -0.2 })).toBe(false);
    expect(isWhatIf24hGainer({ dailyPct24h: null })).toBe(false);
  });

  it("reads exhaustion edge from cont_sell_edge", () => {
    const sim = table([
      {
        Ticker: "AAA",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": 1,
        cont_sell_edge: 3.4,
      },
      {
        Ticker: "BBB",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": 1,
        p_continuation: 40,
        cont_p_base: 48,
      },
    ]);
    const w = buildSimUniverse24hWhatIf(sim, {});
    expect(w!.rows.find((r) => r.ticker === "AAA")?.exhaustEdge).toBe(3.4);
    expect(w!.rows.find((r) => r.ticker === "BBB")?.exhaustEdge).toBe(-8);
  });

  it("ranks top bars by absolute P&L", () => {
    const rows = [
      { key: "a", ticker: "A", company: null, dailyPct24h: 1, pnlEur: 50, inPortfolio: true, exhaustEdge: -1 },
      { key: "b", ticker: "B", company: null, dailyPct24h: -3, pnlEur: -150, inPortfolio: false, exhaustEdge: 2.5 },
      { key: "c", ticker: "C", company: null, dailyPct24h: 2, pnlEur: 100, inPortfolio: false, exhaustEdge: null },
    ];
    const top = simUniverseWhatIfTopBars(rows, 2);
    expect(top.map((r) => r.ticker)).toEqual(["B", "C"]);
  });

  it("builds hourly % curves (not equal-weight €)", () => {
    const { chartRows, tickersWithData } = buildWindHourlyPctSeries(
      ["AAA", "BBB"],
      {
        AAA: [
          { t: "2026-07-22T14:00:00Z", price: 100 },
          { t: "2026-07-22T15:00:00Z", price: 102 },
        ],
        BBB: [
          { t: "2026-07-22T14:00:00Z", price: 50 },
          { t: "2026-07-22T15:00:00Z", price: 45 },
        ],
      },
    );
    expect(tickersWithData).toEqual(["AAA", "BBB"]);
    expect(chartRows.length).toBe(2);
    expect(chartRows[0]!.AAA).toBe(0);
    expect(chartRows[1]!.AAA).toBe(2);
    expect(chartRows[1]!.BBB).toBe(-10);
  });

  it("uses previous close baseline so gap-down+bounce matches Var. Giorn. sign", () => {
    // Prev close 10 → open 8 (−20%) → bounce to 9.4 (−6% vs prev close, +17.5% vs open).
    const live = {
      BJDX: [
        { t: "2026-07-22T15:00:00Z", price: 8 },
        { t: "2026-07-22T20:00:00Z", price: 9.4 },
      ],
    };
    const baselines = resolveWhatIfPriceBaselines(["BJDX"], live, {
      prevCloseByTicker: { BJDX: 10 },
    });
    expect(baselines.BJDX).toBe(10);
    const openBase = buildWhatIfHourlyPnlSeries(["BJDX"], live, 5000);
    const prevBase = buildWhatIfHourlyPnlSeries(["BJDX"], live, 5000, baselines);
    // Session-open baseline wrongly paints a strong green day.
    expect(openBase.chartRows.at(-1)!.BJDX).toBeGreaterThan(0);
    // Previous-close baseline stays red — same direction as Var. Giorn. −6%.
    expect(prevBase.chartRows.at(-1)!.BJDX).toBeCloseTo(5000 * (9.4 / 10 - 1), 5);
    expect(prevBase.chartRows.at(-1)!.BJDX).toBeLessThan(0);
  });

  it("filters book scopes", () => {
    const rows = [
      { key: "a", ticker: "A", company: null, dailyPct24h: 1, pnlEur: 50, inPortfolio: true },
      { key: "b", ticker: "B", company: null, dailyPct24h: 1, pnlEur: 50, inPortfolio: false },
    ];
    expect(filterWhatIfRowsByBook(rows, "portfolio")).toHaveLength(1);
    expect(filterWhatIfRowsByBook(rows, "off")).toHaveLength(1);
    expect(filterWhatIfRowsByBook(rows, "all")).toHaveLength(2);
  });

  it("crown hit = Strong ∩ portfolio only", () => {
    expect(isWhatIfPortfolioStrongHit(true, true)).toBe(true);
    expect(isWhatIfPortfolioStrongHit(true, false)).toBe(false);
    expect(isWhatIfPortfolioStrongHit(false, true)).toBe(false);
    expect(isWhatIfPortfolioStrongHit(false, false)).toBe(false);
  });

  it("Strong-now demotes path Strong when sheet day is red", () => {
    expect(isWhatIfStrongNow(true, 0.8)).toBe(true);
    expect(isWhatIfStrongNow(true, 0)).toBe(true);
    expect(isWhatIfStrongNow(true, -0.1)).toBe(false);
    expect(isWhatIfStrongNow(true, null)).toBe(true);
    expect(isWhatIfStrongNow(false, 2)).toBe(false);
    expect(isWhatIfStrongFaded(true, -3)).toBe(true);
    expect(isWhatIfStrongFaded(true, 1)).toBe(false);
    expect(isWhatIfStrongFaded(false, -3)).toBe(false);
  });

  it("strong-wind continuation: 10d≥5% · P(cont)≥50 · day not red · edge≤0", () => {
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 7.9,
        pCont: 63,
        dailyPct24h: 0.7,
        exhaustEdge: -1,
      }),
    ).toBe(true);
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 4.9,
        pCont: null,
        dailyPct24h: 15.9,
        exhaustEdge: -1,
      }),
    ).toBe(true);
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 3,
        pCont: 64,
        dailyPct24h: 1,
      }),
    ).toBe(false);
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 8,
        pCont: 45,
        dailyPct24h: 1,
      }),
    ).toBe(false);
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 8,
        pCont: 60,
        dailyPct24h: -0.5,
      }),
    ).toBe(false);
    expect(
      isWhatIfStrongWindContinuation({
        contG10: 8,
        pCont: 60,
        dailyPct24h: 1,
        exhaustEdge: 1.2,
      }),
    ).toBe(false);
  });

  it("flags continuous risers as strong; rejects chop and spike→dump", () => {
    const rows = [
      { hour: "10:00", ts: "t0", UP: 0, CHOP: 0, SPIKE: 0, FLAT: 0 },
      { hour: "11:00", ts: "t1", UP: 80, CHOP: 300, SPIKE: 400, FLAT: 10 },
      { hour: "12:00", ts: "t2", UP: 200, CHOP: -50, SPIKE: 650, FLAT: 20 },
      { hour: "13:00", ts: "t3", UP: 400, CHOP: 280, SPIKE: 500, FLAT: 15 },
      { hour: "14:00", ts: "t4", UP: 500, CHOP: 20, SPIKE: 280, FLAT: 5 },
    ];
    const stats = computeWhatIfCurveStats(rows, ["UP", "CHOP", "SPIKE", "FLAT"]);
    expect(stats.get("UP")?.strong).toBe(true);
    expect(stats.get("UP")?.oscillating).toBe(false);
    expect(stats.get("CHOP")?.oscillating).toBe(true);
    expect(stats.get("CHOP")?.strong).toBe(false);
    // Ends green but gave back most of the peak → not continuous.
    expect(stats.get("SPIKE")?.strong).toBe(false);
    // Tiny end P&L → below strong floor.
    expect(stats.get("FLAT")?.strong).toBe(false);
  });

  it("maps performance colors blue→yellow→red", () => {
    const blue = whatIfPerformanceColor(-100, -100, 400);
    const mid = whatIfPerformanceColor(150, -100, 400);
    const red = whatIfPerformanceColor(400, -100, 400);
    expect(blue).toMatch(/^rgb\(/);
    expect(red).toMatch(/^rgb\(/);
    // Red channel should be higher on strong than on weak.
    const blueR = Number(blue.match(/rgb\((\d+)/)?.[1]);
    const redR = Number(red.match(/rgb\((\d+)/)?.[1]);
    expect(redR).toBeGreaterThan(blueR);
    void mid;
  });

  it("extracts last N hourly values and builds a sparkline path", () => {
    const rows = [
      { hour: "10:00", ts: "t0", AAA: 0 },
      { hour: "11:00", ts: "t1", AAA: 10 },
      { hour: "12:00", ts: "t2", AAA: 20 },
      { hour: "13:00", ts: "t3", AAA: 30 },
      { hour: "14:00", ts: "t4", AAA: 40 },
      { hour: "15:00", ts: "t5", AAA: 50 },
      { hour: "16:00", ts: "t6", AAA: 60 },
      { hour: "17:00", ts: "t7", AAA: 70 },
    ];
    const last = whatIfLastHourlyValues(rows, "AAA", 7);
    expect(last).toEqual([10, 20, 30, 40, 50, 60, 70]);
    const path = whatIfSparklinePath(last, 80, 18);
    expect(path).toMatch(/^M/);
    expect(path).toContain("L");
  });
});
