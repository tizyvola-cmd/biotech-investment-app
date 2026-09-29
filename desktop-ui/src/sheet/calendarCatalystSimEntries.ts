/**
 * Calendar tickers (Guidance + FDA AdCom) → Simulation sidecar rows.
 * Display / scoring universe only — does not change Soft BUY/SELL gates.
 */
import type { GuidanceCalendarEvent } from "../api/supernova";

function isoDay(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isoToSimCd(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function bestFutureEvent(
  events: GuidanceCalendarEvent[],
  todayIso: string,
): GuidanceCalendarEvent | null {
  const future = events
    .filter((e) => (isoDay(e.window_start) || isoDay(e.window_end) || "9999") >= todayIso)
    .sort((a, b) =>
      (isoDay(a.window_start) || isoDay(a.window_end) || "9999").localeCompare(
        isoDay(b.window_start) || isoDay(b.window_end) || "9999",
      ),
    );
  if (future[0]) return future[0];
  const past = [...events].sort((a, b) =>
    (isoDay(b.window_start) || "").localeCompare(isoDay(a.window_start) || ""),
  );
  return past[0] ?? null;
}

export function calendarEventsToCatalystSimEntries(
  events: GuidanceCalendarEvent[] | undefined,
  today = new Date(),
): Array<Record<string, unknown>> {
  const todayIso = today.toISOString().slice(0, 10);
  const byTk = new Map<string, GuidanceCalendarEvent[]>();
  for (const ev of events ?? []) {
    const tk = (ev.ticker || "").trim().toUpperCase();
    if (!tk) continue;
    const list = byTk.get(tk) ?? [];
    list.push(ev);
    byTk.set(tk, list);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const [ticker, list] of byTk) {
    const best = bestFutureEvent(list, todayIso);
    const iso = isoDay(best?.window_start) || isoDay(best?.window_end);
    if (!best || !iso) continue;
    out.push({
      Ticker: ticker,
      Società: best.company || ticker,
      "Completion Date": isoToSimCd(iso),
      "Exact·Partial vs Unmatch": "Catalyst",
      Drug: best.asset_name || "",
      Indication: best.indication || "",
      guidance_calendar_catalyst: true,
      guidance_event_type: best.event_type || "other",
      guidance_asset_name: best.asset_name || "",
      guidance_window_start: iso,
      guidance_window_end: isoDay(best.window_end) || iso,
      guidance_source_quote: best.timing_quote || "",
    });
  }
  return out;
}

/** File extras stay; live calendar fills gaps and overwrites the same ticker. */
export function unionCatalystSimEntries(
  calendar: Array<Record<string, unknown>>,
  file: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byTk = new Map<string, Record<string, unknown>>();
  for (const row of file) {
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (tk) byTk.set(tk, { ...row, Ticker: tk, guidance_calendar_catalyst: true });
  }
  for (const row of calendar) {
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (tk) byTk.set(tk, { ...row, Ticker: tk, guidance_calendar_catalyst: true });
  }
  return [...byTk.values()];
}
