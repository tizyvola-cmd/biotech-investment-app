/** Legge colonne sim sheet per tabella Opportunities mobile (6 col). */
import { buildMobileOpportunities, type MobileOpportunity } from "./opportunityLogic";
import { parseNum, parseRaScoreFromRow, rowHasActivePortfolio, normalizedRowKey } from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export type SimTableRow = {
  key: string;
  ticker: string;
  ra: number | null;
  cd: string;
  varPct: number | null;
  roiPct: number | null;
  reliab: string;
  inPortfolio: boolean;
};

export type OppHorizon = "primary" | "early";

function findCol(cols: string[], kw: string): string | undefined {
  const lo = kw.toLowerCase();
  return cols.find((c) => c.toLowerCase().includes(lo));
}

function raFromRow(r: Record<string, unknown>): number | null {
  return parseRaScoreFromRow(r);
}

function varFromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Var. Giorn. %"]) ??
    parseNum(r["Var. Giorn %"]) ??
    parseNum(r["Var %"])
  );
}

function reliabLabel(r: Record<string, unknown>, affidPct: number | null): string {
  const col = findCol(Object.keys(r), "Affidabilit");
  const raw = col ? String(r[col] ?? "").trim().toUpperCase() : "";
  if (raw.includes("HIGH") || raw.includes("ALTA")) return "HIGH";
  if (raw.includes("GOOD") || raw.includes("BUON")) return "GOOD";
  if (raw.includes("MED")) return "MED";
  if (raw.includes("LOW") || raw.includes("BASS")) return "LOW";
  if (affidPct != null) {
    if (affidPct >= 70) return "HIGH";
    if (affidPct >= 55) return "GOOD";
    if (affidPct >= 40) return "MED";
    return "LOW";
  }
  return "—";
}

function oppToRow(
  opp: MobileOpportunity,
  row: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
): SimTableRow {
  const inPortfolio = row ? rowHasActivePortfolio(row, inputs) : false;
  const roi = opp.planReturnPct ?? opp.pred5;
  return {
    key: opp.key,
    ticker: opp.ticker,
    ra: row ? raFromRow(row) : null,
    cd: opp.completionDate,
    varPct: row ? varFromRow(row) : null,
    roiPct: roi,
    reliab: row ? reliabLabel(row, opp.affidPct) : "—",
    inPortfolio,
  };
}

export function buildSimTableRows(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  horizon: OppHorizon,
): SimTableRow[] {
  const { hot, watch } = buildMobileOpportunities(sheet, inputs);
  const opps = horizon === "primary" ? hot : watch;
  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of sheet?.rows ?? []) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    rowByKey.set(normalizedRowKey(tk, r["Completion Date"]), r);
  }
  return opps.map((o) => oppToRow(o, rowByKey.get(o.key), inputs));
}

export function countOpportunities(sheet: SheetTable | null, inputs: InvestSimInputs): number {
  return buildMobileOpportunities(sheet, inputs).all.length;
}

export function formatHorizonHint(horizon: OppHorizon, count: number): string {
  const zone = horizon === "primary" ? "Primary ≤2mo" : "Early 2–4mo";
  return `${count} opp · ${zone}`;
}
