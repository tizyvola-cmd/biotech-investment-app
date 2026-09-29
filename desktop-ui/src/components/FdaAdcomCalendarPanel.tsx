import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchFdaAdcomCalendarSnapshot,
  fetchFdaAdcomCalendarStatus,
  fetchSearchInterest,
  runFdaAdcomBriefingRefresh,
  runFdaAdcomCalendarRefresh,
  type FdaAdcomBriefingCard,
  type FdaAdcomCalendarSnapshot,
  type SearchInterestRow,
} from "../api/supernova";
import {
  FDA_ADCOM_CALENDAR,
  FDA_ADCOM_MATERIALS_URL,
  FDA_ADCOM_SOURCE_URL,
  fdaAdcomHorizon,
  fdaAdcomKindLabel,
  fdaAdcomTickers,
  formatFdaAdcomDays,
  rowsInFdaAdcomHorizon,
  sortFdaAdcomRows,
  type FdaAdcomBriefing,
  type FdaAdcomRow,
} from "../sheet/fdaAdcomCalendar";
import { FdaAdcomBriefingModal, FdaBriefingCell } from "./FdaAdcomBriefingModal";
import { daysUntilIso } from "../sheet/nextCatalystEvent";
import { formatDeskEventDate, mapTickerChunks } from "../sheet/deskCalendarEvents";
import { GoogleTrendsLegendModal } from "./GoogleTrendsLegendModal";
import { SearchInterestLegsStack } from "./SearchInterestTrendMark";

/** Equal gutter on every cell so column-to-column margins stay the same width. */
const CELL = "px-2.5 py-2 align-top";

function asBriefing(raw: FdaAdcomBriefingCard | null | undefined): FdaAdcomBriefing | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    status: raw.status || "none",
    score: raw.score ?? null,
    stance: raw.stance ?? null,
    title: raw.title || "",
    summaryEn: raw.summaryEn || "",
    summaryIt: raw.summaryIt || "",
    bulletsEn: raw.bulletsEn ?? [],
    bulletsIt: raw.bulletsIt ?? [],
    materialsUrl: raw.materialsUrl || FDA_ADCOM_MATERIALS_URL,
    pdfUrl: raw.pdfUrl || "",
    matchOk: raw.matchOk,
    matchHint: raw.matchHint,
    source: raw.source,
    updated_at: raw.updated_at,
  };
}

function snapshotRows(snap: FdaAdcomCalendarSnapshot | null): FdaAdcomRow[] {
  const raw = snap?.rows ?? [];
  return raw
    .filter((r) => r.ticker && r.date)
    .map((r) => ({
      id: r.id,
      date: r.date,
      ticker: r.ticker.trim().toUpperCase(),
      company: r.company,
      product: r.product,
      eventEn: r.eventEn,
      eventIt: r.eventIt,
      committee: r.committee,
      kind: r.kind === "safety_review" ? "safety_review" : "vote",
      href: r.href,
      briefing: asBriefing(r.briefing),
    }));
}

async function waitForFdaRefresh(
  previousUpdatedAt: string | null | undefined,
  timeoutMs = 90_000,
): Promise<FdaAdcomCalendarSnapshot | null> {
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 800));
  let last: FdaAdcomCalendarSnapshot | null = null;
  while (Date.now() - started < timeoutMs) {
    const [status, doc] = await Promise.all([
      fetchFdaAdcomCalendarStatus().catch(() => null),
      fetchFdaAdcomCalendarSnapshot().catch(() => null),
    ]);
    if (doc) last = doc;
    const updated = Boolean(doc?.updated_at && doc.updated_at !== previousUpdatedAt);
    if (updated && status?.running !== true) return doc;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return last;
}

export function FdaAdcomCalendarPanel({ it }: { it: boolean }) {
  const fallback = useMemo(
    () => sortFdaAdcomRows(rowsInFdaAdcomHorizon(FDA_ADCOM_CALENDAR)),
    [],
  );
  const horizon = useMemo(() => fdaAdcomHorizon(), []);
  const [snap, setSnap] = useState<FdaAdcomCalendarSnapshot | null>(null);
  const [rows, setRows] = useState<FdaAdcomRow[]>(fallback);
  const [trendByTicker, setTrendByTicker] = useState<
    Record<string, SearchInterestRow>
  >({});
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openBriefing, setOpenBriefing] = useState<FdaAdcomRow | null>(null);
  const briefingScanOnce = useRef(false);
  const tickers = useMemo(() => fdaAdcomTickers(rows), [rows]);

  const applySnap = (doc: FdaAdcomCalendarSnapshot | null) => {
    if (!doc) return;
    const live = sortFdaAdcomRows(rowsInFdaAdcomHorizon(snapshotRows(doc)));
    setSnap(doc);
    setRows(live);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchFdaAdcomCalendarSnapshot()
      .then((doc) => {
        if (cancelled || !doc) return;
        applySnap(doc);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (briefingScanOnce.current) return;
    const due = rows.some((row) => {
      const days = daysUntilIso(row.date);
      const ready = row.briefing?.status === "ready";
      return days != null && days <= 2 && days >= -3 && !ready;
    });
    if (!due) return;
    briefingScanOnce.current = true;
    let cancelled = false;
    void runFdaAdcomBriefingRefresh(false)
      .then(() => waitForFdaRefresh(snap?.updated_at))
      .then((doc) => {
        if (!cancelled) applySnap(doc);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rows, snap?.updated_at]);

  useEffect(() => {
    if (!tickers.length) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setTrendsLoading(true);
    const scored = (row: SearchInterestRow | undefined) =>
      (row?.interest_score != null && Number.isFinite(row.interest_score)) ||
      (row?.interest_delta_pct != null && Number.isFinite(row.interest_delta_pct)) ||
      (row?.zscore_vs_baseline != null && Number.isFinite(row.zscore_vs_baseline));
    const pull = () =>
      mapTickerChunks(tickers, 8, (chunk) => fetchSearchInterest(chunk)).then((chunks) => {
        if (cancelled) return;
        let warming = false;
        setTrendByTicker((prev) => {
          const next = { ...prev };
          for (const payload of chunks) {
            if (payload.warming) warming = true;
            for (const [raw, row] of Object.entries(payload.rows ?? {})) {
              const tk = raw.trim().toUpperCase();
              if (!tk || !row) continue;
              if (scored(row) || !scored(next[tk])) next[tk] = row;
            }
          }
          return next;
        });
        attempts += 1;
        if (warming && attempts < 8) {
          timer = setTimeout(() => {
            if (!cancelled) void pull();
          }, attempts <= 2 ? 3500 : 6000);
          return;
        }
        setTrendsLoading(false);
      });
    void pull();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tickers]);

  const start = snap?.horizon_start || horizon.start;
  const end = snap?.horizon_end || horizon.end;

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void runFdaAdcomCalendarRefresh(true)
      .then(() => waitForFdaRefresh(snap?.updated_at))
      .then((doc) => applySnap(doc))
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="shrink-0 px-3 pt-2 pb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {it
            ? `Calendario FDA AdCom · NASDAQ · 3 mesi (${rows.length})`
            : `FDA AdCom calendar · NASDAQ · 3 months (${rows.length})`}
        </p>
        <p className="text-[10px] text-ink-muted leading-snug max-w-[52rem]">
          {it
            ? `Finestra ${formatDeskEventDate(start)} → ${formatDeskEventDate(end)}. Solo meeting pubblicati da FDA / Federal Register con ticker NASDAQ. Il 1° di ogni mese la finestra si ripopola. Circa 2 giorni prima cerchiamo i briefing e uno FDA score (colori EIS). Trends = % vs stampa precedente. Non è Soft BUY/SELL.`
            : `Window ${formatDeskEventDate(start)} → ${formatDeskEventDate(end)}. Only meetings FDA / Federal Register have posted, NASDAQ tickers. The 1st of each month rebuilds the window. About 2 days before a meeting we look for briefing materials and an FDA score (EIS colors). Trends = % vs the previous print. Not Soft BUY/SELL.`}{" "}
          <a
            href={FDA_ADCOM_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[rgb(var(--accent))] hover:underline"
          >
            FDA
          </a>
          {" · "}
          <button
            type="button"
            className="font-semibold text-[rgb(var(--accent))] hover:underline disabled:opacity-50"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing
              ? it
                ? "Aggiornamento…"
                : "Updating…"
              : it
                ? "Cerca 3 mesi"
                : "Scan 3 months"}
          </button>
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <table className="w-full text-[11px] border-collapse table-fixed min-w-[52rem]">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[32%]" />
            <col className="w-[14%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="sticky top-0 bg-[rgb(var(--surface))] z-10">
            <tr className="text-[9px] uppercase tracking-wide text-ink-muted text-left">
              <th className={`${CELL} font-semibold`}>{it ? "Titolo" : "Ticker"}</th>
              <th className={`${CELL} font-semibold`}>{it ? "Giorni" : "Days"}</th>
              <th className={`${CELL} font-semibold`}>
                <span className="block">Trends</span>
                <button
                  type="button"
                  className="mt-0.5 text-[9px] font-semibold lowercase tracking-normal text-[rgb(var(--accent))] hover:underline"
                  onClick={() => setLegendOpen(true)}
                >
                  {it ? "come si legge" : "how to read"}
                </button>
              </th>
              <th className={`${CELL} font-semibold`}>{it ? "Data" : "Date"}</th>
              <th className={`${CELL} font-semibold`}>{it ? "Evento" : "Event"}</th>
              <th className={`${CELL} font-semibold`}>{it ? "Prodotto" : "Product"}</th>
              <th className={`${CELL} font-semibold`}>{it ? "Briefing FDA" : "FDA briefing"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className={`${CELL} text-ink-muted`} colSpan={7}>
                  {it
                    ? "Nessun AdCom NASDAQ pubblicato in questa finestra di 3 mesi. Il 1° del mese ripete la ricerca."
                    : "No NASDAQ AdCom posted in this 3-month window. The 1st of the month runs the search again."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const days = daysUntilIso(row.date);
                const upcoming = days != null && days >= 0;
                const trend = trendByTicker[row.ticker];
                return (
                  <tr
                    key={row.id}
                    className={`${row.kind === "vote" && upcoming ? "bg-amber-500/[0.07]" : ""}`}
                  >
                    <td className={`${CELL} leading-tight`}>
                      <span className="block font-bold text-ink">{row.ticker}</span>
                      <span className="block text-[9px] font-medium text-ink-muted truncate">
                        {row.company}
                      </span>
                    </td>
                    <td className={`${CELL} tabular-nums font-semibold text-ink`}>
                      {formatFdaAdcomDays(days, it)}
                    </td>
                    <td className={`${CELL} tabular-nums font-semibold min-w-[5.5rem]`}>
                      <SearchInterestLegsStack
                        row={trend}
                        loading={trendsLoading && !trend}
                        ticker={row.ticker}
                        company={row.company}
                        product={row.product}
                        it={it}
                      />
                    </td>
                    <td className={`${CELL} tabular-nums font-semibold text-ink`}>
                      {formatDeskEventDate(row.date)}
                    </td>
                    <td className={`${CELL} leading-tight`}>
                      <span
                        className={`inline-block mb-0.5 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide ${
                          row.kind === "vote"
                            ? "text-emerald-800 dark:text-emerald-300 bg-emerald-500/15"
                            : "text-ink-muted bg-[rgb(var(--surface-3))]/80"
                        }`}
                      >
                        {fdaAdcomKindLabel(row.kind, it)}
                      </span>
                      <span className="block text-[10px] font-semibold text-ink">
                        {it ? row.eventIt : row.eventEn}
                      </span>
                      <a
                        href={row.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[9px] font-semibold text-[rgb(var(--accent))] hover:underline"
                      >
                        {it ? "Dettaglio FDA" : "FDA detail"}
                      </a>
                    </td>
                    <td className={`${CELL} text-[10px] text-ink leading-tight`}>
                      {row.product}
                    </td>
                    <td className={CELL}>
                      <FdaBriefingCell
                        row={row}
                        days={days}
                        it={it}
                        onOpen={() => setOpenBriefing(row)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <GoogleTrendsLegendModal
        open={legendOpen}
        it={it}
        onClose={() => setLegendOpen(false)}
      />
      {openBriefing ? (
        <FdaAdcomBriefingModal
          row={openBriefing}
          it={it}
          onClose={() => setOpenBriefing(null)}
        />
      ) : null}
    </div>
  );
}
