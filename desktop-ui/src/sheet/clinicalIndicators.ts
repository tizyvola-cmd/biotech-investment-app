import type { ClinicalStudyIndicator } from "../api/supernova";

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

export function cleanClinicalIndicators(list: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
  return list.filter((i) => {
    const v = (i.value ?? "").trim();
    return v && !ND.has(v.toLowerCase());
  });
}

export function dedupeClinicalIndicators(items: ClinicalStudyIndicator[]): ClinicalStudyIndicator[] {
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

export const CLINICAL_KPI_TYPE_LABEL: Record<string, string> = {
  efficacy: "EFF",
  safety: "SAF",
  enrollment: "ENR",
  biomarker: "BIO",
  regulatory: "REG",
  other: "",
};

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
