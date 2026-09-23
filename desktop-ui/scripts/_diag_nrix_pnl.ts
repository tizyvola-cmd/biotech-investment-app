/** npx tsx scripts/_diag_nrix_pnl.ts */
import fs from "node:fs";
import path from "node:path";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  computeSimulationPosition,
  positionPnlForOpenRow,
  resolvePositionPnlBreakdown,
} from "../src/sheet/simulationPosition";
import type { SheetTable } from "../types";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";

const root = path.resolve(import.meta.dirname, "../../data");
const sim = JSON.parse(
  fs.readFileSync(path.join(root, "simulation_sheet_snapshot.json"), "utf8"),
);
const raw = JSON.parse(
  fs.readFileSync(path.join(root, "invest_sim_inputs.json"), "utf8"),
);
const inputs = (raw.inputs ?? raw) as InvestSimInputs;
const histRaw = JSON.parse(
  fs.readFileSync(path.join(root, "invest_sim_history.json"), "utf8"),
);
const history = (
  Array.isArray(histRaw) ? histRaw : histRaw.history ?? histRaw.points ?? []
) as InvestSimHistoryPoint[];

const row = (sim.rows as Record<string, unknown>[]).find(
  (r) => String(r.Ticker ?? "").toUpperCase() === "NRIX",
);
if (!row) {
  console.error("NRIX row not found");
  process.exit(1);
}
const key = "NRIX|2026-08-31";
const entry = inputs[key];
const simTable = { sheet: "Simulation", rows: [row], columns: [] } as SheetTable;

const pos = computeSimulationPosition(row, inputs, { history });
if (!pos) {
  console.error("no position");
  process.exit(1);
}
const b = resolvePositionPnlBreakdown(
  pos,
  row,
  entry?.investedAt,
  history,
  inputs,
);
const chips = buildDashboardPortfolioChips(simTable, inputs, history);
const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
const m = positionPnlForOpenRow(row, inputs, history);

const cap = entry?.capital ?? 0;
const buy = entry?.buyPrice ?? 0;
const curr = Number(row["Prezzo Corrente ($)"]);
const manualShares = buy > 0 ? cap / buy : 0;
const manualVal = manualShares * curr;
const manualPnl = manualVal - cap;
const manualPct = buy > 0 ? ((curr - buy) / buy) * 100 : null;

console.log(
  JSON.stringify(
    {
      sheet: {
        curr,
        varDay: row["Var. Giorn. %"],
        sheetBuy: row["Prezzo Acquisto ($)"],
        sheetPnlPct: row["P&L (%)"],
        sheetPnlUsd: row["P&L ($)"],
      },
      book: entry,
      manualMtm: {
        shares: Math.round(manualShares * 100) / 100,
        valueNow: Math.round(manualVal * 100) / 100,
        pnlEur: Math.round(manualPnl * 100) / 100,
        pnlPct: Math.round((manualPct ?? 0) * 100) / 100,
      },
      engine: {
        compute: {
          pnlEur: pos.pnlEur,
          pnlPct: pos.pnlPct,
          buy: pos.buyPrice,
          valueNow: pos.valueNow,
          shares: Math.round(pos.shares * 100) / 100,
        },
        breakdown: {
          totalEur: b.totalEur,
          totalPct: b.totalPct,
          priorLeg: b.priorLegEur,
          today: b.pnlEurToday,
          totalSource: b.totalSource,
          contaminated: b.historyContaminated,
          priorCloseCount: b.priorCloseCount,
        },
        chips: chips.map((c) => ({
          pnlEur: c.pnlEur,
          pnlPct: c.pnlPct,
          pnl24h: c.pnlEur24h,
        })),
        aggregatePnl: totals.pnlEur,
        openRow: { pnlEur: m.pnlEur, pnlPct: m.pnlPct },
      },
      historyLast5: history
        .filter((p) => p.byTicker?.[key])
        .slice(-5)
        .map((p) => ({ ts: p.ts, snap: p.byTicker![key] })),
    },
    null,
    2,
  ),
);
