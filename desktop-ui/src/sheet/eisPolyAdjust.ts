/**
 * EIS polynomial shift — mirrors prediction/eis_poly_adjust.py + ai_feed_recalib.py
 * (client-side for Charts «+EIS» overlay).
 */

import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  ClinicalStudyIndicator,
} from "../api/supernova";
import { trustedRecordEvents } from "./clinicalTimeline";
import { resolveEventEis } from "./eventImpactScore";

/** Default env: PRED_EIS_POLY_ALPHA */
export const EIS_POLY_ALPHA = 0.15;
/** Default env: PRED_EIS_POLY_MAX_SHIFT */
export const EIS_POLY_MAX_SHIFT = 8.0;
/** Default env: PRED_CLINICAL_INDICATORS_ALPHA */
export const CLINICAL_INDICATORS_ALPHA = 0.35;
/** Default env: PRED_CLINICAL_INDICATORS_MAX_PP */
export const CLINICAL_INDICATORS_MAX_PP = 4.0;

export type EisClinicalSignal = {
  eisAgg: number | null;
  indicatorShiftPp: number;
  shiftPp: number;
  eventCount: number;
  kpiCount: number;
};

function parseIsoDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventPredictionScore(
  ev: ClinicalPublicationEvent,
  indicators: ClinicalStudyIndicator[] | undefined,
): number | null {
  const resolved = resolveEventEis(ev, indicators);
  if (resolved?.score != null && Number.isFinite(resolved.score)) {
    return resolved.score;
  }
  const sent = ev.sentiment;
  if (sent == null || !Number.isFinite(sent)) return null;
  const clamped = Math.max(-2, Math.min(2, sent));
  if (Math.abs(clamped) < 0.05) return null;
  return Math.round(clamped * 5 * 1000) / 1000;
}

function eventKpiQualityWeight(ev: ClinicalPublicationEvent): number {
  const indicators = ev.indicators ?? [];
  const resolved = resolveEventEis(ev, indicators);
  const kpiScore = resolved?.kpi_score;
  if (kpiScore != null && Number.isFinite(kpiScore)) {
    const quality = 1 + kpiScore * 0.25;
    return Math.max(0.5, Math.min(2, quality));
  }
  const rich = indicators
    .slice(0, 6)
    .filter(
      (ind) =>
        ind.p_value || ind.confidence_interval || ind.data_maturity,
    ).length;
  if (rich >= 3) return 1.5;
  if (rich >= 1) return 1.2;
  return 1;
}

export function aggregateEisForEvents(
  events: ClinicalPublicationEvent[],
  today: Date = new Date(),
  halfLifeDays = 21,
): number | null {
  if (!events.length) return null;
  let num = 0;
  let den = 0;
  for (const ev of events) {
    const indicators = ev.indicators ?? [];
    const score = eventPredictionScore(ev, indicators);
    if (score == null || !Number.isFinite(score)) continue;
    const ed = parseIsoDate(ev.event_date);
    let recencyW = 1;
    if (ed) {
      const age = Math.max(0, Math.floor((today.getTime() - ed.getTime()) / 86400000));
      recencyW = Math.exp(-age / Math.max(1, halfLifeDays));
    }
    const w = recencyW * eventKpiQualityWeight(ev);
    num += score * w;
    den += w;
  }
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 1000;
}

function indicatorUnitScore(ind: ClinicalStudyIndicator): number {
  let s = 0;
  if (ind.endpoint_met === true) s += 1;
  else if (ind.endpoint_met === false) s -= 1;
  else {
    const d = String(ind.direction ?? "").toLowerCase();
    if (d === "up") s += 0.35;
    else if (d === "down") s -= 0.35;
  }
  const pMatch = /\d+\.\d+/.exec(String(ind.p_value ?? ""));
  if (pMatch) {
    const p = Number(pMatch[0]);
    if (p < 0.001) s += 0.6;
    else if (p < 0.01) s += 0.45;
    else if (p < 0.05) s += 0.25;
  }
  const maturity = String(ind.data_maturity ?? "").toLowerCase();
  if (maturity === "final") s += 0.3;
  else if (maturity === "primary") s += 0.15;
  else if (maturity === "not_reported") s -= 0.05;
  return s;
}

export function aggregateClinicalIndicatorShiftPp(
  rec: ClinicalPreCdRecord | null,
  events: ClinicalPublicationEvent[],
  today: Date = new Date(),
  halfLifeDays = 21,
): { shiftPp: number; kpiCount: number } {
  const scored: { ed: Date | null; unit: number }[] = [];
  const seen = new Set<string>();

  const collect = (ind: ClinicalStudyIndicator, ed: Date | null) => {
    const key = `${ed?.toISOString().slice(0, 10) ?? ""}|${String(ind.label ?? "").toLowerCase()}|${String(ind.endpoint_met)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const unit = indicatorUnitScore(ind);
    if (Math.abs(unit) < 1e-6) return;
    scored.push({ ed, unit });
  };

  for (const ind of rec?.clinical_indicators ?? []) {
    collect(ind, parseIsoDate(ind.indicator_date));
  }
  for (const ev of events) {
    const ed = parseIsoDate(ev.event_date);
    for (const ind of ev.indicators ?? []) {
      collect(ind, ed);
    }
  }

  if (!scored.length) return { shiftPp: 0, kpiCount: 0 };

  let num = 0;
  let den = 0;
  for (const { ed, unit } of scored) {
    let w = 1;
    if (ed) {
      const age = Math.max(0, Math.floor((today.getTime() - ed.getTime()) / 86400000));
      w = Math.exp(-age / Math.max(1, halfLifeDays));
    }
    num += unit * w;
    den += w;
  }
  if (den <= 0) return { shiftPp: 0, kpiCount: scored.length };
  const mean = num / den;
  let raw = mean * CLINICAL_INDICATORS_ALPHA;
  raw = Math.max(-CLINICAL_INDICATORS_MAX_PP, Math.min(CLINICAL_INDICATORS_MAX_PP, raw));
  return { shiftPp: Math.round(raw * 1000) / 1000, kpiCount: scored.length };
}

export function computeEisPolyShiftPp(
  eisAgg: number | null,
  extraPp = 0,
): number {
  if (eisAgg == null && !extraPp) return 0;
  const raw = (eisAgg ?? 0) * EIS_POLY_ALPHA + extraPp;
  return Math.max(
    -EIS_POLY_MAX_SHIFT,
    Math.min(EIS_POLY_MAX_SHIFT, Math.round(raw * 1000) / 1000),
  );
}

function clinicalEventsForRecord(rec: ClinicalPreCdRecord | null): ClinicalPublicationEvent[] {
  if (!rec) return [];
  return trustedRecordEvents(rec).filter(
    (ev) => String(ev.source_type ?? "").toLowerCase() !== "sec_8k",
  );
}

export function buildEisClinicalSignal(
  rec: ClinicalPreCdRecord | null,
  today: Date = new Date(),
): EisClinicalSignal {
  const events = clinicalEventsForRecord(rec);
  const eisAgg = aggregateEisForEvents(events, today);
  const { shiftPp: indicatorShiftPp, kpiCount } = aggregateClinicalIndicatorShiftPp(
    rec,
    events,
    today,
  );
  const shiftPp = computeEisPolyShiftPp(eisAgg, indicatorShiftPp);
  return {
    eisAgg,
    indicatorShiftPp,
    shiftPp,
    eventCount: events.length,
    kpiCount,
  };
}

export function findClinicalPreCdRecord(
  ticker: string,
  cdIso: string | null,
  records: ClinicalPreCdRecord[],
): ClinicalPreCdRecord | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    if (cdIso && rec.cd_date && rec.cd_date.slice(0, 10) !== cdIso) continue;
    return rec;
  }
  return null;
}
