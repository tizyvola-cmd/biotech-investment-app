/**
 * Aggregate EIS per ticker from clinical pre-CD enrichment snapshot.
 */

import type { ClinicalPreCdRecord, ClinicalStudyIndicator } from "../api/supernova";
import { nctClinicalTrialsUrl } from "./cellLinks";
import { hydrateClinicalPreCdRecords } from "./clinicalPreCdSnapshotCache";
import { trustedRecordEvents } from "./clinicalTimeline";
import { isClinicalPreCdRecordTrusted } from "./referenceVerification";
import { prepareClinicalIndicators } from "./clinicalIndicators";
import { resolveEventEis, type EisBreakdown } from "./eventImpactScore";

export type TickerEisSummary = {
  score: number | null;
  eventCount: number;
  /** Human-readable feed sources (K-8, PubMed, CT.gov, …). */
  feedLabels: string[];
  breakdownHint: string;
};

export type TickerEisEventDetail = {
  eventDate: string | null;
  title: string;
  sourceLabel: string;
  nctId: string | null;
  studyTitle: string;
  studyUrl: string | null;
  breakdown: EisBreakdown;
  indicators: ClinicalStudyIndicator[];
  impactNote: string | null;
  link: string | null;
  summary: string | null;
};

export type TickerEisDetail = TickerEisSummary & {
  events: TickerEisEventDetail[];
  /** True when score comes from Simulation sheet column only. */
  sheetFallback: boolean;
  company: string | null;
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
  /** Rollup KPI clinici (feed + eventi) — componente KPI×10 dell'EIS. */
  clinicalIndicators: ClinicalStudyIndicator[];
};

const SOURCE_LABEL: Record<string, { it: string; en: string }> = {
  sec_8k: { it: "SEC 8-K", en: "SEC 8-K" },
  press_release: { it: "Press", en: "Press" },
  ctgov: { it: "CT.gov", en: "CT.gov" },
  cd_milestone: { it: "CD", en: "CD" },
  congress: { it: "Congress", en: "Congress" },
  publication: { it: "Pub", en: "Pub" },
  clinical: { it: "Clinico", en: "Clinical" },
};

function feedLabel(sourceType: string, it: boolean): string {
  const key = sourceType.toLowerCase();
  const cfg = SOURCE_LABEL[key];
  if (cfg) return it ? cfg.it : cfg.en;
  return sourceType || (it ? "Feed" : "Feed");
}

function breakdownHint(b: EisBreakdown, it: boolean): string {
  const parts: string[] = [];
  if (b.delta_p_1d != null) parts.push(`ΔP₁d ${b.delta_p_1d >= 0 ? "+" : ""}${b.delta_p_1d.toFixed(1)}%`);
  if (b.delta_p_3d != null) parts.push(`ΔP₃d ${b.delta_p_3d >= 0 ? "+" : ""}${b.delta_p_3d.toFixed(1)}%`);
  if (b.kpi_score != null) parts.push(`KPI ${b.kpi_score >= 0 ? "+" : ""}${b.kpi_score.toFixed(2)}`);
  else if (Math.abs(b.sent_term) > 0.01) parts.push(`sent ${b.sent_term >= 0 ? "+" : ""}${b.sent_term.toFixed(1)}`);
  if (b.vol_term != null && Math.abs(b.vol_term) > 0.05) {
    parts.push(`vol ${b.vol_term >= 0 ? "+" : ""}${b.vol_term.toFixed(1)}`);
  }
  if (!parts.length) {
    return it ? "Reazione prezzo e KPI neutri" : "Neutral price reaction and KPIs";
  }
  return parts.join(" · ");
}

export type TickerEisCumulative = {
  total: number | null;
  eventCount: number;
};

/** Sum of EIS scores across all feed events for the ticker (cumulative impact). */
export function cumulativeTickerEisScore(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
): TickerEisCumulative {
  const detail = buildTickerEisDetail(ticker, lang, sheetClinicalKpi);
  if (detail.events.length > 0) {
    const total = detail.events.reduce((sum, ev) => sum + ev.breakdown.score, 0);
    return {
      total: Math.round(total * 10) / 10,
      eventCount: detail.events.length,
    };
  }
  if (detail.score != null && Number.isFinite(detail.score)) {
    return { total: detail.score, eventCount: 0 };
  }
  return { total: null, eventCount: 0 };
}

export function summarizeTickerEisFromRecords(
  ticker: string,
  records: ClinicalPreCdRecord[],
  lang: "it" | "en" = "it",
): TickerEisSummary {
  const tk = ticker.trim().toUpperCase();
  const it = lang === "it";
  let bestScore: number | null = null;
  let bestBreakdown: EisBreakdown | null = null;
  let eventCount = 0;
  const sourceSet = new Set<string>();

  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;
    const events = trustedRecordEvents(rec);
    if (!events.length) continue;

    for (const ev of events) {
      const indicators =
        ev.indicators?.length ? ev.indicators : rec.clinical_indicators;
      const resolved = resolveEventEis(ev, indicators);
      if (!resolved) continue;
      eventCount += 1;
      sourceSet.add(feedLabel(String(ev.source_type ?? "clinical"), it));
      if (
        bestScore == null ||
        Math.abs(resolved.score) > Math.abs(bestScore) ||
        (Math.abs(resolved.score) === Math.abs(bestScore) && resolved.score > bestScore)
      ) {
        bestScore = resolved.score;
        bestBreakdown = resolved;
      }
    }
  }

  return {
    score: bestScore,
    eventCount,
    feedLabels: [...sourceSet].slice(0, 5),
    breakdownHint: bestBreakdown ? breakdownHint(bestBreakdown, it) : "",
  };
}

export function summarizeTickerEis(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
): TickerEisSummary {
  const fromFeed = summarizeTickerEisFromRecords(ticker, hydrateClinicalPreCdRecords(), lang);
  if (fromFeed.score != null) return fromFeed;
  if (sheetClinicalKpi != null && Number.isFinite(sheetClinicalKpi)) {
    return {
      score: sheetClinicalKpi,
      eventCount: 0,
      feedLabels: [],
      breakdownHint: lang === "it" ? "Da colonna foglio Simulation" : "From Simulation sheet column",
    };
  }
  return { score: null, eventCount: 0, feedLabels: [], breakdownHint: "" };
}

function studyTitleFromRecord(rec: ClinicalPreCdRecord, tk: string): string {
  const title = rec.meta?.brief_title?.trim();
  if (title) return title;
  return rec.company?.trim() || tk;
}

function collectTickerEvents(
  ticker: string,
  records: ClinicalPreCdRecord[],
  lang: "it" | "en",
): {
  events: TickerEisEventDetail[];
  company: string | null;
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
} {
  const tk = ticker.trim().toUpperCase();
  const it = lang === "it";
  const out: TickerEisEventDetail[] = [];
  let company: string | null = null;
  let nctId: string | null = null;
  let studyTitle: string | null = null;
  let studyUrl: string | null = null;
  let studyPhase: string | null = null;
  let studyConditions: string | null = null;

  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;
    company = rec.company ?? company;
    nctId = rec.nct_id ?? nctId;
    studyPhase = rec.meta?.phase ?? studyPhase;
    studyConditions = rec.meta?.conditions?.trim() || studyConditions;
    const recStudyTitle = studyTitleFromRecord(rec, tk);
    const recStudyUrl = rec.nct_id ? nctClinicalTrialsUrl(rec.nct_id) : null;
    const events = trustedRecordEvents(rec);

    for (const ev of events) {
      const indicators =
        ev.indicators?.length ? ev.indicators : rec.clinical_indicators ?? [];
      const resolved = resolveEventEis(ev, indicators);
      if (!resolved) continue;
      const evNct = rec.nct_id ?? null;
      out.push({
        eventDate: ev.event_date ?? null,
        title: ev.event_title ?? ev.summary ?? (it ? "Evento clinico" : "Clinical event"),
        sourceLabel: feedLabel(String(ev.source_type ?? "clinical"), it),
        nctId: evNct,
        studyTitle: recStudyTitle,
        studyUrl: recStudyUrl ?? (ev.link?.trim() || null),
        breakdown: resolved,
        indicators: indicators.slice(0, 12),
        impactNote: ev.impact_note ?? null,
        link: ev.link ?? null,
        summary: ev.summary ?? null,
      });
    }
  }

  out.sort((a, b) => {
    const da = a.eventDate ? Date.parse(a.eventDate) : 0;
    const db = b.eventDate ? Date.parse(b.eventDate) : 0;
    if (db !== da) return db - da;
    return Math.abs(b.breakdown.score) - Math.abs(a.breakdown.score);
  });

  const primary = out[0];
  if (primary) {
    nctId = primary.nctId ?? nctId;
    studyTitle = primary.studyTitle || studyTitle;
    studyUrl = primary.studyUrl ?? (nctId ? nctClinicalTrialsUrl(nctId) : null);
  } else if (nctId) {
    studyUrl = nctClinicalTrialsUrl(nctId);
    for (const rec of records) {
      if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
      if (!isClinicalPreCdRecordTrusted(rec)) continue;
      if (rec.nct_id === nctId || !studyTitle) {
        studyTitle = studyTitleFromRecord(rec, tk);
        if (rec.nct_id === nctId) break;
      }
    }
  }

  return { events: out, company, nctId, studyTitle, studyUrl, studyPhase, studyConditions };
}

function mergedClinicalIndicators(
  ticker: string,
  records: ClinicalPreCdRecord[],
): ClinicalStudyIndicator[] {
  const tk = ticker.trim().toUpperCase();
  const all: ClinicalStudyIndicator[] = [];
  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;
    if (rec.clinical_indicators?.length) all.push(...rec.clinical_indicators);
    for (const ev of trustedRecordEvents(rec)) {
      if (ev.indicators?.length) all.push(...ev.indicators);
    }
  }
  return prepareClinicalIndicators(all);
}

export function buildTickerEisDetail(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
): TickerEisDetail {
  const records = hydrateClinicalPreCdRecords();
  const { events, company, nctId, studyTitle, studyUrl, studyPhase, studyConditions } =
    collectTickerEvents(ticker, records, lang);
  const summary = summarizeTickerEisFromRecords(ticker, records, lang);
  const clinicalIndicators = mergedClinicalIndicators(ticker, records);

  if (summary.score != null) {
    return {
      ...summary,
      events,
      sheetFallback: false,
      company,
      nctId,
      studyTitle,
      studyUrl,
      studyPhase,
      studyConditions,
      clinicalIndicators,
    };
  }

  if (sheetClinicalKpi != null && Number.isFinite(sheetClinicalKpi)) {
    return {
      score: sheetClinicalKpi,
      eventCount: 0,
      feedLabels: [],
      breakdownHint: lang === "it" ? "Da colonna foglio Simulation" : "From Simulation sheet column",
      events: [],
      sheetFallback: true,
      company,
      nctId,
      studyTitle,
      studyUrl,
      studyPhase,
      studyConditions,
      clinicalIndicators,
    };
  }

  return {
    score: null,
    eventCount: 0,
    feedLabels: [],
    breakdownHint: "",
    events: [],
    sheetFallback: false,
    company,
    nctId,
    studyTitle,
    studyUrl,
    studyPhase,
    studyConditions,
    clinicalIndicators,
  };
}

/** Clinical KPI column from Simulation sheet row (optional EIS formula term). */
export function clinicalKpiFromSimRow(
  row: Record<string, unknown> | null | undefined,
): number | null {
  if (!row) return null;
  const raw = row["Clinical KPI"];
  if (raw == null || raw === "" || raw === "—") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
