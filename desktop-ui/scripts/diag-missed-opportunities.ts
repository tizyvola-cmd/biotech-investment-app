/**
 * Offline audit: missed 24h gainers — per-ticker + cd-distant watch breakdown (Fase 0).
 * Run: npx tsx scripts/diag-missed-opportunities.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import {
  aggregateBlockerKinds,
  buildMissedOppCalibrationPlan,
  classifyBlockerLabel,
} from "../src/sheet/missedOpportunityCalibration";
import { buildMissedOpportunityAudit } from "../src/sheet/missedOpportunityAudit";
import { buildWatchGainerPhase0Report } from "../src/sheet/watchGainerDiag";
import { WATCH_P_ENTRY_MIN } from "../src/sheet/watchZoneEntryPolicy";
import { P_ENTRY_MIN } from "../src/sheet/recoveryProbability";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function loadSimTable(): SheetTable {
  const snap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  return { sheet: "Simulation", columns: snap.columns ?? [], rows: snap.rows ?? [] };
}

function loadInputs(): InvestSimInputs {
  const raw = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json");
  return raw.inputs ?? {};
}

function loadSdsRows(): SdsRow[] {
  const snap = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json");
  return snap.rows ?? [];
}

function loadCharts(): ChartBundle {
  return readJson<ChartBundle>("simulation_charts_snapshot.json");
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function isWatchSubBucket(b: string): boolean {
  return b === "watch_early" || b === "watch_late";
}

function subBucketLabel(b: string): string {
  switch (b) {
    case "near_cd":
      return "near CD (<14d)";
    case "watch_early":
      return "watch 61–90d";
    case "watch_late":
      return "watch 91–120d";
    case "beyond_monitor":
      return "beyond 120d";
    default:
      return b;
  }
}

function probFlag(row: { subBucket: string; probBelowEnter: boolean }): string | null {
  if (!row.probBelowEnter) return null;
  return isWatchSubBucket(row.subBucket) ? `P<${WATCH_P_ENTRY_MIN}` : `P<${P_ENTRY_MIN}`;
}

function main() {
  const simTable = loadSimTable();
  const inputs = loadInputs();
  const sdsRows = loadSdsRows();
  const charts = loadCharts();
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);

  const summary = buildMissedOpportunityAudit({
    simTable,
    inputs,
    pointsBySeriesKey,
    lang: "it",
    probOptions: { sdsRows, migSolidityByKey },
  });

  const phase0 = buildWatchGainerPhase0Report({
    audit: summary,
    cdDistantRows: summary.cdDistantRows,
    simTable,
    sdsRows,
  });

  const outPath = path.join(DATA, "diag_watch_gainers.json");
  fs.writeFileSync(outPath, JSON.stringify(phase0, null, 2), "utf8");

  console.log("\n=== MISSED OPPORTUNITIES AUDIT ===");
  console.log(
    `Universe ${summary.universeN} · 24h data ${summary.with24hN} · gainers ${summary.gainersN}`,
  );
  console.log(
    `Recall ${summary.recallPct ?? "—"}% op (${summary.detectedN}/${summary.detectedN + summary.missedN}) · watch ${summary.watchRecallPct ?? "—"}% (${summary.watchDetectedN}/${summary.watchGainerN}) · monitor ${summary.monitorRecallPct ?? "—"}% · missed op ${summary.missedN} · cd-distant ${summary.cdDistantGainerN} · held ${summary.heldGainerN}`,
  );

  console.log("\n=== FASE 0 — CD-DISTANT BREAKDOWN ===");
  const s = phase0.summary;
  console.log(
    `cd-distant ${s.cdDistantN}: near_cd ${s.nearCdN} · watch_early ${s.watchEarlyN} · watch_late ${s.watchLateN} · beyond ${s.beyondMonitorN}`,
  );
  console.log(
    `watch momentum strong ${s.watchMomentumStrongN} · moderate ${s.watchMomentumModerateN} · timing_beyond_hot ${s.timingBeyondHotN}`,
  );
  console.log(
    `target blocked ${s.forwardBelowEntryN} · P(plan) sotto Enter ${s.probBelowEnterN} · avg predictability watch ${s.avgTimingPredictabilityWatch ?? "—"}%`,
  );
  console.log(`Phase 1 candidates: ${s.phase1CandidateN}`);
  console.log(`\nBacktest Fase 5: npx tsx scripts/backtest-watch-enter.ts`);
  console.log(`\nGO/NO-GO: ${phase0.goNoGo.verdict.toUpperCase()}`);
  console.log(`  ${phase0.goNoGo.reasonIt}`);
  console.log(`\nJSON → ${outPath}`);

  console.log("\n--- Per ticker (cd-distant) ---");
  for (const row of phase0.rows) {
    const flags = [
      row.phase1Candidate ? "FASE1" : null,
      row.watchMomentumStrong ? "mom+" : row.watchMomentumModerate ? "mom~" : null,
      row.timingBeyondHot ? "beyond_hot" : null,
      row.forwardBelowEntry ? "fwd_low" : null,
      row.probBelowEnter ? probFlag(row) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(
      `\n${row.ticker}  ${subBucketLabel(row.subBucket)}  T-${row.daysToCd}d  24h ${pct(row.dailyPct24h)}`,
    );
    console.log(
      `  P(plan) ${row.probPct?.toFixed(0) ?? "—"}%  target ${pct(row.planReturnPct)}  match ${row.matchPct ?? "—"}%  pred ${row.timingPredictabilityPct ?? "—"}%  R2 ${row.r2?.toFixed(2) ?? "—"}  SDS ${row.sds?.toFixed(0) ?? "—"}  → ${row.exitDecision}`,
    );
    console.log(`  Flags: ${flags || "—"}`);
    if (row.blockers.length) console.log(`  Blockers: ${row.blockers.join(" · ")}`);
  }

  const plan = buildMissedOppCalibrationPlan(summary, "it");
  console.log("\n--- Piano calibrazione (missed op) ---");
  for (const a of plan.actions) {
    console.log(`[${a.priority}] ${a.titleIt}`);
    console.log(`  ${a.detailIt}`);
  }

  const kinds = aggregateBlockerKinds(summary.missedRows);
  if (summary.missedN > 0) {
    console.log("\n--- Blocker kinds (missed op) ---");
    const sortedKinds = Object.entries(kinds).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    for (const [k, n] of sortedKinds) {
      console.log(`  ${k}: ${n}/${summary.missedN}`);
    }
  }

  console.log("\n--- Per ticker (missed op) ---");
  for (const row of summary.missedRows) {
    console.log(
      `\n${row.ticker}  24h ${pct(row.dailyPct24h)}  T-${row.daysToCd}d  P(plan) ${row.probPct?.toFixed(0) ?? "—"}%  target ${pct(row.planReturnPct)}  match ${row.matchPct ?? "—"}%  → ${row.exitDecision}`,
    );
    console.log(`  Blockers: ${row.blockers.join(" · ") || "—"}`);
    const kindsForRow = [...new Set(row.blockers.map(classifyBlockerLabel))];
    if (kindsForRow.length) console.log(`  Kinds: ${kindsForRow.join(", ")}`);
  }

  if (summary.detectedRows.length) {
    console.log("\n--- Detected (Enter + gainer) ---");
    for (const row of summary.detectedRows) {
      console.log(
        `${row.ticker} 24h ${pct(row.dailyPct24h)} P(plan) ${row.probPct?.toFixed(0)}% target ${pct(row.planReturnPct)} match ${row.matchPct}%`,
      );
    }
  }
}

main();
