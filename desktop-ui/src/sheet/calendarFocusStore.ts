/**
 * Focus the Calendar tab on a ticker (Catalyst interest enroll → next CD search).
 */
export const CALENDAR_FOCUS_EVENT = "supernova-calendar-focus";

let focusTicker: string | null = null;

export function getCalendarFocusTicker(): string | null {
  return focusTicker;
}

export function openCalendarForTicker(ticker: string): void {
  const tk = String(ticker || "").trim().toUpperCase();
  if (!tk) return;
  focusTicker = tk;
  try {
    window.dispatchEvent(new CustomEvent(CALENDAR_FOCUS_EVENT, { detail: { ticker: tk } }));
  } catch {
    /* ignore */
  }
}

export function consumeCalendarFocusTicker(): string | null {
  const tk = focusTicker;
  focusTicker = null;
  return tk;
}
