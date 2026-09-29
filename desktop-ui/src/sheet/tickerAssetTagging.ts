/**
 * Read-time asset tagging for EIS events (Phase 1 slice 1).
 * Orthogonality: assetRole (cd_study / other_pipeline / corporate / unclassified)
 * vs lane clinical/regulatory — both can apply to the same event.
 */
import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import pipelineMapJson from "../config/ticker_pipeline_map.json";
import type { TickerEisEventDetail } from "./tickerEisSummary";

export type AssetRole = "cd_study" | "other_pipeline" | "corporate" | "unclassified";

export type TickerPipelineProgram = {
  assetId: string;
  name: string;
  indication?: string | null;
  phase?: string | null;
  status?: "active" | "completed" | "discontinued";
  isCdAsset?: boolean;
  nctId?: string | null;
};

export type TickerPipeline = {
  ticker: string;
  cdAssetId: string | null;
  programs: TickerPipelineProgram[];
};

export type TickerPipelineMapDoc = {
  version: number;
  tickers: Record<
    string,
    {
      cdAssetId?: string | null;
      programs?: TickerPipelineProgram[];
    }
  >;
  proposedPrograms?: Array<{
    ticker: string;
    assetId: string;
    name?: string;
    source?: string;
    notedAt?: string;
  }>;
};

export type TaggedEisFields = {
  assetId: string | null;
  assetRole: AssetRole;
};

export type ClassificationCoverage = {
  scoredEvents: number;
  unclassified: number;
  /** 1 − unclassified/scored; 1 when scoredEvents === 0. */
  coverage: number;
  /** Company Memory UI gate: coverage >= 0.80 (unclassified share < 20%). */
  companyMemoryAllowed: boolean;
};

const COMPANY_MEMORY_MAX_UNCLASSIFIED_SHARE = 0.2;

const NCT_RE = /\bNCT\d{8,}\b/i;

const CORPORATE_ASSET_MARKERS = new Set([
  "corporate",
  "sec 8-k",
  "sec 8k",
  "sec8k",
  "earnings",
  "pipeline / md&a",
  "pipeline/md&a",
]);

const AMBIGUOUS_LEAD_RE = /\b(our\s+)?lead\s+program\b/i;

export function normalizeProgramId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

/** Normalize / extract an NCT id from a free-text blob. */
export function extractNctIdFromText(...parts: Array<string | null | undefined>): string | null {
  const blob = parts.filter(Boolean).join(" ");
  if (!blob.trim()) return null;
  const m = NCT_RE.exec(blob);
  return m ? m[0]!.toUpperCase() : null;
}

export function normalizeNctId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s/g, "");
  if (!s) return null;
  const m = /^NCT\d{8,}/.exec(s) ?? NCT_RE.exec(s);
  return m ? m[0]!.toUpperCase() : null;
}

/**
 * Event-level NCT only — never silent parent-record inheritance, except CT.gov
 * synthetic rows that are definitionally the parent trial.
 */
export function resolveEventNctId(
  ev: Pick<
    ClinicalPublicationEvent,
    "nct_id" | "event_title" | "summary" | "link" | "source_type" | "event_type"
  >,
  parentRecordNct?: string | null,
): string | null {
  const fromField = normalizeNctId(ev.nct_id);
  if (fromField) return fromField;
  const fromText = extractNctIdFromText(ev.event_title, ev.summary, ev.link);
  if (fromText) return fromText;
  const st = `${ev.source_type ?? ""} ${ev.event_type ?? ""}`.toLowerCase();
  if (
    parentRecordNct &&
    (st.includes("ctgov") || st.includes("clinicaltrials.gov") || st.includes("clinicaltrials"))
  ) {
    return normalizeNctId(parentRecordNct);
  }
  return null;
}

function programMentionsNeedle(haystack: string, needleId: string, drugLabel: string): boolean {
  const h = haystack.toLowerCase();
  if (!h) return false;
  if (needleId && h.replace(/[^a-z0-9]+/g, "").includes(needleId)) return true;
  const label = drugLabel.trim().toLowerCase();
  if (label.length >= 3 && h.includes(label)) return true;
  return false;
}

function isCorporateAssetLabel(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "—" || s === "-") return false;
  if (CORPORATE_ASSET_MARKERS.has(s)) return true;
  if (/\bearnings\b|\bfinanc(e|ing)\b|\blawsuite?\b|\blitigation\b|\bpersonnel\b|\bofficer\b/.test(s)) {
    return true;
  }
  return false;
}

function isCorporateSource(ev: Pick<TickerEisEventDetail, "sourceType" | "itemsRaw" | "title" | "summary">): boolean {
  const st = (ev.sourceType ?? "").toLowerCase();
  if (st === "sec_8k" || st === "sec_10q" || st.includes("sec")) {
    const items = (ev.itemsRaw ?? "").toLowerCase();
    // Pure earnings / MD&A without program tip → corporate
    if (/\b2\.02\b/.test(items) || /\b9\.01\b/.test(items)) return true;
  }
  const blob = `${ev.title ?? ""} ${ev.summary ?? ""}`;
  if (/\bearnings\b|\bquarterly results\b|\bfinancial results\b/i.test(blob)) return true;
  return false;
}

let cachedDoc: TickerPipelineMapDoc | null = null;

export function loadTickerPipelineMapDoc(
  override?: TickerPipelineMapDoc | null,
): TickerPipelineMapDoc {
  if (override) {
    cachedDoc = override;
    return override;
  }
  if (cachedDoc) return cachedDoc;
  cachedDoc = (pipelineMapJson as TickerPipelineMapDoc) ?? { version: 1, tickers: {}, proposedPrograms: [] };
  return cachedDoc;
}

/** Test helper — reset module cache between cases. */
export function resetTickerPipelineMapCache(): void {
  cachedDoc = null;
}

export function resolveTickerPipeline(
  ticker: string,
  opts?: {
    records?: ClinicalPreCdRecord[] | null;
    mapDoc?: TickerPipelineMapDoc | null;
    cdAssetIdHint?: string | null;
  },
): TickerPipeline {
  const tk = ticker.trim().toUpperCase();
  const doc = loadTickerPipelineMapDoc(opts?.mapDoc);
  const entry = doc.tickers?.[tk];
  if (entry?.programs?.length) {
    const programs = entry.programs.map((p) => ({
      ...p,
      assetId: p.assetId || normalizeProgramId(p.name),
    }));
    const cdAssetId =
      entry.cdAssetId?.trim() ||
      programs.find((p) => p.isCdAsset)?.assetId ||
      opts?.cdAssetIdHint ||
      null;
    return { ticker: tk, cdAssetId, programs };
  }
  return buildEphemeralPipelineFromRecords(tk, opts?.records ?? [], opts?.cdAssetIdHint ?? null);
}

/** Fallback when config has no ticker entry — seed from clinical records only. */
export function buildEphemeralPipelineFromRecords(
  ticker: string,
  records: ClinicalPreCdRecord[],
  cdAssetIdHint?: string | null,
): TickerPipeline {
  const tk = ticker.trim().toUpperCase();
  const byId = new Map<string, TickerPipelineProgram>();
  for (const rec of records) {
    if (String(rec.ticker ?? "").toUpperCase() !== tk) continue;
    const drug =
      firstToken(rec.meta?.interventions) ??
      firstToken(rec.clinical_events?.[0]?.drug ?? rec.clinical_events?.[0]?.asset) ??
      (rec.nct_id ? String(rec.nct_id).trim() : null);
    if (!drug) continue;
    const assetId = normalizeProgramId(drug);
    if (!assetId || byId.has(assetId)) continue;
    byId.set(assetId, {
      assetId,
      name: drug,
      indication: firstToken(rec.meta?.conditions, 36),
      phase: rec.meta?.phase ?? rec.study_phase ?? null,
      status: "active",
      isCdAsset: false,
      nctId: rec.nct_id?.trim() || null,
    });
  }
  const programs = [...byId.values()];
  let cdAssetId = cdAssetIdHint ? normalizeProgramId(cdAssetIdHint) : null;
  if (cdAssetId && programs.some((p) => p.assetId === cdAssetId)) {
    for (const p of programs) p.isCdAsset = p.assetId === cdAssetId;
  } else if (programs.length === 1) {
    programs[0]!.isCdAsset = true;
    cdAssetId = programs[0]!.assetId;
  }
  return { ticker: tk, cdAssetId, programs };
}

function firstToken(raw: string | null | undefined, max = 48): string | null {
  const s = (raw ?? "").split(/[|;,/]/)[0]?.trim() ?? "";
  if (!s || s === "—") return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function resolveAssetId(
  ev: Pick<TickerEisEventDetail, "nctId" | "asset" | "title" | "summary" | "impactNote" | "studyTitle">,
  pipeline: TickerPipeline,
): string | null {
  if (ev.nctId) {
    const nct = normalizeNctId(ev.nctId);
    if (nct) {
      const byNct = pipeline.programs.find(
        (p) => p.nctId && normalizeNctId(p.nctId) === nct,
      );
      if (byNct) return byNct.assetId;
      // Event NCT that isn't in the pipeline yet — still a stable id
      return nct.toLowerCase();
    }
  }
  const blob = [ev.asset, ev.title, ev.summary, ev.impactNote, ev.studyTitle]
    .filter(Boolean)
    .join(" ");
  if (!blob.trim()) return null;
  for (const p of pipeline.programs) {
    if (programMentionsNeedle(blob, p.assetId, p.name)) return p.assetId;
  }
  if (ev.asset && !isCorporateAssetLabel(ev.asset)) {
    const id = normalizeProgramId(ev.asset);
    if (id && id !== "corporate" && id !== "sec8k") return id;
  }
  return null;
}

export function resolveAssetRole(
  assetId: string | null,
  pipeline: TickerPipeline,
  ev: Pick<TickerEisEventDetail, "asset" | "sourceType" | "itemsRaw" | "title" | "summary">,
): AssetRole {
  const blob = `${ev.title ?? ""} ${ev.summary ?? ""}`;
  if (AMBIGUOUS_LEAD_RE.test(blob) && !assetId) {
    return "unclassified";
  }

  if (assetId && pipeline.cdAssetId && assetId === pipeline.cdAssetId) {
    return "cd_study";
  }
  if (assetId && pipeline.programs.some((p) => p.assetId === assetId)) {
    const prog = pipeline.programs.find((p) => p.assetId === assetId);
    if (prog?.isCdAsset || (pipeline.cdAssetId && prog?.assetId === pipeline.cdAssetId)) {
      return "cd_study";
    }
    return "other_pipeline";
  }
  if (assetId && !pipeline.programs.some((p) => p.assetId === assetId)) {
    // Known-looking drug/NCT not in map → review queue
    if (assetId.startsWith("nct") || assetId.length >= 4) return "unclassified";
  }

  if (assetId == null) {
    if (isCorporateAssetLabel(ev.asset) || isCorporateSource(ev)) return "corporate";
    return "unclassified";
  }
  return "unclassified";
}

export function tagEventAssetRole(
  ev: TickerEisEventDetail,
  pipeline: TickerPipeline,
): TickerEisEventDetail & TaggedEisFields {
  const assetId = resolveAssetId(ev, pipeline);
  const assetRole = resolveAssetRole(assetId, pipeline, ev);
  return { ...ev, assetId, assetRole };
}

export function tagEventsAssetRole(
  events: TickerEisEventDetail[],
  pipeline: TickerPipeline,
): Array<TickerEisEventDetail & TaggedEisFields> {
  return events.map((ev) => tagEventAssetRole(ev, pipeline));
}

export function computeClassificationCoverage(
  events: Array<Pick<TickerEisEventDetail, "chartOnly"> & Partial<TaggedEisFields>>,
): ClassificationCoverage {
  const scored = events.filter((e) => !e.chartOnly);
  const unclassified = scored.filter((e) => e.assetRole === "unclassified").length;
  const scoredEvents = scored.length;
  const coverage = scoredEvents === 0 ? 1 : 1 - unclassified / scoredEvents;
  return {
    scoredEvents,
    unclassified,
    coverage,
    companyMemoryAllowed: scoredEvents === 0
      ? false
      : unclassified / scoredEvents < COMPANY_MEMORY_MAX_UNCLASSIFIED_SHARE,
  };
}

export const COMPANY_MEMORY_COVERAGE_THRESHOLD = 1 - COMPANY_MEMORY_MAX_UNCLASSIFIED_SHARE;
