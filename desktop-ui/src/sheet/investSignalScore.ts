/**
 * Metriche segnale allineate al Decision Lab (Score + Confidence).
 * Score v2: Pred +5 = forward 5g sulla curva modello da «oggi» (pre-CD), non ancora post-CD.
 */
import type { ChartPoint } from "../types";
import { POST_CD_WATCH_CAL_DAYS } from "./cdLifecycle";
import { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";
import { extractCurveInputs } from "./precatCurve";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import { resolveTodayExpectedVsRealUsd } from "./priceVariationHorizons";
import { extractSparklinePoints } from "./simulationSparkline";
import { readPred5RelativePp } from "./simulationPlanGain";
import { resolveSignHitForDaysToCd, resolvePriceAccuracyForDaysToCd, type SignAccuracyCurveView } from "./signAccuracyCurve";

export type SimSignalMetrics = {
  score: number | null;
  affidPct: number | null;
  r2: number | null;
  pred5Pp: number | null;
  daysToCd: number | null;
  /** Scostamento % reale vs modello a oggi (pre-CD). */
  gapPct: number | null;
};

/**
 * Pesi massimi — valutazione fedeltà modello pre-CD (non esito post-CD).
 * Somma teorica ≈ 95 → forte ~55+ con fit e forward allineati.
 */
export const SCORE_COMPONENT_MAX = {
  affid: 30,
  r2: 25,
  timing: 10,
  align: 10,
  pred: 20,
  accuracy: 15,
} as const;

export const SCORE_THEORETICAL_MAX =
  SCORE_COMPONENT_MAX.affid +
  SCORE_COMPONENT_MAX.r2 +
  SCORE_COMPONENT_MAX.timing +
  SCORE_COMPONENT_MAX.align +
  SCORE_COMPONENT_MAX.pred +
  SCORE_COMPONENT_MAX.accuracy;

/** Soglie |gap| % oggi — allineate a MAE pre-CD tipico Model Analysis (~3–10 pp). */
export const ACC_GAP_THRESHOLDS = [
  { maxAbs: 2, score: 15 },
  { maxAbs: 5, score: 12 },
  { maxAbs: 8, score: 10 },
  { maxAbs: 12, score: 7 },
  { maxAbs: 18, score: 4 },
  { maxAbs: 25, score: 1 },
] as const;

export type ScoreCeilingInfo = {
  /** Cap UI (0–100). */
  capTotal: 100;
  /** Somma grezza massima componenti (prima del cap). */
  rawSumMax: number;
  /** Punti timing massimi per questa distanza CD. */
  timingMax: number;
  /** Pred tipico watch zone (|forward 5g|≈2 pp, trust alto) — non il max teorico 20. */
  predTypicalMax: number;
  /** Profilo «eccellente» realistico per la fascia CD (Conf/R² ~85%, pred modesta). */
  realisticExcellent: number;
};

/**
 * Massimi raggiungibili — utile per interpretare score vs Model Analysis (hit% globale).
 *
 * Model Analysis mostra hit% direzionale di coorte (55–70% pre-CD) e MAE nodi.
 * Lo score tabella è composito per ticker: Conf + R² + Timing + Align (dir hit) + Pred + Gap oggi.
 */
export function scoreCeilingForDays(daysToCd: number | null): ScoreCeilingInfo {
  const timingMax = timingContribution(daysToCd).score;
  const trustHigh = 0.85;
  const predTypicalMax =
    Math.round(
      Math.min(1, 2 / 4) * SCORE_COMPONENT_MAX.pred * (0.45 + 0.55 * trustHigh) * 10,
    ) / 10;
  const realisticExcellent = Math.round(
    SCORE_COMPONENT_MAX.affid * 0.85 +
      SCORE_COMPONENT_MAX.r2 * 0.85 +
      timingMax +
      SCORE_COMPONENT_MAX.align +
      predTypicalMax +
      10,
  );
  return {
    capTotal: 100,
    rawSumMax: SCORE_THEORETICAL_MAX,
    timingMax,
    predTypicalMax,
    realisticExcellent: Math.min(100, realisticExcellent),
  };
}

/**
 * Accuratezza prezzo live: |gap| vs modello ricalibrato oggi (fallback senza curva coorte).
 */
function gapOnlyAccuracyContribution(gapPct: number | null): { score: number; label: string } {
  if (gapPct == null || !Number.isFinite(gapPct)) {
    return { score: 0, label: "—" };
  }
  const abs = Math.abs(gapPct);
  let score = 0;
  for (const tier of ACC_GAP_THRESHOLDS) {
    if (abs <= tier.maxAbs) {
      score = tier.score;
      break;
    }
  }
  const sign = gapPct >= 0 ? "+" : "";
  return {
    score,
    label: `Gap ${sign}${gapPct.toFixed(1)}% → +${score} pt (MAE-like, max ${SCORE_COMPONENT_MAX.accuracy})`,
  };
}

/** Mappa price accuracy % coorte (0–100) → punti Acc (max 15). */
function priceAccuracyToAccPoints(priceAccPct: number): number {
  if (priceAccPct >= 98) return SCORE_COMPONENT_MAX.accuracy;
  if (priceAccPct >= 95) return 14;
  if (priceAccPct >= 92) return 13;
  if (priceAccPct >= 90) return 12;
  if (priceAccPct >= 85) return 10;
  if (priceAccPct >= 80) return 8;
  if (priceAccPct >= 75) return 6;
  if (priceAccPct >= 70) return 5;
  if (priceAccPct >= 60) return 3;
  return 1;
}

/** Piccola correzione se il gap live oggi è molto lontano dal modello. */
function liveGapAccuracyAdjustment(gapPct: number | null): number {
  if (gapPct == null || !Number.isFinite(gapPct)) return 0;
  const abs = Math.abs(gapPct);
  if (abs <= 5) return 0;
  if (abs <= 10) return -0.5;
  if (abs <= 15) return -1;
  if (abs <= 20) return -1.5;
  return -2;
}

function computeAccuracyScore(
  gapPct: number | null,
  days: number | null,
  options?: ScoreBreakdownOptions,
): { score: number; label: string } {
  const resolved = resolvePriceAccuracyForDaysToCd(days, options?.signCurveView);
  if (resolved.priceAccPct != null && Number.isFinite(resolved.priceAccPct)) {
    const base = priceAccuracyToAccPoints(resolved.priceAccPct);
    const adj = liveGapAccuracyAdjustment(gapPct);
    const score =
      Math.round(
        Math.min(SCORE_COMPONENT_MAX.accuracy, Math.max(0, base + adj)) * 10,
      ) / 10;
    const cohort =
      resolved.cohort === "simulation"
        ? "Simulation"
        : resolved.cohort === "retro"
          ? "Retro"
          : "Cohort";
    const nStr = resolved.n > 0 ? ` · n=${resolved.n}` : "";
    const gapStr =
      gapPct != null
        ? ` · gap oggi ${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}%`
        : "";
    return {
      score,
      label: `${cohort} price acc ${Math.round(resolved.priceAccPct)}%${nStr}${gapStr} → +${score.toFixed(1)} pt`,
    };
  }
  return gapOnlyAccuracyContribution(gapPct);
}

function toSimNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function findSimCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().replace(/\n/g, " ").includes(lo));
}

function resolveAffidCol(cols: string[]): string {
  const flat = (c: string) => c.replace(/\n/g, " ");
  return (
    cols.find((c) => /affidabilit/i.test(flat(c)) && /calib/i.test(flat(c))) ??
    findSimCol(cols, "Affidabilit") ??
    cols.find((c) => /affid_live/i.test(flat(c))) ??
    ""
  );
}

function resolveR2Col(cols: string[]): string {
  const flat = (c: string) => c.replace(/\n/g, " ");
  return (
    findSimCol(cols, "R² fit") ??
    findSimCol(cols, "R²") ??
    findSimCol(cols, "R2") ??
    cols.find((c) => /r2_live/i.test(flat(c))) ??
    ""
  );
}

function readAffidFrac(row: Record<string, unknown>, cols: string[]): number | null {
  const colAff = resolveAffidCol(cols);
  let raw = colAff ? toSimNum(row[colAff]) : null;
  if (raw == null) {
    for (const k of Object.keys(row)) {
      const f = k.replace(/\n/g, " ");
      if (/affidabilit/i.test(f) && /calib/i.test(f)) {
        raw = toSimNum(row[k]);
        break;
      }
    }
  }
  if (raw == null) raw = toSimNum(row["affid_live"]);
  if (raw == null) return null;
  if (raw > 1.5) return Math.min(1, Math.max(0, raw / 100));
  return Math.min(1, Math.max(0, raw));
}

function readR2Frac(row: Record<string, unknown>, cols: string[]): number | null {
  const colR2 = resolveR2Col(cols);
  let raw = colR2 ? toSimNum(row[colR2]) : null;
  if (raw == null) raw = toSimNum(row["r2_live"]);
  if (raw == null) return null;
  if (raw > 1 && raw <= 100) return Math.min(1, Math.max(0, raw / 100));
  return Math.min(1, Math.max(0, raw));
}

function chartPointsFromSparklineRow(row: Record<string, unknown>): ChartPoint[] | null {
  const fb = extractSparklinePoints(row);
  if (fb.length < 2) return null;
  return fb.map((p) => ({
    offset: p.offset,
    pct_curva: p.val,
    pct_foglio: p.val,
    pct_modello: p.val,
  }));
}

/** Scostamento % reale vs prezzo modello ricalibrato a oggi (pre-CD). */
export function resolveScoreGapPct(
  row: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null,
): number | null {
  const pts = chartPoints?.length ? chartPoints : chartPointsFromSparklineRow(row);
  if (!pts?.length) return null;
  return resolveTodayExpectedVsRealUsd(row, pts).gapPct;
}

/** Peso finestra pre-CD — allineato a `SIM_HOT_ZONE_DAYS` (≈2 mesi = timing max). */
export function timingWeightForDays(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days) || days < 0) return 0;
  if (days <= 10) return 1;
  if (days <= SIM_HOT_ZONE_DAYS) return 1;
  if (days <= SIM_MONITOR_HORIZON_DAYS) {
    const span = SIM_MONITOR_HORIZON_DAYS - SIM_HOT_ZONE_DAYS;
    return 0.88 + (0.07 * (SIM_MONITOR_HORIZON_DAYS - days)) / span;
  }
  return 0.35;
}

function timingContribution(days: number | null): { score: number; label: string } {
  if (days == null) return { score: 0, label: "—" };
  if (days < 0) {
    return {
      score: 0,
      label:
        days >= -POST_CD_WATCH_CAL_DAYS ? `Post-CD T+${-days}` : "Past catalyst",
    };
  }
  const weight = timingWeightForDays(days);
  const score = Math.round(SCORE_COMPONENT_MAX.timing * weight * 10) / 10;
  let zone: string;
  if (days <= 3) zone = `peak T−${days}d`;
  else if (days <= 10) zone = `peak T−${days}d`;
  else if (days <= SIM_HOT_ZONE_DAYS) zone = `hot ${days}d`;
  else if (days <= SIM_MONITOR_HORIZON_DAYS) zone = `watch ${days}d`;
  else zone = `pre-CD ${days}d`;
  return { score, label: `${zone} → +${score.toFixed(1)} pt` };
}

function parseDmy(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysFromCd(s: string): number | null {
  const d = parseDmy(s);
  if (!d) {
    const iso = /^\d{4}-\d{2}-\d{2}/.exec(String(s ?? "").trim());
    if (iso) {
      const p = new Date(iso[0]);
      if (!Number.isNaN(p.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        p.setHours(0, 0, 0, 0);
        return Math.round((p.getTime() - today.getTime()) / 86_400_000);
      }
    }
    return null;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function modelTrust(affidFrac: number | null, r2: number | null): number {
  const r2n = r2 != null ? Math.min(1, Math.max(0, r2)) : 0.45;
  const affn = affidFrac != null ? Math.min(1, Math.max(0, affidFrac)) : 0.45;
  return 0.5 * r2n + 0.5 * affn;
}

/**
 * Forward 5g sulla curva da «oggi» — premia magnitudine e trust, non solo long.
 * Il segno entra in Align; qui conta quanto il modello anticipa il movimento.
 */
function predContribution(
  pred5: number | null,
  affidFrac: number | null,
  r2: number | null,
  slope5d: number | null,
): { score: number; label: string } {
  if (pred5 == null || Math.abs(pred5) < 0.05) {
    return { score: 0, label: pred5 != null ? "|Pred +5| < 0.05pp" : "—" };
  }
  const trust = modelTrust(affidFrac, r2);
  const mag = Math.min(1, Math.abs(pred5) / 4);
  const aligned =
    slope5d == null || Math.abs(slope5d) < 0.05 || (slope5d > 0) === (pred5 > 0);
  const alignFactor = aligned ? 1 : 0.35;
  const score =
    Math.round(mag * SCORE_COMPONENT_MAX.pred * (0.45 + 0.55 * trust) * alignFactor * 10) /
    10;
  return {
    score,
    label: `Forward 5g ${pred5 >= 0 ? "+" : ""}${pred5.toFixed(2)}pp → +${score.toFixed(1)} pt`,
  };
}

/**
 * Allineamento pendenza curva ↔ forward Pred +5.
 * Usa slope 20d se 5d è piatta (rumore intraday) — tipico in watch zone.
 */
function effectiveSlopeForAlign(
  slope5d: number | null,
  slope20d: number | null,
): number | null {
  if (slope5d != null && Math.abs(slope5d) >= 0.05) return slope5d;
  if (slope20d != null && Math.abs(slope20d) >= 0.03) return slope20d;
  return slope5d ?? slope20d;
}

/**
 * Allineamento direzionale — basato su direction hit% empirico (coorte Simulation
 * preferita), non solo slope↔pred istantaneo.
 */
function directionHitToAlignPoints(hitPct: number, daysToCd: number | null): number {
  if (!Number.isFinite(hitPct)) return 0;
  if (hitPct < 50) {
    return Math.max(-8, Math.round((hitPct - 50) * 0.6 * 10) / 10);
  }
  const edge = hitPct - 50;
  let score = Math.min(SCORE_COMPONENT_MAX.align, 5 + edge * 0.22);
  if (daysToCd != null && daysToCd <= SIM_HOT_ZONE_DAYS && hitPct >= 55) {
    score = Math.min(SCORE_COMPONENT_MAX.align, score + 1.5);
  }
  if (daysToCd != null && daysToCd <= 10 && hitPct >= 65) {
    score = SCORE_COMPONENT_MAX.align;
  }
  return Math.round(score * 10) / 10;
}

function slopeContrarianPenalty(
  slope5d: number | null,
  pred5: number | null,
  slope20d: number | null,
): number {
  const slope = effectiveSlopeForAlign(slope5d, slope20d);
  if (slope == null || pred5 == null || Math.abs(pred5) < 0.08) return 0;
  const aligned = (slope > 0) === (pred5 > 0);
  if (aligned) return 0;
  const rawPen = Math.abs(pred5) >= 1 ? -3 : Math.abs(pred5) >= 0.25 ? -2 : -1;
  return Math.max(-3, rawPen);
}

function computeAlignScore(
  days: number | null,
  directionHitPct: number | null,
  directionHitN: number,
  directionHitSource: string,
  directionHitCohort: "simulation" | "retro" | null,
  slope5d: number | null,
  pred5: number | null,
  slope20d: number | null,
): { score: number; label: string } {
  if (directionHitPct != null && Number.isFinite(directionHitPct)) {
    const base = directionHitToAlignPoints(directionHitPct, days);
    const pen = slopeContrarianPenalty(slope5d, pred5, slope20d);
    const score = Math.round(Math.min(SCORE_COMPONENT_MAX.align, Math.max(-8, base + pen)) * 10) / 10;
    const cohort =
      directionHitCohort === "simulation"
        ? "Simulation"
        : directionHitCohort === "retro"
          ? "Retro"
          : "Cohort";
    const nStr = directionHitN > 0 ? ` · n=${directionHitN}` : "";
    return {
      score,
      label: `${cohort} dir hit ${Math.round(directionHitPct)}%${nStr} (${directionHitSource}) → ${score >= 0 ? "+" : ""}${score.toFixed(1)} pt`,
    };
  }
  return slopeAlignment(slope5d, pred5, slope20d);
}

function resolveAlignDirectionHit(
  days: number | null,
  options?: ScoreBreakdownOptions,
): {
  hitPct: number | null;
  n: number;
  source: string;
  cohort: "simulation" | "retro" | null;
} {
  const resolved = resolveSignHitForDaysToCd(days, options?.signCurveView);
  let hitPct = resolved.hitPct;
  let n = resolved.n;
  let source = resolved.source;
  let cohort = resolved.cohort;

  const expected = options?.expectedHitPct;
  if (expected != null && Number.isFinite(expected) && (hitPct == null || expected > hitPct)) {
    hitPct = expected;
    source = "quintile expected Hit%";
    cohort = cohort ?? "retro";
  }

  return { hitPct, n, source, cohort };
}

export type ScoreBreakdownOptions = {
  signCurveView?: SignAccuracyCurveView | null;
  /** Hit% quintile cohort per ticker (fallback / boost). */
  expectedHitPct?: number | null;
};

/** Fallback slope↔pred quando manca la curva direction hit. */
function slopeAlignment(
  slope5d: number | null,
  pred5: number | null,
  slope20d: number | null = null,
): { score: number; label: string } {
  const slope = effectiveSlopeForAlign(slope5d, slope20d);
  if (slope == null || pred5 == null) {
    return { score: 0, label: "—" };
  }
  const predSig = tradeCalibThreshold("pred_significant_pp");
  const aligned = (slope > 0) === (pred5 > 0);
  const slopeSrc =
    slope5d != null && Math.abs(slope5d) >= 0.05 ? "5d" : slope20d != null ? "20d" : "5d";
  if (!aligned) {
    const rawPen = Math.abs(pred5) >= 1 ? -10 : Math.abs(pred5) >= predSig ? -7 : -3;
    const pen = Math.max(-8, rawPen);
    return {
      score: pen,
      label: `Contrarian slope ${slopeSrc}↔pred (${pen} pt)`,
    };
  }
  if (Math.abs(pred5) >= 1) {
    return { score: 10, label: `Slope ${slopeSrc} ↔ pred allineati (+10)` };
  }
  if (Math.abs(pred5) >= predSig) {
    return { score: 6, label: `Allineati (${slopeSrc}, |pred|≥${predSig}pp) +6` };
  }
  if (Math.abs(pred5) >= 0.15) {
    return { score: 3, label: `Stesso segno (${slopeSrc}), pred piccola +3` };
  }
  return { score: 0, label: "|Pred +5| troppo piccola → neutro" };
}

export function computeSignalScore(
  affidFrac: number | null,
  r2: number | null,
  pred5: number | null,
  days: number | null,
  slope5d: number | null = null,
  gapPct: number | null = null,
  slope20d: number | null = null,
  options?: ScoreBreakdownOptions,
): number | null {
  const b = computeScoreBreakdown(
    affidFrac,
    r2,
    pred5,
    days,
    slope5d,
    gapPct,
    slope20d,
    options,
  );
  if (affidFrac == null && r2 == null && days == null && pred5 == null) return null;
  return b.total;
}

export type ScoreBreakdown = {
  total: number;
  affidScore: number;
  r2Score: number;
  timingScore: number;
  slopeAlign: number;
  predScore: number;
  accuracyScore: number;
  gapPct: number | null;
  timingLabel: string;
  slopeAlignLabel: string;
  predLabel: string;
  accuracyLabel: string;
};

export function computeScoreBreakdown(
  affidFrac: number | null,
  r2: number | null,
  pred5: number | null,
  days: number | null,
  slope5d: number | null = null,
  gapPct: number | null = null,
  slope20d: number | null = null,
  options?: ScoreBreakdownOptions,
): ScoreBreakdown {
  const affidScore =
    affidFrac != null
      ? Math.round(Math.min(1, Math.max(0, affidFrac)) * SCORE_COMPONENT_MAX.affid * 10) / 10
      : 0;
  const r2Score =
    r2 != null
      ? Math.round(Math.min(1, Math.max(0, r2)) * SCORE_COMPONENT_MAX.r2 * 10) / 10
      : 0;

  let timingScore = 0;
  let timingLabel = "—";
  const timing = timingContribution(days);
  timingScore = timing.score;
  timingLabel = timing.label;

  const dirHit = resolveAlignDirectionHit(days, options);
  const align = computeAlignScore(
    days,
    dirHit.hitPct,
    dirHit.n,
    dirHit.source,
    dirHit.cohort,
    slope5d,
    pred5,
    slope20d,
  );
  const pred = predContribution(pred5, affidFrac, r2, slope5d);
  const accuracy = computeAccuracyScore(gapPct, days, options);

  const raw =
    affidScore + r2Score + timingScore + align.score + pred.score + accuracy.score;
  const total = Math.round(Math.min(100, Math.max(0, raw)));

  return {
    total,
    affidScore,
    r2Score,
    timingScore,
    slopeAlign: align.score,
    predScore: pred.score,
    accuracyScore: accuracy.score,
    gapPct,
    timingLabel,
    slopeAlignLabel: align.label,
    predLabel: pred.label,
    accuracyLabel: accuracy.label,
  };
}

export type SignalMetricsFromRowOptions = {
  chartPoints?: ChartPoint[] | null;
  signCurveView?: SignAccuracyCurveView | null;
  expectedHitPct?: number | null;
};

export function signalMetricsFromSimRow(
  row: Record<string, unknown>,
  columns: string[],
  options?: SignalMetricsFromRowOptions,
): SimSignalMetrics {
  const colCd = findSimCol(columns, "Completion Date") ?? "Completion Date";

  const affidRaw = readAffidFrac(row, columns);
  const affidPct =
    affidRaw != null ? Math.round(Math.min(1, Math.max(0, affidRaw)) * 1000) / 10 : null;

  const r2 = readR2Frac(row, columns);
  const pred5 = readPred5RelativePp(row, { chartPoints: options?.chartPoints });

  const days = daysFromCd(String(row[colCd] ?? ""));
  const { slope5d, slope20d } = extractCurveInputs(row);
  const gapPct = resolveScoreGapPct(row, options?.chartPoints);
  const scoreOpts: ScoreBreakdownOptions = {
    signCurveView: options?.signCurveView,
    expectedHitPct: options?.expectedHitPct,
  };
  const score = computeSignalScore(
    affidRaw,
    r2,
    pred5,
    days,
    slope5d,
    gapPct,
    slope20d,
    scoreOpts,
  );

  return { score, affidPct, r2, pred5Pp: pred5, daysToCd: days, gapPct };
}

export function buildSimScoreTooltip(m: SimSignalMetrics, lang: "it" | "en" = "it"): string {
  const rel = scoreReliabilityTier(m.score);
  const label = lang === "it" ? rel.labelIt : rel.labelEn;
  const hint = lang === "it" ? rel.hintIt : rel.hintEn;
  const lines = [
    lang === "it"
      ? `Affidabilità predizione: ${m.score ?? "—"}/100 — ${label}`
      : `Prediction reliability: ${m.score ?? "—"}/100 — ${label}`,
    hint,
  ];
  if (m.affidPct != null) {
    lines.push(
      lang === "it"
        ? `Confidence modello: ${Math.round(m.affidPct)}%`
        : `Model confidence: ${Math.round(m.affidPct)}%`,
    );
  }
  if (m.r2 != null) lines.push(`R² fit: ${m.r2.toFixed(2)}`);
  if (m.pred5Pp != null) {
    lines.push(
      `Pred +5: ${m.pred5Pp >= 0 ? "+" : ""}${m.pred5Pp.toFixed(2)}pp`,
    );
  }
  if (m.gapPct != null) {
    lines.push(
      lang === "it"
        ? `Prezzo oggi vs modello: ${m.gapPct >= 0 ? "+" : ""}${m.gapPct.toFixed(1)}%`
        : `Price today vs model: ${m.gapPct >= 0 ? "+" : ""}${m.gapPct.toFixed(1)}%`,
    );
  }
  return lines.join("\n");
}

/** Fascia di interpretazione — stessa logica ovunque (barra, numero, tabella). */
export type ScoreReliabilityTier = "alta" | "buona" | "moderata" | "bassa" | "scarsa";

export type ScoreReliabilityInfo = {
  tier: ScoreReliabilityTier;
  labelIt: string;
  labelEn: string;
  hintIt: string;
  hintEn: string;
  textClass: string;
  barClass: string;
  badgeClass: string;
};

const SCORE_RELIABILITY_BANDS: {
  min: number;
  tier: ScoreReliabilityTier;
  labelIt: string;
  labelEn: string;
  hintIt: string;
  hintEn: string;
  textClass: string;
  barClass: string;
  badgeClass: string;
}[] = [
  {
    min: 65,
    tier: "alta",
    labelIt: "Alta",
    labelEn: "High",
    hintIt: "Modello solido su questo ticker: fit, coerenza curva e predizione allineati.",
    hintEn: "Solid model on this ticker: fit, curve coherence and prediction aligned.",
    textClass: "text-emerald-700 font-bold",
    barClass: "bg-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-800 border-emerald-400/40",
  },
  {
    min: 50,
    tier: "buona",
    labelIt: "Buona",
    labelEn: "Good",
    hintIt: "Predizione utilizzabile — qualità modello sopra la soglia «forte».",
    hintEn: "Usable prediction — model quality above the «strong» threshold.",
    textClass: "text-[rgb(var(--signal-up))] font-semibold",
    barClass: "bg-[rgb(var(--signal-up))]",
    badgeClass: "bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/30",
  },
  {
    min: 35,
    tier: "moderata",
    labelIt: "Moderata",
    labelEn: "Moderate",
    hintIt: "Affidabilità limitata — utile come watchlist, verificare Conf e gap prezzo.",
    hintEn: "Limited reliability — watchlist OK, check Conf and price gap.",
    textClass: "text-amber-700 font-semibold",
    barClass: "bg-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-800 border-amber-400/40",
  },
  {
    min: 22,
    tier: "bassa",
    labelIt: "Bassa",
    labelEn: "Low",
    hintIt: "Modello debole o segnali contrastanti — predizione poco attendibile.",
    hintEn: "Weak model or conflicting signals — prediction not very trustworthy.",
    textClass: "text-orange-700 font-medium",
    barClass: "bg-orange-500",
    badgeClass: "bg-orange-500/12 text-orange-800 border-orange-400/35",
  },
  {
    min: 0,
    tier: "scarsa",
    labelIt: "Scarsa",
    labelEn: "Poor",
    hintIt: "Dati insufficienti o modello non informativo su questo titolo.",
    hintEn: "Insufficient data or model not informative for this ticker.",
    textClass: "text-slate-500 font-medium",
    barClass: "bg-slate-400/70",
    badgeClass: "bg-slate-200/80 text-slate-600 border-slate-300/50",
  },
];

export function scoreReliabilityTier(score: number | null | undefined): ScoreReliabilityInfo {
  if (score == null || !Number.isFinite(score)) {
    return { ...SCORE_RELIABILITY_BANDS[SCORE_RELIABILITY_BANDS.length - 1]! };
  }
  const s = Math.round(score);
  for (const band of SCORE_RELIABILITY_BANDS) {
    if (s >= band.min) {
      return {
        tier: band.tier,
        labelIt: band.labelIt,
        labelEn: band.labelEn,
        hintIt: band.hintIt,
        hintEn: band.hintEn,
        textClass: band.textClass,
        barClass: band.barClass,
        badgeClass: band.badgeClass,
      };
    }
  }
  return { ...SCORE_RELIABILITY_BANDS[SCORE_RELIABILITY_BANDS.length - 1]! };
}

/** Elenco fasce per legenda UI (dall'alto al basso). */
export function scoreReliabilityLegend(): ScoreReliabilityInfo[] {
  return SCORE_RELIABILITY_BANDS.map((b) => ({
    tier: b.tier,
    labelIt: b.labelIt,
    labelEn: b.labelEn,
    hintIt: b.hintIt,
    hintEn: b.hintEn,
    textClass: b.textClass,
    barClass: b.barClass,
    badgeClass: b.badgeClass,
  }));
}

export function signalScoreTone(score: number | null): string {
  return scoreReliabilityTier(score).textClass;
}

export function scoreBarFillClass(score: number): string {
  return scoreReliabilityTier(score).barClass;
}

export function gapMagnitudeTone(gapPct: number | null | undefined): string {
  if (gapPct == null || !Number.isFinite(gapPct)) return "text-ink-muted";
  const abs = Math.abs(gapPct);
  if (abs <= 5) return "text-emerald-700 font-semibold";
  if (abs <= 12) return "text-amber-700 font-medium";
  return "text-orange-800 font-semibold";
}

/** Tooltip Gap: gap live oggi; Acc da price accuracy coorte quando disponibile. */
export function formatGapTooltip(
  gapPct: number | null,
  lang: "it" | "en" = "it",
  options?: { days?: number | null; signCurveView?: SignAccuracyCurveView | null },
): string {
  if (gapPct == null) return lang === "it" ? "Gap non disponibile" : "Gap unavailable";
  const abs = Math.abs(gapPct);
  const dir =
    gapPct > 0
      ? lang === "it"
        ? "Prezzo reale SOPRA il modello"
        : "Real price ABOVE model"
      : gapPct < 0
        ? lang === "it"
          ? "Prezzo reale SOTTO il modello"
          : "Real price BELOW model"
        : lang === "it"
          ? "Allineato al modello"
          : "Aligned with model";
  const acc = computeAccuracyScore(gapPct, options?.days ?? null, {
    signCurveView: options?.signCurveView,
  });
  const accNote =
    acc.label.includes("price acc") || acc.label.includes("Price acc")
      ? lang === "it"
        ? `Acc da price accuracy coorte (+${acc.score} pt)`
        : `Acc from cohort price accuracy (+${acc.score} pts)`
      : lang === "it"
        ? `Acc da |gap| (+${acc.score} pt)`
        : `Acc from |gap| (+${acc.score} pts)`;
  return lang === "it"
    ? `${dir} · gap oggi ${abs.toFixed(1)}% · ${accNote}`
    : `${dir} · gap today ${abs.toFixed(1)}% · ${accNote}`;
}

export function scoreContributionTone(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "text-ink-muted/70";
  const ratio = value / max;
  if (ratio >= 0.65) return "text-[rgb(var(--signal-up))] font-semibold";
  if (ratio >= 0.35) return "text-[rgb(var(--warn))]";
  return "text-ink-muted";
}

export function signedMetricTone(value: number, neutralBand = 0.5): string {
  if (Math.abs(value) < neutralBand) return "text-ink-muted";
  if (value > 0) return "text-[rgb(var(--signal-up))] font-semibold";
  return "text-[rgb(var(--signal-down))] font-semibold";
}

export function signalAffidTone(affidPct: number | null): string {
  if (affidPct == null) return "text-ink-muted";
  const minQ = tradeCalibThreshold("affid_min_pct_for_quality");
  if (affidPct >= 65) return "text-[rgb(var(--signal-up))]";
  if (affidPct >= minQ) return "text-ink";
  return "text-[rgb(var(--warn))]";
}
