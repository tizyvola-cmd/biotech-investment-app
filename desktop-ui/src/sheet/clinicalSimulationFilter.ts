import type { SheetTable } from "../types";
import { looksLikeTicker } from "./simulationTickers";
import { nctClinicalTrialsUrl, sheetCellAsLink, sheetCellPlainText } from "./cellLinks";

/** Prossimo catalyst Simulation: solo CD futuro entro questa finestra (≈2 mesi). */
export const CLINICAL_MAX_CD_DAYS = 60;

export type SimCdCatalyst = {
  ticker: string;
  completionDate: string;
  completionDateDisplay: string;
  nct: string | null;
  company: string;
  studyHref: string | null;
  daysToCd: number | null;
};

function normDateKey(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s || s === "—") return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
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
  return "";
}

export function normNctId(v: unknown): string | null {
  const s = sheetCellPlainText(v).trim().toUpperCase();
  const m = /^NCT\d{8,}/.exec(s.replace(/\s/g, ""));
  return m ? m[0] : null;
}

function studyHrefFromCell(v: unknown): string | null {
  const link = sheetCellAsLink(v);
  if (link?.href) return link.href;
  const nct = normNctId(v);
  return nct ? nctClinicalTrialsUrl(nct) : null;
}

function daysFromToday(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function formatDateIt(iso: string, fallback: string): string {
  if (!iso) return fallback || "—";
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return fallback || iso;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Una riga Simulation per ticker: prossimo CD futuro entro CLINICAL_MAX_CD_DAYS. */
export function buildSimulationCdCatalog(simTable: SheetTable | null): Map<string, SimCdCatalyst> {
  const byTicker = new Map<string, Record<string, unknown>[]>();
  for (const row of simTable?.rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!looksLikeTicker(tk)) continue;
    const list = byTicker.get(tk) ?? [];
    list.push(row);
    byTicker.set(tk, list);
  }

  const catalog = new Map<string, SimCdCatalyst>();
  for (const [tk, rows] of byTicker) {
    let best: Record<string, unknown> | null = null;
    let bestDays: number | null = null;

    for (const row of rows) {
      const iso = normDateKey(row["Completion Date"]);
      if (!iso) continue;
      const days = daysFromToday(iso);
      if (days == null || days < 0 || days > CLINICAL_MAX_CD_DAYS) continue;
      if (bestDays == null || days < bestDays) {
        best = row;
        bestDays = days;
      }
    }

    if (!best) continue;
    const iso = normDateKey(best["Completion Date"]);
    const nct = normNctId(best.NCT ?? best.nct);
    catalog.set(tk, {
      ticker: tk,
      completionDate: iso,
      completionDateDisplay: formatDateIt(iso, String(best["Completion Date"] ?? "")),
      nct,
      company: String(best.Società ?? best.Nome ?? best.Company ?? "").trim(),
      studyHref:
        studyHrefFromCell(best["Link studio"]) ??
        (nct ? nctClinicalTrialsUrl(nct) : null),
      daysToCd: bestDays,
    });
  }
  return catalog;
}

function clinicalTicker(row: Record<string, unknown>): string {
  return String(row.ticker ?? row.Ticker ?? row.symbol ?? row.Symbol ?? "")
    .trim()
    .toUpperCase();
}

const CLINICAL_CD_COLUMNS = ["completion_date", "estimated_completion_date"] as const;

function findClinicalDateColumns(columns: string[]): string[] {
  return CLINICAL_CD_COLUMNS.filter((c) => columns.includes(c));
}

function findNctColumn(columns: string[]): string | null {
  for (const c of columns) {
    const low = c.toLowerCase();
    if (low === "nct_id" || low === "nctid" || low === "nct") return c;
  }
  return null;
}

function clinicalRowDateKeys(row: Record<string, unknown>, columns: string[]): string[] {
  const out: string[] = [];
  for (const col of findClinicalDateColumns(columns)) {
    const iso = normDateKey(row[col]);
    if (iso) out.push(iso);
  }
  return [...new Set(out)];
}

export function clinicalRowMatchesCatalyst(
  row: Record<string, unknown>,
  catalyst: SimCdCatalyst,
  columns: string[]
): boolean {
  if (clinicalTicker(row) !== catalyst.ticker) return false;
  if (
    catalyst.daysToCd == null ||
    catalyst.daysToCd < 0 ||
    catalyst.daysToCd > CLINICAL_MAX_CD_DAYS ||
    !catalyst.completionDate
  ) {
    return false;
  }

  const rowDates = clinicalRowDateKeys(row, columns);
  if (!rowDates.includes(catalyst.completionDate)) return false;

  const rowDays = daysFromToday(catalyst.completionDate);
  if (rowDays == null || rowDays < 0 || rowDays > CLINICAL_MAX_CD_DAYS) return false;

  const nctCol = findNctColumn(columns);
  if (catalyst.nct && nctCol) {
    const cn = normNctId(row[nctCol]);
    if (cn && cn !== catalyst.nct) return false;
  }
  return true;
}

/** Studi clinical il cui ticker+CD/NCT coincide con il catalyst Simulation. */
export function filterClinicalForSimulationCd(
  table: SheetTable | null,
  catalog: Map<string, SimCdCatalyst>
): SheetTable | null {
  if (!table) return null;
  const cols = table.columns ?? [];
  const tickersInSim = new Set(catalog.keys());
  const rows = (table.rows ?? []).filter((r) => {
    const tk = clinicalTicker(r);
    if (!tickersInSim.has(tk)) return false;
    const cat = catalog.get(tk);
    return cat ? clinicalRowMatchesCatalyst(r, cat, cols) : false;
  });
  const catalystTickers = [...catalog.keys()].sort();
  return {
    ...table,
    rows,
    row_count: rows.length,
    tickers: catalystTickers,
    filter_note: `Catalyst Simulation entro ${CLINICAL_MAX_CD_DAYS} gg · CD clinical = CD foglio`,
  };
}
