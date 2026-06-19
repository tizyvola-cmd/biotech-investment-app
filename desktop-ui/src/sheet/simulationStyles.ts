import {
  signedPctStyle,
  type CellStyle,
} from "./variationColors";
import { fmtPortfolioPnlPct, fmtPortfolioPnlUsd } from "./portfolioGainLossStyle";
import { TABLE_COLORS_ENABLED } from "./tableColorsEnabled";

/** Display order for var.%: long horizon → short. */
export const SIM_VAR_COLUMNS_ORDER = [
  "Var. 6M %",
  "Var. 3M %",
  "Var. 1M %",
  "Var. Giorn. %",
] as const;

export const SIM_COLOR_SCALE_COLUMNS = SIM_VAR_COLUMNS_ORDER;

export const SIM_VAR_HORIZON_LABELS = ["6M", "3M", "1M", "7d", "1d"] as const;

/** Etichette legacy nello snapshot JSON (es. «1g») → etichette UI. */
const VAR_HORIZON_LABEL_ALIASES: Record<string, string[]> = {
  "6M": ["6M"],
  "3M": ["3M"],
  "1M": ["1M"],
  "7d": ["7d", "7D", "7g", "7G"],
  "1d": ["1d", "1g"],
};

/** % variazione per orizzonte dal bundle grafici (tollera alias «1g»). */
export function resolveVarHorizonPct(
  horizons: { label: string; pct: number | null }[] | undefined,
  horizon: (typeof SIM_VAR_HORIZON_LABELS)[number],
): number | null {
  if (!horizons?.length) return null;
  const aliases = VAR_HORIZON_LABEL_ALIASES[horizon] ?? [horizon];
  for (const a of aliases) {
    const h = horizons.find((x) => x.label === a);
    if (h?.pct != null && h.pct === h.pct) return h.pct;
  }
  return null;
}

/** Reorders the Var.% block while keeping the other columns in their original position. */
export function orderSimulationColumns(columns: string[]): string[] {
  const varSet = new Set<string>(SIM_VAR_COLUMNS_ORDER);
  const presentVars = SIM_VAR_COLUMNS_ORDER.filter((c) => columns.includes(c));
  if (presentVars.length === 0) return [...columns];

  const out: string[] = [];
  let varsPlaced = false;
  for (const c of columns) {
    if (varSet.has(c)) {
      if (!varsPlaced) {
        out.push(...presentVars);
        varsPlaced = true;
      }
    } else {
      out.push(c);
    }
  }
  if (!varsPlaced) out.push(...presentVars);
  return out;
}

export const SIM_DATA_BAR_COLUMNS = ["Market Cap", "Prezzo Corrente ($)"] as const;

const VAR_MAX_ABS: Record<string, number> = {
  "Var. Giorn. %": 5,
  "Var. 1M %": 15,
  "Var. 3M %": 25,
  "Var. 6M %": 40,
};

const POS = "rgb(var(--positive))";
const NEG = "rgb(var(--negative))";
const ACCENT = "rgb(var(--accent))";
const MUTED = "rgb(var(--ink-muted))";

export const SIM_LEGEND_GROUPS = [
  {
    label: "Var. % (6M · 3M · 1M · day)",
    hint: "green = rise · red = decline · arrows ↑↓ trend",
  },
  {
    label: "P&L ($) / P&L (%)",
    hint: "green/red for gain/loss",
  },
  {
    label: "Completion Date / Ticker",
    hint: "accent on imminent catalyst (≤7 d)",
  },
] as const;

export type SimulationStyleContext = {
  colorScaleByColumn: Map<string, unknown>;
  dataBarByColumn: Map<string, { min: number; max: number }>;
};

export type SimulationCellExtras = {
  style?: CellStyle;
  icon?: string;
  iconColor?: string;
};

export function formatSimulationColumnHeader(column: string): string {
  const lines = column.split("\n").map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].includes("Δ% vs Pred")) {
    const off = lines[lines.length - 1];
    if (/^[+−\-]?\d+$/.test(off)) {
      return `T${off}`;
    }
  }
  if (lines.length > 1) return lines.join(" · ");
  return column;
}

export function isSimulationPredColumn(column: string): boolean {
  return column.includes("Δ% vs Pred");
}

export function buildSimulationStyleContext(
  _rows: Record<string, unknown>[]
): SimulationStyleContext {
  return {
    colorScaleByColumn: new Map(),
    dataBarByColumn: new Map(),
  };
}

/** Row background removed — redundant with P&L cell color. */
export function simulationRowStyle(_row: Record<string, unknown>): CellStyle | undefined {
  return undefined;
}

export function simulationCellStyle(
  column: string,
  raw: unknown,
  row: Record<string, unknown>,
  _ctx: SimulationStyleContext
): SimulationCellExtras | undefined {
  if (!TABLE_COLORS_ENABLED) return undefined;

  if (raw === null || raw === undefined || raw === "" || raw === "—" || raw === "-") {
    return undefined;
  }
  if (raw === "N/D") {
    return { style: { color: MUTED, fontStyle: "italic" as const } };
  }

  const col = column;

  // Var. % columns — text color + icon only, no background
  if ((SIM_COLOR_SCALE_COLUMNS as readonly string[]).includes(col)) {
    const n = toNum(raw);
    if (n !== null) {
      const maxAbs = VAR_MAX_ABS[col] ?? 20;
      const { icon, iconColor } = trendIcon(n);
      const style = signedPctStyleTextOnly(n, maxAbs);
      return { style, icon, iconColor };
    }
  }

  // Prezzo Acquisto — ↑/↓ icon + text color only
  if (col === "Prezzo Acquisto ($)") {
    const buy = toNum(raw);
    const curr = toNum(row["Prezzo Corrente ($)"]);
    if (buy !== null && curr !== null && buy > 0) {
      const diffPct = ((curr - buy) / buy) * 100;
      if (diffPct > 0.5) return { style: { color: POS, fontWeight: "600" }, icon: "▲", iconColor: POS };
      if (diffPct < -0.5) return { style: { color: NEG, fontWeight: "600" }, icon: "▼", iconColor: NEG };
    }
  }

  // Valore Attuale — text color only
  if (col === "Valore Attuale ($)") {
    const val = toNum(raw);
    const cap = toNum(row["Capitale Investito ($)"]);
    if (val !== null && cap !== null && cap > 0) {
      const diff = val - cap;
      if (diff > 0) return { style: { color: POS, fontWeight: "600" } };
      if (diff < 0) return { style: { color: NEG, fontWeight: "600" } };
    }
  }

  // R² fit — red only when very weak (< 0.3)
  if (col === "R² fit") {
    const n = toNum(raw);
    if (n !== null && n < 0.3) {
      return { style: { color: NEG, fontWeight: "600" } };
    }
    return undefined;
  }

  // Liquidità — only flag risk (CR < 1)
  if (col === "Liquidità (FY)") {
    const cr = parseCurrentRatio(String(raw));
    if (cr !== null && cr < 1) {
      return { style: { color: NEG, fontWeight: "600" } };
    }
  }

  // Ticker — only highlight imminent catalyst (≤7 days)
  if (col === "Ticker") {
    const cdInfo = parseCompletionDate(row["Completion Date"]);
    if (cdInfo !== null && !cdInfo.past && cdInfo.daysTo <= 7) {
      return { style: { color: ACCENT, fontWeight: "700" }, icon: "◷", iconColor: ACCENT };
    }
    return undefined;
  }

  // Completion Date — accent text for imminent, muted for past, plain otherwise
  if (col === "Completion Date") {
    const cdInfo = parseCompletionDate(raw);
    if (!cdInfo) return undefined;
    if (cdInfo.past) return { style: { color: MUTED } };
    if (cdInfo.daysTo <= 7) {
      return { style: { color: ACCENT, fontWeight: "700" }, icon: "◷", iconColor: ACCENT };
    }
    if (cdInfo.daysTo <= 30) {
      return { style: { color: ACCENT } };
    }
    return undefined;
  }

  // Exact/Partial/Unmatch — icon + text color, no background
  if (col === "Exact·Partial vs Unmatch") {
    const s = String(raw).trim();
    if (s === "Exact") return { style: { color: POS }, icon: "✓", iconColor: POS };
    if (s === "Partial") return { style: { color: "rgb(var(--warn))" }, icon: "◐", iconColor: "rgb(var(--warn))" };
    if (s === "Unmatch") return { style: { color: NEG }, icon: "✗", iconColor: NEG };
  }

  // Pred delta columns — text color + icon
  if (isPredDeltaColumn(col)) {
    const pct = percentPointsFromStored(raw);
    if (pct !== null) {
      const { icon, iconColor } = trendIcon(pct);
      const style = signedPctStyleTextOnly(pct, 25);
      return { style, icon, iconColor };
    }
  }

  // Affidabilità — text color only
  if (col.startsWith("Affidabilità")) {
    const pct = percentPointsFromStored(raw, true);
    if (pct !== null) {
      if (pct >= 75) return { style: { color: POS, fontWeight: "600" } };
      if (pct < 55) return { style: { color: NEG } };
    }
    return undefined;
  }

  // Pred empirica / Δ mod vs emp — green only for positive, plain otherwise
  if (col === "Pred empirica\n+5gg (%)") {
    const pct = percentPointsFromStored(raw);
    if (pct !== null && pct > 0.05) return { style: { color: POS, fontWeight: "600" } };
    return undefined;
  }

  if (col === "Δ mod vs emp\n+5 (pp)") {
    const pp = toNum(raw);
    if (pp !== null && pp > 0.05) return { style: { color: POS, fontWeight: "600" } };
    return undefined;
  }

  // P&L — light background + text color (functional: portfolio health)
  if (col === "P&L ($)" || col === "P&L (%)") {
    const n = toNum(raw);
    if (n !== null) {
      const pct = col === "P&L (%)" && Math.abs(n) <= 1.5 ? n * 100 : n;
      const { icon, iconColor } = trendIcon(pct);
      const style = signedPctStyle(pct, { maxAbs: 30, boldThreshold: 5 });
      return { style: style ?? undefined, icon, iconColor };
    }
  }

  // TBD — italic hint only
  const s = String(raw).trim();
  if (s === "TBD") {
    return { style: { color: MUTED, fontStyle: "italic" as const } };
  }

  return undefined;
}

export function fmtSimulationCell(column: string, raw: unknown): string {
  if (raw === "N/D") return "N/D";
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "string" && (raw === "—" || raw === "-")) return "—";

  if (column === "N° Azioni Implicite" && typeof raw === "number") {
    return raw >= 1000 ? raw.toFixed(2) : raw.toFixed(4);
  }

  if (column === "Valore Attuale ($)" && typeof raw === "number") {
    return `$ ${raw.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  if (column === "P&L ($)" && typeof raw === "number") {
    return fmtPortfolioPnlUsd(raw);
  }

  if (column === "P&L (%)" && typeof raw === "number") {
    return fmtPortfolioPnlPct(raw);
  }

  if ((SIM_COLOR_SCALE_COLUMNS as readonly string[]).includes(column)) {
    const n = toNum(raw);
    if (n !== null) {
      const sign = n > 0 ? "+" : "";
      return `${sign}${n.toFixed(2)}%`;
    }
  }

  if (isPredDeltaColumn(column)) {
    const pct = percentPointsFromStored(raw);
    if (pct !== null) {
      const sign = pct > 0 ? "+" : "";
      return `${sign}${pct.toFixed(1)}%`;
    }
  }

  if (column.startsWith("Affidabilità")) {
    const pct = percentPointsFromStored(raw, true);
    if (pct !== null) return `${Math.round(pct)}%`;
  }

  if (column === "Pred empirica\n+5gg (%)") {
    const pct = percentPointsFromStored(raw);
    if (pct !== null) {
      const sign = pct > 0 ? "+" : "";
      return `${sign}${pct.toFixed(2)}%`;
    }
  }

  if (column === "Δ mod vs emp\n+5 (pp)") {
    const pp = toNum(raw);
    if (pp !== null) {
      const sign = pp > 0 ? "+" : "";
      return `${sign}${pp.toFixed(1)} pp`;
    }
  }

  if (column === "P&L (%)" && typeof raw === "number" && Math.abs(raw) <= 1.5) {
    return `${(raw * 100).toFixed(2)}%`;
  }

  if (column === "Market Cap" && typeof raw === "number") {
    const abs = Math.abs(raw);
    if (abs >= 1e9) return `${(raw / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(raw / 1e6).toFixed(0)}M`;
  }

  if (typeof raw === "number") {
    if (Number.isInteger(raw)) return String(raw);
    return Math.abs(raw) >= 100 ? raw.toFixed(1) : raw.toFixed(2);
  }

  return String(raw);
}

function trendIcon(pct: number): { icon: string; iconColor: string } {
  if (Math.abs(pct) < 0.05) return { icon: "●", iconColor: MUTED };
  if (pct > 0) return { icon: "▲", iconColor: POS };
  return { icon: "▼", iconColor: NEG };
}

/** Text color only — no background fill. */
function signedPctStyleTextOnly(n: number, maxAbs: number): CellStyle {
  if (Math.abs(n) < 0.05) return { color: MUTED };
  const bold = Math.abs(n) >= maxAbs * 0.35;
  if (n > 0) return { color: POS, fontWeight: bold ? "700" : "400" };
  return { color: NEG, fontWeight: bold ? "700" : "400" };
}

function parseCurrentRatio(s: string): number | null {
  const m = /CR\s*([\d.]+)/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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
  const diffMs = dt.getTime() - today.getTime();
  const daysTo = Math.round(diffMs / 86_400_000);
  return { past: daysTo < 0, daysTo };
}

function isPredDeltaColumn(col: string): boolean {
  return col.includes("Δ% vs Pred") || (col.includes("Pred") && col.includes("Δ%"));
}

function percentPointsFromStored(raw: unknown, forceFraction = false): number | null {
  const n = toNum(raw);
  if (n === null) return null;
  if (forceFraction || (Math.abs(n) <= 1.5 && !String(raw).includes("%"))) {
    return n * 100;
  }
  return n;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "-" || v === "N/D")
    return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
