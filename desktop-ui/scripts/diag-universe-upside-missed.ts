/**
 * One-shot: $5k equal-weight 24h universe upside — in-PF vs off-book,
 * signal dump per riser, and WHY missed (rec / SDS / opportunity filters / BUY gates).
 *
 * Run from desktop-ui:
 *   npx tsx scripts/diag-universe-upside-missed.ts
 *
 * Inputs (under repo data/):
 *   - simulation_sheet_snapshot.json (required)
 *   - invest_sim_inputs.json (optional; falls back to sheet Capitale > 0)
 *   - sds_snapshot.json, simulation_charts_snapshot.json (optional enrichers)
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey, migSolidityKey } from "../src/sheet/entrySolidityMig";
import {
  buildSimUniverse24hWhatIf,
  SIM_UNIVERSE_WHATIF_CAPITAL,
} from "../src/sheet/simUniverse24hWhatIf";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import { parseNum, rowHasActivePortfolio } from "../src/sheet/simulationPosition";
import { daysFromToday } from "../src/sheet/simulationPlanGain";
import { clinicalPhaseFromSimRow } from "../src/sheet/simRowClinicalMeta";
import {
  filterOffPortfolioByCdHorizonSimRows,
  filterOffPortfolioHotZoneSimRows,
} from "../src/sheet/simCdHorizonScope";
import { isHotZone, isWatchZone } from "../src/sheet/cdHorizons";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  explainBuyBlockReason,
  qualifiesStrictOpportunityBuy,
  SIM_LOOP_BUY_PROB_MIN,
  STUDY_EVIDENCE_EIS_MIN,
  STUDY_EVIDENCE_SDS_MIN,
} from "../src/sheet/investDecisionSimLoop";
import {
  buildDecisionScoreInput,
  resolveRegSignedScoreForTicker,
} from "../src/sheet/decisionChartBuild";
import {
  getRecommendation,
  resolveDecisionChartRec,
  type DecisionScoreInput,
} from "../src/sheet/decisionChartLogic";
import { SDS_SCORE_BANDS, sdsBandForScore } from "../src/sheet/sdsPredictionAccuracyCompute";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../src/hooks/useLossRiskCatalog";
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
  if (v == null) throw new Error(`Missing required data file: ${path.join(DATA, file)}`);
  return v;
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtSigned(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function pickRowNum(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (k in row) {
      const n = parseNum(row[k]);
      if (n != null) return n;
    }
  }
  // Fuzzy: column names often contain newlines
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = keys.map(norm);
  for (const [col, val] of Object.entries(row)) {
    const c = norm(col);
    if (wanted.some((w) => c === w || c.includes(w))) {
      const n = parseNum(val);
      if (n != null) return n;
    }
  }
  return null;
}

function pickRowStr(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    if (k in row) {
      const s = String(row[k] ?? "").trim();
      if (s && s !== "—") return s;
    }
  }
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = keys.map(norm);
  for (const [col, val] of Object.entries(row)) {
    const c = norm(col);
    if (wanted.some((w) => c === w || c.includes(w))) {
      const s = String(val ?? "").trim();
      if (s && s !== "—") return s;
    }
  }
  return null;
}

/** Sheet capital > 0 proxy when invest inputs missing / empty for a row. */
function sheetCapitalActive(row: Record<string, unknown>): boolean {
  const cap =
    parseNum(row["Capitale Investito ($)"]) ??
    parseNum(row["Capitale"]) ??
    pickRowNum(row, "capitale investito", "capitale");
  return cap != null && cap > 0;
}

function loadInputsWithFallback(simTable: SheetTable): {
  inputs: InvestSimInputs;
  source: "invest_sim_inputs.json" | "sheet_capital_proxy";
  nActive: number;
} {
  const raw = readJsonOptional<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json");
  const inputs = raw?.inputs ?? {};
  let nActive = 0;
  for (const r of simTable.rows) {
    if (rowHasActivePortfolio(r, inputs)) nActive += 1;
  }
  if (nActive > 0) {
    return { inputs, source: "invest_sim_inputs.json", nActive };
  }
  // Infer portfolio from sheet Capitale > 0
  const proxy: InvestSimInputs = {};
  for (const r of simTable.rows) {
    const ticker = String(r.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    if (!sheetCapitalActive(r)) continue;
    const key = normalizedRowKey(ticker, String(r["Completion Date"] ?? "—"));
    const cap =
      parseNum(r["Capitale Investito ($)"]) ??
      pickRowNum(r, "capitale investito", "capitale") ??
      0;
    const buy =
      parseNum(r["Prezzo Acquisto ($)"]) ??
      pickRowNum(r, "prezzo acquisto", "buy") ??
      undefined;
    proxy[key] = {
      capital: cap,
      ...(buy != null && buy > 0 ? { buyPrice: buy } : {}),
    };
    nActive += 1;
  }
  return { inputs: proxy, source: "sheet_capital_proxy", nActive };
}

/** Mirror of diag-decision-chart-buy-gates classifyBuyBlocker. */
function classifyBuyBlocker(s: DecisionScoreInput): string {
  if (s.status === "closed") {
    if (s.pnlPct != null && s.pnlPct >= 5) return "would_buy_closed";
    return "closed_not_buy";
  }
  if (s.lowLiqNoise === true) return "low_liq_noise_review";
  if (s.regRisk !== null && s.regRisk >= 70) return "reg_veto_sell";
  if (s.isRescue) {
    if ((s.pplan !== null && s.pplan < 40) || (s.regRisk !== null && s.regRisk >= 45)) {
      return "rescue_sell";
    }
    return "rescue_blocks_buy";
  }
  if (s.pplan !== null && s.pplan >= 60) {
    if (s.riskV2 === null || s.riskV2 <= 40) return "would_buy_pplan";
    if (s.pplan < 65 && s.riskV2 <= 45) {
      if (s.regRisk === null || s.regRisk > 45) return "reg_swing_reg_gt45";
      return "would_buy_reg_swing";
    }
    return "pplan60_but_riskV2_gt40";
  }
  if (s.pnlPct != null && Number.isFinite(s.pnlPct) && s.pnlPct >= 5) {
    const setupOk =
      (s.pplan != null && s.pplan >= 50) || (s.sds != null && s.sds >= 50);
    if (!setupOk) return "pnl_buy_setup_weak";
    if (s.riskV2 != null && s.riskV2 > 45) return "pnl_buy_riskV2_gt45";
    if (s.regRisk != null && s.regRisk >= 65) return "pnl_buy_reg_ge65";
    return "would_buy_pnl_momentum";
  }
  if (s.pplan !== null && s.pplan >= 50) return "pplan_hold_band_50_59";
  if (s.pplan !== null && s.pplan < 40) return "pplan_sell_sub40";
  if (s.pplan === null) {
    if (s.sds !== null && s.sds >= 65) {
      if (s.riskV2 !== null && s.riskV2 > 35) return "sds65_but_riskV2_gt35";
      return "would_buy_sds";
    }
    if (s.sds !== null && s.sds >= 50) return "sds_hold_no_pplan";
    return "default_review_no_pplan";
  }
  return "pplan_40_49_review";
}

type RecBucket = "BUY" | "HOLD" | "REVIEW" | "SELL" | "UNCERTAIN" | "missing";

function recBucket(
  chartRec: string | null | undefined,
  opRec: string | null | undefined,
): RecBucket {
  const r = (chartRec ?? opRec ?? "").toLowerCase();
  if (r === "buy") return "BUY";
  if (r === "hold") return "HOLD";
  if (r === "review") return "REVIEW";
  if (r === "sell") return "SELL";
  if (!r) return "missing";
  return "UNCERTAIN";
}

function sdsBandLabel(sds: number | null | undefined): string {
  if (sds == null || !Number.isFinite(sds)) return "missing";
  return sdsBandForScore(sds).label;
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) ?? 0) + n);
}

function pad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function padL(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s;
}

async function main() {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows ?? [],
  };

  const { inputs, source: pfSource, nActive } = loadInputsWithFallback(simTable);
  const sdsRows = readJsonOptional<{ rows?: SdsRow[] }>("sds_snapshot.json")?.rows ?? [];
  const charts =
    readJsonOptional<ChartBundle>("simulation_charts_snapshot.json") ??
    ({ series: {} } as ChartBundle);
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const autoRegSnap =
    readJsonOptional<RegulatoryRiskSnapshot>("regulatory_risk_snapshot.json");
  const closedRows =
    readJsonOptional<{ rows?: SimOutcomeRow[] }>("investment_sim_outcomes.json")?.rows ??
    [];

  const whatIf = buildSimUniverse24hWhatIf(simTable, inputs, SIM_UNIVERSE_WHATIF_CAPITAL);
  if (!whatIf) {
    console.error("No simulation rows — abort.");
    process.exit(1);
  }

  const upside = whatIf.rows.filter((r) => r.pnlEur != null && r.pnlEur > 0);
  const upsideIn = upside.filter((r) => r.inPortfolio);
  const upsideOff = upside.filter((r) => !r.inPortfolio);

  // Opportunity filter sets (hot / watch / all monitor)
  const hotKeys = new Set(
    filterOffPortfolioHotZoneSimRows(simTable.rows, inputs).map((r) =>
      normalizedRowKey(
        String(r.Ticker ?? "").trim().toUpperCase(),
        String(r["Completion Date"] ?? ""),
      ),
    ),
  );
  const watchKeys = new Set(
    filterOffPortfolioByCdHorizonSimRows(simTable.rows, inputs, "watch").map((r) =>
      normalizedRowKey(
        String(r.Ticker ?? "").trim().toUpperCase(),
        String(r["Completion Date"] ?? ""),
      ),
    ),
  );
  const monitorKeys = new Set(
    filterOffPortfolioByCdHorizonSimRows(simTable.rows, inputs, "all").map((r) =>
      normalizedRowKey(
        String(r.Ticker ?? "").trim().toUpperCase(),
        String(r["Completion Date"] ?? ""),
      ),
    ),
  );

  // Loss-analysis items for rec / P(plan) / EIS / gates
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
  // Also pull watch-scope opps so off-book watch risers get items when possible
  for (const it of buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    "it",
    null,
    { sdsRows, migSolidityByKey },
    "watch",
  )) {
    if (!itemsByKey.has(it.key)) itemsByKey.set(it.key, it);
  }

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = normalizedRowKey(tk, String(r["Completion Date"] ?? ""));
    rowByKey.set(key, r as Record<string, unknown>);
  }

  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of sdsRows) {
    const t = String(s.ticker ?? "").trim().toUpperCase();
    if (t) sdsByTicker.set(t, s);
  }

  const { catalog: lossRiskCatalog, catalogByRowKey } = buildLossRiskCatalogSync({
    simTable,
    inputs,
    chartBundle: charts,
    sdsRows,
    closedRows,
    lang: "it",
  });

  type UpsideDiag = {
    ticker: string;
    key: string;
    company: string | null;
    inPF: boolean;
    pnlEur: number;
    dailyPct: number | null;
    rec: RecBucket;
    scoreRec: string | null;
    opRec: string | null;
    finalRec: string | null;
    sds: number | null;
    sdsBand: string;
    pplan: number | null;
    eis: number | null;
    affid: number | null;
    pred5: number | null;
    directionLive: string | null;
    slope5: number | null;
    slope20: number | null;
    miiAngle: number | null;
    daysToCd: number | null;
    phase: string | null;
    liveQuoteTicker: string | null;
    cdHorizon: "hot" | "watch" | "beyond" | "missing";
    inHotOppFilter: boolean;
    inWatchOppFilter: boolean;
    inMonitorFilter: boolean;
    strictOppBuy: boolean;
    chartBuyBlocker: string | null;
    simBuyBlock: string | null;
    investVerdict: string | null;
    exitDecision: string | null;
    precat: string | null;
    keyBlockers: string[];
  };

  const rowsOut: UpsideDiag[] = [];

  for (const u of upside) {
    const simRow = rowByKey.get(u.key) ?? null;
    const item = itemsByKey.get(u.key) ?? null;
    const sdsRow = sdsByTicker.get(u.ticker) ?? null;
    const mig = simRow
      ? migSolidityByKey.get(
          migSolidityKey(u.ticker, String(simRow["Completion Date"] ?? "")),
        )
      : null;

    const affid =
      pickRowNum(simRow ?? {}, "affid_live", "Affidabilità %", "Affidabilità calib %") ??
      item?.affidPct ??
      null;
    const pred5 =
      pickRowNum(simRow ?? {}, "pred5_live", "Pred empirica +5gg (%)") ??
      item?.pred5Pp ??
      null;
    const directionLive = pickRowStr(simRow ?? {}, "direction_live");
    const slope5 = pickRowNum(simRow ?? {}, "slope≈5g", "slope~5g") ?? item?.slope5d ?? null;
    const slope20 =
      pickRowNum(simRow ?? {}, "slope≈20g", "slope~20g") ?? item?.slope20d ?? null;
    const liveQuote =
      pickRowStr(simRow ?? {}, "live_quote_ticker") ??
      (simRow ? String(simRow.Ticker ?? "").trim().toUpperCase() || null : null);
    const phase = clinicalPhaseFromSimRow(simRow ?? undefined) || null;
    const days =
      item?.daysToCd ??
      (simRow ? daysFromToday(String(simRow["Completion Date"] ?? "")) : null);
    const miiAngle = mig?.slopeAngleDeg ?? item?.miiAngleDeg ?? null;

    let scoreRec: string | null = null;
    let opRec: string | null = null;
    let finalRec: string | null = null;
    let chartBuyBlocker: string | null = null;
    let scores: DecisionScoreInput | null = null;

    if (item) {
      const chartPts = item.seriesKey
        ? pointsBySeriesKey.get(item.seriesKey) ?? null
        : null;
      const regSigned = resolveRegSignedScoreForTicker(
        item.ticker,
        simRow,
        autoRegSnap,
      );
      const lossRisk =
        lookupLossRiskByRowKey(catalogByRowKey, item.key) ??
        lookupLossRisk(lossRiskCatalog, item.ticker);
      scores = buildDecisionScoreInput({
        item,
        sdsRow,
        lossRisk,
        regSignedScore: regSigned,
        chartPts,
        simRow,
        lang: "it",
      });
      scoreRec = getRecommendation(scores);
      opRec = deriveSuggestedAction(item, false);
      finalRec = resolveDecisionChartRec(scores, opRec);
      chartBuyBlocker = classifyBuyBlocker(scores);
    }

    const rec = recBucket(finalRec ?? scoreRec, opRec);
    const sds = scores?.sds ?? item?.sdsScore ?? sdsRow?.sds ?? null;
    const pplan = scores?.pplan ?? item?.recoveryProbabilityPct ?? null;
    const eis = scores?.eis ?? item?.eisSuperScore ?? null;
    const simBuyBlock = item ? explainBuyBlockReason(item, false, "en") : "no loss-analysis item";
    const strictOppBuy = item ? qualifiesStrictOpportunityBuy(item) : false;

    let cdHorizon: UpsideDiag["cdHorizon"] = "missing";
    if (days != null) {
      if (isHotZone(days)) cdHorizon = "hot";
      else if (isWatchZone(days)) cdHorizon = "watch";
      else cdHorizon = "beyond";
    }

    const keyBlockers: string[] = [];
    if (!u.inPortfolio) {
      if (!monitorKeys.has(u.key)) {
        keyBlockers.push(
          cdHorizon === "beyond"
            ? "CD beyond monitor (>~120d)"
            : "not in opp CD filter",
        );
      } else if (!hotKeys.has(u.key) && watchKeys.has(u.key)) {
        keyBlockers.push("watch zone (not hot opp list)");
      }
      if (item) {
        if (!strictOppBuy && simBuyBlock) keyBlockers.push(simBuyBlock);
        if (chartBuyBlocker && !chartBuyBlocker.startsWith("would_buy")) {
          keyBlockers.push(`chart:${chartBuyBlocker}`);
        }
        if (finalRec && finalRec !== "buy") keyBlockers.push(`finalRec=${finalRec}`);
      } else {
        keyBlockers.push("no Decision Lab item (data/scope)");
      }
      if (scores?.lowLiqNoise) keyBlockers.push("low_liq_noise");
    }

    rowsOut.push({
      ticker: u.ticker,
      key: u.key,
      company: u.company,
      inPF: u.inPortfolio,
      pnlEur: u.pnlEur!,
      dailyPct: u.dailyPct24h,
      rec,
      scoreRec,
      opRec,
      finalRec,
      sds: sds != null && Number.isFinite(sds) ? Math.round(sds) : null,
      sdsBand: sdsBandLabel(sds),
      pplan: pplan != null && Number.isFinite(pplan) ? Math.round(pplan) : null,
      eis: eis != null && Number.isFinite(eis) ? Math.round(eis) : null,
      affid: affid != null ? Math.round(affid * 10) / 10 : null,
      pred5: pred5 != null ? Math.round(pred5 * 100) / 100 : null,
      directionLive,
      slope5: slope5 != null ? Math.round(slope5 * 100) / 100 : null,
      slope20: slope20 != null ? Math.round(slope20 * 100) / 100 : null,
      miiAngle: miiAngle != null ? Math.round(miiAngle * 10) / 10 : null,
      daysToCd: days != null ? Math.round(days) : null,
      phase,
      liveQuoteTicker: liveQuote,
      cdHorizon,
      inHotOppFilter: hotKeys.has(u.key),
      inWatchOppFilter: watchKeys.has(u.key),
      inMonitorFilter: monitorKeys.has(u.key),
      strictOppBuy,
      chartBuyBlocker,
      simBuyBlock,
      investVerdict: item?.investVerdict ?? null,
      exitDecision: item?.exitDecision ?? null,
      precat: item?.precatKind ?? null,
      keyBlockers,
    });
  }

  rowsOut.sort((a, b) => b.pnlEur - a.pnlEur);

  // --- Aggregates: off-book upside ---
  const off = rowsOut.filter((r) => !r.inPF);
  const byRec = new Map<string, number>();
  const bySds = new Map<string, number>();
  const byOppFilter = new Map<string, number>();
  const byChartBlocker = new Map<string, number>();
  const bySimBlock = new Map<string, number>();
  let offUpsideEur = 0;
  let inUpsideEur = 0;
  for (const r of rowsOut) {
    if (r.inPF) inUpsideEur += r.pnlEur;
    else offUpsideEur += r.pnlEur;
  }
  for (const r of off) {
    bump(byRec, r.rec);
    bump(bySds, r.sdsBand);
    const filt = r.inHotOppFilter
      ? "in_hot_opp"
      : r.inWatchOppFilter
        ? "in_watch_only"
        : r.inMonitorFilter
          ? "in_monitor_other"
          : "filtered_out_of_opp";
    bump(byOppFilter, filt);
    if (r.chartBuyBlocker) bump(byChartBlocker, r.chartBuyBlocker);
    const sb = r.simBuyBlock ?? "—";
    // Collapse long reasons into short keys
    let sk = sb;
    if (/Top2\s*(verdict\s*)?«?no»?/i.test(sb) || /Verdetto Top2 «no»/i.test(sb))
      sk = "top2_no";
    else if (/Top2\s*(verdict\s*)?«?wait»?/i.test(sb) || /Verdetto Top2 «wait»/i.test(sb))
      sk = "top2_wait";
    else if (/P\(plan\).*</i.test(sb)) sk = "pplan_below_buy_min";
    else if (/Forward target|Guadagno atteso|plusvalenza/i.test(sb)) sk = "forward_gain_le0";
    else if (/SDS/i.test(sb) && /veto|evidence|min/i.test(sb)) sk = "sds_evidence";
    else if (/EIS/i.test(sb)) sk = "eis_evidence";
    else if (/ENTER|WAIT\/review/i.test(sb)) sk = "enter_not_aligned";
    else if (/no loss-analysis/i.test(sb)) sk = "no_item";
    else if (/Already|Già/i.test(sb)) sk = "already_held";
    bump(bySimBlock, sk);
  }

  // Weights vs indices vs data access narrative
  const offBuyRec = off.filter((r) => r.rec === "BUY").length;
  const offStrictBuy = off.filter((r) => r.strictOppBuy).length;
  const offInHot = off.filter((r) => r.inHotOppFilter).length;
  const offFilteredOut = off.filter((r) => !r.inMonitorFilter).length;
  const offMissingSds = off.filter((r) => r.sds == null).length;
  const offMissingPplan = off.filter((r) => r.pplan == null).length;
  const offMissingItem = off.filter((r) => r.simBuyBlock === "no loss-analysis item").length;
  const offWouldChartBuy = off.filter(
    (r) => r.chartBuyBlocker?.startsWith("would_buy") || r.scoreRec === "buy",
  ).length;

  // ========== PRINT ==========
  console.log("\n=== UNIVERSE 24h UPSIDE — MISSED AUDIT ===");
  console.log(`Capital/ticker: €${SIM_UNIVERSE_WHATIF_CAPITAL}`);
  console.log(`Portfolio source: ${pfSource} (${nActive} active names on sheet)`);
  console.log(
    `Universe: ${whatIf.all.n} · with 24h: ${whatIf.all.nWith24h} · upside names: ${upside.length}`,
  );
  console.log(
    `Upside €: universe ${whatIf.all.upsideEur} · in-PF ${Math.round(inUpsideEur)} (${upsideIn.length}) · off-book ${Math.round(offUpsideEur)} (${upsideOff.length}) · capture ${whatIf.capturePct ?? "—"}% · missed ${whatIf.missedUpsideEur}`,
  );

  console.log("\n--- FULL UPSIDE TABLE ---");
  console.log(
    [
      pad("Ticker", 8),
      pad("inPF", 5),
      padL("pnl€", 7),
      padL("d%", 7),
      pad("REC", 8),
      padL("SDS", 4),
      padL("Ppl", 4),
      padL("EIS", 4),
      padL("dCD", 4),
      pad("horizon", 8),
      pad("opp?", 6),
      "blockers",
    ].join(" "),
  );
  console.log("-".repeat(110));
  for (const r of rowsOut) {
    const opp = r.inHotOppFilter ? "HOT" : r.inWatchOppFilter ? "WATCH" : r.inMonitorFilter ? "MON" : "—";
    console.log(
      [
        pad(r.ticker, 8),
        pad(r.inPF ? "YES" : "no", 5),
        padL(fmt(r.pnlEur, 0), 7),
        padL(fmtSigned(r.dailyPct, 2), 7),
        pad(r.rec, 8),
        padL(r.sds != null ? String(r.sds) : "—", 4),
        padL(r.pplan != null ? String(r.pplan) : "—", 4),
        padL(r.eis != null ? String(r.eis) : "—", 4),
        padL(r.daysToCd != null ? String(r.daysToCd) : "—", 4),
        pad(r.cdHorizon, 8),
        pad(opp, 6),
        r.inPF ? "(held)" : r.keyBlockers.slice(0, 2).join(" · ") || "—",
      ].join(" "),
    );
  }

  console.log("\n--- SIGNAL DETAIL (each upside name) ---");
  for (const r of rowsOut) {
    console.log(
      `\n${r.ticker}${r.company ? ` — ${r.company}` : ""}  inPF=${r.inPF}  pnl€=${fmt(r.pnlEur, 0)}  Var.Giorn=${fmtSigned(r.dailyPct)}%`,
    );
    console.log(
      `  REC final=${r.finalRec ?? "—"} score=${r.scoreRec ?? "—"} op=${r.opRec ?? "—"} bucket=${r.rec}`,
    );
    console.log(
      `  SDS=${r.sds ?? "—"} (${r.sdsBand})  P(plan)=${r.pplan ?? "—"}%  EIS=${r.eis ?? "—"}  affid=${r.affid ?? "—"}  pred5=${r.pred5 ?? "—"}`,
    );
    console.log(
      `  dir=${r.directionLive ?? "—"}  slope5=${r.slope5 ?? "—"}  slope20=${r.slope20 ?? "—"}  MII°=${r.miiAngle ?? "—"}  dCD=${r.daysToCd ?? "—"}  phase=${r.phase ?? "—"}  live=${r.liveQuoteTicker ?? "—"}`,
    );
    console.log(
      `  Top2=${r.investVerdict ?? "—"} exit=${r.exitDecision ?? "—"} precat=${r.precat ?? "—"}  strictOppBuy=${r.strictOppBuy}`,
    );
    console.log(
      `  oppFilter hot=${r.inHotOppFilter} watch=${r.inWatchOppFilter} monitor=${r.inMonitorFilter}`,
    );
    if (!r.inPF) {
      console.log(`  chartGate: ${r.chartBuyBlocker ?? "—"}`);
      console.log(`  simBuyBlock: ${r.simBuyBlock ?? "—"}`);
      if (r.keyBlockers.length) console.log(`  WHY: ${r.keyBlockers.join(" · ")}`);
    }
  }

  console.log("\n=== WHY MISSED (off-book upside only) ===");
  console.log(`Off-book risers: ${off.length} · €${Math.round(offUpsideEur)}`);

  console.log("\n--- By recommendation bucket ---");
  for (const k of ["BUY", "HOLD", "REVIEW", "SELL", "UNCERTAIN", "missing"] as const) {
    console.log(`  ${k}: ${byRec.get(k) ?? 0}`);
  }

  console.log("\n--- By SDS band ---");
  for (const b of [...SDS_SCORE_BANDS.map((x) => x.label), "missing"]) {
    console.log(`  ${b}: ${bySds.get(b) ?? 0}`);
  }

  console.log("\n--- By opportunity filter ---");
  for (const [k, n] of [...byOppFilter.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }

  console.log("\n--- Decision-chart BUY gates (first failing / would_buy) on off-book ---");
  for (const [k, n] of [...byChartBlocker.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padL(String(n), 3)}  ${k}`);
  }

  console.log("\n--- Sim-loop BUY block reasons (collapsed) on off-book ---");
  for (const [k, n] of [...bySimBlock.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padL(String(n), 3)}  ${k}`);
  }

  console.log("\n=== AGGREGATE: weights vs indices vs data access ===");
  console.log(
    `Weights (positioning): capture ${whatIf.capturePct ?? "—"}% of universe upside (€${whatIf.all.upsideEur}); missed €${whatIf.missedUpsideEur} across ${off.length} off-book names @ €${SIM_UNIVERSE_WHATIF_CAPITAL}/name.`,
  );
  console.log(
    `Indices (signals): off-book BUY finalRec=${offBuyRec}/${off.length}; strict sim-loop opp BUY=${offStrictBuy}; chart would-BUY path=${offWouldChartBuy}; SDS missing=${offMissingSds}; P(plan) missing=${offMissingPplan}.`,
  );
  console.log(
    `Data access / filters: in hot opp list ${offInHot}/${off.length}; filtered out of monitor CD window ${offFilteredOut}; no loss-analysis item ${offMissingItem}.`,
  );
  console.log(
    `Typical BUY blockers (off-book): see chartGate + simBuyBlock tables above. Thresholds: sim P(plan)≥${SIM_LOOP_BUY_PROB_MIN}, study SDS≥${STUDY_EVIDENCE_SDS_MIN}, EIS≥${STUDY_EVIDENCE_EIS_MIN}.`,
  );

  // Verdict sentence
  const topRec = [...byRec.entries()].sort((a, b) => b[1] - a[1])[0];
  const topBlock = [...byChartBlocker.entries()].sort((a, b) => b[1] - a[1])[0];
  const topSim = [...bySimBlock.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(
    `\nVerdict: missed upside is mostly ${topRec ? `${topRec[0]} (${topRec[1]})` : "n/a"} by REC` +
      (topBlock ? `; chart gate «${topBlock[0]}» (${topBlock[1]})` : "") +
      (topSim ? `; sim-loop «${topSim[0]}» (${topSim[1]})` : "") +
      `.`,
  );

  const outPath = path.join(DATA, "diag_universe_upside_missed.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        capitalPerTicker: SIM_UNIVERSE_WHATIF_CAPITAL,
        portfolioSource: pfSource,
        portfolioActiveN: nActive,
        whatIf: {
          all: whatIf.all,
          portfolio: whatIf.portfolio,
          offPortfolio: whatIf.offPortfolio,
          capturePct: whatIf.capturePct,
          missedUpsideEur: whatIf.missedUpsideEur,
        },
        upsideN: upside.length,
        upsideInN: upsideIn.length,
        upsideOffN: upsideOff.length,
        aggregates: {
          byRec: Object.fromEntries(byRec),
          bySds: Object.fromEntries(bySds),
          byOppFilter: Object.fromEntries(byOppFilter),
          byChartBlocker: Object.fromEntries(byChartBlocker),
          bySimBlock: Object.fromEntries(bySimBlock),
          weightsVsIndicesVsAccess: {
            capturePct: whatIf.capturePct,
            missedUpsideEur: whatIf.missedUpsideEur,
            offBuyRec,
            offStrictBuy,
            offWouldChartBuy,
            offInHot,
            offFilteredOut,
            offMissingSds,
            offMissingPplan,
            offMissingItem,
          },
        },
        rows: rowsOut,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\nJSON → ${outPath}`);
  console.log(`Re-run: cd desktop-ui && npx tsx scripts/diag-universe-upside-missed.ts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
