import type { InvestSimHistoryPoint, InvestSimInputEntry, InvestSimInputs, SheetTable } from "./types";
import { getMobileLang, localeForLang } from "./langStorage";

export type SimulationPosition = {
  key: string;
  ticker: string;
  name: string;
  completionDate: string;
  currPrice: number | null;
  buyPrice: number;
  capital: number;
  shares: number;
  valueNow: number;
  pnlEur: number;
  pnlPct: number;
  pnlUnavailable: boolean;
};

export function normalizeCompletionDateForKey(cd: unknown): string {
  if (cd == null || cd === "" || cd === "—" || cd === "-") return "—";
  const s = String(cd).trim();
  if (!s || s === "—" || s === "-") return "—";
  const isoHead = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoHead) return isoHead[1];
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    const dt = new Date(ms);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s;
}

export function normalizedRowKey(ticker: string, cd: unknown): string {
  const tk = String(ticker ?? "")
    .trim()
    .toUpperCase();
  return `${tk}|${normalizeCompletionDateForKey(cd)}`;
}

export function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(String(v).replace(/\s/g, "").replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** RAscore / Recommendation Score 0–100 from Simulation row columns. */
export function parseRaScoreFromRow(row: Record<string, unknown>): number | null {
  for (const kw of ["rascore", "ra score", "recommendation score", "score ra", "ra "]) {
    const lo = kw.toLowerCase();
    const col = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (!col) continue;
    let v = parseNum(row[col]);
    if (v == null) continue;
    if (v >= 0 && v <= 1.5) v *= 100;
    return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
  }
  return null;
}

function mergedSimInputs(
  r: Record<string, unknown>,
  inp: InvestSimInputEntry
): { buyPrice: number; capital: number } {
  if (inp.ignoreSheet) return { buyPrice: 0, capital: 0 };
  const hasLocal = inp.buyPrice > 0 || inp.capital > 0;
  if (hasLocal) {
    return {
      buyPrice: inp.buyPrice > 0 ? inp.buyPrice : 0,
      capital: inp.capital > 0 ? inp.capital : 0,
    };
  }
  return {
    buyPrice: parseNum(r["Prezzo Acquisto ($)"]) ?? 0,
    capital: parseNum(r["Capitale Investito ($)"]) ?? 0,
  };
}

function sheetPnlPct(r: Record<string, unknown>): number | null {
  const raw = parseNum(r["P&L (%)"]);
  if (raw === null) return null;
  return Math.abs(raw) <= 1.5 ? raw * 100 : raw;
}

export function currentPriceFromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Prezzo Corrente ($)"]) ??
    parseNum(r["Prezzo Corrente"]) ??
    parseNum(r["Prezzo Attuale"]) ??
    null
  );
}

export function computeSimulationPosition(
  r: Record<string, unknown>,
  inputs: InvestSimInputs
): SimulationPosition | null {
  const ticker = String(r.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return null;
  const cd = String(r["Completion Date"] ?? "—");
  const key = normalizedRowKey(ticker, cd);
  const curr = currentPriceFromRow(r);
  const inp = mergedSimInputs(r, inputs[key] ?? { buyPrice: 0, capital: 0 });
  const buyPrice = inp.buyPrice > 0 ? inp.buyPrice : 0;
  const capital = inp.capital > 0 ? inp.capital : 0;
  let shares = 0;
  let valueNow = 0;
  let pnlEur = 0;
  let pnlPct = 0;
  let pnlUnavailable = false;
  if (capital > 0 && buyPrice <= 0) {
    pnlUnavailable = true;
  } else if (buyPrice > 0 && capital > 0) {
    shares = capital / buyPrice;
    if (curr != null && curr > 0) {
      valueNow = shares * curr;
      pnlEur = valueNow - capital;
      pnlPct = ((curr - buyPrice) / buyPrice) * 100;
    } else {
      pnlUnavailable = true;
      const sheetPct = sheetPnlPct(r);
      const sheetEur = parseNum(r["P&L ($)"]);
      if (sheetPct !== null) pnlPct = sheetPct;
      if (sheetEur !== null) pnlEur = sheetEur;
    }
  }
  return {
    key,
    ticker,
    name: String(r.Nome ?? r.Company ?? r["Società"] ?? ""),
    completionDate: cd,
    currPrice: curr,
    buyPrice,
    capital,
    shares,
    valueNow,
    pnlEur,
    pnlPct,
    pnlUnavailable,
  };
}

export function rowHasActivePortfolio(row: Record<string, unknown>, inputs: InvestSimInputs): boolean {
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return false;
  const key = normalizedRowKey(ticker, String(row["Completion Date"] ?? "—"));
  if (inputs[key]?.ignoreSheet) return false;
  const pos = computeSimulationPosition(row, inputs);
  return pos != null && pos.capital > 0;
}

export function buildPositions(simTable: SheetTable | null, inputs: InvestSimInputs): SimulationPosition[] {
  const out: SimulationPosition[] = [];
  for (const r of simTable?.rows ?? []) {
    const p = computeSimulationPosition(r, inputs);
    if (p) out.push(p);
  }
  return out;
}

export function buildSimRowByKeyMap(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const tk = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    map.set(normalizedRowKey(tk, row["Completion Date"]), row);
  }
  return map;
}

/** Pred +5 in percentage points (aligned with desktop Top Opportunities). */
export function pred5FromRow(r: Record<string, unknown>): number | null {
  const direct =
    parseNum(r["Pred +5"]) ??
    parseNum(r["Pred +5 (%)"]) ??
    parseNum(r["pred5"]) ??
    parseNum(r["Pred5"]);
  if (direct != null) return Math.abs(direct) <= 1.5 ? direct * 100 : direct;
  const pred4 = parseNum(r["Pred +4"]);
  const pred7 = parseNum(r["Pred +7"]);
  let pred5: number | null = null;
  if (pred4 != null && pred7 != null) pred5 = pred4 + (pred7 - pred4) * (1 / 3);
  else if (pred7 != null) pred5 = pred7;
  else if (pred4 != null) pred5 = pred4;
  if (pred5 == null) return null;
  return Math.abs(pred5) <= 1.5 ? pred5 * 100 : pred5;
}

export function fmtUsd(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "N/D";
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPct(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "N/D";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtEur(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "N/D";
  const sign = n > 0 ? "+" : "";
  const locale = localeForLang(getMobileLang());
  return `${sign}€ ${Math.abs(n).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function purchaseDateToIso(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function inferInvestedAtFromHistory(
  key: string,
  history: InvestSimHistoryPoint[],
): string | null {
  for (const h of history) {
    if (h.byTicker[key] != null) return h.ts;
  }
  return null;
}

export function resolveInvestedAt(
  key: string,
  entry: InvestSimInputEntry | undefined,
  history: InvestSimHistoryPoint[],
): string | null {
  if (entry?.purchaseDate) {
    const iso = purchaseDateToIso(entry.purchaseDate);
    if (iso) return iso;
  }
  const fromHistory = inferInvestedAtFromHistory(key, history);
  const stored = entry?.investedAt?.trim();
  if (!stored) return fromHistory;
  if (!fromHistory) return stored;
  const storedMs = Date.parse(stored);
  const histMs = Date.parse(fromHistory);
  if (Number.isFinite(storedMs) && Number.isFinite(histMs) && histMs < storedMs) {
    return fromHistory;
  }
  return stored;
}

export function holdingDayFractionFromInvestedAt(
  iso?: string | null,
  endIso?: string | null,
): number | null {
  if (!iso) return null;
  const startMs = Date.parse(iso);
  if (!Number.isFinite(startMs)) return null;
  const endMs = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / 86_400_000);
}

export function holdingDaysFromInvestedAt(iso?: string | null, endIso?: string | null): number | null {
  const frac = holdingDayFractionFromInvestedAt(iso, endIso);
  if (frac == null) return null;
  return Math.max(0, Math.round(frac));
}
