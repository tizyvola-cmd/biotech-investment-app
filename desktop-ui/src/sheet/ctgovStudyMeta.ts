import type { ClinicalStudyProtocolMeta } from "../api/supernova";

function normOrg(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Fallback when API offline — allinea sponsor_match / nct_relation_type OpenFDA. */
export function inferNctRelationForCompany(
  company: string,
  leadSponsor: string,
  collaborators: string,
): string {
  const c = normOrg(company);
  if (!c) return "";
  const lead = normOrg(leadSponsor);
  if (lead && (lead.includes(c) || c.includes(lead))) return "direct sponsor";
  for (const part of collaborators.split("|")) {
    const p = normOrg(part.trim());
    if (p && (p.includes(c) || c.includes(p))) return "collaborator";
  }
  return "";
}

function fmtCtgovDate(struct: unknown): string {
  if (!struct || typeof struct !== "object") return "";
  const d = (struct as { date?: string }).date;
  return d?.trim() ?? "";
}

function humanizeDesignToken(raw: string): string {
  const up = raw.trim().replace(/_/g, " ").toUpperCase();
  if (!up || up === "N/A" || up === "NA" || up === "NONE") return "";
  const map: Record<string, string> = {
    DOUBLE: "Double-blind",
    "DOUBLE BLIND": "Double-blind",
    SINGLE: "Single-blind",
    "SINGLE BLIND": "Single-blind",
    TRIPLE: "Triple-blind",
    "TRIPLE BLIND": "Triple-blind",
    QUADRUPLE: "Quadruple-blind",
    "NONE (OPEN LABEL)": "Open-label",
    "OPEN LABEL": "Open-label",
    RANDOMIZED: "Randomized",
    "NON-RANDOMIZED": "Non-randomized",
    PARALLEL: "Parallel assignment",
    CROSSOVER: "Crossover",
    SEQUENTIAL: "Sequential",
    "SINGLE GROUP": "Single-group",
    FACTORIAL: "Factorial",
    TREATMENT: "Treatment",
    PREVENTION: "Prevention",
    DIAGNOSTIC: "Diagnostic",
    INTERVENTIONAL: "Interventional",
    OBSERVATIONAL: "Observational",
  };
  return map[up] || raw.trim().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCtgovStudyDesign(parts: {
  masking?: string;
  allocation?: string;
  interventionModel?: string;
  primaryPurpose?: string;
  studyType?: string;
  interventions?: string;
  armCount?: number | null;
}): string {
  const out: string[] = [];
  for (const tok of [
    parts.masking,
    parts.allocation,
    parts.interventionModel,
    parts.primaryPurpose,
    parts.studyType,
  ]) {
    const label = humanizeDesignToken(String(tok ?? ""));
    if (label && !out.includes(label)) out.push(label);
  }
  const inter = String(parts.interventions ?? "").toLowerCase();
  if (inter.includes("placebo") && !out.some((p) => /placebo/i.test(p))) {
    out.push("Placebo-controlled");
  }
  if (parts.armCount != null && parts.armCount > 0) {
    const arms =
      parts.armCount === 1
        ? "1 arm"
        : parts.armCount === 2
          ? "2 arms"
          : parts.armCount === 3
            ? "3 arms"
            : `${parts.armCount} arms`;
    if (!out.some((p) => /\d+\s*arms?/i.test(p))) out.push(arms);
  }
  return out.slice(0, 7).join(" · ");
}

export function extractInclusionCriteria(raw: string, maxLen = 900): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  let start = -1;
  for (const marker of ["inclusion criteria:", "inclusion criteria", "criteri di inclusione:", "criteri di inclusione"]) {
    const i = lower.indexOf(marker);
    if (i >= 0) {
      start = i + marker.length;
      break;
    }
  }
  if (start >= 0) {
    let chunk = text.slice(start);
    let end = -1;
    for (const marker of ["exclusion criteria:", "exclusion criteria", "criteri di esclusione:", "criteri di esclusione"]) {
      const j = chunk.toLowerCase().indexOf(marker);
      if (j >= 0) {
        end = j;
        break;
      }
    }
    if (end >= 0) chunk = chunk.slice(0, end);
    text = chunk.trim();
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLen) text = `${text.slice(0, maxLen - 1).trim()}…`;
  return text;
}

/** Direct CT.gov v2 fetch — works without local SuperNova API. */
export async function fetchCtgovProtocolMetaDirect(
  nct_id: string,
): Promise<ClinicalStudyProtocolMeta> {
  const nct = String(nct_id ?? "")
    .trim()
    .toUpperCase();
  if (!nct.startsWith("NCT")) {
    return { nct_id: nct, error: "invalid_nct" };
  }

  try {
    const res = await fetch(
      `https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(nct)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) {
      return { nct_id: nct, error: res.status === 404 ? "not_found" : `http_${res.status}` };
    }
    const study = (await res.json()) as Record<string, unknown>;
    const protocol = (study.protocolSection ?? {}) as Record<string, unknown>;
    const ident = (protocol.identificationModule ?? {}) as Record<string, unknown>;
    const statusMod = (protocol.statusModule ?? {}) as Record<string, unknown>;
    const sponsors = (protocol.sponsorCollaboratorsModule ?? {}) as Record<string, unknown>;
    const armsMod = (protocol.armsInterventionsModule ?? {}) as Record<string, unknown>;
    const conditionsMod = (protocol.conditionsModule ?? {}) as Record<string, unknown>;
    const design = (protocol.designModule ?? {}) as Record<string, unknown>;
    const elig = (protocol.eligibilityModule ?? {}) as Record<string, unknown>;
    const designInfo = (design.designInfo ?? {}) as Record<string, unknown>;
    const maskingInfo = (designInfo.maskingInfo ?? {}) as Record<string, unknown>;
    const enrollmentInfo = (design.enrollmentInfo ?? {}) as { count?: number };

    const collaborators = ((sponsors.collaborators as unknown[]) ?? [])
      .slice(0, 8)
      .map((c) => String((c as { name?: string })?.name ?? "").trim())
      .filter(Boolean)
      .join(" | ");

    const interventionTypes = [
      ...new Set(
        ((armsMod.interventions as unknown[]) ?? [])
          .slice(0, 6)
          .map((x) => String((x as { type?: string })?.type ?? "").trim())
          .filter(Boolean),
      ),
    ].join(" | ");

    const conditions = ((conditionsMod.conditions as string[]) ?? [])
      .filter(Boolean)
      .join(" | ");

    const interventions = ((armsMod.interventions as unknown[]) ?? [])
      .slice(0, 4)
      .map((x) => String((x as { name?: string })?.name ?? "").trim())
      .filter(Boolean)
      .join(" | ");

    const phases = ((design.phases as string[]) ?? []).join(" / ");
    const masking = String(maskingInfo.masking ?? "").trim();
    const allocation = String(designInfo.allocation ?? "").trim();
    const interventionModel = String(designInfo.interventionModel ?? "").trim();
    const primaryPurpose = String(designInfo.primaryPurpose ?? "").trim();
    const studyType = String(design.studyType ?? "").trim();
    const armCount = Array.isArray(armsMod.armGroups) ? armsMod.armGroups.length : null;
    const studyDesign = formatCtgovStudyDesign({
      masking,
      allocation,
      interventionModel,
      primaryPurpose,
      studyType,
      interventions,
      armCount,
    });
    const inclusionCriteria = extractInclusionCriteria(
      String(elig.eligibilityCriteria ?? ""),
    );
    const enrollment =
      typeof enrollmentInfo.count === "number" && Number.isFinite(enrollmentInfo.count)
        ? enrollmentInfo.count
        : null;

    return {
      nct_id: nct,
      brief_title: String(ident.briefTitle ?? "").trim(),
      official_title: String(ident.officialTitle ?? "").trim(),
      phase: phases,
      overall_status: String(statusMod.overallStatus ?? "").trim(),
      conditions,
      interventions,
      intervention_type: interventionTypes,
      lead_sponsor: String((sponsors.leadSponsor as { name?: string })?.name ?? "").trim(),
      collaborators,
      study_type: studyType,
      start_date: fmtCtgovDate(statusMod.startDateStruct),
      last_update_posted_date: fmtCtgovDate(statusMod.lastUpdatePostDateStruct),
      masking,
      allocation,
      intervention_model: interventionModel,
      primary_purpose: primaryPurpose,
      study_design: studyDesign,
      inclusion_criteria: inclusionCriteria,
      enrollment,
      arm_count: armCount,
      primary_completion_date: fmtCtgovDate(statusMod.primaryCompletionDateStruct),
      completion_date: fmtCtgovDate(statusMod.completionDateStruct),
      source: "ctgov_v2_direct",
    };
  } catch {
    return { nct_id: nct, error: "fetch_failed" };
  }
}

export type CtgovStudyNearCd = {
  nctId: string;
  briefTitle: string;
  phase: string;
  primaryCompletion: string | null;
  href: string;
  /** True when primary completion is not within ~4 months of the desk CD. */
  approximate: boolean;
};

function parseCtgovDateToIso(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (full) return `${full[1]}-${full[2]}-${full[3]}`;
  const ym = /^(\d{4})-(\d{2})$/.exec(s);
  if (ym) return `${ym[1]}-${ym[2]}-15`;
  return null;
}

function phaseListToLabel(phases: unknown): string {
  if (Array.isArray(phases) && phases.length) {
    return phases
      .map((p) => String(p ?? "").replace(/^PHASE\s*/i, "Phase ").trim())
      .filter(Boolean)
      .join(" / ");
  }
  const s = String(phases ?? "").trim();
  return s ? s.replace(/^PHASE\s*/i, "Phase ") : "";
}

type CtgovHit = {
  nctId: string;
  briefTitle: string;
  phase: string;
  primaryCompletion: string | null;
};

async function queryCtgovStudies(
  params: Record<string, string>,
): Promise<CtgovHit[]> {
  const qs = new URLSearchParams({ pageSize: "25", ...params }).toString();
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${qs}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { studies?: unknown[] };
  const out: CtgovHit[] = [];
  for (const study of data.studies ?? []) {
    if (!study || typeof study !== "object") continue;
    const protocol = (study as { protocolSection?: Record<string, unknown> })
      .protocolSection;
    if (!protocol) continue;
    const ident = (protocol.identificationModule ?? {}) as Record<string, unknown>;
    const status = (protocol.statusModule ?? {}) as Record<string, unknown>;
    const design = (protocol.designModule ?? {}) as Record<string, unknown>;
    const nct = String(ident.nctId ?? "")
      .trim()
      .toUpperCase();
    const briefTitle = String(ident.briefTitle ?? "").trim();
    if (!nct || !briefTitle) continue;
    out.push({
      nctId: nct,
      briefTitle,
      phase: phaseListToLabel(design.phases),
      primaryCompletion: parseCtgovDateToIso(
        fmtCtgovDate(status.primaryCompletionDateStruct) ||
          fmtCtgovDate(status.completionDateStruct),
      ),
    });
  }
  return out;
}

/**
 * Live CT.gov lookup for Catalyst Event modal — finds briefTitle near the desk CD
 * when Simulation / clinical pre-CD have no study title.
 */
export async function resolveCtgovStudyNearCd(opts: {
  ticker: string;
  company?: string | null;
  targetCd?: string | null;
}): Promise<CtgovStudyNearCd | null> {
  const ticker = String(opts.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker) return null;
  const company = String(opts.company ?? "").trim();
  const targetCd = String(opts.targetCd ?? "")
    .trim()
    .slice(0, 10);
  const targetMs = /^\d{4}-\d{2}-\d{2}$/.test(targetCd)
    ? Date.parse(`${targetCd}T12:00:00`)
    : NaN;

  const queries: Record<string, string>[] = [{ "query.term": ticker }];
  const companyToken = company.split(/\s+/)[0]?.trim() ?? "";
  if (companyToken && companyToken.toUpperCase() !== ticker && companyToken.length >= 4) {
    queries.push({ "query.spons": companyToken });
  }
  if (company.length >= 6 && company.toLowerCase() !== companyToken.toLowerCase()) {
    queries.push({ "query.spons": company });
  }

  let hits: CtgovHit[] = [];
  for (const q of queries) {
    try {
      const batch = await queryCtgovStudies(q);
      if (batch.length) {
        hits = batch;
        break;
      }
    } catch {
      /* try next query */
    }
  }
  if (!hits.length) return null;

  const scored = hits
    .map((h) => {
      const pcMs = h.primaryCompletion
        ? Date.parse(`${h.primaryCompletion}T12:00:00`)
        : NaN;
      const skew =
        Number.isFinite(targetMs) && Number.isFinite(pcMs)
          ? Math.abs(pcMs - targetMs) / 86_400_000
          : Number.POSITIVE_INFINITY;
      const futureBonus =
        Number.isFinite(pcMs) && Number.isFinite(targetMs) && pcMs >= targetMs - 30 * 86_400_000
          ? 0
          : 40;
      return { h, skew, score: skew + futureBonus };
    })
    .sort((a, b) => a.score - b.score);

  const best = scored[0]?.h;
  if (!best) return null;
  const skew = scored[0]!.skew;
  const approximate = !(Number.isFinite(skew) && skew <= 120);
  // If nothing is within a year of the desk CD, still show the nearest upcoming
  // title so the modal is not blank — mark approximate.
  if (Number.isFinite(skew) && skew > 400) {
    const upcoming = scored.find((s) => {
      if (!s.h.primaryCompletion) return false;
      const ms = Date.parse(`${s.h.primaryCompletion}T12:00:00`);
      return Number.isFinite(ms) && ms >= Date.now() - 7 * 86_400_000;
    });
    if (upcoming) {
      return {
        nctId: upcoming.h.nctId,
        briefTitle: upcoming.h.briefTitle,
        phase: upcoming.h.phase,
        primaryCompletion: upcoming.h.primaryCompletion,
        href: `https://clinicaltrials.gov/study/${upcoming.h.nctId}`,
        approximate: true,
      };
    }
  }

  return {
    nctId: best.nctId,
    briefTitle: best.briefTitle,
    phase: best.phase,
    primaryCompletion: best.primaryCompletion,
    href: `https://clinicaltrials.gov/study/${best.nctId}`,
    approximate,
  };
}

