import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCatalystCalendarSnapshot,
  fetchCatalystCalendarStatus,
  runCatalystCalendarRefresh,
  type CatalystCalendarEntry,
  type CatalystCalendarSnapshot,
  type CatalystCalendarStatus,
} from "../api/supernova";
import {
  msUntilNextRomeMidnight,
  recordCalendarForwardTickers,
} from "../sheet/catalystDeskNewLedger";
import { CalendarPromoteStarToggle } from "./CalendarPromoteStarToggle";
import { useCatalystInterestTickers } from "../hooks/useCatalystInterestTickers";

function ConfidenceBadge({
  confidence,
  it,
}: {
  confidence?: string | null;
  it: boolean;
}) {
  const c = (confidence || "").toLowerCase();
  const cls =
    c === "high"
      ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/35"
      : c === "medium"
        ? "bg-amber-500/15 text-amber-800 border-amber-500/35"
        : "bg-slate-500/10 text-slate-600 border-slate-400/30";
  const label =
    c === "high"
      ? it
        ? "alta"
        : "high"
      : c === "medium"
        ? it
          ? "media"
          : "medium"
        : it
          ? "bassa"
          : "low";
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[9px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function TypeBadge({ type }: { type?: string | null }) {
  const t = type || "—";
  const cls =
    t === "PDUFA"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
      : t === "AdCom"
        ? "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200"
        : t === "Readout"
          ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
          : t === "Partnership"
            ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
            : "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${cls}`}>
      {t}
    </span>
  );
}

function formatWhen(e: CatalystCalendarEntry, it: boolean): { primary: string; sub: string } {
  if (e.date_precision === "exact_date" && e.date_value) {
    try {
      const d = new Date(`${e.date_value}T12:00:00`);
      const primary = d.toLocaleDateString(it ? "it-IT" : "en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return { primary, sub: it ? "data esatta" : "exact date" };
    } catch {
      return { primary: e.date_value, sub: it ? "data esatta" : "exact date" };
    }
  }
  const wl = e.window_label || "—";
  const sub =
    e.date_precision === "half_year_window"
      ? it
        ? "finestra semestrale"
        : "half-year window"
      : it
        ? "finestra trimestre"
        : "quarter window";
  return { primary: wl, sub };
}

function readoutHistoryForTicker(
  entries: CatalystCalendarEntry[],
  ticker: string,
): CatalystCalendarEntry[] {
  return entries
    .filter((e) => e.event_type === "Readout" && e.ticker === ticker)
    .sort((a, b) => String(a.extracted_at || "").localeCompare(String(b.extracted_at || "")));
}

export function CatalystForwardCalendarPanel({ it = false }: { it?: boolean }) {
  useCatalystInterestTickers();
  const [snap, setSnap] = useState<CatalystCalendarSnapshot | null>(null);
  const [status, setStatus] = useState<CatalystCalendarStatus | null>(null);
  const [filterTicker, setFilterTicker] = useState("");
  const [filterType, setFilterType] = useState("");
  const [busy, setBusy] = useState(false);
  const [newTodayTickers, setNewTodayTickers] = useState<Set<string>>(() => new Set());
  const [romeDay, setRomeDay] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        fetchCatalystCalendarSnapshot(),
        fetchCatalystCalendarStatus(),
      ]);
      setSnap(s);
      setStatus(st);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!status?.running) return;
    const id = window.setInterval(() => {
      void (async () => {
        const st = await fetchCatalystCalendarStatus().catch(() => null);
        if (st) setStatus(st);
        if (st && !st.running) void load();
      })();
    }, 2500);
    return () => window.clearInterval(id);
  }, [status?.running, load]);

  useEffect(() => {
    const wait = msUntilNextRomeMidnight();
    const id = window.setTimeout(() => setRomeDay((n) => n + 1), wait);
    return () => window.clearTimeout(id);
  }, [romeDay]);

  const observedTickers = useMemo(() => {
    const fromEntries = (snap?.entries ?? []).map((e) => String(e.ticker || "").toUpperCase());
    const meta = snap?.meta as { discovery_tickers?: string[] } | undefined;
    const fromDiscovery = meta?.discovery_tickers ?? [];
    return [...new Set([...fromEntries, ...fromDiscovery].filter(Boolean))];
  }, [snap]);

  useEffect(() => {
    if (!observedTickers.length) {
      setNewTodayTickers(new Set());
      return;
    }
    setNewTodayTickers(new Set(recordCalendarForwardTickers(observedTickers)));
  }, [observedTickers, romeDay]);

  const entries = useMemo(() => {
    const all = snap?.entries ?? [];
    const tk = filterTicker.trim().toUpperCase();
    return all.filter((e) => {
      if (tk && !e.ticker.includes(tk)) return false;
      if (filterType && e.event_type !== filterType) return false;
      return true;
    });
  }, [snap?.entries, filterTicker, filterType]);

  const handleRefresh = async () => {
    setBusy(true);
    try {
      await runCatalystCalendarRefresh();
      const st = await fetchCatalystCalendarStatus();
      setStatus(st);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const handleBiotechGapScan = async () => {
    const ok = window.confirm(
      it
        ? "Scansiona ~600 società biotech ancora fuori dal Calendar (solo gap).\n\nModalità veloce: 8 worker paralleli, ≤4 8-K per società (stima ~1–2 ore, non 20).\n\nContinuare?"
        : "Scan ~600 biotech names not yet on the Calendar (gap only).\n\nFast mode: 8 parallel workers, ≤4 8-Ks per company (~1–2 hours, not 20).\n\nContinue?",
    );
    if (!ok) return;
    setBusy(true);
    try {
      await runCatalystCalendarRefresh({ includeBiotech: true, biotechGapOnly: true });
      const st = await fetchCatalystCalendarStatus();
      setStatus(st);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const discoveryN = (snap?.meta as { discovery_tickers?: string[] } | undefined)?.discovery_tickers
    ?.length;
  const biotechMeta = snap?.meta as
    | { biotech_gap_only?: boolean; biotech_tickers?: string[]; include_biotech?: boolean }
    | undefined;

  return (
    <div className="flex flex-col gap-3 min-w-0 w-full">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">
            {it ? "Calendario forward SEC" : "SEC forward calendar"}
          </h2>
          <p className="text-[10px] text-ink-muted max-w-prose mt-0.5 leading-snug">
            {it
              ? "Ogni Refresh riesamina TUTTE le società già in calendario (+ Discovery auto). PDUFA/AdCom (data esatta) · Readout (finestre) · Conference · Partnership (Item 1.01: closing, opt-in, milestone). 🔖 = nuovo oggi (mezzanotte Roma). «Scan biotech gap» aggiunge i nomi di biotech_symbols.json ancora fuori lista."
              : "Each Refresh re-scans ALL calendar companies (+ Discovery auto). PDUFA/AdCom (exact) · Readout (windows) · Conference · Partnership (Item 1.01: closing, opt-in, milestone). 🔖 = new today (Rome midnight). “Scan biotech gap” adds biotech_symbols.json names not yet listed."}
          </p>
          <p className="text-[9px] text-ink-muted mt-1">
            {snap?.updated_at
              ? `${it ? "Aggiornato" : "Updated"} ${snap.updated_at.slice(0, 19).replace("T", " ")} · ${
                  snap.count ?? 0
                } ${it ? "righe" : "rows"} · ${it ? "storico" : "history"} ${snap.history_count ?? 0}${
                  discoveryN ? ` · Discovery ${discoveryN}` : ""
                }${
                  biotechMeta?.biotech_tickers?.length
                    ? ` · Biotech gap ${biotechMeta.biotech_tickers.length}`
                    : ""
                }${newTodayTickers.size ? ` · 🔖 ${newTodayTickers.size}` : ""}`
              : it
                ? "Nessuno snapshot — avvia Refresh."
                : "No snapshot yet — run Refresh."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0 justify-end">
          <button
            type="button"
            className="btn-ghost text-[11px] px-2.5 py-1.5"
            disabled={busy || !!status?.running}
            title={
              it
                ? "Solo società biotech non ancora in Calendar (~600, ~1–2 ore in modalità veloce)"
                : "Only biotech names not yet on Calendar (~600, ~1–2 hours in fast mode)"
            }
            onClick={() => void handleBiotechGapScan()}
          >
            {it ? "Scan biotech gap" : "Scan biotech gap"}
          </button>
          <button
            type="button"
            className="btn-primary text-[11px] px-2.5 py-1.5"
            disabled={busy || !!status?.running}
            onClick={() => void handleRefresh()}
          >
            {status?.running || busy
              ? status?.message || (it ? "Elaborazione…" : "Working…")
              : it
                ? "Refresh SEC calendar"
                : "Refresh SEC calendar"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          className="feed-panel-input rounded-lg px-2 py-1 text-[11px] w-28"
          placeholder="Ticker…"
          value={filterTicker}
          onChange={(e) => setFilterTicker(e.target.value)}
        />
        <select
          className="feed-panel-input rounded-lg px-2 py-1 text-[11px]"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">{it ? "Tutti i tipi" : "All types"}</option>
          <option value="PDUFA">PDUFA</option>
          <option value="AdCom">AdCom</option>
          <option value="Readout">Readout</option>
          <option value="Conference">Conference</option>
          <option value="Partnership">Partnership</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/40">
        <table className="w-full text-[11px] min-w-[52rem]">
          <thead className="bg-surface/80 text-ink-muted text-left">
            <tr>
              <th className="px-2 py-2 font-semibold">{it ? "Quando" : "When"}</th>
              <th className="px-2 py-2 font-semibold">Ticker</th>
              <th className="px-2 py-2 font-semibold">Type</th>
              <th className="px-2 py-2 font-semibold">{it ? "Confidenza" : "Confidence"}</th>
              <th className="px-2 py-2 font-semibold">Source</th>
              <th className="px-2 py-2 font-semibold">Snippet</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-muted italic">
                  {it ? "Nessun evento — lancia Refresh." : "No events — run Refresh."}
                </td>
              </tr>
            ) : (
              entries.map((e) => {
                const when = formatWhen(e, it);
                const hist =
                  e.event_type === "Readout"
                    ? readoutHistoryForTicker(snap?.entries ?? [], e.ticker)
                    : [];
                const tk = String(e.ticker || "").toUpperCase();
                const isNew = newTodayTickers.has(tk);
                const mainInf = e.main_inflection === true;
                return (
                  <tr
                    key={
                      e.id ||
                      `${e.ticker}-${e.event_type}-${e.date_value}-${e.window_label}-${e.extracted_at}`
                    }
                    className={`border-t border-[rgb(var(--border))]/25 align-top ${
                      isNew ? "bg-amber-500/[0.07]" : ""
                    }${mainInf ? " calendar-main-inflection" : ""}`}
                    title={
                      mainInf
                        ? e.inflection_label ||
                          (it ? "Main inflection point" : "Main inflection point")
                        : undefined
                    }
                  >
                    <td className="px-2 py-2">
                      <div
                        className={
                          mainInf
                            ? "font-bold text-[#C68E17] tabular-nums"
                            : e.date_precision === "exact_date"
                              ? "font-semibold text-ink tabular-nums"
                              : "font-medium text-amber-800 dark:text-amber-200"
                        }
                      >
                        {when.primary}
                      </div>
                      <div className="text-[9px] text-ink-muted">{when.sub}</div>
                      {hist.length > 1 ? (
                        <div className="mt-1 text-[9px] text-ink-muted leading-snug">
                          {it ? "Storico finestre:" : "Window history:"}{" "}
                          {hist.map((h) => h.window_label || "—").join(" → ")}
                        </div>
                      ) : null}
                    </td>
                    <td
                      className={`px-2 py-2 font-semibold${
                        mainInf ? " text-[#C68E17] font-bold" : ""
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <CalendarPromoteStarToggle
                          ticker={e.ticker}
                          cdIso={e.date_value || null}
                          it={it}
                          sizeClass="text-[12px]"
                        />
                        {e.ticker}
                        {isNew ? (
                          <span
                            className="ml-1 text-[11px] leading-none"
                            title={
                              it
                                ? "Nuovo oggi — sparisce da solo a mezzanotte (Roma)"
                                : "New today — clears at midnight (Rome)"
                            }
                            aria-label={it ? "Segnalibro nuovo oggi" : "New today bookmark"}
                          >
                            🔖
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <TypeBadge type={e.event_type} />
                      {e.partner ? (
                        <div className="mt-1 text-[9px] text-ink-muted leading-snug">
                          {e.partner}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <ConfidenceBadge confidence={e.confidence} it={it} />
                    </td>
                    <td className="px-2 py-2 text-[10px]">
                      <div>
                        {e.source_form || "—"}
                        {e.source_item ? ` · ${e.source_item}` : ""}
                      </div>
                      {e.source_filing_url ? (
                        <a
                          href={e.source_filing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:underline"
                        >
                          SEC ↗
                        </a>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-[10px] text-ink-muted max-w-[22rem] leading-snug">
                      {e.raw_snippet || "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
