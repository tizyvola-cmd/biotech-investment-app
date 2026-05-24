/** Regole formattazione condizionale (persistite per foglio). */

export type CfRuleType = "colorScale" | "dataBar" | "iconSet";

export type ColorScalePreset =
  | "diverging" // blu → grigio → ambra (default Excel-like)
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
  /** Colonna esatta; ``*`` = tutte le colonne numeriche visibili. */
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
  /** Mostra solo icona (nasconde testo numerico nella cella). */
  iconOnly?: boolean;
};

export type CfRule = CfColorScaleRule | CfDataBarRule | CfIconSetRule;

export type ConditionalFormatPrefs = {
  rules: CfRule[];
  /** Se true, la formattazione utente sostituisce lo sfondo delle regole built-in. */
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
  diverging: "Divergente (blu · grigio · ambra)",
  greenYellowRed: "Verde · giallo · rosso",
  blueWhiteRed: "Blu · bianco · rosso",
  greenWhite: "Verde → bianco",
  redWhite: "Rosso → bianco",
  whiteGreen: "Bianco → verde",
  whiteRed: "Bianco → rosso",
  greyScale: "Scala di grigi",
};

export const DATA_BAR_LABELS: Record<DataBarPreset, string> = {
  green: "Verde (Excel)",
  blue: "Blu",
  amber: "Ambra",
  red: "Rosso",
  teal: "Teal",
  custom: "Colore personalizzato",
};

export const ICON_SET_LABELS: Record<IconSetPreset, string> = {
  arrows3: "Frecce 3 (↑ → ↓)",
  arrows4: "Frecce 4",
  arrows5: "Frecce 5",
  traffic3: "Semaforo 3",
  traffic4: "Semaforo 4",
  flags3: "Bandiere 3",
  rating5: "Stelle 1–5",
  quarters5: "Quarti ●",
};

export const DATA_BAR_COLORS: Record<Exclude<DataBarPreset, "custom">, string> = {
  green: "#70AD47",
  blue: "#4472C4",
  amber: "#FFC000",
  red: "#C00000",
  teal: "#00B0A0",
};
