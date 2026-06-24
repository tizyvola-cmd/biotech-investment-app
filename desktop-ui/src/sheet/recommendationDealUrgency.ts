import type { CSSProperties } from "react";
import type { RecommendationGainIdea } from "./recommendationGainIdea";

/** Hot = guadagno atteso entro 24h; cold = oltre 24h (es. +€100 in 49g). */
export const DEAL_HOT_MAX_DAYS = 1;

export type DealTemperature = "hot" | "cold";

/** €/day — più alto = deal hot più urgente. */
export function dealEuroPerDay(gainEur: number, days: number): number {
  if (!Number.isFinite(gainEur) || !Number.isFinite(days) || gainEur <= 0 || days <= 0) {
    return 0;
  }
  return gainEur / days;
}

export function dealEuroPerDayFromIdea(idea: RecommendationGainIdea | null | undefined): number {
  if (!idea || idea.gainEur == null || idea.days == null) return 0;
  return dealEuroPerDay(idea.gainEur, idea.days);
}

export function classifyDealTemperature(
  gainEur: number | null | undefined,
  days: number | null | undefined,
): DealTemperature | null {
  if (gainEur == null || days == null || !Number.isFinite(gainEur) || !Number.isFinite(days)) {
    return null;
  }
  if (gainEur <= 0 || days <= 0) return null;
  return days <= DEAL_HOT_MAX_DAYS ? "hot" : "cold";
}

/** Fixed icon size in the recommendations table (no intensity scaling). */
export const DEAL_URGENCY_ICON_PX = 24;

export type DealUrgencyVisual = {
  euroPerDay: number;
  gainEur: number;
  days: number;
  temperature: DealTemperature | null;
  /** 0 = neutro, 1 = deal più rilevante nel set (hot: €/g; cold: € totale). */
  intensity: number;
  iconPx: number;
  /** @deprecated usa iconPx */
  flamePx: number;
};

function normalizeIntensity(raw: number, max: number): number {
  if (raw <= 0 || max <= 0) return 0;
  const linear = Math.min(1, raw / max);
  return Math.round(Math.sqrt(linear) * 1000) / 1000;
}

function ideaMetrics(idea: RecommendationGainIdea | null | undefined) {
  const gainEur = idea?.gainEur ?? 0;
  const days = idea?.days ?? 0;
  const rate = dealEuroPerDayFromIdea(idea);
  const temperature = classifyDealTemperature(gainEur, days);
  return { gainEur, days, rate, temperature };
}

/** Rank relativo tra le righe visibili (hot vs cold separati). */
export function buildDealUrgencyByKey(
  entries: Array<{ key: string; idea: RecommendationGainIdea | null | undefined }>,
): Map<string, DealUrgencyVisual> {
  const parsed = entries.map(({ key, idea }) => ({ key, ...ideaMetrics(idea) }));

  const maxHotRate = parsed
    .filter((r) => r.temperature === "hot")
    .reduce((m, r) => Math.max(m, r.rate), 0);
  const maxColdGain = parsed
    .filter((r) => r.temperature === "cold")
    .reduce((m, r) => Math.max(m, r.gainEur), 0);

  const out = new Map<string, DealUrgencyVisual>();
  for (const row of parsed) {
    let intensity = 0;
    if (row.temperature === "hot") {
      intensity = normalizeIntensity(row.rate, maxHotRate);
    } else if (row.temperature === "cold") {
      intensity = normalizeIntensity(row.gainEur, maxColdGain);
    }
    const iconPx =
      row.temperature && (row.rate > 0 || row.gainEur > 0) ? DEAL_URGENCY_ICON_PX : 0;
    out.set(row.key, {
      euroPerDay: row.rate,
      gainEur: row.gainEur,
      days: row.days,
      temperature: row.temperature,
      intensity,
      iconPx,
      flamePx: iconPx,
    });
  }
  return out;
}

export function dealUrgencyRowStyle(
  intensity: number,
  temperature: DealTemperature | null = "hot",
): CSSProperties | undefined {
  if (intensity <= 0 || !temperature) return undefined;
  const bgAlpha = 0.04 + intensity * 0.38;
  const edgeAlpha = 0.25 + intensity * 0.75;
  if (temperature === "cold") {
    return {
      background: `linear-gradient(90deg, rgba(186, 230, 253, ${bgAlpha}) 0%, rgba(255, 255, 255, ${Math.max(0.35, 1 - intensity * 0.55)}) 48%, rgba(255, 255, 255, 0.92) 100%)`,
      boxShadow: `inset 4px 0 0 rgba(14, 165, 233, ${edgeAlpha})`,
    };
  }
  return {
    background: `linear-gradient(90deg, rgba(254, 202, 202, ${bgAlpha}) 0%, rgba(255, 255, 255, ${Math.max(0.35, 1 - intensity * 0.55)}) 48%, rgba(255, 255, 255, 0.92) 100%)`,
    boxShadow: `inset 4px 0 0 rgba(220, 38, 38, ${edgeAlpha})`,
  };
}

export function dealUrgencyTooltip(
  visual: DealUrgencyVisual,
  gainEur: number,
  days: number,
  lang: "it" | "en",
): string {
  if (!visual.temperature || visual.intensity <= 0) return "";
  if (visual.temperature === "hot") {
    const rate = visual.euroPerDay.toFixed(1);
    if (lang === "it") {
      return `Deal hot (≤24h): +€${Math.round(gainEur)} in ${days}g ≈ €${rate}/g · intensità ${Math.round(visual.intensity * 100)}%`;
    }
    return `Hot deal (≤24h): +€${Math.round(gainEur)} in ${days}d ≈ €${rate}/day · intensity ${Math.round(visual.intensity * 100)}%`;
  }
  if (lang === "it") {
    return `Deal cold (>24h): +€${Math.round(gainEur)} in ${days}g · guadagno più lento · intensità ${Math.round(visual.intensity * 100)}%`;
  }
  return `Cold deal (>24h): +€${Math.round(gainEur)} in ${days}d · slower gain · intensity ${Math.round(visual.intensity * 100)}%`;
}
