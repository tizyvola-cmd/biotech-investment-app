/**
 * Presentation adapter — gate-distance "pulls" for the recommendation breakdown.
 * Does NOT change the scoring engine in decisionChartLogic.ts.
 *
 * TODO: replace with real weighted model once aggregation is additive/log-odds.
 */

import { DECISION_CHART_AXES } from "./decisionChartIndices";
import {
  explainRecommendation,
  type DecisionChartTickerRow,
  type DecisionRec,
  type DecisionScoreInput,
} from "./decisionChartLogic";

export const USE_GATE_DISTANCE_CONTRIBUTIONS = true;

const PPLAN_BUY = 65;
const PPLAN_HOLD = 50;
const PPLAN_SELL_RESCUE = 40;
/** Aligned with decisionChartLogic primary Buy (Loss ≤ 40). */
const LOSS_BUY_MAX = 40;
const LOSS_SELL_MIN = 66;
const REG_SELL_MIN = 70;
/** Below this: Reg is comfortable — omit from pulls (no phantom pro-Buy). */
const REG_WARN_MIN = 55;
const SDS_HOLD_MIN = 50;

export type RecommendationCall = "BUY" | "HOLD" | "SELL" | "REVIEW";

export type IndexContribution = {
  key: string;
  label: string;
  contribution: number;
};

export type SwingFactor = {
  key: string;
  label: string;
  distance: number;
  direction: "buy" | "sell";
  detailIt: string;
  detailEn: string;
};

export type GapToFlip = {
  direction: "buy" | "sell";
  points: number;
};

export type RecommendationBreakdownModel = {
  call: RecommendationCall;
  compositeScore: number;
  buyThreshold: number;
  sellThreshold: number;
  holdThreshold: number;
  contributions: IndexContribution[];
  swingFactor: SwingFactor | null;
  gapToFlip: GapToFlip | null;
  headlineIt: string;
  headlineEn: string;
  triggerIt: string;
  triggerEn: string;
  isGateDistanceApprox: true;
};

const AXIS_LABEL: Record<string, { it: string; en: string }> = {
  pplan: { it: "P(plan)", en: "P(plan)" },
  sds: { it: "SDS", en: "SDS" },
  eis: { it: "EIS", en: "EIS" },
  riskV2: { it: "Loss risk", en: "Loss risk" },
  regRisk: { it: "Reg. score", en: "Reg. score" },
  mcs: { it: "MCS", en: "MCS" },
};

function toCall(rec: DecisionRec): RecommendationCall {
  return rec.toUpperCase() as RecommendationCall;
}

function compositeScore(s: DecisionScoreInput): number {
  if (s.pplan != null && Number.isFinite(s.pplan)) return Math.round(s.pplan);
  if (s.sds != null && Number.isFinite(s.sds)) return Math.round(s.sds);
  return 50;
}

/** Signed pro-buy pull per index (gate distance approximation). */
function gatePullPplan(pplan: number | null): number | null {
  if (pplan == null || !Number.isFinite(pplan)) return null;
  return Math.round(pplan - PPLAN_BUY);
}

function gatePullLoss(riskV2: number | null): number | null {
  if (riskV2 == null || !Number.isFinite(riskV2)) return null;
  return Math.round(LOSS_BUY_MAX - riskV2);
}

/**
 * Reg is a Sell-side pressure only — never a green "headroom to 70" pro-Buy pull.
 * Comfortable Reg (&lt; 55) is omitted so typical ~45–50 scores do not dominate %.
 */
function gatePullReg(regRisk: number | null): number | null {
  if (regRisk == null || !Number.isFinite(regRisk)) return null;
  if (regRisk < REG_WARN_MIN) return null;
  // 55→70: rising negative; ≥70 veto keeps growing with Reg.
  return Math.round(-(regRisk - REG_WARN_MIN));
}

function gatePullSds(sds: number | null): number | null {
  if (sds == null || !Number.isFinite(sds)) return null;
  return Math.round(sds - SDS_HOLD_MIN);
}

function gatePullEis(eisRaw: number | null, eis: number | null): number | null {
  if (eisRaw != null && Number.isFinite(eisRaw)) return Math.round(eisRaw);
  if (eis != null && Number.isFinite(eis)) return Math.round(eis - 50);
  return null;
}

function gatePullMcs(mcs: number | null): number | null {
  if (mcs == null || !Number.isFinite(mcs)) return null;
  return Math.round(mcs - 50);
}

type RawPull = { key: string; label: string; contribution: number };

function rawPulls(s: DecisionScoreInput): RawPull[] {
  const pulls: RawPull[] = [];
  const add = (key: string, contribution: number | null) => {
    if (contribution == null || contribution === 0) return;
    const labels = AXIS_LABEL[key];
    if (!labels) return;
    pulls.push({ key, label: labels.en, contribution });
  };

  add("pplan", gatePullPplan(s.pplan));
  add("riskV2", gatePullLoss(s.riskV2));
  add("regRisk", gatePullReg(s.regRisk));
  add("sds", gatePullSds(s.sds));
  add("eis", gatePullEis(s.eisRaw, s.eis));
  add("mcs", gatePullMcs(s.mcs));
  return pulls;
}

/** Gate-distance contributions — NOT true weighted shares. */
export function deriveContributions(
  s: DecisionScoreInput,
  it = false,
): IndexContribution[] {
  if (!USE_GATE_DISTANCE_CONTRIBUTIONS) return [];

  return rawPulls(s)
    .map((p) => ({
      key: p.key,
      label: it ? (AXIS_LABEL[p.key]?.it ?? p.label) : p.label,
      contribution: p.contribution,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export function contributionSharePct(
  contributions: IndexContribution[],
  key: string,
): number {
  const total = contributions.reduce((sum, c) => sum + Math.abs(c.contribution), 0);
  if (total <= 0) return 0;
  const c = contributions.find((x) => x.key === key);
  if (!c) return 0;
  return Math.round((Math.abs(c.contribution) / total) * 100);
}

type Constraint = {
  key: string;
  labelIt: string;
  labelEn: string;
  distance: number;
  direction: "buy" | "sell";
  detailIt: string;
  detailEn: string;
};

function buyFlipConstraints(s: DecisionScoreInput): Constraint[] {
  const out: Constraint[] = [];
  if (s.regRisk != null && s.regRisk >= REG_SELL_MIN) return out;

  if (s.pplan != null && s.pplan < PPLAN_BUY) {
    const d = Math.round(PPLAN_BUY - s.pplan);
    out.push({
      key: "pplan",
      labelIt: "P(plan)",
      labelEn: "P(plan)",
      distance: d,
      direction: "buy",
      detailIt: `P(plan) ${Math.round(s.pplan)} < ${PPLAN_BUY} (mancano ${d} pt)`,
      detailEn: `P(plan) ${Math.round(s.pplan)} < ${PPLAN_BUY} (need ${d} more pts)`,
    });
  } else if (s.pplan == null) {
    out.push({
      key: "pplan",
      labelIt: "P(plan)",
      labelEn: "P(plan)",
      distance: PPLAN_BUY,
      direction: "buy",
      detailIt: "P(plan) assente — Buy solo via SDS ≥ 65",
      detailEn: "P(plan) missing — Buy only via SDS ≥ 65",
    });
  }

  if (s.riskV2 != null && s.riskV2 > LOSS_BUY_MAX) {
    const d = Math.round(s.riskV2 - LOSS_BUY_MAX);
    out.push({
      key: "riskV2",
      labelIt: "Loss risk",
      labelEn: "Loss risk",
      distance: d,
      direction: "buy",
      detailIt: `Loss ${Math.round(s.riskV2)} > ${LOSS_BUY_MAX} (+${d} sopra soglia Buy)`,
      detailEn: `Loss ${Math.round(s.riskV2)} > ${LOSS_BUY_MAX} (+${d} above Buy cap)`,
    });
  }

  if (s.sds != null && s.sds < SDS_HOLD_MIN) {
    const d = Math.round(SDS_HOLD_MIN - s.sds);
    out.push({
      key: "sds",
      labelIt: "SDS",
      labelEn: "SDS",
      distance: d,
      direction: "buy",
      detailIt: `SDS ${Math.round(s.sds)} < ${SDS_HOLD_MIN} (setup debole)`,
      detailEn: `SDS ${Math.round(s.sds)} < ${SDS_HOLD_MIN} (weak setup)`,
    });
  }

  return out;
}

function sellFlipConstraints(s: DecisionScoreInput): Constraint[] {
  const out: Constraint[] = [];

  if (s.regRisk != null && s.regRisk < REG_SELL_MIN) {
    const d = Math.round(REG_SELL_MIN - s.regRisk);
    out.push({
      key: "regRisk",
      labelIt: "Reg. score",
      labelEn: "Reg. score",
      distance: d,
      direction: "sell",
      detailIt: `Reg. ${Math.round(s.regRisk)} — Sell se ≥ ${REG_SELL_MIN} (mancano ${d} pt)`,
      detailEn: `Reg. ${Math.round(s.regRisk)} — Sell at ≥ ${REG_SELL_MIN} (${d} pts away)`,
    });
  }

  if (s.riskV2 != null && s.riskV2 < LOSS_SELL_MIN) {
    const d = Math.round(LOSS_SELL_MIN - s.riskV2);
    out.push({
      key: "riskV2",
      labelIt: "Loss risk",
      labelEn: "Loss risk",
      distance: d,
      direction: "sell",
      detailIt: `Loss ${Math.round(s.riskV2)} — Sell se ≥ ${LOSS_SELL_MIN} (mancano ${d} pt)`,
      detailEn: `Loss ${Math.round(s.riskV2)} — Sell at ≥ ${LOSS_SELL_MIN} (${d} pts away)`,
    });
  }

  if (s.isRescue && s.pplan != null && s.pplan >= PPLAN_SELL_RESCUE) {
    const d = Math.round(s.pplan - PPLAN_SELL_RESCUE);
    out.push({
      key: "pplan",
      labelIt: "P(plan)",
      labelEn: "P(plan)",
      distance: d,
      direction: "sell",
      detailIt: `P(plan) ${Math.round(s.pplan)} — Sell rescue se < ${PPLAN_SELL_RESCUE}`,
      detailEn: `P(plan) ${Math.round(s.pplan)} — rescue Sell if < ${PPLAN_SELL_RESCUE}`,
    });
  } else if (!s.isRescue && s.pplan != null && s.pplan >= PPLAN_HOLD) {
    const d = Math.round(s.pplan - PPLAN_HOLD);
    out.push({
      key: "pplan",
      labelIt: "P(plan)",
      labelEn: "P(plan)",
      distance: d,
      direction: "sell",
      detailIt: `P(plan) ${Math.round(s.pplan)} — esce da Hold se < ${PPLAN_HOLD}`,
      detailEn: `P(plan) ${Math.round(s.pplan)} — leaves Hold if < ${PPLAN_HOLD}`,
    });
  }

  return out;
}

export function deriveSwingFactor(
  s: DecisionScoreInput,
  rec: DecisionRec,
  it = false,
): SwingFactor | null {
  if (rec === "buy") {
    const sell = sellFlipConstraints(s);
    if (!sell.length) return null;
    const nearest = sell.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return {
      key: nearest.key,
      label: it ? nearest.labelIt : nearest.labelEn,
      distance: nearest.distance,
      direction: "sell",
      detailIt: nearest.detailIt,
      detailEn: nearest.detailEn,
    };
  }

  if (rec === "sell") {
    const buy = buyFlipConstraints(s);
    if (!buy.length) return null;
    const nearest = buy.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return {
      key: nearest.key,
      label: it ? nearest.labelIt : nearest.labelEn,
      distance: nearest.distance,
      direction: "buy",
      detailIt: nearest.detailIt,
      detailEn: nearest.detailEn,
    };
  }

  const buy = buyFlipConstraints(s);
  const sell = sellFlipConstraints(s);
  const pool = [...buy, ...sell];
  if (!pool.length) return null;

  const nearest = pool.reduce((a, b) => (a.distance <= b.distance ? a : b));
  return {
    key: nearest.key,
    label: it ? nearest.labelIt : nearest.labelEn,
    distance: nearest.distance,
    direction: nearest.direction,
    detailIt: nearest.detailIt,
    detailEn: nearest.detailEn,
  };
}

export function deriveGapToFlip(
  s: DecisionScoreInput,
  rec: DecisionRec,
): GapToFlip | null {
  if (rec === "buy") {
    const sell = sellFlipConstraints(s);
    if (!sell.length) return null;
    const nearest = sell.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return { direction: "sell", points: nearest.distance };
  }
  if (rec === "sell") {
    const buy = buyFlipConstraints(s);
    if (!buy.length) return null;
    const nearest = buy.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return { direction: "buy", points: nearest.distance };
  }
  const buy = buyFlipConstraints(s);
  if (buy.length) {
    const nearest = buy.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return { direction: "buy", points: nearest.distance };
  }
  const sell = sellFlipConstraints(s);
  if (sell.length) {
    const nearest = sell.reduce((a, b) => (a.distance <= b.distance ? a : b));
    return { direction: "sell", points: nearest.distance };
  }
  return null;
}

export function buildRecommendationBreakdownModel(
  row: DecisionChartTickerRow,
  it = false,
): RecommendationBreakdownModel {
  const s = row.scores;
  const exIt = row.recExplanation ?? explainRecommendation(s, row.rec, true);
  const exEn = row.recExplanation ?? explainRecommendation(s, row.rec, false);
  const sellThreshold = s.isRescue ? PPLAN_SELL_RESCUE : PPLAN_SELL_RESCUE;

  return {
    call: toCall(row.rec),
    compositeScore: compositeScore(s),
    buyThreshold: PPLAN_BUY,
    sellThreshold,
    holdThreshold: PPLAN_HOLD,
    contributions: deriveContributions(s, it),
    swingFactor: deriveSwingFactor(s, row.rec, it),
    gapToFlip: deriveGapToFlip(s, row.rec),
    headlineIt: exIt.headline,
    headlineEn: exEn.headline,
    triggerIt: exIt.trigger,
    triggerEn: exEn.trigger,
    isGateDistanceApprox: true,
  };
}

/** Demo fixture — VIR-like HOLD (matches Phase 0 brief). */
export function demoRecommendationBreakdownModel(it = false): RecommendationBreakdownModel {
  const scores: DecisionScoreInput = {
    pplan: 61,
    sds: 26,
    eis: 50,
    eisRaw: 0,
    riskV2: 50,
    regRisk: 48,
    mcs: 15,
    pnlPct: 0,
    isRescue: false,
    status: "open",
  };
  const row: DecisionChartTickerRow = {
    key: "demo-vir",
    ticker: "VIR",
    company: "Vir Biotechnology",
    phaseLabel: null,
    pnlPct: 0,
    scores,
    rec: "hold",
    diagnostic: "P(plan) in hold band",
    insufficientScores: false,
  };
  return buildRecommendationBreakdownModel(row, it);
}

export { DECISION_CHART_AXES };
