/**
 * Why Soft BUY / Evaluation REC shows no BUY.
 * Run: npx tsx scripts/_diag_soft_buy_zero.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  deriveSuggestedAction,
  softBuyRisingStreakAllows,
  softBuyTapeNotCatastrophic,
  softBuyTop2Allows,
  type SuggestedActionEnhanceCtx,
} from "../src/sheet/investDecisionSimLoop";
import { evaluateSoftBuyGrade1 } from "../src/sheet/softSignalGrades";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { dailyChangePctFromRow, isWarrantTicker } from "../src/sheet/simulationPosition";
import { buildOperationalRecResult } from "../src/sheet/operationalRecommendation";
import type { SheetTable, ChartBundle } from "../src/types";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import type { SdsRow } from "../src/api/supernova";

const root = path.resolve(import.meta.dirname, "../../data");
const simRaw = JSON.parse(fs.readFileSync(path.join(root, "simulation_sheet_snapshot.json"), "utf8"));
const inputsRaw = JSON.parse(fs.readFileSync(path.join(root, "invest_sim_inputs.json"), "utf8"));

const simTable = { sheet: "Simulation", rows: simRaw.rows ?? [], columns: [] } as SheetTable;
const inputs = (inputsRaw.inputs || inputsRaw) as InvestSimInputs;

let sdsRows: SdsRow[] = [];
for (const name of [
  "sds_snapshot.json",
  "supernova_sds.json",
  "sds_scores.json",
  "sds_sheet_snapshot.json",
]) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const rows = Array.isArray(j) ? j : j.rows ?? j.sds ?? j.data ?? [];
    if (Array.isArray(rows) && rows.length) {
      sdsRows = rows as SdsRow[];
      console.log("sds from", name, sdsRows.length);
      break;
    }
  } catch {
    /* next */
  }
}

let chartBundle: ChartBundle | null = null;
try {
  const p = path.join(root, "simulation_charts_snapshot.json");
  if (fs.existsSync(p)) chartBundle = JSON.parse(fs.readFileSync(p, "utf8"));
} catch {
  /* optional */
}

const pointsBySeriesKey = chartPointsMapFromBundle(chartBundle ?? ({ series: {} } as ChartBundle));
const migSolidityByKey = buildMigSolidityByKey(simTable, chartBundle, sdsRows);
const opp = buildLossAnalysisItems(
  "opportunities",
  simTable,
  inputs,
  pointsBySeriesKey,
  "en",
  null,
  { migSolidityByKey, sdsRows },
  "all",
);

// No Yahoo here — simulate missing prior (Evaluation before fetch) vs with fake prior.
const focus = new Set(["CHRS", "BIIB", "CCCC", "BBNX", "ZNTL", "KZIA", "VRTX", "CRDL", "JSPR", "HAE"]);

function diagnose(item: (typeof opp)[0], prior?: number) {
  const row = simTable.rows.find(
    (r) => String(r.Ticker ?? "").toUpperCase() === item.ticker.toUpperCase(),
  );
  const dayPct = row ? dailyChangePctFromRow(row) : item.pnlPct24h;
  const sds =
    sdsRows.find((s) => s.ticker?.toUpperCase() === item.ticker.toUpperCase())?.sds ??
    item.sdsScore ??
    null;
  const g1 = evaluateSoftBuyGrade1({
    hasPosition: item.hasPosition,
    sdsScore: sds,
    pplan: item.recoveryProbabilityPct,
  });
  const enhance: SuggestedActionEnhanceCtx = {
    simRow: row ?? null,
    chartPts: item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null,
    priorSessionPcts: prior != null ? [prior] : undefined,
  };
  const top2 = softBuyTop2Allows(item);
  const rise = softBuyRisingStreakAllows(item, dayPct, enhance);
  const tape = softBuyTapeNotCatastrophic(item, dayPct);
  const warrant = isWarrantTicker(item.ticker);
  const precatSell = item.precatKind === "sell";
  const action = deriveSuggestedAction(item, false, null, null, enhance);
  return {
    ticker: item.ticker,
    action,
    hasPos: item.hasPosition,
    p: item.recoveryProbabilityPct,
    sds,
    dayPct,
    verdict: item.investVerdict,
    precat: item.precatKind,
    g1: g1.hit,
    top2,
    rise,
    tape,
    warrant,
    precatSell,
    softPath:
      g1.hit && !warrant && !precatSell && top2 && rise && tape && !item.hasPosition,
  };
}

console.log("opp count", opp.length);
const interesting = opp.filter((i) => focus.has(i.ticker.toUpperCase()));
const pool = interesting.length ? interesting : opp.slice(0, 25);

console.log("\n=== without Yahoo prior ===");
for (const item of pool) {
  console.log(diagnose(item));
}

console.log("\n=== with prior +1.5% (force ↑≥2d if today green) ===");
for (const item of pool) {
  const d = diagnose(item, 1.5);
  if (d.softPath || d.action === "buy") console.log(d);
}

const ops = buildOperationalRecResult({
  simTable,
  inputs,
  chartBundle,
  history: [],
  lang: "en",
  sdsRows,
  priorSessionPctByTicker: null,
});
console.log("\nops.buys (no prior)", ops.buys.map((b) => b.ticker));

const fakePrior = new Map<string, number>();
for (const item of opp) fakePrior.set(item.ticker.toUpperCase(), 1.5);
const ops2 = buildOperationalRecResult({
  simTable,
  inputs,
  chartBundle,
  history: [],
  lang: "en",
  sdsRows,
  priorSessionPctByTicker: fakePrior,
});
console.log("ops.buys (fake prior +1.5)", ops2.buys.map((b) => b.ticker));
