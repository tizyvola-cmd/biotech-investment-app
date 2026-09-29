/** npx tsx scripts/_diag_t212_compare.ts — SuperNova vs Trading 212 buy */
import fs from "node:fs";
import path from "node:path";
import { computeSimulationPosition } from "../src/sheet/simulationPosition";
import type { InvestSimInputs, SheetTable } from "../types";

const root = path.resolve(import.meta.dirname, "../../data");
const sim = JSON.parse(
  fs.readFileSync(path.join(root, "simulation_sheet_snapshot.json"), "utf8"),
);
const raw = JSON.parse(
  fs.readFileSync(path.join(root, "invest_sim_inputs.json"), "utf8"),
);
const inputs = (raw.inputs ?? raw) as InvestSimInputs;

/** Trading 212 screenshot — avg buy USD, P&L EUR ref */
const T212: Record<
  string,
  { buyUsd: number; pnlEurRef: number; qty?: number }
> = {
  GILD: { buyUsd: 136.97, pnlEurRef: -5.14, qty: 42.039 },
  HAE: { buyUsd: 91.09, pnlEurRef: -32.92, qty: 62.939 },
  NRIX: { buyUsd: 26.77, pnlEurRef: -26.18, qty: 214.455 },
  SRPT: { buyUsd: 18.37, pnlEurRef: -1.37, qty: 156.882 },
  VRTX: { buyUsd: 524.91, pnlEurRef: -8.03, qty: 10.964 },
};

function mtm(cap: number, buy: number, curr: number) {
  const shares = cap / buy;
  const pnl = shares * curr - cap;
  const pct = ((curr - buy) / buy) * 100;
  return { pnl: Math.round(pnl * 100) / 100, pct: Math.round(pct * 100) / 100 };
}

const rows: Record<string, unknown>[] = [];
for (const tk of Object.keys(T212)) {
  const row = (sim.rows as Record<string, unknown>[]).find(
    (r) => String(r.Ticker ?? "").toUpperCase() === tk,
  );
  if (!row) continue;
  const curr = Number(row["Prezzo Corrente ($)"]);
  const ent =
    Object.entries(inputs).find(([k]) => k.toUpperCase().startsWith(`${tk}|`))?.[1] ??
    null;
  const cap = ent?.capital ?? 5000;
  const snBuy = ent?.buyPrice ?? 0;
  const pos = computeSimulationPosition(row, inputs, { history: [] });
  const t212 = T212[tk]!;
  const atSn = mtm(cap, snBuy > 0 ? snBuy : curr, curr);
  const atT212 = mtm(cap, t212.buyUsd, curr);
  rows.push({
    ticker: tk,
    curr,
    capital: cap,
    snBuy,
    t212Buy: t212.buyUsd,
    buyGapUsd: Math.round((snBuy - t212.buyUsd) * 100) / 100,
    snPnl: pos?.pnlEur ?? atSn.pnl,
    snPct: pos?.pnlPct ?? atSn.pct,
    pnlIfT212Buy: atT212.pnl,
    pnlIfT212Pct: atT212.pct,
    t212PnlRef: t212.pnlEurRef,
  });
}
console.log(JSON.stringify(rows, null, 2));
