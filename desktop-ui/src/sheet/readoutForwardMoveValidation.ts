/**
 * Readout validation: score at measurement time → stock move in the following ~3 days.
 * Feed events use delta_p_3d on the event; portfolio entries use history closes D+1…D+3.
 */
import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { stockMove3dPctAfterAssignment } from "./mcsEntryMove3d";
import { pearsonR } from "./statSignificance";

export type ReadoutScatterPoint = {
  x: number;
  y: number;
  ticker: string;
  isWin: boolean;
  eventDate?: string;
  source: "feed_auto" | "feed_manual" | "position_entry";
  universe?: "portafoglio" | "sim loop";
  isOpen?: boolean;
};

export function eventForward3dPct(ev: ClinicalPublicationEvent): number | null {
  const d3 = ev.price?.delta_p_3d ?? ev.eis?.delta_p_3d ?? null;
  if (d3 != null && Number.isFinite(d3)) return d3;
  return null;
}

export function eventEisScore(ev: ClinicalPublicationEvent): number | null {
  const s = ev.eis?.score;
  return s != null && Number.isFinite(s) ? s : null;
}

/** One scatter point per feed event with EIS score and T+3 price move. */
export function buildEisFeedEventPoints(
  records: ClinicalPreCdRecord[] | null | undefined,
): ReadoutScatterPoint[] {
  const out: ReadoutScatterPoint[] = [];
  for (const rec of records ?? []) {
    const ticker = String(rec.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    for (const ev of rec.clinical_events ?? rec.timeline_events ?? []) {
      const eis = eventEisScore(ev);
      if (eis == null) continue;
      const move = eventForward3dPct(ev);
      if (move == null) continue;
      const isManual = String(ev.source_type ?? ev.event_type ?? "").toLowerCase() === "manual";
      out.push({
        x: eis,
        y: move,
        ticker,
        eventDate: ev.event_date ?? undefined,
        isWin: move >= 0,
        source: isManual ? "feed_manual" : "feed_auto",
      });
    }
  }
  return out;
}

export type EntryReadoutRow = {
  ticker: string;
  rowKey: string;
  pplan: number;
  pplanIsDefault?: boolean;
  sds: number | null;
  sdsAtEntry?: boolean;
  rescueScoreEntry: number;
  rescueScoreExtendedEntry: number;
  regulatoryScore: number | null;
  eisScore: number | null;
  universe?: "portafoglio" | "sim loop";
  isOpen?: boolean;
  mcsAssignmentIso?: string | null;
};

/** Forward 3d stock move after portfolio entry (from invest sim history). */
export function entryForward3dPct(
  history: InvestSimHistoryPoint[],
  rowKey: string,
  assignmentIso: string | null | undefined,
): number | null {
  return stockMove3dPctAfterAssignment(history, rowKey, assignmentIso);
}

export function enrichEntryRowsWithForward3d(
  rows: EntryReadoutRow[],
  history: InvestSimHistoryPoint[],
  inputs: InvestSimInputs,
): Array<EntryReadoutRow & { forward3dPct: number | null }> {
  return rows.map((r) => {
    const assignmentIso =
      r.mcsAssignmentIso ?? resolveInvestedAt(r.rowKey, inputs[r.rowKey], history);
    const forward3dPct =
      assignmentIso && r.rowKey
        ? entryForward3dPct(history, r.rowKey, assignmentIso)
        : null;
    return { ...r, forward3dPct, mcsAssignmentIso: assignmentIso };
  });
}

/** ISO Monday of the week containing `isoDate` (YYYY-MM-DD). */
export function isoWeekKeyMonday(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(d.getTime())) return null;
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export type WeeklyEisCorrelationRow = {
  weekKey: string;
  weekLabel: string;
  rho: number | null;
  n: number;
  nManual: number;
};

/** Per-ISO-week Pearson ρ(EIS, T+3 move) — mirrors Model Comparison feed-event logic. */
export function buildWeeklyEisCorrelationTrend(
  points: ReadoutScatterPoint[],
): WeeklyEisCorrelationRow[] {
  const byWeek = new Map<string, ReadoutScatterPoint[]>();
  for (const p of points) {
    if (!p.eventDate) continue;
    const wk = isoWeekKeyMonday(p.eventDate);
    if (!wk) continue;
    const bucket = byWeek.get(wk) ?? [];
    bucket.push(p);
    byWeek.set(wk, bucket);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, pts]) => {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const rho = pts.length >= 3 ? pearsonR(xs, ys) : null;
      return {
        weekKey,
        weekLabel: weekKey.slice(5),
        rho,
        n: pts.length,
        nManual: pts.filter((p) => p.source === "feed_manual").length,
      };
    });
}

export function summarizeEisFeedCorrelation(points: ReadoutScatterPoint[]): {
  rho: number | null;
  n: number;
  nManual: number;
  nNonZero: number;
} {
  const usable = points.filter((p) => p.x !== 0);
  const xs = usable.map((p) => p.x);
  const ys = usable.map((p) => p.y);
  return {
    rho: usable.length >= 3 ? pearsonR(xs, ys) : null,
    n: points.length,
    nManual: points.filter((p) => p.source === "feed_manual").length,
    nNonZero: usable.length,
  };
}

export function readoutPointToMini(
  p: ReadoutScatterPoint,
): {
  x: number;
  y: number;
  ticker: string;
  isWin: boolean;
  isOpen?: boolean;
  universe?: string;
} {
  return {
    x: p.x,
    y: p.y,
    ticker: p.ticker,
    isWin: p.isWin,
    isOpen: p.isOpen,
    universe: p.universe ?? (p.source === "position_entry" ? "portafoglio" : "feed"),
  };
}
