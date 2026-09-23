/**
 * Rescue score open-position diagnosis — sim loop vs portafoglio reale.
 * Run: cd desktop-ui && npx tsx scripts/diag-rescue-score-open.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SdsRow } from "../src/api/supernova";
import {
  computeRescueScoreBreakdown,
  computeRescueScoreExtendedBreakdown,
  deriveCauseInputFromSdsRow,
  RESCUE_OPERATIONAL_THRESHOLD_PCT,
} from "../src/sheet/lossRescueEngine";
import { pearsonR, spearmanR, correlationTwoTailedPValue } from "../src/sheet/statSignificance";

const ROOT = join(import.meta.dirname ?? ".", "..", "..");
const DATA = join(ROOT, "data");

type SimSheetRow = Record<string, unknown>;
type InvestInput = {
  capital?: number;
  soldAt?: string | null;
  ignoreSheet?: boolean;
  entryProbPct?: number | null;
};
type HistoryPoint = { ts: string; byTicker?: Record<string, { pnlPct?: number | null }> };

function readJson<T>(file: string): T | null {
  const path = join(DATA, file);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseSimSheetCdDate(raw: string): string | null {
  const s = raw.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

type OpenRow = {
  ticker: string;
  key: string;
  pplan: number;
  pnl: number;
  universe: "portafoglio" | "sim loop";
  chartScore: number;
  chartKind: "operational" | "extended";
  operational: ReturnType<typeof computeRescueScoreBreakdown>;
  extended: ReturnType<typeof computeRescueScoreExtendedBreakdown>;
};

function chartScoreForRow(
  pplan: number,
  pnl: number,
  sdsRow: SdsRow | null,
): Pick<OpenRow, "chartScore" | "chartKind" | "operational" | "extended"> {
  const cause = deriveCauseInputFromSdsRow(sdsRow);
  const operational = computeRescueScoreBreakdown({
    entryProbPct: pplan,
    lastMarkPct: pnl,
    eisWindowScore: null,
    causeAttribution: cause,
  });
  const extended = computeRescueScoreExtendedBreakdown({
    entryProbPct: pplan,
    lastMarkPct: pnl,
    eisWindowScore: null,
    causeAttribution: cause,
  });
  const isLoss = pnl < RESCUE_OPERATIONAL_THRESHOLD_PCT;
  return {
    chartKind: isLoss ? "operational" : "extended",
    chartScore: isLoss ? operational.rescoreScore : extended.rescoreScore,
    operational,
    extended,
  };
}

function buildRows(): OpenRow[] {
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json")?.rows ?? [];
  const sdsMap = new Map(sdsRows.map((r) => [r.ticker.trim().toUpperCase(), r]));

  const inputsDoc = readJson<{ inputs?: Record<string, InvestInput> }>("invest_sim_inputs.json");
  const inputs = inputsDoc?.inputs ?? {};
  const histDoc = readJson<{ points?: HistoryPoint[] } | HistoryPoint[]>("invest_sim_history.json");
  const history: HistoryPoint[] = Array.isArray(histDoc)
    ? histDoc
    : (histDoc as { points?: HistoryPoint[] })?.points ?? [];
  const latestHist = [...history].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];

  const seen = new Set<string>();
  const out: OpenRow[] = [];

  for (const [key, entry] of Object.entries(inputs)) {
    if (!entry || entry.ignoreSheet || entry.soldAt) continue;
    const capital = entry.capital ?? 0;
    if (capital <= 0) continue;
    let pnl = latestHist?.byTicker?.[key]?.pnlPct ?? null;
    if (pnl == null) pnl = 0;
    seen.add(key);
    const ticker = key.split("|")[0] ?? key;
    const pplan =
      entry.entryProbPct != null && Number.isFinite(entry.entryProbPct) && entry.entryProbPct > 0
        ? entry.entryProbPct
        : 50;
    const sdsRow = sdsMap.get(ticker.toUpperCase()) ?? null;
    const scores = chartScoreForRow(pplan, pnl, sdsRow);
    out.push({
      ticker,
      key,
      pplan,
      pnl,
      universe: "portafoglio",
      ...scores,
    });
  }

  const simSnap = readJson<{ rows?: SimSheetRow[] }>("simulation_sheet_snapshot.json");
  for (const row of simSnap?.rows ?? []) {
    const ticker = String(row["Ticker"] ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE") || ticker === "TICKER") continue;
    const cdRaw = String(row["Completion Date"] ?? "").trim();
    const cdDate = parseSimSheetCdDate(cdRaw);
    const key = cdDate ? `${ticker}|${cdDate}` : ticker;
    if (seen.has(key)) continue;
    seen.add(key);

    const affidLive = parseNum(row["affid_live"]);
    const affidPct = parseNum(row["Affidabilità\n%"]);
    const pplanRaw = affidLive ?? (affidPct != null ? affidPct * 100 : null);
    const pplan = pplanRaw != null && Number.isFinite(pplanRaw) && pplanRaw > 0 ? pplanRaw : 50;

    const capital = parseNum(row["Capitale Investito ($)"]);
    const pnlActual = parseNum(row["P&L (%)"]);
    const var1m = parseNum(row["Var. 1M %"]);
    const pnl =
      capital != null && capital > 0 && pnlActual != null ? pnlActual : (var1m ?? 0);

    const sdsRow = sdsMap.get(ticker) ?? null;
    const scores = chartScoreForRow(pplan, pnl, sdsRow);
    out.push({
      ticker,
      key,
      pplan,
      pnl,
      universe: "sim loop",
      ...scores,
    });
  }

  return out;
}

function fmtBd(
  label: string,
  bd: ReturnType<typeof computeRescueScoreBreakdown>,
  kind: string,
): void {
  console.log(
    `  ${label} (${kind}): score=${bd.rescoreScore} | P(plan)pt=${bd.probPt} lossPt=${bd.lossPt} eisPt=${bd.eisPt} ext=${bd.extBonus} volPen=${bd.volPenalty} cashPen=${bd.cashPenalty}`,
  );
}

function corrReport(label: string, rows: OpenRow[]): void {
  const xs = rows.map((r) => r.chartScore);
  const ys = rows.map((r) => r.pnl);
  const r = rows.length >= 3 ? pearsonR(xs, ys) : null;
  const rho = rows.length >= 3 ? spearmanR(xs, ys) : null;
  const p = rho != null ? correlationTwoTailedPValue(rho, rows.length) : null;
  const nRescue = rows.filter((r) => r.pnl < RESCUE_OPERATIONAL_THRESHOLD_PCT).length;
  const nExt = rows.length - nRescue;
  console.log(`\n── ${label} (n=${rows.length}) ──`);
  console.log(`  r=${r?.toFixed(3) ?? "—"}  ρ=${rho?.toFixed(3) ?? "—"}  p=${p?.toFixed(4) ?? "—"}`);
  console.log(`  rescue space: ${nRescue} · extended: ${nExt}`);
  if (rows.length) {
    const pnls = rows.map((r) => r.pnl);
    const sorted = [...pnls].sort((a, b) => a - b);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    console.log(
      `  P&L%: min=${sorted[0]!.toFixed(1)} med=${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} max=${sorted[sorted.length - 1]!.toFixed(1)} mean=${mean.toFixed(1)}`,
    );
  }
}

function main(): void {
  const rows = buildRows();
  if (!rows.length) {
    console.error("No open rows built — check data/*.json");
    process.exit(1);
  }

  console.log("=== Rescue Score Open Diagnosis ===");
  console.log(`Total open: ${rows.length} (portafoglio=${rows.filter((r) => r.universe === "portafoglio").length}, sim loop=${rows.filter((r) => r.universe === "sim loop").length})`);

  for (const ticker of ["CRDF", "FNCHQ"]) {
    const row = rows.find((r) => r.ticker === ticker);
    console.log(`\n=== ${ticker} ===`);
    if (!row) {
      console.log("  (not found in open universe)");
      continue;
    }
    console.log(`  universe=${row.universe} pnl=${row.pnl.toFixed(2)}% pplan=${row.pplan.toFixed(1)}% chartScore=${row.chartScore} (${row.chartKind})`);
    fmtBd("operational", row.operational, "all positions");
    fmtBd("extended", row.extended, "diagnostic");
  }

  const pf = rows.filter((r) => r.universe === "portafoglio");
  const sim = rows.filter((r) => r.universe === "sim loop");
  corrReport("Portafoglio reale", pf);
  corrReport("Sim loop", sim);
  corrReport("Combined (do not use for thresholds)", rows);

  const lossPts = rows.map((r) =>
    r.pnl < RESCUE_OPERATIONAL_THRESHOLD_PCT ? r.operational.lossPt : r.extended.lossPt,
  );
  const lossR = rows.length >= 3 ? pearsonR(lossPts, rows.map((r) => r.pnl)) : null;
  console.log(`\n── Loss depth component vs P&L% (n=${rows.length}) ──`);
  console.log(`  r=${lossR?.toFixed(3) ?? "—"} (negative ⇒ deeper loss → higher lossPt)`);

  const extOnlyScores = rows.map((r) => r.extended.rescoreScore);
  const extOnlyR = rows.length >= 3 ? pearsonR(extOnlyScores, rows.map((r) => r.pnl)) : null;
  const extOnlyRho = rows.length >= 3 ? spearmanR(extOnlyScores, rows.map((r) => r.pnl)) : null;
  console.log(`\n── Extended score on ALL positions (hypothetical uniform chart) ──`);
  console.log(`  combined r=${extOnlyR?.toFixed(3) ?? "—"} ρ=${extOnlyRho?.toFixed(3) ?? "—"}`);
  for (const label of ["Portafoglio reale", "Sim loop"] as const) {
    const sub = rows.filter((r) =>
      label === "Portafoglio reale" ? r.universe === "portafoglio" : r.universe === "sim loop",
    );
    if (sub.length < 3) continue;
    const xs = sub.map((r) => r.extended.rescoreScore);
    const ys = sub.map((r) => r.pnl);
    console.log(
      `  ${label}: r=${pearsonR(xs, ys)?.toFixed(3) ?? "—"} ρ=${spearmanR(xs, ys)?.toFixed(3) ?? "—"}`,
    );
  }

  for (const ticker of ["FNCHQ", "ACHV", "BBNX", "NRIX"]) {
    const row = rows.find((r) => r.ticker === ticker);
    if (!row) continue;
    console.log(`  ${ticker}: pplan=${row.pplan.toFixed(1)}% chartScore=${row.chartScore} pnl=${row.pnl.toFixed(1)}%`);
  }
}

main();
