/** Conditional formatting rules (persisted per sheet). */

export type CfRuleType = "colorScale" | "dataBar" | "iconSet";

export type ColorScalePreset =
  | "diverging" // blue → gray → amber (default Excel-like)
  | "greenYellowRed"
  | "blueWhiteRed"
  | "greenWhite"
  | "redWhite"
  | "whiteGreen"
  | "whiteRed"
  | "greyScale";

export type DataBarPreset = "green" | "blue" | "amber" | "red" | "teal" | "custom";

export type IconSetPreset =
  | "arrows3"
  | "arrows4"
  | "arrows5"
  | "traffic3"
  | "traffic4"
  | "flags3"
  | "rating5"
  | "quarters5";

export type CfRuleBase = {
  id: string;
  enabled: boolean;
  /** Exact column; ``*`` = all visible numeric columns. */
  column: string;
  priority: number;
};

export type CfColorScaleRule = CfRuleBase & {
  type: "colorScale";
  preset: ColorScalePreset;
  minValue?: number | null;
  maxValue?: number | null;
};

export type CfDataBarRule = CfRuleBase & {
  type: "dataBar";
  preset: DataBarPreset;
  barColor?: string;
  axisColor?: string;
  gradient?: boolean;
};

export type CfIconSetRule = CfRuleBase & {
  type: "iconSet";
  preset: IconSetPreset;
  /** Show icon only (hides the numeric text in the cell). */
  iconOnly?: boolean;
};

export type CfRule = CfColorScaleRule | CfDataBarRule | CfIconSetRule;

export type ConditionalFormatPrefs = {
  rules: CfRule[];
  /** If true, user formatting overrides built-in rule backgrounds. */
  overrideBuiltInBackground: boolean;
};

export const DEFAULT_CONDITIONAL_FORMAT_PREFS: ConditionalFormatPrefs = {
  rules: [],
  overrideBuiltInBackground: true,
};

const STORAGE_PREFIX = "supernova_cf_";

export function conditionalFormatStorageKey(sheetId: string): string {
  return `${STORAGE_PREFIX}${sheetId.trim().toLowerCase().replace(/\s+/g, "_")}`;
}

export function loadConditionalFormatPrefs(sheetId: string): ConditionalFormatPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_CONDITIONAL_FORMAT_PREFS };
  try {
    const raw = localStorage.getItem(conditionalFormatStorageKey(sheetId));
    if (!raw) return { ...DEFAULT_CONDITIONAL_FORMAT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ConditionalFormatPrefs>;
    return {
      ...DEFAULT_CONDITIONAL_FORMAT_PREFS,
      ...parsed,
      rules: Array.isArray(parsed.rules)
        ? (parsed.rules as CfRule[]).map(normalizeRule)
        : [],
    };
  } catch {
    return { ...DEFAULT_CONDITIONAL_FORMAT_PREFS };
  }
}

export function saveConditionalFormatPrefs(
  sheetId: string,
  prefs: ConditionalFormatPrefs
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(conditionalFormatStorageKey(sheetId), JSON.stringify(prefs));
}

function normalizeRule(r: CfRule): CfRule {
  const base = {
    id: String(r.id || newRuleId()),
    enabled: r.enabled !== false,
    column: String(r.column || "*"),
    priority: Number(r.priority) || 0,
  };
  if (r.type === "dataBar") {
    return {
      ...base,
      type: "dataBar",
      preset: r.preset || "green",
      barColor: r.barColor,
      axisColor: r.axisColor,
      gradient: r.gradient !== false,
    };
  }
  if (r.type === "iconSet") {
    return {
      ...base,
      type: "iconSet",
      preset: r.preset || "arrows3",
      iconOnly: Boolean(r.iconOnly),
    };
  }
  return {
    ...base,
    type: "colorScale",
    preset: (r as CfColorScaleRule).preset || "diverging",
    minValue: (r as CfColorScaleRule).minValue ?? null,
    maxValue: (r as CfColorScaleRule).maxValue ?? null,
  };
}

export function newRuleId(): string {
  return `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const COLOR_SCALE_LABELS: Record<ColorScalePreset, string> = {
  diverging: "Diverging (blue · gray · amber)",
  greenYellowRed: "Green · yellow · red",
  blueWhiteRed: "Blue · white · red",
  greenWhite: "Green → white",
  redWhite: "Red → white",
  whiteGreen: "White → green",
  whiteRed: "White → red",
  greyScale: "Grayscale",
};

export const DATA_BAR_LABELS: Record<DataBarPreset, string> = {
  green: "Green (Excel)",
  blue: "Blue",
  amber: "Amber",
  red: "Red",
  teal: "Teal",
  custom: "Custom color",
};

export const ICON_SET_LABELS: Record<IconSetPreset, string> = {
  arrows3: "Arrows 3 (↑ → ↓)",
  arrows4: "Arrows 4",
  arrows5: "Arrows 5",
  traffic3: "Traffic light 3",
  traffic4: "Traffic light 4",
  flags3: "Flags 3",
  rating5: "Stars 1–5",
  quarters5: "Quarters ●",
};

export const DATA_BAR_COLORS: Record<Exclude<DataBarPreset, "custom">, string> = {
  green: "#70AD47",
  blue: "#4472C4",
  amber: "#FFC000",
  red: "#C00000",
  teal: "#00B0A0",
};
