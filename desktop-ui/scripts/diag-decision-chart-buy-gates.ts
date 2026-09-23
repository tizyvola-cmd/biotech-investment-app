/**
 * Decision Chart BUY gate audit — score rules + sim-loop override.
 * Run: npx tsx scripts/diag-decision-chart-buy-gates.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  qualifiesStrictOpportunityBuy,
  explainBuyBlockReason,
  studySetupEvidenceSupportsBuy,
  forwardBuyGainOutlookPositive,
  SIM_LOOP_BUY_PROB_MIN,
  STUDY_EVIDENCE_SDS_MIN,
  STUDY_EVIDENCE_EIS_MIN,
} from "../src/sheet/investDecisionSimLoop";
import {
  buildDecisionScoreInput,
  resolveRegSignedScoreForTicker,
} from "../src/sheet/decisionChartBuild";
import {
  getRecommendation,
  resolveDecisionChartRec,
  type DecisionScoreInput,
  type RecommendationRuleKey,
} from "../src/sheet/decisionChartLogic";
import { loadMarketContextSnapshot } from "../src/sheet/marketContextScore";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../src/hooks/useLossRiskCatalog";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

/** Mirror of private traceRecommendation — count first failing BUY gate. */
function classifyBuyBlocker(s: DecisionScoreInput): string {
  if (s.status === "closed") {
    if (s.pnlPct != null && s.pnlPct >= 5) return "would_buy_closed";
    return "closed_not_buy";
  }
  if (s.lowLiqNoise === true) return "low_liq_noise_review";
  if (s.regRisk !== null && s.regRisk >= 70) return "reg_veto_sell";
  if (s.isRescue) {
    // Align with rescue_sell: pplan < 40 OR regRisk ≥ 45 → SELL (not a BUY block)
    if ((s.pplan !== null && s.pplan < 40) || (s.regRisk !== null && s.regRisk >= 45)) {
      return "rescue_sell";
    }
    return "rescue_blocks_buy";
  }
  // Primary BUY: P≥60 and Loss ≤40
  if (s.pplan !== null && s.pplan >= 60) {
    if (s.riskV2 === null || s.riskV2 <= 40) return "would_buy_pplan";
    // Reg-swing band: P 60–64, Loss 41–45, Reg ≤45
    if (s.pplan < 65 && s.riskV2 <= 45) {
      if (s.regRisk === null || s.regRisk > 45) return "reg_swing_reg_gt45";
      return "would_buy_reg_swing";
    }
    return "pplan60_but_riskV2_gt40";
  }
  // Momentum BUY
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
  // pplan 40-49
  return "pplan_40_49_review";
}

function ruleOf(s: DecisionScoreInput): RecommendationRuleKey {
  // Re-derive via getRecommendation + explain path isn't exported; approximate from blocker
  const rec = getRecommendation(s);
  const b = classifyBuyBlocker(s);
  if (rec === "buy") {
    if (b.includes("pplan")) return "pplan_buy";
    if (b.includes("reg_swing")) return "pplan_buy_reg_swing";
    if (b.includes("pnl")) return "pnl_buy";
    if (b.includes("sds")) return "sds_buy";
    return "pplan_buy";
  }
  if (b === "low_liq_noise_review") return "low_liq_noise_review";
  if (b === "reg_veto_sell") return "reg_veto";
  if (b === "rescue_blocks_buy") return "rescue_review";
  if (b === "pplan_hold_band_50_64") return "pplan_hold";
  if (b === "pplan_sell_sub40") return "pplan_sell_sub40";
  return "default_review";
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
  const inputs =
    readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const autoRegSnap =
    readJson<RegulatoryRiskSnapshot>("regulatory_risk_snapshot.json") ?? null;
  const closedRows =
    readJson<{ rows?: SimOutcomeRow[] }>("investment_sim_outcomes.json").rows ??
    [];
  const { catalog: lossRiskCatalog, catalogByRowKey } = buildLossRiskCatalogSync({
    simTable,
    inputs,
    chartBundle: charts,
    sdsRows,
    closedRows,
    lang: "it",
  });

  let mcsDoc = null;
  try {
    mcsDoc = await loadMarketContextSnapshot();
  } catch {
    /* optional */
  }

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = `${tk}|${String(r["Completion Date"] ?? "").trim()}`;
    rowByKey.set(key, r as Record<string, unknown>);
    rowByKey.set(tk, r as Record<string, unknown>);
  }

  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of sdsRows) {
    const t = String(s.ticker ?? "").trim().toUpperCase();
    if (t) sdsByTicker.set(t, s);
  }

  const items: ReturnType<typeof buildLossAnalysisItems> = [];
  for (const profile of ["portfolio", "opportunities"] as const) {
    items.push(
      ...buildLossAnalysisItems(
        profile,
        simTable,
        inputs,
        pointsBySeriesKey,
        "it",
        null,
        { sdsRows, migSolidityByKey },
        profile === "opportunities" ? "hot" : undefined,
      ),
    );
  }

  // Dedupe by key
  const byKey = new Map<string, (typeof items)[number]>();
  for (const it of items) byKey.set(it.key, it);

  const blockerCounts = new Map<string, number>();
  const ruleCounts = new Map<string, number>();
  const finalRecCounts = { buy: 0, hold: 0, review: 0, sell: 0 };
  const scoreRecCounts = { buy: 0, hold: 0, review: 0, sell: 0 };
  const opRecCounts = { buy: 0, hold: 0, review: 0, sell: 0, none: 0 };
  const overrideKillBuy: string[] = [];
  const nearMiss: Array<Record<string, unknown>> = [];
  const rowsOut: Array<Record<string, unknown>> = [];

  let nWouldScoreBuy = 0;
  let nFinalBuy = 0;
  let nStrictSimBuy = 0;
  let nOpHoldKillsScoreBuy = 0;

  const pplanBuckets = {
    under40: 0,
    "40-49": 0,
    "50-59": 0,
    "60-64": 0,
    "65plus": 0,
    missing: 0,
  };

  for (const item of byKey.values()) {
    const simRow =
      rowByKey.get(item.key) ??
      rowByKey.get(item.ticker.trim().toUpperCase()) ??
      null;
    const sdsRow = sdsByTicker.get(item.ticker.trim().toUpperCase()) ?? null;
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

    const scores = buildDecisionScoreInput({
      item,
      sdsRow,
      lossRisk,
      regSignedScore: regSigned,
      mcsDoc,
      chartPts,
      simRow,
      lang: "it",
    });

    const scoreRec = getRecommendation(scores);
    const op = deriveSuggestedAction(item, false);
    const finalRec = resolveDecisionChartRec(scores, op);
    const blocker = classifyBuyBlocker(scores);
    const rule = ruleOf(scores);

    blockerCounts.set(blocker, (blockerCounts.get(blocker) ?? 0) + 1);
    ruleCounts.set(`${scoreRec}:${rule}`, (ruleCounts.get(`${scoreRec}:${rule}`) ?? 0) + 1);
    scoreRecCounts[scoreRec] += 1;
    finalRecCounts[finalRec] += 1;
    if (op === "buy" || op === "hold" || op === "review" || op === "sell") {
      opRecCounts[op] += 1;
    } else {
      opRecCounts.none += 1;
    }

    if (scoreRec === "buy") nWouldScoreBuy += 1;
    if (finalRec === "buy") nFinalBuy += 1;
    if (qualifiesStrictOpportunityBuy(item)) nStrictSimBuy += 1;

    if (scoreRec === "buy" && finalRec !== "buy") {
      nOpHoldKillsScoreBuy += 1;
      overrideKillBuy.push(
        `${item.ticker} scoreBUY→final=${finalRec} op=${op} pplan=${scores.pplan} pnl=${scores.pnlPct?.toFixed(1)}`,
      );
    }

    if (scores.pplan == null) pplanBuckets.missing += 1;
    else if (scores.pplan < 40) pplanBuckets.under40 += 1;
    else if (scores.pplan < 50) pplanBuckets["40-49"] += 1;
    else if (scores.pplan < 60) pplanBuckets["50-59"] += 1;
    else if (scores.pplan < 65) pplanBuckets["60-64"] += 1;
    else pplanBuckets["65plus"] += 1;

    // Near-miss: pplan 60-64 failing only reg-swing, or pplan>=65 blocked by rescue/op
    const isNear =
      (scores.pplan != null && scores.pplan >= 60 && scoreRec !== "buy") ||
      (scoreRec === "buy" && finalRec !== "buy") ||
      (scores.pnlPct != null && scores.pnlPct >= 5 && scoreRec !== "buy");
    if (isNear) {
      nearMiss.push({
        ticker: item.ticker,
        hasPosition: item.hasPosition,
        pplan: scores.pplan,
        sds: scores.sds,
        riskV2: scores.riskV2,
        regRisk: scores.regRisk,
        pnlPct: scores.pnlPct,
        isRescue: scores.isRescue,
        lowLiq: scores.lowLiqNoise ?? false,
        scoreRec,
        op,
        finalRec,
        blocker,
        investVerdict: item.investVerdict,
        exitDecision: item.exitDecision,
        precat: item.precatKind,
        recoveryP: item.recoveryProbabilityPct,
        simBuyBlock: explainBuyBlockReason(item, false, "en"),
        studyOk: studySetupEvidenceSupportsBuy(item),
        fwdOk: forwardBuyGainOutlookPositive(item),
        sdsScore: item.sdsScore,
        eis: item.eisSuperScore,
      });
    }

    rowsOut.push({
      ticker: item.ticker,
      hasPosition: item.hasPosition,
      pplan: scores.pplan,
      sds: scores.sds,
      eis: scores.eis,
      riskV2: scores.riskV2,
      regRisk: scores.regRisk,
      mcs: scores.mcs,
      pnlPct: scores.pnlPct,
      isRescue: scores.isRescue,
      lowLiq: scores.lowLiqNoise ?? false,
      scoreRec,
      op,
      finalRec,
      blocker,
    });
  }

  // Sim-loop gate funnel for off-portfolio only
  const opp = [...byKey.values()].filter((i) => !i.hasPosition);
  const simFunnel = {
    totalOpp: opp.length,
    top2Yes: opp.filter((i) => i.investVerdict === "yes").length,
    exitHold: opp.filter((i) => i.investVerdict === "yes" && i.exitDecision === "hold")
      .length,
    precatEnter: opp.filter(
      (i) =>
        i.investVerdict === "yes" &&
        i.exitDecision === "hold" &&
        (i.precatKind === "enter" || i.precatKind === "accumulate"),
    ).length,
    pplanGe60: opp.filter(
      (i) =>
        i.investVerdict === "yes" &&
        i.exitDecision === "hold" &&
        (i.precatKind === "enter" || i.precatKind === "accumulate") &&
        i.recoveryProbabilityPct != null &&
        i.recoveryProbabilityPct >= SIM_LOOP_BUY_PROB_MIN,
    ).length,
    fwdOk: opp.filter(
      (i) =>
        i.investVerdict === "yes" &&
        i.exitDecision === "hold" &&
        (i.precatKind === "enter" || i.precatKind === "accumulate") &&
        i.recoveryProbabilityPct != null &&
        i.recoveryProbabilityPct >= SIM_LOOP_BUY_PROB_MIN &&
        forwardBuyGainOutlookPositive(i),
    ).length,
    studyOk: opp.filter((i) => qualifiesStrictOpportunityBuy(i)).length,
    sdsFail: opp.filter(
      (i) =>
        i.investVerdict === "yes" &&
        i.exitDecision === "hold" &&
        (i.precatKind === "enter" || i.precatKind === "accumulate") &&
        i.recoveryProbabilityPct != null &&
        i.recoveryProbabilityPct >= SIM_LOOP_BUY_PROB_MIN &&
        forwardBuyGainOutlookPositive(i) &&
        (i.sdsScore == null || i.sdsScore < STUDY_EVIDENCE_SDS_MIN),
    ).length,
    eisFail: opp.filter(
      (i) =>
        i.investVerdict === "yes" &&
        i.exitDecision === "hold" &&
        (i.precatKind === "enter" || i.precatKind === "accumulate") &&
        i.recoveryProbabilityPct != null &&
        i.recoveryProbabilityPct >= SIM_LOOP_BUY_PROB_MIN &&
        forwardBuyGainOutlookPositive(i) &&
        i.sdsScore != null &&
        i.sdsScore >= STUDY_EVIDENCE_SDS_MIN &&
        (i.eisSuperScore == null || i.eisSuperScore < STUDY_EVIDENCE_EIS_MIN),
    ).length,
  };

  const sortedBlockers = [...blockerCounts.entries()].sort((a, b) => b[1] - a[1]);

  console.log("\n=== DECISION CHART BUY GATE AUDIT ===");
  console.log(`Tickers: ${byKey.size}`);
  console.log(`\nScore-only recs:  BUY=${scoreRecCounts.buy} HOLD=${scoreRecCounts.hold} REVIEW=${scoreRecCounts.review} SELL=${scoreRecCounts.sell}`);
  console.log(`Sim-loop op:      BUY=${opRecCounts.buy} HOLD=${opRecCounts.hold} REVIEW=${opRecCounts.review} SELL=${opRecCounts.sell}`);
  console.log(`FINAL chart recs: BUY=${finalRecCounts.buy} HOLD=${finalRecCounts.hold} REVIEW=${finalRecCounts.review} SELL=${finalRecCounts.sell}`);
  console.log(`\nScore would-BUY: ${nWouldScoreBuy}`);
  console.log(`Op HOLD/SELL killing score-BUY: ${nOpHoldKillsScoreBuy}`);
  console.log(`Strict sim-loop opportunity BUY: ${nStrictSimBuy}`);
  console.log(`\nP(plan) buckets:`, pplanBuckets);
  console.log(`\n--- First BUY-gate blockers (score path) ---`);
  for (const [k, n] of sortedBlockers) {
    console.log(`  ${n.toString().padStart(3)}  ${k}`);
  }
  if (overrideKillBuy.length) {
    console.log(`\n--- Score BUY overridden by sim-loop ---`);
    for (const line of overrideKillBuy) console.log(`  ${line}`);
  }
  console.log(`\n--- Sim-loop strict BUY funnel (off-portfolio) ---`);
  console.log(JSON.stringify(simFunnel, null, 2));
  console.log(`\nNear-miss count: ${nearMiss.length}`);
  for (const m of nearMiss.slice(0, 25)) {
    console.log(
      `  ${m.ticker} p=${m.pplan} reg=${m.regRisk} pnl=${typeof m.pnlPct === "number" ? (m.pnlPct as number).toFixed(1) : m.pnlPct} rescue=${m.isRescue} score=${m.scoreRec} op=${m.op} final=${m.finalRec} | ${m.blocker}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      pplanBuy: 65,
      riskV2BuyMax: 35,
      regSwingPplan: [60, 64],
      regSwingRegMax: 30,
      regSwingRiskMax: 40,
      pnlMomentumMin: 5,
      pnlSetupPplanOrSds: 50,
      regVeto: 70,
      rescuePnl: -2,
      simBuyPplan: SIM_LOOP_BUY_PROB_MIN,
      studySdsMin: STUDY_EVIDENCE_SDS_MIN,
      studyEisMin: STUDY_EVIDENCE_EIS_MIN,
    },
    summary: {
      total: byKey.size,
      scoreRecCounts,
      opRecCounts,
      finalRecCounts,
      nWouldScoreBuy,
      nOpHoldKillsScoreBuy,
      nStrictSimBuy,
      pplanBuckets,
      blockers: Object.fromEntries(sortedBlockers),
    },
    simFunnel,
    overrideKillBuy,
    nearMiss,
    rows: rowsOut,
  };

  const outPath = path.join(DATA, "diag_decision_chart_buy_gates.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nJSON → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
