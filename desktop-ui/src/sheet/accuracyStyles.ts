import {
  directionHit,
  parseNum,
  storicoColumn,
  v4PredColumn,
} from "./accuracyMetrics";
import type { CellStyle } from "./variationColors";
import {
  sheetTrendIcon,
  signedPctTextStyle,
} from "./sharedTableCellStyle";

import { TABLE_COLORS_ENABLED } from "./tableColorsEnabled";

const HIT_FLAT_BAND_PP = 0.5;
const POS = "rgb(var(--positive))";
const NEG = "rgb(var(--negative))";
const ACCENT = "rgb(var(--accent))";
const WARN = "rgb(var(--warn))";
const MUTED = "rgb(var(--ink-muted))";

export type AccuracyColumnKind =
  | "meta"
  | "ticker"
  | "cd"
  | "sponsor"
  | "daysToCd"
  | "price"
  | "sessionDate"
  | "storico"
  | "predV4"
  | "predV5"
  | "delta";

export function classifyAccuracyColumn(column: string): AccuracyColumnKind {
  const c = column.trim();
  if (c === "Ticker") return "ticker";
  if (c === "CD" || c === "Completion Date") return "cd";
  if (c.includes("Exact") && c.includes("Unmatch")) return "sponsor";
  if (c.toLowerCase().includes("sponsor") && c.toLowerCase().includes("match")) return "sponsor";
  if (c.includes("CD − oggi") || c.includes("CD - oggi")) return "daysToCd";
  if (c.includes("Prezzo stock")) return "price";
  if (c.startsWith("Data T")) return "sessionDate";
  if (c.startsWith("Storico %")) return "storico";
  if (c.includes("Δ% vs Pred")) return "predV4";
  if (c.startsWith("Pred v5")) return "predV5";
  if (c.includes("Pred−Stor") || c.includes("Pred-Stor")) return "delta";
  return "meta";
}

/** Ultima riga intestazione → offset orizzonte (es. T+7 → 7). */
export function parseHorizonFromColumn(column: string): number | null {
  const parts = column
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const tail = parts[parts.length - 1].replace(/−/g, "-");
  const normalized = tail.startsWith("T") ? tail.slice(1) : tail;
  const m = /^([+\-]?\d+)$/.exec(normalized);
  if (!m) return null;
  return Number(m[1]);
}

export function formatAccuracyColumnHeader(column: string): string {
  const kind = classifyAccuracyColumn(column);
  const off = parseHorizonFromColumn(column);
  const offLabel = off == null ? null : off > 0 ? `+${off}` : String(off);

  if (kind === "storico" && offLabel) return `Stor ${offLabel}`;
  if (kind === "predV4" && offLabel) return `Pred ${offLabel}`;
  if (kind === "predV5" && offLabel) return `V5 ${offLabel}`;
  if (kind === "delta" && offLabel) return `Δ ${offLabel}`;

  const lines = column.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1) return lines.join(" · ");
  return column;
}

export type AccuracyStyleContext = {
  priceBar: { min: number; max: number } | null;
};

export function buildAccuracyStyleContext(
  rows: Record<string, unknown>[]
): AccuracyStyleContext {
  const priceCol = rows[0]
    ? Object.keys(rows[0]).find((k) => k.includes("Prezzo stock"))
    : undefined;
  let priceBar: { min: number; max: number } | null = null;
  if (priceCol) {
    const nums = rows
      .map((r) => parseNum(r[priceCol]))
      .filter((n): n is number => n !== null);
    if (nums.length) {
      priceBar = { min: Math.min(...nums), max: Math.max(...nums) };
    }
  }
  return { priceBar };
}

export type AccuracyCellExtras = {
  style?: CellStyle;
  icon?: string;
  iconColor?: string;
};


function percentPointsFromStored(raw: unknown): number | null {
  const n = parseNum(raw);
  if (n === null) return null;
  if (Math.abs(n) <= 1.5 && !String(raw).includes("%")) return n * 100;
  return n;
}

function hitIcon(pred: number, actual: number): { icon: string; iconColor: string } {
  if (directionHit(pred, actual, HIT_FLAT_BAND_PP)) {
    return { icon: "✓", iconColor: POS };
  }
  return { icon: "✗", iconColor: NEG };
}

function rowIsPast(row: Record<string, unknown>): boolean {
  const cd = String(row.CD ?? row["Completion Date"] ?? "").trim();
  if (!cd || cd === "—") return false;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cd);
  if (!m) return true;
  const [, d, mo, y] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dt.getTime() < today.getTime();
}

export function accuracyCellStyle(
  column: string,
  raw: unknown,
  row: Record<string, unknown>,
  _ctx: AccuracyStyleContext
): AccuracyCellExtras | undefined {
  if (!TABLE_COLORS_ENABLED) return undefined;
  if (raw === null || raw === undefined || raw === "" || raw === "—" || raw === "-") {
    return undefined;
  }

  const kind = classifyAccuracyColumn(column);

  if (kind === "ticker") {
    if (rowIsPast(row)) return { style: { color: MUTED, fontWeight: "600" } };
    return { style: { color: ACCENT, fontWeight: "700" } };
  }

  if (kind === "cd") {
    if (!String(raw).trim() || String(raw).trim() === "—") return undefined;
    const past = rowIsPast(row);
    if (past) return { style: { color: MUTED } };
    return { style: { color: ACCENT } };
  }

  if (kind === "sponsor") {
    const s = String(raw).trim().toLowerCase();
    if (s === "exact") return { style: { color: POS }, icon: "✓", iconColor: POS };
    if (s === "partial") return { style: { color: WARN }, icon: "◐", iconColor: WARN };
    if (s === "unmatch") return { style: { color: NEG }, icon: "✗", iconColor: NEG };
    return undefined;
  }

  if (kind === "daysToCd") {
    const n = parseNum(raw);
    if (n === null) return undefined;
    if (n < 0) return { style: { color: MUTED } };
    if (n <= 7) {
      return { style: { color: ACCENT, fontWeight: "600" }, icon: "◷", iconColor: ACCENT };
    }
    return { style: { color: POS } };
  }

  if (kind === "sessionDate") {
    return { style: { color: MUTED } };
  }

  if (kind === "storico" || kind === "predV4" || kind === "predV5") {
    const pct = percentPointsFromStored(raw);
    if (pct !== null) {
      const { icon, iconColor } = sheetTrendIcon(pct);
      return { style: signedPctTextStyle(pct, 25), icon, iconColor };
    }
  }

  if (kind === "delta") {
    const err = percentPointsFromStored(raw);
    if (err !== null) {
      const { icon, iconColor } = sheetTrendIcon(err);
      let extras: AccuracyCellExtras = {
        style: signedPctTextStyle(err, 30),
        icon,
        iconColor,
      };
      const off = parseHorizonFromColumn(column);
      if (off !== null) {
        const pred = parseNum(row[v4PredColumn(off)]);
        const actual = parseNum(row[storicoColumn(off)]);
        if (pred !== null && actual !== null) {
          const hit = hitIcon(pred, actual);
          extras = { ...extras, icon: hit.icon, iconColor: hit.iconColor };
        }
      }
      return extras;
    }
  }

  return undefined;
}

export function fmtAccuracyCell(column: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "string" && (raw === "—" || raw === "-")) return "—";

  const kind = classifyAccuracyColumn(column);
  if (
    kind === "storico" ||
    kind === "predV4" ||
    kind === "predV5" ||
    kind === "delta"
  ) {
    const pct = percentPointsFromStored(raw);
    if (pct !== null) {
      const sign = pct > 0 ? "+" : "";
      return `${sign}${pct.toFixed(1)}%`;
    }
  }

  if (kind === "price" && typeof raw === "number") {
    return raw >= 100 ? raw.toFixed(2) : raw.toFixed(3);
  }

  if (typeof raw === "number") {
    if (Number.isInteger(raw)) return String(raw);
    return Math.abs(raw) >= 100 ? raw.toFixed(1) : raw.toFixed(2);
  }

  return String(raw);
}

/** Colonne con scala colore predefinita (legenda toolbar). */
export const ACC_COLOR_SCALE_GROUPS = [
  { label: "Storico % / Pred v4 / Pred v5", hint: "▲ verde · ● neutro · ▼ rosso" },
  { label: "Δ Pred−Stor", hint: "colore segno errore · ✓/✗ direzione vs storico" },
] as const;
