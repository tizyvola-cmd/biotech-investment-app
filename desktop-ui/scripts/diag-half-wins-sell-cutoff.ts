/**
 * Test early-sell idea: urgent SELL when a name's loss ≥ half of that day's
 * (or 2-day) winning legs — "gains cover losses" budget.
 *
 *   npx tsx scripts/diag-half-wins-sell-cutoff.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { SheetTable } from "../src/types";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../src/sheet/investSimStorage";
import {
  buildSimUniverse24hWhatIf,
  SIM_UNIVERSE_WHATIF_CAPITAL,
} from "../src/sheet/simUniverse24hWhatIf";
import { buildDashboardPortfolioChips } from "../src/sheet/simulationPosition";

const DATA = path.resolve(import.meta.dirname, "../../data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function loadHistory(): InvestSimHistoryPoint[] {
  try {
    const raw = readJson<{ points?: InvestSimHistoryPoint[] } | InvestSimHistoryPoint[]>(
      "invest_sim_history.json",
    );
    if (Array.isArray(raw)) return raw;
    return raw.points ?? [];
  } catch {
    return [];
  }
}

/** Sum of positive byTicker pnl deltas between two history points. */
function dayWinLossFromHistory(
  hist: InvestSimHistoryPoint[],
  openKeys: Set<string>,
): { wins: number; losses: number; nWin: number; nLoss: number } | null {
  if (hist.length < 2) return null;
  const last = hist[hist.length - 1]!;
  const prev = hist[hist.length - 2]!;
  let wins = 0;
  let losses = 0;
  let nWin = 0;
  let nLoss = 0;
  for (const key of openKeys) {
    const a = last.byTicker?.[key]?.pnl;
    const b = prev.byTicker?.[key]?.pnl;
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = a - b;
    if (d > 0.5) {
      wins += d;
      nWin += 1;
    } else if (d < -0.5) {
      losses += d;
      nLoss += 1;
    }
  }
  return { wins, losses, nWin, nLoss };
}

function main() {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows ?? [],
  };
  const inputs =
    readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const hist = loadHistory();
  const whatIf = buildSimUniverse24hWhatIf(simTable, inputs, SIM_UNIVERSE_WHATIF_CAPITAL);
  if (!whatIf) throw new Error("no what-if");

  const chips = buildDashboardPortfolioChips(simTable, inputs, hist);
  const openKeys = new Set(chips.map((c) => c.key));

  console.log("--- Idea: urgent SELL if |loss| >= 0.5 * sum(day wins) ---\n");

  // A) PF what-if 24h equal-weight
  const pf = whatIf.rows.filter((r) => r.inPortfolio && r.pnlEur != null);
  const winSum5k = pf.filter((r) => r.pnlEur! > 0).reduce((a, r) => a + r.pnlEur!, 0);
  const half5k = winSum5k / 2;
  console.log("A) PF what-if 24h (equal 5k)");
  console.log(
    `   wins ${Math.round(winSum5k)} · half ${Math.round(half5k)} · losers:`,
  );
  for (const r of [...pf].filter((x) => x.pnlEur! < 0).sort((a, b) => a.pnlEur! - b.pnlEur!)) {
    const hit = Math.abs(r.pnlEur!) >= half5k - 1e-6;
    console.log(
      `   ${hit ? "HIT" : "ok "} ${r.ticker.padEnd(6)} ${String(r.pnlEur).padStart(6)} €`,
    );
  }

  // B) Real capital 24h € from chips
  const cWin = chips
    .filter((c) => (c.pnlEur24h ?? 0) > 0)
    .reduce((a, c) => a + (c.pnlEur24h ?? 0), 0);
  const halfC = cWin / 2;
  console.log("\nB) PF real capital · 24h € legs");
  console.log(`   wins ${Math.round(cWin)} · half ${Math.round(halfC)}`);
  for (const c of [...chips]
    .filter((x) => (x.pnlEur24h ?? 0) < 0)
    .sort((a, b) => (a.pnlEur24h ?? 0) - (b.pnlEur24h ?? 0))) {
    const v = c.pnlEur24h ?? 0;
    const hit = Math.abs(v) >= halfC - 1e-6 && halfC > 0;
    console.log(
      `   ${hit ? "HIT" : "ok "} ${c.ticker.padEnd(6)} day ${String(Math.round(v)).padStart(6)} € · total ${Math.round(c.pnlEur)} € · ${c.pnlPct24h ?? "—"}%`,
    );
  }

  // C) Total MTM vs half of current winners' MTM (asymmetric — often too loose)
  const halfWinnerMtm =
    chips.filter((c) => c.pnlEur > 0).reduce((a, c) => a + c.pnlEur, 0) / 2;
  console.log("\nC) Total MTM vs half of winners' lifetime MTM (usually too soft)");
  console.log(`   halfWinnerMtm ${Math.round(halfWinnerMtm)}`);
  for (const c of [...chips]
    .filter((x) => x.pnlEur < 0)
    .sort((a, b) => a.pnlEur - b.pnlEur)) {
    const hit = Math.abs(c.pnlPct) >= 0; // show eur
    const eurHit = Math.abs(c.pnlEur) >= halfWinnerMtm && halfWinnerMtm > 0;
    console.log(
      `   ${eurHit ? "HIT" : "ok "} ${c.ticker.padEnd(6)} ${Math.round(c.pnlEur)} € (${c.pnlPct.toFixed(1)}%)`,
    );
    void hit;
  }

  // D) History last mark vs prior (true day delta if snapshots exist)
  const histDelta = dayWinLossFromHistory(hist, openKeys);
  if (histDelta) {
    const half = histDelta.wins / 2;
    console.log("\nD) History last vs prior snapshot (open keys)");
    console.log(
      `   wins ${Math.round(histDelta.wins)} · half ${Math.round(half)} · lossSum ${Math.round(histDelta.losses)}`,
    );
  } else {
    console.log("\nD) History: need ≥2 points with byTicker — skipped");
  }

  // E) %-form: half of mean win % among PF winners as loss cutoff
  const winPcts = pf.filter((r) => r.dailyPct24h != null && r.dailyPct24h > 0).map((r) => r.dailyPct24h!);
  const meanWinPct =
    winPcts.length > 0 ? winPcts.reduce((a, b) => a + b, 0) / winPcts.length : 0;
  const halfMeanWinPct = meanWinPct / 2;
  console.log("\nE) %-form: cutoff = −(mean winner Var%/2)");
  console.log(
    `   meanWin% ${meanWinPct.toFixed(2)} · cutoff ${(-halfMeanWinPct).toFixed(2)}%`,
  );
  for (const r of [...pf]
    .filter((x) => x.dailyPct24h != null)
    .sort((a, b) => (a.dailyPct24h ?? 0) - (b.dailyPct24h ?? 0))) {
    const pct = r.dailyPct24h!;
    const hit = pct <= -halfMeanWinPct && halfMeanWinPct > 0;
    console.log(
      `   ${hit ? "HIT" : "ok "} ${r.ticker.padEnd(6)} ${pct.toFixed(2)}%`,
    );
  }

  // F) Book budget: sum(losses) should not exceed half(wins) — which single cut restores budget?
  console.log("\nF) Book budget: after sorting losers worst-first, drop until |losses| <= half(wins)");
  const losses = [...pf]
    .filter((r) => r.pnlEur! < 0)
    .sort((a, b) => a.pnlEur! - b.pnlEur!);
  let remLoss = losses.reduce((a, r) => a + r.pnlEur!, 0);
  const budget = -half5k; // max allowed |loss| aggregate = half wins → remLoss >= -halfWins
  console.log(
    `   start lossSum ${Math.round(remLoss)} · budget (max |loss|) ${Math.round(half5k)}`,
  );
  for (const r of losses) {
    if (remLoss >= -half5k) break;
    console.log(`   SELL urgent ${r.ticker} (${r.pnlEur} €) to restore budget`);
    remLoss -= r.pnlEur!; // removing a negative increases remLoss toward 0
  }
  console.log(`   remaining lossSum ${Math.round(remLoss)}`);

  console.log("\n--- Verdict notes ---");
  console.log(
    "Prefer: (1) day-leg € on real capital, or (2) book-budget drop worst until cover 2x.",
  );
  console.log(
    "Avoid: lifetime MTM half-wins (C) — MSLE +496 makes half huge, never fires.",
  );
  console.log("2-day: use rolling sum of positive day-legs over last 2 sessions as W.");
}

main();
