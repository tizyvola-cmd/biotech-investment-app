/** Simulation Analysis panel preferences (localStorage). */

export type SimChartPrefs = {
  companyA: string | null;
  companyB: string | null;
  showCurva: boolean;
  showStorico: boolean;
  showModello: boolean;
  showEisPlus: boolean;
  showControls: boolean;
  visibleRefs: Record<string, boolean>;
  showVarChart: boolean;
  showPricePath: boolean;
  showPointsTable: boolean;
};

export const DEFAULT_SIM_CHART_PREFS: SimChartPrefs = {
  companyA: null,
  companyB: null,
  showCurva: true,
  showStorico: true,
  showModello: true,
  showEisPlus: false,
  showControls: true,
  visibleRefs: {},
  showVarChart: true,
  showPricePath: true,
  showPointsTable: true,
};

const STORAGE_KEY = "supernova_sim_charts_prefs";
const MIGRATION_KEY = "supernova_sim_charts_prefs_migration";
/**
 * One-shot migrations identified by their numeric id. When a new entry is
 * added, ``loadSimChartPrefs`` reapplies the migration the next time it
 * runs and stores the id in ``MIGRATION_KEY`` so it is not repeated.
 *
 *   1 → forced ``showPricePath: true`` for users that still had the old
 *       default ``false`` saved from before "Price $ — real data" became the
 *       default behavior in Charts.
 */
const CURRENT_MIGRATION = 1;

function loadAppliedMigration(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(MIGRATION_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function saveAppliedMigration(version: number): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MIGRATION_KEY, String(version));
}

export function loadSimChartPrefs(): SimChartPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_SIM_CHART_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const applied = loadAppliedMigration();
    if (!raw) {
      saveAppliedMigration(CURRENT_MIGRATION);
      return { ...DEFAULT_SIM_CHART_PREFS };
    }
    const p = JSON.parse(raw) as Partial<SimChartPrefs>;
    const merged: SimChartPrefs = {
      ...DEFAULT_SIM_CHART_PREFS,
      ...p,
      visibleRefs:
        p.visibleRefs && typeof p.visibleRefs === "object" ? { ...p.visibleRefs } : {},
    };
    // Apply one-shot migrations for users with stale snapshots.
    if (applied < 1) {
      merged.showPricePath = true;
    }
    if (applied < CURRENT_MIGRATION) {
      saveAppliedMigration(CURRENT_MIGRATION);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return { ...DEFAULT_SIM_CHART_PREFS };
  }
}

export function saveSimChartPrefs(prefs: SimChartPrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function defaultVisibleRefs(controlIds: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of controlIds) {
    out[id] = true;
  }
  return out;
}

/** μ curve comparison preset in the Charts panel. */
export type RefComparePreset =
  | "supernova"
  | "postCd"
  | "postRialzo"
  | "postRibasso"
  | "postNeutro"
  | "supernovaPostCd"
  | "all"
  | "none";

export function refLabelMatchesPreset(label: string, preset: RefComparePreset): boolean {
  const l = label.toLowerCase().replace(/^μ\s+/, "").trim();
  switch (preset) {
    case "supernova":
      return l.includes("supernova") || l.includes("cl.1") || l.includes("cluster 1");
    case "postRialzo":
      return l.includes("post-cd") && l.includes("rialzo");
    case "postRibasso":
      return l.includes("post-cd") && l.includes("ribasso");
    case "postNeutro":
      return l.includes("post-cd") && l.includes("neutro");
    case "postCd":
      return (
        (l.includes("post-cd") && l.includes("rialzo")) ||
        (l.includes("post-cd") && l.includes("ribasso")) ||
        (l.includes("post-cd") && l.includes("neutro"))
      );
    case "supernovaPostCd":
      return refLabelMatchesPreset(label, "supernova") || refLabelMatchesPreset(label, "postCd");
    case "all":
      return true;
    case "none":
      return false;
    default:
      return false;
  }
}

export function visibleRefsForPreset(
  controls: { id: string; label: string }[],
  preset: RefComparePreset
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const c of controls) {
    out[c.id] = preset === "all" ? true : preset !== "none" && refLabelMatchesPreset(c.label, preset);
  }
  return out;
}

export function mergeVisibleRefs(
  current: Record<string, boolean>,
  controls: { id: string; label: string }[],
  preset: RefComparePreset,
  mode: "set" | "toggle"
): Record<string, boolean> {
  const next = { ...current };
  for (const c of controls) {
    const match = refLabelMatchesPreset(c.label, preset);
    if (mode === "set") {
      next[c.id] = preset === "all" ? true : preset === "none" ? false : match;
    } else if (match) {
      next[c.id] = !(current[c.id] !== false);
    }
  }
  return next;
}

/** Company comparison in the Charts panel (Catalyst hub). */
export type ChartCompareMode = "single" | "pair2" | "all" | "multi";

export type ChartComparePrefs = {
  mode: ChartCompareMode;
  /** `co:TICKER|date` series selected in multi mode. */
  selectedIds: string[];
};

export const MAX_CHART_COMPARE_SERIES = 25;

const COMPARE_STORAGE_KEY = "supernova_chart_compare_mode";

const DEFAULT_COMPARE_PREFS: ChartComparePrefs = {
  mode: "pair2",
  selectedIds: [],
};

export function loadChartComparePrefs(): ChartComparePrefs {
  if (typeof window === "undefined") return { ...DEFAULT_COMPARE_PREFS };
  try {
    const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COMPARE_PREFS };
    const p = JSON.parse(raw) as Partial<ChartComparePrefs>;
    const mode = p.mode;
    const valid: ChartCompareMode[] = ["single", "pair2", "all", "multi"];
    return {
      mode: valid.includes(mode as ChartCompareMode)
        ? (mode as ChartCompareMode)
        : DEFAULT_COMPARE_PREFS.mode,
      selectedIds: Array.isArray(p.selectedIds)
        ? p.selectedIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_COMPARE_PREFS };
  }
}

export function saveChartComparePrefs(prefs: ChartComparePrefs): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(prefs));
}
