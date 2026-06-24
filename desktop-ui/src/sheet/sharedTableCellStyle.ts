/**
 * Shared color logic (Simulation style): ▲▼● + green/red text on % columns.
 */
import type { CellStyle } from "./variationColors";
import { sheetCellPlainText } from "./cellLinks";
import { TABLE_COLORS_ENABLED } from "./tableColorsEnabled";

const POS = "rgb(var(--positive))";
const NEG = "rgb(var(--negative))";
const MUTED = "rgb(var(--ink-muted))";
const ACCENT = "rgb(var(--accent))";
const WARN = "rgb(var(--warn))";

export type SharedCellExtras = {
  style?: CellStyle;
  icon?: string;
  iconColor?: string;
};

export function sheetTrendIcon(pct: number): { icon: string; iconColor: string } {
  if (Math.abs(pct) < 0.05) return { icon: "●", iconColor: MUTED };
  if (pct > 0) return { icon: "▲", iconColor: POS };
  return { icon: "▼", iconColor: NEG };
}

export function signedPctTextStyle(n: number, maxAbs: number): CellStyle {
  if (Math.abs(n) < 0.05) return { color: MUTED };
  const bold = Math.abs(n) >= maxAbs * 0.35;
  if (n > 0) return { color: POS, fontWeight: bold ? "700" : "400" };
  return { color: NEG, fontWeight: bold ? "700" : "400" };
}

function resolveNumericRaw(raw: unknown): unknown {
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined) return raw;
  if (typeof raw === "object") {
    const text = sheetCellPlainText(raw).trim();
    if (text && text !== "—") return text;
  }
  return raw;
}

export function toSheetNum(v: unknown): number | null {
  const resolved = resolveNumericRaw(v);
  if (resolved === null || resolved === undefined || resolved === "" || resolved === "—" || resolved === "-" || resolved === "N/D")
    return null;
  const n =
    typeof resolved === "number"
      ? resolved
      : Number(String(resolved).replace(/%/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function percentPointsFromStored(raw: unknown, forceFraction = false): number | null {
  const n = toSheetNum(raw);
  if (n === null) return null;
  if (forceFraction || (Math.abs(n) <= 1.5 && !String(raw).includes("%"))) return n * 100;
  return n;
}

function maxAbsForColumn(column: string): number {
  const c = column.toLowerCase();
  if (c.includes("6m")) return 40;
  if (c.includes("3m")) return 25;
  if (c.includes("1m") || c.includes("giorn")) return 15;
  if (c.includes("dailychange") || c.includes("1g")) return 5;
  if (c.includes("p&l") || c.includes("pred−stor") || c.includes("pred-stor")) return 30;
  if (c.includes("Δ%") && c.includes("baseline")) return 40;
  if (c.startsWith("storico %") || c.includes("Δ%") || c.includes("pred v5")) return 25;
  if (c.includes("variation") || c.includes("var.")) return 25;
  return 20;
}

export function isSecK8PctColumn(column: string): boolean {
  const norm = column.replace(/\n/g, " ").trim();
  return norm.includes("Δ% vs baseline") || (norm.includes("Δ%") && /baseline/i.test(norm));
}

export function isPctLikeColumn(column: string): boolean {
  const c = column;
  if (isSecK8PctColumn(column)) return true;
  if (c.startsWith("Var.") || c.includes("variation_") || c === "dailyChange_%") return true;
  if (c.startsWith("Storico %")) return true;
  if (c.includes("Δ% vs Pred") || c.startsWith("Pred v5")) return true;
  if (c.includes("Pred−Stor") || c.includes("Pred-Stor") || c.includes("Δ%\nPred")) return true;
  if (c === "P&L (%)" || c === "Pred empirica\n+5gg (%)") return true;
  if (c.includes("Pred\n") && /[+\-−]?\d+\s*$/.test(c)) return true;
  return false;
}

function isPredDeltaColumn(col: string): boolean {
  return col.includes("Δ% vs Pred") || (col.includes("Pred") && col.includes("Δ%"));
}

function isSponsorColumn(col: string): boolean {
  return (
    col === "Exact·Partial vs Unmatch" ||
    (col.includes("Exact") && col.includes("Unmatch")) ||
    (col.toLowerCase().includes("sponsor") && col.toLowerCase().includes("match"))
  );
}

type CdInfo = { past: boolean; daysTo: number };

function parseCompletionDate(raw: unknown): CdInfo | null {
  const s = String(raw ?? "").trim();
  if (!s || s === "—") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return { past: false, daysTo: 999 };
  const [, d, mo, y] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dt.setHours(0, 0, 0, 0);
  const daysTo = Math.round((dt.getTime() - today.getTime()) / 86_400_000);
  return { past: daysTo < 0, daysTo };
}

function rowIsPast(row: Record<string, unknown>): boolean {
  const cd = String(row["Completion Date"] ?? row.CD ?? "").trim();
  if (!cd || cd === "—") return false;
  const info = parseCompletionDate(cd);
  return info?.past ?? false;
}

/** Shared cell style — Simulation logic (text + icon, no background on var.%). */
export function sharedTableCellExtras(
  column: string,
  raw: unknown,
  row: Record<string, unknown>
): SharedCellExtras | undefined {
  if (!TABLE_COLORS_ENABLED) return undefined;
  if (raw === null || raw === undefined || raw === "" || raw === "—" || raw === "-") {
    return undefined;
  }
  if (raw === "N/D") {
    return { style: { color: MUTED, fontStyle: "italic" as const } };
  }

  if (isSponsorColumn(column)) {
    const s = String(raw).trim();
    if (s === "Exact") return { style: { color: POS }, icon: "✓", iconColor: POS };
    if (s === "Partial") return { style: { color: WARN }, icon: "◐", iconColor: WARN };
    if (s === "Unmatch") return { style: { color: NEG }, icon: "✗", iconColor: NEG };
  }

  if (column === "Ticker") {
    const cdInfo = parseCompletionDate(row["Completion Date"] ?? row.CD);
    if (cdInfo && !cdInfo.past && cdInfo.daysTo <= 7) {
      return { style: { color: ACCENT, fontWeight: "700" }, icon: "◷", iconColor: ACCENT };
    }
    if (rowIsPast(row)) {
      return { style: { color: MUTED, fontWeight: "600" } };
    }
  }

  if (column === "Completion Date" || column === "CD") {
    const cdInfo = parseCompletionDate(raw);
    if (!cdInfo) return undefined;
    if (cdInfo.past) return { style: { color: MUTED } };
    if (cdInfo.daysTo <= 7) {
      return { style: { color: ACCENT, fontWeight: "700" }, icon: "◷", iconColor: ACCENT };
    }
    if (cdInfo.daysTo <= 30) return { style: { color: ACCENT } };
  }

  if (column === "Data filing 8-K" || column.startsWith("Prima data 8")) {
    return { style: { color: MUTED } };
  }

  if (column.startsWith("Chiusura ($)") || column.includes("Chiusura ($)")) {
    const n = toSheetNum(raw);
    if (n !== null && n > 0) return { style: { color: ACCENT, fontWeight: "600" } };
  }

  if (column === "P&L ($)" || column === "P&L (%)") {
    const n = toSheetNum(raw);
    if (n !== null) {
      const pct = column === "P&L (%)" && Math.abs(n) <= 1.5 ? n * 100 : n;
      const { icon, iconColor } = sheetTrendIcon(pct);
      return { style: signedPctTextStyle(pct, 30), icon, iconColor };
    }
  }

  if (isPredDeltaColumn(column) || isPctLikeColumn(column)) {
    const pct = percentPointsFromStored(raw, column.startsWith("Affidabilità"));
    if (pct !== null) {
      const maxAbs = maxAbsForColumn(column);
      const { icon, iconColor } = sheetTrendIcon(pct);
      return { style: signedPctTextStyle(pct, maxAbs), icon, iconColor };
    }
  }

  if (column.startsWith("Affidabilità")) {
    const pct = percentPointsFromStored(raw, true);
    if (pct !== null) {
      if (pct >= 75) return { style: { color: POS, fontWeight: "600" } };
      if (pct < 55) return { style: { color: NEG } };
    }
  }

  return undefined;
}

export function fmtSharedPctCell(column: string, raw: unknown): string | null {
  if (!isPctLikeColumn(column) && !isPredDeltaColumn(column)) return null;
  if (raw === null || raw === undefined || raw === "") return null;
  const pct = percentPointsFromStored(raw, column.startsWith("Affidabilità"));
  if (pct === null) return null;
  const sign = pct > 0 ? "+" : "";
  const decimals = column.includes("Pred\n") || column.startsWith("Storico %") ? 1 : 2;
  return `${sign}${pct.toFixed(decimals)}%`;
}
