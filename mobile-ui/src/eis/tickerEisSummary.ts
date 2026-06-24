import type { ClinicalPreCdRecord, ClinicalStudyIndicator } from "../api";
import { nctClinicalTrialsUrl } from "./cellLinks";
import { prepareClinicalIndicators } from "./clinicalIndicators";
import { resolveEventEis, type EisBreakdown } from "./eventImpactScore";
import { isClinicalPreCdRecordTrusted, trustedRecordEvents } from "./referenceVerification";

export type TickerEisSummary = {
  score: number | null;
  eventCount: number;
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
  sheetFallback: boolean;
  company: string | null;
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
  clinicalIndicators: ClinicalStudyIndicator[];
  /** Best event breakdown for hero grid when score exists */
  heroBreakdown: EisBreakdown | null;
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

function studyTitleFromRecord(rec: ClinicalPreCdRecord, tk: string): string {
  const title = rec.meta?.brief_title?.trim();
  if (title) return title;
  return rec.company?.trim() || tk;
}

function summarizeTickerEisCore(
  ticker: string,
  records: ClinicalPreCdRecord[],
  lang: "it" | "en",
): TickerEisSummary & { heroBreakdown: EisBreakdown | null } {
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
      const indicators = ev.indicators?.length ? ev.indicators : rec.clinical_indicators;
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
    heroBreakdown: bestBreakdown,
  };
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
      const indicators = ev.indicators?.length ? ev.indicators : rec.clinical_indicators ?? [];
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
  records: ClinicalPreCdRecord[],
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
): TickerEisDetail {
  const { events, company, nctId, studyTitle, studyUrl, studyPhase, studyConditions } =
    collectTickerEvents(ticker, records, lang);
  const summary = summarizeTickerEisCore(ticker, records, lang);
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
      heroBreakdown: null,
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
    heroBreakdown: null,
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

export function summarizeTickerEisFromRecords(
  ticker: string,
  records: ClinicalPreCdRecord[],
  lang: "it" | "en" = "it",
): TickerEisSummary {
  const { heroBreakdown: _, ...rest } = summarizeTickerEisCore(ticker, records, lang);
  return rest;
}
