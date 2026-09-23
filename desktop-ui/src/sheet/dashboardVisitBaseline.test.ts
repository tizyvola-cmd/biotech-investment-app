import { describe, expect, it } from "vitest";
import {
  buildDashboardPulseData,
  buildSyntheticDayVisitBaseline,
  captureDashboardVisitBaseline,
} from "./dashboardPulseView";
import type { DashboardVisitSnapshot } from "./dashboardVisitSnapshot";
import type { InvestSimInputs } from "./investSimStorage";
import type { SheetTable } from "../types";

describe("dashboard visit baseline / Δ visit", () => {
  it("keeps Δ visit vs a frozen prior even if storage would match live PnL", () => {
    const key = "AAA|2026-09-01";
    const row = {
      Ticker: "AAA",
      "Completion Date": "2026-09-01",
      "Prezzo Corrente ($)": 11,
      "Var. Giorn. %": 2,
    };
    const simTable = {
      sheet: "Simulation",
      rows: [row],
      columns: [],
    } as unknown as SheetTable;
    const inputs: InvestSimInputs = {
      [key]: {
        buyPrice: 10,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-06-01T10:00:00.000Z",
      },
    };
    const prior: DashboardVisitSnapshot = {
      savedAt: "2026-06-18T08:00:00.000Z",
      portfolioPnlEur: 200,
      tickers: {
        [key]: {
          pnlEur: 200,
          pnlPct: 4,
          pnlEur24h: 50,
          price: 10.4,
          miiAngle: null,
        },
      },
    };

    const data = buildDashboardPulseData({
      simTable,
      inputs,
      history: [],
      chartPointsByKey: new Map(),
      sdsByTicker: new Map(),
      migByKey: new Map(),
      priorSnapshot: prior,
      lang: "en",
    });

    expect(data.hasPriorVisit).toBe(true);
    expect(data.portfolioRows).toHaveLength(1);
    // Live open MTM ≈ (11/10−1)*5000 = +500 vs prior +200 → Δ ≈ +300
    expect(data.portfolioRows[0]?.pnlEur).toBeCloseTo(500, 0);
    expect(data.portfolioRows[0]?.deltaPnlEurSinceVisit).toBeCloseTo(300, 0);
    expect(data.deltaPortfolioPnlSinceVisit).toBeCloseTo(300, 0);
  });

  it("captureDashboardVisitBaseline drops contaminated priors without tickers", () => {
    const kept = captureDashboardVisitBaseline(
      {
        savedAt: "2026-06-18T08:00:00.000Z",
        portfolioPnlEur: 650,
        tickers: {},
      },
      {
        pnlEur: 706,
        pnlPct: 5,
        pnlEurToday: 397,
        pnlPctToday: 3,
        priorLegEur: 0,
        anyHistoryContaminated: false,
        anyHistoryUncertainContamination: false,
        priorLegIsImplicitEstimate: false,
        capital: 10_000,
        valueNow: 10_706,
        todayCovered: 6,
        todayTotal: 6,
        closedPnlEur: 0,
        closedCount: 0,
      },
    );
    expect(kept).not.toBeNull();

    const dropped = captureDashboardVisitBaseline(
      {
        savedAt: "2026-06-18T08:00:00.000Z",
        portfolioPnlEur: 1480,
        tickers: {},
      },
      {
        pnlEur: 706,
        pnlPct: 5,
        pnlEurToday: 397,
        pnlPctToday: 3,
        priorLegEur: 0,
        anyHistoryContaminated: false,
        anyHistoryUncertainContamination: false,
        priorLegIsImplicitEstimate: false,
        capital: 10_000,
        valueNow: 10_706,
        todayCovered: 6,
        todayTotal: 6,
        closedPnlEur: 0,
        closedCount: 0,
      },
    );
    expect(dropped).toBeNull();
  });

  it("keeps per-ticker priors when portfolio total looks contaminated", () => {
    const key = "AAA|2026-09-01";
    const prior: DashboardVisitSnapshot = {
      savedAt: "2026-06-18T08:00:00.000Z",
      portfolioPnlEur: 1480,
      tickers: {
        [key]: {
          pnlEur: 200,
          pnlPct: 4,
          pnlEur24h: 50,
          price: 10.4,
          miiAngle: null,
        },
      },
    };
    const recovered = captureDashboardVisitBaseline(prior, {
      pnlEur: 706,
      pnlPct: 5,
      pnlEurToday: 397,
      pnlPctToday: 3,
      priorLegEur: 0,
      anyHistoryContaminated: false,
      anyHistoryUncertainContamination: false,
      priorLegIsImplicitEstimate: false,
      capital: 10_000,
      valueNow: 10_706,
      todayCovered: 6,
      todayTotal: 6,
      closedPnlEur: 0,
      closedCount: 0,
    });
    expect(recovered).not.toBeNull();
    expect(recovered!.tickers[key]?.pnlEur).toBe(200);
    // Portfolio anchor rebased — aggregate KPI not a bogus −774€ swing.
    expect(recovered!.portfolioPnlEur).toBe(706);
  });

  it("synthetic day baseline makes Δ visit ≈ 24h (not locked at +€0)", () => {
    const key = "AAA|2026-09-01";
    const row = {
      Ticker: "AAA",
      "Completion Date": "2026-09-01",
      "Prezzo Corrente ($)": 11,
      "Var. Giorn. %": 2,
    };
    const simTable = {
      sheet: "Simulation",
      rows: [row],
      columns: [],
    } as unknown as SheetTable;
    const inputs: InvestSimInputs = {
      [key]: {
        buyPrice: 10,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-06-01T10:00:00.000Z",
      },
    };
    const synthetic = buildSyntheticDayVisitBaseline({
      simTable,
      inputs,
      history: [],
      migByKey: new Map(),
    });
    const data = buildDashboardPulseData({
      simTable,
      inputs,
      history: [],
      chartPointsByKey: new Map(),
      sdsByTicker: new Map(),
      migByKey: new Map(),
      priorSnapshot: synthetic,
      lang: "en",
    });
    expect(data.portfolioRows).toHaveLength(1);
    const r = data.portfolioRows[0]!;
    // Freezing live MTM would force Δ=0; synthetic prior close → Δ ≈ session 24h.
    expect(r.pnlEur24h).not.toBeNull();
    expect(Math.abs(r.pnlEur24h ?? 0)).toBeGreaterThan(50);
    expect(r.deltaPnlEurSinceVisit).toBeCloseTo(r.pnlEur24h ?? 0, 0);
  });
});
