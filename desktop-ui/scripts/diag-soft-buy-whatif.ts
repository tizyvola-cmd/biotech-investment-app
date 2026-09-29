/**
 * Soft BUY what-if funnel — how many off-book BUY if we relax each gate.
 *
 * Answers: are we too conservative, or is the hot book empty?
 *
 * Run from desktop-ui:
 *   npx tsx scripts/diag-soft-buy-whatif.ts
 *
 * Writes: ../data/diag_soft_buy_whatif.json
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  softBuyForwardGainAdequate,
  softBuyTop2Allows,
  forwardBuyGainOutlookPositive,
  qualifiesStrictOpportunityBuy,
} from "../src/sheet/investDecisionSimLoop";
import {
  SOFT_BUY_G1_MIN_PLAN_RETURN_PCT,
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1_SDS_MIN,
} from "../src/sheet/softSignalGrades";
import {
  applyDirectionalSignalDemotion,
  buildRecommendationSignalCtx,
} from "../src/sheet/recommendationSignalGates";
import { RECOMMENDATION_SIGNAL_CONFIG } from "../src/sheet/recommendationSignalConfig";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

type GateFlags = {
  /** Require Soft G1 SDS/P thresholds (defaults). */
  requireSoftG1: boolean;
  sdsMin: number;
  pplanMin: number;
  blockPrecatAvoidSell: boolean;
  /** "strict" = block WAIT+NO; "allow_wait" = block only NO; "ignore" = no Top2 filter */
  top2Mode: "strict" | "allow_wait" | "ignore";
  /** "g1_3pct" = Soft BUY ≥3%; "positive" = any >0; "ignore" = no forward check */
  forwardMode: "g1_3pct" | "positive" | "ignore";
  qualityBeta: boolean;
  qualityLiq: boolean;
  qualityMomentum: boolean;
};

const BASELINE: GateFlags = {
  requireSoftG1: true,
  sdsMin: SOFT_BUY_G1_SDS_MIN,
  pplanMin: SOFT_BUY_G1_PPLAN_MIN,
  blockPrecatAvoidSell: true,
  top2Mode: "strict",
  forwardMode: "g1_3pct",
  qualityBeta: true,
  qualityLiq: true,
  qualityMomentum: true,
};

type OppRow = {
  key: string;
  ticker: string;
  sds: number | null;
  pplan: number | null;
  investVerdict: string;
  precatKind: string | null;
  planReturnPct: number | null;
  curvePeakReturnPct: number | null;
  daysToCurvePeak: number | null;
  beta: number | null;
  liq: number | null;
  momentum: number | null;
  baselineAction: string;
  strictBuy: boolean;
};

function top2Ok(verdict: string, mode: GateFlags["top2Mode"]): boolean {
  const v = verdict.trim().toLowerCase();
  if (mode === "ignore") return true;
  if (mode === "allow_wait") return v !== "no";
  return softBuyTop2Allows({ investVerdict: v as "yes" | "no" | "wait" });
}

function forwardOk(row: OppRow, mode: GateFlags["forwardMode"]): boolean {
  if (mode === "ignore") return true;
  const item = {
    planReturnPct: row.planReturnPct,
    curvePeakReturnPct: row.curvePeakReturnPct,
    daysToCurvePeak: row.daysToCurvePeak,
  };
  if (mode === "positive") return forwardBuyGainOutlookPositive(item);
  return softBuyForwardGainAdequate(item);
}

function passesSoftBuyWhatIf(row: OppRow, g: GateFlags): { buy: boolean; fail: string | null } {
  if (g.requireSoftG1) {
    if (row.sds == null || row.sds < g.sdsMin) return { buy: false, fail: `sds<${g.sdsMin}` };
    if (row.pplan == null || row.pplan < g.pplanMin) return { buy: false, fail: `pplan<${g.pplanMin}` };
  }
  if (
    g.blockPrecatAvoidSell &&
    (row.precatKind === "avoid" || row.precatKind === "sell")
  ) {
    return { buy: false, fail: "precat_avoid_sell" };
  }
  if (!top2Ok(row.investVerdict, g.top2Mode)) {
    return { buy: false, fail: `top2_${row.investVerdict || "empty"}` };
  }
  if (!forwardOk(row, g.forwardMode)) {
    return { buy: false, fail: `forward_${g.forwardMode}` };
  }
  // Soft path hit — apply quality demotions like finalizeSuggestedAction
  if (g.qualityBeta && row.beta != null && row.beta > RECOMMENDATION_SIGNAL_CONFIG.betaBuyBlockAbove) {
    return { buy: false, fail: "quality_beta" };
  }
  if (
    g.qualityLiq &&
    row.liq != null &&
    row.liq < RECOMMENDATION_SIGNAL_CONFIG.liquidityFyBuyBlockBelow
  ) {
    return { buy: false, fail: "quality_liq" };
  }
  if (
    g.qualityMomentum &&
    row.momentum != null &&
    row.momentum < RECOMMENDATION_SIGNAL_CONFIG.momentumBuyMinScore
  ) {
    return { buy: false, fail: "quality_momentum" };
  }
  return { buy: true, fail: null };
}

function scenarioLabel(id: string, g: GateFlags): string {
  return id;
}

function main() {
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

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = `${tk}|${String(r["Completion Date"] ?? "").trim()}`;
    rowByKey.set(key, r as Record<string, unknown>);
  }

  const oppItems = buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    "it",
    null,
    { sdsRows, migSolidityByKey },
    "hot",
  );

  const byKey = new Map<string, (typeof oppItems)[number]>();
  for (const it of oppItems) {
    if (it.hasPosition) continue;
    byKey.set(it.key, it);
  }

  const rows: OppRow[] = [];
  for (const item of byKey.values()) {
    const simRow = rowByKey.get(item.key) ?? null;
    const chartPts = item.seriesKey
      ? pointsBySeriesKey.get(item.seriesKey) ?? null
      : null;
    const sig = buildRecommendationSignalCtx(simRow, chartPts);
    const enhance = { simRow, chartPts };
    const baselineAction = deriveSuggestedAction(item, false, null, null, enhance);
    rows.push({
      key: item.key,
      ticker: item.ticker,
      sds: item.sdsScore ?? null,
      pplan: item.recoveryProbabilityPct ?? null,
      investVerdict: String(item.investVerdict ?? ""),
      precatKind: item.precatKind ?? null,
      planReturnPct: item.planReturnPct ?? null,
      curvePeakReturnPct: item.curvePeakReturnPct ?? null,
      daysToCurvePeak: item.daysToCurvePeak ?? null,
      beta: sig.beta,
      liq: sig.liquidityFy,
      momentum: sig.momentumScore,
      baselineAction,
      strictBuy: qualifiesStrictOpportunityBuy(item),
    });
  }

  // Sequential Soft BUY funnel (baseline gates, before quality)
  const funnelSteps: { step: string; n: number }[] = [];
  let pool = [...rows];
  funnelSteps.push({ step: "off_book_hot", n: pool.length });
  pool = pool.filter((r) => r.sds != null && r.sds >= SOFT_BUY_G1_SDS_MIN);
  funnelSteps.push({ step: `sds≥${SOFT_BUY_G1_SDS_MIN}`, n: pool.length });
  pool = pool.filter((r) => r.pplan != null && r.pplan >= SOFT_BUY_G1_PPLAN_MIN);
  funnelSteps.push({ step: `pplan≥${SOFT_BUY_G1_PPLAN_MIN}`, n: pool.length });
  pool = pool.filter((r) => r.precatKind !== "avoid" && r.precatKind !== "sell");
  funnelSteps.push({ step: "!precat_avoid_sell", n: pool.length });
  pool = pool.filter((r) => softBuyTop2Allows({ investVerdict: r.investVerdict as "yes" }));
  funnelSteps.push({ step: "top2_not_wait_no", n: pool.length });
  pool = pool.filter((r) =>
    softBuyForwardGainAdequate({
      planReturnPct: r.planReturnPct,
      curvePeakReturnPct: r.curvePeakReturnPct,
      daysToCurvePeak: r.daysToCurvePeak,
    }),
  );
  funnelSteps.push({
    step: `forward≥${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}%`,
    n: pool.length,
  });
  const afterSoft = pool.length;
  pool = pool.filter((r) => {
    const d = applyDirectionalSignalDemotion(
      "buy",
      {
        beta: r.beta,
        liquidityFy: r.liq,
        momentumScore: r.momentum,
        d1: null,
        d7: null,
        m3: null,
        m6: null,
      },
    );
    return !d.demoted;
  });
  funnelSteps.push({ step: "pass_quality_gates", n: pool.length });

  const scenarios: { id: string; flags: GateFlags }[] = [
    { id: "baseline_soft_buy", flags: { ...BASELINE } },
    {
      id: "allow_top2_wait",
      flags: { ...BASELINE, top2Mode: "allow_wait" },
    },
    {
      id: "ignore_top2",
      flags: { ...BASELINE, top2Mode: "ignore" },
    },
    {
      id: "forward_any_positive",
      flags: { ...BASELINE, forwardMode: "positive" },
    },
    {
      id: "ignore_forward",
      flags: { ...BASELINE, forwardMode: "ignore" },
    },
    {
      id: "sds≥20_p≥55",
      flags: { ...BASELINE, sdsMin: 20 },
    },
    {
      id: "sds≥25_p≥50",
      flags: { ...BASELINE, pplanMin: 50 },
    },
    {
      id: "sds≥20_p≥50",
      flags: { ...BASELINE, sdsMin: 20, pplanMin: 50 },
    },
    {
      id: "ignore_precat_block",
      flags: { ...BASELINE, blockPrecatAvoidSell: false },
    },
    {
      id: "ignore_quality_beta",
      flags: { ...BASELINE, qualityBeta: false },
    },
    {
      id: "ignore_quality_liq",
      flags: { ...BASELINE, qualityLiq: false },
    },
    {
      id: "ignore_quality_momentum",
      flags: { ...BASELINE, qualityMomentum: false },
    },
    {
      id: "ignore_all_quality",
      flags: {
        ...BASELINE,
        qualityBeta: false,
        qualityLiq: false,
        qualityMomentum: false,
      },
    },
    {
      id: "loose_pack_wait+p50+fwd+",
      flags: {
        ...BASELINE,
        top2Mode: "allow_wait",
        pplanMin: 50,
        forwardMode: "positive",
      },
    },
    {
      id: "jspr_like_sds20+fwd_ignore",
      flags: {
        ...BASELINE,
        sdsMin: 20,
        forwardMode: "ignore",
      },
    },
    {
      id: "nrix_like_ignore_precat+top2",
      flags: {
        ...BASELINE,
        blockPrecatAvoidSell: false,
        top2Mode: "ignore",
      },
    },
    {
      id: "aggressive_ignore_precat+top2+quality",
      flags: {
        ...BASELINE,
        blockPrecatAvoidSell: false,
        top2Mode: "ignore",
        qualityBeta: false,
        qualityLiq: false,
        qualityMomentum: false,
        forwardMode: "positive",
      },
    },
    {
      id: "volume_pack_sds20_p50_ignore_precat_top2",
      flags: {
        ...BASELINE,
        sdsMin: 20,
        pplanMin: 50,
        blockPrecatAvoidSell: false,
        top2Mode: "ignore",
        forwardMode: "positive",
      },
    },
  ];

  const baselineBuyTickers = new Set<string>();
  const scenarioResults: Array<{
    id: string;
    nBuy: number;
    deltaVsBaseline: number;
    tickers: string[];
    newTickers: string[];
    failCounts: Record<string, number>;
  }> = [];

  for (const sc of scenarios) {
    const buys: string[] = [];
    const failCounts: Record<string, number> = {};
    for (const row of rows) {
      const r = passesSoftBuyWhatIf(row, sc.flags);
      if (r.buy) buys.push(row.ticker);
      else if (r.fail) failCounts[r.fail] = (failCounts[r.fail] ?? 0) + 1;
    }
    buys.sort();
    if (sc.id === "baseline_soft_buy") {
      for (const t of buys) baselineBuyTickers.add(t);
    }
    const newTickers = buys.filter((t) => !baselineBuyTickers.has(t));
    scenarioResults.push({
      id: scenarioLabel(sc.id, sc.flags),
      nBuy: buys.length,
      deltaVsBaseline: buys.length - (scenarioResults[0]?.nBuy ?? buys.length),
      tickers: buys,
      newTickers: sc.id === "baseline_soft_buy" ? [] : newTickers,
      failCounts,
    });
  }

  // Fix delta vs baseline after baseline known
  const baseN = scenarioResults[0]?.nBuy ?? 0;
  for (const sc of scenarioResults) {
    sc.deltaVsBaseline = sc.nBuy - baseN;
    if (sc.id !== "baseline_soft_buy") {
      sc.newTickers = sc.tickers.filter((t) => !baselineBuyTickers.has(t));
    }
  }

  const liveBuy = rows.filter((r) => r.baselineAction === "buy").map((r) => r.ticker);
  const strictBuy = rows.filter((r) => r.strictBuy).map((r) => r.ticker);

  const out = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      sdsMin: SOFT_BUY_G1_SDS_MIN,
      pplanMin: SOFT_BUY_G1_PPLAN_MIN,
      minPlanReturnPct: SOFT_BUY_G1_MIN_PLAN_RETURN_PCT,
      betaBlockAbove: RECOMMENDATION_SIGNAL_CONFIG.betaBuyBlockAbove,
      liqBlockBelow: RECOMMENDATION_SIGNAL_CONFIG.liquidityFyBuyBlockBelow,
      momentumMin: RECOMMENDATION_SIGNAL_CONFIG.momentumBuyMinScore,
    },
    universe: {
      offBookHot: rows.length,
      liveDeriveBuy: liveBuy.length,
      liveDeriveBuyTickers: liveBuy.sort(),
      strictTop2Buy: strictBuy.length,
      strictTop2BuyTickers: strictBuy.sort(),
    },
    sequentialFunnel: funnelSteps,
    softPathAfterG1BeforeQuality: afterSoft,
    scenarios: scenarioResults,
    nearMissDetail: rows
      .filter((r) => r.baselineAction !== "buy")
      .map((r) => {
        const base = passesSoftBuyWhatIf(r, BASELINE);
        return {
          ticker: r.ticker,
          sds: r.sds,
          pplan: r.pplan,
          top2: r.investVerdict,
          precat: r.precatKind,
          plan: r.planReturnPct,
          peak: r.curvePeakReturnPct,
          beta: r.beta,
          liq: r.liq,
          momentum: r.momentum,
          liveAction: r.baselineAction,
          baselineFail: base.fail,
        };
      })
      .filter((r) => r.sds != null && r.sds >= 20 && r.pplan != null && r.pplan >= 50)
      .sort((a, b) => (b.pplan ?? 0) - (a.pplan ?? 0)),
  };

  console.log("\n=== SOFT BUY WHAT-IF FUNNEL ===");
  console.log(`Off-book hot opportunities: ${rows.length}`);
  console.log(`Live deriveSuggestedAction BUY: ${liveBuy.length} [${liveBuy.join(", ") || "—"}]`);
  console.log(`Strict Top2 BUY: ${strictBuy.length} [${strictBuy.join(", ") || "—"}]`);
  console.log("\n--- Sequential Soft BUY funnel ---");
  for (const s of funnelSteps) {
    console.log(`  ${String(s.n).padStart(3)}  ${s.step}`);
  }
  console.log("\n--- What-if scenarios (BUY count · Δ vs baseline · new names) ---");
  for (const sc of scenarioResults) {
    const delta =
      sc.deltaVsBaseline === 0
        ? "±0"
        : sc.deltaVsBaseline > 0
          ? `+${sc.deltaVsBaseline}`
          : String(sc.deltaVsBaseline);
    const news =
      sc.newTickers.length > 0 ? ` · +${sc.newTickers.join(",")}` : "";
    console.log(
      `  ${String(sc.nBuy).padStart(3)} (${delta.padStart(3)})  ${sc.id}${news}`,
    );
  }

  const best = [...scenarioResults]
    .filter((s) => s.id !== "baseline_soft_buy")
    .sort((a, b) => b.deltaVsBaseline - a.deltaVsBaseline)[0];
  if (best && best.deltaVsBaseline > 0) {
    console.log(
      `\nLargest single lever: ${best.id} → +${best.deltaVsBaseline} BUY (${best.newTickers.join(", ") || "same set larger"})`,
    );
  } else {
    console.log("\nNo single lever adds Soft BUY in the current hot book.");
  }

  if (out.nearMissDetail.length) {
    console.log("\n--- Near-miss (SDS≥20 · P≥50 · not live BUY) ---");
    for (const m of out.nearMissDetail.slice(0, 12)) {
      console.log(
        `  ${m.ticker.padEnd(6)} P=${m.pplan} SDS=${m.sds?.toFixed?.(0) ?? m.sds} top2=${m.top2} precat=${m.precat} fail=${m.baselineFail} live=${m.liveAction}`,
      );
    }
  }

  const outPath = path.join(DATA, "diag_soft_buy_whatif.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nJSON → ${outPath}\n`);
}

main();
