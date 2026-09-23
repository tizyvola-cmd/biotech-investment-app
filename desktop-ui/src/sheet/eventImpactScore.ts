/** Event Impact Score — mirrors prediction/event_impact_score.py */

import type { ClinicalPublicationEvent, ClinicalStudyIndicator } from "../api/supernova";
import { mergeVirtualRegulatoryIndicators } from "./regulatoryVirtualKpi";

export type EisWeights = { w1: number; w2: number; w3: number; w4: number };

export type EisBreakdown = {
  score: number;
  delta_p_1d: number | null;
  delta_p_3d: number | null;
  delta_p_3d_effective?: number | null;
  vol_ratio: number;
  vol_term: number;
  vol_reaction_weight?: number;
  sentiment: number;
  kpi_score?: number | null;
  /** clamp(kpi_score, -2, +2) × K_INTRINSIC — not part of market ``score``. */
  eis_intrinsic?: number | null;
  sent_term: number;
  weights: EisWeights;
};

const DEFAULT_WEIGHTS: EisWeights = { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 };

/** Scale kpi_score [-2, +2] onto a term comparable to Sent_term. Not a market weight. */
export const K_INTRINSIC = 10;

export function eisIntrinsicFromKpi(kpiScore: number | null | undefined): number | null {
  if (kpiScore == null || !Number.isFinite(kpiScore)) return null;
  const clamped = Math.max(-2, Math.min(2, kpiScore));
  return Math.round(clamped * K_INTRINSIC * 100) / 100;
}

/** Compact feed / HIGH-IMPACT label. Null when missing or ~0. */
export function formatEisIntrinsicShort(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) return null;
  return `int ${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

const RATE_LABEL_RE =
  /\b(orr|dcr|cbr|crr|easi|iga|pasi|response\s*rate|overall\s*response|sensitivity|specificity|non[- ]?inferior|time\s*in\s*range|\btir\b|510\s*\(\s*k|pma\b|de\s+novo|clearance|recovery\s*rate|lifespan|accuracy|performance\s*goal)\b/i;

const KPI_TYPE_WEIGHT: Record<string, number> = {
  efficacy: 1,
  regulatory: 0.9,
  biomarker: 0.6,
  safety: 0.5,
  enrollment: 0.2,
  other: 0.3,
};

const DATA_MATURITY_BONUS: Record<string, number> = {
  final: 0.3,
  primary: 0.15,
  interim: 0,
  not_reported: -0.05,
};

function parsePvalue(text: string): number | null {
  if (!text) return null;
  const m = /\d+\.\d+/.exec(text);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

function parseRatePct(ind: ClinicalStudyIndicator): number | null {
  const nv = ind.numeric_value;
  if (nv != null && nv >= 0 && nv <= 100) return nv;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(String(ind.value ?? ""));
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 0 && v <= 100 ? v : null;
}

function parseComparativeDelta(ind: ClinicalStudyIndicator): number | null {
  if (ind.effect_size_delta_pp != null && Number.isFinite(ind.effect_size_delta_pp)) {
    return ind.effect_size_delta_pp;
  }
  const nv = ind.numeric_value;
  const comp = ind.comparator_value_numeric;
  if (nv != null && comp != null && Number.isFinite(nv) && Number.isFinite(comp)) {
    return nv - comp;
  }
  const m = /(\d+(?:\.\d+)?)\s*%\s*(?:vs\.?|versus)\s*~?\s*(\d+(?:\.\d+)?)\s*%/i.exec(
    String(ind.value ?? ""),
  );
  if (!m) return null;
  return Number(m[1]) - Number(m[2]);
}

function efficacyRateBonus(ind: ClinicalStudyIndicator): number {
  const label = String(ind.label ?? "");
  const kpiType = String(ind.kpi_type ?? "").toLowerCase();
  if (kpiType !== "efficacy" && !RATE_LABEL_RE.test(label)) return 0;

  const direction = String(ind.direction ?? "unknown").toLowerCase();
  const sign = direction === "down" ? -1 : 1;

  const delta = parseComparativeDelta(ind);
  if (delta != null) {
    if (delta >= 30) return sign * 0.65;
    if (delta >= 15) return sign * 0.4;
    if (delta >= 5) return sign * 0.2;
    if (delta <= -15) return sign * -0.4;
    if (delta <= -5) return sign * -0.2;
  }

  const rate = parseRatePct(ind);
  if (rate == null) return 0;
  if (rate >= 75) return sign * 0.65;
  if (rate >= 55) return sign * 0.4;
  if (rate >= 35) return sign * 0.2;
  if (rate < 15) return sign * -0.2;
  return 0;
}

/**
 * Per-indicator clinical quality contribution (same terms as EIS kpi_score).
 * Unbounded before blend; typical strong endpoint-met EFF ≈ +1.5–2.0.
 */
export function kpiIndicatorUnitScore(ind: ClinicalStudyIndicator): number {
  let s = 0;
  if (ind.endpoint_met === true) s += 0.8;
  else if (ind.endpoint_met === false) s -= 0.8;
  else {
    const direction = String(ind.direction ?? "unknown").toLowerCase();
    if (direction === "up") s += 0.15;
    else if (direction === "down") s -= 0.15;
  }

  const p = parsePvalue(String(ind.p_value ?? ""));
  if (p != null) {
    if (p < 0.001) s += 0.6;
    else if (p < 0.01) s += 0.4;
    else if (p < 0.05) s += 0.2;
    else s -= 0.1;
  }

  const dm = String(ind.data_maturity ?? "not_reported").toLowerCase();
  s += DATA_MATURITY_BONUS[dm] ?? 0;

  const vsSoc = String(ind.vs_soc ?? "");
  if (vsSoc && !["null", "n/d", ""].includes(vsSoc.toLowerCase())) s += 0.15;

  const ci = String(ind.confidence_interval ?? "");
  if (ci && !["null", "n/d", ""].includes(ci.toLowerCase())) s += 0.1;

  const typeW = KPI_TYPE_WEIGHT[String(ind.kpi_type ?? "other").toLowerCase()] ?? 0.3;
  s *= typeW;
  s += efficacyRateBonus(ind);

  return Math.round(s * 1000) / 1000;
}

/** Clinical quality score [-2, +2] from KPI indicators (mirrors Python). */
export function kpiIntrinsicScore(indicators: ClinicalStudyIndicator[]): number {
  if (!indicators.length) return 0;

  let best = -2;
  let total = 0;
  let count = 0;

  for (const ind of indicators.slice(0, 8)) {
    const s = kpiIndicatorUnitScore(ind);
    total += s;
    count += 1;
    if (s > best) best = s;
  }

  if (count === 0) return 0;
  const avg = total / count;
  const blended = 0.6 * best + 0.4 * avg;
  return Math.max(-2, Math.min(2, Math.round(blended * 1000) / 1000));
}

/** Compact badge text for a single KPI chip (EIS contribution). */
export function formatKpiUnitScoreBadge(score: number): string {
  if (!Number.isFinite(score) || Math.abs(score) < 0.05) return "";
  const rounded = Math.round(score * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `KPI ${sign}${rounded.toFixed(1)}`;
}

function effectiveDeltaP3d(d1: number, d3: number): number {
  if (Math.abs(d3) >= 1) return d3;
  if (d1 > 1 && Math.abs(d3) < 1) return Math.round(d1 * 0.4 * 100) / 100;
  if (d1 < -1 && Math.abs(d3) < 1) return Math.round(d1 * 0.4 * 100) / 100;
  return d3;
}

function volReactionWeight(d1: number, d3Eff: number): number {
  const reaction = Math.max(Math.abs(d1), Math.abs(d3Eff));
  if (reaction < 0.5) return 0;
  return Math.min(1, reaction / 3);
}

export function computeEis(
  deltaP1d: number | null | undefined,
  deltaP3d: number | null | undefined,
  volRatio: number | null | undefined,
  sentiment: number | null | undefined,
  weights: EisWeights = DEFAULT_WEIGHTS,
  kpiScore?: number | null,
): EisBreakdown {
  return computeEisBreakdown(deltaP1d, deltaP3d, volRatio, sentiment, weights, kpiScore);
}

/** Resolve EIS using visible KPIs when stored score ignored clinical data. */
/**
 * True for rows the backend flagged as unverified hypotheses. Their event date is
 * a guess, so any price delta read at that date belongs to something else.
 */
export function isUnverifiedHypothesis(
  ev: Partial<Pick<ClinicalPublicationEvent, "confirmation_status" | "eis_gated">>,
): boolean {
  return ev.confirmation_status === "anticipated" || Boolean(ev.eis_gated);
}

export function resolveEventEis(
  ev: Pick<ClinicalPublicationEvent, "eis" | "price" | "sentiment"> &
    Partial<
      Pick<
        ClinicalPublicationEvent,
        | "event_title"
        | "summary"
        | "source_type"
        | "event_type"
        | "items_raw"
        | "confirmation_status"
        | "eis_gated"
      >
    >,
  indicators: ClinicalStudyIndicator[] | undefined,
): EisBreakdown | null {
  if (isUnverifiedHypothesis(ev)) return null;
  const stored = ev.eis;
  const price = ev.price;
  const d1 = price?.delta_p_1d ?? stored?.delta_p_1d ?? null;
  const d3 = price?.delta_p_3d ?? stored?.delta_p_3d ?? null;
  const merged = mergeVirtualRegulatoryIndicators(ev, indicators);
  const outcomeIndicators = merged.filter(
    (i) =>
      i.kpi_type === "efficacy" ||
      i.kpi_type === "regulatory" ||
      i.endpoint_met != null ||
      RATE_LABEL_RE.test(i.label ?? ""),
  );
  const kpiPool = outcomeIndicators.length ? outcomeIndicators : merged;
  const kpiScore = kpiPool.length ? kpiIntrinsicScore(kpiPool) : (stored?.kpi_score ?? null);
  if (d1 == null && d3 == null && kpiScore == null && stored?.score == null) {
    return null;
  }
  const weights = stored?.weights
    ? {
        w1: stored.weights.w1 ?? DEFAULT_WEIGHTS.w1,
        w2: stored.weights.w2 ?? DEFAULT_WEIGHTS.w2,
        w3: stored.weights.w3 ?? DEFAULT_WEIGHTS.w3,
        w4: stored.weights.w4 ?? DEFAULT_WEIGHTS.w4,
      }
    : DEFAULT_WEIGHTS;
  // Desk / Daily News taxonomy score: keep it when market ΔP legs are still empty
  // so Volume vs EIS can paint red / azure / neutral from the published EIS.
  if (
    d1 == null &&
    d3 == null &&
    stored?.score != null &&
    Number.isFinite(stored.score)
  ) {
    const score = Math.round(Number(stored.score) * 100) / 100;
    const sent = Math.max(
      -2,
      Math.min(2, Number(ev.sentiment ?? stored.sentiment ?? 0) || 0),
    );
    return {
      score,
      delta_p_1d: null,
      delta_p_3d: null,
      vol_ratio: stored.vol_ratio != null && stored.vol_ratio > 0 ? stored.vol_ratio : 1,
      vol_term: stored.vol_term ?? 0,
      vol_reaction_weight: 0,
      sentiment: Math.round(sent * 100) / 100,
      kpi_score: kpiScore ?? stored.kpi_score ?? null,
      eis_intrinsic: stored.eis_intrinsic ?? score,
      sent_term: stored.sent_term ?? Math.round(sent * 10 * 100) / 100,
      weights,
    };
  }
  return computeEisBreakdown(
    d1,
    d3,
    stored?.vol_ratio,
    ev.sentiment ?? stored?.sentiment,
    weights,
    kpiScore,
  );
}

function computeEisBreakdown(
  deltaP1d: number | null | undefined,
  deltaP3d: number | null | undefined,
  volRatio: number | null | undefined,
  sentiment: number | null | undefined,
  weights: EisWeights = DEFAULT_WEIGHTS,
  kpiScore?: number | null,
): EisBreakdown {
  const d1 = deltaP1d ?? 0;
  const d3Raw = deltaP3d ?? 0;
  const d3 = effectiveDeltaP3d(d1, d3Raw);
  const vrRaw = volRatio != null && volRatio > 0 ? volRatio : 1;
  const vr = Math.min(vrRaw, 10);
  const sent = Math.max(-2, Math.min(2, sentiment ?? 0));
  const effectiveSent =
    kpiScore != null && Number.isFinite(kpiScore)
      ? Math.max(-2, Math.min(2, kpiScore))
      : sent;
  const volW = volReactionWeight(d1, d3);
  const volTerm = (vr - 1) * 20 * volW;
  const sentTerm = effectiveSent * 10;
  const score =
    weights.w1 * d1 + weights.w2 * d3 + weights.w3 * volTerm + weights.w4 * sentTerm;
  return {
    score: Math.round(score * 100) / 100,
    delta_p_1d: deltaP1d ?? null,
    delta_p_3d: deltaP3d ?? null,
    delta_p_3d_effective: d3 !== d3Raw ? d3 : null,
    vol_ratio: Math.round(vrRaw * 1000) / 1000,
    vol_term: Math.round(volTerm * 100) / 100,
    vol_reaction_weight: Math.round(volW * 1000) / 1000,
    sentiment: Math.round(sent * 100) / 100,
    kpi_score: kpiScore != null ? Math.round(kpiScore * 1000) / 1000 : null,
    eis_intrinsic: eisIntrinsicFromKpi(kpiScore),
    sent_term: Math.round(sentTerm * 100) / 100,
    weights,
  };
}

/** Bar width 0–100 for |score| capped at 50 pts display scale */
export function eisBarPercent(score: number): number {
  return Math.min(100, Math.round((Math.abs(score) / 50) * 100));
}

/** Sign-first: any negative → red, any positive → green; |score| intensity within each side. */
export function eisColor(score: number): string {
  if (score > 0) {
    if (score >= 8) return "#16a34a";
    if (score >= 2) return "#65a30d";
    return "#34D399";
  }
  if (score < 0) {
    if (score <= -8) return "#dc2626";
    if (score <= -2) return "#ea580c";
    return "#F87185";
  }
  return "#64748b";
}

/**
 * Display / polarity score: prefer market when the stock moved (|score| ≥ 0.5);
 * otherwise fall back to news/clinical intrinsic (KPI×10). Avoids painting a
 * dilutive manual event as “+0.0 / blue” when ΔP is still missing.
 */
export function resolvePrimaryEisScore(breakdown: Pick<EisBreakdown, "score" | "eis_intrinsic">): number {
  const market = breakdown.score;
  if (Number.isFinite(market) && Math.abs(market) >= 0.5) return market;
  const intrinsic = breakdown.eis_intrinsic;
  if (intrinsic != null && Number.isFinite(intrinsic)) return intrinsic;
  return Number.isFinite(market) ? market : 0;
}

