/**
 * Confronto opportunità 24h perse vs raccomandazioni BUY del monitor.
 * Run: npx tsx scripts/diag-missed-vs-recommendations.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildMissedOpportunityAudit } from "../src/sheet/missedOpportunityAudit";
import { buildSuggestionMonitorRows } from "../src/sheet/suggestionMonitor";
import { aggregateBlockerKinds } from "../src/sheet/missedOpportunityCalibration";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function main() {
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: readJson<{ columns?: string[] }>("simulation_sheet_snapshot.json").columns ?? [],
    rows: readJson<{ rows: SheetTable["rows"] }>("simulation_sheet_snapshot.json").rows ?? [],
  };
  const inputs = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const probOptions = { sdsRows, migSolidityByKey };

  const missed = buildMissedOpportunityAudit({
    simTable,
    inputs,
    pointsBySeriesKey,
    lang: "it",
    probOptions,
  });

  const monitor = buildSuggestionMonitorRows({
    simTable,
    inputs,
    pointsBySeriesKey,
    lang: "it",
    probOptions,
    paperPortfolio: [],
  });

  const buyTickers = new Set(
    monitor.filter((r) => r.suggestedAction === "buy").map((r) => r.ticker),
  );

  console.log("\n=== OPPORTUNITÀ 24H vs RACCOMANDAZIONI ===\n");
  console.log(
    `Gainers 24h: ${missed.gainersN} · Raccomandati+tenuti (chart): ${missed.detectedN + missed.heldGainerN} · Recall op: ${missed.recallPct ?? "—"}%`,
  );
  console.log(
    `Monitor BUY: ${buyTickers.size} · Perse (no buy): ${missed.missedN} · Watch perse: ${missed.watchMissedN} · CD lontano: ${missed.cdDistantGainerN} · Già tenuti: ${missed.heldGainerN}`,
  );

  console.log("\n--- Barre coverage (come dashboard) ---");
  for (const bar of missed.chartBars) {
    console.log(`  ${bar.labelIt}: ${bar.count}`);
  }

  const blockerCounts = aggregateBlockerKinds(missed.missedRows);
  console.log("\n--- Blocker sulle PERSE (operational) ---");
  for (const [kind, n] of Object.entries(blockerCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
    console.log(`  ${kind}: ${n}`);
  }

  console.log("\n--- Gainers 24h: buy sì/no ---");
  const gainers = [
    ...missed.detectedRows,
    ...missed.missedRows,
    ...missed.heldGainerN > 0
      ? missed.chartBars
          .flatMap(() => [])
      : [],
  ];
  const allGainerRows = [
    ...missed.detectedRows,
    ...missed.missedRows,
    ...missed.cdDistantRows,
    ...missed.watchMissedRows,
    ...missed.watchDetectedRows,
  ];
  const seen = new Set<string>();
  for (const row of allGainerRows.sort((a, b) => b.dailyPct24h - a.dailyPct24h)) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const mon = monitor.find((m) => m.key === row.key);
    const monBuy = mon?.suggestedAction === "buy";
    console.log(
      `\n${row.ticker}  +${row.dailyPct24h.toFixed(1)}%  T-${row.daysToCd}d  audit=${row.suggested ? "OK" : "MISS"}  monitor=${monBuy ? "BUY" : "—"}`,
    );
    console.log(
      `  exit=${row.exitDecision}  P=${row.probPct?.toFixed(0) ?? "—"}%  target=${row.planReturnPct != null ? `+${row.planReturnPct.toFixed(1)}%` : "—"}`,
    );
    if (row.blockers.length) console.log(`  blockers: ${row.blockers.join(" · ")}`);
  }

  const outPath = path.join(DATA, "diag_missed_vs_recommendations.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        missed_summary: {
          gainersN: missed.gainersN,
          detectedN: missed.detectedN,
          missedN: missed.missedN,
          recallPct: missed.recallPct,
          heldGainerN: missed.heldGainerN,
          cdDistantGainerN: missed.cdDistantGainerN,
          watchMissedN: missed.watchMissedN,
        },
        monitor_buy_count: buyTickers.size,
        monitor_buy_tickers: [...buyTickers].sort(),
        blocker_counts: blockerCounts,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nJSON → ${outPath}`);
}

main();
