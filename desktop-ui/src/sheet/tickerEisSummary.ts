/**
 * Aggregate EIS per ticker from clinical pre-CD enrichment snapshot.
 */

import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  ClinicalStudyIndicator,
  GuidanceCalendarEvent,
} from "../api/supernova";
import { nctClinicalTrialsUrl } from "./cellLinks";
import { hydrateClinicalPreCdRecords } from "./clinicalPreCdSnapshotCache";
import { trustedRecordEvents } from "./clinicalTimeline";
import { isClinicalPreCdRecordTrusted } from "./referenceVerification";
import {
  clinicalIndicatorDedupeKey,
  indicatorsForFeedEvent,
  indicatorsForStudyDisplay,
  prepareClinicalIndicators,
  stampIndicatorDate,
} from "./clinicalIndicators";
import { resolveMergedFeedEventEis } from "./manualFeedEvents";
import type { EisBreakdown } from "./eventImpactScore";
import { mergeVirtualRegulatoryIndicators } from "./regulatoryVirtualKpi";
import { normalizeCompletionDateForKey } from "./investSimKeys";
import { completionDateToNowOffset } from "./chartNowOffset";
import {
  clinicalDrugFromSimRow,
  clinicalIndicationFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
  clinicalStudyHrefFromSimRow,
  clinicalStudyTitleFromSimRow,
  catalystKindFromSimRow,
  catalystQuoteFromSimRow,
  formatRegulatoryMilestoneLabel,
  isRegulatoryMilestoneLabel,
} from "./simRowClinicalMeta";
import {
  computeClassificationCoverage,
  resolveEventNctId,
  resolveTickerPipeline,
  tagEventsAssetRole,
  type ClassificationCoverage,
  type AssetRole,
} from "./tickerAssetTagging";

export type TickerEisSummary = {
  score: number | null;
  eventCount: number;
  /** Human-readable feed sources (K-8, PubMed, CT.gov, …). */
  feedLabels: string[];
  breakdownHint: string;
};

/** Coerce taxonomy scores (API may send number or numeric string). */
function coerceDimScore(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const COMPANY_AFFILIATION_MULT = 1.5;

/** Clinical score for UI/Σ — ×1.5 when company-affiliated authors (if not already boosted). */
function effectiveClinicalScore(
  raw: unknown,
  opts: {
    companyAffiliated?: boolean;
    taxonomyDimensions?: unknown;
  },
): number | null {
  const base = coerceDimScore(raw);
  if (base == null) return null;
  if (!opts.companyAffiliated) return base;
  const clin =
    opts.taxonomyDimensions &&
    typeof opts.taxonomyDimensions === "object" &&
    opts.taxonomyDimensions !== null &&
    "clinical" in opts.taxonomyDimensions
      ? (opts.taxonomyDimensions as { clinical?: { modifiers_applied?: Array<{ id?: string }> } })
          .clinical
      : null;
  const mods = clin?.modifiers_applied ?? [];
  const already = mods.some((m) => m?.id === "company_affiliation_match");
  if (already) return base;
  return Math.round(base * COMPANY_AFFILIATION_MULT * 10) / 10;
}

export type TickerEisEventDetail = {
  eventDate: string | null;
  title: string;
  /** Raw feed `source_type` for regulatory vs clinical classification. */
  sourceType: string;
  sourceLabel: string;
  /** SEC 8-K item codes string e.g. "2.02, 7.01". */
  itemsRaw?: string | null;
  asset?: string | null;
  nctId: string | null;
  /**
   * Stable program id (NCT lowercased or normalized drug code).
   * Derived at read-time — see tickerAssetTagging.
   */
  assetId?: string | null;
  /** Derived role vs TickerPipeline.cdAssetId / programs. */
  assetRole?: AssetRole;
  studyTitle: string;
  studyUrl: string | null;
  studyPhase?: string | null;
  studyConditions?: string | null;
  breakdown: EisBreakdown;
  indicators: ClinicalStudyIndicator[];
  impactNote: string | null;
  link: string | null;
  summary: string | null;
  /** PubMed / journal: full abstract. */
  abstract?: string | null;
  sectionSummaries?: Array<{ heading?: string; summary?: string }> | null;
  /** Investor lens: Clin / Corp / Fin / Access + stock-price implication. */
  investorInsight?: string | null;
  companyAffiliated?: boolean;
  isPaper?: boolean;
  /** Taxonomy / thermometer legs (summed in headers; never EIS). */
  clinicalScore?: number | null;
  financialScore?: number | null;
  corporateScore?: number | null;
  marketAccessScore?: number | null;
  /** Raw event for 12/24/36h market EIS resolution. */
  rawEvent?: ClinicalPublicationEvent | null;
  /**
   * Dated feed event without a usable EIS (anticipated / gated / no score).
   * Still plotted as a volume-chart pallino; excluded from EIS sums.
   */
  chartOnly?: boolean;
};

/**
 * How well the HIGH-IMPACT study card matches the price/volume move.
 * `unexplained_readthrough` = large move with no matching own-ticker trial news
 * (competitor failure, sector read-through, or earnings riding a crash).
 */
export type CatalystFitKind = "aligned" | "unexplained_readthrough";

/** Study whose completion date is the sheet CD — not the highest-EIS headline. */
export type CdCompletingStudy = {
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
  studyDrug: string | null;
  enrollment: number | null;
  studyStatus: string | null;
  primaryEndpoint: string | null;
  /** Company quote / guidance snippet for the catalyst when CT.gov is thin. */
  timingQuote: string | null;
  /** PDUFA / NDA / BLA when the sheet labels the CD as a regulatory catalyst. */
  catalystKind: string | null;
};

/** |ΔP 1d| at/above this is a move the study card must explain. */
export const LARGE_CATALYST_MOVE_ABS_PCT = 12;

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
  /** First intervention / drug from the registry record (when no scored event). */
  studyDrug: string | null;
  /**
   * Trial that completes this ticker's CD (approaching-CD card).
   * Independent of the HIGH-IMPACT primary event, which may be a PDUFA 8-K.
   */
  cdCompletingStudy: CdCompletingStudy;
  /** Completion Date (YYYY-MM-DD) for the primary NCT / sim row. */
  cdDate: string | null;
  /**
   * Calendar days from today to CD (positive = still ahead; negative = CD passed).
   * Opposite sign of ``completionDateToNowOffset``.
   */
  daysToCd: number | null;
  /** Rollup KPI clinici (feed + eventi) — componente KPI×10 dell'EIS. */
  clinicalIndicators: ClinicalStudyIndicator[];
  /** Highest-impact event driving the HIGH-IMPACT card (not merely the newest). */
  primaryEvent: TickerEisEventDetail | null;
  /**
   * KPIs for the trial tied to the HIGH-IMPACT primary event / filled NCT.
   * Prefer these over the ticker-wide `clinicalIndicators` rollup in the study header.
   */
  primaryStudyIndicators: ClinicalStudyIndicator[];
  /**
   * KPIs for the trial that completes this ticker's CD (approaching-CD card).
   * Bound to that NCT's CT.gov measures — not the highest-EIS headline study.
   */
  cdStudyIndicators: ClinicalStudyIndicator[];
  /** Pipeline CD asset id when known (config map or ephemeral seed). */
  cdAssetId: string | null;
  /**
   * Read-time tagging coverage — Company Memory UI gates on
   * `companyMemoryAllowed` (unclassified share < 20%).
   */
  classificationCoverage: ClassificationCoverage;
  catalystFit: CatalystFitKind;
};

const SOURCE_LABEL: Record<string, { it: string; en: string }> = {
  sec_8k: { it: "SEC 8-K", en: "SEC 8-K" },
  press_release: { it: "Comunicato", en: "Press" },
  ctgov: { it: "CT.gov", en: "CT.gov" },
  cd_milestone: { it: "CD", en: "CD" },
  congress: { it: "Congresso", en: "Congress" },
  publication: { it: "Pubblicazione", en: "Pub" },
  clinical: { it: "Clinico", en: "Clinical" },
  manual: { it: "Manuale", en: "Manual" },
  fda_briefing: { it: "FDA Briefing", en: "FDA Briefing" },
};

/**
 * ClinicalTrials.gov registry / status rows are study updates — not journal papers.
 * Belong under Clinical News (or Ongoing trials), never Scientific Publications.
 */
export function isCtgovRegistryFeedEvent(ev: {
  source_type?: string | null;
  event_type?: string | null;
  sourceType?: string | null;
  link?: string | null;
  event_title?: string | null;
  title?: string | null;
  summary?: string | null;
  impact_note?: string | null;
  impactNote?: string | null;
}): boolean {
  const st = String(ev.source_type ?? ev.sourceType ?? "")
    .trim()
    .toLowerCase();
  if (st === "ctgov" || st.includes("clinicaltrials")) return true;
  const et = String(ev.event_type ?? "").trim().toLowerCase();
  if (et === "ctgov" || et.includes("clinicaltrials")) return true;
  const link = String(ev.link ?? "").trim().toLowerCase();
  if (link.includes("clinicaltrials.gov")) return true;
  const blob = [
    ev.event_title,
    ev.title,
    ev.summary,
    ev.impact_note,
    ev.impactNote,
  ]
    .filter(Boolean)
    .join(" ");
  if (/clinicaltrials\.gov/i.test(blob)) return true;
  if (/\bstatus update for\s+NCT\d{8}\b/i.test(blob)) return true;
  if (
    /\bNCT\d{8}\b/i.test(blob) &&
    /\b(active not recruiting|recruiting|overall status|registry)\b/i.test(blob)
  ) {
    return true;
  }
  return false;
}

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
    parts.push(`vol_term ${b.vol_term >= 0 ? "+" : ""}${b.vol_term.toFixed(1)}`);
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

export type TickerEisGlobalRollup = {
  /** Net sum of all collected event EIS scores (Σ+ − Σ−). */
  total: number | null;
  /** Sum of positive event scores. */
  posSum: number;
  /** Sum of absolute negative event scores. */
  negAbsSum: number;
  eventCount: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const CHART_ONLY_EIS_BREAKDOWN: EisBreakdown = {
  score: 0,
  delta_p_1d: null,
  delta_p_3d: null,
  vol_ratio: 1,
  vol_term: 0,
  sentiment: 0,
  sent_term: 0,
  weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
};

export function isScoredEisChartEvent(ev: TickerEisEventDetail): boolean {
  return !ev.chartOnly;
}

/** Sum of EIS scores across all feed events for the ticker (cumulative impact). */
export function cumulativeTickerEisScore(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
  records?: ClinicalPreCdRecord[],
): TickerEisCumulative {
  const rollup = globalTickerEisRollup(ticker, lang, sheetClinicalKpi, records);
  return { total: rollup.total, eventCount: rollup.eventCount };
}

/**
 * Global EIS for a ticker: net sum plus positive / negative legs of all collected events.
 * Falls back to the sheet score when the feed has no scored events.
 */
export function globalTickerEisRollup(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
  records?: ClinicalPreCdRecord[],
): TickerEisGlobalRollup {
  const detail = buildTickerEisDetail(ticker, lang, sheetClinicalKpi, records);
  const scored = detail.events.filter(isScoredEisChartEvent);
  if (scored.length > 0) {
    let posSum = 0;
    let negAbsSum = 0;
    for (const ev of scored) {
      const s = ev.breakdown.score;
      if (!Number.isFinite(s)) continue;
      if (s >= 0) posSum += s;
      else negAbsSum += Math.abs(s);
    }
    return {
      total: round1(posSum - negAbsSum),
      posSum: round1(posSum),
      negAbsSum: round1(negAbsSum),
      eventCount: scored.length,
    };
  }
  if (detail.score != null && Number.isFinite(detail.score)) {
    const s = detail.score;
    return {
      total: s,
      posSum: s > 0 ? s : 0,
      negAbsSum: s < 0 ? Math.abs(s) : 0,
      eventCount: 0,
    };
  }
  return { total: null, posSum: 0, negAbsSum: 0, eventCount: 0 };
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
    // Manual EIS is trusted even when the parent study fails the sponsor gate.
    // trustedRecordEvents already keeps SEC 8-K / manual / verified pubs —
    // do not re-drop the whole study when sponsor gate fails (common for new names).
    const events = trustedRecordEvents(rec);
    if (!events.length) continue;

    for (const ev of events) {
      const resolved = resolveMergedFeedEventEis(ev, rec.clinical_indicators);
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
  records?: ClinicalPreCdRecord[],
): TickerEisSummary {
  const fromFeed = summarizeTickerEisFromRecords(
    ticker,
    records ?? hydrateClinicalPreCdRecords(),
    lang,
  );
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

function firstDrugToken(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .split(/[|,;/]/)[0]
    ?.trim();
  return s || null;
}

function usableStudyTitle(
  title: string | null | undefined,
  company: string | null | undefined,
  ticker: string,
): string | null {
  const t = String(title ?? "").trim();
  if (!t || isRegulatoryMilestoneLabel(t)) return null;
  const tk = ticker.trim().toUpperCase();
  if (tk && t.toUpperCase() === tk) return null;
  const co = String(company ?? "").trim();
  if (co && t.toLowerCase() === co.toLowerCase()) return null;
  return t;
}

function usableDrug(raw: string | null | undefined): string | null {
  const t = firstDrugToken(raw);
  if (!t || isRegulatoryMilestoneLabel(t)) return null;
  return t;
}

function usablePhase(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").trim();
  if (!t || isRegulatoryMilestoneLabel(t)) return null;
  return t;
}

function primaryEndpointFromRecord(rec: ClinicalPreCdRecord | null): string | null {
  if (!rec) return null;
  const ai = rec.ai?.primary_endpoint?.trim();
  if (ai) return ai;
  const oms = rec.outcome_measures ?? [];
  const primary =
    oms.find((m) => String(m.type ?? "").toLowerCase().includes("primary")) ?? oms[0];
  const fromOm = primary?.title?.trim();
  if (fromOm) return fromOm;
  const eps = rec.structured?.endpoint_summary ?? [];
  const ep =
    eps.find((m) => String(m.type ?? "").toLowerCase().includes("primary")) ?? eps[0];
  return ep?.title?.trim() || null;
}

function recordMentionsDrug(rec: ClinicalPreCdRecord, drug: string): boolean {
  const d = drug.trim().toLowerCase();
  if (d.length < 3) return false;
  const blob = [
    rec.meta?.interventions,
    rec.meta?.brief_title,
    rec.clinical_events?.[0]?.drug,
    rec.clinical_events?.[0]?.asset,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return blob.includes(d);
}

function pickTickerStudyRecord(
  ticker: string,
  records: ClinicalPreCdRecord[],
  simCompletionDate?: unknown,
  drugHint?: string | null,
): ClinicalPreCdRecord | null {
  const tk = ticker.trim().toUpperCase();
  const mine = records.filter((r) => String(r.ticker ?? "").toUpperCase() === tk);
  if (!mine.length) return null;
  const trusted = mine.filter((r) => isClinicalPreCdRecordTrusted(r));
  const pool = trusted.length ? trusted : mine;
  const cd = asIsoCd(simCompletionDate);

  if (cd) {
    const exact =
      pool.find((r) => asIsoCd(r.cd_date) === cd) ??
      mine.find((r) => asIsoCd(r.cd_date) === cd);
    if (exact) return exact;
  }

  const drug = drugHint?.trim() || "";
  if (drug && !isRegulatoryMilestoneLabel(drug)) {
    const byDrug =
      pool.find((r) => recordMentionsDrug(r, drug)) ??
      mine.find((r) => recordMentionsDrug(r, drug));
    if (byDrug) return byDrug;
  }

  if (cd) {
    const cdMs = Date.parse(`${cd}T12:00:00`);
    if (Number.isFinite(cdMs)) {
      let best: ClinicalPreCdRecord | null = null;
      let bestAbs = Number.POSITIVE_INFINITY;
      for (const r of pool) {
        const iso = asIsoCd(r.cd_date);
        if (!iso) continue;
        const ms = Date.parse(`${iso}T12:00:00`);
        if (!Number.isFinite(ms)) continue;
        const abs = Math.abs(ms - cdMs);
        if (abs < bestAbs) {
          bestAbs = abs;
          best = r;
        }
      }
      if (best) return best;
    }
  }

  return pool[0] ?? mine[0] ?? null;
}

function guidanceStudyScore(ev: GuidanceCalendarEvent): number {
  let s = 0;
  if (usableDrug(ev.asset_name)) s += 4;
  if (usablePhase(ev.trial_phase)) s += 3;
  if (String(ev.indication ?? "").trim()) s += 2;
  if (String(ev.timing_quote ?? "").trim()) s += 1;
  return s;
}

function pickGuidanceStudyEvent(
  events: readonly GuidanceCalendarEvent[] | null | undefined,
  simCompletionDate?: unknown,
): GuidanceCalendarEvent | null {
  if (!events?.length) return null;
  const cd = asIsoCd(simCompletionDate);
  const dated = cd
    ? events.find(
        (e) =>
          asIsoCd(e.window_start) === cd ||
          asIsoCd(e.window_end) === cd ||
          asIsoCd(e.sim_cd_date) === cd,
      )
    : null;
  let best: GuidanceCalendarEvent | null = null;
  let bestScore = -1;
  for (const e of events) {
    const sc = guidanceStudyScore(e);
    if (sc > bestScore) {
      bestScore = sc;
      best = e;
    }
  }
  if (best && bestScore > 0) return best;
  return dated ?? events[0] ?? null;
}

function pickGuidanceCatalystKind(
  events: readonly GuidanceCalendarEvent[] | null | undefined,
  simCompletionDate?: unknown,
): string | null {
  if (!events?.length) return null;
  const cd = asIsoCd(simCompletionDate);
  const dated = cd
    ? events.find(
        (e) =>
          asIsoCd(e.window_start) === cd ||
          asIsoCd(e.window_end) === cd ||
          asIsoCd(e.sim_cd_date) === cd,
      )
    : null;
  return (
    formatRegulatoryMilestoneLabel(dated?.event_type) ||
    formatRegulatoryMilestoneLabel(events[0]?.event_type) ||
    null
  );
}

function registryStudyMetaFromRecord(rec: ClinicalPreCdRecord): {
  company: string | null;
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
  studyDrug: string | null;
} {
  const nct = rec.nct_id?.trim() || null;
  return {
    company: rec.company?.trim() || null,
    nctId: nct,
    studyTitle: rec.meta?.brief_title?.trim() || null,
    studyUrl: nct ? nctClinicalTrialsUrl(nct) : null,
    studyPhase: rec.meta?.phase ?? rec.study_phase ?? null,
    studyConditions: rec.meta?.conditions?.trim() || null,
    studyDrug:
      firstDrugToken(rec.meta?.interventions) ??
      firstDrugToken(rec.clinical_events?.[0]?.drug) ??
      firstDrugToken(rec.clinical_events?.[0]?.asset),
  };
}

const CLINICALISH_SOURCE =
  /^(clinical|press_release|congress|publication|ctgov|manual)$/i;

const EARNINGS_TITLE_RE =
  /\b(earnings|results of operations|financial results|quarterly results|q[1-4]\s*20\d{2})\b/i;

const WEAK_OWN_CATALYST_RE =
  /\b(first patient|first subject|patient dosed|enrollment|enrolling|quarterly|financial results|earnings|q[1-4]\s*20\d{2})\b/i;

const CLINICAL_NEWS_RE =
  /\b(trial|readout|topline|endpoint|phase\s*[123]|nct\d{8}|pdufa|fda|clinical benefit|orr|pfs|os\b)\b/i;

function sourceKey(ev: TickerEisEventDetail): string {
  return ev.sourceType.trim().toLowerCase();
}

export function isClinicalishImpactEvent(ev: TickerEisEventDetail): boolean {
  const st = sourceKey(ev);
  if (CLINICALISH_SOURCE.test(st)) return true;
  if (st === "sec_8k" && CLINICAL_NEWS_RE.test(`${ev.title} ${ev.summary ?? ""}`)) return true;
  return false;
}

export function isEarningsOnlyImpactEvent(ev: TickerEisEventDetail): boolean {
  const blob = `${ev.title} ${ev.summary ?? ""}`;
  if (CLINICAL_NEWS_RE.test(blob)) return false;
  const st = sourceKey(ev);
  const items = ev.itemsRaw ?? "";
  if (st === "sec_8k" && /\b2\.02\b/.test(items)) return true;
  return st === "sec_8k" && EARNINGS_TITLE_RE.test(blob);
}

function eventAbsScore(ev: TickerEisEventDetail): number {
  const s = ev.breakdown.score;
  return Number.isFinite(s) ? Math.abs(s) : 0;
}

function eventAbsDeltaP(ev: TickerEisEventDetail): number {
  const d1 = ev.breakdown.delta_p_1d;
  return d1 != null && Number.isFinite(d1) ? Math.abs(d1) : 0;
}

function eventDateMsSafe(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isFinite(ms) ? ms : 0;
}

function datesWithinDays(a: string | null, b: string | null, days: number): boolean {
  const ma = eventDateMsSafe(a);
  const mb = eventDateMsSafe(b);
  if (!ma || !mb) return false;
  return Math.abs(ma - mb) <= days * 86_400_000;
}

function compareImpactThenRecency(a: TickerEisEventDetail, b: TickerEisEventDetail): number {
  const scoreDiff = eventAbsScore(b) - eventAbsScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  const dpDiff = eventAbsDeltaP(b) - eventAbsDeltaP(a);
  if (dpDiff !== 0) return dpDiff;
  return eventDateMsSafe(b.eventDate) - eventDateMsSafe(a.eventDate);
}

/**
 * Study card driver: highest |EIS| (then |ΔP|, then recency).
 * Prefer a clinical/press/manual event when it is competitive with a top 8-K —
 * earnings filings often inherit a crash's ΔP without being the cause.
 */
export function pickPrimaryStudyContextEvent(
  events: TickerEisEventDetail[],
): TickerEisEventDetail | null {
  const scored = events.filter(isScoredEisChartEvent);
  if (!scored.length) return null;
  const ranked = [...scored].sort(compareImpactThenRecency);
  const top = ranked[0]!;
  const clinicalish = ranked.filter(isClinicalishImpactEvent);
  const topClin = clinicalish[0];
  if (!topClin) return top;
  const topAbs = eventAbsScore(top);
  const clinAbs = eventAbsScore(topClin);
  if (isClinicalishImpactEvent(top)) return top;
  if (clinAbs >= 2 && (topAbs <= 0.01 || clinAbs >= topAbs * 0.45)) return topClin;
  if (isEarningsOnlyImpactEvent(top) && clinAbs > 0) return topClin;
  return top;
}

function eventExplainsLargeMove(ev: TickerEisEventDetail, spike: TickerEisEventDetail): boolean {
  if (isEarningsOnlyImpactEvent(ev)) return false;
  if (!datesWithinDays(ev.eventDate, spike.eventDate, 3) && ev !== spike) return false;
  const blob = `${ev.title} ${ev.summary ?? ""}`;
  const spikeDp = spike.breakdown.delta_p_1d;
  const evDp = ev.breakdown.delta_p_1d;
  if (
    spikeDp != null &&
    Number.isFinite(spikeDp) &&
    Math.abs(spikeDp) >= LARGE_CATALYST_MOVE_ABS_PCT &&
    WEAK_OWN_CATALYST_RE.test(blob)
  ) {
    return false;
  }
  const kpi = ev.breakdown.kpi_score;
  if (
    kpi != null &&
    Number.isFinite(kpi) &&
    Math.abs(kpi) >= 0.05 &&
    evDp != null &&
    Number.isFinite(evDp) &&
    Math.abs(evDp) >= LARGE_CATALYST_MOVE_ABS_PCT &&
    Math.sign(kpi) !== Math.sign(evDp)
  ) {
    return false;
  }
  if (
    kpi != null &&
    Number.isFinite(kpi) &&
    Math.abs(kpi) >= 0.05 &&
    spikeDp != null &&
    Number.isFinite(spikeDp) &&
    Math.abs(spikeDp) >= LARGE_CATALYST_MOVE_ABS_PCT &&
    Math.sign(kpi) !== Math.sign(spikeDp)
  ) {
    return false;
  }
  return isClinicalishImpactEvent(ev) || CLINICAL_NEWS_RE.test(blob);
}

/** True when a large price move has no matching own-ticker trial news. */
export function assessCatalystFit(
  events: TickerEisEventDetail[],
  primary: TickerEisEventDetail | null,
): CatalystFitKind {
  if (!events.length) return "aligned";
  let spike = events[0]!;
  let maxDp = eventAbsDeltaP(spike);
  for (const ev of events) {
    const a = eventAbsDeltaP(ev);
    if (a > maxDp) {
      maxDp = a;
      spike = ev;
    }
  }
  if (maxDp < LARGE_CATALYST_MOVE_ABS_PCT) return "aligned";
  if (primary && eventExplainsLargeMove(primary, spike)) return "aligned";
  if (events.some((ev) => eventExplainsLargeMove(ev, spike))) return "aligned";
  return "unexplained_readthrough";
}

function asIsoCd(raw: unknown): string | null {
  const key = normalizeCompletionDateForKey(raw);
  return key && key !== "—" ? key : null;
}

/**
 * Prefer CD of the primary NCT; else nearest future CD among trusted records;
 * else Simulation sheet Completion Date.
 */
export function resolveTickerCdDate(
  ticker: string,
  nctId: string | null | undefined,
  records: ClinicalPreCdRecord[],
  simCompletionDate?: unknown,
): string | null {
  const tk = ticker.trim().toUpperCase();
  const nct = (nctId ?? "").trim().toUpperCase();
  let matched: string | null = null;
  let nearestFuture: { iso: string; days: number } | null = null;
  let any: string | null = null;

  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    // CD is CT.gov registry metadata — keep even when sponsor gate fails.
    if (String(rec.sponsor_match ?? "").trim().toLowerCase() === "no match") continue;
    const iso = asIsoCd(rec.cd_date);
    if (!iso) continue;
    any = any ?? iso;
    if (nct && (rec.nct_id ?? "").trim().toUpperCase() === nct) {
      matched = iso;
      break;
    }
    const off = completionDateToNowOffset(iso);
    if (off == null) continue;
    const daysAhead = -off;
    if (daysAhead >= 0 && (!nearestFuture || daysAhead < nearestFuture.days)) {
      nearestFuture = { iso, days: daysAhead };
    }
  }

  return matched ?? nearestFuture?.iso ?? any ?? asIsoCd(simCompletionDate);
}

export function daysToCdFromIso(cdIso: string | null | undefined): number | null {
  if (!cdIso) return null;
  const off = completionDateToNowOffset(cdIso);
  return off == null ? null : -off;
}

/**
 * Study-card NCT only: when the primary event itself has no event-level NCT,
 * use the parent record that owned that event (not every sibling study).
 */
function ownerRecordNctForEvent(
  primary: TickerEisEventDetail,
  records: ClinicalPreCdRecord[],
  ticker: string,
): string | null {
  const tk = ticker.trim().toUpperCase();
  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    for (const ev of trustedRecordEvents(rec)) {
      const title = ev.event_title ?? ev.summary ?? "";
      if (title === primary.title && (ev.event_date ?? null) === primary.eventDate) {
        return rec.nct_id?.trim() || null;
      }
    }
  }
  return null;
}

function collectTickerEvents(
  ticker: string,
  records: ClinicalPreCdRecord[],
  lang: "it" | "en",
  simCompletionDate?: unknown,
): {
  events: TickerEisEventDetail[];
  company: string | null;
  nctId: string | null;
  studyTitle: string | null;
  studyUrl: string | null;
  studyPhase: string | null;
  studyConditions: string | null;
  studyDrug: string | null;
  primaryEvent: TickerEisEventDetail | null;
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
  let studyDrug: string | null = null;

  for (const rec of records) {
    if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
    // Per-event trust only (SEC 8-K / manual survive sponsor mismatch).
    // Note: Clinical feed UI hides sec_8k; Financial dossier is the display home.
    const events = trustedRecordEvents(rec);
    if (!events.length) continue;
    company = rec.company ?? company;
    const recStudyTitle = studyTitleFromRecord(rec, tk);
    const recPhase = rec.meta?.phase ?? rec.study_phase ?? null;
    const recConditions = rec.meta?.conditions?.trim() || null;
    studyDrug = studyDrug || firstDrugToken(rec.meta?.interventions);

    for (const ev of events) {
      const evNct = resolveEventNctId(ev, rec.nct_id);
      const sourceType = String(ev.source_type ?? "clinical");
      // Event-local KPIs only — never stamp the study rollup onto every press/news row.
      const localRaw =
        sourceType.toLowerCase() === "manual"
          ? (ev.indicators?.length ? ev.indicators : [])
          : (ev.indicators ?? []);
      const eventDate = ev.event_date ?? null;
      const eventLink = String(ev.link ?? "").trim() || null;
      const localStamped = localRaw
        .slice(0, 12)
        .map((ind) => {
          const stamped = stampIndicatorDate(ind, eventDate);
          return stamped.link?.trim() || !eventLink
            ? stamped
            : { ...stamped, link: eventLink };
        });
      const scoped = indicatorsForFeedEvent(
        { event_date: eventDate, indicators: localStamped },
        rec.clinical_indicators,
      );
      const indicators = mergeVirtualRegulatoryIndicators(ev, scoped);
      const resolved = resolveMergedFeedEventEis({ ...ev, indicators }, indicators);
      const chartOnly = resolved == null;
      if (chartOnly && !eventDate) continue;
      const isCtgov = isCtgovRegistryFeedEvent(ev);
      const isPaper =
        !isCtgov &&
        (Boolean(ev.is_paper) ||
          /publication|pubmed|journal/i.test(sourceType) ||
          /publication/i.test(String(ev.event_type || "")) ||
          /pubmed\.ncbi|doi\.org|pmc\.ncbi/i.test(String(ev.link || "")));
      const labelType = isPaper ? "publication" : isCtgov ? "ctgov" : sourceType;
      out.push({
        eventDate,
        title: ev.event_title ?? ev.summary ?? (it ? "Evento clinico" : "Clinical event"),
        sourceType: isPaper ? "publication" : isCtgov ? "ctgov" : sourceType,
        sourceLabel: feedLabel(labelType, it),
        itemsRaw: ev.items_raw ?? null,
        asset: ev.asset ?? ev.drug ?? null,
        nctId: evNct,
        studyTitle: recStudyTitle,
        studyUrl: evNct
          ? nctClinicalTrialsUrl(evNct)
          : (eventLink ?? null),
        studyPhase: recPhase,
        studyConditions: recConditions,
        breakdown: resolved ?? CHART_ONLY_EIS_BREAKDOWN,
        indicators,
        impactNote: ev.impact_note ?? null,
        link: ev.link ?? null,
        summary: ev.summary ?? null,
        abstract: ev.abstract ?? null,
        sectionSummaries: Array.isArray(ev.section_summaries)
          ? ev.section_summaries
          : null,
        investorInsight:
          typeof ev.investor_insight === "string" && ev.investor_insight.trim()
            ? ev.investor_insight.trim()
            : null,
        companyAffiliated: Boolean(ev.company_affiliated),
        isPaper,
        clinicalScore: effectiveClinicalScore(ev.clinical_score, {
          companyAffiliated: Boolean(ev.company_affiliated),
          taxonomyDimensions: ev.taxonomy_dimensions,
        }),
        financialScore: coerceDimScore(ev.financial_score),
        corporateScore: coerceDimScore(ev.corporate_score),
        marketAccessScore: coerceDimScore(ev.market_access_score),
        rawEvent: ev,
        chartOnly: chartOnly || undefined,
      });
    }
  }

  out.sort((a, b) => {
    const da = a.eventDate ? Date.parse(a.eventDate) : 0;
    const db = b.eventDate ? Date.parse(b.eventDate) : 0;
    if (db !== da) return db - da;
    return Math.abs(b.breakdown.score) - Math.abs(a.breakdown.score);
  });

  const primary = pickPrimaryStudyContextEvent(out);
  if (primary) {
    nctId =
      primary.nctId ??
      ownerRecordNctForEvent(primary, records, tk) ??
      nctId;
    studyTitle = usableStudyTitle(primary.studyTitle, company, tk) || studyTitle;
    studyUrl = primary.studyUrl ?? (nctId ? nctClinicalTrialsUrl(nctId) : null);
    studyPhase = usablePhase(primary.studyPhase) || studyPhase;
    studyConditions = primary.studyConditions ?? studyConditions;
    studyDrug = usableDrug(primary.asset) || studyDrug;
  } else if (nctId) {
    studyUrl = nctClinicalTrialsUrl(nctId);
    for (const rec of records) {
      if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
      if (!isClinicalPreCdRecordTrusted(rec)) continue;
      if (rec.nct_id === nctId || !studyTitle) {
        studyTitle = studyTitleFromRecord(rec, tk);
        studyPhase = rec.meta?.phase ?? rec.study_phase ?? studyPhase;
        studyConditions = rec.meta?.conditions?.trim() || studyConditions;
        if (rec.nct_id === nctId) break;
      }
    }
  }

  const registry = pickTickerStudyRecord(tk, records, simCompletionDate);
  if (registry) {
    const fromRec = registryStudyMetaFromRecord(registry);
    company = company || fromRec.company;
    nctId = nctId || fromRec.nctId;
    studyTitle = studyTitle || usableStudyTitle(fromRec.studyTitle, fromRec.company || company, tk);
    studyUrl = studyUrl || fromRec.studyUrl;
    studyPhase = studyPhase || usablePhase(fromRec.studyPhase);
    studyConditions = studyConditions || fromRec.studyConditions;
    studyDrug = studyDrug || usableDrug(fromRec.studyDrug);
  }

  return {
    events: out,
    company,
    nctId,
    studyTitle,
    studyUrl,
    studyPhase,
    studyConditions,
    studyDrug,
    primaryEvent: primary,
  };
}

function collectRecordStudyIndicators(rec: ClinicalPreCdRecord): ClinicalStudyIndicator[] {
  const all: ClinicalStudyIndicator[] = [];
  const seen = new Set<string>();
  const pushUnique = (ind: ClinicalStudyIndicator) => {
    const key = clinicalIndicatorDedupeKey(ind);
    if (!key || key === "|") return;
    if (seen.has(key)) return;
    seen.add(key);
    all.push(ind);
  };
  if (rec.clinical_indicators?.length) {
    for (const ind of rec.clinical_indicators) pushUnique(stampIndicatorDate(ind));
  }
  // Event KPIs only if novel vs study rollup (avoids press-stamped duplicates in deep dive).
  for (const ev of trustedRecordEvents(rec)) {
    if (!ev.indicators?.length) continue;
    const eventLink = String(ev.link ?? "").trim() || null;
    for (const ind of indicatorsForFeedEvent(
      { event_date: ev.event_date, indicators: ev.indicators },
      rec.clinical_indicators,
    )) {
      const stamped = stampIndicatorDate(ind, ev.event_date ?? null);
      pushUnique(
        stamped.link?.trim() || !eventLink
          ? stamped
          : { ...stamped, link: eventLink },
      );
    }
  }
  return indicatorsForStudyDisplay(all, rec.outcome_measures, { nctId: rec.nct_id });
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
    all.push(...collectRecordStudyIndicators(rec));
  }
  return prepareClinicalIndicators(all);
}

/** KPIs for one NCT (HIGH-IMPACT header). Falls back to the primary event's own chips. */
function indicatorsForPrimaryStudy(
  ticker: string,
  nctId: string | null,
  records: ClinicalPreCdRecord[],
  primary: TickerEisEventDetail | null,
): ClinicalStudyIndicator[] {
  const tk = ticker.trim().toUpperCase();
  const nct = (nctId ?? "").trim().toUpperCase();
  const all: ClinicalStudyIndicator[] = [];
  if (nct) {
    for (const rec of records) {
      if ((rec.ticker ?? "").toUpperCase() !== tk) continue;
      if ((rec.nct_id ?? "").trim().toUpperCase() !== nct) continue;
      all.push(...collectRecordStudyIndicators(rec));
    }
  }
  const prepared = prepareClinicalIndicators(all);
  if (prepared.length) return prepared;
  return prepareClinicalIndicators(
    indicatorsForStudyDisplay(primary?.indicators ?? [], null, { nctId }),
  );
}

function indicatorsForCdCompletingStudy(
  ticker: string,
  records: ClinicalPreCdRecord[],
  simCompletionDate: unknown,
  simRow: Record<string, unknown> | null | undefined,
  catalystHint: string | null,
  guidanceEvents?: readonly GuidanceCalendarEvent[] | null,
): ClinicalStudyIndicator[] {
  const tk = ticker.trim().toUpperCase();
  const gStudy = pickGuidanceStudyEvent(guidanceEvents, simCompletionDate);
  const drugHint =
    usableDrug(clinicalDrugFromSimRow(simRow ?? undefined)) ||
    usableDrug(gStudy?.asset_name) ||
    usableDrug(catalystHint);
  const registry = pickTickerStudyRecord(tk, records, simCompletionDate, drugHint);
  if (!registry) return [];
  return prepareClinicalIndicators(collectRecordStudyIndicators(registry));
}

function buildCdCompletingStudy(
  ticker: string,
  records: ClinicalPreCdRecord[],
  simCompletionDate: unknown,
  simRow: Record<string, unknown> | null | undefined,
  company: string | null,
  catalystHint: string | null,
  guidanceEvents?: readonly GuidanceCalendarEvent[] | null,
): CdCompletingStudy {
  const tk = ticker.trim().toUpperCase();
  const gStudy = pickGuidanceStudyEvent(guidanceEvents, simCompletionDate);
  const simTitle = clinicalStudyTitleFromSimRow(simRow ?? undefined);
  const simPhase = clinicalPhaseFromSimRow(simRow ?? undefined);
  const simDrug = clinicalDrugFromSimRow(simRow ?? undefined);
  const simNct = clinicalNctFromSimRow(simRow ?? undefined);
  const simInd = clinicalIndicationFromSimRow(simRow ?? undefined);
  const drugHint =
    usableDrug(simDrug) || usableDrug(gStudy?.asset_name) || usableDrug(catalystHint);
  const registry = pickTickerStudyRecord(tk, records, simCompletionDate, drugHint);
  const fromRec = registry ? registryStudyMetaFromRecord(registry) : null;
  const nctId = fromRec?.nctId || simNct;
  const studyTitle =
    usableStudyTitle(fromRec?.studyTitle, fromRec?.company || company, tk) ||
    usableStudyTitle(simTitle, company, tk);
  const gPhase = gStudy?.trial_phase
    ? /^phase\b/i.test(String(gStudy.trial_phase).trim())
      ? String(gStudy.trial_phase).trim()
      : `Phase ${String(gStudy.trial_phase).trim()}`
    : null;
  const studyPhase =
    usablePhase(fromRec?.studyPhase) || usablePhase(simPhase) || usablePhase(gPhase);
  const studyConditions =
    fromRec?.studyConditions ||
    simInd ||
    String(gStudy?.indication ?? "").trim() ||
    null;
  const studyDrug =
    usableDrug(fromRec?.studyDrug) || usableDrug(simDrug) || usableDrug(gStudy?.asset_name);
  const studyUrl =
    fromRec?.studyUrl ||
    (nctId ? nctClinicalTrialsUrl(nctId) : null) ||
    clinicalStudyHrefFromSimRow(simRow ?? undefined);
  const timingQuote =
    catalystQuoteFromSimRow(simRow ?? undefined) ||
    String(gStudy?.timing_quote ?? "").trim() ||
    null;
  const catalystKind =
    catalystKindFromSimRow(simRow ?? undefined) ||
    pickGuidanceCatalystKind(guidanceEvents, simCompletionDate) ||
    formatRegulatoryMilestoneLabel(simPhase) ||
    formatRegulatoryMilestoneLabel(simTitle) ||
    formatRegulatoryMilestoneLabel(catalystHint);
  return {
    nctId,
    studyTitle,
    studyUrl,
    studyPhase,
    studyConditions,
    studyDrug,
    enrollment: registry?.meta?.enrollment ?? null,
    studyStatus: registry?.meta?.overall_status?.trim() || null,
    primaryEndpoint: primaryEndpointFromRecord(registry),
    timingQuote,
    catalystKind,
  };
}

/**
 * Desk Catalyst Event modal — study / phase / NCT from clinical pre-CD
 * when Simulation columns are empty.
 */
export function clinicalStudyMetaForDesk(
  ticker: string,
  records: ClinicalPreCdRecord[] | null | undefined,
  opts?: { cd?: unknown; drugHint?: string | null },
): {
  studyTitle: string;
  studyPhase: string;
  nctId: string | null;
  studyHref: string | null;
} | null {
  if (!records?.length) return null;
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  const targetCd = String(opts?.cd ?? "")
    .trim()
    .slice(0, 10);
  const rec = pickTickerStudyRecord(tk, records, opts?.cd, opts?.drugHint);
  if (!rec) return null;
  // Don't attach a stale past trial to a near-term future CD (e.g. KYNB 2026 vs 2017–23).
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetCd)) {
    const recCd = String(rec.cd_date ?? "")
      .trim()
      .slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(recCd)) {
      const targetMs = Date.parse(`${targetCd}T12:00:00`);
      const recMs = Date.parse(`${recCd}T12:00:00`);
      if (Number.isFinite(targetMs) && Number.isFinite(recMs)) {
        const skewDays = Math.abs(targetMs - recMs) / 86_400_000;
        if (skewDays > 120) return null;
      }
    }
  }
  const meta = registryStudyMetaFromRecord(rec);
  const studyTitle =
    usableStudyTitle(meta.studyTitle, meta.company, tk) || "";
  const studyPhase = usablePhase(meta.studyPhase) || "";
  if (!studyTitle && !studyPhase && !meta.nctId) return null;
  return {
    studyTitle,
    studyPhase,
    nctId: meta.nctId,
    studyHref: meta.studyUrl,
  };
}

export function buildTickerEisDetail(
  ticker: string,
  lang: "it" | "en" = "it",
  sheetClinicalKpi?: number | null,
  records?: ClinicalPreCdRecord[],
  simCompletionDate?: unknown,
  simRow?: Record<string, unknown> | null,
  guidanceEvents?: readonly GuidanceCalendarEvent[] | null,
): TickerEisDetail {
  const resolvedRecords = records ?? hydrateClinicalPreCdRecords();
  const completionDate = simCompletionDate ?? simRow?.["Completion Date"];
  const {
    events: rawEvents,
    company,
    nctId,
    studyTitle,
    studyUrl,
    studyPhase,
    studyConditions,
    studyDrug,
    primaryEvent: rawPrimary,
  } = collectTickerEvents(ticker, resolvedRecords, lang, completionDate);

  const cdDrugHint =
    usableDrug(clinicalDrugFromSimRow(simRow ?? undefined)) ||
    usableDrug(rawPrimary?.asset) ||
    null;
  const pipeline = resolveTickerPipeline(ticker, {
    records: resolvedRecords,
    cdAssetIdHint: cdDrugHint,
  });
  const events = tagEventsAssetRole(rawEvents, pipeline);
  const primaryEvent =
    rawPrimary == null
      ? null
      : (events.find(
          (e) => e.title === rawPrimary.title && e.eventDate === rawPrimary.eventDate,
        ) ?? events[0] ?? null);

  const summary = summarizeTickerEisFromRecords(ticker, resolvedRecords, lang);
  const clinicalIndicators = mergedClinicalIndicators(ticker, resolvedRecords);
  const simPhase = clinicalPhaseFromSimRow(simRow ?? undefined);
  const filledNct = nctId || clinicalNctFromSimRow(simRow ?? undefined);
  const filledPhase = usablePhase(studyPhase) || usablePhase(simPhase);
  const filledConditions =
    studyConditions || clinicalIndicationFromSimRow(simRow ?? undefined) || null;
  const filledDrug =
    usableDrug(studyDrug) || usableDrug(clinicalDrugFromSimRow(simRow ?? undefined));
  const filledTitle =
    usableStudyTitle(studyTitle, company, ticker) ||
    usableStudyTitle(clinicalStudyTitleFromSimRow(simRow ?? undefined), company, ticker);
  const filledUrl =
    studyUrl ||
    (filledNct ? nctClinicalTrialsUrl(filledNct) : null) ||
    clinicalStudyHrefFromSimRow(simRow ?? undefined);
  const primaryStudyIndicators = indicatorsForPrimaryStudy(
    ticker,
    filledNct,
    resolvedRecords,
    primaryEvent,
  );
  const catalystFit = assessCatalystFit(events, primaryEvent);
  const cdDate = resolveTickerCdDate(ticker, filledNct, resolvedRecords, completionDate);
  const daysToCd = daysToCdFromIso(cdDate);
  const cdCompletingStudy = buildCdCompletingStudy(
    ticker,
    resolvedRecords,
    completionDate,
    simRow,
    company,
    primaryEvent?.asset ?? null,
    guidanceEvents,
  );
  const cdStudyIndicators = indicatorsForCdCompletingStudy(
    ticker,
    resolvedRecords,
    completionDate,
    simRow,
    primaryEvent?.asset ?? null,
    guidanceEvents,
  );
  const classificationCoverage = computeClassificationCoverage(events);
  const studyFields = {
    company,
    nctId: filledNct,
    studyTitle: filledTitle,
    studyUrl: filledUrl,
    studyPhase: filledPhase,
    studyConditions: filledConditions,
    studyDrug: filledDrug,
    cdCompletingStudy,
    cdDate,
    daysToCd,
    clinicalIndicators,
    primaryEvent,
    primaryStudyIndicators,
    cdStudyIndicators,
    cdAssetId: pipeline.cdAssetId,
    classificationCoverage,
    catalystFit,
  };

  if (summary.score != null) {
    return {
      ...summary,
      events,
      sheetFallback: false,
      ...studyFields,
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
      ...studyFields,
    };
  }

  return {
    score: null,
    eventCount: 0,
    feedLabels: [],
    breakdownHint: "",
    events: [],
    sheetFallback: false,
    ...studyFields,
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

/** One CT.gov row for desk study-phase modals. */
export type DeskClinicalStudyListItem = {
  nctId: string;
  title: string;
  phaseRaw: string | null;
  href: string | null;
  cdDate: string | null;
};

export function listClinicalStudyRecordsForTicker(
  ticker: string,
  records: ClinicalPreCdRecord[] | null | undefined,
): ClinicalPreCdRecord[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk || !records?.length) return [];
  return records.filter((r) => String(r.ticker ?? "").trim().toUpperCase() === tk);
}

export function pickPrimaryClinicalPreCdRecord(
  ticker: string,
  records: ClinicalPreCdRecord[],
  simCompletionDate?: unknown,
  drugHint?: string | null,
): ClinicalPreCdRecord | null {
  return pickTickerStudyRecord(ticker, records, simCompletionDate, drugHint);
}

export function deskClinicalStudyFromRecord(
  rec: ClinicalPreCdRecord,
): DeskClinicalStudyListItem {
  const meta = registryStudyMetaFromRecord(rec);
  const nctId = meta.nctId?.trim().toUpperCase() || "";
  return {
    nctId,
    title:
      meta.studyTitle?.trim() ||
      meta.studyDrug?.trim() ||
      nctId ||
      "—",
    phaseRaw: meta.studyPhase?.trim() || null,
    href: meta.studyUrl,
    cdDate: asIsoCd(rec.cd_date),
  };
}
