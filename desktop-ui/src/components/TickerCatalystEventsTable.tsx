/**
 * TickerCatalystEventsTable — Compact table showing upcoming catalyst events
 * for a specific ticker, placed below the EIS section in Loss Analysis cards.
 *
 * Data source: guidance_calendar_snapshot from the backend.
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchCatalystCalendarSnapshot,
  fetchFdaAdcomCalendarSnapshot,
  fetchGuidanceCalendarSnapshot,
  type ClinicalPreCdRecord,
  type GuidanceCalendarEvent,
  type GuidanceCalendarSnapshot,
} from "../api/supernova";
import { fdaRowsFromSnapshot, mergeCalendarSources } from "../sheet/calendarCatalystEvents";
import { useLang } from "../shared/i18n";
import { collectTickerChartCdIsos } from "../sheet/priceVariationSeries";
import { CdStudyEisModal } from "./CdStudyEisModal";
import { RegulatoryCatalystDetailModal } from "./RegulatoryCatalystDetailModal";
import { resolveRegulatoryCatalystOutcome } from "../sheet/regulatoryCatalystOutcome";
import {
  catalystEventStableId,
  dismissCatalystEvent,
  undismissCatalystEventsForTicker,
  useDismissedCatalystIds,
} from "../sheet/catalystEventDismiss";
import { clinicalDrugFromSimRow } from "../sheet/simRowClinicalMeta";

/* ── Event type badge (compact, same palette as GuidanceCalendarPanel) ───── */

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  cd:          { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-900 dark:text-amber-100" },
  readout:     { bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-800 dark:text-blue-200" },
  submission:  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200" },
  approval:    { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-800 dark:text-emerald-200" },
  pdufa:       { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200" },
  partnership: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200" },
  preclinical: { bg: "bg-slate-100 dark:bg-slate-700/50", text: "text-slate-700 dark:text-slate-300" },
  initiation:  { bg: "bg-cyan-100 dark:bg-cyan-900/40",   text: "text-cyan-800 dark:text-cyan-200" },
  fda_vote:    { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-800 dark:text-emerald-200" },
  fda_safety:  { bg: "bg-slate-100 dark:bg-slate-700/50", text: "text-slate-700 dark:text-slate-300" },
  conference:  { bg: "bg-indigo-100 dark:bg-indigo-900/40", text: "text-indigo-800 dark:text-indigo-200" },
  other:       { bg: "bg-gray-100 dark:bg-gray-700/50",   text: "text-gray-700 dark:text-gray-300" },
};

const TYPE_LABELS: Record<string, { en: string; it: string }> = {
  cd: { en: "CD", it: "CD" },
  readout: { en: "Readout", it: "Readout" },
  submission: { en: "Submission", it: "Submission" },
  approval: { en: "Approval", it: "Approvazione" },
  pdufa: { en: "PDUFA", it: "PDUFA" },
  partnership: { en: "Partnership", it: "Partnership" },
  preclinical: { en: "Preclinical", it: "Preclinico" },
  initiation: { en: "Initiation", it: "Inizio trial" },
  fda_vote: { en: "FDA vote", it: "Voto FDA" },
  fda_safety: { en: "FDA safety", it: "FDA safety" },
  conference: { en: "Conference", it: "Conferenza" },
  other: { en: "Other", it: "Altro" },
};

function TypeBadge({ type, it }: { type: string; it: boolean }) {
  const colors = EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.other;
  const label = TYPE_LABELS[type]?.[it ? "it" : "en"] ?? type;
  return (
    <span className={`inline-block px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide ${colors.bg} ${colors.text}`}>
      {label}
    </span>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  if (start && end && start !== end) return `${fmtDate(start)} – ${fmtDate(end)}`;
  return fmtDate(start || end);
}

/** Past CDs / guidance events older than this are hidden; future dates stay. */
export const PAST_CATALYST_TABLE_DAYS = 365;

/** Keep future + today, and past events only within the last 12 months. */
export function keepCatalystForTable(
  iso: string | null | undefined,
  today: Date,
  pastHorizonDays = PAST_CATALYST_TABLE_DAYS,
): boolean {
  if (!iso) return true;
  try {
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (!Number.isFinite(d.getTime())) return true;
    const ref = new Date(today);
    ref.setHours(12, 0, 0, 0);
    const days = Math.round((d.getTime() - ref.getTime()) / 86_400_000);
    if (days >= 0) return true;
    return days >= -pastHorizonDays;
  } catch {
    return true;
  }
}

function daysUntilWindow(start: string | null | undefined): number | null {
  if (!start) return null;
  try {
    const d = new Date(`${start}T12:00:00`);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.round((d.getTime() - now.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}

function daysLabel(days: number | null, it: boolean): string {
  if (days == null) return "";
  if (days < 0) return it ? "passato" : "past";
  if (days === 0) return it ? "oggi" : "today";
  if (days === 1) return it ? "domani" : "tomorrow";
  return it ? `tra ${days}g` : `in ${days}d`;
}

function urgencyColor(days: number | null): string {
  if (days == null) return "";
  if (days <= 3) return "text-red-600 dark:text-red-400 font-bold";
  if (days <= 14) return "text-amber-600 dark:text-amber-400 font-semibold";
  if (days <= 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-muted";
}

/* ── Alert icon for imminent catalysts ────────────────────────────────────── */

function AlertDot({ className = "" }: { className?: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse ${className}`} />;
}

/* ── Shared snapshot cache (so multiple ticker cards don't re-fetch) ─────── */

let _snapshotPromise: Promise<GuidanceCalendarSnapshot> | null = null;
let _snapshotCache: GuidanceCalendarSnapshot | null = null;
let _snapshotAge = 0;
const SNAPSHOT_TTL = 120_000; // 2 minutes

function getSnapshot(): Promise<GuidanceCalendarSnapshot> {
  const now = Date.now();
  if (_snapshotCache && now - _snapshotAge < SNAPSHOT_TTL) {
    return Promise.resolve(_snapshotCache);
  }
  if (!_snapshotPromise) {
    _snapshotPromise = Promise.all([
      fetchGuidanceCalendarSnapshot(),
      fetchFdaAdcomCalendarSnapshot().catch(() => null),
      fetchCatalystCalendarSnapshot().catch(() => null),
    ])
      .then(([snap, fda, sec]) => {
        const merged: GuidanceCalendarSnapshot = {
          ...snap,
          events: mergeCalendarSources(
            snap.events,
            fdaRowsFromSnapshot(fda),
            sec?.entries,
          ),
        };
        merged.count = merged.events?.length ?? 0;
        _snapshotCache = merged;
        _snapshotAge = Date.now();
        _snapshotPromise = null;
        return merged;
      })
      .catch((err) => {
        _snapshotPromise = null;
        throw err;
      });
  }
  return _snapshotPromise;
}

/** Invalidate the in-memory snapshot cache (e.g. after a refresh). */
export function invalidateGuidanceSnapshotCache() {
  _snapshotCache = null;
  _snapshotAge = 0;
  _snapshotPromise = null;
}

/** Best upcoming event for a ticker — nearest future window, or most recent past. */
function bestUpcomingEvent(events: GuidanceCalendarEvent[]): GuidanceCalendarEvent | null {
  if (!events.length) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const future = events.filter((e) => (e.window_start ?? "9999") >= todayIso || (e.window_end ?? "") >= todayIso);
  if (future.length) {
    future.sort((a, b) => (a.window_start ?? "9999").localeCompare(b.window_start ?? "9999"));
    return future[0];
  }
  const past = [...events].sort((a, b) => (b.window_start ?? "").localeCompare(a.window_start ?? ""));
  return past[0] ?? null;
}

export type GuidanceKpiByTicker = Map<string, {
  bestEvent: GuidanceCalendarEvent;
  events: GuidanceCalendarEvent[];
}>;

/**
 * Hook: returns the best guidance event per ticker for use in the KPI table.
 * Uses the same shared snapshot as TickerCatalystEventsTable cards.
 */
export function useGuidanceKpiByTicker(): GuidanceKpiByTicker {
  const [data, setData] = useState<GuidanceKpiByTicker>(new Map());

  useEffect(() => {
    let cancelled = false;
    getSnapshot().then((snap) => {
      if (cancelled || !snap?.events?.length) return;
      const byTk = new Map<string, GuidanceCalendarEvent[]>();
      for (const ev of snap.events) {
        const tk = ev.ticker?.trim().toUpperCase();
        if (!tk) continue;
        if (!byTk.has(tk)) byTk.set(tk, []);
        byTk.get(tk)!.push(ev);
      }
      const result: GuidanceKpiByTicker = new Map();
      for (const [tk, evts] of byTk) {
        evts.sort((a, b) => (a.window_start ?? "").localeCompare(b.window_start ?? ""));
        const best = bestUpcomingEvent(evts);
        if (best) result.set(tk, { bestEvent: best, events: evts });
      }
      setData(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return data;
}

/**
 * Hook: returns the guidance calendar events for a given ticker.
 * Fetches once (shared across all cards) and filters per ticker.
 */
export function useTickerGuidanceEvents(ticker: string | null | undefined): GuidanceCalendarEvent[] {
  const [events, setEvents] = useState<GuidanceCalendarEvent[]>([]);

  useEffect(() => {
    if (!ticker) return;
    const tk = ticker.trim().toUpperCase();
    let cancelled = false;
    getSnapshot().then((snap) => {
      if (cancelled) return;
      const filtered = (snap.events ?? []).filter(
        (e) => e.ticker?.trim().toUpperCase() === tk,
      );
      filtered.sort((a, b) => (a.window_start ?? "").localeCompare(b.window_start ?? ""));
      setEvents(filtered);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ticker]);

  return events;
}

/* ── Main component ──────────────────────────────────────────────────────── */

export function TickerCatalystEventsTable({
  ticker,
  className = "",
  showAll = false,
  completionDate = null,
  clinicalRecords,
  simRow = null,
}: {
  ticker: string;
  className?: string;
  /** Title only — past events are always capped at 12 months; all future stay. */
  showAll?: boolean;
  /** Simulation Completion Date — shown as a CD row alongside guidance events. */
  completionDate?: string | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  /** Deep Dive / Simulation row — Product column for CD modal + patents. */
  simRow?: Record<string, unknown> | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const events = useTickerGuidanceEvents(ticker);
  const dismissed = useDismissedCatalystIds();
  const [cdDetailIso, setCdDetailIso] = useState<string | null>(null);
  const [regDetail, setRegDetail] = useState<GuidanceCalendarEvent | null>(null);

  const upcoming = useMemo(() => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const filtered = events.filter((e) =>
      keepCatalystForTable(e.window_end || e.window_start, now),
    );

    const cdIsos = collectTickerChartCdIsos(ticker, completionDate, clinicalRecords).filter(
      (iso) => keepCatalystForTable(iso, now),
    );
    const tk = ticker.trim().toUpperCase();
    const simProduct = clinicalDrugFromSimRow(simRow ?? undefined);
    for (const cdIso of [...cdIsos].reverse()) {
      filtered.unshift({
        ticker: tk,
        company: "",
        event_type: "cd",
        // Real product from Simulation / Catalyst Product column — never the ticker or NCT.
        asset_name: simProduct || "",
        window_start: cdIso,
        window_end: cdIso,
        timing_quote: it ? "Data di completion (Simulation / NCT)" : "Completion date (Simulation / NCT)",
      });
    }
    return filtered;
  }, [events, completionDate, ticker, it, clinicalRecords, simRow]);

  const visible = useMemo(
    () => upcoming.filter((ev) => !dismissed.has(catalystEventStableId(ev))),
    [upcoming, dismissed],
  );
  const hiddenCount = upcoming.length - visible.length;

  if (upcoming.length === 0) return null;
  if (visible.length === 0 && hiddenCount === 0) return null;

  return (
    <div
      className={`rounded-lg border border-[rgb(var(--border))]/40 bg-surface/50 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[rgb(var(--border))]/10">
        <span className="text-amber-500 text-xs shrink-0">⚡</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
          {showAll ? (it ? "Catalyst" : "Catalysts") : (it ? "Prossimi catalyst" : "Upcoming catalysts")}
        </span>
        <span className="text-[9px] text-muted/60 ml-auto tabular-nums">
          {visible.length}
        </span>
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="text-[9px] font-semibold text-[rgb(var(--accent))] hover:underline shrink-0"
            onClick={() => undismissCatalystEventsForTicker(ticker)}
            title={it ? "Mostra le righe nascoste" : "Show hidden rows"}
          >
            {it ? `Ripristina ${hiddenCount}` : `Restore ${hiddenCount}`}
          </button>
        ) : null}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <p className="px-2 py-1.5 text-[10px] text-ink-muted">
          {it ? "Tutte le righe nascoste." : "All rows hidden."}
        </p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] leading-tight">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]/20 text-muted/70 text-[8px] uppercase tracking-wider">
              <th className="py-0.5 px-2 text-left font-medium">{it ? "Finestra" : "Window"}</th>
              <th className="py-0.5 px-1.5 text-left font-medium">{it ? "Tipo" : "Type"}</th>
              <th className="py-0.5 px-1.5 text-left font-medium">Asset</th>
              <th className="py-0.5 px-1.5 text-left font-medium max-w-[200px]">{it ? "Dettaglio" : "Detail"}</th>
              <th className="py-0.5 px-1.5 text-right font-medium">{it ? "Countdown" : "In"}</th>
              <th className="py-0.5 px-1 w-6" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {visible.map((ev, i) => {
              const days = daysUntilWindow(ev.window_start);
              const isImminent = days != null && days >= 0 && days <= 3;
              const rowId = catalystEventStableId(ev);
              const isCd = ev.event_type === "cd";
              const isReg =
                ev.event_type === "pdufa" ||
                ev.event_type === "approval" ||
                ev.event_type === "submission";
              const outcome = isReg ? resolveRegulatoryCatalystOutcome(ev) : null;
              const detailText = outcome
                ? `${it ? outcome.labelIt : outcome.labelEn}${ev.timing_quote ? ` · ${ev.timing_quote}` : ""}`
                : ev.timing_quote || "—";
              return (
                <tr
                  key={`${rowId}-${i}`}
                  className={`border-b border-[rgb(var(--border))]/10 hover:bg-[rgb(var(--border))]/10 transition-colors${
                    isImminent ? " bg-red-50/50 dark:bg-red-900/10" : ""
                  }${isCd || isReg ? " cursor-pointer" : ""}`}
                  onClick={
                    isCd
                      ? () => setCdDetailIso(ev.window_start || ev.window_end || null)
                      : isReg
                        ? () => setRegDetail(ev)
                        : undefined
                  }
                >
                  <td className="py-1 px-2 whitespace-nowrap tabular-nums">
                    {fmtWindow(ev.window_start, ev.window_end)}
                  </td>
                  <td className="py-1 px-1.5">
                    <TypeBadge type={ev.event_type || "other"} it={it} />
                  </td>
                  <td className="py-1 px-1.5 text-foreground/80 truncate max-w-[100px]">
                    {ev.asset_name || "—"}
                  </td>
                  <td className="py-1 px-1.5 text-muted truncate max-w-[200px]" title={detailText}>
                    {detailText}
                  </td>
                  <td className={`py-1 px-1.5 text-right whitespace-nowrap tabular-nums ${urgencyColor(days)}`}>
                    {isImminent ? (
                      <span className="inline-flex items-center gap-1">
                        <AlertDot className="text-red-500" />
                        {daysLabel(days, it)}
                      </span>
                    ) : (
                      daysLabel(days, it)
                    )}
                  </td>
                  <td className="py-1 px-1 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center w-4 h-4 rounded text-ink-muted/70 hover:text-rose-600 hover:bg-rose-500/10 text-[11px] leading-none font-bold"
                      aria-label={it ? "Nascondi riga" : "Hide row"}
                      title={it ? "Nascondi questa riga" : "Hide this row"}
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissCatalystEvent(rowId);
                      }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {cdDetailIso ? (
        <CdStudyEisModal
          ticker={ticker}
          cdIso={cdDetailIso}
          clinicalRecords={clinicalRecords}
          guidanceEvents={events}
          simRow={simRow}
          productHint={clinicalDrugFromSimRow(simRow ?? undefined) || null}
          it={it}
          onClose={() => setCdDetailIso(null)}
        />
      ) : null}
      {regDetail ? (
        <RegulatoryCatalystDetailModal
          event={regDetail}
          ticker={ticker}
          clinicalRecords={clinicalRecords}
          it={it}
          onClose={() => setRegDetail(null)}
        />
      ) : null}
    </div>
  );
}

export default TickerCatalystEventsTable;
