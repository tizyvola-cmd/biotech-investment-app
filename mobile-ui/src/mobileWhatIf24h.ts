/**
 * Compact 24h what-if ($5k/name) for mobile Dashboard — mirrors desktop simUniverse24hWhatIf.
 */
import {
  normalizedRowKey,
  parseNum,
  rowHasActivePortfolio,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export const MOBILE_WHATIF_CAPITAL = 5000;

export type MobileWhatIfRow = {
  key: string;
  ticker: string;
  inPortfolio: boolean;
  d1: number | null;
  pnlEur: number | null;
  g10: number | null;
  pCont: number | null;
  windKind: "declining" | "early_run" | "pct" | "none";
  strongWind: boolean;
};

export type MobileWhatIfScope = "all" | "portfolio" | "off";

export type MobileWhatIfBundle = {
  capitalPerTicker: number;
  rows: MobileWhatIfRow[];
  nAll: number;
  nPortfolio: number;
  nOff: number;
  pfPnlEur: number;
  uniPnlEur: number;
  capturePct: number | null;
  missedUpsideEur: number;
};

function varFromRow(r: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = parseNum(r[k]);
    if (v != null) return v;
  }
  const cols = Object.keys(r);
  for (const kw of keys) {
    const lo = kw.toLowerCase();
    const col = cols.find((c) => c.toLowerCase().includes(lo));
    if (!col) continue;
    const v = parseNum(r[col]);
    if (v != null) return v;
  }
  return null;
}

function resolvePCont(r: Record<string, unknown>): number | null {
  const p =
    parseNum(r["p_continuation"]) ??
    parseNum(r["p_cont"]) ??
    parseNum(r["cont_p_pop"]);
  if (p == null) return null;
  return Math.abs(p) <= 1.5 ? p * 100 : p;
}

function resolveG10(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["cont_g10"]) ??
    varFromRow(r, "Var. 10d %", "Var. 10g %", "10d %", "10g %")
  );
}

function resolveEdge(r: Record<string, unknown>): number | null {
  return parseNum(r["cont_sell_edge"]) ?? parseNum(r["cont_edge"]);
}

function windKindFor(
  g10: number | null,
  pCont: number | null,
  band: string | null,
): MobileWhatIfRow["windKind"] {
  if (band === "declining" || (g10 != null && g10 < 0)) return "declining";
  if (band === "not_run" || (g10 != null && g10 >= 0 && g10 < 5 && pCont == null)) {
    return "early_run";
  }
  if (pCont != null && Number.isFinite(pCont)) return "pct";
  if (band === "not_run") return "early_run";
  return "none";
}

function isStrongWind(
  g10: number | null,
  pCont: number | null,
  d1: number | null,
  edge: number | null,
): boolean {
  if (g10 == null || g10 < 5) return false;
  if (pCont == null || pCont < 50) return false;
  if (d1 != null && d1 < 0) return false;
  if (edge != null && edge > 0) return false;
  return true;
}

export function buildMobileWhatIf24h(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  capitalPerTicker = MOBILE_WHATIF_CAPITAL,
): MobileWhatIfBundle | null {
  const rowsIn = sheet?.rows ?? [];
  if (!rowsIn.length) return null;

  const rows: MobileWhatIfRow[] = [];
  for (const r of rowsIn) {
    const ticker = String(r.Ticker ?? r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || ticker.includes("TOTALE") || ticker.includes("METRICHE")) continue;
    const cd = r["Completion Date"] ?? r.cd ?? "—";
    const key = normalizedRowKey(ticker, cd);
    const d1 =
      varFromRow(r, "Var. Giorn. %", "Var. Giorn %", "Var. Giornaliera %") ??
      parseNum(r["Var. 1d %"]);
    const g10 = resolveG10(r);
    const pCont = resolvePCont(r);
    const edge = resolveEdge(r);
    const band = String(r["cont_band"] ?? r["contBand"] ?? "")
      .trim()
      .toLowerCase() || null;
    const hasPct = d1 != null && Number.isFinite(d1);
    const pnlEur = hasPct
      ? Math.round(((capitalPerTicker * d1!) / 100) * 100) / 100
      : null;
    rows.push({
      key,
      ticker,
      inPortfolio: rowHasActivePortfolio(r, inputs),
      d1: hasPct ? Math.round(d1! * 100) / 100 : null,
      pnlEur,
      g10: g10 != null ? Math.round(g10 * 100) / 100 : null,
      pCont: pCont != null ? Math.round(pCont) : null,
      windKind: windKindFor(g10, pCont, band),
      strongWind: isStrongWind(g10, pCont, d1, edge),
    });
  }
  if (!rows.length) return null;

  rows.sort((a, b) => (b.pnlEur ?? -Infinity) - (a.pnlEur ?? -Infinity));

  const pf = rows.filter((r) => r.inPortfolio);
  const off = rows.filter((r) => !r.inPortfolio);
  const sumPnl = (list: MobileWhatIfRow[]) =>
    list.reduce((s, r) => s + (r.pnlEur ?? 0), 0);
  const sumUpside = (list: MobileWhatIfRow[]) =>
    list.reduce((s, r) => s + Math.max(0, r.pnlEur ?? 0), 0);
  const pfPnl = sumPnl(pf);
  const uniPnl = sumPnl(rows);
  const pfUp = sumUpside(pf);
  const uniUp = sumUpside(rows);
  const capturePct =
    uniUp > 0 ? Math.round((pfUp / uniUp) * 1000) / 10 : null;

  return {
    capitalPerTicker,
    rows,
    nAll: rows.length,
    nPortfolio: pf.length,
    nOff: off.length,
    pfPnlEur: Math.round(pfPnl),
    uniPnlEur: Math.round(uniPnl),
    capturePct,
    missedUpsideEur: Math.max(0, Math.round(uniUp - pfUp)),
  };
}

export function filterMobileWhatIfRows(
  rows: MobileWhatIfRow[],
  scope: MobileWhatIfScope,
): MobileWhatIfRow[] {
  if (scope === "portfolio") return rows.filter((r) => r.inPortfolio);
  if (scope === "off") return rows.filter((r) => !r.inPortfolio);
  return rows;
}
