/**
 * Perf benchmark — hot paths (run: npx tsx scripts/bench-processing-hotpaths.ts)
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildMissedOpportunityAudit } from "../src/sheet/missedOpportunityAudit";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { buildMigSolidityByKey as buildMig2 } from "../src/sheet/entrySolidityMig";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(f: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")) as T;
}

function ms(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const dt = performance.now() - t0;
  console.log(`${label}: ${dt.toFixed(0)} ms`);
  return dt;
}

function main() {
  const simTable = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const table: SheetTable = {
    sheet: "Simulation",
    columns: simTable.columns ?? [],
    rows: simTable.rows ?? [],
  };
  const inputs = readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);

  console.log(`Rows ${table.rows?.length ?? 0} · chart series ${Object.keys(charts.series ?? {}).length}\n`);

  let migMap: ReturnType<typeof buildMigSolidityByKey>;
  ms("buildMigSolidityByKey (1x)", () => {
    migMap = buildMigSolidityByKey(table, charts, sdsRows);
  });
  ms("buildMigSolidityByKey (2x duplicate)", () => {
    buildMig2(table, charts, sdsRows);
  });

  const probOptions = { sdsRows, migSolidityByKey: migMap! };

  ms("buildMissedOpportunityAudit", () => {
    buildMissedOpportunityAudit({
      simTable: table,
      inputs,
      pointsBySeriesKey,
      lang: "it",
      probOptions,
    });
  });

  ms("buildLossAnalysisItems portfolio", () => {
    buildLossAnalysisItems("portfolio", table, inputs, pointsBySeriesKey, "it", null, probOptions);
  });

  ms("buildLossAnalysisItems opportunities", () => {
    buildLossAnalysisItems("opportunities", table, inputs, pointsBySeriesKey, "it", null, probOptions);
  });

  ms("buildLossAnalysisItems BOTH (current UI pattern)", () => {
    buildLossAnalysisItems("portfolio", table, inputs, pointsBySeriesKey, "it", null, probOptions);
    buildLossAnalysisItems("opportunities", table, inputs, pointsBySeriesKey, "it", null, probOptions);
  });
}

main();
