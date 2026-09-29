import { describe, expect, it } from "vitest";
import {
  buildScoreValidationExport,
  extractPPlanFromSimRow,
  extractSlopesFromSimRow,
  extractSuggestedActionFromSimRow,
  resolveExportSuggestedAction,
} from "./scoreValidationExport";

describe("scoreValidationExport helpers", () => {
  it("reads P(plan) from Affidabilità column (decimal 0–1)", () => {
    const p = extractPPlanFromSimRow({
      "Affidabilità\n%": 0.72,
    });
    expect(p).toBe(72);
  });

  it("reads P(plan) from Plan_Prob_Pct and affid_live", () => {
    expect(extractPPlanFromSimRow({ Plan_Prob_Pct: 65 })).toBe(65);
    expect(extractPPlanFromSimRow({ affid_live: 58 })).toBe(58);
  });

  it("falls back to saved entryProbPct on inputs", () => {
    expect(
      extractPPlanFromSimRow(undefined, { buyPrice: 10, capital: 1000, entryProbPct: 61 }),
    ).toBe(61);
  });

  it("reads slopes via extractCurveInputs column names", () => {
    const s = extractSlopesFromSimRow({
      "slope≈5g": 0.12,
      "slope≈20g": -0.04,
    });
    expect(s.slope5d).toBeCloseTo(0.12, 2);
    expect(s.slope20d).toBeCloseTo(-0.04, 2);
  });

  it("reads suggested action from sim row", () => {
    expect(extractSuggestedActionFromSimRow({ suggestedAction: "BUY" })).toBe("buy");
    expect(extractSuggestedActionFromSimRow({ "Suggested Action": "hold" })).toBe("hold");
  });
});

describe("buildScoreValidationExport", () => {
  const key = "MLTX|2026-09-28";
  const row = {
    Ticker: "MLTX",
    "Completion Date": "28/09/2026",
    "Prezzo Corrente ($)": 19,
    "Prezzo Acquisto ($)": 18.51,
    "Var. Giorn. %": 0.5,
    "Capitale Investito ($)": 5000,
    "Affidabilità\n%": 0.72,
    "slope≈5g": 0.11,
    "slope≈20g": 0.05,
    suggestedAction: "hold",
  };
  const inputs = {
    [key]: {
      buyPrice: 18.51,
      capital: 5000,
      ignoreSheet: false,
      investedAt: "2026-06-01T10:00:00.000Z",
    },
  };
  const history = [
    {
      ts: "2026-06-16T16:00:00.000Z",
      capital: 5000,
      value: 5120,
      pnl: 120,
      pnlPct: 2.4,
      byTicker: { [key]: { value: 5120, pnl: 120, pnlPct: 2.4 } },
    },
  ];

  it("populates P(plan), composite, slopes, and suggested action on day rows", () => {
    const exp = buildScoreValidationExport({
      simTable: { sheet: "Simulation", rows: [row], columns: [] },
      inputs,
      history,
    });
    expect(exp.dayRows.length).toBeGreaterThan(0);
    const day = exp.dayRows.find((d) => d.ticker === "MLTX" && d.pPlan != null);
    expect(day?.pPlan).toBe(72);
    expect(day?.slope5d).toBeCloseTo(0.11, 2);
    expect(day?.slope20d).toBeCloseTo(0.05, 2);
    expect(["buy", "sell", "hold", "review"]).toContain(day?.suggestedAction);
    expect(day?.compositeScore).not.toBeNull();
    expect(day?.compositeZone).toBeTruthy();
  });

  it("derives suggested action for rows with price vs entry", () => {
    const exp = buildScoreValidationExport({
      simTable: { sheet: "Simulation", rows: [row], columns: [] },
      inputs,
      history,
    });
    const withAction = exp.dayRows.filter(
      (d) => d.ticker === "MLTX" && d.priceVsEntryPct != null && d.suggestedAction != null,
    );
    expect(withAction.length).toBeGreaterThan(0);
  });

  it("resolveExportSuggestedAction returns a recommendation for loss days", () => {
    const action = resolveExportSuggestedAction(
      key,
      "closed",
      -8,
      5000,
      new Map(),
      row,
    );
    expect(["sell", "hold", "review"]).toContain(action);
  });

  it("suggested action on closed rows when sheet buy price exists", () => {
    const closedKey = "PTGX|2026-06-30";
    const closedRow = {
      Ticker: "PTGX",
      "Completion Date": "30/06/2026",
      "Prezzo Acquisto ($)": 110.72,
      "Prezzo Corrente ($)": 115,
      "Var. Giorn. %": 0.3,
      "Affidabilità\n%": 0.55,
    };
    const closedInputs = {
      [closedKey]: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-06-20T10:00:00.000Z",
        closedCapital: 5000,
        closedValue: 5200,
        closedPnlEur: 200,
      },
    };
    const closedHist = [
      {
        ts: "2026-06-15T16:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: { [closedKey]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const exp = buildScoreValidationExport({
      simTable: { sheet: "Simulation", rows: [closedRow], columns: [] },
      inputs: closedInputs,
      history: closedHist,
    });
    const withAction = exp.dayRows.filter(
      (d) => d.ticker === "PTGX" && d.suggestedAction != null && d.priceVsEntryPct != null,
    );
    expect(withAction.length).toBeGreaterThan(0);
  });

  it("leaves max drawdown/gain empty when entry price is missing", () => {
    const closedKey = "CHRS|2026-06-30";
    const closedRow = {
      Ticker: "CHRS",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 1.2,
      "Var. Giorn. %": -1,
    };
    const closedInputs = {
      [closedKey]: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-06-20T10:00:00.000Z",
        closedCapital: 3000,
        closedPnlEur: -50,
      },
    };
    const closedHist = [
      {
        ts: "2026-06-15T16:00:00.000Z",
        capital: 3000,
        value: 2950,
        pnl: -50,
        pnlPct: -1.67,
        byTicker: { [closedKey]: { value: 2950, pnl: -50, pnlPct: -1.67 } },
      },
    ];
    const exp = buildScoreValidationExport({
      simTable: { sheet: "Simulation", rows: [closedRow], columns: [] },
      inputs: closedInputs,
      history: closedHist,
    });
    const outcome = exp.outcomeRows.find((r) => r.ticker === "CHRS");
    expect(outcome?.entryPriceUsd).toBeNull();
    expect(outcome?.maxDrawdownPct).toBeNull();
    expect(outcome?.maxGainPct).toBeNull();
    expect(outcome?.finalPnlPct).toBeNull();
  });
});
