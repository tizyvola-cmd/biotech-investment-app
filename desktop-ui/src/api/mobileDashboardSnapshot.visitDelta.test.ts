import { describe, expect, it } from "vitest";
import { buildMobileDashboardSnapshot } from "./mobileDashboardSnapshot";
import type { DashboardVisitSnapshot } from "../sheet/dashboardVisitSnapshot";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { SheetTable } from "../types";

describe("mobile open-position Δ since visit", () => {
  const row = {
    Ticker: "MSLE",
    "Completion Date": "30/08/2026",
    "Prezzo Corrente ($)": 10.03,
    "Var. Giorn. %": -0.4,
    "Capitale Investito ($)": 5000,
  };
  const simTable: SheetTable = {
    sheet: "Simulation",
    rows: [row],
    columns: [],
  };
  const inputs: InvestSimInputs = {
    "MSLE|2026-08-30": {
      buyPrice: 8.98,
      capital: 5000,
      ignoreSheet: false,
      investedAt: "2026-07-09T11:20:44.422Z",
    },
  };
  const prior: DashboardVisitSnapshot = {
    savedAt: "2026-08-10T10:00:00.000Z",
    portfolioPnlEur: 400,
    tickers: {
      "MSLE|2026-08-30": {
        pnlEur: 400,
        pnlPct: 8,
        pnlEur24h: -10,
        price: 9.7,
        miiAngle: null,
      },
    },
  };

  it("uses frozen visit baseline — not a storage overwrite at current MTM", () => {
    const snap = buildMobileDashboardSnapshot({
      simTable,
      inputs,
      history: [],
      chartBundle: null,
      probOptions: null,
      portfolioRows: [],
      opportunityRows: [],
      totalCapital: 5000,
      aiFeed: [],
      aiFeedRecentCount: 0,
      lang: "en",
      priorVisitSnapshot: prior,
    });
    const open = snap.openPositions.find((p) => p.key === "MSLE|2026-08-30");
    expect(open).toBeTruthy();
    expect(open!.pnlEur).toBeGreaterThan(500);
    // Live MTM (~585) − prior 400 → non-zero Δ (would be 0 if prior were live).
    expect(open!.deltaPnlEurSinceVisit).not.toBeNull();
    expect(open!.deltaPnlEurSinceVisit!).toBeGreaterThan(100);
  });

  it("omits Δ when frozen baseline is null", () => {
    const snap = buildMobileDashboardSnapshot({
      simTable,
      inputs,
      history: [],
      chartBundle: null,
      probOptions: null,
      portfolioRows: [],
      opportunityRows: [],
      totalCapital: 5000,
      aiFeed: [],
      aiFeedRecentCount: 0,
      lang: "en",
      priorVisitSnapshot: null,
    });
    const open = snap.openPositions.find((p) => p.key === "MSLE|2026-08-30");
    expect(open?.deltaPnlEurSinceVisit ?? null).toBeNull();
  });
});
