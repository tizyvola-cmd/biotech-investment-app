import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchClinicalPreCdSnapshot,
  fetchClinicalPreCdStatus,
  fetchRegulatoryRiskSnapshot,
  readLocalSdsSnapshot,
  runClinicalPreCdRefresh,
  type RegulatoryRiskSnapshot,
} from "../api/supernova";
import { writeClinicalPreCdSnapshotCache } from "../sheet/clinicalPreCdSnapshotCache";
import { clinicalKpiFromSimRow } from "../sheet/tickerEisSummary";
import { useClinicalPreCdRecords } from "../hooks/useClinicalPreCdRecords";
import {
  getEisDeepDiveFocus,
  setEisDeepDiveFocus,
  subscribeEisDeepDiveFocus,
  type EisDeepDiveFocus,
} from "../sheet/eisDeepDiveFocusStore";
import type { SheetTable } from "../types";
import { EisDetailPanel } from "./EisDetailPanel";

function findSimRowForTicker(
  simTable: SheetTable | null | undefined,
  ticker: string,
): Record<string, unknown> | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk || !simTable?.rows?.length) return null;
  for (const row of simTable.rows) {
    const r = row as Record<string, unknown>;
    const t = String(r.Ticker ?? r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (t === tk) return r;
  }
  return null;
}

/**
 * EIS deep dive — full page when standalone, or embedded Evaluation sub-tab.
 */
export function EisDeepDiveView({
  simTable,
  it = false,
  onBack,
  backLabel,
  embedded = false,
}: {
  simTable: SheetTable | null;
  it?: boolean;
  /** Return to company deep-dive (embedded) or previous screen. */
  onBack?: () => void;
  /** Optional label for the back target, e.g. ticker or "Evaluation". */
  backLabel?: string | null;
  /** Inside Evaluation Lab deep-dive window (no app-level screen). */
  embedded?: boolean;
}) {
  const { records, reload } = useClinicalPreCdRecords();
  const [focus, setFocus] = useState<EisDeepDiveFocus | null>(() => getEisDeepDiveFocus());
  const [tickerInput, setTickerInput] = useState(() => getEisDeepDiveFocus()?.ticker ?? "");
  const [autoRegSnap, setAutoRegSnap] = useState<RegulatoryRiskSnapshot | null>(null);
  const [sdsMechanismClass, setSdsMechanismClass] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => subscribeEisDeepDiveFocus(() => setFocus(getEisDeepDiveFocus())), []);

  useEffect(() => {
    if (focus?.ticker) setTickerInput(focus.ticker);
  }, [focus?.ticker, focus?.openedAt]);

  useEffect(() => {
    void fetchRegulatoryRiskSnapshot()
      .then(setAutoRegSnap)
      .catch(() => setAutoRegSnap(null));
  }, []);

  const ticker = (focus?.ticker ?? tickerInput).trim().toUpperCase();

  useEffect(() => {
    if (!ticker) {
      setSdsMechanismClass(null);
      return;
    }
    let cancelled = false;
    void readLocalSdsSnapshot()
      .then((doc) => {
        if (cancelled) return;
        const hit = (doc?.rows ?? []).find(
          (r) => String(r.ticker ?? "").trim().toUpperCase() === ticker,
        );
        setSdsMechanismClass(hit?.mechanism_class ?? null);
      })
      .catch(() => {
        if (!cancelled) setSdsMechanismClass(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const simRow = useMemo(() => {
    if (focus?.simRow) return focus.simRow;
    return findSimRowForTicker(simTable, ticker);
  }, [focus?.simRow, simTable, ticker]);

  const clinicalKpi = useMemo(() => {
    if (focus?.clinicalKpi != null && Number.isFinite(focus.clinicalKpi)) {
      return focus.clinicalKpi;
    }
    return clinicalKpiFromSimRow(simRow);
  }, [focus?.clinicalKpi, simRow]);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const reloadSnapshot = useCallback(async () => {
    try {
      const snap = await fetchClinicalPreCdSnapshot({ preferApi: true });
      writeClinicalPreCdSnapshotCache(snap);
    } catch {
      /* parent reload may still help */
    }
    reload();
  }, [reload]);

  const handleTickerClinicalRefresh = useCallback(async () => {
    if (!ticker || refreshing) return;
    setRefreshing(true);
    setRefreshMsg(
      it ? `Clinical refresh solo ${ticker}…` : `Clinical refresh for ${ticker} only…`,
    );
    try {
      const started = await runClinicalPreCdRefresh(false, {
        force: true,
        deep: true,
        tickers: [ticker],
      });
      if (started?.started === false) {
        setRefreshMsg(
          started.message ||
            (it ? "Refresh già in corso" : "Refresh already running"),
        );
        setRefreshing(false);
        return;
      }
      clearPoll();
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const st = await fetchClinicalPreCdStatus();
            if (st?.message) setRefreshMsg(st.message);
            if (st?.running) return;
            clearPoll();
            setRefreshing(false);
            await reloadSnapshot();
            setRefreshMsg(
              st?.error
                ? st.error
                : it
                  ? `Aggiornato ${ticker}`
                  : `Updated ${ticker}`,
            );
            window.setTimeout(() => setRefreshMsg(null), 4000);
          } catch (e) {
            clearPoll();
            setRefreshing(false);
            setRefreshMsg(e instanceof Error ? e.message : String(e));
          }
        })();
      }, 2000);
    } catch (e) {
      setRefreshing(false);
      setRefreshMsg(e instanceof Error ? e.message : String(e));
    }
  }, [ticker, refreshing, it, clearPoll, reloadSnapshot]);

  const commitTicker = useCallback(
    (raw: string) => {
      const tk = raw.trim().toUpperCase();
      if (!tk) return;
      setTickerInput(tk);
      const row = findSimRowForTicker(simTable, tk);
      setEisDeepDiveFocus({
        ticker: tk,
        clinicalKpi: clinicalKpiFromSimRow(row),
        simRow: row,
      });
    },
    [simTable],
  );

  return (
    <div className={`w-full min-w-0 ${embedded ? "" : "max-w-5xl mx-auto"} space-y-4 ${embedded ? "pb-4" : "pb-8"}`}>
      <header className="rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))] px-4 py-3.5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/50 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-[rgb(var(--accent))]/10 hover:border-[rgb(var(--accent))]/35 transition"
                title={
                  backLabel
                    ? it
                      ? `Torna a ${backLabel}`
                      : `Back to ${backLabel}`
                    : it
                      ? "Torna indietro"
                      : "Go back"
                }
              >
                <span aria-hidden>←</span>
                {backLabel
                  ? it
                    ? `Indietro · ${backLabel}`
                    : `Back · ${backLabel}`
                  : it
                    ? "Indietro"
                    : "Back"}
              </button>
            ) : null}
            <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
              {it ? "R&D" : "R&D"}
            </p>
            <h2 className="text-lg font-bold text-ink">
              {ticker || (it ? "Seleziona un ticker" : "Pick a ticker")}
            </h2>
            <p className="text-[11px] text-ink-muted leading-snug mt-0.5">
              {it
                ? "R&D: pipeline, trial, press, CT.gov e CD. Gli 8-K sono nella tab Financial (dossier EDGAR)."
                : "R&D: pipeline, trials, press, CT.gov and CD. 8-K filings are in the Financial tab (EDGAR dossier)."}
            </p>
            {refreshMsg ? (
              <p
                className={`mt-1 text-[10px] leading-snug truncate ${
                  refreshing ? "text-[rgb(var(--accent))]" : "text-ink-muted"
                }`}
                title={refreshMsg}
              >
                {refreshing ? "⏳ " : ""}
                {refreshMsg}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                commitTicker(tickerInput);
              }}
            >
              <input
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onBlur={() => commitTicker(tickerInput)}
                placeholder="TICKER"
                className="w-28 rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/40 px-2.5 py-1.5 text-xs font-semibold tracking-wide uppercase text-ink focus:outline-none focus:ring-1 focus:ring-[rgb(var(--accent))]/50"
                aria-label={it ? "Ticker" : "Ticker"}
                title={
                  it
                    ? "Digita un ticker e premi Invio"
                    : "Type a ticker and press Enter"
                }
              />
            </form>
            <button
              type="button"
              disabled={!ticker || refreshing}
              onClick={() => void handleTickerClinicalRefresh()}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface))] px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm transition hover:bg-[rgb(var(--accent))]/10 disabled:opacity-50"
              title={
                it
                  ? `Clinical feed refresh solo per ${ticker || "…"} (Deep + force)`
                  : `Clinical feed refresh for ${ticker || "…"} only (Deep + force)`
              }
            >
              <span aria-hidden>{refreshing ? "⏳" : "🔬"}</span>
              {refreshing
                ? it
                  ? `Refreshing…`
                  : `Refreshing…`
                : it
                  ? `Clinical refresh`
                  : `Clinical refresh`}
            </button>
          </div>
        </div>
      </header>

      {ticker ? (
        <EisDetailPanel
          ticker={ticker}
          clinicalKpi={clinicalKpi}
          clinicalRecords={records}
          simRow={simRow}
          autoRegSnap={autoRegSnap}
          sdsMechanismClass={sdsMechanismClass}
          it={it}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/60 px-4 py-10 text-center">
          <p className="text-sm text-ink-muted">
            {it
              ? embedded
                ? "Apri R&D dalla scheda società, oppure digita un ticker sopra."
                : "Apri R&D da Dashboard / Evaluation, oppure digita un ticker sopra."
              : embedded
                ? "Open R&D from the company deep-dive tab, or type a ticker above."
                : "Open R&D from Dashboard / Evaluation, or type a ticker above."}
          </p>
        </div>
      )}
    </div>
  );
}
