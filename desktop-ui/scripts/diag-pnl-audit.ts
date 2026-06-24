/**
 * Internal P&L audit — run: npx tsx scripts/diag-pnl-audit.ts
 * Paste output into PNL_BUG_AUDIT_REPORT.md appendix.
 */
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  computeSimulationPosition,
  positionPnlForOpenRow,
  resolvePositionPnlBreakdown,
} from "../src/sheet/simulationPosition";

const key = "RYTM|2026-09-15";
const row = {
  Ticker: "RYTM",
  "Completion Date": "15/09/2026",
  "Prezzo Corrente ($)": 94.5,
  "Prezzo Acquisto ($)": 90,
  "Var. Giorn. %": 0.42,
  "Valore Attuale ($)": 34_750,
  "P&L (%)": 178,
  "Capitale Investito ($)": 12_500,
};
const inputs = {
  [key]: {
    buyPrice: 90,
    capital: 12_500,
    ignoreSheet: false,
    investedAt: "2026-06-12T07:11:18.665Z",
  },
};
const simTable = { sheet: "Simulation", rows: [row], columns: [] };

function run(label: string, history: Parameters<typeof aggregateOpenPortfolioPnl>[2]) {
  const pos = computeSimulationPosition(row, inputs, { history: history ?? [] })!;
  const b = resolvePositionPnlBreakdown(
    pos,
    row,
    inputs[key].investedAt,
    history ?? [],
    inputs,
  );
  const chips = buildDashboardPortfolioChips(simTable, inputs, history ?? []);
  const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
  console.log(`\n=== ${label} ===`);
  console.log("computeSimulationPosition pnlEur:", pos.pnlEur, "pnlPct:", pos.pnlPct);
  console.log("breakdown totalEur:", b.totalEur, "priorLeg:", b.priorLegEur, "today:", b.pnlEurToday, "priorCloseCount:", b.priorCloseCount);
  console.log("chips pnlEur:", chips[0]?.pnlEur, "pnlPct:", chips[0]?.pnlPct);
  console.log("aggregate totals pnlEur:", totals.pnlEur);
  const m = positionPnlForOpenRow(row, inputs, history ?? []);
  console.log("positionPnlForOpenRow pnlEur:", m.pnlEur);
}

run("single contaminated snapshot", [
  {
    ts: "2026-06-17T16:00:00.000Z",
    capital: 12_500,
    value: 34_750,
    pnl: 22_250,
    pnlPct: 178,
    byTicker: { [key]: { value: 34_750, pnl: 22_250, pnlPct: 178 } },
  },
]);

run("clean then contaminated (typical prod)", [
  {
    ts: "2026-06-15T16:00:00.000Z",
    capital: 12_500,
    value: 13_169,
    pnl: 669,
    pnlPct: 5.35,
    byTicker: { [key]: { value: 13_169, pnl: 669, pnlPct: 5.35 } },
  },
  {
    ts: "2026-06-17T16:00:00.000Z",
    capital: 12_500,
    value: 34_750,
    pnl: 22_250,
    pnlPct: 178,
    byTicker: { [key]: { value: 34_750, pnl: 22_250, pnlPct: 178 } },
  },
]);

run("no history (MTM only)", []);

console.log("\n=== moderate contamination (+18% hist vs +5% MTM) ===");
{
  const modKey = "MOD|2026-09-15";
  const capital = 10_000;
  const buy = 100;
  const curr = 105;
  const modRow = {
    Ticker: "MOD",
    "Completion Date": "15/09/2026",
    "Prezzo Corrente ($)": curr,
    "Prezzo Acquisto ($)": buy,
    "Var. Giorn. %": 0.5,
    "Capitale Investito ($)": capital,
  };
  const modInputs = {
    [modKey]: {
      buyPrice: buy,
      capital,
      ignoreSheet: false,
      investedAt: "2026-06-01T10:00:00.000Z",
    },
  };
  const modHist = [
    {
      ts: "2026-06-16T16:00:00.000Z",
      capital,
      value: capital * 1.18,
      pnl: capital * 0.18,
      pnlPct: 18,
      byTicker: { [modKey]: { value: capital * 1.18, pnl: capital * 0.18, pnlPct: 18 } },
    },
  ];
  run("moderate hist +18% vs MTM +5%", modHist);
}
