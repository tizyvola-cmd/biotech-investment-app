/** Preferenze pannello Analisi Simulation (localStorage). */

export type SimChartPrefs = {
  companyA: string | null;
  companyB: string | null;
  showCurva: boolean;
  showStorico: boolean;
  showModello: boolean;
  showControls: boolean;
  visibleRefs: Record<string, boolean>;
  showVarChart: boolean;
  showPricePath: boolean;
  showPriceModel: boolean;
  showPointsTable: boolean;
};

export const DEFAULT_SIM_CHART_PREFS: SimChartPrefs = {
  companyA: null,
  companyB: null,
  showCurva: true,
  showStorico: true,
  showModello: true,
  showControls: true,
  visibleRefs: {},
  showVarChart: true,
  showPricePath: false,
  showPriceModel: false,
  showPointsTable: true,
};

const STORAGE_KEY = "supernova_sim_charts_prefs";

export function loadSimChartPrefs(): SimChartPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_SIM_CHART_PREFS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIM_CHART_PREFS };
    const p = JSON.parse(raw) as Partial<SimChartPrefs>;
    return {
      ...DEFAULT_SIM_CHART_PREFS,
      ...p,
      visibleRefs:
        p.visibleRefs && typeof p.visibleRefs === "object" ? { ...p.visibleRefs } : {},
    };
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

/** Confronto società nel pannello Grafici (Catalyst hub). */
export type ChartCompareMode = "single" | "pair2" | "all" | "multi";

export type ChartComparePrefs = {
  mode: ChartCompareMode;
  /** Serie `co:TICKER|date` selezionate in modalità multipla. */
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
