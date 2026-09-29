/**
 * Structured study-outcome briefing for EIS deep dive.
 * One box per NCT/study: title, end date, design, patients/inclusion, EFF, SAF, sources.
 */
import type {
  ClinicalAiSummary,
  ClinicalOutcomeMeasure,
  ClinicalPreCdRecord,
  ClinicalStudyIndicator,
  StudyClinicalProfile,
} from "../api/supernova";
import { nctClinicalTrialsUrl } from "./cellLinks";
import {
  describeClinicalIndicator,
  indicatorIsEfficacy,
  indicatorIsSafety,
  indicatorsForStudyDisplay,
  isGenericClinicalEndpointLabel,
  localizeClinicalIndicatorLabel,
  prepareClinicalIndicators,
  resolveClinicalIndicatorHref,
  stampIndicatorDate,
} from "./clinicalIndicators";
import { normalizeExternalHref } from "./k8ChartLinks";
import { trustedRecordEvents } from "./referenceVerification";
import {
  clinicalRecordMatchesProduct,
  productLinkTokensFromRecord,
} from "./studyProductLink";

export type StudyOutcomeSourceLink = {
  label: string;
  href: string;
};

/** One efficacy/safety bullet with optional original-source link. */
export type StudyOutcomeDataLine = {
  label: string;
  /** Published number / result. */
  value: string;
  /** Plain-language readout description (what the endpoint means + how to read it). */
  description: string | null;
  /** CT.gov time frame when known. */
  timeFrame: string | null;
  href: string | null;
  sourceLabel: string | null;
  /** true = met, false = missed, null = unknown */
  endpointMet: boolean | null;
};

export type StudyOutcomeBriefing = {
  studyTitle: string | null;
  nctId: string | null;
  studyUrl: string | null;
  phase: string | null;
  status: string | null;
  /** Best available end / primary-completion date (ISO-ish). */
  endedDate: string | null;
  endedKind: "primary_completion" | "completion" | "cd" | "none";
  design: string | null;
  enrollment: number | null;
  patientsTarget: number | null;
  nTreatment: number | null;
  nControl: number | null;
  inclusionCriteria: string | null;
  efficacyPrimary: string | null;
  efficacySecondary: string | null;
  efficacyProse: string | null;
  safetySummary: string | null;
  aeLines: string[];
  sourceLinks: StudyOutcomeSourceLink[];
  /** Structured EFF lines (replaces chip grid). */
  efficacyLines: StudyOutcomeDataLine[];
  /** Structured SAF lines (replaces chip grid). */
  safetyLines: StudyOutcomeDataLine[];
  /** Best EIS score among feed events linked to this NCT (null if none). */
  eisScore: number | null;
  eisKpiScore: number | null;
  eisEventTitle: string | null;
  eisEventDate: string | null;
  /** @deprecated kept for tests / callers that still filter chips */
  efficacyIndicators: ClinicalStudyIndicator[];
  safetyIndicators: ClinicalStudyIndicator[];
};

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^(n\/d|nd|none|null|unknown|—|-)$/i.test(s)) return null;
  return s;
}

function cleanNum(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function formatBlinding(raw: string | null | undefined): string | null {
  const s = clean(raw)?.toLowerCase().replace(/[_-]+/g, " ");
  if (!s) return null;
  const map: Record<string, string> = {
    double: "Double-blind",
    "double blind": "Double-blind",
    single: "Single-blind",
    "single blind": "Single-blind",
    triple: "Triple-blind",
    "triple blind": "Triple-blind",
    open: "Open-label",
    "open label": "Open-label",
    none: "Open-label",
  };
  return map[s] || s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDesignFromMeta(meta: ClinicalPreCdRecord["meta"] | undefined): string | null {
  if (!meta) return null;
  const pre = clean(meta.study_design);
  if (pre) return pre;
  const parts: string[] = [];
  const masking = formatBlinding(meta.masking);
  if (masking) parts.push(masking);
  for (const key of ["allocation", "intervention_model", "primary_purpose", "study_type"] as const) {
    const raw = clean(meta[key]);
    if (!raw) continue;
    const label = raw
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (label && !parts.includes(label)) parts.push(label);
  }
  const inter = clean(meta.interventions)?.toLowerCase() ?? "";
  if (inter.includes("placebo") && !parts.some((p) => /placebo/i.test(p))) {
    parts.push("Placebo-controlled");
  }
  return parts.length ? parts.join(" · ") : null;
}

function formatDesignFromProfile(profile: StudyClinicalProfile | null): string | null {
  if (!profile) return null;
  const pre = clean(profile.study_design);
  if (pre) return pre;
  return formatBlinding(profile.blinding);
}

function pickIsoDate(...cands: Array<string | null | undefined>): string | null {
  for (const c of cands) {
    const s = clean(c);
    if (!s) continue;
    if (/^\d{4}-\d{2}/.test(s) || /^\d{4}$/.test(s) || /[A-Za-z]{3,}/.test(s)) return s.slice(0, 32);
  }
  return null;
}

function profileFromRecord(rec: ClinicalPreCdRecord): StudyClinicalProfile | null {
  const ai = rec.ai as ClinicalAiSummary | undefined;
  const p = ai?.study_clinical_profile;
  return p && typeof p === "object" ? p : null;
}

function aiFromRecord(rec: ClinicalPreCdRecord): ClinicalAiSummary | null {
  const ai = rec.ai as ClinicalAiSummary | undefined;
  return ai && typeof ai === "object" ? ai : null;
}

function pushUniqueLink(
  out: StudyOutcomeSourceLink[],
  seen: Set<string>,
  label: string,
  href: string | null | undefined,
) {
  const url = normalizeExternalHref(href);
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push({ label, href: url });
}

function indicatorsForRecord(rec: ClinicalPreCdRecord): ClinicalStudyIndicator[] {
  const all: ClinicalStudyIndicator[] = [];
  const seen = new Set<string>();
  const push = (ind: ClinicalStudyIndicator) => {
    const key = `${ind.label ?? ""}|${ind.value ?? ""}`.toLowerCase();
    if (!key || key === "|" || seen.has(key)) return;
    seen.add(key);
    all.push(ind);
  };
  for (const ind of rec.clinical_indicators ?? []) push(stampIndicatorDate(ind));
  for (const ev of trustedRecordEvents(rec)) {
    const eventLink = clean(ev.link);
    for (const ind of ev.indicators ?? []) {
      const stamped = stampIndicatorDate(ind, ev.event_date ?? null);
      push(
        stamped.link?.trim() || !eventLink ? stamped : { ...stamped, link: eventLink },
      );
    }
  }
  // Bind generic "Primary endpoint" chips to CT.gov measure titles + descriptions.
  return indicatorsForStudyDisplay(all, rec.outcome_measures, { nctId: rec.nct_id });
}

function matchOutcomeMeasure(
  ind: ClinicalStudyIndicator,
  measures: ClinicalOutcomeMeasure[] | undefined | null,
): ClinicalOutcomeMeasure | null {
  const oms = measures ?? [];
  if (!oms.length) return null;
  const lab = String(ind.label ?? "").trim().toLowerCase();
  const val = String(ind.value ?? "").trim().toLowerCase();
  for (const om of oms) {
    const title = String(om.title ?? "").trim().toLowerCase();
    if (title && lab && (title === lab || title.includes(lab) || lab.includes(title.slice(0, 28)))) {
      return om;
    }
  }
  if (isGenericClinicalEndpointLabel(ind.label)) {
    for (const om of oms) {
      const vals = (om.values ?? []).map((v) => String(v).trim().toLowerCase());
      if (val && vals.some((v) => v === val || v.includes(val) || val.includes(v))) return om;
    }
    const primary = oms.find((om) => /^primary/i.test(String(om.type ?? "")));
    if (primary) return primary;
  }
  return null;
}

function looksMostlyItalian(text: string): boolean {
  const t = text.toLowerCase();
  const hits = (
    t.match(
      /\b(la|il|lo|gli|della|delle|degli|riduzione|mancata|significativ\w*|suggerisce|potenziale|endpoint|raggiungimento|assenza|variazioni|rilevanza|favorevole|tollerabilit\w*|profilo|sicurezza|studio|pazienti|arruolat\w*|esito|ongoing)\b/gi,
    ) ?? []
  ).length;
  return hits >= 2;
}

function toDataLines(
  inds: ClinicalStudyIndicator[],
  nctId: string | null,
  measures: ClinicalOutcomeMeasure[] | undefined | null,
  it: boolean,
  max = 10,
): StudyOutcomeDataLine[] {
  const out: StudyOutcomeDataLine[] = [];
  for (const ind of inds.slice(0, max)) {
    const om = matchOutcomeMeasure(ind, measures);
    const rawLabel = clean(om?.title) || clean(ind.label) || "KPI";
    const label = localizeClinicalIndicatorLabel(rawLabel, it);
    const value = clean(ind.value);
    if (!value) continue;

    const omNote = [
      clean(om?.description),
      clean(om?.time_frame) ? `Time frame: ${clean(om?.time_frame)}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    let trend = clean(ind.trend_note);
    // Study outcome boxes are English-first: drop Italian AI notes so glosses stay EN.
    if (!it && trend && looksMostlyItalian(trend)) trend = null;
    const enriched: ClinicalStudyIndicator = {
      ...ind,
      label: rawLabel,
      trend_note: trend || omNote || null,
    };
    const description = describeClinicalIndicator(enriched, it);
    const descClean =
      description &&
      description.trim().toLowerCase() !== value.toLowerCase() &&
      !description.trim().toLowerCase().startsWith(`${value.toLowerCase()} —`)
        ? description.trim()
        : trend || clean(om?.description) || null;

    let endpointMet: boolean | null =
      ind.endpoint_met === true ? true : ind.endpoint_met === false ? false : null;
    if (endpointMet == null && om && typeof (om as { reached?: boolean }).reached === "boolean") {
      endpointMet = (om as { reached?: boolean }).reached ?? null;
    }
    // Infer miss/met from English/Italian description cues when flag missing.
    if (endpointMet == null && descClean) {
      if (
        /not\s+met|missed|failed|non\s+raggiunt|mancata significativ|mancato raggiungimento|no statistical/i.test(
          descClean,
        )
      ) {
        endpointMet = false;
      } else if (/endpoint\s+met|raggiunt|statistically significant reduction/i.test(descClean)) {
        endpointMet = true;
      }
    }

    const href = resolveClinicalIndicatorHref(enriched, { nctId });
    const sourceLabel =
      clean(ind.publication_venue) || clean(ind.source) || (href ? "source" : null);
    out.push({
      label,
      value,
      description: descClean,
      timeFrame: clean(om?.time_frame),
      href,
      sourceLabel,
      endpointMet,
    });
  }
  return out;
}

function briefingFromRecord(
  rec: ClinicalPreCdRecord,
  opts?: { preferCdDate?: string | null; it?: boolean },
): StudyOutcomeBriefing | null {
  const it = opts?.it === true;
  const profile = profileFromRecord(rec);
  const ai = aiFromRecord(rec);
  const meta = rec.meta;

  const nctId = clean(rec.nct_id);
  const studyUrl = nctId ? nctClinicalTrialsUrl(nctId) : null;
  const studyTitle = clean(meta?.brief_title);
  const design = formatDesignFromMeta(meta) || formatDesignFromProfile(profile);

  const enrollment =
    cleanNum(profile?.patients_enrolled) ??
    cleanNum(meta?.enrollment) ??
    cleanNum(rec.structured?.treated_patients);
  const patientsTarget = cleanNum(profile?.patients_target);
  const nTreatment = cleanNum(profile?.n_treatment_arm);
  const nControl = cleanNum(profile?.n_control_arm);

  const inclusionCriteria =
    clean(meta?.inclusion_criteria) ||
    clean(profile?.inclusion_criteria_summary) ||
    clean(ai?.patient_population);

  const endedDate = pickIsoDate(
    meta?.primary_completion_date,
    meta?.completion_date,
    opts?.preferCdDate,
    rec.cd_date,
    rec.completion_date,
  );
  let endedKind: StudyOutcomeBriefing["endedKind"] = "none";
  if (endedDate) {
    if (clean(meta?.primary_completion_date) === endedDate) endedKind = "primary_completion";
    else if (clean(meta?.completion_date) === endedDate) endedKind = "completion";
    else endedKind = "cd";
  }

  const peLabel = clean(profile?.primary_endpoint_label);
  const peValue = clean(profile?.primary_endpoint_value);
  let efficacyPrimary =
    peLabel && peValue
      ? `${peLabel}: ${peValue}`
      : peValue || peLabel || clean(ai?.primary_endpoint);
  let efficacySecondary = clean(profile?.secondary_endpoints_summary);
  let efficacyProse =
    clean(ai?.key_metrics) ||
    clean(profile?.vs_standard_of_care) ||
    clean(profile?.soc_comparison_note);
  let safetySummary = clean(profile?.safety_summary) || clean(ai?.safety_profile);
  if (!it) {
    if (efficacyPrimary && looksMostlyItalian(efficacyPrimary)) {
      efficacyPrimary = peLabel && peValue ? `${peLabel}: ${peValue}` : peValue || peLabel || null;
    }
    if (efficacySecondary && looksMostlyItalian(efficacySecondary)) efficacySecondary = null;
    if (efficacyProse && looksMostlyItalian(efficacyProse)) efficacyProse = null;
    if (safetySummary && looksMostlyItalian(safetySummary)) safetySummary = null;
  }
  const aeLines = (rec.ae_summary ?? [])
    .map((x) => clean(x))
    .filter((x): x is string => Boolean(x))
    .slice(0, 8);

  const prepared = prepareClinicalIndicators(indicatorsForRecord(rec));
  const efficacyIndicators = prepared.filter(
    (ind) =>
      indicatorIsEfficacy(ind) || ind.kpi_type === "efficacy" || ind.kpi_type === "biomarker",
  );
  const safetyIndicators = prepared.filter(
    (ind) => indicatorIsSafety(ind) || ind.kpi_type === "safety",
  );
  const efficacyLines = toDataLines(efficacyIndicators, nctId, rec.outcome_measures, it, 2);
  const safetyLines = toDataLines(safetyIndicators, nctId, rec.outcome_measures, it, 4);

  // Prefer AE summary lines when we have few safety KPI chips.
  if (!safetyLines.length && aeLines.length) {
    for (const line of aeLines) {
      safetyLines.push({
        label: it ? "Eventi avversi" : "Adverse events",
        value: line,
        description: it
          ? "Frequenza dell’evento avverso riportata su CT.gov (braccio trattamento vs controllo)."
          : "Adverse-event frequency reported on CT.gov (treatment vs control arm).",
        timeFrame: null,
        href: studyUrl,
        sourceLabel: "ctgov",
        endpointMet: null,
      });
    }
  }

  // Prefer structured CT.gov endpoint rows when efficacy chips are bare numbers.
  if (
    efficacyLines.length < 2 &&
    efficacyLines.every((l) => !l.description || l.description.length < 20)
  ) {
    const fromStructured = (rec.structured?.endpoint_summary ?? [])
      .filter((ep) => {
        const t = String(ep.type ?? "");
        if (/other|exploratory|tertiary|post[- ]hoc/i.test(t)) return false;
        return true;
      })
      .slice(0, 2);
    for (const ep of fromStructured) {
      const title = clean(ep.title);
      const vals = (ep.values ?? []).map((v) => clean(v)).filter(Boolean) as string[];
      if (!title || !vals.length) continue;
      const already = efficacyLines.some(
        (l) => l.label.toLowerCase().includes(title.slice(0, 20).toLowerCase()),
      );
      if (already) continue;
      if (efficacyLines.length >= 2) break;
      efficacyLines.push({
        label: title,
        value: vals.join(" · "),
        description:
          ep.reached === true
            ? it
              ? "Endpoint raggiunto secondo i risultati strutturati dello studio."
              : "Endpoint met per structured study results."
            : ep.reached === false
              ? it
                ? "Endpoint non raggiunto secondo i risultati strutturati dello studio."
                : "Endpoint not met per structured study results."
              : it
                ? "Misura di esito dallo studio (CT.gov / risultati strutturati)."
                : "Outcome measure from the study (CT.gov / structured results).",
        timeFrame: null,
        href: studyUrl,
        sourceLabel: "ctgov",
        endpointMet: ep.reached === true ? true : ep.reached === false ? false : null,
      });
    }
  }

  const sourceLinks: StudyOutcomeSourceLink[] = [];
  const seen = new Set<string>();
  if (nctId && studyUrl) pushUniqueLink(sourceLinks, seen, nctId, studyUrl);
  for (const line of [...efficacyLines, ...safetyLines]) {
    if (!line.href) continue;
    pushUniqueLink(sourceLinks, seen, line.sourceLabel || "Source", line.href);
  }
  for (const ev of trustedRecordEvents(rec)) {
    const href = normalizeExternalHref(ev.link);
    if (!href) continue;
    const label =
      clean(ev.link_label) ||
      clean(ev.source_type) ||
      clean(ev.event_type) ||
      "News / IR";
    pushUniqueLink(sourceLinks, seen, label, href);
  }
  for (const pmid of rec.pubmed_pmids ?? []) {
    const id = clean(pmid);
    if (!id) continue;
    pushUniqueLink(sourceLinks, seen, `PMID ${id}`, `https://pubmed.ncbi.nlm.nih.gov/${id}/`);
  }

  const hasBody =
    studyTitle ||
    design ||
    enrollment != null ||
    inclusionCriteria ||
    efficacyPrimary ||
    efficacySecondary ||
    efficacyProse ||
    safetySummary ||
    aeLines.length ||
    efficacyLines.length ||
    safetyLines.length ||
    sourceLinks.length ||
    nctId;

  if (!hasBody) return null;

  return {
    studyTitle,
    nctId,
    studyUrl,
    phase: clean(meta?.phase) || clean(rec.study_phase),
    status: clean(meta?.overall_status),
    endedDate,
    endedKind,
    design,
    enrollment,
    patientsTarget,
    nTreatment,
    nControl,
    inclusionCriteria,
    efficacyPrimary,
    efficacySecondary,
    efficacyProse,
    safetySummary,
    aeLines,
    sourceLinks,
    efficacyLines,
    safetyLines,
    eisScore: null,
    eisKpiScore: null,
    eisEventTitle: null,
    eisEventDate: null,
    efficacyIndicators,
    safetyIndicators,
  };
}

/**
 * One structured briefing box per study (NCT) for the ticker — primary NCT first.
 */
export function collectStudyOutcomeBriefings(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts?: {
    ticker?: string | null;
    primaryNctId?: string | null;
    /** Completing-study product — drops other company assets. */
    productName?: string | null;
    /** Extra brand / generic aliases (Gemini / patent card). */
    productAliases?: string[] | null;
    it?: boolean;
  },
): StudyOutcomeBriefing[] {
  const ticker = clean(opts?.ticker)?.toUpperCase() ?? "";
  const primaryNct = clean(opts?.primaryNctId)?.toUpperCase() ?? "";
  const it = opts?.it === true;
  let pool = (records ?? []).filter((r) => {
    if (ticker && clean(r.ticker)?.toUpperCase() !== ticker) return false;
    // Keep registry studies even when sponsor gate is soft — design/enrollment live on meta.
    if (String(r.sponsor_match ?? "").trim().toLowerCase() === "no match") return false;
    return Boolean(clean(r.nct_id) || clean(r.meta?.brief_title) || (r.clinical_indicators?.length ?? 0));
  });

  const primaryRec =
    (primaryNct
      ? pool.find((r) => clean(r.nct_id)?.toUpperCase() === primaryNct)
      : undefined) ?? pool[0];
  const productTokens = productLinkTokensFromRecord(
    opts?.productName ? null : primaryRec,
    [opts?.productName, ...(opts?.productAliases ?? [])],
  );
  if (primaryNct || productTokens.length) {
    pool = pool.filter((r) =>
      clinicalRecordMatchesProduct(r, productTokens, primaryNct || null),
    );
  }

  // Dedupe by NCT (keep richest).
  const byNct = new Map<string, ClinicalPreCdRecord>();
  const noNct: ClinicalPreCdRecord[] = [];
  for (const rec of pool) {
    const nct = clean(rec.nct_id)?.toUpperCase();
    if (!nct) {
      noNct.push(rec);
      continue;
    }
    const prev = byNct.get(nct);
    if (!prev) {
      byNct.set(nct, rec);
      continue;
    }
    const prevScore =
      (prev.clinical_indicators?.length ?? 0) +
      (prev.clinical_events?.length ?? 0) +
      (prev.ae_summary?.length ?? 0);
    const nextScore =
      (rec.clinical_indicators?.length ?? 0) +
      (rec.clinical_events?.length ?? 0) +
      (rec.ae_summary?.length ?? 0);
    if (nextScore >= prevScore) byNct.set(nct, rec);
  }

  const ordered = [...byNct.values(), ...noNct];
  ordered.sort((a, b) => {
    // Chronological: oldest completion / CD first (temporal narrative).
    const ad = pickIsoDate(a.meta?.primary_completion_date, a.cd_date, a.completion_date) ?? "9999";
    const bd = pickIsoDate(b.meta?.primary_completion_date, b.cd_date, b.completion_date) ?? "9999";
    if (ad !== bd) return ad.localeCompare(bd);
    const an = clean(a.nct_id)?.toUpperCase() ?? "";
    const bn = clean(b.nct_id)?.toUpperCase() ?? "";
    if (primaryNct) {
      if (an === primaryNct && bn !== primaryNct) return -1;
      if (bn === primaryNct && an !== primaryNct) return 1;
    }
    return an.localeCompare(bn);
  });

  const out: StudyOutcomeBriefing[] = [];
  for (const rec of ordered) {
    const b = briefingFromRecord(rec, { it });
    if (b) out.push(b);
  }
  return out;
}

/** Merge live CT.gov protocol fields into a study box (design / inclusion / N / dates). */
export function mergeStudyOutcomeWithCtgovMeta(
  briefing: StudyOutcomeBriefing,
  meta: {
    brief_title?: string;
    study_design?: string;
    inclusion_criteria?: string;
    enrollment?: number | null;
    arm_count?: number | null;
    overall_status?: string;
    phase?: string;
    primary_completion_date?: string;
    completion_date?: string;
    interventions?: string;
    masking?: string;
    allocation?: string;
    intervention_model?: string;
    primary_purpose?: string;
    study_type?: string;
  } | null | undefined,
): StudyOutcomeBriefing {
  if (!meta) return briefing;
  const design =
    clean(briefing.design) ||
    clean(meta.study_design) ||
    formatDesignFromMeta({
      study_design: meta.study_design,
      masking: meta.masking,
      allocation: meta.allocation,
      intervention_model: meta.intervention_model,
      primary_purpose: meta.primary_purpose,
      study_type: meta.study_type,
      interventions: meta.interventions,
    });
  let designWithArms = design;
  if (meta.arm_count != null && meta.arm_count > 0 && designWithArms) {
    const armsLabel =
      meta.arm_count === 1
        ? "1 arm"
        : meta.arm_count === 2
          ? "2 arms"
          : meta.arm_count === 3
            ? "3 arms"
            : `${meta.arm_count} arms`;
    if (!/\d+\s*arms?/i.test(designWithArms)) {
      designWithArms = `${designWithArms} · ${armsLabel}`;
    }
  } else if (!designWithArms && meta.arm_count != null && meta.arm_count > 0) {
    designWithArms = `${meta.arm_count} arms`;
  }

  const endedDate =
    briefing.endedDate ||
    pickIsoDate(meta.primary_completion_date, meta.completion_date);
  let endedKind = briefing.endedKind;
  if (!briefing.endedDate && endedDate) {
    endedKind =
      clean(meta.primary_completion_date) === endedDate
        ? "primary_completion"
        : clean(meta.completion_date) === endedDate
          ? "completion"
          : "cd";
  }

  return {
    ...briefing,
    studyTitle: briefing.studyTitle || clean(meta.brief_title),
    design: designWithArms,
    inclusionCriteria: briefing.inclusionCriteria || clean(meta.inclusion_criteria),
    enrollment: briefing.enrollment ?? cleanNum(meta.enrollment),
    status: briefing.status || clean(meta.overall_status),
    phase: briefing.phase || clean(meta.phase),
    endedDate,
    endedKind,
  };
}

/**
 * When feed/EIS props rebuild `base`, keep CT.gov fills already shown in the box
 * so inclusion / design / N do not flash to "Not extracted" between refetches.
 */
export function preserveStudyOutcomeCtgovFills(
  next: StudyOutcomeBriefing[],
  prev: StudyOutcomeBriefing[],
): StudyOutcomeBriefing[] {
  if (!prev.length) return next;
  const prevByNct = new Map<string, StudyOutcomeBriefing>();
  for (const p of prev) {
    const nct = clean(p.nctId)?.toUpperCase();
    if (nct) prevByNct.set(nct, p);
  }
  return next.map((b) => {
    const nct = clean(b.nctId)?.toUpperCase();
    const p = nct ? prevByNct.get(nct) : undefined;
    if (!p) return b;
    const endedDate = b.endedDate || p.endedDate;
    return {
      ...b,
      studyTitle: b.studyTitle || p.studyTitle,
      design: b.design || p.design,
      inclusionCriteria: b.inclusionCriteria || p.inclusionCriteria,
      enrollment: b.enrollment ?? p.enrollment,
      status: b.status || p.status,
      phase: b.phase || p.phase,
      endedDate,
      endedKind: b.endedDate
        ? b.endedKind
        : endedDate && !b.endedDate
          ? p.endedKind
          : b.endedKind,
    };
  });
}

/** @deprecated use collectStudyOutcomeBriefings — returns the primary study only. */
export function collectStudyOutcomeBriefing(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts?: {
    ticker?: string | null;
    nctId?: string | null;
    studyTitle?: string | null;
    studyUrl?: string | null;
    cdDate?: string | null;
    indicators?: ClinicalStudyIndicator[] | null;
  },
): StudyOutcomeBriefing | null {
  const list = collectStudyOutcomeBriefings(records, {
    ticker: opts?.ticker,
    primaryNctId: opts?.nctId,
  });
  if (list.length) return list[0]!;
  // Fallback when no records but caller passed rollup indicators / title.
  if (!opts?.indicators?.length && !opts?.studyTitle) return null;
  const nctId = clean(opts?.nctId);
  const studyUrl =
    normalizeExternalHref(opts?.studyUrl) || (nctId ? nctClinicalTrialsUrl(nctId) : null);
  const prepared = prepareClinicalIndicators(opts?.indicators ?? []);
  const efficacyIndicators = prepared.filter(
    (ind) =>
      indicatorIsEfficacy(ind) || ind.kpi_type === "efficacy" || ind.kpi_type === "biomarker",
  );
  const safetyIndicators = prepared.filter(
    (ind) => indicatorIsSafety(ind) || ind.kpi_type === "safety",
  );
  const efficacyLines = toDataLines(efficacyIndicators, nctId, null, false, 2);
  const safetyLines = toDataLines(safetyIndicators, nctId, null, false, 4);
  const sourceLinks: StudyOutcomeSourceLink[] = [];
  const seen = new Set<string>();
  if (nctId && studyUrl) pushUniqueLink(sourceLinks, seen, nctId, studyUrl);
  for (const line of [...efficacyLines, ...safetyLines]) {
    if (line.href) pushUniqueLink(sourceLinks, seen, line.sourceLabel || "Source", line.href);
  }
  return {
    studyTitle: clean(opts?.studyTitle),
    nctId,
    studyUrl,
    phase: null,
    status: null,
    endedDate: pickIsoDate(opts?.cdDate),
    endedKind: opts?.cdDate ? "cd" : "none",
    design: null,
    enrollment: null,
    patientsTarget: null,
    nTreatment: null,
    nControl: null,
    inclusionCriteria: null,
    efficacyPrimary: null,
    efficacySecondary: null,
    efficacyProse: null,
    safetySummary: null,
    aeLines: [],
    sourceLinks,
    efficacyLines,
    safetyLines,
    eisScore: null,
    eisKpiScore: null,
    eisEventTitle: null,
    eisEventDate: null,
    efficacyIndicators,
    safetyIndicators,
  };
}

export function studyOutcomeBriefingHasBody(b: StudyOutcomeBriefing | null | undefined): boolean {
  return Boolean(b);
}

export type StudyEisEventLike = {
  nctId?: string | null;
  studyTitle?: string | null;
  title?: string;
  eventDate?: string | null;
  breakdown?: { score?: number; kpi_score?: number | null } | null;
};

/** Attach the strongest EIS event score to each study box (by NCT / title match). */
export function attachEisScoresToStudyBriefings(
  briefings: StudyOutcomeBriefing[],
  events: StudyEisEventLike[] | null | undefined,
): StudyOutcomeBriefing[] {
  if (!briefings.length) return briefings;
  const list = events ?? [];
  return briefings.map((b) => {
    const nct = (b.nctId ?? "").trim().toUpperCase();
    const title = (b.studyTitle ?? "").trim().toLowerCase();
    let best: StudyEisEventLike | null = null;
    let bestAbs = -1;
    for (const ev of list) {
      const score = ev.breakdown?.score;
      if (score == null || !Number.isFinite(score)) continue;
      const evNct = (ev.nctId ?? "").trim().toUpperCase();
      const evStudy = (ev.studyTitle ?? "").trim().toLowerCase();
      const evTitle = (ev.title ?? "").trim().toLowerCase();
      const nctHit = Boolean(nct && evNct && nct === evNct);
      const titleHit =
        Boolean(title) &&
        ((evStudy && (evStudy.includes(title.slice(0, 24)) || title.includes(evStudy.slice(0, 24)))) ||
          (evTitle && title.length > 8 && evTitle.includes(title.slice(0, 18))));
      if (!nctHit && !titleHit) continue;
      const abs = Math.abs(score);
      if (abs >= bestAbs) {
        bestAbs = abs;
        best = ev;
      }
    }
    if (!best?.breakdown) return b;
    return {
      ...b,
      eisScore: best.breakdown.score ?? null,
      eisKpiScore:
        best.breakdown.kpi_score != null && Number.isFinite(best.breakdown.kpi_score)
          ? best.breakdown.kpi_score
          : null,
      eisEventTitle: clean(best.title) || clean(best.studyTitle),
      eisEventDate: clean(best.eventDate)?.slice(0, 10) ?? null,
    };
  });
}
