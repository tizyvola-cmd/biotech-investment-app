/**
 * GuidanceCatalystTickersPanel — "Other catalysts" tab in Evaluation Lab.
 *
 * Mirrors the Portfolio / Other opportunities layout:
 *   1. Top KPI Snapshot table (same columns, T−Catalyst replaces T−CD, Type replaces Study Phase)
 *   2. Per-ticker deep-dive cards with EIS + Regulatory panels + catalyst events
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchGuidanceCalendarSnapshot,
  fetchBatchQuotes,
  type GuidanceCalendarEvent,
  type GuidanceCalendarSnapshot,
  type TickerQuote,
} from "../api/supernova";
import { useLang } from "../shared/i18n";
import {
  TickerImpactEventsPanelProvider,
  TickerImpactEventsContextSection,
  TickerImpactEventsEisLane,
  TickerImpactEventsRegLane,
} from "./TickerImpactEventsPanel";
import { TickerCatalystEventsTable } from "./TickerCatalystEventsTable";

/* ── Module-level cache ────────────────────────────────────────────────────── */

let _cached: GuidanceCalendarSnapshot | null = null;
let _cacheTs = 0;
const CACHE_TTL = 120_000;

/* ── Event type badge ──────────────────────────────────────────────────────── */

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  readout:     { bg: "bg-blue-100 dark:bg-blue-900/40",   text: "text-blue-800 dark:text-blue-200" },
  submission:  { bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-800 dark:text-purple-200" },
  approval:    { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-800 dark:text-emerald-200" },
  pdufa:       { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-800 dark:text-green-200" },
  fda_vote:    { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-800 dark:text-emerald-200" },
  fda_safety:  { bg: "bg-slate-100 dark:bg-slate-700/50", text: "text-slate-700 dark:text-slate-300" },
  partnership: { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-800 dark:text-amber-200" },
  preclinical: { bg: "bg-slate-100 dark:bg-slate-700/50", text: "text-slate-700 dark:text-slate-300" },
  initiation:  { bg: "bg-cyan-100 dark:bg-cyan-900/40",   text: "text-cyan-800 dark:text-cyan-200" },
  other:       { bg: "bg-gray-100 dark:bg-gray-700/50",   text: "text-gray-700 dark:text-gray-300" },
};

const TYPE_LABELS: Record<string, { en: string; it: string }> = {
  readout: { en: "Readout", it: "Readout" },
  submission: { en: "Submission", it: "Submission" },
  approval: { en: "Approval", it: "Approvazione" },
  pdufa: { en: "PDUFA", it: "PDUFA" },
  fda_vote: { en: "FDA vote", it: "Voto FDA" },
  fda_safety: { en: "FDA safety", it: "FDA safety" },
  partnership: { en: "Partnership", it: "Partnership" },
  preclinical: { en: "Preclinical", it: "Preclinico" },
  initiation: { en: "Initiation", it: "Inizio trial" },
  other: { en: "Other", it: "Altro" },
};

function EventBadge({ type, it }: { type: string; it: boolean }) {
  const key = type || "other";
  const colors = EVENT_TYPE_COLORS[key] || EVENT_TYPE_COLORS.other;
  const label = TYPE_LABELS[key]?.[it ? "it" : "en"] ?? key;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${colors.bg} ${colors.text}`}>
      {label}
    </span>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    const d = new Date(`${iso}T12:00:00`);
    const now = new Date(); now.setHours(12, 0, 0, 0);
    return Math.round((d.getTime() - now.getTime()) / 86_400_000);
  } catch { return null; }
}

/**
 * Best T−Catalyst for an event: use window_start if future, else window_end.
 * If we're inside the window (start past, end future), return days to end.
 */
function bestDaysForEvent(ev: GuidanceCalendarEvent): number | null {
  const dStart = daysUntil(ev.window_start);
  const dEnd = daysUntil(ev.window_end);
  if (dStart != null && dStart >= 0) return dStart;
  if (dEnd != null && dEnd >= 0) return dEnd;
  // Both past — return start (most recent)
  if (dStart != null) return dStart;
  return dEnd;
}

function tCatalystLabel(days: number | null, it?: boolean): string {
  if (days == null) return "—";
  if (days === 0) return it ? "OGGI" : "TODAY";
  if (days < 0) return `T+${Math.abs(days)}d`;
  return `T−${days}d`;
}

function urgencyColor(days: number | null): string {
  if (days == null) return "text-ink-muted";
  if (days <= 7) return "text-red-600 dark:text-red-400 font-bold";
  if (days <= 30) return "text-amber-600 dark:text-amber-400 font-semibold";
  if (days <= 60) return "text-yellow-600 dark:text-yellow-400";
  return "text-ink-muted";
}

/* ── Grouped ticker structure ──────────────────────────────────────────────── */

type CatalystTickerItem = {
  ticker: string;
  company: string;
  events: GuidanceCalendarEvent[];
  nearestEvent: GuidanceCalendarEvent | null;
  nearestDays: number | null;
  bestConfidence: number | null;
  primaryType: string;
  phase: string | null;
};

/* ── KPI table cell helpers (mirror existing table styling) ────────────────── */

const KPI_HEADER_CLS = "px-2 py-1.5 text-[8px] font-semibold uppercase tracking-wider text-ink-muted/70";
const KPI_DATA_CLS = "px-2 py-2 text-[11px]";

/* ── Main component ────────────────────────────────────────────────────────── */

export function GuidanceCatalystTickersPanel({
  simTickers,
}: {
  simTickers: Set<string>;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [snap, setSnap] = useState<GuidanceCalendarSnapshot | null>(_cached);
  const [focusTicker, setFocusTicker] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [, setEisDrawerTicker] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (_cached && Date.now() - _cacheTs < CACHE_TTL) {
      setSnap(_cached);
      return;
    }
    try {
      const s = await fetchGuidanceCalendarSnapshot();
      _cached = s; _cacheTs = Date.now();
      setSnap(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo<CatalystTickerItem[]>(() => {
    if (!snap?.events?.length) return [];
    const byTicker = new Map<string, GuidanceCalendarEvent[]>();
    for (const ev of snap.events) {
      const tk = ev.ticker?.trim().toUpperCase();
      if (!tk || simTickers.has(tk)) continue;
      if (!byTicker.has(tk)) byTicker.set(tk, []);
      byTicker.get(tk)!.push(ev);
    }
    const result: CatalystTickerItem[] = [];
    for (const [ticker, events] of byTicker) {
      events.sort((a, b) => (a.window_start ?? "9999").localeCompare(b.window_start ?? "9999"));
      let nearestEvent: GuidanceCalendarEvent | null = null;
      let nearestDays: number | null = null;
      let bestConfidence: number | null = null;
      let phase: string | null = null;
      const typeCounts = new Map<string, number>();
      for (const ev of events) {
        const t = ev.event_type || "other";
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
        const d = bestDaysForEvent(ev);
        if (d != null && (nearestDays == null || (d >= 0 && d < (nearestDays >= 0 ? nearestDays : Infinity)))) {
          nearestDays = d; nearestEvent = ev;
        }
        const c = ev.confidence ?? null;
        if (c != null && (bestConfidence == null || c > bestConfidence)) bestConfidence = c;
        if (!phase && ev.trial_phase) phase = ev.trial_phase;
      }
      if (!nearestEvent && events.length > 0) {
        nearestEvent = events[0];
        nearestDays = bestDaysForEvent(events[0]);
      }
      let primaryType = "other";
      let maxCount = 0;
      for (const [t, c] of typeCounts) { if (c > maxCount) { maxCount = c; primaryType = t; } }
      result.push({ ticker, company: events[0]?.company ?? "", events, nearestEvent, nearestDays, bestConfidence, primaryType, phase });
    }
    result.sort((a, b) => (a.nearestDays ?? 9999) - (b.nearestDays ?? 9999));
    return result;
  }, [snap, simTickers]);

  // Fetch live quotes for all catalyst tickers
  const [quotes, setQuotes] = useState<Record<string, TickerQuote>>({});
  useEffect(() => {
    if (!items.length) return;
    const tickers = items.map((it) => it.ticker);
    let cancelled = false;
    fetchBatchQuotes(tickers)
      .then((res) => {
        if (!cancelled && res?.quotes) setQuotes(res.quotes);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [items]);

  const scrollToCard = (ticker: string) => {
    setFocusTicker(ticker);
    const el = cardRefs.current.get(ticker);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => setFocusTicker(null), 2500);
  };

  /* ── Loading / empty states ─────────────────────────────────────────────── */

  if (!snap) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-ink-muted animate-pulse">
          {it ? "Caricamento catalyst…" : "Loading catalysts…"}
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-3xl">🔬</p>
        <p className="text-sm text-ink-muted font-medium">
          {it
            ? "Nessun nuovo ticker con catalyst al di fuori della Simulation."
            : "No new tickers with catalysts outside of Simulation."}
        </p>
        <p className="text-[11px] text-ink-muted max-w-md leading-snug">
          {it
            ? "Vai su Calendar per lanciare una nuova estrazione su un universo più ampio."
            : "Go to Calendar to run a new extraction on a broader universe."}
        </p>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <>
      {/* ═══════════════════ TOP KPI SNAPSHOT TABLE ═══════════════════════ */}
      <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))]/80 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--border))]/5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
            {it ? "Top KPI Snapshot" : "Top KPI Snapshot"}
          </span>
          <span className="text-[9px] text-ink-muted/60">
            ({items.length}){" "}
            {it ? "Clicca sul ticker per saltare alla scheda sotto." : "Click ticker to jump to the deep-dive panel below."}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px] border-collapse min-w-[900px]">
            <thead>
              <tr className="border-b border-[rgb(var(--border))]/40">
                <th className={`${KPI_HEADER_CLS} text-left`}>Ticker</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>Recommendation</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>Cycle</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>Price</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>P(cont)</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>24h</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>Vol vs prev</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>T−Catalyst</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>{it ? "Fase" : "Phase"}</th>
                <th className={`${KPI_HEADER_CLS} text-center`}>{it ? "Tipo" : "Type"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isNear = item.nearestDays != null && item.nearestDays >= 0 && item.nearestDays <= 30;
                const q = quotes[item.ticker];
                const price = q?.price;
                const chg = q?.dailyChangePct;
                const vol = q?.volume;
                const avgVol = q?.avgVolume;
                const volVsPrev = vol && avgVol && avgVol > 0
                  ? Math.round((vol / avgVol) * 100)
                  : null;
                return (
                  <tr
                    key={item.ticker}
                    className={`border-b border-[rgb(var(--border))]/20 cursor-pointer transition-colors ${
                      isNear
                        ? "bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-100/70 dark:hover:bg-amber-900/20"
                        : "hover:bg-[rgb(var(--surface-3))]/30"
                    }`}
                    onClick={() => scrollToCard(item.ticker)}
                  >
                    {/* TICKER */}
                    <td className={`${KPI_DATA_CLS} text-left`}>
                      <div className="flex flex-col leading-tight">
                        <span className="text-ink-muted/80 truncate max-w-[9rem] text-[10px]">
                          {item.company}
                        </span>
                        <span className="font-bold text-[rgb(var(--accent))]">
                          {item.ticker}
                        </span>
                      </div>
                    </td>
                    {/* RECOMMENDATION */}
                    <td className={`${KPI_DATA_CLS} text-center`}>
                      <span className="text-ink-muted/60 text-[10px]">n.a.</span>
                    </td>
                    {/* CYCLE */}
                    <td className={`${KPI_DATA_CLS} text-center`}>
                      <span className="text-ink-muted/60 text-[10px]">n.a.</span>
                    </td>
                    {/* PRICE */}
                    <td className={`${KPI_DATA_CLS} text-center tabular-nums font-semibold`}>
                      {price != null ? `$${price.toFixed(price >= 100 ? 2 : price >= 1 ? 3 : 4)}` : "—"}
                    </td>
                    {/* P(CONT) */}
                    <td className={`${KPI_DATA_CLS} text-center text-ink-muted`}>
                      —
                    </td>
                    {/* 24H */}
                    <td className={`${KPI_DATA_CLS} text-center tabular-nums whitespace-nowrap`}>
                      {chg != null ? (
                        <span className={chg > 0 ? "text-emerald-600 dark:text-emerald-400" : chg < 0 ? "text-red-600 dark:text-red-400" : "text-ink-muted"}>
                          {chg > 0 ? "▲" : chg < 0 ? "▼" : "●"}{" "}
                          {chg > 0 ? "+" : ""}{chg.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    {/* VOL VS PREV */}
                    <td className={`${KPI_DATA_CLS} text-center tabular-nums whitespace-nowrap`}>
                      {volVsPrev != null ? (
                        <span className={volVsPrev >= 150 ? "text-emerald-700 dark:text-emerald-300 font-bold" : "text-ink-muted"}>
                          {volVsPrev}%
                        </span>
                      ) : "—"}
                    </td>
                    {/* T−CATALYST */}
                    <td className={`${KPI_DATA_CLS} text-center tabular-nums whitespace-nowrap font-semibold ${urgencyColor(item.nearestDays)}`}>
                      {tCatalystLabel(item.nearestDays, it)}
                    </td>
                    {/* PHASE */}
                    <td className={`${KPI_DATA_CLS} text-center text-ink-muted whitespace-nowrap`}>
                      {item.phase ? `Ph ${item.phase}` : "—"}
                    </td>
                    {/* TYPE */}
                    <td className={`${KPI_DATA_CLS} text-center`}>
                      <EventBadge type={item.primaryType} it={it} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════ PER-TICKER CARDS ════════════════════════════ */}
      {items.map((item) => (
        <div
          key={item.ticker}
          ref={(el) => { if (el) cardRefs.current.set(item.ticker, el); }}
          className={`rounded-lg border overflow-hidden transition-all ${
            focusTicker === item.ticker
              ? "border-yellow-400 ring-2 ring-yellow-400/40 bg-yellow-50/30 dark:bg-yellow-900/10"
              : "border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/80"
          }`}
        >
          {/* ── Card header (mirrors existing card header) ──────────── */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--border))]/5">
            <span className="text-xs font-bold text-[rgb(var(--accent))]">
              {item.ticker}
            </span>
            <span className="text-[10px] text-ink-muted truncate">{item.company}</span>
            {item.nearestDays != null ? (
              <span className={`ml-1 text-[10px] font-semibold tabular-nums ${urgencyColor(item.nearestDays)}`}>
                {tCatalystLabel(item.nearestDays)} {it ? "al catalyst" : "to catalyst"}
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {item.events.map((ev, idx) => (
                <EventBadge key={idx} type={ev.event_type || "other"} it={it} />
              ))}
            </div>
          </div>

          {/* ── Card body: EIS + Regulatory + Catalyst table ────────── */}
          <div className="px-4 py-3 space-y-3">
            {/* Catalyst events table */}
            <TickerCatalystEventsTable ticker={item.ticker} />

            {/* EIS + Regulatory panels via existing provider */}
            <TickerImpactEventsPanelProvider
              ticker={item.ticker}
              lang={it ? "it" : "en"}
              layout="split"
              expanded
              onOpenAllEvents={() => setEisDrawerTicker(item.ticker)}
            >
              <div className="space-y-2">
                <TickerImpactEventsContextSection />
                <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-2">
                  <TickerImpactEventsEisLane />
                  <TickerImpactEventsRegLane />
                </div>
              </div>
            </TickerImpactEventsPanelProvider>
          </div>
        </div>
      ))}
    </>
  );
}
