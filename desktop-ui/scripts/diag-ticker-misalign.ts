/**
 * Deep check for ticker target misalignment.
 * npx tsx scripts/diag-ticker-misalign.ts CCCC CRDF
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../src/data/simulationCharts";
import { buildSimRowByKeyMap } from "../src/sheet/investSimKeys";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { buildDecisionSimEvaluations } from "../src/sheet/investDecisionSimLoop";
import { resolveExpectedGainPlan } from "../src/sheet/simulationPlanGain";
import { planRoiBundleFromGainPlan, primaryReturnPctFromGainPlan, cdReturnPctFromGainPlan } from "../src/sheet/canonicalRoi";
import { resolveAssessmentSupernovaPeak, resolveSupernovaTargetRoi, resolveSupernovaForwardPeak } from "../src/sheet/supernovaTargetRoi";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../src/sheet/expectedRoiDisplay";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");
const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
if (!tickers.length) tickers.push("CCCC", "CRDF");

function readJson<T>(f: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")) as T;
}

function findRow(table: SheetTable, tk: string) {
  return table.rows.find((r) => String(r.Ticker ?? r.ticker ?? "").toUpperCase() === tk);
}

function main() {
  const simTable = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>("simulation_sheet_snapshot.json");
  const table: SheetTable = { sheet: "Simulation", columns: simTable.columns ?? [], rows: simTable.rows ?? [] };
  const inputs = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const mig = buildMigSolidityByKey(table, charts, sdsRows);
  const probOptions = { sdsRows, migSolidityByKey: mig, lightweightPolygon: true, mergedInputs: inputs };

  const items = [
    ...buildLossAnalysisItems("portfolio", table, inputs, pointsBySeriesKey, "it", null, probOptions),
    ...buildLossAnalysisItems("opportunities", table, inputs, pointsBySeriesKey, "it", null, probOptions, "watch"),
  ];
  const byTicker = new Map(items.map((i) => [i.ticker.toUpperCase(), i]));
  const rowByKey = buildSimRowByKeyMap(table.rows);
  const evals = buildDecisionSimEvaluations({
    simTable: table,
    inputs,
    pointsBySeriesKey,
    lang: "it",
    probOptions,
    paperPortfolio: [],
  });
  const evalByTicker = new Map(evals.map((e) => [e.ticker.toUpperCase(), e]));

  for (const tk of tickers) {
    const item = byTicker.get(tk);
    const ev = evalByTicker.get(tk);
    const row = findRow(table, tk);
    if (!item || !row) {
      console.log(`\n=== ${tk} — not found ===`);
      continue;
    }
    const sk = item.seriesKey ?? simulationRowSeriesKey(row);
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const cap = inputs[item.key]?.capital > 0 ? inputs[item.key].capital : DEFAULT_PLAN_CAPITAL_EUR;
    const gainPlan = resolveExpectedGainPlan(row, cap, { chartPoints: chartPts });
    const roi = planRoiBundleFromGainPlan(gainPlan, cap, item.daysToCd);
    const snStd = resolveSupernovaTargetRoi(tk, row, chartPts);
    const snExt = resolveSupernovaForwardPeak(row, chartPts, { extendedPostCd: true, vsToday: true });
    const snAssess = resolveAssessmentSupernovaPeak(row, chartPts);

    console.log(`\n=== ${tk} ===`);
    console.log(`Portfolio: ${item.hasPosition} · P&L tot ${item.pnlPct?.toFixed(2)}% · 24h ${item.pnlPct24h?.toFixed(2) ?? "—"}%`);
    console.log(`T−CD: ${item.daysToCd} · exit: ${item.exitDecision} · Top2: ${item.investVerdict} · precat: ${item.precatKind}`);
    console.log(`Raccom.: ${ev?.suggestedAction} · P(plan): ${ev?.probPct}% · in paper: ${ev?.inPaperPortfolio}`);
    console.log(`\nTarget piano (gain plan):`);
    console.log(`  targetReturnPct (primary): ${primaryReturnPctFromGainPlan(gainPlan)?.toFixed(2)}%`);
    console.log(`  expectedReturnPct @ CD:   ${cdReturnPctFromGainPlan(gainPlan)?.toFixed(2)}%`);
    console.log(`  targetHighPct:             ${gainPlan.targetHighPct?.toFixed(2) ?? "—"}%`);
    console.log(`  targetProvisional:         ${gainPlan.targetProvisional}`);
    console.log(`  source:                    ${gainPlan.source}`);
    console.log(`  item.planReturnPct:        ${item.planReturnPct?.toFixed(2)}%`);
    console.log(`\nPicco curva:`);
    console.log(`  curvePeakReturnPct:        ${item.curvePeakReturnPct?.toFixed(2) ?? "—"}% (assessment)`);
    console.log(`  SN standard (pre-CD):      ${snStd?.returnPct.toFixed(2)}% @ offset ${snStd?.peakOffset}`);
    console.log(`  SN extended:               ${snExt?.returnPct.toFixed(2)}% @ offset ${snExt?.peakOffset} kind=${snExt?.peakKind}`);
    console.log(`  daysToCurvePeak:           ${item.daysToCurvePeak ?? "—"}`);
    console.log(`\nCurve / slope:`);
    console.log(`  pred+5: ${item.pred5Pp?.toFixed(2)} pp · slope5: ${item.slope5d} · gap spot: ${item.curveGapPct?.toFixed(2)}%`);
    console.log(`Misalignments: ${ev?.misalignmentLabels.join(" | ") || "—"}`);
  }
}

main();
