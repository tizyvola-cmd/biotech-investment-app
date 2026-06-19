/**
 * Audit cross-check misalignments per ticker (Decision Sim).
 * Run: npx tsx scripts/diag-misalignments.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import {
  buildDecisionSimEvaluations,
  buildHarmonizedCurveContext,
  detectCurveMisalignments,
  type CurveMisalignmentId,
} from "../src/sheet/investDecisionSimLoop";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { buildSimRowByKeyMap } from "../src/sheet/investSimKeys";
import { simulationRowSeriesKey } from "../src/data/simulationCharts";
import { auditAssessmentChartHarmony } from "../src/sheet/assessmentChartHarmony";
import { buildOverlayCurve } from "../src/sheet/sdsCompareOverlay";
import { buildSlopeTrajectory } from "../src/sheet/slopeRecalibCurve";
import { canonicalTodayOffset, transformOverlayVsToday } from "../src/sheet/assessmentChartHarmony";
import { daysFromToday } from "../src/sheet/simulationPlanGain";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

const TYPE_LABEL: Record<CurveMisalignmentId, string> = {
  harmony_pred_slope: "Pred overlay ≠ slope trajectory",
  target_vs_supernova: "Plan target ≠ curve peak (pre-CD)",
  precat_vs_verdict: "Precat vs Top2 verdict",
  spot_vs_model: "Spot vs model today",
  slope_sign_mismatch: "Slope5 sign ≠ pred+5",
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function loadSimTable(): SheetTable {
  const snap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  return { sheet: "Simulation", columns: snap.columns ?? [], rows: snap.rows ?? [] };
}

function main() {
  const simTable = loadSimTable();
  const inputs = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);

  const ctx = {
    simTable,
    inputs,
    pointsBySeriesKey,
    lang: "it" as const,
    probOptions: { sdsRows, migSolidityByKey, lightweightPolygon: true, mergedInputs: inputs },
    paperPortfolio: [],
  };

  const evaluations = buildDecisionSimEvaluations(ctx);
  const itemsByKey = new Map<string, ReturnType<typeof buildLossAnalysisItems>[number]>();
  for (const profile of ["portfolio", "opportunities"] as const) {
    for (const it of buildLossAnalysisItems(
      profile,
      simTable,
      inputs,
      pointsBySeriesKey,
      "it",
      null,
      ctx.probOptions,
      profile === "opportunities" ? "watch" : undefined,
    )) {
      itemsByKey.set(it.key, it);
    }
  }

  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const byType: Record<CurveMisalignmentId, string[]> = {
    harmony_pred_slope: [],
    target_vs_supernova: [],
    precat_vs_verdict: [],
    spot_vs_model: [],
    slope_sign_mismatch: [],
  };

  const harmonyGaps: number[] = [];
  const targetGaps: { ticker: string; plan: number; sn: number; gap: number }[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const ev of evaluations) {
    const item = itemsByKey.get(ev.key);
    if (!item) continue;
    for (const id of ev.misalignments) {
      byType[id].push(ev.ticker);
    }

    const simRow = rowByKey.get(ev.key) ?? null;
    const sk = item.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null);
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const harmonized = buildHarmonizedCurveContext(ev.ticker, simRow, chartPts);

    if (harmonized.harmony && !harmonized.harmony.aligned) {
      harmonyGaps.push(harmonized.harmony.maxPredGapPp);
    }
    if (
      item.planReturnPct != null &&
      item.curvePeakReturnPct != null &&
      Math.abs(item.planReturnPct - item.curvePeakReturnPct) > 2.5
    ) {
      targetGaps.push({
        ticker: ev.ticker,
        plan: item.planReturnPct,
        sn: item.curvePeakReturnPct,
        gap: item.planReturnPct - item.curvePeakReturnPct,
      });
    }

    rows.push({
      ticker: ev.ticker,
      hasPosition: ev.hasPosition,
      action: ev.suggestedAction,
      misalignments: ev.misalignments,
      labels: ev.misalignmentLabels,
      harmonyMaxGapPp: harmonized.harmony?.maxPredGapPp ?? null,
      planReturnPct: item.planReturnPct,
      supernovaPeakPct: harmonized.supernovaPeakPct,
      curvePeakReturnPct: item.curvePeakReturnPct,
      precatKind: item.precatKind,
      investVerdict: item.investVerdict,
      curveGapPct: item.curveGapPct,
      slope5d: item.slope5d,
      pred5Pp: item.pred5Pp,
    });
  }

  const n = evaluations.length;
  const misalignedN = evaluations.filter((e) => e.misalignments.length > 0).length;

  console.log("\n=== MISALIGNMENT AUDIT ===\n");
  console.log(`Universo: ${n} ticker · Con almeno 1 misalignment: ${misalignedN} (${Math.round((misalignedN / n) * 100)}%)\n`);

  for (const id of Object.keys(byType) as CurveMisalignmentId[]) {
    const tickers = byType[id];
    console.log(`--- ${TYPE_LABEL[id]} (${tickers.length}/${n}) ---`);
    console.log(tickers.length ? tickers.join(", ") : "(nessuno)");
    console.log("");
  }

  if (harmonyGaps.length) {
    harmonyGaps.sort((a, b) => a - b);
    const med = harmonyGaps[Math.floor(harmonyGaps.length / 2)];
    console.log(
      `Harmony gap pp: min ${harmonyGaps[0].toFixed(2)} · med ${med.toFixed(2)} · max ${harmonyGaps[harmonyGaps.length - 1].toFixed(2)} · soglia attuale 0.25 pp`,
    );
    console.log(
      `  → con soglia 1.0 pp: ${harmonyGaps.filter((g) => g > 1).length} resterebbero · con 2.0 pp: ${harmonyGaps.filter((g) => g > 2).length}`,
    );
  }

  if (targetGaps.length) {
    console.log("\n--- Target vs Supernova (gap > 2.5 pp) ---");
    for (const t of targetGaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 15)) {
      console.log(
        `  ${t.ticker}: piano +${t.plan.toFixed(1)}% · SN +${t.sn.toFixed(1)}% · Δ ${t.gap >= 0 ? "+" : ""}${t.gap.toFixed(1)} pp`,
      );
    }
  }

  const outPath = path.join(DATA, "diag_misalignments.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        universeN: n,
        misalignedN,
        byType: Object.fromEntries(
          (Object.keys(byType) as CurveMisalignmentId[]).map((k) => [k, byType[k].length]),
        ),
        harmonyGapStats:
          harmonyGaps.length > 0
            ? {
                min: harmonyGaps[0],
                max: harmonyGaps[harmonyGaps.length - 1],
                median: harmonyGaps[Math.floor(harmonyGaps.length / 2)],
                thresholdPp: 0.5,
              }
            : null,
        targetGaps,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nJSON → ${outPath}\n`);
}

main();
