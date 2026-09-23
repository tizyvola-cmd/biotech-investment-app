/**
 * Open-portfolio SELL miss audit — why losers stay HOLD/REVIEW.
 * Run: cd desktop-ui && npx tsx scripts/diag-portfolio-sell-missed.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../src/api/supernova";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems, isUrgentPortfolioLossExit } from "../src/sheet/portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  explainHoldThesis,
  explainSellReason,
} from "../src/sheet/investDecisionSimLoop";
import {
  buildDecisionScoreInput,
  resolveRegSignedScoreForTicker,
} from "../src/sheet/decisionChartBuild";
import {
  getRecommendation,
  resolveDecisionChartRec,
  explainRecommendation,
  type DecisionScoreInput,
  type DecisionRec,
} from "../src/sheet/decisionChartLogic";
import { loadMarketContextSnapshot } from "../src/sheet/marketContextScore";
import { buildLossRiskCatalogSync } from "../src/sheet/lossRiskCatalogBuild";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../src/hooks/useLossRiskCatalog";
import type { SimOutcomeRow } from "../src/data/investmentSimOutcomesData";
import {
  portfolioExitRecoveryGuardsActive,
  recoveryThesisAlive,
} from "../src/sheet/portfolioDeclineSell";
import { detectPortfolioLossAlerts } from "../src/sheet/portfolioLossUrgent";
import {
  aggregateOpenPortfolioPnl,
  positionPnlForOpenRow,
  buildDashboardPortfolioChips,
} from "../src/sheet/simulationPosition";
import { RECOVERY_HOLD_PROB_MIN } from "../src/sheet/recoveryProbability";
import { buildSimRowByKeyMap } from "../src/sheet/investSimKeys";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
}

function readJsonOptional<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function fmt(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

type SellGateProbe = {
  rule: string;
  wouldFire: boolean;
  gap: string;
  distanceHint: string;
};

/**
 * Walk score SELL gates in the same order as traceRecommendation.
 * Once a branch returns (rescue / low_liq / hold), later SELL rules are unreachable.
 */
function probeSellGates(s: DecisionScoreInput): {
  activeRule: string;
  nearest: SellGateProbe | null;
  probes: SellGateProbe[];
  scorePathNote: string;
} {
  const probes: SellGateProbe[] = [];
  let nearest: SellGateProbe | null = null;
  let scorePathNote = "";

  const setNearest = (p: SellGateProbe) => {
    if (!nearest) nearest = p;
    probes.push(p);
  };

  // --- low_liq_noise ---
  if (s.lowLiqNoise === true) {
    const fragileSell =
      s.resilience === "fragile" &&
      s.pnlPct != null &&
      s.pnlPct <= -5 &&
      (s.pplan == null || s.pplan < 55);
    if (fragileSell) {
      setNearest({
        rule: "rescue_sell_fragile (via low_liq)",
        wouldFire: true,
        gap: "fires",
        distanceHint: "0",
      });
      return { activeRule: "rescue_sell_fragile", nearest, probes, scorePathNote: "SELL" };
    }
    setNearest({
      rule: "low_liq_noise_review",
      wouldFire: false,
      gap: "forced REVIEW — microstructure noise blocks SELL/BUY",
      distanceHint: "blocked_by_low_liq_noise",
    });
    return {
      activeRule: "low_liq_noise_review",
      nearest,
      probes,
      scorePathNote: "exits as REVIEW before any other SELL gate",
    };
  }

  // --- reg_veto ---
  if (s.regRisk != null && s.regRisk >= 70) {
    setNearest({
      rule: "reg_veto (≥70)",
      wouldFire: true,
      gap: "fires",
      distanceHint: "0",
    });
    return { activeRule: "reg_veto", nearest, probes, scorePathNote: "SELL" };
  }
  probes.push({
    rule: "reg_veto (≥70)",
    wouldFire: false,
    gap: `reg ${fmt(s.regRisk, 0)} — need ≥70 (Δ ${s.regRisk != null ? fmt(70 - s.regRisk, 0) : "n/a"})`,
    distanceHint: s.regRisk == null ? "missing" : String(Math.max(0, 70 - s.regRisk)),
  });

  // --- rescue branch (total P&L < −2%) — SHORT-CIRCUITS; pnl_sell never reached ---
  if (s.isRescue) {
    const fragile =
      s.resilience === "fragile" &&
      s.pnlPct != null &&
      s.pnlPct <= -5 &&
      (s.pplan == null || s.pplan < 55 || s.mcs == null || s.mcs < 50);
    if (fragile) {
      setNearest({
        rule: "rescue_sell_fragile",
        wouldFire: true,
        gap: "fires",
        distanceHint: "0",
      });
      return { activeRule: "rescue_sell_fragile", nearest, probes, scorePathNote: "SELL" };
    }

    const mcsParkResilient =
      s.resilience === "resilient" &&
      s.mcs != null &&
      s.mcs > 45 &&
      (s.regRisk == null || s.regRisk < 40) &&
      (s.pplan == null || s.pplan >= 40);
    const mcsParkGeneric =
      s.mcs != null && s.mcs > 55 && (s.regRisk == null || s.regRisk < 30);
    if (mcsParkResilient || mcsParkGeneric) {
      setNearest({
        rule: "rescue_review_mcs",
        wouldFire: false,
        gap: `ACTIVE park — MCS ${fmt(s.mcs, 0)} keeps Uncertain (blocks rescue_sell / pnl_sell)`,
        distanceHint: "mcs_park",
      });
      return {
        activeRule: "rescue_review_mcs",
        nearest,
        probes,
        scorePathNote: "rescue MCS park → REVIEW; pnl_sell unreachable",
      };
    }

    const rescueSell =
      (s.pplan != null && s.pplan < 40) || (s.regRisk != null && s.regRisk >= 50);
    if (rescueSell) {
      setNearest({
        rule: "rescue_sell (pplan<40 | reg≥50)",
        wouldFire: true,
        gap: "fires",
        distanceHint: "0",
      });
      return { activeRule: "rescue_sell", nearest, probes, scorePathNote: "SELL" };
    }

    // Default rescue_review — this is why deep losers with mid pplan stay Uncertain
    const pplanGap = s.pplan != null ? s.pplan - 40 : null;
    const regGap = s.regRisk != null ? 50 - s.regRisk : null;
    const nearerReg =
      regGap != null && (pplanGap == null || Math.abs(regGap) <= Math.abs(pplanGap));
    setNearest({
      rule: "rescue_sell (pplan<40 | reg≥50)",
      wouldFire: false,
      gap: nearerReg
        ? `rescue_review sticky — reg ${fmt(s.regRisk, 0)} need ≥50 (Δ ${fmt(regGap, 0)}); pplan ${fmt(s.pplan, 0)} far above 40. pnl_sell unreachable while in rescue.`
        : `rescue_review sticky — pplan ${fmt(s.pplan, 0)} need <40 (Δ ${fmt(pplanGap, 0)}); reg ${fmt(s.regRisk, 0)} need ≥50. pnl_sell unreachable while in rescue.`,
      distanceHint: String(
        nearerReg
          ? Math.max(0, regGap ?? 99)
          : Math.max(0, pplanGap ?? 99),
      ),
    });
    // Note unreachable pnl_sell for diagnostics
    const pnlWould =
      s.pnlPct != null &&
      s.pnlPct <= -7 &&
      ((s.riskV2 != null && s.riskV2 >= 45) ||
        (s.regRisk != null && s.regRisk >= 55) ||
        (s.pplan != null && s.pplan < 45));
    probes.push({
      rule: "pnl_sell (UNREACHABLE in rescue)",
      wouldFire: false,
      gap: pnlWould
        ? `would have fired on scores alone (pnl ${fmt(s.pnlPct)}%) but rescue branch returned first → REVIEW`
        : `also short of pnl_sell (pnl ${fmt(s.pnlPct)}% vs −7)`,
      distanceHint: "unreachable",
    });
    return {
      activeRule: "rescue_review",
      nearest,
      probes,
      scorePathNote: "rescue_review; hard pnl_sell gated behind rescue exit",
    };
  }

  // --- pnl_sell (only outside rescue) ---
  {
    const pnl = s.pnlPct;
    const pnlOk = pnl != null && pnl <= -7;
    const weak =
      (s.riskV2 != null && s.riskV2 >= 45) ||
      (s.regRisk != null && s.regRisk >= 55) ||
      (s.pplan != null && s.pplan < 45);
    if (pnlOk && weak) {
      setNearest({
        rule: "pnl_sell (total≤−7 + weak)",
        wouldFire: true,
        gap: "fires",
        distanceHint: "0",
      });
      return { activeRule: "pnl_sell", nearest, probes, scorePathNote: "SELL" };
    }
    setNearest({
      rule: "pnl_sell (total≤−7 + weak)",
      wouldFire: false,
      gap: !pnlOk
        ? `total P&L ${fmt(pnl)}% > −7 (need ${pnl != null ? fmt(pnl + 7) : "?"} pp more drawdown)`
        : `companion weak missing (riskV2≥45|reg≥55|pplan<45); risk=${fmt(s.riskV2, 0)} reg=${fmt(s.regRisk, 0)} p=${fmt(s.pplan, 0)}`,
      distanceHint: pnl == null ? "missing" : String(Math.max(0, pnl + 7)),
    });
  }

  // --- pplan_hold sticky (≥50) before pplan_sell_sub40 ---
  if (s.pplan != null && s.pplan >= 50) {
    setNearest({
      rule: "pplan_hold (≥50 sticky)",
      wouldFire: false,
      gap: `pplan ${fmt(s.pplan, 0)} ≥ 50 → HOLD; pplan_sell_sub40 never evaluated`,
      distanceHint: String(s.pplan - 40),
    });
    return {
      activeRule: "pplan_hold",
      nearest,
      probes,
      scorePathNote: "HOLD sticky via pplan≥50",
    };
  }

  if (s.pplan != null && s.pplan < 40) {
    setNearest({
      rule: "pplan_sell_sub40",
      wouldFire: true,
      gap: "fires",
      distanceHint: "0",
    });
    return { activeRule: "pplan_sell_sub40", nearest, probes, scorePathNote: "SELL" };
  }

  if (s.pplan != null) {
    // 40–49
    setNearest({
      rule: "pplan_sell_sub40",
      wouldFire: false,
      gap: `pplan ${fmt(s.pplan, 0)} in 40–49 → default REVIEW (need <40 for SELL)`,
      distanceHint: String(s.pplan - 40),
    });
    return {
      activeRule: "default_review_pplan_40_49",
      nearest,
      probes,
      scorePathNote: "REVIEW band 40–49",
    };
  }

  // pplan null
  if (s.riskV2 != null && s.riskV2 >= 66) {
    setNearest({
      rule: "risk_sell (≥66, no pplan)",
      wouldFire: true,
      gap: "fires",
      distanceHint: "0",
    });
    return { activeRule: "risk_sell", nearest, probes, scorePathNote: "SELL" };
  }
  setNearest({
    rule: "risk_sell (≥66, no pplan)",
    wouldFire: false,
    gap: `pplan null, riskV2 ${fmt(s.riskV2, 0)} — need ≥66`,
    distanceHint: s.riskV2 == null ? "missing" : String(Math.max(0, 66 - s.riskV2)),
  });
  return {
    activeRule: "default_review",
    nearest,
    probes,
    scorePathNote: "default REVIEW",
  };
}

/** Soft SELL Grade-1 candidate (proposal only — not implemented). */
function softSellGrade1(s: DecisionScoreInput, item: {
  pnlPct24h: number | null;
  recoveryProbabilityPct: number | null;
  recoveryCoversLoss: boolean | null | undefined;
}): { hits: boolean; why: string } {
  // Mirror of soft BUY idea: slightly looser than hard gates, still needs evidence.
  // Soft SELL if open loser with deteriorating 24h + weak thesis OR soft score combo.
  const totalLoss = s.pnlPct != null && s.pnlPct < 0;
  const dayLoss = item.pnlPct24h != null && item.pnlPct24h <= -2;
  const softPnl =
    s.pnlPct != null &&
    s.pnlPct <= -4 &&
    ((s.riskV2 != null && s.riskV2 >= 40) ||
      (s.regRisk != null && s.regRisk >= 45) ||
      (s.pplan != null && s.pplan < 50));
  const softPplan =
    s.pplan != null &&
    s.pplan < 45 &&
    s.pnlPct != null &&
    s.pnlPct <= -3;
  const softSds =
    s.sds != null &&
    s.sds < 40 &&
    s.pnlPct != null &&
    s.pnlPct <= -5 &&
    (s.riskV2 == null || s.riskV2 >= 40);
  const softRescue =
    s.isRescue &&
    dayLoss &&
    (s.pplan == null || s.pplan < 50) &&
    (s.regRisk == null || s.regRisk >= 40) &&
    !(item.recoveryProbabilityPct != null &&
      item.recoveryProbabilityPct >= RECOVERY_HOLD_PROB_MIN &&
      item.recoveryCoversLoss !== false);

  const parts: string[] = [];
  if (softPnl) parts.push("soft_pnl_sell (≤−4 + weak companion)");
  if (softPplan) parts.push("soft_pplan_sell (<45 + pnl≤−3)");
  if (softSds) parts.push("soft_sds_sell (SDS<40 + pnl≤−5)");
  if (softRescue) parts.push("soft_rescue_day (−2% 24h in rescue + pplan<50)");
  if (!totalLoss) return { hits: false, why: "not in total loss" };
  return {
    hits: parts.length > 0,
    why: parts.length ? parts.join(" · ") : "no soft criteria met",
  };
}

function classifySimLoopSellBlock(item: {
  hasPosition: boolean;
  exitDecision: string;
  pnlPct: number | null;
  recoveryProbabilityPct: number | null;
  recoveryCoversLoss: boolean | null | undefined;
  curveRisingHold: boolean;
  investVerdict: string | null;
  pnlPct24h: number | null;
  planReturnPct: number | null;
  curvePeakReturnPct: number | null;
  stabilityVerdict: string | null;
}): string {
  if (!item.hasPosition) return "not_open_position";
  if (item.pnlPct != null && item.pnlPct > 0) return "mtm_positive_never_sell";
  if (item.exitDecision !== "exit") {
    return `exitDecision=${item.exitDecision} (need exit for sim-loop SELL)`;
  }
  const guards = portfolioExitRecoveryGuardsActive({
    curveRisingHold: item.curveRisingHold,
    investVerdict: item.investVerdict as "yes" | "no" | "wait" | null,
    recoveryProbabilityPct: item.recoveryProbabilityPct,
    recoveryCoversLoss: item.recoveryCoversLoss,
    pnlPct24h: item.pnlPct24h,
    pnlPct: item.pnlPct,
    planReturnPct: item.planReturnPct,
    curvePeakReturnPct: item.curvePeakReturnPct,
    stabilityVerdict: item.stabilityVerdict as "exit" | "avoid" | "watch" | "hold" | null,
  });
  if (guards) {
    const alive = recoveryThesisAlive({
      recoveryProbabilityPct: item.recoveryProbabilityPct,
      recoveryCoversLoss: item.recoveryCoversLoss,
    });
    return alive
      ? `recovery_guard (P≥${RECOVERY_HOLD_PROB_MIN}% + covers)`
      : "recovery_guard (peak/cover/context)";
  }
  return "would_sim_sell";
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
  const history =
    readJsonOptional<{ history?: InvestSimHistoryPoint[] }>("invest_sim_history.json")
      ?.history ?? [];
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

  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of sdsRows) {
    const t = String(s.ticker ?? "").trim().toUpperCase();
    if (t) sdsByTicker.set(t, s);
  }

  const portfolioItems = buildLossAnalysisItems(
    "portfolio",
    simTable,
    inputs,
    pointsBySeriesKey,
    "it",
    null,
    { sdsRows, migSolidityByKey },
  ).filter((it) => it.hasPosition);

  const agg = aggregateOpenPortfolioPnl(simTable, inputs, history);
  const chips = buildDashboardPortfolioChips(simTable, inputs, history);
  const lossAlerts = detectPortfolioLossAlerts(simTable, inputs, history);

  let whatIf24h = 0;
  let nNeg24h = 0;
  for (const it of portfolioItems) {
    const row = rowByKey.get(it.key);
    if (!row) continue;
    const m = positionPnlForOpenRow(row, inputs, history);
    // approximate 24h € from % if capital known
    const d = it.pnlPct24h;
    const cap = it.capital;
    if (d != null && cap != null && Number.isFinite(d) && Number.isFinite(cap)) {
      whatIf24h += (cap * d) / 100;
      if (d < 0) nNeg24h += 1;
    }
    void m;
  }

  type RowOut = Record<string, unknown>;
  const rows: RowOut[] = [];
  const softHits: string[] = [];
  const holdSticky: string[] = [];
  const patternCounts = new Map<string, number>();

  console.log("\n=== OPEN PORTFOLIO SELL-MISS AUDIT ===");
  console.log(`Open positions: ${portfolioItems.length}`);
  console.log(
    `Aggregate MTM: €${fmt(agg.pnlEur, 0)} (${fmt(agg.pnlPct)}%) · capital €${fmt(agg.capital, 0)}`,
  );
  console.log(
    `What-if 24h (approx from pnlPct24h×capital): €${fmt(whatIf24h, 0)} · losers 24h: ${nNeg24h}/${portfolioItems.length}`,
  );
  console.log(`Loss-urgent alerts (any negative MTM): ${lossAlerts.length}`);
  console.log(`Dashboard chips: ${chips.length}`);

  console.log("\n--- Per-position table ---");
  console.log(
    [
      "ticker".padEnd(8),
      "pnl€".padStart(8),
      "pnl%".padStart(7),
      "24h%".padStart(7),
      "pplan".padStart(5),
      "risk".padStart(4),
      "reg".padStart(4),
      "sds".padStart(4),
      "score".padStart(6),
      "op".padStart(6),
      "final".padStart(6),
      "exit".padStart(6),
      "nearest SELL / block",
    ].join(" "),
  );

  for (const item of portfolioItems.sort(
    (a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0),
  )) {
    const simRow = rowByKey.get(item.key) ?? null;
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
    const explained = explainRecommendation(scores, finalRec, false, op);
    const sellProbe = probeSellGates(scores);
    const simBlock = classifySimLoopSellBlock(item);
    const holdThesis = explainHoldThesis(item, "en");
    const sellReason = explainSellReason(item, false, "en");
    const soft = softSellGrade1(scores, item);
    const urgent = isUrgentPortfolioLossExit({
      exitDecision: item.exitDecision,
      stabilityVerdict: item.stabilityVerdict,
    });
    const inLossAlert = lossAlerts.some((a) => a.key === item.key);

    const nearestLabel =
      finalRec === "sell" || scoreRec === "sell" || op === "sell"
        ? `FIRED score=${scoreRec}/op=${op} ${sellReason ?? explained.trigger}`
        : `[${sellProbe.activeRule}] ${sellProbe.nearest?.gap ?? ""} | sim: ${simBlock}`;

    const patternKey =
      finalRec === "sell"
        ? "final_sell"
        : scores.isRescue && scoreRec === "review"
          ? "rescue_review_sticky"
          : scoreRec === "hold" && (scores.pplan ?? 0) >= 50
            ? "pplan_hold_sticky"
            : simBlock.startsWith("exitDecision=")
              ? "no_exit_decision"
              : simBlock.includes("recovery_guard")
                ? "recovery_guard_blocks"
                : simBlock === "mtm_positive_never_sell"
                  ? "mtm_green"
                  : `score_${scoreRec}_op_${op}`;
    patternCounts.set(patternKey, (patternCounts.get(patternKey) ?? 0) + 1);

    if (soft.hits && finalRec !== "sell") softHits.push(`${item.ticker}: ${soft.why}`);
    if (
      (item.pnlPct ?? 0) < 0 &&
      finalRec === "hold" &&
      (scores.pplan ?? 0) >= 50
    ) {
      holdSticky.push(
        `${item.ticker} pplan=${fmt(scores.pplan, 0)} total=${fmt(item.pnlPct)}% 24h=${fmt(item.pnlPct24h)}%`,
      );
    }

    const metrics = simRow
      ? positionPnlForOpenRow(simRow, inputs, history)
      : { pnlEur: null as number | null, pnlPct: item.pnlPct };

    console.log(
      [
        item.ticker.padEnd(8),
        fmt(metrics.pnlEur, 0).padStart(8),
        fmt(item.pnlPct).padStart(7),
        fmt(item.pnlPct24h).padStart(7),
        fmt(scores.pplan, 0).padStart(5),
        fmt(scores.riskV2, 0).padStart(4),
        fmt(scores.regRisk, 0).padStart(4),
        fmt(scores.sds, 0).padStart(4),
        scoreRec.padStart(6),
        op.padStart(6),
        finalRec.padStart(6),
        item.exitDecision.padStart(6),
        nearestLabel.slice(0, 90),
      ].join(" "),
    );

    rows.push({
      ticker: item.ticker,
      key: item.key,
      pnlEur: metrics.pnlEur,
      pnlPct: item.pnlPct,
      pnlPct24h: item.pnlPct24h,
      capital: item.capital,
      pplan: scores.pplan,
      riskV2: scores.riskV2,
      regRisk: scores.regRisk,
      sds: scores.sds,
      mcs: scores.mcs,
      eis: scores.eis,
      resilience: scores.resilience ?? null,
      isRescue: scores.isRescue,
      lowLiqNoise: scores.lowLiqNoise ?? false,
      scoreRec,
      op,
      finalRec,
      exitDecision: item.exitDecision,
      investVerdict: item.investVerdict,
      recoveryP: item.recoveryProbabilityPct,
      recoveryCovers: item.recoveryCoversLoss,
      curveRisingHold: item.curveRisingHold,
      stabilityVerdict: item.stabilityVerdict,
      precat: item.precatKind,
      scoreTrigger: explained.trigger,
      sellProbe,
      scorePathNote: sellProbe.scorePathNote,
      simLoopBlock: simBlock,
      holdThesis,
      sellReason,
      softSellGrade1: soft,
      lossUrgentAlert: inLossAlert,
      urgentExitFlag: urgent,
      patternKey,
    });
  }

  const losers = rows.filter(
    (r) => typeof r.pnlPct === "number" && (r.pnlPct as number) < 0,
  );
  const dayLosers = rows.filter(
    (r) => typeof r.pnlPct24h === "number" && (r.pnlPct24h as number) < -1,
  );
  const finalSell = rows.filter((r) => r.finalRec === "sell");
  const scoreSell = rows.filter((r) => r.scoreRec === "sell");
  const opSell = rows.filter((r) => r.op === "sell");

  console.log("\n--- Pattern summary ---");
  console.log(
    `Open losers (total P&L<0): ${losers.length} · day losers (24h≤−1%): ${dayLosers.length}`,
  );
  console.log(
    `SELL counts — score: ${scoreSell.length} · sim-loop op: ${opSell.length} · final chart: ${finalSell.length}`,
  );
  for (const [k, n] of [...patternCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(2)}  ${k}`);
  }

  console.log("\n--- HOLD sticky (loser + pplan≥50 → score HOLD) ---");
  if (!holdSticky.length) console.log("  (none)");
  else for (const line of holdSticky) console.log(`  ${line}`);

  console.log("\n--- Soft SELL Grade-1 would-hit (proposal, not implemented) ---");
  if (!softHits.length) console.log("  (none)");
  else for (const line of softHits) console.log(`  ${line}`);

  console.log("\n--- Loss-urgent path ---");
  console.log(
    `  detectPortfolioLossAlerts: ${lossAlerts.length} names (UI modal for ANY open MTM loss — does NOT set chart SELL)`,
  );
  console.log(
    `  isUrgentPortfolioLossExit (exit|unstable): ${rows.filter((r) => r.urgentExitFlag).length}`,
  );
  for (const a of lossAlerts.slice(0, 15)) {
    const r = rows.find((x) => x.key === a.key);
    console.log(
      `  alert ${a.ticker} pnl=${fmt(a.pnlPct)}% €${fmt(a.pnlEur, 0)} → chart=${r?.finalRec ?? "?"} op=${r?.op ?? "?"} exit=${r?.exitDecision ?? "?"}`,
    );
  }

  // Concrete loser table for report
  console.log("\n--- Open losers: nearest SELL rule ---");
  for (const r of losers) {
    const near = (r.sellProbe as { nearest: SellGateProbe | null; activeRule?: string })
      .nearest;
    const active = (r.sellProbe as { activeRule?: string }).activeRule ?? "";
    console.log(
      `  ${String(r.ticker).padEnd(8)} total=${fmt(r.pnlPct as number)}% 24h=${fmt(r.pnlPct24h as number | null)}% ` +
        `p=${fmt(r.pplan as number | null, 0)} risk=${fmt(r.riskV2 as number | null, 0)} reg=${fmt(r.regRisk as number | null, 0)} ` +
        `REC=${r.finalRec}/${r.scoreRec}/${r.op} | path=${active} | nearest: ${near?.rule ?? "—"} — ${near?.gap ?? ""}`,
    );
  }

  console.log("\n--- Grade-1 soft SELL proposal (do not implement yet) ---");
  console.log(`  Soft pnl_sell: total P&L ≤ −4% AND (riskV2≥40 OR reg≥45 OR pplan<50)`);
  console.log(`  Soft pplan_sell: pplan < 45 AND total P&L ≤ −3%`);
  console.log(`  Soft sds_sell: SDS < 40 AND total P&L ≤ −5% AND riskV2≥40`);
  console.log(
    `  Soft rescue+day: isRescue AND 24h ≤ −2% AND pplan<50 AND NOT (P(recovery)≥${RECOVERY_HOLD_PROB_MIN}% + covers)`,
  );
  console.log(
    `  Note: hard pnl_sell uses TOTAL MTM (not 24h). Bad day alone never sells a still-green book.`,
  );
  console.log(
    `  HOLD sticky: pplan≥50 short-circuits to HOLD before pplan_sell_sub40; rescue often parks Uncertain unless pplan<40 or reg≥50.`,
  );

  const out = {
    generatedAt: new Date().toISOString(),
    summary: {
      openCount: portfolioItems.length,
      aggPnlEur: agg.pnlEur,
      aggPnlPct: agg.pnlPct,
      whatIf24hEurApprox: whatIf24h,
      nNeg24h,
      lossUrgentAlerts: lossAlerts.length,
      scoreSell: scoreSell.length,
      opSell: opSell.length,
      finalSell: finalSell.length,
      openLosers: losers.length,
      softSellWouldHit: softHits.length,
      patterns: Object.fromEntries(patternCounts),
      holdSticky,
      softHits,
    },
    thresholds: {
      pplanSell: 40,
      pplanHold: 50,
      pnlSell: -7,
      pnlSellCompanion: { riskV2: 45, reg: 55, pplan: 45 },
      regVeto: 70,
      rescueSell: { pplan: 40, reg: 50 },
      rescuePnl: -2,
      riskSell: 66,
      recoveryHold: RECOVERY_HOLD_PROB_MIN,
      softProposed: {
        pnlSell: -4,
        pnlCompanion: { riskV2: 40, reg: 45, pplan: 50 },
        pplanSell: 45,
        pplanPnl: -3,
        sdsSell: 40,
        sdsPnl: -5,
        rescueDay24h: -2,
      },
    },
    rows,
  };

  const outPath = path.join(DATA, "diag_portfolio_sell_missed.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\nJSON → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
