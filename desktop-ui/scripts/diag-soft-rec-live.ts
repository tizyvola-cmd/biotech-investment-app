/**
 * Live Soft BUY / Soft+Urgent SELL list (new REC logic).
 * Run: cd desktop-ui && npx tsx scripts/diag-soft-rec-live.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { deriveSuggestedAction } from "../src/sheet/investDecisionSimLoop";
import {
  buildDecisionChartRow,
  resolveRegSignedScoreForTicker,
} from "../src/sheet/decisionChartBuild";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../src/hooks/useLossRiskCatalog";
import {
  evaluateSoftBuyGrade1,
  evaluateSoftSellGrade1,
  evaluateUrgentSellGrade2Book,
} from "../src/sheet/softSignalGrades";
import { priorSessionDayPnlByKey } from "../src/sheet/urgentSellBookLegs";
import { buildSimRowByKeyMap } from "../src/sheet/investSimKeys";
import { loadMarketContextSnapshot } from "../src/sheet/marketContextScore";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJsonOptional<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
function readJson<T>(file: string): T {
  const v = readJsonOptional<T>(file);
  if (v == null) throw new Error(`Missing: ${path.join(DATA, file)}`);
  return v;
}

const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
  "simulation_sheet_snapshot.json",
);
const simTable: SheetTable = {
  sheet: "Simulation",
  columns: simSnap.columns ?? [],
  rows: simSnap.rows ?? [],
};
const inputs =
  readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
const history =
  readJsonOptional<{ history?: InvestSimHistoryPoint[] }>("invest_sim_history.json")
    ?.history ?? [];
const sdsRows = readJsonOptional<{ rows?: SdsRow[] }>("sds_snapshot.json")?.rows ?? [];
const charts =
  readJsonOptional<ChartBundle>("simulation_charts_snapshot.json") ??
  ({ series: {} } as ChartBundle);
const autoReg = readJsonOptional<RegulatoryRiskSnapshot>("regulatory_risk_snapshot.json");
const closedRows =
  readJsonOptional<{ rows?: SimOutcomeRow[] }>("investment_sim_outcomes.json")?.rows ?? [];

const points = chartPointsMapFromBundle(charts);
const mig = buildMigSolidityByKey(simTable, charts, sdsRows);
const mcsDoc = loadMarketContextSnapshot();
const { catalog, catalogByRowKey } = buildLossRiskCatalogSync({
  simTable,
  inputs,
  chartBundle: charts,
  sdsRows,
  closedRows,
  lang: "en",
});
const rowByKey = buildSimRowByKeyMap(simTable.rows);

const port = buildLossAnalysisItems(
  "portfolio",
  simTable,
  inputs,
  points,
  "en",
  history,
  { migSolidityByKey: mig, sdsRows },
);
const opp = buildLossAnalysisItems(
  "opportunities",
  simTable,
  inputs,
  points,
  "en",
  history,
  { migSolidityByKey: mig, sdsRows },
  "all",
);
const byKey = new Map([...port, ...opp].map((i) => [i.key, i]));

const open = [...byKey.values()].filter((i) => i.hasPosition);
const prior = priorSessionDayPnlByKey(
  history,
  open.map((i) => i.key),
);
const urgent = evaluateUrgentSellGrade2Book(
  open.map((i) => ({
    key: i.key,
    ticker: i.ticker,
    dayPnlEur:
      Math.round(((i.pnlEur24h ?? 0) + (prior.get(i.key) ?? 0)) * 100) / 100,
    dayPnlPct: i.pnlPct24h ?? null,
    totalPnlPct: i.pnlPct ?? null,
  })),
);

type Row = {
  ticker: string;
  action: string;
  rule: string;
  p: number | null;
  sds: number | null;
  pnl: number | null;
  day: number | null;
  softBuy: boolean;
  softSell: boolean;
  urgent: boolean;
};

const buys: Row[] = [];
const sells: Row[] = [];

for (const item of byKey.values()) {
  const simRow = rowByKey.get(item.key) ?? null;
  const lossRisk =
    lookupLossRiskByRowKey(catalogByRowKey, item.key) ??
    lookupLossRisk(catalog, item.ticker);
  const regSigned = resolveRegSignedScoreForTicker(item.ticker, simRow, autoReg);
  const enhance = {
    urgentSellG2Keys: urgent.urgentKeys,
    riskV2: lossRisk?.riskScore ?? null,
    regRisk: null as number | null,
    regulatoryRiskScore: null as number | null,
  };
  // reg from chart row builder
  const built = buildDecisionChartRow({
    item,
    lossRisk,
    regSignedScore: regSigned,
    mcsDoc,
    simRow,
    lang: "en",
    suggestedAction: "review",
    urgentSellG2: urgent.urgentKeys.has(item.key),
  });
  enhance.regRisk = built.scores.regRisk;
  enhance.regulatoryRiskScore = built.scores.regRisk;

  const action = deriveSuggestedAction(item, false, null, null, {
    ...enhance,
    simRow,
  });
  const chart = buildDecisionChartRow({
    item,
    lossRisk,
    regSignedScore: regSigned,
    mcsDoc,
    simRow,
    lang: "en",
    suggestedAction: action,
    urgentSellG2: urgent.urgentKeys.has(item.key),
  });

  const softBuy = evaluateSoftBuyGrade1({
    hasPosition: Boolean(item.hasPosition),
    sdsScore: item.sdsScore,
    pplan: item.recoveryProbabilityPct,
  }).hit;
  const softSell = evaluateSoftSellGrade1({
    hasPosition: Boolean(item.hasPosition),
    pnlPct: item.pnlPct,
    pplan: item.recoveryProbabilityPct,
    riskV2: enhance.riskV2,
    regRisk: enhance.regRisk,
    investedAt: item.investedAt,
  }).hit;
  const urgentHit = urgent.urgentKeys.has(item.key);

  const row: Row = {
    ticker: item.ticker,
    action: chart.rec,
    rule: chart.recExplanation?.trigger ?? action,
    p: item.recoveryProbabilityPct,
    sds: item.sdsScore,
    pnl: item.pnlPct,
    day: item.pnlPct24h,
    softBuy,
    softSell,
    urgent: urgentHit,
  };
  if (chart.rec === "buy" && !item.hasPosition) buys.push(row);
  if (chart.rec === "sell" && item.hasPosition) sells.push(row);
}

buys.sort((a, b) => a.ticker.localeCompare(b.ticker));
sells.sort((a, b) => a.ticker.localeCompare(b.ticker));

const out = { buys, sells, urgentHits: urgent.hits };
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(DATA, "diag_soft_rec_live.json"), JSON.stringify(out, null, 2));
console.error(`BUY (${buys.length}): ${buys.map((b) => b.ticker).join(", ") || "—"}`);
console.error(`SELL (${sells.length}): ${sells.map((s) => s.ticker).join(", ") || "—"}`);
console.error(
  `Urgent G2: ${urgent.hits.map((h) => h.ticker).join(", ") || "—"} · budget €${Math.round(urgent.budgetEur)}`,
);
