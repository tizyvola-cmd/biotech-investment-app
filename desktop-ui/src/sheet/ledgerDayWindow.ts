/** Giorni visibili nel Daily P&L ledger (finestra scorrevole). */
export const LEDGER_VISIBLE_DAYS = 5;

export function calendarDayKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayLedgerDayKey(): string {
  return calendarDayKeyFromDate(new Date());
}

export function parseLedgerDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addLedgerDays(dayKey: string, delta: number): string {
  const d = parseLedgerDayKey(dayKey);
  if (!d) return dayKey;
  d.setDate(d.getDate() + delta);
  return calendarDayKeyFromDate(d);
}

/** Fine finestra di default: oggi se ≥ primo giorno ledger, altrimenti ultimo snapshot. */
export function resolveDefaultLedgerWindowEnd(
  ledgerDayKeys: string[],
  todayKey = todayLedgerDayKey(),
): string {
  if (!ledgerDayKeys.length) return todayKey;
  const sorted = [...ledgerDayKeys].sort();
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (todayKey >= first) return todayKey;
  return last;
}

/** `{count}` giorni consecutivi terminanti in `endDayKey` (ordine cronologico). */
export function buildLedgerDayWindow(
  endDayKey: string,
  count = LEDGER_VISIBLE_DAYS,
): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(addLedgerDays(endDayKey, -i));
  }
  return out;
}

export function ledgerWindowStartKey(
  endDayKey: string,
  count = LEDGER_VISIBLE_DAYS,
): string {
  return addLedgerDays(endDayKey, -(count - 1));
}

export function isDayInLedgerWindow(
  dayKey: string,
  endDayKey: string,
  count = LEDGER_VISIBLE_DAYS,
): boolean {
  const start = ledgerWindowStartKey(endDayKey, count);
  return dayKey >= start && dayKey <= endDayKey;
}

export type LedgerCalendarCell = {
  dayKey: string;
  inMonth: boolean;
  isToday: boolean;
  hasData: boolean;
  inWindow: boolean;
  isWindowEnd: boolean;
};

/** Griglia 6×7 per il mese di `viewMonth` (0 = gennaio). */
export function buildLedgerCalendarGrid(
  viewYear: number,
  viewMonth: number,
  windowEndKey: string,
  dataDayKeys: Set<string>,
  todayKey = todayLedgerDayKey(),
): LedgerCalendarCell[] {
  const first = new Date(viewYear, viewMonth, 1);
  const startOffset = first.getDay(); // 0 = dom
  const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
  const cells: LedgerCalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dayKey = calendarDayKeyFromDate(d);
    cells.push({
      dayKey,
      inMonth: d.getMonth() === viewMonth,
      isToday: dayKey === todayKey,
      hasData: dataDayKeys.has(dayKey),
      inWindow: isDayInLedgerWindow(dayKey, windowEndKey),
      isWindowEnd: dayKey === windowEndKey,
    });
  }
  return cells;
}

export function formatLedgerWindowRange(
  endDayKey: string,
  lang: "it" | "en",
  count = LEDGER_VISIBLE_DAYS,
): string {
  const start = ledgerWindowStartKey(endDayKey, count);
  const fmt = (key: string) => {
    const d = parseLedgerDayKey(key);
    if (!d) return key;
    return lang === "it"
      ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  return `${fmt(start)} – ${fmt(endDayKey)}`;
}
