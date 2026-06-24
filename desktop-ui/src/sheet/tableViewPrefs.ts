/** Preferenze layout tabella per foglio (persistite in localStorage). */



export type TableDensity = "compact" | "normal" | "comfortable";

export type TableFontSize = "xs" | "sm" | "base";



export type TableViewPrefs = {

  columnOrder: string[];

  hiddenColumns: string[];

  fontSize: TableFontSize;

  density: TableDensity;

  maxColWidthRem: number;

  /** Larghezza per colonna (rem); se assente si usa maxColWidthRem. */

  columnWidths: Record<string, number>;

  /** Testo filtro rapido nella toolbar tabella. */

  tableFilter: string;

  /** Filtri extra (es. ticker/settore su Financial). */

  toolbarFilters: Record<string, string>;

};



export const TABLE_VIEW_STORAGE_PREFIX = "supernova_table_view_";



export const DEFAULT_TABLE_VIEW_PREFS: TableViewPrefs = {

  columnOrder: [],

  hiddenColumns: [],

  fontSize: "xs",

  density: "compact",

  maxColWidthRem: 10,

  columnWidths: {},

  tableFilter: "",

  toolbarFilters: {},

};



const FONT_SIZES: TableFontSize[] = ["xs", "sm", "base"];

const DENSITIES: TableDensity[] = ["compact", "normal", "comfortable"];



function slugSheetId(sheetId: string): string {

  return sheetId.trim().toLowerCase().replace(/\s+/g, "_");

}



export function tableViewStorageKey(sheetId: string): string {

  return `${TABLE_VIEW_STORAGE_PREFIX}${slugSheetId(sheetId)}`;

}



function parseColumnWidths(raw: unknown): Record<string, number> {

  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, number> = {};

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {

    const n = typeof v === "number" ? v : Number(v);

    if (Number.isFinite(n) && n >= 4 && n <= 48) out[String(k)] = n;

  }

  return out;

}



function parseToolbarFilters(raw: unknown): Record<string, string> {

  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, string> = {};

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {

    out[String(k)] = String(v ?? "");

  }

  return out;

}



/** Normalizza dati da localStorage (retrocompatibile con versioni senza nuovi campi). */

export function normalizeTableViewPrefs(parsed: Partial<TableViewPrefs> | null | undefined): TableViewPrefs {

  const p = parsed ?? {};

  const fontSize = FONT_SIZES.includes(p.fontSize as TableFontSize)

    ? (p.fontSize as TableFontSize)

    : DEFAULT_TABLE_VIEW_PREFS.fontSize;

  const density = DENSITIES.includes(p.density as TableDensity)

    ? (p.density as TableDensity)

    : DEFAULT_TABLE_VIEW_PREFS.density;

  let maxColWidthRem =

    typeof p.maxColWidthRem === "number" ? p.maxColWidthRem : Number(p.maxColWidthRem);

  if (!Number.isFinite(maxColWidthRem)) maxColWidthRem = DEFAULT_TABLE_VIEW_PREFS.maxColWidthRem;

  maxColWidthRem = Math.min(24, Math.max(6, Math.round(maxColWidthRem)));



  return {

    columnOrder: Array.isArray(p.columnOrder) ? p.columnOrder.map(String) : [],

    hiddenColumns: Array.isArray(p.hiddenColumns) ? p.hiddenColumns.map(String) : [],

    fontSize,

    density,

    maxColWidthRem,

    columnWidths: parseColumnWidths(p.columnWidths),

    tableFilter: typeof p.tableFilter === "string" ? p.tableFilter : "",

    toolbarFilters: parseToolbarFilters(p.toolbarFilters),

  };

}



export function loadTableViewPrefs(sheetId: string): TableViewPrefs {

  if (typeof window === "undefined") return { ...DEFAULT_TABLE_VIEW_PREFS };

  try {

    const raw = localStorage.getItem(tableViewStorageKey(sheetId));

    if (!raw) return { ...DEFAULT_TABLE_VIEW_PREFS };

    return normalizeTableViewPrefs(JSON.parse(raw) as Partial<TableViewPrefs>);

  } catch {

    return { ...DEFAULT_TABLE_VIEW_PREFS };

  }

}



export function saveTableViewPrefs(sheetId: string, prefs: TableViewPrefs): void {

  if (typeof window === "undefined") return;

  localStorage.setItem(tableViewStorageKey(sheetId), JSON.stringify(normalizeTableViewPrefs(prefs)));

}



/** Allinea ordine colonne ai dati correnti; ritorna colonne visibili. */

export function resolveTableColumns(

  allColumns: string[],

  prefs: TableViewPrefs

): { visibleColumns: string[]; mergedPrefs: TableViewPrefs } {

  const hidden = new Set(prefs.hiddenColumns);

  const order: string[] = [];

  for (const c of prefs.columnOrder) {

    if (allColumns.includes(c) && !order.includes(c)) order.push(c);

  }

  for (const c of allColumns) {

    if (!order.includes(c)) order.push(c);

  }

  const columnWidths: Record<string, number> = {};

  for (const c of order) {

    const w = prefs.columnWidths[c];

    if (w != null) columnWidths[c] = w;

  }

  const visibleColumns = order.filter((c) => !hidden.has(c));

  return {

    visibleColumns,

    mergedPrefs: { ...prefs, columnOrder: order, columnWidths },

  };

}



export function columnWidthStyle(

  column: string,

  prefs: TableViewPrefs

): { maxWidth: string; width?: string; minWidth?: string } {

  const w = prefs.columnWidths[column];

  if (w != null) {

    const rem = `${w}rem`;

    return { maxWidth: rem, width: rem, minWidth: rem };

  }

  const maxW = `${prefs.maxColWidthRem}rem`;

  return { maxWidth: maxW };

}



export function densityClasses(density: TableDensity): { cell: string; head: string } {

  switch (density) {

    case "comfortable":

      return { cell: "px-4 py-2", head: "px-4 py-2.5" };

    case "normal":

      return { cell: "px-3 py-1.5", head: "px-3 py-2" };

    default:

      return { cell: "px-2 py-0.5", head: "px-2 py-1.5" };

  }

}



export function fontSizeClass(fontSize: TableFontSize): string {

  switch (fontSize) {

    case "base":

      return "text-base";

    case "sm":

      return "text-sm";

    default:

      return "text-xs";

  }

}



export function moveColumn(order: string[], from: string, to: string): string[] {

  if (from === to) return order;

  const next = order.filter((c) => c !== from);

  const toIdx = next.indexOf(to);

  if (toIdx < 0) return [...next, from];

  next.splice(toIdx, 0, from);

  return next;

}


