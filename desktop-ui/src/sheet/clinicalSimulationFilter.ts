import type { SheetTable } from "../types";
import { looksLikeTicker } from "./simulationTickers";
import { nctClinicalTrialsUrl, sheetCellAsLink, sheetCellPlainText } from "./cellLinks";

import {
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
} from "./cdHorizons";

/** Monitor Simulation: CD futuro entro ~4 mesi. */
export const CLINICAL_MAX_CD_DAYS = SIM_MONITOR_HORIZON_DAYS;
/** Zona hot operativa (~2 mesi). */
export const CLINICAL_HOT_CD_DAYS = SIM_HOT_ZONE_DAYS;

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
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** One Simulation row per ticker: next future CD within CLINICAL_MAX_CD_DAYS. */
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
    const studyHref =
      studyHrefFromCell(best["Link studio"]) ??
      studyHrefFromCell(best.NCT ?? best.nct);
    const nct =
      normNctId(best.NCT ?? best.nct) ??
      normNctId(best["Link studio"]) ??
      (studyHref ? normNctId(studyHref) : null);
    catalog.set(tk, {
      ticker: tk,
      completionDate: iso,
      completionDateDisplay: formatDateIt(iso, String(best["Completion Date"] ?? "")),
      nct,
      company: String(best.Società ?? best.Nome ?? best.Company ?? "").trim(),
      studyHref: studyHref ?? (nct ? nctClinicalTrialsUrl(nct) : null),
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

/** Calendar day tolerance for clinical CD vs Simulation sheet (aligned with orchestrator). */
export const CLINICAL_CD_MATCH_TOLERANCE_DAYS = 7;

/** Date field priority — Simulation uses Primary Completion Date. */
const CANONICAL_CLINICAL_CD_COLUMNS = [
  "primary_completion_date",
  "completion_date",
  "estimated_completion_date",
] as const;

function findCanonicalClinicalCdColumn(columns: string[]): string | null {
  for (const col of CANONICAL_CLINICAL_CD_COLUMNS) {
    if (columns.includes(col)) return col;
  }
  for (const col of columns) {
    const low = col.toLowerCase();
    if (low.includes("completion") && low.includes("date")) return col;
  }
  return null;
}

export function clinicalRowCanonicalCd(
  row: Record<string, unknown>,
  columns: string[]
): string | null {
  for (const col of CANONICAL_CLINICAL_CD_COLUMNS) {
    if (!columns.includes(col)) continue;
    const iso = normDateKey(row[col]);
    if (iso) return iso;
  }
  return null;
}

function datesMatchCatalyst(isoA: string, isoB: string): boolean {
  if (!isoA || !isoB) return false;
  if (isoA === isoB) return true;
  const a = new Date(`${isoA}T12:00:00`);
  const b = new Date(`${isoB}T12:00:00`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return false;
  const diff = Math.abs(a.getTime() - b.getTime()) / 86400000;
  return diff <= CLINICAL_CD_MATCH_TOLERANCE_DAYS;
}

function matchScore(
  row: Record<string, unknown>,
  catalyst: SimCdCatalyst,
  columns: string[]
): number {
  let score = 0;
  const canon = clinicalRowCanonicalCd(row, columns);
  if (canon && catalyst.completionDate) {
    const a = new Date(`${canon}T12:00:00`);
    const b = new Date(`${catalyst.completionDate}T12:00:00`);
    if (Number.isFinite(a.getTime()) && Number.isFinite(b.getTime())) {
      const diff = Math.abs(a.getTime() - b.getTime()) / 86400000;
      score += Math.max(0, 40 - diff);
    }
  }
  const nctCol = findNctColumn(columns);
  if (catalyst.nct && nctCol) {
    const cn = normNctId(row[nctCol]);
    if (cn === catalyst.nct) score += 100;
    else if (cn) score -= 80;
  }
  score += sponsorMatchBonus(row);
  return score;
}

function findNctColumn(columns: string[]): string | null {
  for (const c of columns) {
    const low = c.toLowerCase();
    if (low === "nct_id" || low === "nctid" || low === "nct") return c;
  }
  return null;
}

/**
 * Returns true only for rows with an exact or partial sponsor match,
 * covering direct sponsor, collaborator, subsidiary, and parent-company
 * relationships. Rows with "No match" or blank are excluded.
 */
export function hasValidSponsorMatch(row: Record<string, unknown>): boolean {
  const sm = String(row.sponsor_match ?? "").trim().toLowerCase();
  return sm === "exact" || sm === "partial";
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

  const canon = clinicalRowCanonicalCd(row, columns);
  if (!canon || !datesMatchCatalyst(canon, catalyst.completionDate)) return false;

  const rowDays = daysFromToday(canon);
  if (rowDays == null || rowDays < 0 || rowDays > CLINICAL_MAX_CD_DAYS) return false;

  const nctCol = findNctColumn(columns);
  if (catalyst.nct && nctCol) {
    const cn = normNctId(row[nctCol]);
    if (cn && cn !== catalyst.nct) return false;
  }
  return true;
}

function sponsorMatchBonus(row: Record<string, unknown>): number {
  const sm = String(row.sponsor_match ?? "").trim().toLowerCase();
  if (sm === "exact") return 30;
  if (sm === "partial") return 15;
  return 0;
}

function pickBestClinicalRowPerTicker(
  rows: Record<string, unknown>[],
  catalog: Map<string, SimCdCatalyst>,
  columns: string[]
): Record<string, unknown>[] {
  const bestByTicker = new Map<string, { row: Record<string, unknown>; score: number }>();
  for (const row of rows) {
    const tk = clinicalTicker(row);
    const cat = catalog.get(tk);
    if (!cat || !clinicalRowMatchesCatalyst(row, cat, columns)) continue;
    const score = matchScore(row, cat, columns);
    const prev = bestByTicker.get(tk);
    if (!prev || score > prev.score) bestByTicker.set(tk, { row, score });
  }
  return [...bestByTicker.values()]
    .map((v) => v.row)
    .sort((a, b) => clinicalTicker(a).localeCompare(clinicalTicker(b)));
}

/**
 * Best clinical row for a Simulation catalyst when CD matches but NCT may differ
 * (e.g. Simulation NCT04026191 vs OpenFDA NCT06999993 on the same CD).
 */
export function findLooseClinicalRowForCatalyst(
  table: SheetTable | null,
  catalyst: SimCdCatalyst,
): Record<string, unknown> | null {
  if (!table?.rows?.length || !catalyst.completionDate) return null;
  const columns = table.columns ?? [];
  let best: Record<string, unknown> | null = null;
  let bestScore = -Infinity;

  for (const row of table.rows) {
    if (clinicalTicker(row) !== catalyst.ticker) continue;
    const canon = clinicalRowCanonicalCd(row, columns);
    if (!canon || !datesMatchCatalyst(canon, catalyst.completionDate)) continue;
    const rowDays = daysFromToday(canon);
    if (rowDays == null || rowDays < 0 || rowDays > CLINICAL_MAX_CD_DAYS) continue;

    let score = sponsorMatchBonus(row);
    const nctCol = findNctColumn(columns);
    if (catalyst.nct && nctCol) {
      const cn = normNctId(row[nctCol]);
      if (cn === catalyst.nct) score += 100;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

// ── 6-month CD calendar ────────────────────────────────────────────────────

/** Horizon for the full upcoming-CD calendar (≈6 months). */
export const CLINICAL_6M_DAYS = 180;

export type FutureCdEntry = {
  ticker: string;
  company: string;
  cdIso: string;
  cdDisplay: string;
  daysToCd: number;
  nct: string | null;
  briefTitle: string | null;
  phase: string | null;
  status: string | null;
  studyHref: string | null;
  hasClinicalData: boolean;
};

/**
 * Builds a sorted list of all Simulation tickers with future CDs within
 * `maxDays`, annotated with clinical-trial data (loose ticker match).
 */
export function buildFutureCdCalendar(
  simTable: SheetTable | null,
  clinicalTable: SheetTable | null,
  maxDays = CLINICAL_6M_DAYS
): FutureCdEntry[] {
  const byTicker = new Map<string, FutureCdEntry>();
  for (const row of simTable?.rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (!looksLikeTicker(tk)) continue;
    const iso = normDateKey(row["Completion Date"]);
    if (!iso) continue;
    const days = daysFromToday(iso);
    if (days == null || days < 0 || days > maxDays) continue;
    const existing = byTicker.get(tk);
    if (existing && existing.daysToCd <= days) continue;
    byTicker.set(tk, {
      ticker: tk,
      company: String(
        (row as Record<string, unknown>)["Società"] ??
        row.Company ??
        row.Nome ??
        tk
      ).trim(),
      cdIso: iso,
      cdDisplay: formatDateIt(iso, String(row["Completion Date"] ?? "")),
      daysToCd: days,
      nct: null,
      briefTitle: null,
      phase: null,
      status: null,
      studyHref: null,
      hasClinicalData: false,
    });
  }

  const clinCols = clinicalTable?.columns ?? [];
  const nctColName = findNctColumn(clinCols);
  for (const clinRow of clinicalTable?.rows ?? []) {
    if (!hasValidSponsorMatch(clinRow)) continue;
    const tk = clinicalTicker(clinRow);
    const entry = byTicker.get(tk);
    if (!entry || entry.hasClinicalData) continue;
    const nctCell = nctColName ? clinRow[nctColName] : clinRow.nct_id;
    const nct = normNctId(nctCell);
    entry.nct = nct;
    entry.briefTitle = String(clinRow.brief_title ?? "").trim() || null;
    entry.phase = String(clinRow.phase ?? "").trim() || null;
    entry.status = String(clinRow.overall_status ?? "").trim() || null;
    entry.studyHref =
      (nctColName ? studyHrefFromCell(clinRow[nctColName]) : null) ??
      studyHrefFromCell(clinRow.nct_id) ??
      (nct ? nctClinicalTrialsUrl(nct) : null);
    entry.hasClinicalData = true;
  }

  return [...byTicker.values()].sort((a, b) => a.daysToCd - b.daysToCd);
}

// ── Filtered clinical sheet (existing 2-month match logic) ──────────────────

/** Clinical studies whose ticker+CD/NCT match the Simulation catalyst. */
export function filterClinicalForSimulationCd(
  table: SheetTable | null,
  catalog: Map<string, SimCdCatalyst>
): SheetTable | null {
  if (!table) return null;
  const cols = table.columns ?? [];
  const canonCol = findCanonicalClinicalCdColumn(cols);
  const orderedCols = [...cols];
  if (canonCol && canonCol !== "primary_completion_date" && orderedCols.includes("primary_completion_date")) {
    orderedCols.splice(orderedCols.indexOf("primary_completion_date"), 1);
    const cdIdx = orderedCols.indexOf("completion_date");
    if (cdIdx >= 0) orderedCols.splice(cdIdx, 0, "primary_completion_date");
    else orderedCols.unshift("primary_completion_date");
  }

  const rows = pickBestClinicalRowPerTicker(table.rows ?? [], catalog, cols);
  const catalystTickers = [...catalog.keys()].sort();
  return {
    ...table,
    columns: orderedCols,
    rows,
    row_count: rows.length,
    tickers: catalystTickers,
    filter_note:
      `Simulation catalysts within ${CLINICAL_MAX_CD_DAYS} d · ` +
      `match on primary_completion_date (±${CLINICAL_CD_MATCH_TOLERANCE_DAYS} d) and NCT if present`,
  };
}
