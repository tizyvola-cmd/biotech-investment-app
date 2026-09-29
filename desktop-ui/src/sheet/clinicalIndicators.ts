import type { ClinicalOutcomeMeasure, ClinicalStudyIndicator } from "../api/supernova";
import { nctClinicalTrialsUrl } from "./cellLinks";
import { normalizeExternalHref } from "./k8ChartLinks";

const EFFICACY_LABEL_RE =
  /orr|pfs|os\b|dcr|cbr|crr|response|survival|endpoint|hazard|efficacy|esito studio|time in range|\btir\b|510\s*\(\s*k\s*\)|pma\b|de novo|clearance|non-inferior|weight loss|hemoglobin|glucose control|aid algorithm|omnipod/i;

const CONTEXT_LABEL_RE =
  /reclutamento|status studio|recruiting|enrolling|screen failure|patients enrolled/i;

const ND = new Set(["n/d", "nd", "—", "-", ""]);

export function indicatorIsEfficacy(ind: ClinicalStudyIndicator): boolean {
  if (ind.kpi_type === "efficacy") return true;
  return EFFICACY_LABEL_RE.test(ind.label ?? "");
}

export function indicatorIsContextOnly(ind: ClinicalStudyIndicator): boolean {
  if (indicatorIsEfficacy(ind)) return false;
  const kt = ind.kpi_type;
  if (kt === "efficacy" || kt === "safety" || kt === "regulatory" || kt === "biomarker") return false;
  if (ind.endpoint_met != null) return false;
  return CONTEXT_LABEL_RE.test(ind.label ?? "");
}

export function indicatorIsOutcome(ind: ClinicalStudyIndicator): boolean {
  if (indicatorIsEfficacy(ind)) return true;
  const kt = ind.kpi_type;
  if (kt === "efficacy" || kt === "safety" || kt === "regulatory" || kt === "biomarker") return true;
  if (ind.endpoint_met != null) return true;
  if (CONTEXT_LABEL_RE.test(ind.label ?? "")) return false;
  return true;
}

export function cleanClinicalIndicators(list: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  return list.filter((i) => {
    const v = (i.value ?? "").trim();
    return v && !ND.has(v.toLowerCase());
  });
}

/** Accept only real calendar dates; drop placeholders like ``2025-NA-NA``. */
export function normalizeIndicatorDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || ND.has(s.toLowerCase())) return null;
  if (/NA|XX|\?\?/i.test(s)) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const mo = dmy[2]!.padStart(2, "0");
    const y = dmy[3]!;
    return normalizeIndicatorDate(`${y}-${mo}-${day}`);
  }
  return null;
}

/** Prefer a valid own date; else stamp ``fallback``; clear garbage placeholders. */
export function stampIndicatorDate(
  ind: ClinicalStudyIndicator,
  fallback?: string | null,
): ClinicalStudyIndicator {
  const own = normalizeIndicatorDate(ind.indicator_date);
  if (own) {
    return own === ind.indicator_date ? ind : { ...ind, indicator_date: own };
  }
  const fb = normalizeIndicatorDate(fallback);
  if (fb) return { ...ind, indicator_date: fb };
  if (ind.indicator_date) return { ...ind, indicator_date: null };
  return ind;
}

export function dedupeClinicalIndicators(items: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  const byKey = new Map<string, ClinicalStudyIndicator>();
  for (const ind of items) {
    const stamped = stampIndicatorDate(ind);
    const key = `${stamped.label ?? ""}|${stamped.value ?? ""}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, stamped);
      continue;
    }
    // Prefer the copy that carries a publication / readout date.
    const prevDated = Boolean(normalizeIndicatorDate(prev.indicator_date));
    const nextDated = Boolean(normalizeIndicatorDate(stamped.indicator_date));
    if (nextDated && !prevDated) {
      byKey.set(key, stamped);
      continue;
    }
    // Prefer a copy that still has the original article / registry URL.
    const prevLinked = Boolean(String(prev.link ?? "").trim());
    const nextLinked = Boolean(String(stamped.link ?? "").trim());
    if (nextLinked && !prevLinked) byKey.set(key, stamped);
  }
  return [...byKey.values()];
}

/**
 * Resolve a clickable href for a clinical KPI chip (article, PubMed, DOI, or CT.gov).
 */
export function resolveClinicalIndicatorHref(
  ind: ClinicalStudyIndicator,
  opts?: { nctId?: string | null },
): string | null {
  const raw = String(ind.link ?? "").trim();
  if (raw) {
    const http = normalizeExternalHref(raw);
    if (http) return http;
    if (/^10\.\d{4,}\//.test(raw)) return `https://doi.org/${raw}`;
    const pmid = raw.match(/^(?:PMID[:\s]*)?(\d{5,9})$/i)?.[1];
    if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
    const nctFromLink = nctClinicalTrialsUrl(raw.replace(/^NCT\s+/i, "NCT"));
    if (nctFromLink) return nctFromLink;
  }
  const src = `${ind.source ?? ""} ${ind.publication_venue ?? ""}`.toLowerCase();
  if (/ctgov|clinical[\s_-]?trials/.test(src) && opts?.nctId) {
    return nctClinicalTrialsUrl(opts.nctId);
  }
  return null;
}

export function prioritizeClinicalIndicators(items: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  const outcome = items.filter(indicatorIsOutcome);
  const context = items.filter(indicatorIsContextOnly);
  return [...outcome, ...context];
}

export function prepareClinicalIndicators(
  items: ClinicalStudyIndicator[] | undefined | null,
): ClinicalStudyIndicator[] {
  if (!items?.length) return [];
  return prioritizeClinicalIndicators(
    dedupeClinicalIndicators(cleanClinicalIndicators(items)),
  );
}

/** Stable key for feed dedupe (label + value). */
export function clinicalIndicatorDedupeKey(ind: ClinicalStudyIndicator): string {
  const label = String(ind.label ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const value = String(ind.value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${label}|${value}`;
}

/** Study-level outcome rollup — show once in the ticker / study header. */
export function studyIndicatorsForFeedHeader(
  studyIndicators: ClinicalStudyIndicator[] | null | undefined,
): ClinicalStudyIndicator[] {
  const study = cleanClinicalIndicators(studyIndicators ?? []);
  const outcomes = study.filter(indicatorIsOutcome);
  if (!outcomes.length) return [];
  return dedupeClinicalIndicators(prioritizeClinicalIndicators(outcomes)).slice(0, 4);
}

/**
 * KPIs for one feed news/CD row: event-local only.
 * Drops study-rollup copies stamped onto every press unless indicator_date matches the event.
 * Optionally skips keys already shown in the header or earlier rows.
 */
export function indicatorsForFeedEvent(
  ev: {
    event_date?: string | null;
    indicators?: ClinicalStudyIndicator[] | null;
  },
  studyIndicators: ClinicalStudyIndicator[] | null | undefined,
  opts?: { alreadyShownKeys?: ReadonlySet<string> },
): ClinicalStudyIndicator[] {
  const local = cleanClinicalIndicators(ev.indicators ?? []);
  if (!local.length) return [];

  const studyKeys = new Set(
    cleanClinicalIndicators(studyIndicators ?? []).map(clinicalIndicatorDedupeKey),
  );
  const evDate = normalizeIndicatorDate(ev.event_date);

  const relevant = local.filter((ind) => {
    const idate = normalizeIndicatorDate(ind.indicator_date);
    if (evDate && idate && idate === evDate) return true;
    return !studyKeys.has(clinicalIndicatorDedupeKey(ind));
  });
  if (!relevant.length) return [];

  const outcomes = relevant.filter(indicatorIsOutcome);
  let picked = outcomes.length
    ? dedupeClinicalIndicators(prioritizeClinicalIndicators(relevant)).slice(0, 4)
    : dedupeClinicalIndicators(prioritizeClinicalIndicators(relevant)).slice(0, 2);

  const shown = opts?.alreadyShownKeys;
  if (shown?.size) {
    picked = picked.filter((ind) => !shown.has(clinicalIndicatorDedupeKey(ind)));
  }
  return picked;
}

export function markClinicalIndicatorsShown(
  shown: Set<string>,
  inds: ClinicalStudyIndicator[],
): void {
  for (const ind of inds) shown.add(clinicalIndicatorDedupeKey(ind));
}

const GENERIC_ENDPOINT_LABEL_RE =
  /^(endpoint primario|primary endpoint|endpoint secondar(?:io|i|y|ies)?|secondary endpoints?|endpoint p|endpoint)(?:\s*\([^)]*\))?$/i;

export function isGenericClinicalEndpointLabel(label: string | null | undefined): boolean {
  return GENERIC_ENDPOINT_LABEL_RE.test(String(label ?? "").trim());
}

function outcomeMeasureValuesBlob(om: ClinicalOutcomeMeasure): string {
  return (om.values ?? []).join(" ").toLowerCase();
}

function indicatorValueMatchesOutcome(
  value: string | null | undefined,
  om: ClinicalOutcomeMeasure,
): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || ND.has(raw)) return false;
  const blob = outcomeMeasureValuesBlob(om);
  if (!blob) return false;
  const core = raw.replace(/,/g, "");
  if (blob.includes(core)) return true;
  const num = /^[-+]?\d+(?:\.\d+)?/.exec(core);
  if (!num) return false;
  const n = num[0];
  return (
    blob === n ||
    blob.startsWith(`${n}/`) ||
    blob.startsWith(`${n} `) ||
    blob.includes(` ${n}/`) ||
    blob.includes(`: ${n}`) ||
    blob.includes(`:${n}`)
  );
}

function studyNoteFromMeasure(om: ClinicalOutcomeMeasure): string {
  return [String(om.description ?? "").trim(), String(om.time_frame ?? "").trim()]
    .filter(Boolean)
    .join(" · ");
}

const OTHER_OUTCOME_TYPE = /other|exploratory|tertiary|post[- ]hoc/i;
const PRIMARY_OUTCOME_TYPE = /primary/i;
const SECONDARY_OUTCOME_TYPE = /secondary/i;

function outcomeMeasureRank(om: ClinicalOutcomeMeasure): number {
  const t = String(om.type ?? "");
  if (PRIMARY_OUTCOME_TYPE.test(t)) return 0;
  if (SECONDARY_OUTCOME_TYPE.test(t)) return 1;
  if (OTHER_OUTCOME_TYPE.test(t)) return 9;
  return 2;
}

/** Primary + first secondary only — drop exploratory / other CT.gov readouts. */
export function selectStudyReadoutMeasures(
  measures: ClinicalOutcomeMeasure[] | undefined | null,
  max = 2,
): ClinicalOutcomeMeasure[] {
  const oms = (measures ?? []).filter((m) => String(m.title ?? "").trim());
  const primaryAndSecondary = oms.filter((m) => outcomeMeasureRank(m) <= 1);
  const pool = primaryAndSecondary.length
    ? primaryAndSecondary
    : oms.filter((m) => outcomeMeasureRank(m) < 9);
  return [...pool]
    .sort((a, b) => outcomeMeasureRank(a) - outcomeMeasureRank(b))
    .slice(0, Math.max(0, max));
}

/**
 * Bind KPI chips to the CT.gov study-page measures (title + description).
 * Generic "Primary endpoint" labels are replaced; numeric leftovers from another
 * NCT are dropped when this study already lists its own outcomes.
 */
export function indicatorsForStudyDisplay(
  indicators: ClinicalStudyIndicator[] | undefined | null,
  measures: ClinicalOutcomeMeasure[] | undefined | null,
  opts?: { nctId?: string | null },
): ClinicalStudyIndicator[] {
  const inds = indicators ?? [];
  const oms = selectStudyReadoutMeasures(measures, 2);
  const ctgovHref = opts?.nctId ? nctClinicalTrialsUrl(opts.nctId) : null;
  if (!oms.length) {
    return inds
      .filter((ind) => !isGenericClinicalEndpointLabel(ind.label))
      .map((ind) =>
        ind.link?.trim() || !ctgovHref || !/ctgov|clinical[\s_-]?trials/i.test(`${ind.source ?? ""}`)
          ? ind
          : { ...ind, link: ctgovHref },
      );
  }

  const usedInd = new Set<number>();
  const fromOm: ClinicalStudyIndicator[] = oms.map((om) => {
    const title = String(om.title ?? "").trim();
    const matchIdx = inds.findIndex(
      (ind, i) => !usedInd.has(i) && indicatorValueMatchesOutcome(ind.value, om),
    );
    const matched = matchIdx >= 0 ? inds[matchIdx] : null;
    if (matchIdx >= 0) usedInd.add(matchIdx);
    const value =
      (matched?.value && !ND.has(matched.value.trim().toLowerCase())
        ? matched.value
        : null) ||
      (om.values && om.values[0]) ||
      om.time_frame ||
      "planned";
    const note = [matched?.trend_note?.trim(), studyNoteFromMeasure(om)]
      .filter(Boolean)
      .join(" ");
    return {
      ...(matched ?? {}),
      label: title,
      value,
      kpi_type:
        matched?.kpi_type ||
        (/adverse|safety|\bae\b/i.test(title) ? "safety" : "efficacy"),
      trend_note: note || null,
      source: matched?.source || "ctgov",
      link: matched?.link || ctgovHref || null,
    };
  });

  const extras = inds.filter((ind, i) => {
    if (usedInd.has(i)) return false;
    if (isGenericClinicalEndpointLabel(ind.label)) return false;
    const kt = String(ind.kpi_type ?? "");
    if (kt === "safety" || kt === "enrollment") return true;
    if (kt === "efficacy" || kt === "biomarker" || indicatorIsEfficacy(ind)) return false;
    return true;
  });

  return [...fromOm, ...extras];
}

function isPlaceholderIndicatorValue(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  if (!v || ND.has(v.toLowerCase())) return true;
  if (/^n\/?a(?:\s*[±+\-]\s*n\/?a)?$/i.test(v)) return true;
  if (/^planned$/i.test(v)) return true;
  return false;
}

export function indicatorIsSafety(ind: ClinicalStudyIndicator): boolean {
  if (ind.kpi_type === "safety") return true;
  return /adverse|eventi avversi|\bsae\b|\bae\b|sicurezza|grade\s*≥?\s*3|grado\s*≥?\s*3/i.test(
    ind.label ?? "",
  );
}

export type ClinicalLaneLine = {
  label: string;
  value: string;
};

export type ClinicalEfficacySafetySummary = {
  efficacy: ClinicalLaneLine | null;
  safety: ClinicalLaneLine | null;
  extraEfficacy: number;
  extraSafety: number;
};

function shortenClinicalLabel(label: string, max = 44): string {
  const raw = label.replace(/\s+/g, " ").trim();
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

function pickLaneIndicator(
  items: ClinicalStudyIndicator[],
  rank: (ind: ClinicalStudyIndicator) => number,
): ClinicalStudyIndicator | null {
  if (!items.length) return null;
  const usable = items.filter((i) => !isPlaceholderIndicatorValue(i.value));
  const pool = usable.length ? usable : items;
  return [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

function rankEfficacy(ind: ClinicalStudyIndicator): number {
  let n = 0;
  if (!isPlaceholderIndicatorValue(ind.value)) n += 2;
  if (ind.endpoint_met === true) n += 2;
  if (ind.numeric_value != null && Number.isFinite(ind.numeric_value)) n += 1;
  if (!isGenericClinicalEndpointLabel(ind.label)) n += 1;
  return n;
}

function rankSafety(ind: ClinicalStudyIndicator): number {
  const lab = (ind.label ?? "").toLowerCase();
  let n = 0;
  if (/sae|serious/.test(lab)) n += 3;
  else if (/grado|grade\s*≥?\s*3|deaths|decessi/.test(lab)) n += 2;
  else n += 1;
  if (!isPlaceholderIndicatorValue(ind.value)) n += 1;
  return n;
}

function laneLineFromIndicator(ind: ClinicalStudyIndicator, it: boolean): ClinicalLaneLine {
  return {
    label: shortenClinicalLabel(localizeClinicalIndicatorLabel(ind.label ?? "", it)),
    value: localizeClinicalIndicatorValue(ind.value ?? "", it).trim() || "—",
  };
}

/** One EFF line + one SAF line for the study card — no endpoint dump. */
export function summarizeClinicalEfficacySafety(
  indicators: ClinicalStudyIndicator[] | undefined | null,
  it: boolean,
): ClinicalEfficacySafetySummary {
  const prepared = prepareClinicalIndicators(indicators ?? []);
  const efficacyItems = prepared.filter(
    (i) => i.kpi_type === "efficacy" || indicatorIsEfficacy(i),
  );
  const safetyItems = prepared.filter(indicatorIsSafety);
  const effPick = pickLaneIndicator(efficacyItems, rankEfficacy);
  const safPick = pickLaneIndicator(safetyItems, rankSafety);
  return {
    efficacy: effPick ? laneLineFromIndicator(effPick, it) : null,
    safety: safPick ? laneLineFromIndicator(safPick, it) : null,
    extraEfficacy: Math.max(0, efficacyItems.length - (effPick ? 1 : 0)),
    extraSafety: Math.max(0, safetyItems.length - (safPick ? 1 : 0)),
  };
}

export const CLINICAL_KPI_TYPE_LABEL: Record<string, string> = {
  efficacy: "EFF",
  safety: "SAF",
  enrollment: "ENR",
  biomarker: "BIO",
  regulatory: "REG",
  other: "",
};

/** Feed chips are stored in Italian; map both ways so the UI language is clean. */
const INDICATOR_LABEL_IT_EN: [string, string][] = [
  ["Esito studio", "Study outcome"],
  ["Endpoint primario", "Primary endpoint"],
  ["Endpoint secondari", "Secondary endpoints"],
  ["Endpoint", "Endpoint"],
  ["Reclutamento (CT.gov)", "Enrollment (CT.gov)"],
  ["Reclutamento", "Enrollment"],
  ["AE grado≥3", "Grade ≥3 AE"],
  ["AE grado ≥ 3", "Grade ≥3 AE"],
  ["AE grado≥ 3", "Grade ≥3 AE"],
  ["Decessi in studio", "On-study deaths"],
  ["Sicurezza", "Safety"],
  ["Eventi avversi", "Adverse events"],
  ["Status studio", "Study status"],
];

const VALUE_IT_EN: [string, string][] = [
  ["in corso", "ongoing"],
  ["pianificato", "planned"],
  ["successo", "success"],
  ["fallimento", "failure"],
  ["in attesa", "pending"],
  ["n.d.", "unknown"],
  ["n/d", "n/a"],
  ["migliore", "better"],
  ["peggiore", "worse"],
  ["simile", "similar"],
  ["confrontabile", "comparable"],
  ["in reclutamento", "recruiting"],
  ["non ancora in reclutamento", "not yet recruiting"],
  ["in reclutamento su invito", "enrolling by invitation"],
  ["attivo, non in reclutamento", "active, not recruiting"],
  ["completato", "completed"],
  ["interrotto", "terminated"],
  ["ritirato", "withdrawn"],
  ["sospeso", "suspended"],
  ["da definire", "tbd"],
];

const KPI_TYPE_IT: Record<string, string> = {
  efficacy: "Efficacia",
  safety: "Sicurezza",
  enrollment: "Reclutamento",
  biomarker: "Biomarcatore",
  regulatory: "Regolatorio",
  other: "Altro",
};

function normPhrase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[_/,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/grado\s*≥\s*3/g, "grado≥3");
}

function lookupPair(pairs: [string, string][], raw: string, toEn: boolean): string | null {
  const key = normPhrase(raw);
  for (const [itLabel, enLabel] of pairs) {
    if (normPhrase(itLabel) === key) return toEn ? enLabel : itLabel;
    if (normPhrase(enLabel) === key) return toEn ? enLabel : itLabel;
  }
  return null;
}

export function localizeClinicalIndicatorLabel(label: string, it: boolean): string {
  const raw = label.trim();
  if (!raw) return raw;
  const localized = lookupPair(INDICATOR_LABEL_IT_EN, raw, !it) ?? raw;
  return expandClinicalAcronymsInLabel(localized, it);
}

export function localizeClinicalIndicatorValue(value: string, it: boolean): string {
  const raw = value.trim();
  if (!raw) return raw;
  return lookupPair(VALUE_IT_EN, raw, !it) ?? raw;
}

export function localizeStudyPhase(phase: string, it: boolean): string {
  const raw = phase.trim();
  if (!raw) return raw;
  const n = raw.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const combo = /^phase\s*([1-4])\s*\/\s*(?:phase\s*)?([1-4])$/i.exec(n);
  if (combo) {
    return it ? `Fase ${combo[1]}/${combo[2]}` : `Phase ${combo[1]}/${combo[2]}`;
  }
  const m = /^(early\s+)?phase\s*([1-4])([ab])?$/i.exec(n);
  if (m) {
    const early = m[1] ? (it ? "Precoce " : "Early ") : "";
    const ab = m[3] ? m[3].toUpperCase() : "";
    return it ? `${early}Fase ${m[2]}${ab}` : `${early}Phase ${m[2]}${ab}`;
  }
  return raw;
}

/** CT.gov overall_status / chip values such as RECRUITING, ACTIVE_NOT_RECRUITING. */
export function localizeStudyStatus(status: string, it: boolean): string {
  const raw = status.trim();
  if (!raw) return raw;
  const spaced = raw.replace(/_/g, " ");
  const localized = lookupPair(VALUE_IT_EN, spaced, !it);
  if (localized) {
    return it ? localized : localized.replace(/^\w/, (c) => c.toUpperCase());
  }
  return spaced.replace(/_/g, " ");
}

export function localizeClinicalKpiType(kpiType: string | null | undefined, it: boolean): string {
  const key = String(kpiType ?? "").trim().toLowerCase();
  if (!key) return "";
  if (it) return KPI_TYPE_IT[key] ?? key;
  const en: Record<string, string> = {
    efficacy: "Efficacy",
    safety: "Safety",
    enrollment: "Enrollment",
    biomarker: "Biomarker",
    regulatory: "Regulatory",
    other: "Other",
  };
  return en[key] ?? key;
}

/** High-contrast badge classes per KPI type (feed table + chips). */
export function clinicalKpiBadgeClass(kpiType: string | null | undefined): string {
  switch (kpiType) {
    case "efficacy":
      return "bg-emerald-100 text-emerald-900 border border-emerald-300/80 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-600/50";
    case "safety":
      return "bg-amber-100 text-amber-950 border border-amber-300/80 dark:bg-amber-950/45 dark:text-amber-100 dark:border-amber-600/50";
    case "enrollment":
      return "bg-sky-100 text-sky-950 border border-sky-300/80 dark:bg-sky-950/45 dark:text-sky-100 dark:border-sky-600/50";
    case "biomarker":
      return "bg-violet-100 text-violet-950 border border-violet-300/80 dark:bg-violet-950/45 dark:text-violet-100 dark:border-violet-600/50";
    case "regulatory":
      return "bg-slate-200 text-slate-900 border border-slate-400/70 dark:bg-slate-700 dark:text-slate-50 dark:border-slate-500/70";
    default:
      return "bg-[rgb(var(--surface-2))] text-ink border border-[rgb(var(--border))]/60";
  }
}

export function directionGlyph(dir: ClinicalStudyIndicator["direction"]): string {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  if (dir === "flat") return "→";
  return "";
}

export function directionColor(dir: ClinicalStudyIndicator["direction"]): string {
  if (dir === "up") return "rgb(var(--signal-up))";
  if (dir === "down") return "rgb(var(--signal-down))";
  if (dir === "flat") return "rgb(var(--signal-neutral))";
  return "rgb(var(--panel-mint-ink-muted))";
}

/** Plain-language gloss of what the CT.gov / feed endpoint measures. */
const ENDPOINT_GLOSS: { re: RegExp; it: string; en: string; kind: "specific" | "role" | "change" }[] = [
  {
    re: /\becv\b|extracellular volume/i,
    kind: "specific",
    it: "ECV (extracellular volume): frazione di tessuto non cellulare (spesso miocardio in MRI); un calo suggerisce meno edema/fibrosi.",
    en: "ECV (extracellular volume): share of tissue that is not cells (often myocardium on MRI); a drop usually means less edema/fibrosis.",
  },
  {
    re: /\bgls\b|global longitudinal strain/i,
    kind: "specific",
    it: "GLS (global longitudinal strain): deformazione longitudinale del ventricolo sinistro in eco; misura sensibile della funzione sistolica (valori più negativi = migliore contrazione).",
    en: "GLS (global longitudinal strain): how much the left ventricle shortens lengthwise on echo; a sensitive systolic-function readout (more negative usually = better contraction).",
  },
  {
    re: /\blv\s*mass\b|left ventric\w*\s+mass|massa del ventricolo/i,
    kind: "specific",
    it: "LV mass (massa del ventricolo sinistro): peso/volume del muscolo del ventricolo sinistro; un calo può indicare rimodellamento favorevole.",
    en: "LV mass (left ventricular mass): weight/volume of left-ventricle muscle; a drop can signal favorable remodeling.",
  },
  {
    re: /\blvef\b|left ventric\w*\s+ejection|frazione di eiezione/i,
    kind: "specific",
    it: "LVEF (left ventricular ejection fraction): percentuale di sangue espulsa dal ventricolo sinistro a ogni battito.",
    en: "LVEF (left ventricular ejection fraction): percent of blood the left ventricle pumps out each beat.",
  },
  {
    re: /\bnt-?probnp\b|bnp\b/i,
    kind: "specific",
    it: "NT-proBNP/BNP: peptide natriuretico; marker di stress/scompenso cardiaco (più basso di solito meglio).",
    en: "NT-proBNP/BNP: natriuretic peptide; a heart-failure / wall-stress marker (lower is usually better).",
  },
  {
    re: /\bhs-?crp\b|\bcrp\b|c-reactive/i,
    kind: "specific",
    it: "CRP/hs-CRP: proteina C-reattiva; marker di infiammazione sistemica.",
    en: "CRP/hs-CRP: C-reactive protein; a systemic inflammation marker.",
  },
  {
    re: /\btrop(?:onin)?\b|hs-?tnt|hs-?tni/i,
    kind: "specific",
    it: "Troponina: proteina di danno miocardico; un rialzo segnala lesione delle cellule cardiache.",
    en: "Troponin: myocardial injury protein; a rise signals heart-muscle cell damage.",
  },
  {
    re: /\beasi\b/i,
    kind: "specific",
    it: "EASI: score di estensione/gravità della dermatite atopica (più basso = pelle migliore).",
    en: "EASI: eczema area and severity index (lower = clearer skin).",
  },
  {
    re: /\biga\b|investigator.?global.?assessment/i,
    kind: "specific",
    it: "IGA: valutazione globale dello sperimentatore sulla gravità di malattia cutanea.",
    en: "IGA: investigator global assessment of skin-disease severity.",
  },
  {
    re: /\bpas[iı]\b|psoriasis area/i,
    kind: "specific",
    it: "PASI: score di area e severità della psoriasi (più basso = meno malattia).",
    en: "PASI: psoriasis area and severity index (lower = less disease).",
  },
  {
    re: /\bacr\s*20|acr\s*50|acr\s*70\b/i,
    kind: "specific",
    it: "ACR20/50/70: risposta composita in artrite reumatoide (≥20/50/70% di miglioramento).",
    en: "ACR20/50/70: composite rheumatoid-arthritis response (≥20/50/70% improvement).",
  },
  {
    re: /\bfev1\b|forced expir|percent predict/i,
    kind: "specific",
    it: "Funzione polmonare (FEV1, % del predetto): quanto aria il paziente riesce a espirare rispetto a un basale sano.",
    en: "Lung function (FEV1, % predicted): how much air the patient can blow out versus a healthy baseline.",
  },
  {
    re: /\bfvc\b|forced vital/i,
    kind: "specific",
    it: "Capacità vitale forzata (FVC): volume d’aria espirata dopo un respiro massimo.",
    en: "Forced vital capacity (FVC): volume of air exhaled after a full breath.",
  },
  {
    re: /\borr\b|overall response|tasso di risposta/i,
    kind: "specific",
    it: "ORR (overall response rate): quota di pazienti con riduzione misurabile del tumore.",
    en: "ORR (overall response rate): share of patients with a measurable tumor shrinkage.",
  },
  {
    re: /\bpfs\b|progression[- ]free/i,
    kind: "specific",
    it: "PFS (progression-free survival): tempo senza progressione di malattia.",
    en: "PFS (progression-free survival): time without disease progression.",
  },
  {
    re: /\bos\b|overall survival|sopravvivenza globale/i,
    kind: "specific",
    it: "OS (overall survival): sopravvivenza globale dalla randomizzazione.",
    en: "OS (overall survival): overall survival from randomization.",
  },
  {
    re: /\bdor\b|duration of response/i,
    kind: "specific",
    it: "DoR (duration of response): quanto dura la risposta tumorale nei responder.",
    en: "DoR (duration of response): how long tumor responses last in responders.",
  },
  {
    re: /\bcr\b|complete response|risposta completa/i,
    kind: "specific",
    it: "CR (complete response): scomparsa apparente della malattia misurabile.",
    en: "CR (complete response): apparent disappearance of measurable disease.",
  },
  {
    re: /\bpr\b|partial response|risposta parziale/i,
    kind: "specific",
    it: "PR (partial response): riduzione parziale ma clinicamente rilevante del tumore.",
    en: "PR (partial response): partial but clinically meaningful tumor shrinkage.",
  },
  {
    re: /\bsae\b|serious adverse/i,
    kind: "specific",
    it: "SAE (serious adverse event): evento avverso grave (ospedalizzazione, pericolo di vita, ecc.).",
    en: "SAE (serious adverse event): a serious side effect (hospitalization, life-threatening, etc.).",
  },
  {
    re: /\bteae\b|treatment[- ]emergent/i,
    kind: "specific",
    it: "TEAE: evento avverso emerso durante il trattamento.",
    en: "TEAE: treatment-emergent adverse event (side effect starting on drug).",
  },
  {
    re: /\bmadr?s\b|hamilton.*depress|phq[- ]?9|relapse of depress/i,
    kind: "specific",
    it: "Scala di depressione (sintomi depressivi rispetto al basale o al rischio di ricaduta).",
    en: "Depression scale (symptom burden vs baseline, or time to depressive relapse).",
  },
  {
    re: /pain freedom|headache pain|most bothersome symptom|migraine/i,
    kind: "specific",
    it: "Esito sull’attacco di emicrania: libertà dal dolore e/o dal sintomo più fastidioso.",
    en: "Migraine-attack outcome: freedom from headache pain and/or the most bothersome symptom.",
  },
  {
    re: /haemoptysis|hemoptysis/i,
    kind: "specific",
    it: "Sicurezza: episodi di emottisi (sangue nell’espettorato) tra i trattati.",
    en: "Safety: coughing up blood (hemoptysis) among treated patients.",
  },
  {
    re: /\bcough\b|tosse/i,
    kind: "specific",
    it: "Sicurezza: tosse segnalata come evento avverso.",
    en: "Safety: cough reported as an adverse event.",
  },
  {
    re: /adverse event|\beventi avversi\b|\bae\b|grado\s*≥?\s*3/i,
    kind: "specific",
    it: "Dato di sicurezza: frequenza di questo effetto collaterale nei pazienti trattati.",
    en: "Safety finding: how often this side effect occurred in treated patients.",
  },
  {
    re: /reclutamento|patients enrolled|enrollment/i,
    kind: "specific",
    it: "Avanzamento del reclutamento nello studio.",
    en: "How far enrollment has progressed in the trial.",
  },
  {
    re: /change from baseline/i,
    kind: "change",
    it: "Variazione rispetto al valore misurato all’inizio dello studio.",
    en: "Change versus the value measured at the start of the trial.",
  },
  {
    re: /duration for which participants received|duration of (treatment|infusion|intraven)|received intraven/i,
    kind: "specific",
    it: "Quanto a lungo i partecipanti sono rimasti in trattamento (spesso infusione endovenosa).",
    en: "How long participants stayed on treatment (often an intravenous infusion).",
  },
  {
    re: /primary endpoint|endpoint primario/i,
    kind: "role",
    it: "Endpoint primario: il criterio di efficacia su cui lo studio è dimensionato.",
    en: "Primary endpoint: the efficacy criterion the trial was powered to prove.",
  },
  {
    re: /secondary endpoint|endpoint secondar/i,
    kind: "role",
    it: "Endpoint secondario: misura di supporto, non il test statistico principale.",
    en: "Secondary endpoint: a supportive measure, not the main statistical test.",
  },
];

/**
 * Clinical readout acronyms → full name (for labels).
 * Longer tokens first so "NT-proBNP" wins over "BNP".
 */
const CLINICAL_ACRONYM_FULL: { re: RegExp; fullEn: string; fullIt: string }[] = [
  { re: /\bNT-?proBNP\b/gi, fullEn: "N-terminal pro–B-type natriuretic peptide", fullIt: "peptide natriuretico N-terminale pro-BNP" },
  { re: /\bhs-?CRP\b/gi, fullEn: "high-sensitivity C-reactive protein", fullIt: "proteina C-reattiva ad alta sensibilità" },
  { re: /\bhs-?Tn[IT]\b/gi, fullEn: "high-sensitivity troponin", fullIt: "troponina ad alta sensibilità" },
  { re: /\bLVEF\b/gi, fullEn: "left ventricular ejection fraction", fullIt: "frazione di eiezione del ventricolo sinistro" },
  { re: /\bECV\b/gi, fullEn: "extracellular volume", fullIt: "volume extracellulare" },
  { re: /\bGLS\b/gi, fullEn: "global longitudinal strain", fullIt: "strain longitudinale globale" },
  { re: /\bFEV1\b/gi, fullEn: "forced expiratory volume in 1 second", fullIt: "volume espiratorio forzato in 1 secondo" },
  { re: /\bFVC\b/gi, fullEn: "forced vital capacity", fullIt: "capacità vitale forzata" },
  { re: /\bORR\b/gi, fullEn: "overall response rate", fullIt: "tasso di risposta globale" },
  { re: /\bPFS\b/gi, fullEn: "progression-free survival", fullIt: "sopravvivenza libera da progressione" },
  { re: /\bDoR\b/gi, fullEn: "duration of response", fullIt: "durata della risposta" },
  { re: /\bEASI\b/gi, fullEn: "Eczema Area and Severity Index", fullIt: "indice di area e severità dell’eczema" },
  { re: /\bPASI\b/gi, fullEn: "Psoriasis Area and Severity Index", fullIt: "indice di area e severità della psoriasi" },
  { re: /\bIGA\b/gi, fullEn: "Investigator Global Assessment", fullIt: "valutazione globale dello sperimentatore" },
  { re: /\bSAE\b/gi, fullEn: "serious adverse event", fullIt: "evento avverso grave" },
  { re: /\bTEAE\b/gi, fullEn: "treatment-emergent adverse event", fullIt: "evento avverso emerso in trattamento" },
  { re: /\bBNP\b/gi, fullEn: "B-type natriuretic peptide", fullIt: "peptide natriuretico di tipo B" },
  { re: /\bCRP\b/gi, fullEn: "C-reactive protein", fullIt: "proteina C-reattiva" },
  { re: /\bOS\b/gi, fullEn: "overall survival", fullIt: "sopravvivenza globale" },
  { re: /\bLV\b/gi, fullEn: "left ventricular", fullIt: "ventricolo sinistro / left ventricular" },
];

/** Expand known clinical acronyms in a label: ``ECV`` → ``ECV (extracellular volume)``. */
export function expandClinicalAcronymsInLabel(label: string, it = false): string {
  let out = label.trim();
  if (!out) return out;
  for (const row of CLINICAL_ACRONYM_FULL) {
    const full = it ? row.fullIt : row.fullEn;
    if (out.toLowerCase().includes(full.toLowerCase())) continue;
    out = out.replace(row.re, (match, offset: number, whole: string) => {
      const after = whole.slice(offset + match.length);
      // Skip only when the full name is already written right after the token.
      const m = /^\s*(?:—|-|\()\s*([^)]{3,90})/.exec(after);
      if (m) {
        const inside = m[1].toLowerCase();
        const f = full.toLowerCase();
        if (inside.includes(f.slice(0, Math.min(14, f.length))) || f.includes(inside.slice(0, Math.min(14, inside.length)))) {
          return match;
        }
      }
      return `${match} (${full})`;
    });
  }
  return out;
}

function glossBucketsFromLabel(
  label: string,
  it: boolean,
): { specific: string[]; role: string[]; change: string[] } {
  const raw = label.trim();
  const specific: string[] = [];
  const role: string[] = [];
  const change: string[] = [];
  if (!raw) return { specific, role, change };
  for (const row of ENDPOINT_GLOSS) {
    if (!row.re.test(raw)) continue;
    const text = it ? row.it : row.en;
    const bucket =
      row.kind === "role" ? role : row.kind === "change" ? change : specific;
    if (bucket.includes(text)) continue;
    bucket.push(text);
  }
  return { specific, role, change };
}

function resultReading(ind: ClinicalStudyIndicator, it: boolean): string {
  const bits: string[] = [];
  if (ind.endpoint_met === true) {
    bits.push(it ? "Endpoint raggiunto." : "Endpoint met.");
  } else if (ind.endpoint_met === false) {
    bits.push(it ? "Endpoint mancato." : "Endpoint missed.");
  }
  if (ind.direction === "flat") {
    bits.push(
      it
        ? "Risultato sostanzialmente nullo: nessun spostamento clinico rilevante."
        : "Result essentially unchanged: no meaningful clinical shift.",
    );
  } else if (ind.direction === "up") {
    bits.push(it ? "Segnale in miglioramento." : "Improving signal.");
  } else if (ind.direction === "down") {
    bits.push(it ? "Segnale in peggioramento." : "Worsening signal.");
  }
  const n = ind.n_patients;
  if (n != null && Number.isFinite(n) && n > 0) {
    bits.push(it ? `Casistica n=${n}.` : `Sample n=${n}.`);
  }
  const unit = String(ind.unit ?? "").trim();
  const value = String(ind.value ?? "").trim();
  if (unit && value && !value.includes(unit) && !/adverse event/i.test(ind.label ?? "")) {
    bits.push(it ? `Unità: ${unit}.` : `Unit: ${unit}.`);
  }
  return bits.join(" ");
}

/**
 * Visible clinical reading for an indicator card — not the KPI score.
 * Prefers the feed ``trend_note``; always tries to expand what the acronym /
 * readout means so cards are readable without domain jargon.
 */
export function describeClinicalIndicator(
  ind: ClinicalStudyIndicator,
  it: boolean,
): string {
  const note = String(ind.trend_note ?? "").trim();
  const rawLabel = String(ind.label ?? "").trim();
  const label = localizeClinicalIndicatorLabel(rawLabel, it);
  const studyPageNote = note && !/^[+\-]?kpi\b/i.test(note) ? note.replace(/\s+/g, " ") : "";
  const hasStudyPageNote = studyPageNote.length >= 24;
  // Include the note text so acronyms buried in AI/trend notes (e.g. ORR) get a readout gloss.
  const buckets = glossBucketsFromLabel(`${label} ${rawLabel} ${studyPageNote}`, it);
  const reading = resultReading(ind, it);
  const parts: string[] = [];

  if (studyPageNote) parts.push(studyPageNote);

  const pushUnique = (text: string) => {
    if (!text) return;
    const already = parts.some((p) => {
      const a = p.toLowerCase();
      const g = text.toLowerCase();
      return (
        a.includes(g.slice(0, Math.min(28, g.length))) ||
        g.includes(a.slice(0, Math.min(28, a.length)))
      );
    });
    if (!already) parts.push(text);
  };

  // Measure-specific + change glosses always (ECV/GLS/ORR…), even with a long note.
  for (const g of [...buckets.specific.slice(0, 2), ...buckets.change.slice(0, 1)]) {
    pushUnique(g);
  }
  // Generic primary/secondary role only when there is no rich study-page note.
  if (!hasStudyPageNote) {
    for (const g of buckets.role.slice(0, 1)) pushUnique(g);
  }

  if (reading) parts.push(reading);
  if (parts.length) return parts.join(" ");
  if (label) {
    return it
      ? `${label}: risultato pubblicato nello studio (il punteggio KPI è solo un riassunto numerico).`
      : `${label}: result published in the study (the KPI score is only a numeric summary).`;
  }
  return it
    ? "Indicatore clinico senza descrizione della misura."
    : "Clinical indicator without a description of the measure.";
}
