import { describe, expect, it } from "vitest";
import {
  buildAdviceSuccessAuditExport,
  buildAdviceSuccessAuditSpreadsheetXml,
  parseAdviceSuccessFreezeKey,
} from "./adviceSuccessAuditExport";
import type { SheetTable } from "../types";

describe("parseAdviceSuccessFreezeKey", () => {
  it("parses ticker price and daily var segments", () => {
    const key = "it|9|VIR:12.5:-6.0|LTRN:4.2:-2.3";
    expect(parseAdviceSuccessFreezeKey(key)).toEqual([
      { ticker: "VIR", price: "12.5", dailyVarPct: "-6.0" },
      { ticker: "LTRN", price: "4.2", dailyVarPct: "-2.3" },
    ]);
  });
});

describe("buildAdviceSuccessAuditSpreadsheetXml", () => {
  it("includes summary and monitor worksheets", () => {
    const simTable: SheetTable = {
      row_count: 1,
      rows: [
        {
          Ticker: "VIR",
          "Prezzo Corrente ($)": "12.5",
          "Var. Giorn. %": "-1.2",
        },
      ],
    };
    const exp = buildAdviceSuccessAuditExport({
      lang: "it",
      simTable,
      monitorRows: [],
      decisionSimState: {
        paperPortfolio: [],
        scorecard: {
          advicePrecisionPct: 95.9,
          goodBuyCount: 1,
          goodSellCount: 0,
          badBuyCount: 0,
          badSellCount: 0,
        },
      } as never,
      portfolioSuccessBridge: {
        closed: {
          winRatePct: 71.4,
          winCount: 5,
          lossCount: 2,
          sampleSize: 7,
          lowSample: true,
          expectancyEurPerTrade: null,
          realizedDailyPnlEur: null,
        },
        today: null,
      },
      portfolioMtmEur: -904,
    });
    const xml = buildAdviceSuccessAuditSpreadsheetXml(exp, "it");
    expect(xml).toContain("Riepilogo");
    expect(xml).toContain("Monitor");
    expect(xml).toContain("Prezzi_freeze");
    expect(exp.freezeTickers).toHaveLength(1);
  });
});
