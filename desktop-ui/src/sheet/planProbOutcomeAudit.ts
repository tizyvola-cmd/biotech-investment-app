/**
 * Audit P(plan) / P(recovery) recommendations vs realized outcomes (Your portfolio).
 * Weighted by stated probability for calibration & learning-loop feedback.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  computeEntryOutlook,
  computeRecoveryOutlook,
  type ProbabilisticDecision,
} from "./recoveryProbability";
import type { StabilityVerdict } from "./slopeStability";

const PNL_ENTER_SUCCESS_PCT = 0.5;
const PNL_WAIT_FLAT_BAND_PCT = 2.0;
const PNL_RECOVERY_SUCCESS_PCT = 0.5;

export type PlanProbAuditKind = "entry" | "recovery";

export type PlanProbAuditRow = {
  rowKey: string;
  ticker: string;
  kind: PlanProbAuditKind;
  probPct: number;
  decision: ProbabilisticDecision;
  decisionLabel: "enter" | "wait" | "skip" | "hold" | "review" | "exit";
  pnlPct: number | null;
  correct: boolean | null;
  /** Brier-style weight: (p - outcome01)^2 — lower is better calibration. */
  brier: number | null;
  /** probPct if wrong (penalty magnitude for learning). */
  confidencePenalty: number | null;
  evaluable: boolean;
  pending: boolean;
};

export type PlanProbCalibrationBin = {
  binLabel: string;
  binMid: number;
  n: number;
  meanProbPct: number;
  hitRatePct: number | null;
  meanBrier: number | null;
};

export type PlanProbLearningSummary = {
  evaluable: number;
  pending: number;
  correct: number;
  incorrect: number;
  accuracyPct: number | null;
  meanBrier: number | null;
  weightedPenalty: number | null;
  byDecision: Record<
    string,
    { n: number; correct: number; accuracyPct: number | null }
  >;
  calibrationBins: PlanProbCalibrationBin[];
  scatter: { probPct: number; success: number; ticker: string; decision: string }[];
  auditRows: PlanProbAuditRow[];
};

function slopeToVerdict(s20: number | null | undefined): StabilityVerdict {
  if (s20 == null || !Number.isFinite(s20)) return "none";
  if (s20 >= 0.125) return "persistent";
  if (s20 >= 0.05) return "entry";
  if (s20 <= -0.25) return "exit";
  if (s20 <= -0.1) return "avoid";
  return "watch";
}

function decisionLabel(
  d: ProbabilisticDecision,
  kind: PlanProbAuditKind,
): PlanProbAuditRow["decisionLabel"] {
  if (kind === "entry") {
    if (d === "hold") return "enter";
    if (d === "exit") return "skip";
    return "wait";
  }
  if (d === "hold") return "hold";
  if (d === "exit") return "exit";
  return "review";
}

function entrySuccess(pnlPct: number | null): boolean | null {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return null;
  return pnlPct > PNL_ENTER_SUCCESS_PCT;
}

function waitSuccess(pnlPct: number | null): boolean | null {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return null;
  return Math.abs(pnlPct) <= PNL_WAIT_FLAT_BAND_PCT;
}

function skipSuccess(pnlPct: number | null): boolean | null {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return null;
  return pnlPct <= PNL_ENTER_SUCCESS_PCT;
}

function recoverySuccess(pnlPct: number | null): boolean | null {
  if (pnlPct == null || !Number.isFinite(pnlPct)) return null;
  if (pnlPct >= -PNL_RECOVERY_SUCCESS_PCT) return true;
  return false;
}

function evaluateCorrect(
  decision: ProbabilisticDecision,
  kind: PlanProbAuditKind,
  pnlPct: number | null,
): boolean | null {
  if (kind === "entry") {
    if (decision === "hold") return entrySuccess(pnlPct);
    if (decision === "review") return waitSuccess(pnlPct);
    return skipSuccess(pnlPct);
  }
  if (decision === "hold") return recoverySuccess(pnlPct);
  if (decision === "exit") return pnlPct != null && pnlPct < -PNL_RECOVERY_SUCCESS_PCT;
  return waitSuccess(pnlPct);
}

function outcome01(correct: boolean): number {
  return correct ? 1 : 0;
}

function buildOutlookInput(
  row: SimOutcomeRow,
  simRow: Record<string, unknown> | null,
  lang: "it" | "en",
  inLoss: boolean,
) {
  const s20 = row.entry_slope_20d ?? row.pre_cd_slope_20d ?? row.latest_slope_20d ?? null;
  const s5 = row.entry_slope_5d ?? row.pre_cd_slope_5d ?? row.latest_slope_5d ?? null;
  const aff = row.entry_affidabilita_pct ?? row.affidabilita_pct ?? null;
  const pred7 = row.entry_pred7_pp ?? row.pred7_pp ?? null;
  const pred5 = row.entry_pred5_pp ?? pred7;
  const r2 = row.entry_r2_fit ?? null;

  const sdsProxy = aff != null ? Math.min(100, Math.max(0, aff * 0.85)) : null;
  const miiProxy = s20 != null ? s20 * 12 : null;
  const forwardPct =
    pred7 != null && pred7 > 0
      ? pred7
      : pred5 != null && pred5 > 0
        ? pred5
        : null;

  const phase = String(simRow?.Fase ?? simRow?.phase ?? "");
  const condition = String(simRow?.Indicazione ?? simRow?.indication ?? "");

  return {
    lang,
    inLoss,
    pnlPct: inLoss ? row.pnl_pct : null,
    forwardPct,
    curveGapPct: null as number | null,
    matchPct: r2 != null ? Math.min(100, r2 * 100) : null,
    sdsScore: sdsProxy,
    sdsVeto: sdsProxy != null && sdsProxy < 25,
    miiAngleDeg: miiProxy,
    stabilityVerdict: slopeToVerdict(s20),
    curveRisingHold: (s5 ?? 0) > 0 && (s20 ?? 0) > -0.05,
    daysToCd: row.days_to_cd,
    windowCorr: null as number | null,
    eisSuperScore: null as number | null,
    ticker_data: { phase, condition },
  };
}

function auditOneRow(
  row: SimOutcomeRow,
  simRow: Record<string, unknown> | null,
  lang: "it" | "en",
): PlanProbAuditRow | null {
  const hasEntry = Boolean(row.entry_ts || row.entry_slope_20d != null);
  if (!hasEntry && row.capital_eur <= 0) return null;

  const inLoss = row.pnl_pct != null && row.pnl_pct < -PNL_RECOVERY_SUCCESS_PCT;
  const kind: PlanProbAuditKind = inLoss && row.decision_current_open !== false ? "recovery" : "entry";
  const input = buildOutlookInput(row, simRow, lang, kind === "recovery");

  const outlook =
    kind === "recovery"
      ? computeRecoveryOutlook({ ...input, inLoss: true, pnlPct: row.pnl_pct })
      : computeEntryOutlook(input);

  const probPct = outlook.probabilityPct;
  const decision = outlook.suggestedDecision;
  const label = decisionLabel(decision, kind);

  const isOpen = row.decision_current_open === true || row.outcome?.startsWith("open");
  const pending = isOpen && row.pnl_pct == null;

  const correct = pending ? null : evaluateCorrect(decision, kind, row.pnl_pct);
  const evaluable = !pending && correct != null;

  let brier: number | null = null;
  let confidencePenalty: number | null = null;
  if (evaluable && correct != null) {
    const p = probPct / 100;
    const y = outcome01(correct);
    brier = Math.round((p - y) ** 2 * 1000) / 1000;
    if (!correct) confidencePenalty = Math.round(probPct * 10) / 10;
  }

  return {
    rowKey: row.row_key,
    ticker: row.ticker,
    kind,
    probPct,
    decision,
    decisionLabel: label,
    pnlPct: row.pnl_pct,
    correct,
    brier,
    confidencePenalty,
    evaluable,
    pending,
  };
}

export function buildPlanProbLearningSummary(
  rows: SimOutcomeRow[],
  simRowByKey: Map<string, Record<string, unknown>>,
  lang: "it" | "en" = "it",
): PlanProbLearningSummary {
  const auditRows: PlanProbAuditRow[] = [];
  for (const row of rows) {
    const baseKey = row.row_key.split("#cycle", 1)[0] ?? row.row_key;
    const simRow = simRowByKey.get(baseKey) ?? simRowByKey.get(row.row_key) ?? null;
    const a = auditOneRow(row, simRow, lang);
    if (a) auditRows.push(a);
  }

  const evaluableRows = auditRows.filter((r) => r.evaluable && r.correct != null);
  const pending = auditRows.filter((r) => r.pending).length;
  const correctN = evaluableRows.filter((r) => r.correct).length;
  const incorrectN = evaluableRows.length - correctN;

  const byDecision: PlanProbLearningSummary["byDecision"] = {};
  for (const r of evaluableRows) {
    const k = r.decisionLabel;
    if (!byDecision[k]) byDecision[k] = { n: 0, correct: 0, accuracyPct: null };
    byDecision[k].n += 1;
    if (r.correct) byDecision[k].correct += 1;
  }
  for (const k of Object.keys(byDecision)) {
    const b = byDecision[k]!;
    b.accuracyPct = b.n ? Math.round((100 * b.correct) / b.n * 10) / 10 : null;
  }

  const meanBrier =
    evaluableRows.length && evaluableRows.every((r) => r.brier != null)
      ? Math.round(
          (evaluableRows.reduce((s, r) => s + (r.brier ?? 0), 0) / evaluableRows.length) * 1000,
        ) / 1000
      : null;

  const weightedPenalty =
    evaluableRows.length
      ? Math.round(
          (evaluableRows.reduce((s, r) => s + (r.confidencePenalty ?? 0), 0) / evaluableRows.length) *
            10,
        ) / 10
      : null;

  const binMap = new Map<number, { n: number; probSum: number; hits: number; brierSum: number }>();
  for (const r of evaluableRows) {
    const bin = Math.min(90, Math.max(0, Math.floor(r.probPct / 10) * 10));
    const cur = binMap.get(bin) ?? { n: 0, probSum: 0, hits: 0, brierSum: 0 };
    cur.n += 1;
    cur.probSum += r.probPct;
    if (r.correct) cur.hits += 1;
    cur.brierSum += r.brier ?? 0;
    binMap.set(bin, cur);
  }

  const calibrationBins: PlanProbCalibrationBin[] = [...binMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bin, v]) => ({
      binLabel: `${bin}–${bin + 9}%`,
      binMid: bin + 5,
      n: v.n,
      meanProbPct: Math.round((v.probSum / v.n) * 10) / 10,
      hitRatePct: Math.round((100 * v.hits) / v.n * 10) / 10,
      meanBrier: Math.round((v.brierSum / v.n) * 1000) / 1000,
    }));

  const scatter = evaluableRows.map((r) => ({
    probPct: r.probPct,
    success: r.correct ? 1 : 0,
    ticker: r.ticker,
    decision: r.decisionLabel,
  }));

  return {
    evaluable: evaluableRows.length,
    pending,
    correct: correctN,
    incorrect: incorrectN,
    accuracyPct: evaluableRows.length
      ? Math.round((100 * correctN) / evaluableRows.length * 10) / 10
      : null,
    meanBrier,
    weightedPenalty,
    byDecision,
    calibrationBins,
    scatter,
    auditRows,
  };
}
