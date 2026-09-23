/**
 * Build Urgent SELL G2 legs from dashboard chips + optional prior session €.
 */
import type { DashboardPortfolioChip } from "./simulationPosition";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  attachContCutPriority,
  type UrgentSellBookLeg,
} from "./softSignalGrades";

function calendarDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * € P&L change for the last completed session before today (yesterday vs
 * the day before), so today chips (24h) are not double-counted.
 */
export function priorSessionDayPnlByKey(
  history: InvestSimHistoryPoint[] | null | undefined,
  openKeys: Iterable<string>,
  now: Date = new Date(),
): Map<string, number> {
  const out = new Map<string, number>();
  const hist = history ?? [];
  if (hist.length < 2) return out;

  const todayKey = calendarDayKey(now.toISOString());
  const byDay = new Map<string, InvestSimHistoryPoint>();
  for (const h of hist) {
    const dk = calendarDayKey(h.ts);
    if (!dk || dk >= todayKey) continue;
    const prev = byDay.get(dk);
    if (!prev || Date.parse(h.ts) >= Date.parse(prev.ts)) byDay.set(dk, h);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) return out;
  const d1 = byDay.get(days[days.length - 1]!)!;
  const d0 = byDay.get(days[days.length - 2]!)!;

  for (const key of openKeys) {
    const a = d1.byTicker?.[key]?.pnl;
    const b = d0.byTicker?.[key]?.pnl;
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    out.set(key, Math.round((a - b) * 100) / 100);
  }
  return out;
}

/** Today 24h € + optional prior session € (2-day win/loss mass). Floors use today %. */
export function buildUrgentSellBookLegs(
  chips: readonly DashboardPortfolioChip[],
  history?: InvestSimHistoryPoint[] | null,
  opts?: {
    includePriorSession?: boolean;
    /** Simulation rows by invest key — attaches G10 cut priority for G2 ties. */
    simRowByKey?: Map<string, Record<string, unknown>> | null;
  },
): UrgentSellBookLeg[] {
  const includePrior = opts?.includePriorSession !== false;
  const prior = includePrior
    ? priorSessionDayPnlByKey(
        history,
        chips.map((c) => c.key),
      )
    : new Map<string, number>();

  return chips.map((c) => {
    const todayEur = c.pnlEur24h ?? 0;
    const priorEur = prior.get(c.key) ?? 0;
    const dayPnlEur = Math.round((todayEur + priorEur) * 100) / 100;
    return attachContCutPriority(
      {
        key: c.key,
        ticker: c.ticker,
        dayPnlEur,
        dayPnlPct: c.pnlPct24h ?? null,
        totalPnlPct: c.pnlPct ?? null,
        capitalEur: c.capitalEur,
        pnlEur: c.pnlEur,
      },
      opts?.simRowByKey?.get(c.key) ?? null,
    );
  });
}
