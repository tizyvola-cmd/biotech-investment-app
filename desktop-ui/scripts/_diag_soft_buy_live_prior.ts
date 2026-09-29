/** npx tsx scripts/_diag_soft_buy_live_prior.ts — Soft BUY with live Yahoo prior */
import fs from "node:fs";
import path from "node:path";
import { softBuyWindRunHit } from "../src/sheet/continuationScore";
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
import {
  buildPriorSessionPctByTicker,
  sessionReturnPctFromIntradayBlock,
} from "../src/sheet/softBuyRisingStreak";
import type { SheetTable, ChartBundle } from "../src/types";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import type { Intraday1hPayload, SdsRow } from "../src/api/supernova";

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

const tickers = [
  ...new Set(
    opp
      .filter((i) => !i.hasPosition && !isWarrantTicker(i.ticker))
      .map((i) => i.ticker.toUpperCase()),
  ),
].slice(0, 80);

const priorFilePath = path.resolve(
  import.meta.dirname,
  "_tmp_prior_map.json",
);
let priorMap = new Map<string, number>();
let apiLive: string | null = null;
let apiPrior: string | null = null;
let payload: Intraday1hPayload | null = null;
if (fs.existsSync(priorFilePath)) {
  const priorFile = JSON.parse(fs.readFileSync(priorFilePath, "utf8")) as {
    live?: string | null;
    prior?: string | null;
    prior_pct?: Record<string, number>;
  };
  apiLive = priorFile.live ?? null;
  apiPrior = priorFile.prior ?? null;
  priorMap = new Map(
    Object.entries(priorFile.prior_pct ?? {}).map(([k, v]) => [
      k.toUpperCase(),
      Number(v),
    ]),
  );
} else {
  const apiBase = process.env.SUPERNOVA_API || "http://127.0.0.1:8765";
  const q = tickers.join(",");
  const res = await fetch(
    `${apiBase}/api/market/intraday-1h?tickers=${encodeURIComponent(q)}&force=true`,
  );
  if (!res.ok) {
    console.error("intraday fetch failed", res.status, await res.text());
    process.exit(1);
  }
  payload = (await res.json()) as Intraday1hPayload;
  apiLive = payload.live?.session_date ?? null;
  apiPrior = payload.prior?.session_date ?? null;
  priorMap = buildPriorSessionPctByTicker(payload);
}

const buys: string[] = [];
const blocked: Array<{ t: string; why: string; day: number | null; prior: number | null }> =
  [];
let g1n = 0;
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
  g1n += 1;
  const tk = item.ticker.toUpperCase();
  const prior = priorMap.get(tk) ?? null;
  const priorSessionPcts = prior != null ? [prior] : undefined;
  const dayOk = softBuyDayNotRed(item, day);
  const wind = softBuyWindRunHit(row);
  const rise = softBuyRisingStreakAllows(item, day, {
    simRow: row,
    chartPts: null,
    priorSessionPcts,
  });
  const tape = softBuyTapeNotCatastrophic(item, day);
  const action = deriveSuggestedAction(item, false, null, null, {
    simRow: row,
    chartPts: null,
    priorSessionPcts,
  });
  if (action === "buy") buys.push(tk);
  else {
    let why = action;
    if (!dayOk) why = "red_day";
    else if (!tape) why = "tape";
    else if (!rise && !wind) why = "rising";
    blocked.push({ t: tk, why, day, prior });
  }
}

console.log(
  JSON.stringify(
    {
      apiLive,
      apiPrior,
      priorMapSize: priorMap.size,
      g1OffBook: g1n,
      buys,
      buyCount: buys.length,
      blockedRising: blocked.filter((b) => b.why === "rising").slice(0, 15),
      samplePrior: ["BBNX", "GILD", "CERS", "INBX"].map((t) => ({
        t,
        prior: priorMap.get(t) ?? null,
        yahooPrior: payload
          ? sessionReturnPctFromIntradayBlock(payload.prior, t)
          : null,
        yahooLive: payload
          ? sessionReturnPctFromIntradayBlock(payload.live, t)
          : null,
      })),
    },
    null,
    2,
  ),
);
