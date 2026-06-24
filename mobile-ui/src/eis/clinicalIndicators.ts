import type { ClinicalStudyIndicator } from "../api";

const EFFICACY_LABEL_RE =
  /orr|pfs|os\b|dcr|cbr|crr|response|survival|endpoint|hazard|efficacy|esito studio/i;

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

function cleanClinicalIndicators(list: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  return list.filter((i) => {
    const v = (i.value ?? "").trim();
    return v && !ND.has(v.toLowerCase());
  });
}

function dedupeClinicalIndicators(items: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  const seen = new Set<string>();
  const out: ClinicalStudyIndicator[] = [];
  for (const ind of items) {
    const key = `${ind.label}|${ind.indicator_date}|${ind.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ind);
  }
  return out;
}

function prioritizeClinicalIndicators(items: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  const outcome = items.filter(indicatorIsOutcome);
  const context = items.filter(indicatorIsContextOnly);
  return [...outcome, ...context];
}

export function prepareClinicalIndicators(
  items: ClinicalStudyIndicator[] | undefined | null,
): ClinicalStudyIndicator[] {
  if (!items?.length) return [];
  return prioritizeClinicalIndicators(dedupeClinicalIndicators(cleanClinicalIndicators(items)));
}

export const CLINICAL_KPI_TYPE_LABEL: Record<string, string> = {
  efficacy: "EFF",
  safety: "SAF",
  enrollment: "ENR",
  biomarker: "BIO",
  regulatory: "REG",
  other: "",
};

export function clinicalKpiBadgeClass(kpiType: string | null | undefined): string {
  switch (kpiType) {
    case "efficacy":
      return "eis-kpi-badge eis-kpi-eff";
    case "safety":
      return "eis-kpi-badge eis-kpi-saf";
    case "enrollment":
      return "eis-kpi-badge eis-kpi-enr";
    case "biomarker":
      return "eis-kpi-badge eis-kpi-bio";
    case "regulatory":
      return "eis-kpi-badge eis-kpi-reg";
    default:
      return "eis-kpi-badge eis-kpi-other";
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
  return "rgb(var(--ink-muted))";
}
