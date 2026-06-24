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
      study_type: String(design.studyType ?? "").trim(),
      start_date: fmtCtgovDate(statusMod.startDateStruct),
      last_update_posted_date: fmtCtgovDate(statusMod.lastUpdatePostDateStruct),
      source: "ctgov_v2_direct",
    };
  } catch {
    return { nct_id: nct, error: "fetch_failed" };
  }
}
