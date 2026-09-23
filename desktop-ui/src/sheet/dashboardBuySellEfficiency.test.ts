import { describe, expect, it } from "vitest";
import {
  buildDashboardSellEfficiency,
  dashboardBuyEfficiencyDisplay,
  nyseDayKeyFromIso,
} from "./dashboardBuySellEfficiency";
import { lastUsEquityCloseSessionKey } from "./marketSession";
import type { InvestSimInputs } from "./investSimStorage";
import type { SheetTable } from "../types";

describe("dashboardBuySellEfficiency", () => {
  it("nyseDayKeyFromIso parses ISO to a YYYY-MM-DD key", () => {
    const k = nyseDayKeyFromIso("2026-08-07T20:30:00.000Z");
    expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sell efficiency counts post-exit drops as saved", () => {
    const session = lastUsEquityCloseSessionKey(new Date("2026-08-08T18:00:00-04:00"));
    const soldAt = `${session}T18:00:00.000Z`;
    const inputs: InvestSimInputs = {
      "SAVE|2026-10-01": {
        buyPrice: 10,
        capital: 0,
        ignoreSheet: true,
        soldAt,
        closedCapital: 1000,
        closedValue: 1000,
        closedPnlEur: 0,
      },
      "DROP|2026-10-01": {
        buyPrice: 10,
        capital: 0,
        ignoreSheet: true,
        soldAt,
        closedCapital: 2000,
        closedValue: 2000,
        closedPnlEur: 0,
      },
    };
    const simTable: SheetTable = {
      sheet: "Simulation",
      columns: ["Ticker", "Completion Date", "Prezzo Corrente ($)", "Var. Giorn. %"],
      rows: [
        {
          Ticker: "SAVE",
          "Completion Date": "2026-10-01",
          "Prezzo Corrente ($)": 9, // −10% after exit
          "Var. Giorn. %": -10,
        },
        {
          Ticker: "DROP",
          "Completion Date": "2026-10-01",
          "Prezzo Corrente ($)": 11, // +10% — sell was wrong
          "Var. Giorn. %": 10,
        },
      ],
    };
    const kpi = buildDashboardSellEfficiency({
      simTable,
      inputs,
      lang: "en",
      now: new Date("2026-08-08T18:00:00-04:00"),
    });
    expect(kpi.scoredCount).toBe(2);
    expect(kpi.savedCount).toBe(1);
    expect(kpi.efficiencyPct).toBe(50);
    expect(kpi.avoidedLossEur).toBeGreaterThan(0);
  });

  it("buy display shows % and $", () => {
    const d = dashboardBuyEfficiencyDisplay(
      {
        sessionKey: "2026-08-07",
        sessionLabel: "Fri, Aug 7",
        pnlEur: 511,
        pnlPct: 1.2,
        capitalEur: 42_000,
        covered: 10,
        total: 10,
      },
      "en",
    );
    expect(d.value).toContain("1.2%");
    expect(d.sub).toMatch(/\$511|\$0\.5k|\+\$511/);
    expect(d.accent).toBe("up");
  });
});
