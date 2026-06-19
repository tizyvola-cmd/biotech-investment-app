/**
 * Audit raccomandazioni buy/sell — bucket per ticker + focus CRDF/WVE/TELA.
 * Run: npx tsx scripts/diag-recommendation-buckets.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildSuggestionMonitorRows } from "../src/sheet/suggestionMonitor";
import {
  classifyRecommendationBucket,
  type RecommendationBucket,
} from "../src/sheet/investDecisionSimLoop";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { isRecommendedAction } from "../src/sheet/suggestionMonitor";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");
const FOCUS = new Set(["CRDF", "WVE", "TELA", "ENGNW", "BNTX", "AGIO", "BCAB"]);

const BUCKET_LABEL: Record<RecommendationBucket, string> = {
  buy: "BUY raccomandato",
  sell: "SELL raccomandato",
  hold: "HOLD (in portafoglio)",
  already_paper: "Già paper — no nuovo buy",
  already_portfolio: "Già portafoglio — no nuovo buy",
  top2_no_precat_avoid: "Top2 no · precat avoid",
  top2_no: "Top2 no · altro",
  top2_wait: "Top2 wait · timing/ROI",
  yes_exit_low_p: "Top2 yes · exit · P(plan) < 40%",
  yes_exit_prob: "Top2 yes · exit probabilistico",
  other: "Altro / gate intermedio",
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

  const rows = buildSuggestionMonitorRows({
    simTable,
    inputs,
    pointsBySeriesKey,
    lang: "it",
    probOptions: { sdsRows, migSolidityByKey },
    paperPortfolio: [],
  });

  const itemsByKey = new Map<string, ReturnType<typeof buildLossAnalysisItems>[number]>();
  for (const profile of ["portfolio", "opportunities"] as const) {
    for (const it of buildLossAnalysisItems(
      profile,
      simTable,
      inputs,
      pointsBySeriesKey,
      "it",
      null,
      { sdsRows, migSolidityByKey },
      profile === "opportunities" ? "hot" : undefined,
    )) {
      itemsByKey.set(it.key, it);
    }
  }

  const buckets = new Map<RecommendationBucket, string[]>();
  for (const row of rows) {
    const item = itemsByKey.get(row.key);
    const bucket: RecommendationBucket = item
      ? classifyRecommendationBucket(item, row.inPaperPortfolio, row.suggestedAction)
      : row.suggestedAction === "buy"
        ? "buy"
        : row.suggestedAction === "sell"
          ? "sell"
          : row.suggestedAction === "hold"
            ? "hold"
            : "other";
    const list = buckets.get(bucket) ?? [];
    list.push(row.ticker);
    buckets.set(bucket, list);
  }

  const nRec = rows.filter((r) => isRecommendedAction(r.suggestedAction)).length;
  const nBuy = rows.filter((r) => r.suggestedAction === "buy").length;
  const nSell = rows.filter((r) => r.suggestedAction === "sell").length;

  console.log("\n=== AUDIT RACCOMANDAZIONI ===");
  console.log(`Ticker totali: ${rows.length} · Raccomandazioni: ${nRec} (${nBuy} buy + ${nSell} sell)`);
  console.log("\n--- Bucket ---");
  for (const [bucket, tickers] of [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`\n${BUCKET_LABEL[bucket]} (${tickers.length})`);
    console.log(`  ${tickers.sort().join(", ")}`);
  }

  console.log("\n--- Focus CRDF / WVE / TELA / candidati wait ---");
  for (const row of rows.filter((r) => FOCUS.has(r.ticker.toUpperCase()))) {
    const item = itemsByKey.get(row.key);
    const bucket = item
      ? classifyRecommendationBucket(item, row.inPaperPortfolio, row.suggestedAction)
      : "other";
    console.log(
      `\n${row.ticker}  prof=${row.profile}  rec=${row.suggestedAction.toUpperCase()}  bucket=${BUCKET_LABEL[bucket as RecommendationBucket]}`,
    );
    console.log(
      `  Top2=${row.investVerdict}  exit=${row.exitDecision}  P=${row.probPct != null ? Math.round(row.probPct) : "—"}%  precat=${row.readings.precatKind}  target=${row.planReturnPct != null ? `+${row.planReturnPct.toFixed(1)}%` : "—"}`,
    );
    if (row.buyBlockReason) console.log(`  Blocco: ${row.buyBlockReason}`);
  }

  const outPath = path.join(DATA, "diag_recommendation_buckets.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        n_tickers: rows.length,
        n_recommendations: nRec,
        n_buy: nBuy,
        n_sell: nSell,
        buckets: Object.fromEntries(
          [...buckets.entries()].map(([k, v]) => [k, { label: BUCKET_LABEL[k], tickers: v.sort() }]),
        ),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nJSON → ${outPath}`);
}

main();
