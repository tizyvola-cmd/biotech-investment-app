/**
 * MCS assignment → 3 trading-day stock move (for Model Lab chart 3, panel 1).
 */
import type { InvestSimHistoryPoint } from "./investSimStorage";
import { tickerDailyCloseSeries } from "./simulationPosition";

function calendarDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Cumulative position value change from assignment-day close through the 3rd
 * trading day after assignment (D+1…D+3). Uses portfolio history closes.
 */
export function stockMove3dPctAfterAssignment(
  history: InvestSimHistoryPoint[],
  rowKey: string,
  assignmentIso: string | null | undefined,
): number | null {
  if (!history.length || !rowKey?.trim() || !assignmentIso?.trim()) return null;

  const investDay = calendarDayKey(new Date(assignmentIso));
  if (!investDay) return null;

  const series = tickerDailyCloseSeries(history, rowKey, assignmentIso);
  if (!series.length) return null;

  const basePt = series.find((pt) => pt.dayKey === investDay) ?? series[0]!;
  const baseValue = basePt.value;
  if (!Number.isFinite(baseValue) || baseValue <= 0) return null;

  const after = series.filter((pt) => pt.dayKey > investDay);
  if (!after.length) return null;

  const endPt = after[Math.min(2, after.length - 1)]!;
  const movePct = ((endPt.value - baseValue) / baseValue) * 100;
  return Math.round(movePct * 100) / 100;
}
