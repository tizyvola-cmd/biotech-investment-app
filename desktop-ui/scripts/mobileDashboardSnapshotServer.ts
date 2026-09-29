/**
 * Build mobile dashboard snapshot from on-disk JSON (post-refresh / VPS).
 * CLI-only — not part of the browser/Electron bundle (uses node:fs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEisSuperScoreState } from "../src/api/eisSuperScore";
import { buildMobileDashboardSnapshot, type MobileDashboardSnapshot } from "../src/api/mobileDashboardSnapshot";
import {
  isDegradedSdsSnapshot,
  type ClinicalPreCdRecord,
  type SdsCohortPayload,
  type SdsRow,
} from "../src/api/supernova";
import {
  countRecentPastEvents,
  flattenAiFeed,
  rankAndSliceFeed,
  type DashboardAiFeedTickerMeta,
} from "../src/sheet/dashboardAiFeedBuild";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { reconcileInvestSimInputs } from "../src/sheet/investSimKeys";
import {
  sanitizeInvestSimInputs,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "../src/sheet/investSimStorage";
import { refCurvesFromChartBundle } from "../src/sheet/predictionGuide";
import { daysToCdFromSimRow } from "../src/sheet/sdsCohortScope";
import { filterOffPortfolioHotZoneSimRows } from "../src/sheet/simCdHorizonScope";
import { aggregateOpenPortfolioPnl, rowHasActivePortfolio } from "../src/sheet/simulationPosition";
import { guideCurvesToRefMap } from "../src/sheet/sdsRoiBlend";
import type { RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { MarketContextSnapshotDoc } from "../src/sheet/marketContextScore";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";
import { closedValidationOutcomeRowsFromDoc } from "../src/sheet/simOutcomeCycleDedup";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import { mergeManualEventsIntoRecords } from "../src/sheet/manualFeedEvents";
import type { ManualFeedStoreFile } from "../src/sheet/manualFeedPersistence";
import { toGainStarDisplay, type GainStarEntry } from "../src/sheet/gainStarLedger";

function gainStarsFromDiskLedger(
  ledger: Record<string, GainStarEntry[]> | undefined,
): Record<string, ReturnType<typeof toGainStarDisplay>[]> {
  if (!ledger) return {};
  const out: Record<string, ReturnType<typeof toGainStarDisplay>[]> = {};
  for (const [tk, entries] of Object.entries(ledger)) {
    const list = Array.isArray(entries) ? entries : [];
    const active = list[list.length - 1];
    if (active) out[tk.trim().toUpperCase()] = [toGainStarDisplay(active)];
  }
  return out;
}

function readJson<T>(dir: string, file: string): T | null {
  const p = join(dir, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function readSdsFromDir(dataDir: string): SdsRow[] | null {
  const files = ["sds_snapshot.last_good.json", "sds_snapshot.json"];
  for (const file of files) {
    const doc = readJson<SdsCohortPayload>(dataDir, file);
    if (doc?.rows?.length && !isDegradedSdsSnapshot(doc)) return doc.rows;
  }
  for (const file of files) {
    const doc = readJson<SdsCohortPayload>(dataDir, file);
    if (doc?.rows?.length) return doc.rows;
  }
  return null;
}

function tickerFromRow(row: Record<string, unknown>): string {
  return String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
}

export function buildMobileDashboardSnapshotFromDataDir(
  dataDir: string,
  opts?: { lang?: "it" | "en" },
): MobileDashboardSnapshot | null {
  const lang = opts?.lang === "en" ? "en" : "it";

  const simSnap = readJson<{ rows?: SheetTable["rows"]; columns?: string[] }>(
    dataDir,
    "simulation_sheet_snapshot.json",
  );
  if (!simSnap?.rows?.length) return null;

  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows,
  };

  const chartBundle = readJson<ChartBundle>(dataDir, "simulation_charts_snapshot.json");
  const inputsRaw = readJson<{ inputs?: InvestSimInputs }>(dataDir, "invest_sim_inputs.json");
  const historyRaw = readJson<{ history?: InvestSimHistoryPoint[] }>(dataDir, "invest_sim_history.json");
  const loaded = sanitizeInvestSimInputs(inputsRaw?.inputs ?? {});
  const inputs = reconcileInvestSimInputs(loaded, simTable.rows);
  const history = historyRaw?.history ?? [];

  const sdsRows = readSdsFromDir(dataDir);
  const migSolidityByKey = buildMigSolidityByKey(simTable, chartBundle, sdsRows);
  const eisRaw = readJson<Record<string, unknown>>(dataDir, "eis_super_score_learning.json");
  const eisState = parseEisSuperScoreState(eisRaw);

  const refCurves = guideCurvesToRefMap(refCurvesFromChartBundle(chartBundle).curves);

  const portfolioRows = simTable.rows.filter((r) => rowHasActivePortfolio(r, inputs));
  const opportunityRows = filterOffPortfolioHotZoneSimRows(simTable.rows, inputs);
  const totalCapital = aggregateOpenPortfolioPnl(simTable, inputs, history).capital;

  const clinicalSnap = readJson<{ records?: ClinicalPreCdRecord[] }>(
    dataDir,
    "clinical_pre_cd_enrichment_snapshot.json",
  );
  const clinicalRecordsRaw = clinicalSnap?.records ?? [];
  const manualStore = readJson<ManualFeedStoreFile>(dataDir, "manual_feed_store.json");
  const manualDrafts = manualStore?.events ?? [];
  const clinicalRecords = mergeManualEventsIntoRecords(clinicalRecordsRaw, manualDrafts);

  const feedScopeTickers = new Set<string>();
  const feedTickerMeta = new Map<string, DashboardAiFeedTickerMeta>();
  for (const r of portfolioRows) {
    const tk = tickerFromRow(r);
    if (!tk || tk.includes("TOTALE")) continue;
    feedScopeTickers.add(tk);
    feedTickerMeta.set(tk, {
      inPortfolio: true,
      daysToCd: daysToCdFromSimRow(r),
    });
  }
  for (const r of opportunityRows) {
    const tk = tickerFromRow(r);
    if (!tk || tk.includes("TOTALE")) continue;
    feedScopeTickers.add(tk);
    if (!feedTickerMeta.has(tk)) {
      feedTickerMeta.set(tk, {
        inPortfolio: false,
        daysToCd: daysToCdFromSimRow(r),
      });
    }
  }
  for (const draft of manualDrafts) {
    const tk = String(draft.ticker ?? "").trim().toUpperCase();
    if (tk) feedScopeTickers.add(tk);
  }
  const allFeedItems = flattenAiFeed(clinicalRecords, feedScopeTickers, feedTickerMeta);
  const aiFeed = rankAndSliceFeed(allFeedItems, 10);
  const aiFeedRecentCount = countRecentPastEvents(allFeedItems);

  const autoRegSnap = readJson<RegulatoryRiskSnapshot>(dataDir, "regulatory_risk_snapshot.json");
  const mcsDoc = readJson<MarketContextSnapshotDoc>(dataDir, "market_context_snapshot.json");
  const outcomesDoc = readJson<{ rows?: SimOutcomeRow[] }>(dataDir, "investment_sim_outcomes.json");
  const closedRows = closedValidationOutcomeRowsFromDoc(outcomesDoc ?? { rows: [] });
  const { catalog: lossRiskCatalog, catalogByRowKey } = buildLossRiskCatalogSync({
    simTable,
    inputs,
    chartBundle,
    sdsRows,
    closedRows,
    lang,
  });

  const snapshot = buildMobileDashboardSnapshot({
    simTable,
    inputs,
    history,
    chartBundle,
    probOptions: {
      sdsRows,
      migSolidityByKey,
      eisSuperScoreState: eisState,
      polygonOverview: null,
      lightweightPolygon: true,
      mergedInputs: inputs,
    },
    simTableVersion: null,
    portfolioRows,
    opportunityRows,
    totalCapital,
    aiFeed,
    aiFeedRecentCount,
    lang,
    refCurves,
    autoRegSnap,
    mcsDoc,
    clinicalPreCdRecords: clinicalRecords,
    lossRiskCatalog,
    catalogByRowKey,
  });

  const diskStars = gainStarsFromDiskLedger(manualStore?.gain_star_ledger);
  return {
    ...snapshot,
    gainStarsByTicker: { ...(snapshot.gainStarsByTicker ?? {}), ...diskStars },
  };
}
