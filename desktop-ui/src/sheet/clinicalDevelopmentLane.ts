/**
 * Dual-lane clinical development timeline for Evaluation Lab deep-dive.
 * Clinical milestones sit above the axis; EIS market reactions sit below.
 */

import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  GuidanceCalendarEvent,
  SdsRow,
} from "../api/supernova";
import { localizeStudyPhase, localizeStudyStatus } from "./clinicalIndicators";
import {
  chartFuturePadDays,
  rangeToCalendarCutoff,
  type PriceVarChartRange,
} from "./priceVariationSeries";
import { buildSyntheticTimelineEvents, recordEvents } from "./clinicalTimeline";
import { findClinicalPreCdRecord } from "./eisPolyAdjust";
import { normalizeCompletionDateForKey } from "./investSimKeys";
import { isClinicalPreCdRecordTrusted } from "./referenceVerification";
import {
  clinicalDrugFromSimRow,
  clinicalIndicationFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
  clinicalStudyTitleFromSimRow,
  isRegulatoryMilestoneLabel,
  usableProductName,
} from "./simRowClinicalMeta";
import { nctFromGuidanceEvent } from "./studyProductLink";
import { buildTickerEisDetail, type TickerEisEventDetail } from "./tickerEisSummary";

export type LaneCertainty = "occurred" | "expected" | "inferred";
export type LaneKind = "clinical" | "market";

export type ClinicalLaneMarker = {
  id: string;
  kind: LaneKind;
  certainty: LaneCertainty;
  plotMs: number;
  windowStartMs: number | null;
  windowEndMs: number | null;
  title: string;
  subtitle: string;
  detail: string;
  stageId?: DevPathStageId | null;
  /** How this date should drive the path strip (study CD vs congress vs designation). */
  dateClass?: "study_cd" | "study_end" | "congress" | "designation" | "path";
  /** True when the calendar day was imputed (typically the 1st of a month). */
  monthImputed?: boolean;
};

export type ClinicalLaneHeader = {
  ticker: string;
  company: string | null;
  drug: string | null;
  nctId: string | null;
  phase: string | null;
  studyShort: string | null;
  condition: string | null;
  enrollment: number | null;
  status: string | null;
  studyDesign: string | null;
  startDate: string | null;
  primaryCompletion: string | null;
  studyCompletion: string | null;
};

/** Drug-development template stages (not news / 8-K). */
export type DevPathStageId =
  | "ind"
  | "phase1"
  | "phase2"
  | "phase3"
  | "pre_nda"
  | "readout"
  | "congress"
  | "designation"
  | "submission"
  | "filing"
  | "adcom"
  | "pdufa"
  | "approval"
  | "crl";

export type DevPathStageStatus = "done" | "current" | "next" | "empty";

export type DevPathStage = {
  id: DevPathStageId;
  label: string;
  status: DevPathStageStatus;
  dateMs: number | null;
  dateImprecise?: boolean;
};

export type DevPathTopology = "serial" | "accelerated";

/** Standard serial chain (Ph3 is a gate before submission). */
export const DEV_PATH_ORDER_SERIAL: DevPathStageId[] = [
  "ind",
  "phase1",
  "phase2",
  "phase3",
  "pre_nda",
  "readout",
  "submission",
  "filing",
  "adcom",
  "pdufa",
  "approval",
];

/** Accelerated approval: Ph2 readout can support submission; Ph3 is confirmatory in parallel. */
export const DEV_PATH_ORDER_ACCELERATED: DevPathStageId[] = [
  "ind",
  "phase1",
  "phase2",
  "readout",
  "submission",
  "filing",
  "adcom",
  "pdufa",
  "approval",
];

export const DEV_PATH_ORDER = DEV_PATH_ORDER_SERIAL;

export type ClinicalLaneModel = {
  header: ClinicalLaneHeader;
  markers: ClinicalLaneMarker[];
  todayMs: number;
  axisStartMs: number;
  axisEndMs: number;
  firstUpcomingMs: number | null;
  timingProximityDays: number | null;
  timingProximityUncertain: boolean;
  pathTopology: DevPathTopology;
  pathStages: DevPathStage[];
  confirmatoryPhase3: DevPathStage | null;
  pathNote: string | null;
  /** Caption for the Gantt: this NCT from start through study completion. */
  studyFrameNote: string | null;
};

/** One pipeline asset for the development-path product picker (top N by phase). */
export type ClinicalDevProgram = {
  id: string;
  drug: string;
  phase: string | null;
  phaseRank: number;
  nctId: string | null;
  cdDate: string | null;
  indication: string | null;
  enrollment: number | null;
  status: string | null;
};

export const TOP_CLINICAL_PROGRAM_COUNT = 3;
/** Company summary Gantt — prefer next calendar days across all products. */
export const COMPANY_CATALYST_HORIZON_DAYS = 30;
/** When 30d is empty (e.g. watchlist / monitor CD), expand to one year. */
export const COMPANY_CATALYST_FALLBACK_DAYS = 365;
/** Single-product Gantt — forward window for expected catalysts. */
export const PRODUCT_CATALYST_HORIZON_MONTHS = 12;

const MARKET_MOVE_1D = 8;
const MARKET_MOVE_3D = 10;
const MAX_CLINICAL = 24;
const MAX_MARKET = 4;
const MS_DAY = 86_400_000;

/** Color by development stage (phase rank) — used on company 30d summary. */
export function programStageColor(phaseRank: number): string {
  if (phaseRank >= 8) return "#34D399"; // Ph4 / approved
  if (phaseRank >= 3) return "#7C6CF3"; // Ph3
  if (phaseRank >= 2) return "#38BDF8"; // Ph2
  if (phaseRank >= 1) return "#A79AFF"; // Ph1
  return "#5B6580"; // IND / early
}

/** SuperNova product swatches — stable per program id, not per phase. */
const PRODUCT_IDENTITY_PALETTE = [
  "#7C6CF3",
  "#34D399",
  "#FBBF24",
  "#F87185",
  "#A79AFF",
  "#38BDF8",
  "#F3C451",
  "#FB923C",
  "#2DD4BF",
  "#E879F9",
] as const;

/** Distinct color for a product chip / Gantt series (same id → same color). */
export function programIdentityColor(id: string): string {
  const s = id.trim();
  if (!s) return PRODUCT_IDENTITY_PALETTE[0];
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PRODUCT_IDENTITY_PALETTE[(h >>> 0) % PRODUCT_IDENTITY_PALETTE.length];
}

/**
 * Product Gantt X-axis: slight lookback so «today» is not glued to the left edge,
 * then {@link PRODUCT_CATALYST_HORIZON_MONTHS} of forward catalysts.
 */
export function forwardHorizonAxis(
  todayMs: number,
  forwardMonths = PRODUCT_CATALYST_HORIZON_MONTHS,
  lookbackDays = 14,
): { startMs: number; endMs: number } {
  const lo = new Date(todayMs - Math.max(0, lookbackDays) * MS_DAY);
  const startMs = new Date(
    lo.getFullYear(),
    lo.getMonth(),
    lo.getDate(),
    12,
    0,
    0,
  ).getTime();
  const hi = new Date(todayMs);
  hi.setMonth(hi.getMonth() + Math.max(1, forwardMonths));
  const endMs = hi.getTime();
  return {
    startMs,
    endMs: Math.max(endMs, startMs + MS_DAY),
  };
}

/**
 * Pull the Gantt window left/right so dates shown on the path strip
 * (current / next / upcoming gates) are not clipped off-axis.
 */
export function expandAxisForPathDates(
  axis: { startMs: number; endMs: number },
  pathStages: Array<{
    id?: string;
    status: DevPathStageStatus;
    dateMs: number | null;
  }>,
  todayMs: number,
): { startMs: number; endMs: number } {
  let startMs = axis.startMs;
  let endMs = axis.endMs;
  // Keep tight price-synced windows (e.g. 1M) intact — only expand multi-month Gantt.
  if (endMs - startMs < 90 * MS_DAY) {
    return { startMs, endMs: Math.max(endMs, startMs + MS_DAY) };
  }
  const pastLimit = todayMs - 400 * MS_DAY;
  const futureLimit = todayMs + 400 * MS_DAY;
  const nearPastLimit = todayMs - 120 * MS_DAY;
  const lateGate = new Set([
    "readout",
    "submission",
    "filing",
    "adcom",
    "pdufa",
    "approval",
    "crl",
    "pre_nda",
  ]);
  for (const s of pathStages) {
    const ms = s.dateMs;
    if (ms == null || !Number.isFinite(ms)) continue;
    const isLate = s.id != null && lateGate.has(s.id);
    // Dated readout / regulatory chips must stay on-axis even when status is
    // still "empty" (e.g. Ph3 current → Readout is two steps ahead of "next").
    const pullIn =
      (s.status === "empty" && isLate) ||
      (s.status === "done" && isLate) ||
      ((s.status === "current" || s.status === "next") &&
        (isLate || (ms >= nearPastLimit && ms <= futureLimit)));
    if (!pullIn) continue;
    if (ms < startMs && ms >= pastLimit) {
      const d = new Date(ms - 7 * MS_DAY);
      startMs = new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0).getTime();
    }
    if (ms > endMs && ms <= futureLimit) {
      endMs = ms + 14 * MS_DAY;
    }
  }
  return { startMs, endMs: Math.max(endMs, startMs + MS_DAY) };
}

/**
 * Company summary X-axis: today → +N days (default 30).
 */
export function companyHorizonAxis(
  todayMs: number,
  forwardDays = COMPANY_CATALYST_HORIZON_DAYS,
  lookbackDays = 1,
): { startMs: number; endMs: number } {
  const lo = new Date(todayMs - Math.max(0, lookbackDays) * MS_DAY);
  const startMs = new Date(
    lo.getFullYear(),
    lo.getMonth(),
    lo.getDate(),
    12,
    0,
    0,
  ).getTime();
  const hi = new Date(todayMs + Math.max(1, forwardDays) * MS_DAY);
  const endMs = new Date(
    hi.getFullYear(),
    hi.getMonth(),
    hi.getDate(),
    12,
    0,
    0,
  ).getTime();
  return { startMs, endMs: Math.max(endMs, startMs + MS_DAY) };
}

export type CompanyHorizonCatalyst = {
  id: string;
  programId: string;
  drug: string;
  phase: string | null;
  phaseRank: number;
  color: string;
  stageId: DevPathStageId | null;
  catalystType: string;
  plotMs: number;
  title: string;
  certainty: LaneCertainty;
  nctId: string | null;
};

export type CompanyCatalystHorizonModel = {
  ticker: string;
  todayMs: number;
  axisStartMs: number;
  axisEndMs: number;
  /** Active forward window in days (30, or 365 when 30d was empty). */
  horizonDays: number;
  items: CompanyHorizonCatalyst[];
  programs: ClinicalDevProgram[];
};

/** Same calendar window as Price variation / Volume charts for the given horizon. */
export const CLINICAL_LANE_PRICE_RANGE: PriceVarChartRange = "cat6M";

export function priceAlignedLaneAxis(
  range: PriceVarChartRange = CLINICAL_LANE_PRICE_RANGE,
  nowMs = Date.now(),
): { startMs: number; endMs: number } {
  const cutoff = rangeToCalendarCutoff(range, nowMs);
  const parsed = Date.parse(`${cutoff}T12:00:00`);
  const startMs = Number.isFinite(parsed) ? parsed : nowMs - MS_DAY;
  const endMs = nowMs + chartFuturePadDays(range) * MS_DAY;
  return { startMs, endMs: Math.max(endMs, startMs + MS_DAY) };
}

export function parseLaneDateMs(raw: unknown): number | null {
  const iso = normalizeCompletionDateForKey(raw);
  if (!iso || iso === "—") return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function startOfQuarterMs(ms: number): number {
  const d = new Date(ms);
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1, 12, 0, 0).getTime();
}

export function addMonthsMs(fromMs: number, months: number): number {
  const d = new Date(fromMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

function isoOf(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtShort(ms: number, it: boolean): string {
  return new Date(ms).toLocaleDateString(it ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

function firstToken(raw: string | null | undefined, max = 48): string | null {
  const s = String(raw ?? "")
    .split(/[|,;/]/)[0]
    ?.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * First list segment for product / study labels shown in UI.
 * Never bake an ellipsis into the string — chips CSS-truncate; tooltips need the full name.
 */
function firstSegment(raw: string | null | undefined, max = 160): string | null {
  const s = String(raw ?? "")
    .split(/[|,;/]/)[0]
    ?.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const DEV_PATH_NOISE_RE =
  /\b(earnings|results of operations|officer|director|departure|appointment|10-q|10-k|compensation|offering|atm program|warrant|investor day|shareholder|price target|stock (?:price|news)|world muscle|abstract submission)\b/i;

const CONGRESS_NAME_RE =
  /\b(esmo(?:\s*gi)?|asco|aacr|ash\b|sabcs|wclc|world lung)\b/i;

const ACCELERATED_PATH_RE =
  /\baccelerated approval\b|\b(aa|accelerated)\s+path(?:way)?\b|\bconfirmatory (?:trial|study)\b|\bin parallel\b/i;

/** Sourced congress windows — used when the feed only has a month-1 placeholder. */
const KNOWN_CONGRESS_WINDOWS: { re: RegExp; start: string; end: string }[] = [
  { re: /\besmo\b/i, start: "2026-10-23", end: "2026-10-27" },
];

export function isFdaDevelopmentDesignation(blob: string): boolean {
  const s = String(blob ?? "");
  if (/\b((?:nda|bla)\s+approv|marketing approval)\b/i.test(s)) return false;
  return /\b(fast[- ]track|orphan(?:\s+drug)?(?:\s+designation)?|breakthrough therapy|r.?mat\b|prime designation|(?:fda|ema)\s+desig)/i.test(
    s,
  );
}

export function isCongressPresentation(blob: string, eventType?: string | null): boolean {
  const et = String(eventType ?? "").toLowerCase().trim();
  if (et === "congress") return true;
  return CONGRESS_NAME_RE.test(blob);
}

function isMarketingApprovalEvent(blob: string, fdaOutcome?: string | null): boolean {
  if (isFdaDevelopmentDesignation(blob)) return false;
  if (fdaOutcome === "approved") return true;
  if (/\baccelerated approval\b/i.test(blob) && !/\b(granted|received|approved the)\b/i.test(blob)) {
    return false;
  }
  return /\b((?:fda|ema)\s+approv(?:ed|es)|approval granted|marketing approval|nda approved|bla approved)\b/i.test(
    blob,
  );
}

export function knownCongressWindow(
  blob: string,
  plotMs: number,
): { startMs: number; endMs: number } | null {
  const year = new Date(plotMs).getFullYear();
  for (const row of KNOWN_CONGRESS_WINDOWS) {
    if (!row.re.test(blob)) continue;
    const startMs = parseLaneDateMs(row.start);
    const endMs = parseLaneDateMs(row.end);
    if (startMs == null || endMs == null) continue;
    if (new Date(startMs).getFullYear() !== year) continue;
    return { startMs, endMs };
  }
  return null;
}

function isDayOneMs(ms: number): boolean {
  return new Date(ms).getDate() === 1;
}

function startOfMonthMsLocal(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0).getTime();
}

function endOfMonthMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0).getTime();
}

function fmtMonthYear(ms: number, it: boolean): string {
  return new Date(ms).toLocaleDateString(it ? "it-IT" : "en-GB", {
    month: "short",
    year: "numeric",
  });
}

export function fmtLaneDate(ms: number, it: boolean, monthImputed?: boolean): string {
  return monthImputed ? fmtMonthYear(ms, it) : fmtShort(ms, it);
}

/** Map a public event to a drug-development stage, or null if it is news noise. */
export function classifyDevPathStage(
  blob: string,
  eventType?: string | null,
  phaseHint?: string | null,
): DevPathStageId | null {
  const et = String(eventType ?? "").toLowerCase().trim();
  if (et === "partnership" || et === "other" || et === "ctgov" || et === "sec_8k") {
    if (DEV_PATH_NOISE_RE.test(blob)) return null;
  }
  if (DEV_PATH_NOISE_RE.test(blob)) return null;
  if (isFdaDevelopmentDesignation(blob)) return "designation";
  if (isCongressPresentation(blob, et)) return "congress";
  if (et === "fda_vote" || et === "fda_safety") return "adcom";
  if (et === "pdufa") return "pdufa";
  if (et === "submission") return "submission";
  if (et === "cd" || et === "cd_milestone" || et === "trial_primary_completion") return "readout";
  if (et === "readout" || et === "study_completion" || et === "primary_completion") return "readout";
  if (et === "preclinical") return "ind";
  if (et === "study_start" || et === "initiation") {
    if (phaseHint) return studyPhaseStage(phaseHint);
    if (/\b(phase|ph\.?|pivotal|\bind\b)\b/i.test(blob)) return studyPhaseStage(blob);
    return "phase1";
  }
  if (/\b(crl|complete response letter)\b/i.test(blob)) return "crl";
  if (/\b(adcom|advisory committee)\b/i.test(blob)) return "adcom";
  if (/\b(pdufa|user[- ]fee|fda action date)\b/i.test(blob)) return "pdufa";
  if (isMarketingApprovalEvent(blob)) return "approval";
  if (et === "approval") return null;
  if (/\b(nda|bla|maa|submitted to the fda|fda submission)\b/i.test(blob)) return "submission";
  if (/\b(pre-?nda|type b meeting)\b/i.test(blob)) return "pre_nda";
  if (/\b(readout|topline|primary completion|interim analysis|data (?:cut|readout))\b/i.test(blob)) {
    return "readout";
  }
  if (/\b(phase\s*(?:3|iii)|pivotal|ph\.?\s*3)\b/i.test(blob)) return "phase3";
  if (/\b(phase\s*(?:2|ii)|ph\.?\s*2)\b/i.test(blob)) return "phase2";
  if (/\b(phase\s*(?:1|i)\b|first[- ]in[- ]human|ph\.?\s*1)\b/i.test(blob)) return "phase1";
  if (/\b(\bind\b|investigational new drug|preclinical)\b/i.test(blob)) return "ind";
  if (/\b(dose (?:select|escalat|expansion|chosen)|expansion cohort)\b/i.test(blob)) {
    return "phase2";
  }
  if (/\bdose\b/i.test(blob) && /\b(qd|bid|mg|selected)\b/i.test(blob)) return "phase2";
  if (/\b(initiat(?:e|ion)|first patient|fpiv|trial start|dosing start)\b/i.test(blob)) {
    return "phase1";
  }
  return null;
}

export function devPathStageLabel(id: DevPathStageId, it: boolean): string {
  const map: Record<DevPathStageId, { en: string; it: string }> = {
    ind: { en: "IND", it: "IND" },
    phase1: { en: "Phase 1", it: "Fase 1" },
    phase2: { en: "Phase 2", it: "Fase 2" },
    phase3: { en: "Phase 3", it: "Fase 3" },
    pre_nda: { en: "Pre-NDA", it: "Pre-NDA" },
    readout: { en: "Readout", it: "Readout" },
    congress: { en: "Congress", it: "Congress" },
    designation: { en: "Designation", it: "Designazione" },
    submission: { en: "Submission", it: "Submission" },
    filing: { en: "Filing", it: "Filing" },
    adcom: { en: "FDA AdCom", it: "AdCom FDA" },
    pdufa: { en: "PDUFA", it: "PDUFA" },
    approval: { en: "Approval", it: "Approvazione" },
    crl: { en: "CRL", it: "CRL" },
  };
  return it ? map[id].it : map[id].en;
}

function phaseRank(phaseRaw: string | null | undefined): number {
  const p = String(phaseRaw ?? "").toLowerCase();
  if (/preclinical|\bind\b/.test(p)) return 0;
  if (/4|approv/.test(p)) return 8;
  if (/3|iii/.test(p)) return 3;
  if (/2|ii/.test(p)) return 2;
  if (/1|i\b/.test(p)) return 1;
  return 2;
}

/** Map a study's listed phase onto the development-path stage for study-start markers. */
export function studyPhaseStage(phaseRaw: string | null | undefined): DevPathStageId {
  const rank = phaseRank(phaseRaw);
  if (rank >= 3) return "phase3";
  if (rank >= 2) return "phase2";
  if (rank >= 1) return "phase1";
  return "ind";
}

function statusAliveRank(status: string | null | undefined): number {
  const s = String(status ?? "")
    .toUpperCase()
    .replace(/_/g, " ");
  if (/TERMINATED|WITHDRAWN|SUSPENDED|UNKNOWN STATUS|NO LONGER AVAILABLE/.test(s)) return 0;
  if (/COMPLETED/.test(s)) return 1;
  if (/RECRUITING|ENROLLING|ACTIVE|NOT YET|AVAILABLE/.test(s)) return 2;
  return 1;
}

function studyEndMsFromRecord(rec: ClinicalPreCdRecord | null | undefined): number | null {
  if (!rec) return null;
  return (
    parseLaneDateMs(rec.meta?.completion_date) ??
    parseLaneDateMs(rec.meta?.primary_completion_date) ??
    parseLaneDateMs(rec.completion_date)
  );
}

function studyStartMsFromRecord(rec: ClinicalPreCdRecord | null | undefined): number | null {
  if (!rec) return null;
  return parseLaneDateMs(rec.meta?.start_date);
}

/**
 * Gantt X-axis for the current NCT: study start → study completion.
 * Does not stretch to a rolling 6-month market window.
 */
export function studyFrameAxis(
  rec: ClinicalPreCdRecord | null | undefined,
  markers: { plotMs: number }[],
  todayMs: number,
): { start: number; end: number } {
  const startMs = studyStartMsFromRecord(rec);
  const endMs = studyEndMsFromRecord(rec);
  const times = markers.map((m) => m.plotMs).filter((t) => Number.isFinite(t));
  const lo = startMs ?? (times.length ? Math.min(...times) : todayMs);
  const hi = endMs ?? (times.length ? Math.max(...times) : todayMs);
  const span = Math.max(MS_DAY, hi - lo);
  const pad = Math.max(10 * MS_DAY, Math.round(span * 0.06));
  let start = lo - pad;
  let end = hi + pad;
  if (todayMs >= start && todayMs <= end) {
    /* today already inside the study */
  } else if (endMs != null && todayMs > end && todayMs - end < 45 * MS_DAY) {
    end = todayMs + pad;
  }
  if (end <= start) end = start + 60 * MS_DAY;
  return { start: startOfMonthMsLocal(start), end: startOfMonthMsLocal(addMonthsMs(end, 1)) };
}

function pushStudyFrameMarkers(
  rec: ClinicalPreCdRecord,
  it: boolean,
  todayMs: number,
  markers: ClinicalLaneMarker[],
): void {
  const meta = rec.meta ?? {};
  const phaseRaw = meta.phase ?? rec.study_phase ?? null;
  const phaseStage = studyPhaseStage(phaseRaw);
  const nct = rec.nct_id?.trim() || "—";
  const phaseLbl = phaseRaw ? localizeStudyPhase(String(phaseRaw), it) : null;
  const design = firstToken(meta.study_design, 72);
  const status = String(meta.overall_status ?? "");
  const terminated = /TERMINATED|WITHDRAWN|SUSPENDED/i.test(status);
  const startMs = parseLaneDateMs(meta.start_date);
  const primaryMs = parseLaneDateMs(meta.primary_completion_date);
  const completeMs = parseLaneDateMs(meta.completion_date ?? rec.completion_date);

  const detailBits = [nct, phaseLbl, design, rec.meta?.brief_title]
    .filter(Boolean)
    .join(" · ");

  const push = (
    id: string,
    title: string,
    plotMs: number,
    stageId: DevPathStageId,
    dateClass: ClinicalLaneMarker["dateClass"],
    detail: string,
  ) => {
    const certainty: LaneCertainty =
      plotMs > todayMs + MS_DAY / 2 ? "expected" : "occurred";
    markers.push({
      id,
      kind: "clinical",
      certainty,
      plotMs,
      windowStartMs: plotMs,
      windowEndMs: null,
      title,
      subtitle: fmtLaneDate(plotMs, it, isDayOneMs(plotMs)),
      detail,
      stageId,
      dateClass,
      monthImputed: isDayOneMs(plotMs),
    });
  };

  if (startMs != null) {
    push(
      `study-start-${nct}-${startMs}`,
      it ? "Avvio studio" : "Study start",
      startMs,
      phaseStage,
      "path",
      detailBits,
    );
  }
  if (primaryMs != null) {
    push(
      `study-primary-${nct}-${primaryMs}`,
      it ? "Primary completion" : "Primary completion",
      primaryMs,
      "readout",
      "study_cd",
      it
        ? `Fine endpoint primari · NCT ${nct}${phaseLbl ? ` · ${phaseLbl}` : ""}`
        : `Primary endpoint window closes · NCT ${nct}${phaseLbl ? ` · ${phaseLbl}` : ""}`,
    );
  }
  if (completeMs != null && (primaryMs == null || Math.abs(completeMs - primaryMs) > 14 * MS_DAY)) {
    push(
      `study-end-${nct}-${completeMs}`,
      terminated
        ? it
          ? "Studio terminato"
          : "Study terminated"
        : it
          ? "Completamento studio"
          : "Study completion",
      completeMs,
      "readout",
      "study_end",
      it
        ? `Milestone finale di questo NCT · ${localizeStudyStatus(status, it) || status}`
        : `Final milestone of this NCT · ${localizeStudyStatus(status, it) || status}`,
    );
  } else if (completeMs != null && primaryMs == null) {
    push(
      `study-end-${nct}-${completeMs}`,
      terminated
        ? it
          ? "Studio terminato"
          : "Study terminated"
        : it
          ? "Completamento studio"
          : "Study completion",
      completeMs,
      "readout",
      "study_end",
      detailBits,
    );
  }
}

function normalizeProgramId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

/** Brand ↔ generic / code aliases so guidance `asset_name` attaches to the right chip. */
const PROGRAM_ALIASES: Record<string, readonly string[]> = {
  veklury: ["remdesivir", "gs5734"],
  remdesivir: ["veklury", "gs5734"],
  idelalisib: ["zydelig", "cal101", "gs1101"],
  zydelig: ["idelalisib", "cal101", "gs1101"],
  obeldesivir: ["gs5245"],
  litifilimab: ["biiib059"],
};

/** Prefer brand chip ids when brand/generic would otherwise split into two tabs. */
const PROGRAM_BRAND_CANON = new Set([
  "veklury",
  "zydelig",
  "idelalisib",
  "obeldesivir",
  "litifilimab",
  "leqembi",
  "lecanemab",
]);

function collapseProgramId(id: string): string {
  if (!id) return id;
  if (PROGRAM_BRAND_CANON.has(id)) return id === "lecanemab" ? "leqembi" : id;
  for (const brand of PROGRAM_BRAND_CANON) {
    if ((PROGRAM_ALIASES[brand] ?? []).includes(id)) {
      return brand === "lecanemab" ? "leqembi" : brand;
    }
  }
  for (const [canon, aliases] of Object.entries(PROGRAM_ALIASES)) {
    if (aliases.includes(id)) return canon;
  }
  return id;
}

function programMatchIds(program: ClinicalDevProgram): Set<string> {
  const ids = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const id = raw ? normalizeProgramId(raw) : "";
    if (!id) return;
    ids.add(id);
    for (const a of PROGRAM_ALIASES[id] ?? []) ids.add(normalizeProgramId(a));
  };
  add(program.id);
  add(program.drug);
  return ids;
}

function drugNameFromRecord(rec: ClinicalPreCdRecord | null | undefined): string | null {
  if (!rec) return null;
  const fromAi = (rec as { ai?: { programs_mentioned?: string[] } }).ai?.programs_mentioned?.[0];
  const candidates = [
    firstSegment(rec.meta?.interventions, 120),
    ...((rec.clinical_events ?? []).flatMap((ev) => [
      firstSegment(ev.drug, 120),
      firstSegment(ev.asset, 120),
    ])),
    firstSegment(fromAi, 120),
    firstSegment(rec.ai?.study_clinical_profile?.product_name, 120),
  ];
  for (const c of candidates) {
    const usable = usableProductName(c);
    if (usable) return usable;
  }
  return null;
}

function programMentionsNeedle(haystack: string, needleId: string, drugLabel: string): boolean {
  const h = haystack.toLowerCase();
  if (!h) return false;
  const compact = h.replace(/[^a-z0-9]+/g, "");
  if (needleId && compact.includes(needleId)) return true;
  const label = drugLabel.trim().toLowerCase();
  if (label.length >= 3 && h.includes(label)) return true;
  for (const a of PROGRAM_ALIASES[needleId] ?? []) {
    if (a && (compact.includes(a) || h.includes(a))) return true;
  }
  return false;
}

function guidanceMatchesProgram(
  ev: GuidanceCalendarEvent,
  program: ClinicalDevProgram,
  multi: boolean,
  siblingPrograms: ClinicalDevProgram[] = [],
): boolean {
  const matchIds = programMatchIds(program);
  const asset = firstToken(ev.asset_name);
  const assetId = asset ? normalizeProgramId(asset) : "";
  const selfAssetHit = Boolean(assetId && matchIds.has(assetId));
  // Hard exclude only when the asset is another chip — not an alias of this one.
  if (assetId && !selfAssetHit) {
    for (const sib of siblingPrograms) {
      if (sib.id === program.id) continue;
      if (programMatchIds(sib).has(assetId)) return false;
    }
  }
  if (program.nctId) {
    const nct = program.nctId.toUpperCase();
    const blobNct = [ev.timing_quote, ev.asset_name, ev.indication, ev.event_type]
      .filter(Boolean)
      .join(" ")
      .toUpperCase();
    if (blobNct.includes(nct)) return true;
  }
  if (selfAssetHit) return true;
  if (asset && programMentionsNeedle(asset, program.id, program.drug)) return true;
  const blob = [ev.timing_quote, ev.indication, ev.event_type, ev.asset_name]
    .filter(Boolean)
    .join(" ");
  if (programMentionsNeedle(blob, program.id, program.drug)) return true;
  // Product chip selected (multi) → never attach unlabeled company-wide events to every drug.
  if (multi) return false;
  return true;
}

function resolveFocusProgram(
  programs: ClinicalDevProgram[],
  programId: string | null | undefined,
): ClinicalDevProgram | null {
  if (!programId || !programs.length) return null;
  const direct = programs.find((p) => p.id === programId);
  if (direct) return direct;
  const norm = normalizeProgramId(programId);
  return (
    programs.find(
      (p) => p.id === norm || normalizeProgramId(p.drug) === norm || programMatchIds(p).has(norm),
    ) ?? null
  );
}

function eisMatchesProgram(
  ev: TickerEisEventDetail,
  program: ClinicalDevProgram,
  siblingIds: string[],
): boolean {
  if (program.nctId && ev.nctId && String(ev.nctId).toUpperCase() === program.nctId.toUpperCase()) {
    return true;
  }
  const blob = [ev.title, ev.summary, ev.asset, ev.nctId, ev.studyTitle, ev.impactNote]
    .filter(Boolean)
    .join(" ");
  if (programMentionsNeedle(blob, program.id, program.drug)) return true;
  for (const otherId of siblingIds) {
    if (otherId === program.id) continue;
    if (programMentionsNeedle(blob, otherId, otherId)) return false;
  }
  return siblingIds.length <= 1;
}

/**
 * Up to {@link TOP_CLINICAL_PROGRAM_COUNT} most advanced products for a ticker
 * (by clinical phase, then enrollment). Built from feed + guidance + sim row.
 */
export function listTopClinicalPrograms(opts: {
  ticker: string;
  records?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  simRow?: Record<string, unknown> | null;
  completionDate?: string | null;
  limit?: number;
}): ClinicalDevProgram[] {
  const ticker = opts.ticker.trim().toUpperCase();
  if (!ticker) return [];
  const limit = Math.max(1, opts.limit ?? TOP_CLINICAL_PROGRAM_COUNT);
  const cdIso = normalizeCompletionDateForKey(opts.completionDate);
  const cdOk = cdIso && cdIso !== "—" ? cdIso : null;
  const byId = new Map<string, ClinicalDevProgram & { _rec?: ClinicalPreCdRecord }>();

  const upsert = (next: ClinicalDevProgram, rec?: ClinicalPreCdRecord) => {
    const id = next.id;
    if (!id) return;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...next, _rec: rec });
      return;
    }
    const betterPhase = next.phaseRank > prev.phaseRank;
    const samePhase = next.phaseRank === prev.phaseRank;
    const betterEnroll =
      samePhase && (next.enrollment ?? -1) > (prev.enrollment ?? -1);
    const matchesCd =
      samePhase &&
      !betterEnroll &&
      cdOk &&
      next.cdDate === cdOk &&
      prev.cdDate !== cdOk;
    if (betterPhase || betterEnroll || matchesCd) {
      byId.set(id, { ...next, _rec: rec ?? prev._rec });
    }
  };

  for (const rec of opts.records ?? []) {
    if (String(rec.ticker ?? "").toUpperCase() !== ticker) continue;
    const drug =
      drugNameFromRecord(rec) ??
      usableProductName(firstSegment(rec.meta?.brief_title, 160)) ??
      null;
    if (!drug) continue;
    const id = collapseProgramId(normalizeProgramId(drug));
    if (!id) continue;
    const phase = rec.meta?.phase ?? rec.study_phase ?? null;
    const studyCd =
      normalizeCompletionDateForKey(rec.meta?.primary_completion_date) ||
      normalizeCompletionDateForKey(rec.meta?.completion_date) ||
      normalizeCompletionDateForKey(rec.completion_date) ||
      null;
    upsert(
      {
        id,
        drug,
        phase: phase ? String(phase) : null,
        phaseRank: phaseRank(phase),
        nctId: rec.nct_id?.trim() || null,
        cdDate: studyCd && studyCd !== "—" ? studyCd : null,
        indication: firstToken(rec.meta?.conditions, 36),
        enrollment: rec.meta?.enrollment ?? null,
        status: rec.meta?.overall_status ? String(rec.meta.overall_status) : null,
      },
      rec,
    );
  }

  for (const ev of opts.guidanceEvents ?? []) {
    if (String(ev.ticker ?? "").toUpperCase() !== ticker) continue;
    const nct = nctFromGuidanceEvent(ev);
    const drug =
      usableProductName(firstSegment(ev.asset_name, 160)) ||
      // NCT-only CD windows (no asset_name) — keep a stable chip, not Studio Phase.
      (nct ? nct : null);
    if (!drug) continue;
    const id = collapseProgramId(normalizeProgramId(drug));
    if (!id) continue;
    const phase = ev.trial_phase ?? null;
    upsert({
      id,
      drug,
      phase: phase ? String(phase) : null,
      phaseRank: phaseRank(phase),
      nctId: nct,
      cdDate: normalizeCompletionDateForKey(ev.sim_cd_date) ||
        normalizeCompletionDateForKey(ev.window_start) ||
        null,
      indication: firstToken(ev.indication, 36),
      enrollment: null,
      status: null,
    });
  }

  const sim = opts.simRow ?? null;
  const simDrug = usableProductName(clinicalDrugFromSimRow(sim ?? undefined)) || null;
  const simNct = clinicalNctFromSimRow(sim ?? undefined);
  const simTitle = usableProductName(firstSegment(clinicalStudyTitleFromSimRow(sim ?? undefined), 160));
  if (simDrug) {
    const id = collapseProgramId(normalizeProgramId(simDrug));
    if (id) {
      const phase = clinicalPhaseFromSimRow(sim ?? undefined);
      upsert({
        id,
        drug: simDrug,
        phase: phase && !isRegulatoryMilestoneLabel(phase) ? phase : null,
        phaseRank: phaseRank(phase),
        nctId: simNct,
        cdDate: cdOk,
        indication: firstToken(clinicalIndicationFromSimRow(sim ?? undefined), 36),
        enrollment: null,
        status: null,
      });
    }
  }

  // Sim / calendar NCT with no named product yet — still surface the study chip,
  // but never use the NCT id as the product / drug label (shown separately as nctId).
  if (simNct && !simDrug) {
    const id = collapseProgramId(normalizeProgramId(simNct));
    if (id) {
      const phase = clinicalPhaseFromSimRow(sim ?? undefined);
      upsert({
        id,
        drug: simTitle || "CD study",
        phase: phase && !isRegulatoryMilestoneLabel(phase) ? phase : null,
        phaseRank: phaseRank(phase),
        nctId: simNct,
        cdDate: cdOk,
        indication: firstToken(clinicalIndicationFromSimRow(sim ?? undefined), 36),
        enrollment: null,
        status: null,
      });
    }
  }

  const primary = pickPrimaryRecord(ticker, cdOk, opts.records ?? []);
  if (byId.size === 0) {
    const recDrug = primary ? drugNameFromRecord(primary) : null;
    const drug =
      simDrug ||
      recDrug ||
      simTitle ||
      (simNct ? "CD study" : null) ||
      (cdOk ? ticker : null);
    if (drug) {
      const id =
        collapseProgramId(normalizeProgramId(simDrug || recDrug || simNct || drug)) ||
        ticker.toLowerCase();
      const phase =
        primary?.meta?.phase ??
        primary?.study_phase ??
        clinicalPhaseFromSimRow(sim ?? undefined);
      const studyCd =
        normalizeCompletionDateForKey(primary?.meta?.primary_completion_date) ||
        normalizeCompletionDateForKey(primary?.meta?.completion_date) ||
        normalizeCompletionDateForKey(primary?.completion_date) ||
        cdOk;
      upsert(
        {
          id,
          drug,
          phase:
            phase && !isRegulatoryMilestoneLabel(String(phase)) ? String(phase) : null,
          phaseRank: phaseRank(phase),
          nctId: (primary?.nct_id?.trim() || simNct) ?? null,
          cdDate: studyCd && studyCd !== "—" ? studyCd : cdOk,
          indication:
            firstToken(primary?.meta?.conditions, 36) ||
            firstToken(clinicalIndicationFromSimRow(sim ?? undefined), 36),
          enrollment: primary?.meta?.enrollment ?? null,
          status: primary?.meta?.overall_status
            ? String(primary.meta.overall_status)
            : null,
        },
        primary ?? undefined,
      );
    }
  }
  const ranked = [...byId.values()].sort((a, b) => {
    const alive = statusAliveRank(b.status) - statusAliveRank(a.status);
    if (alive !== 0) return alive;
    if (b.phaseRank !== a.phaseRank) return b.phaseRank - a.phaseRank;
    if ((b.enrollment ?? -1) !== (a.enrollment ?? -1)) {
      return (b.enrollment ?? -1) - (a.enrollment ?? -1);
    }
    const aPrimary =
      primary &&
      (a.nctId === primary.nct_id ||
        normalizeProgramId(drugNameFromRecord(primary) ?? "") === a.id);
    const bPrimary =
      primary &&
      (b.nctId === primary.nct_id ||
        normalizeProgramId(drugNameFromRecord(primary) ?? "") === b.id);
    if (aPrimary !== bPrimary) return aPrimary ? -1 : 1;
    return a.drug.localeCompare(b.drug);
  });

  return ranked.slice(0, limit).map(({ _rec: _ignored, ...p }) => p);
}

/** Completing-CD program first so Deep Dive opens on that product Gantt. */
export function defaultClinicalProgramId(
  programs: ClinicalDevProgram[],
  completionDate?: string | null,
): string | null {
  if (!programs.length) return null;
  const cdOk = normalizeCompletionDateForKey(completionDate);
  const byCd =
    cdOk && cdOk !== "—"
      ? programs.find((p) => p.cdDate === cdOk)
      : null;
  return (byCd ?? programs.find((p) => p.nctId) ?? programs[0]).id;
}

function recordsForProgram(
  ticker: string,
  program: ClinicalDevProgram,
  records: ClinicalPreCdRecord[],
): ClinicalPreCdRecord[] {
  const tk = ticker.trim().toUpperCase();
  const matchIds = programMatchIds(program);
  return records.filter((r) => {
    if (String(r.ticker ?? "").toUpperCase() !== tk) return false;
    const drug = drugNameFromRecord(r);
    if (drug && matchIds.has(normalizeProgramId(drug))) return true;
    if (program.nctId && r.nct_id && String(r.nct_id).toUpperCase() === program.nctId.toUpperCase()) {
      return true;
    }
    return false;
  });
}

function currentPathIndex(
  phaseRaw: string | null,
  dated: Map<DevPathStageId, number>,
  todayMs: number,
  order: DevPathStageId[],
): number {
  const occurred = (id: DevPathStageId) => {
    const t = dated.get(id);
    return t != null && t <= todayMs + MS_DAY;
  };
  const idx = (id: DevPathStageId) => {
    const i = order.indexOf(id);
    return i >= 0 ? i : 0;
  };
  if (occurred("approval") || occurred("crl")) return idx("approval");
  if (occurred("pdufa")) return idx("pdufa");
  if (occurred("adcom")) return idx("adcom");
  if (occurred("filing")) return idx("filing");
  if (occurred("submission")) return idx("submission");
  if (order.includes("pre_nda") && occurred("pre_nda")) return idx("pre_nda");
  const rank = phaseRank(phaseRaw);
  if (rank >= 8) return idx("approval");
  if (rank >= 3 && order.includes("phase3")) return idx("phase3");
  if (rank >= 2) return idx("phase2");
  if (rank >= 1) return idx("phase1");
  return idx("ind");
}

function pickStageDate(
  id: DevPathStageId,
  clinical: ClinicalLaneMarker[],
  todayMs: number,
): { ms: number; imprecise: boolean } | null {
  const hits = clinical.filter((m) => m.stageId === id);
  if (!hits.length) return null;
  const prefer =
    id === "readout"
      ? hits.filter((m) => m.dateClass === "study_cd")
      : id === "approval"
        ? hits.filter((m) => m.dateClass !== "designation")
        : hits;
  const pool = prefer.length ? prefer : hits.filter((m) => m.dateClass !== "congress");
  const use = pool.length ? pool : hits;
  const preferUpcoming =
    id === "readout" ||
    id === "submission" ||
    id === "filing" ||
    id === "pdufa" ||
    id === "adcom" ||
    id === "pre_nda" ||
    id === "approval" ||
    id === "crl";
  if (preferUpcoming) {
    const upcoming = [...use]
      .filter((m) => m.plotMs >= todayMs - MS_DAY)
      .sort((a, b) => a.plotMs - b.plotMs);
    if (upcoming.length) {
      return { ms: upcoming[0]!.plotMs, imprecise: Boolean(upcoming[0]!.monthImputed) };
    }
    // Most recent past (not the oldest historic CD).
    let best = use[0]!;
    for (const m of use) {
      if (m.plotMs > best.plotMs) best = m;
    }
    return { ms: best.plotMs, imprecise: Boolean(best.monthImputed) };
  }
  // Early development stages: prefer earliest dated gate.
  let best = use[0]!;
  for (const m of use) {
    if (m.plotMs < best.plotMs) best = m;
  }
  return { ms: best.plotMs, imprecise: Boolean(best.monthImputed) };
}

export function detectAcceleratedDevPath(
  phaseRaw: string | null,
  clinical: ClinicalLaneMarker[],
  blob: string,
): boolean {
  if (ACCELERATED_PATH_RE.test(blob)) return true;
  const rank = phaseRank(phaseRaw);
  const hasPh3 = clinical.some((m) => m.stageId === "phase3");
  const hasSub = clinical.some((m) => m.stageId === "submission" && m.certainty !== "inferred");
  return rank === 2 && hasPh3 && !hasSub;
}

function buildPathStages(
  phaseRaw: string | null,
  clinical: ClinicalLaneMarker[],
  it: boolean,
  todayMs: number,
  topology: DevPathTopology,
): DevPathStage[] {
  const order = topology === "accelerated" ? DEV_PATH_ORDER_ACCELERATED : DEV_PATH_ORDER_SERIAL;
  const dated = new Map<DevPathStageId, { ms: number; imprecise: boolean }>();
  for (const id of order) {
    const hit = pickStageDate(id, clinical, todayMs);
    if (hit) dated.set(id, hit);
  }
  const datedMs = new Map<DevPathStageId, number>();
  for (const [id, v] of dated) datedMs.set(id, v.ms);
  const cur = currentPathIndex(phaseRaw, datedMs, todayMs, order);
  return order.map((id, i) => {
    let status: DevPathStageStatus = "empty";
    if (i < cur) status = "done";
    else if (i === cur) status = "current";
    else if (i === cur + 1) status = "next";
    const d = dated.get(id);
    return {
      id,
      label: devPathStageLabel(id, it),
      status,
      dateMs: d?.ms ?? null,
      dateImprecise: d?.imprecise,
    };
  });
}

function buildConfirmatoryPhase3(
  clinical: ClinicalLaneMarker[],
  it: boolean,
  todayMs = Date.now(),
): DevPathStage {
  const hit = pickStageDate("phase3", clinical, todayMs);
  return {
    id: "phase3",
    label: it ? "Fase 3 confermatoria" : "Phase 3 confirmatory",
    status: hit ? "next" : "empty",
    dateMs: hit?.ms ?? null,
    dateImprecise: hit?.imprecise,
  };
}

function buildPathNote(
  header: ClinicalLaneHeader,
  stages: DevPathStage[],
  firstUpcoming: ClinicalLaneMarker | undefined,
  topology: DevPathTopology,
  it: boolean,
): string {
  const submitted = stages.find((s) => s.id === "submission" && s.dateMs != null);
  const drug = header.drug || header.ticker;
  if (!submitted) {
    const gate = firstUpcoming
      ? `${firstUpcoming.title} (${fmtLaneDate(firstUpcoming.plotMs, it, firstUpcoming.monthImputed)})`
      : null;
    const core = it
      ? `${drug} è a monte della submission (nessuna NDA/BLA in calendario).${gate ? ` Prossimo gate: ${gate}.` : ""}`
      : `${drug} is upstream of submission (no NDA/BLA on the calendar).${gate ? ` Next gate: ${gate}.` : ""}`;
    if (topology !== "accelerated") return core;
    return it
      ? `${core} Percorso accelerato: la Fase 3 è confermatoria in parallelo, non un gate prima della submission.`
      : `${core} Accelerated-approval path: Phase 3 is confirmatory in parallel, not a serial gate before submission.`;
  }
  const pdufa = stages.find((s) => s.id === "pdufa");
  if (pdufa?.dateMs != null) {
    return it
      ? `Submission in calendario · PDUFA ${fmtLaneDate(pdufa.dateMs, it, pdufa.dateImprecise)}.`
      : `Submission on the calendar · PDUFA ${fmtLaneDate(pdufa.dateMs, it, pdufa.dateImprecise)}.`;
  }
  return it
    ? "Submission in calendario — orologio FDA (filing / PDUFA) non ancora datato."
    : "Submission on the calendar — FDA clock (filing / PDUFA) not yet dated.";
}

function buildStudyFrameNote(header: ClinicalLaneHeader, it: boolean): string | null {
  const start = header.startDate ? parseLaneDateMs(header.startDate) : null;
  const primary = header.primaryCompletion ? parseLaneDateMs(header.primaryCompletion) : null;
  const end = header.studyCompletion ? parseLaneDateMs(header.studyCompletion) : null;
  if (start == null && primary == null && end == null) return null;
  const bits: string[] = [];
  if (header.phase) bits.push(header.phase);
  if (header.status) bits.push(header.status);
  if (header.studyDesign) bits.push(header.studyDesign);
  if (start != null) {
    bits.push(
      it
        ? `avvio ${fmtLaneDate(start, it, isDayOneMs(start))}`
        : `start ${fmtLaneDate(start, it, isDayOneMs(start))}`,
    );
  }
  if (primary != null) {
    bits.push(`primary completion ${fmtLaneDate(primary, it, isDayOneMs(primary))}`);
  }
  if (end != null) {
    bits.push(
      it
        ? `completamento ${fmtLaneDate(end, it, isDayOneMs(end))} (milestone finale)`
        : `completion ${fmtLaneDate(end, it, isDayOneMs(end))} (final milestone)`,
    );
  } else if (primary != null) {
    bits.push(
      it
        ? "primary completion = milestone finale di questo studio"
        : "primary completion = final milestone of this trial",
    );
  }
  return bits.join(" · ");
}

function isInferredEvent(ev: ClinicalPublicationEvent): boolean {
  const status = String(ev.confirmation_status ?? "").toLowerCase();
  if (status === "anticipated") return true;
  const gated = String(ev.eis_gated ?? "").toLowerCase();
  return gated.includes("unverified") || gated.includes("hypothesis");
}

function guidanceCertainty(ev: GuidanceCalendarEvent): LaneCertainty {
  const method = String(ev.estimation_method ?? "").toLowerCase();
  if (
    method.includes("estimate") ||
    method.includes("infer") ||
    method.includes("priority_review") ||
    method.includes("standard_review")
  ) {
    return "inferred";
  }
  const start = parseLaneDateMs(ev.window_start ?? ev.sim_cd_date);
  const today = Date.now();
  if (start != null && start < today - MS_DAY && ev.fda_outcome && ev.fda_outcome !== "pending") {
    return "occurred";
  }
  return "expected";
}

function stageMarkerTitle(stage: DevPathStageId, rawTitle: string, it: boolean): string {
  const label = devPathStageLabel(stage, it);
  const raw = rawTitle.trim();
  if (!raw) return clip(label, 42);
  const rl = raw.toLowerCase();
  const ll = label.toLowerCase();
  if (rl === ll || rl.startsWith(`${ll} `) || rl.startsWith(`${ll}·`) || rl.includes(` · ${ll}`)) {
    return clip(raw, 42);
  }
  return clip(`${label} · ${raw}`, 42);
}

function pickPrimaryRecord(
  ticker: string,
  cdIso: string | null,
  records: ClinicalPreCdRecord[],
): ClinicalPreCdRecord | null {
  const hit = findClinicalPreCdRecord(ticker, cdIso, records);
  if (hit && isClinicalPreCdRecordTrusted(hit)) return hit;
  const tk = ticker.trim().toUpperCase();
  return (
    records.find(
      (r) => String(r.ticker ?? "").toUpperCase() === tk && isClinicalPreCdRecordTrusted(r),
    ) ??
    records.find((r) => String(r.ticker ?? "").toUpperCase() === tk) ??
    null
  );
}

function clinicalEventTitle(ev: ClinicalPublicationEvent, it: boolean): string {
  const raw = String(ev.event_title ?? ev.summary ?? "").trim();
  if (raw) return clip(raw.replace(/^Expected CD — /i, it ? "CD prevista — " : "Expected CD — "), 42);
  const kind = String(ev.event_type ?? ev.source_type ?? "clinical");
  if (kind === "cd_milestone") return it ? "CD prevista" : "Expected CD";
  if (kind === "ctgov") return it ? "Aggiornamento CT.gov" : "CT.gov update";
  return it ? "Evento clinico" : "Clinical event";
}

function clinicalCertainty(ev: ClinicalPublicationEvent, plotMs: number, todayMs: number): LaneCertainty {
  if (isInferredEvent(ev)) return "inferred";
  if (plotMs > todayMs + MS_DAY / 2) return "expected";
  return "occurred";
}

function dateClassFor(stage: DevPathStageId, kind: string): ClinicalLaneMarker["dateClass"] {
  if (stage === "designation") return "designation";
  if (stage === "congress") return "congress";
  if (stage === "readout" && (kind === "cd_milestone" || kind === "cd" || kind === "sim_cd" || kind === "trial_primary_completion")) {
    return "study_cd";
  }
  return "path";
}

function refineMarkerTiming(
  blob: string,
  stage: DevPathStageId,
  plotMs: number,
  certainty: LaneCertainty,
  windowStart: number | null,
  windowEnd: number | null,
  treatAsMonthImputed: boolean,
): {
  plotMs: number;
  certainty: LaneCertainty;
  windowStartMs: number | null;
  windowEndMs: number | null;
  monthImputed: boolean;
} {
  if (stage === "congress") {
    const known = knownCongressWindow(blob, plotMs);
    if (known) {
      return {
        plotMs: known.startMs,
        certainty: certainty === "occurred" ? "occurred" : "expected",
        windowStartMs: known.startMs,
        windowEndMs: known.endMs,
        monthImputed: false,
      };
    }
  }
  const span = windowEnd != null && windowStart != null ? windowEnd - windowStart : 0;
  const monthImputed = treatAsMonthImputed && isDayOneMs(plotMs) && span < 5 * MS_DAY;
  if (monthImputed) {
    return {
      plotMs,
      certainty: certainty === "occurred" ? "occurred" : "inferred",
      windowStartMs: startOfMonthMsLocal(plotMs),
      windowEndMs: endOfMonthMs(plotMs),
      monthImputed: true,
    };
  }
  return {
    plotMs,
    certainty,
    windowStartMs: windowStart,
    windowEndMs: windowEnd && windowStart && windowEnd > windowStart ? windowEnd : null,
    monthImputed: false,
  };
}

function isPathGateMarker(m: ClinicalLaneMarker): boolean {
  return m.kind === "clinical" && m.stageId !== "congress" && m.stageId !== "designation";
}

function marketMove(ev: TickerEisEventDetail): { pct: number; horizon: "1d" | "3d" } | null {
  const d1 = ev.breakdown.delta_p_1d;
  const d3 = ev.breakdown.delta_p_3d;
  const a1 = d1 != null && Number.isFinite(d1) ? Math.abs(d1) : 0;
  const a3 = d3 != null && Number.isFinite(d3) ? Math.abs(d3) : 0;
  if (a1 >= MARKET_MOVE_1D && d1 != null) return { pct: d1, horizon: "1d" };
  if (a3 >= MARKET_MOVE_3D && d3 != null) return { pct: d3, horizon: "3d" };
  return null;
}

function certaintyRank(c: LaneCertainty): number {
  if (c === "occurred") return 0;
  if (c === "expected") return 1;
  return 2;
}

function isStudyCdLike(m: ClinicalLaneMarker): boolean {
  if (m.dateClass === "study_cd") return true;
  if (m.stageId !== "readout") return false;
  const blob = `${m.title} ${m.detail}`.toLowerCase();
  return /expected cd|cd prevista|cd window|readout study|completion date|primary completion|window closes/.test(
    blob,
  );
}

function markerKeepScore(m: ClinicalLaneMarker): number {
  let s = 30 - certaintyRank(m.certainty) * 10;
  if (m.dateClass === "study_cd" || m.dateClass === "study_end") s += 8;
  if (/^readout study$/i.test(m.title.trim())) s -= 12;
  if (m.certainty === "inferred") s -= 4;
  s += Math.min(8, m.detail.length / 20);
  return s;
}

function betterMarker(a: ClinicalLaneMarker, b: ClinicalLaneMarker): ClinicalLaneMarker {
  return markerKeepScore(a) >= markerKeepScore(b) ? a : b;
}

function dedupeMarkers(markers: ClinicalLaneMarker[]): ClinicalLaneMarker[] {
  const byDayTitle = new Map<string, ClinicalLaneMarker>();
  for (const m of markers) {
    const key = `${m.kind}|${isoOf(m.plotMs)}|${m.title.slice(0, 24).toLowerCase()}`;
    const prev = byDayTitle.get(key);
    byDayTitle.set(key, prev ? betterMarker(prev, m) : m);
  }
  const first = [...byDayTitle.values()];
  const byBucket = new Map<string, ClinicalLaneMarker>();
  for (const m of first) {
    let bucket: string;
    if (isStudyCdLike(m)) {
      bucket = `cd|${Math.round(m.plotMs / (14 * MS_DAY))}`;
    } else if (m.stageId === "congress") {
      bucket = `congress|${isoOf(m.plotMs)}|${m.title.slice(0, 20).toLowerCase()}`;
    } else {
      bucket = `${m.kind}|${isoOf(m.plotMs)}|${m.title.slice(0, 20).toLowerCase()}`;
    }
    const prev = byBucket.get(bucket);
    byBucket.set(bucket, prev ? betterMarker(prev, m) : m);
  }
  return [...byBucket.values()];
}

function inferFdaClockFromSubmission(
  markers: ClinicalLaneMarker[],
  guidance: GuidanceCalendarEvent[],
  it: boolean,
): void {
  const sub = markers
    .filter((m) => m.stageId === "submission")
    .sort((a, b) => a.plotMs - b.plotMs)[0];
  if (!sub) return;
  if (!markers.some((m) => m.stageId === "filing")) {
    const filingMs = sub.plotMs + 60 * MS_DAY;
    markers.push({
      id: `infer-filing-${sub.plotMs}`,
      kind: "clinical",
      certainty: "inferred",
      plotMs: filingMs,
      windowStartMs: null,
      windowEndMs: null,
      title: it ? "Filing · giorno 60" : "Filing · day 60",
      subtitle: fmtShort(filingMs, it),
      detail: it
        ? "Inferito: +60 giorni dalla submission (avvio clock FDA)."
        : "Inferred: +60 days from submission (FDA clock start).",
      stageId: "filing",
    });
  }
  if (markers.some((m) => m.stageId === "pdufa")) return;
  const methodBlob = guidance
    .map((ev) => String(ev.estimation_method ?? ""))
    .join(" ")
    .toLowerCase();
  const priority = methodBlob.includes("priority_review");
  const standard = methodBlob.includes("standard_review");
  if (!priority && !standard) return;
  const filing = markers.find((m) => m.stageId === "filing") ?? sub;
  const pdufaMs = addMonthsMs(filing.plotMs, priority ? 6 : 10);
  markers.push({
    id: `infer-pdufa-${filing.plotMs}`,
    kind: "clinical",
    certainty: "inferred",
    plotMs: pdufaMs,
    windowStartMs: null,
    windowEndMs: null,
    title: priority ? (it ? "PDUFA · priority" : "PDUFA · priority") : it ? "PDUFA · standard" : "PDUFA · standard",
    subtitle: fmtShort(pdufaMs, it),
    detail: priority
      ? it
        ? "Inferito: 6 mesi dal filing (priority review)."
        : "Inferred: 6 months from filing (priority review)."
      : it
        ? "Inferito: 10 mesi dal filing (standard review)."
        : "Inferred: 10 months from filing (standard review).",
    stageId: "pdufa",
  });
}

export function buildClinicalDevelopmentLane(opts: {
  ticker: string;
  completionDate?: string | null;
  records?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  sdsRow?: SdsRow | null;
  clinicalKpi?: number | null;
  lang?: "it" | "en";
  nowMs?: number;
  simRow?: Record<string, unknown> | null;
  /** When set, X-axis is forced (tests / price-chart sync). Default is the NCT study frame. */
  axisOverride?: { startMs: number; endMs: number } | null;
  /**
   * Focus one product from {@link listTopClinicalPrograms}.
   * Clinical milestones + EIS inflection points are scoped to that drug.
   */
  programId?: string | null;
  /**
   * Pin the lane to one NCT (per-study Development Path under Ongoing trials).
   * Prefer that record's dates/phase; completionDate is treated as this study's readout.
   */
  nctId?: string | null;
  /** Override phase when CT.gov study card has phase but clinical feed has no row. */
  phaseOverride?: string | null;
}): ClinicalLaneModel | null {
  const it = opts.lang === "it";
  const ticker = opts.ticker.trim().toUpperCase();
  if (!ticker) return null;
  void opts.sdsRow;
  const todayMs = opts.nowMs ?? Date.now();
  const records = opts.records ?? [];
  const cdIso = normalizeCompletionDateForKey(opts.completionDate);
  const cdOk = cdIso && cdIso !== "—" ? cdIso : null;
  const nctFocus = opts.nctId?.trim().toUpperCase() || null;
  // Same pool as the product chips (UI uses limit 20) so programId always resolves.
  const programs = listTopClinicalPrograms({
    ticker,
    records,
    guidanceEvents: opts.guidanceEvents,
    simRow: opts.simRow,
    completionDate: opts.completionDate,
    limit: 20,
  });
  const focusProgram = resolveFocusProgram(programs, opts.programId);
  const multiProgram = programs.length > 1;
  /** Product chip selected — never fall back to the company-wide catalyst soup. */
  const productScoped = Boolean(opts.programId);
  const programRecords = focusProgram
    ? recordsForProgram(ticker, focusProgram, records)
    : [];
  const recordByNct = nctFocus
    ? (programRecords.length ? programRecords : records).find(
        (r) =>
          String(r.ticker ?? "").toUpperCase() === ticker &&
          String(r.nct_id ?? "").trim().toUpperCase() === nctFocus,
      ) ??
      records.find(
        (r) =>
          String(r.ticker ?? "").toUpperCase() === ticker &&
          String(r.nct_id ?? "").trim().toUpperCase() === nctFocus,
      ) ??
      null
    : null;
  /**
   * When a product chip is selected, never fall back to the ticker's primary NCT
   * (that left the header stuck on e.g. Natalizumab while Litifilimab was active).
   */
  const rec = nctFocus
    ? recordByNct
    : focusProgram
      ? (() => {
          const nctWant = focusProgram.nctId?.trim().toUpperCase() || null;
          const byNct = nctWant
            ? programRecords.find((r) => String(r.nct_id ?? "").trim().toUpperCase() === nctWant)
            : null;
          return (
            byNct ??
            programRecords.find((r) => isClinicalPreCdRecordTrusted(r)) ??
            programRecords[0] ??
            null
          );
        })()
      : pickPrimaryRecord(ticker, cdOk, records);
  const sim = opts.simRow ?? null;
  const guidanceAll = opts.guidanceEvents ?? [];
  let guidanceEvents =
    productScoped
      ? focusProgram
        ? guidanceAll.filter((ev) =>
            guidanceMatchesProgram(ev, focusProgram, true, programs),
          )
        : []
      : guidanceAll;
  /**
   * Per-study strip under Ongoing trials: only keep guidance that names this NCT.
   * Otherwise product-wide Phase 2 / readout dates bleed onto every sibling trial.
   */
  if (nctFocus) {
    guidanceEvents = guidanceEvents.filter((ev) => {
      const blob = [ev.timing_quote, ev.asset_name, ev.indication, ev.event_type]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();
      return blob.includes(nctFocus);
    });
  }

  const drug =
    usableProductName(focusProgram?.drug) ||
    usableProductName(firstToken(rec?.meta?.interventions)) ||
    drugNameFromRecord(rec) ||
    usableProductName(firstToken(guidanceEvents[0]?.asset_name)) ||
    usableProductName(clinicalDrugFromSimRow(sim ?? undefined)) ||
    null;
  const condition =
    (nctFocus ? firstToken(rec?.meta?.conditions, 36) : null) ??
    focusProgram?.indication ??
    firstToken(rec?.meta?.conditions, 36) ??
    firstToken(clinicalIndicationFromSimRow(sim ?? undefined), 36);
  const simPhase = clinicalPhaseFromSimRow(sim ?? undefined);
  // Chip phase wins over a legacy Phase-2 NCT that lost the program upsert race.
  // When pinned to one NCT, never inherit the product chip's phase (observational
  // registries must not look like the lead Phase 2/3 catalyst).
  let phaseRaw: string | null =
    opts.phaseOverride && !isRegulatoryMilestoneLabel(opts.phaseOverride)
      ? opts.phaseOverride
      : null;
  if (!phaseRaw) {
    if (nctFocus) {
      phaseRaw = rec?.meta?.phase ?? null;
    } else {
      phaseRaw =
        (focusProgram?.phase && !isRegulatoryMilestoneLabel(focusProgram.phase)
          ? focusProgram.phase
          : null) ??
        rec?.meta?.phase ??
        null;
    }
  }
  if (!phaseRaw) phaseRaw = guidanceEvents[0]?.trial_phase ?? null;
  if (
    !phaseRaw &&
    !nctFocus &&
    simPhase &&
    !isRegulatoryMilestoneLabel(simPhase)
  ) {
    phaseRaw = simPhase;
  }
  const headerStatusRaw =
    rec?.meta?.overall_status || (nctFocus ? null : focusProgram?.status) || null;
  const header: ClinicalLaneHeader = {
    ticker,
    company: rec?.company?.trim() || null,
    drug,
    nctId:
      nctFocus ||
      focusProgram?.nctId?.trim() ||
      rec?.nct_id?.trim() ||
      (focusProgram ? null : clinicalNctFromSimRow(sim ?? undefined)),
    phase: phaseRaw ? localizeStudyPhase(String(phaseRaw), it) : null,
    studyShort: (() => {
      const t = firstSegment(rec?.meta?.brief_title, 160);
      if (!t || /daily\s+news\s+eis/i.test(t)) return null;
      return t;
    })(),
    condition,
    enrollment: focusProgram?.enrollment ?? rec?.meta?.enrollment ?? null,
    status: headerStatusRaw ? localizeStudyStatus(String(headerStatusRaw), it) : null,
    studyDesign: firstToken(rec?.meta?.study_design, 72),
    startDate: rec?.meta?.start_date ? normalizeCompletionDateForKey(rec.meta.start_date) : null,
    primaryCompletion: rec?.meta?.primary_completion_date
      ? normalizeCompletionDateForKey(rec.meta.primary_completion_date)
      : null,
    studyCompletion:
      normalizeCompletionDateForKey(rec?.meta?.completion_date) ||
      normalizeCompletionDateForKey(rec?.completion_date) ||
      (nctFocus ? cdOk : null) ||
      null,
  };

  const markers: ClinicalLaneMarker[] = [];
  const topologyBlobs: string[] = [String(phaseRaw ?? "")];

  const clinicalSourceRecords = nctFocus
    ? rec
      ? [rec]
      : []
    : productScoped
      ? programRecords
      : rec
        ? [rec]
        : [];
  for (const sourceRec of clinicalSourceRecords) {
    const events = [
      ...recordEvents(sourceRec),
      ...buildSyntheticTimelineEvents(sourceRec, it ? "it" : "en"),
    ];
    for (const ev of events) {
      const kind = String(ev.event_type ?? ev.source_type ?? "");
      if (kind === "ctgov" || kind === "sec_8k") continue;
      if (kind === "cd_milestone") {
        const studyEnd = studyEndMsFromRecord(sourceRec);
        const evMs = parseLaneDateMs(ev.event_date);
        if (
          studyEnd != null &&
          evMs != null &&
          Math.abs(studyEnd - evMs) > 45 * MS_DAY
        ) {
          continue;
        }
      }
      const blob = [ev.event_title, ev.summary, ev.impact_note, kind].filter(Boolean).join(" ");
      topologyBlobs.push(blob);
      const stage = classifyDevPathStage(blob, kind, phaseRaw);
      if (!stage) continue;
      const start = parseLaneDateMs(ev.expected_window_start) ?? parseLaneDateMs(ev.event_date);
      const end = parseLaneDateMs(ev.expected_window_end);
      const plotMs0 = start ?? end;
      if (plotMs0 == null) continue;
      const confirmed = String(ev.confirmation_status ?? "").toLowerCase() === "confirmed";
      if (stage === "designation" && (!confirmed || plotMs0 > todayMs)) continue;
      const monthGuess =
        kind === "cd_milestone" || kind === "cd" || !confirmed || isInferredEvent(ev);
      const timed = refineMarkerTiming(
        blob,
        stage,
        plotMs0,
        clinicalCertainty(ev, plotMs0, todayMs),
        start,
        end,
        monthGuess,
      );
      const rawTitle = clinicalEventTitle(ev, it);
      markers.push({
        id: `clin-${markers.length}-${ev.event_date ?? timed.plotMs}-${stage}`,
        kind: "clinical",
        certainty: timed.certainty,
        plotMs: timed.plotMs,
        windowStartMs: timed.windowStartMs,
        windowEndMs: timed.windowEndMs,
        title: stageMarkerTitle(stage, rawTitle, it),
        subtitle: fmtLaneDate(timed.plotMs, it, timed.monthImputed),
        detail: String(ev.summary ?? ev.impact_note ?? "").trim(),
        stageId: stage,
        dateClass: dateClassFor(stage, kind),
        monthImputed: timed.monthImputed,
      });
    }
  }

  for (const sourceRec of clinicalSourceRecords) {
    pushStudyFrameMarkers(sourceRec, it, todayMs, markers);
  }

  const simCdMs = parseLaneDateMs(cdOk);
  const simNct = clinicalNctFromSimRow(sim ?? undefined);
  const studyPrimaryIso = rec?.meta?.primary_completion_date
    ? normalizeCompletionDateForKey(rec.meta.primary_completion_date)
    : null;
  const studyCompleteIso =
    normalizeCompletionDateForKey(rec?.meta?.completion_date) ||
    normalizeCompletionDateForKey(rec?.completion_date) ||
    null;
  const studyEndMs = studyEndMsFromRecord(rec);
  const simCdConflictsWithStudy =
    !nctFocus &&
    simCdMs != null &&
    studyEndMs != null &&
    Math.abs(simCdMs - studyEndMs) > 45 * MS_DAY;
  const simCdForFocus =
    Boolean(cdOk) &&
    !simCdConflictsWithStudy &&
    (Boolean(nctFocus) ||
      !focusProgram ||
      !multiProgram ||
      (Boolean(simNct) &&
        Boolean(focusProgram.nctId) &&
        simNct!.toUpperCase() === focusProgram.nctId!.toUpperCase()) ||
      cdOk === studyPrimaryIso ||
      cdOk === studyCompleteIso);
  if (simCdMs != null && simCdForFocus) {
    const already = markers.some(
      (m) => m.dateClass === "study_cd" && Math.abs(m.plotMs - simCdMs) < 20 * MS_DAY,
    );
    if (!already) {
      const timed = refineMarkerTiming(
        "study cd primary completion",
        "readout",
        simCdMs,
        simCdMs > todayMs ? "expected" : "occurred",
        simCdMs,
        null,
        true,
      );
      markers.push({
        id: `cd-${cdOk}-${markers.length}`,
        kind: "clinical",
        certainty: timed.certainty,
        plotMs: timed.plotMs,
        windowStartMs: timed.windowStartMs,
        windowEndMs: timed.windowEndMs,
        title: "Readout Study",
        subtitle: fmtLaneDate(timed.plotMs, it, timed.monthImputed),
        detail: it ? "Completion Date del foglio Simulation (CT.gov)" : "Simulation sheet Completion Date (CT.gov)",
        stageId: "readout",
        dateClass: "study_cd",
        monthImputed: timed.monthImputed,
      });
    }
  }

  for (const ev of guidanceEvents) {
    const blob = [ev.event_type, ev.asset_name, ev.timing_quote, ev.indication].filter(Boolean).join(" ");
    topologyBlobs.push(blob);
    const stage = classifyDevPathStage(blob, ev.event_type, ev.trial_phase ?? phaseRaw);
    if (!stage) continue;
    const start = parseLaneDateMs(ev.window_start ?? ev.sim_cd_date);
    const end = parseLaneDateMs(ev.window_end);
    const plotMs0 = start ?? end;
    if (plotMs0 == null) continue;
    if (stage === "designation" && plotMs0 > todayMs - 1) continue;
    const timed = refineMarkerTiming(
      blob,
      stage,
      plotMs0,
      guidanceCertainty(ev),
      start,
      end,
      true,
    );
    const asset = firstToken(ev.asset_name, 24);
    markers.push({
      id: `guid-${markers.length}-${stage}-${ev.window_start ?? timed.plotMs}`,
      kind: "clinical",
      certainty: timed.certainty,
      plotMs: timed.plotMs,
      windowStartMs: timed.windowStartMs,
      windowEndMs: timed.windowEndMs,
      title: clip(`${devPathStageLabel(stage, it)}${asset ? ` · ${asset}` : ""}`, 42),
      subtitle: fmtLaneDate(timed.plotMs, it, timed.monthImputed),
      detail: ev.timing_quote ?? "",
      stageId: stage,
      dateClass: dateClassFor(stage, String(ev.event_type ?? "")),
      monthImputed: timed.monthImputed,
    });
  }

  inferFdaClockFromSubmission(markers, guidanceEvents, it);

  // Per-study Development Path: skip company EIS market markers (ticker noise).
  if (!nctFocus) {
    const eis = buildTickerEisDetail(ticker, it ? "it" : "en", opts.clinicalKpi, records, cdOk);
    const siblingIds = programs.map((p) => p.id);
    const marketCandidates: { ev: TickerEisEventDetail; move: { pct: number; horizon: "1d" | "3d" } }[] =
      [];
    for (const ev of eis.events) {
      const plotMs = parseLaneDateMs(ev.eventDate);
      if (plotMs == null) continue;
      const move = marketMove(ev);
      if (!move) continue;
      if (focusProgram && multiProgram && !eisMatchesProgram(ev, focusProgram, siblingIds)) continue;
      marketCandidates.push({ ev, move });
    }
    marketCandidates.sort((a, b) => Math.abs(b.move.pct) - Math.abs(a.move.pct));
    for (const { ev, move } of marketCandidates.slice(0, MAX_MARKET)) {
      const plotMs = parseLaneDateMs(ev.eventDate)!;
      const sign = move.pct >= 0 ? "+" : "";
      const horizon = it
        ? move.horizon === "1d"
          ? "1g"
          : "3g"
        : move.horizon;
      markers.push({
        id: `mkt-${ev.eventDate}-${ev.title}`,
        kind: "market",
        certainty: "occurred",
        plotMs,
        windowStartMs: null,
        windowEndMs: null,
        title: `${sign}${move.pct.toFixed(0)}% · ${horizon}`,
        subtitle: `${fmtShort(plotMs, it)}${ev.impactNote ? ` · ${clip(ev.impactNote, 40)}` : ""}`,
        detail: ev.summary ?? ev.title,
      });
    }
  }

  const clinicalAll = dedupeMarkers(markers.filter((m) => m.kind === "clinical")).sort(
    (a, b) => a.plotMs - b.plotMs,
  );
  /** Prefer upcoming / near-term markers so a 12m forward Gantt is not filled with ancient CDs. */
  const nearFloor = todayMs - 21 * MS_DAY;
  const clinicalNear = clinicalAll.filter((m) => m.plotMs >= nearFloor);
  const clinicalPast = clinicalAll.filter((m) => m.plotMs < nearFloor);
  const clinicalAnchorsNear = clinicalNear.filter(
    (m) =>
      m.dateClass === "study_cd" ||
      m.dateClass === "study_end" ||
      /^study start$|^avvio studio$/i.test(m.title),
  );
  const clinicalRestNear = clinicalNear.filter((m) => !clinicalAnchorsNear.includes(m));
  /** Keep recent past study-CD / readout anchors so path-strip dates stay on the Gantt. */
  const clinicalAnchorsPast = clinicalPast
    .filter(
      (m) =>
        m.dateClass === "study_cd" ||
        m.dateClass === "study_end" ||
        m.stageId === "readout",
    )
    .sort((a, b) => b.plotMs - a.plotMs)
    .slice(0, 4);
  const clinicalPastRest = clinicalPast.filter((m) => !clinicalAnchorsPast.includes(m));
  const nearBudget = Math.max(
    0,
    MAX_CLINICAL - clinicalAnchorsNear.length - clinicalAnchorsPast.length,
  );
  const nearPicked = clinicalRestNear.slice(0, nearBudget);
  const pastBudget = Math.max(
    0,
    MAX_CLINICAL -
      clinicalAnchorsNear.length -
      clinicalAnchorsPast.length -
      nearPicked.length,
  );
  const clinical = [
    ...clinicalAnchorsNear,
    ...clinicalAnchorsPast,
    ...nearPicked,
    ...clinicalPastRest.slice(-pastBudget),
  ].sort((a, b) => a.plotMs - b.plotMs);
  const market = dedupeMarkers(markers.filter((m) => m.kind === "market")).sort(
    (a, b) => a.plotMs - b.plotMs,
  );
  const all = [...clinical, ...market].sort((a, b) => a.plotMs - b.plotMs);
  if (
    !all.length &&
    !rec &&
    !(opts.guidanceEvents ?? []).length &&
    !cdOk &&
    !simNct
  ) {
    return null;
  }

  const axis = opts.axisOverride
    ? {
        start: opts.axisOverride.startMs,
        end: Math.max(opts.axisOverride.endMs, opts.axisOverride.startMs + MS_DAY),
      }
    : (() => {
        const fwd = forwardHorizonAxis(todayMs, PRODUCT_CATALYST_HORIZON_MONTHS);
        return { start: fwd.startMs, end: fwd.endMs };
      })();
  const firstUpcoming = all
    .filter((m) => isPathGateMarker(m) && m.certainty !== "occurred" && m.plotMs > todayMs)
    .sort((a, b) => {
      const cd = Number(a.dateClass === "study_cd") - Number(b.dateClass === "study_cd");
      if (cd !== 0) return -cd;
      return a.plotMs - b.plotMs;
    })[0];
  const timingProximityDays =
    firstUpcoming != null ? Math.round((firstUpcoming.plotMs - todayMs) / MS_DAY) : null;
  const timingProximityUncertain = Boolean(
    firstUpcoming &&
      (firstUpcoming.monthImputed ||
        firstUpcoming.certainty === "inferred" ||
        firstUpcoming.dateClass === "study_cd"),
  );
  const topologyBlob = topologyBlobs.join(" ");
  const pathTopology: DevPathTopology = detectAcceleratedDevPath(
    phaseRaw,
    all.filter((m) => m.kind === "clinical"),
    topologyBlob,
  )
    ? "accelerated"
    : "serial";
  const pathStages = buildPathStages(phaseRaw, clinical, it, todayMs, pathTopology);
  const confirmatoryPhase3 =
    pathTopology === "accelerated" ? buildConfirmatoryPhase3(clinical, it, todayMs) : null;
  const pathNote = buildPathNote(header, pathStages, firstUpcoming, pathTopology, it);
  const studyFrameNote = buildStudyFrameNote(header, it);

  const axisExpanded = expandAxisForPathDates(
    { startMs: axis.start, endMs: axis.end },
    pathStages,
    todayMs,
  );

  return {
    header,
    markers: all,
    todayMs,
    axisStartMs: axisExpanded.startMs,
    axisEndMs: axisExpanded.endMs,
    firstUpcomingMs: firstUpcoming?.plotMs ?? null,
    timingProximityDays,
    timingProximityUncertain,
    pathTopology,
    pathStages,
    confirmatoryPhase3,
    pathNote,
    studyFrameNote,
  };
}

/**
 * Main deep-dive screen: all company products — catalysts in the next 30 days.
 * If none fall in 30d (typical for watchlist / CD-monitor tickers), expand to 1 year.
 * Color encodes development stage of the product; label encodes catalyst type.
 */
export function buildCompanyCatalystHorizon(opts: {
  ticker: string;
  completionDate?: string | null;
  records?: ClinicalPreCdRecord[] | null;
  guidanceEvents?: GuidanceCalendarEvent[] | null;
  sdsRow?: SdsRow | null;
  clinicalKpi?: number | null;
  lang?: "it" | "en";
  nowMs?: number;
  simRow?: Record<string, unknown> | null;
  /** Force a fixed window; omit to allow 30d → 365d fallback when empty. */
  horizonDays?: number;
}): CompanyCatalystHorizonModel | null {
  const it = opts.lang === "it";
  const ticker = opts.ticker.trim().toUpperCase();
  if (!ticker) return null;
  const todayMs = opts.nowMs ?? Date.now();
  const programs = listTopClinicalPrograms({
    ticker,
    records: opts.records,
    guidanceEvents: opts.guidanceEvents,
    simRow: opts.simRow,
    completionDate: opts.completionDate,
    limit: 20,
  });

  const collectItems = (axis: { startMs: number; endMs: number }) => {
    const items: CompanyHorizonCatalyst[] = [];
    const seen = new Set<string>();
    for (const program of programs) {
      const lane = buildClinicalDevelopmentLane({
        ticker,
        completionDate: opts.completionDate,
        records: opts.records,
        guidanceEvents: opts.guidanceEvents,
        sdsRow: opts.sdsRow,
        clinicalKpi: opts.clinicalKpi,
        simRow: opts.simRow,
        lang: opts.lang,
        nowMs: todayMs,
        programId: program.id,
        axisOverride: axis,
      });
      if (!lane) continue;
      const color = programIdentityColor(program.id);
      const phaseLbl = program.phase ? localizeStudyPhase(String(program.phase), it) : null;
      for (const m of lane.markers) {
        if (m.kind !== "clinical") continue;
        if (m.plotMs < todayMs - MS_DAY || m.plotMs > axis.endMs) continue;
        const dedupe = `${program.id}|${m.stageId ?? m.title}|${Math.round(m.plotMs / MS_DAY)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const catalystType = m.stageId
          ? devPathStageLabel(m.stageId, it)
          : clip(m.title, 24);
        items.push({
          id: `${program.id}-${m.id}`,
          programId: program.id,
          drug: program.drug,
          phase: phaseLbl,
          phaseRank: program.phaseRank,
          color,
          stageId: m.stageId ?? null,
          catalystType,
          plotMs: m.plotMs,
          title: clip(`${catalystType} · ${program.drug}`, 40),
          certainty: m.certainty,
          nctId: program.nctId,
        });
      }
    }
    items.sort((a, b) => a.plotMs - b.plotMs || a.drug.localeCompare(b.drug));
    return items;
  };

  const forced = opts.horizonDays != null && Number.isFinite(opts.horizonDays);
  let horizonDays = forced
    ? Math.max(1, Math.round(opts.horizonDays!))
    : COMPANY_CATALYST_HORIZON_DAYS;
  let axis = companyHorizonAxis(todayMs, horizonDays);
  let items = programs.length ? collectItems(axis) : [];

  if (!forced && items.length === 0) {
    horizonDays = COMPANY_CATALYST_FALLBACK_DAYS;
    axis = companyHorizonAxis(todayMs, horizonDays);
    items = programs.length ? collectItems(axis) : [];
  }

  return {
    ticker,
    todayMs,
    axisStartMs: axis.startMs,
    axisEndMs: axis.endMs,
    horizonDays,
    items,
    programs,
  };
}

export type LaneAxisTick = { ms: number; year: number; quarter: number };

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime();
}

function startOfMonthMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0).getTime();
}

export function laneAxisTicks(startMs: number, endMs: number): LaneAxisTick[] {
  const out: LaneAxisTick[] = [];
  const span = Math.max(1, endMs - startMs);
  const last = endMs + 2 * MS_DAY;
  const push = (ms: number) => {
    if (ms < startMs - 2 * MS_DAY || ms > last) return;
    const d = new Date(ms);
    out.push({ ms, year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 });
  };
  if (span <= 18 * MS_DAY) {
    let cur = startOfDayMs(startMs);
    while (cur <= last && out.length < 20) {
      push(cur);
      cur += MS_DAY;
    }
    return out;
  }
  if (span <= 55 * MS_DAY) {
    let cur = startOfDayMs(startMs);
    while (cur <= last && out.length < 16) {
      push(cur);
      cur += 7 * MS_DAY;
    }
    return out;
  }
  if (span <= 400 * MS_DAY) {
    let cur = startOfMonthMs(startMs);
    while (cur <= last && out.length < 16) {
      push(cur);
      cur = addMonthsMs(cur, 1);
    }
    return out;
  }
  let cur = startOfQuarterMs(startMs);
  while (cur <= last && out.length < 16) {
    push(cur);
    cur = addMonthsMs(cur, 3);
  }
  return out;
}

/** Horizontal packing for the Evaluation deep-dive timeline (scroll, don't overwrite). */
export const LANE_LABEL_GAP_PX = 22;
export const LANE_MIN_PX_PER_QUARTER = 188;
export const LANE_MAX_PLOT_W = 5600;
export const LANE_MAX_CLINICAL_LEVELS = 8;
export const LANE_MAX_MARKET_LEVELS = 4;
export const LANE_BLOCK_H = 40;
export const LANE_CHART_LEFT = 108;
export const LANE_CHART_RIGHT = 36;
export const LANE_CHART_TOP = 22;
export const LANE_CHART_BOTTOM = 36;
/** Fitted SVG must stay inside the card — unbounded width was an OOM risk. */
export const LANE_FIT_VIEWPORT_MIN_PX = 320;
export const LANE_FIT_VIEWPORT_MAX_PX = 2200;
export const LANE_SVG_H_MAX = 640;
/** Must match the SVG clip in ClinicalDevelopmentLaneChart. */
export const LANE_TITLE_CHARS = 28;
export const LANE_SUBTITLE_CHARS = 32;

export function estimateLaneLabelWidthPx(title: string, subtitle: string): number {
  const titleN = Math.min(LANE_TITLE_CHARS, String(title ?? "").trim().length);
  const subN = Math.min(LANE_SUBTITLE_CHARS, String(subtitle ?? "").trim().length);
  const titleW = Math.round(12 + titleN * 6.7);
  const subW = Math.round(10 + subN * 5.0);
  return Math.min(220, Math.max(72, titleW, subW));
}

export function lanePackPriority(m: {
  dateClass?: ClinicalLaneMarker["dateClass"];
  kind?: LaneKind;
  certainty?: LaneCertainty;
  stageId?: DevPathStageId | null;
}): number {
  if (m.dateClass === "study_cd" || m.dateClass === "study_end") return 0;
  if (m.kind === "market") return 1;
  if (m.certainty === "occurred") return 2;
  if (m.stageId === "congress") return 3;
  if (m.certainty === "expected") return 4;
  return 5;
}

export function assignLaneLevelsByPx(
  items: { id: string; x: number; widthPx: number; priority?: number }[],
  maxLevels: number,
): { levels: Map<string, number>; hidden: Set<string>; used: number; overflow: boolean } {
  const sorted = [...items].sort(
    (a, b) => a.x - b.x || (a.priority ?? 9) - (b.priority ?? 9) || a.id.localeCompare(b.id),
  );
  const rightEdge: number[] = [];
  const levels = new Map<string, number>();
  const hidden = new Set<string>();
  let overflow = false;
  for (const it of sorted) {
    let lane = 0;
    while (lane < rightEdge.length && it.x < rightEdge[lane]! + LANE_LABEL_GAP_PX) {
      lane += 1;
    }
    if (lane >= maxLevels) {
      overflow = true;
      hidden.add(it.id);
      continue;
    }
    if (lane === rightEdge.length) rightEdge.push(Number.NEGATIVE_INFINITY);
    rightEdge[lane] = Math.max(rightEdge[lane] ?? Number.NEGATIVE_INFINITY, it.x + it.widthPx);
    levels.set(it.id, lane);
  }
  return { levels, hidden, used: Math.max(rightEdge.length, 1), overflow };
}

function xOnPlot(ms: number, startMs: number, endMs: number, plotW: number): number {
  const span = Math.max(1, endMs - startMs);
  return ((ms - startMs) / span) * plotW;
}

export function resolveLanePlotWidth(
  axisStartMs: number,
  axisEndMs: number,
  clinical: { id: string; plotMs: number; widthPx: number }[],
  market: { id: string; plotMs: number; widthPx: number }[],
): number {
  const span = Math.max(1, axisEndMs - axisStartMs);
  const quarters = span / (MS_DAY * 91.25);
  const minW = Math.max(720, Math.ceil(quarters * LANE_MIN_PX_PER_QUARTER));
  const packedFloor = Math.max(
    clinical.length * 72,
    market.length * 72,
    minW,
  );
  const fits = (width: number) => {
    const cx = (ms: number) => xOnPlot(ms, axisStartMs, axisEndMs, width);
    const c = assignLaneLevelsByPx(
      clinical.map((m) => ({ id: m.id, x: cx(m.plotMs), widthPx: m.widthPx })),
      LANE_MAX_CLINICAL_LEVELS,
    );
    const mk = assignLaneLevelsByPx(
      market.map((m) => ({ id: m.id, x: cx(m.plotMs), widthPx: m.widthPx })),
      LANE_MAX_MARKET_LEVELS,
    );
    return !c.overflow && !mk.overflow;
  };
  if (fits(minW)) return minW;
  let hi = Math.min(LANE_MAX_PLOT_W, Math.max(packedFloor * 1.15, minW * 1.5));
  while (hi < LANE_MAX_PLOT_W && !fits(hi)) {
    hi = Math.min(LANE_MAX_PLOT_W, Math.round(hi * 1.28));
  }
  let lo = minW;
  for (let i = 0; i < 16; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(LANE_MAX_PLOT_W, Math.max(minW, hi));
}

export type ClinicalLaneChartLayout = {
  svgW: number;
  svgH: number;
  left: number;
  plotW: number;
  midY: number;
  todayX: number;
  plotTop: number;
  plotBottom: number;
  clinicalLevels: Map<string, number>;
  marketLevels: Map<string, number>;
  clinicalUsed: number;
  marketUsed: number;
  visibleMarkerIds: Set<string>;
  hiddenMarkerCount: number;
  hiddenPackedCount: number;
};

export function markerOnLaneAxis(m: ClinicalLaneMarker, startMs: number, endMs: number): boolean {
  const pad = 2 * MS_DAY;
  if (m.plotMs >= startMs - pad && m.plotMs <= endMs + pad) return true;
  if (m.windowStartMs != null && m.windowEndMs != null) {
    return m.windowEndMs >= startMs && m.windowStartMs <= endMs;
  }
  return false;
}

export function layoutClinicalDevelopmentLaneChart(
  model: ClinicalLaneModel,
  opts?: { fitViewportPx?: number | null },
): ClinicalLaneChartLayout {
  const inView = model.markers.filter((m) =>
    markerOnLaneAxis(m, model.axisStartMs, model.axisEndMs),
  );
  const clinical = inView
    .filter((m) => m.kind === "clinical")
    .map((m) => ({
      id: m.id,
      plotMs: m.plotMs,
      widthPx: estimateLaneLabelWidthPx(m.title, m.subtitle),
      priority: lanePackPriority(m),
    }));
  const market = inView
    .filter((m) => m.kind === "market")
    .map((m) => ({
      id: m.id,
      plotMs: m.plotMs,
      widthPx: estimateLaneLabelWidthPx(m.title, m.subtitle),
      priority: lanePackPriority(m),
    }));
  const fitPx = opts?.fitViewportPx;
  const extraRightFit = 32;
  const clampedFit =
    fitPx != null && fitPx > 280
      ? Math.min(LANE_FIT_VIEWPORT_MAX_PX, Math.max(LANE_FIT_VIEWPORT_MIN_PX, Math.round(fitPx)))
      : null;
  const plotW =
    clampedFit != null
      ? Math.max(240, Math.round(clampedFit - LANE_CHART_LEFT - extraRightFit))
      : resolveLanePlotWidth(model.axisStartMs, model.axisEndMs, clinical, market);
  const xAt = (ms: number) => xOnPlot(ms, model.axisStartMs, model.axisEndMs, plotW);
  const clin = assignLaneLevelsByPx(
    clinical.map((m) => ({ id: m.id, x: xAt(m.plotMs), widthPx: m.widthPx, priority: m.priority })),
    LANE_MAX_CLINICAL_LEVELS,
  );
  const mkt = assignLaneLevelsByPx(
    market.map((m) => ({ id: m.id, x: xAt(m.plotMs), widthPx: m.widthPx, priority: m.priority })),
    LANE_MAX_MARKET_LEVELS,
  );
  const extraRight =
    clampedFit != null
      ? extraRightFit
      : Math.max(
          LANE_CHART_RIGHT,
          ...clinical.map((m) => m.widthPx + 12),
          ...market.map((m) => m.widthPx + 12),
          96,
        );
  const clinicalUsed = Math.max(clin.used, 1);
  const marketUsed = Math.max(mkt.used, 1);
  const midY = LANE_CHART_TOP + clinicalUsed * LANE_BLOCK_H + 14;
  const svgH = Math.min(
    LANE_SVG_H_MAX,
    midY + marketUsed * LANE_BLOCK_H + 18 + LANE_CHART_BOTTOM,
  );
  const visible = inView.filter((m) =>
    m.kind === "clinical" ? clin.levels.has(m.id) : mkt.levels.has(m.id),
  );
  const hiddenPackedCount = clin.hidden.size + mkt.hidden.size;
  const hiddenOffAxis = Math.max(0, model.markers.length - inView.length);
  const rawW = LANE_CHART_LEFT + plotW + extraRight;
  const svgW =
    clampedFit != null
      ? Math.min(LANE_FIT_VIEWPORT_MAX_PX, rawW)
      : Math.min(LANE_MAX_PLOT_W + 240, rawW);
  return {
    svgW,
    svgH,
    left: LANE_CHART_LEFT,
    plotW,
    midY,
    todayX: LANE_CHART_LEFT + xAt(model.todayMs),
    plotTop: 16,
    plotBottom: svgH - LANE_CHART_BOTTOM + 4,
    clinicalLevels: clin.levels,
    marketLevels: mkt.levels,
    clinicalUsed,
    marketUsed,
    visibleMarkerIds: new Set(visible.map((m) => m.id)),
    hiddenMarkerCount: hiddenOffAxis + hiddenPackedCount,
    hiddenPackedCount,
  };
}
