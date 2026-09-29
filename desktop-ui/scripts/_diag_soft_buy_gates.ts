/** npx tsx scripts/_diag_soft_buy_gates.ts */
import fs from "node:fs";
import path from "node:path";
import {
  softBuyWindRunHit,
  resolveDisplayPContinuation,
  resolveContG10,
  resolveContSellEdge,
} from "../src/sheet/continuationScore";
import {
  deriveSuggestedAction,
  softBuyDayNotRed,
  softBuyRisingStreakAllows,
  softBuyTapeNotCatastrophic,
} from "../src/sheet/investDecisionSimLoop";
import { evaluateSoftBuyGrade1 } from "../src/sheet/softSignalGrades";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { dailyChangePctFromRow, isWarrantTicker } from "../src/sheet/simulationPosition";
import type { SheetTable, ChartBundle } from "../src/types";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import type { SdsRow } from "../src/api/supernova";

const root = path.resolve(import.meta.dirname, "../../data");
const simRaw = JSON.parse(
  fs.readFileSync(path.join(root, "simulation_sheet_snapshot.json"), "utf8"),
);
const inputs = JSON.parse(
  fs.readFileSync(path.join(root, "invest_sim_inputs.json"), "utf8"),
).inputs as InvestSimInputs;
const simTable = {
  sheet: "Simulation",
  rows: simRaw.rows ?? [],
  columns: [],
} as SheetTable;
const sdsRows = (
  JSON.parse(fs.readFileSync(path.join(root, "sds_snapshot.json"), "utf8")).rows ??
  []
) as SdsRow[];
let chartBundle: ChartBundle | null = null;
try {
  chartBundle = JSON.parse(
    fs.readFileSync(path.join(root, "simulation_charts_snapshot.json"), "utf8"),
  );
} catch {
  /* optional */
}
const points = chartPointsMapFromBundle(chartBundle ?? ({ series: {} } as ChartBundle));
const mig = buildMigSolidityByKey(simTable, chartBundle, sdsRows);
const opp = buildLossAnalysisItems(
  "opportunities",
  simTable,
  inputs,
  points,
  "en",
  null,
  { migSolidityByKey: mig, sdsRows },
  "all",
);

type Row = {
  t: string;
  day: number | null;
  g1: boolean;
  dayOk: boolean;
  wind: boolean;
  rise: boolean;
  risePrior: boolean;
  tape: boolean;
  pDisp: number | null;
  g10: number | null;
  edge: number | null;
  a0: string;
  a1: string;
  p: number | null;
  sds: number | null;
};

const rows: Row[] = [];
for (const item of opp) {
  if (item.hasPosition || isWarrantTicker(item.ticker)) continue;
  const row =
    simTable.rows.find(
      (r) => String(r.Ticker ?? "").toUpperCase() === item.ticker.toUpperCase(),
    ) ?? null;
  const day = row ? dailyChangePctFromRow(row) : item.pnlPct24h;
  const g1 = evaluateSoftBuyGrade1({
    hasPosition: false,
    sdsScore: item.sdsScore,
    pplan: item.recoveryProbabilityPct,
  }).hit;
  if (!g1) continue;
  const dayOk = softBuyDayNotRed(item, day);
  const wind = softBuyWindRunHit(row);
  const rise = softBuyRisingStreakAllows(item, day, {
    simRow: row,
    chartPts: null,
  });
  const risePrior = softBuyRisingStreakAllows(item, day, {
    simRow: row,
    chartPts: null,
    priorSessionPcts: [1.5],
  });
  const tape = softBuyTapeNotCatastrophic(item, day);
  const a0 = deriveSuggestedAction(item, false, null, null, {
    simRow: row,
    chartPts: null,
  });
  const a1 = deriveSuggestedAction(item, false, null, null, {
    simRow: row,
    chartPts: null,
    priorSessionPcts: [1.5],
  });
  rows.push({
    t: item.ticker,
    day,
    g1,
    dayOk,
    wind,
    rise,
    risePrior,
    tape,
    pDisp: resolveDisplayPContinuation(row),
    g10: resolveContG10(row),
    edge: resolveContSellEdge(row),
    a0,
    a1,
    p: item.recoveryProbabilityPct,
    sds: item.sdsScore,
  });
}

const buy0 = rows.filter((r) => r.a0 === "buy").map((r) => r.t);
const buy1 = rows.filter((r) => r.a1 === "buy").map((r) => r.t);
const windGreen = rows.filter((r) => r.wind && r.dayOk);
const blockedRise = rows.filter(
  (r) => r.g1 && r.dayOk && r.tape && !r.rise && !r.wind && r.a1 === "buy",
);

console.log(
  JSON.stringify(
    {
      g1OffBook: rows.length,
      buyNoPrior: buy0,
      buyWithFakePrior: buy1,
      windAndGreenDay: windGreen.map((r) => ({
        t: r.t,
        day: r.day,
        pDisp: r.pDisp,
        g10: r.g10,
        a0: r.a0,
      })),
      wouldBuyIfPriorGreen: blockedRise.map((r) => r.t),
      sampleNoPrior: rows
        .filter((r) => r.dayOk)
        .slice(0, 12)
        .map((r) => ({
          t: r.t,
          day: r.day,
          wind: r.wind,
          rise: r.rise,
          pDisp: r.pDisp,
          a0: r.a0,
          a1: r.a1,
        })),
    },
    null,
    2,
  ),
);
