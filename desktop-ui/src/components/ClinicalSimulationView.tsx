import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SheetTable } from "../types";
import {
  buildFutureCdCalendar,
  buildSimulationCdCatalog,
  CLINICAL_6M_DAYS,
  CLINICAL_MAX_CD_DAYS,
  CLINICAL_HOT_CD_DAYS,
  filterClinicalForSimulationCd,
  type FutureCdEntry,
  type SimCdCatalyst,
} from "../sheet/clinicalSimulationFilter";
import { ClinicalStudyCardsPanel } from "./ClinicalStudyCards";
import { StudySummaryModal } from "./StudySummaryModal";

// ── Helpers ──────────────────────────────────────────────────────────────────

function entryKey(e: FutureCdEntry): string {
  return `${e.ticker}|${e.cdIso}|${e.nct ?? ""}`;
}

function fmtPhase(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/^EARLY_/, "Early ")
    .replace(/^PHASE(\d)$/, "Phase $1")
    .replace(/^PHASE(\d)\/PHASE(\d)$/, "Phase $1/$2")
    .replace("NA", "N/A");
}

function fmtStatus(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function urgencyClass(days: number): string {
  if (days <= 14) return "text-[rgb(var(--signal-down))] font-bold";
  if (days <= 60) return "text-[rgb(var(--warn))] font-semibold";
  return "text-ink-muted";
}

function cdBadge(days: number): string {
  if (days === 0) return "⚡ Today";
  if (days <= 7) return `🔴 ${days}d`;
  if (days <= 14) return `⚠ ${days}d`;
  return `${days}d`;
}

// ── Quarterly refresh hook ────────────────────────────────────────────────────

const REFRESH_LS_KEY = "sn_clinical_cd_refresh_ts";
const REFRESH_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000; // 3 months

function useQuarterlyRefresh(onRefresh: () => void) {
  const [lastRefresh, setLastRefresh] = useState<Date | null>(() => {
    try {
      const ts = localStorage.getItem(REFRESH_LS_KEY);
      return ts ? new Date(ts) : null;
    } catch {
      return null;
    }
  });

  const markAndRefresh = useCallback(
    (refresh: () => void) => {
      const now = new Date();
      try {
        localStorage.setItem(REFRESH_LS_KEY, now.toISOString());
      } catch { /* ignore */ }
      setLastRefresh(now);
      refresh();
    },
    []
  );

  const didAutoRefresh = useRef(false);
  useEffect(() => {
    if (didAutoRefresh.current) return;
    didAutoRefresh.current = true;
    const last = lastRefresh?.getTime() ?? 0;
    if (Date.now() - last > REFRESH_INTERVAL_MS) {
      markAndRefresh(onRefresh);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trigger = useCallback(
    (onBeforeRefresh?: () => void) => {
      onBeforeRefresh?.();
      markAndRefresh(onRefresh);
    },
    [markAndRefresh, onRefresh]
  );

  const nextRefresh = lastRefresh
    ? new Date(lastRefresh.getTime() + REFRESH_INTERVAL_MS)
    : null;

  return { lastRefresh, nextRefresh, trigger };
}

// ── Diff popup ────────────────────────────────────────────────────────────────

type DiffResult = {
  newEntries: FutureCdEntry[];
  noChange: boolean;
};

function DiffPopup({
  diff,
  onClose,
}: {
  diff: DiffResult;
  onClose: () => void;
}) {
  // Auto-close after 6 s if no change
  useEffect(() => {
    if (!diff.noChange) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [diff.noChange, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0"
      role="dialog"
      aria-modal="true"
    >
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-md rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl overflow-hidden">
        {/* header */}
        <div
          className={`flex items-center gap-2 px-4 py-3 ${
            diff.noChange
              ? "bg-[rgb(var(--signal-up))]/10 border-b border-[rgb(var(--signal-up))]/20"
              : "bg-[rgb(var(--accent))]/10 border-b border-[rgb(var(--accent))]/20"
          }`}
        >
          <span className="text-lg">{diff.noChange ? "✓" : "🔔"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">
              {diff.noChange
                ? "Clinical data up to date"
                : `${diff.newEntries.length} new entr${diff.newEntries.length === 1 ? "y" : "ies"} detected`}
            </p>
            <p className="text-[11px] text-ink-muted">
              {diff.noChange
                ? "No new clinical trials since last refresh"
                : "New clinical trials added since last refresh"}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-ink-muted hover:text-ink hover:bg-[rgb(var(--surface-3))] text-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* body */}
        {!diff.noChange && diff.newEntries.length > 0 && (
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-[rgb(var(--border))]/30">
            {diff.newEntries.map((e) => (
              <div key={entryKey(e)} className="flex items-start gap-3 px-4 py-2.5">
                <span className="shrink-0 mt-0.5 w-[46px] text-center px-1 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-[rgb(var(--accent))]">
                  {e.ticker}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-ink truncate">
                    {e.company || e.ticker}
                  </p>
                  {e.briefTitle && (
                    <p
                      className="text-[10px] text-ink-muted/80 line-clamp-1 mt-0.5"
                      title={e.briefTitle}
                    >
                      {e.briefTitle}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {e.phase && (
                      <span className="text-[9px] px-1 py-0.5 rounded border border-[rgb(var(--border))]/40 text-ink-muted">
                        {fmtPhase(e.phase)}
                      </span>
                    )}
                    {e.status && (
                      <span className="text-[9px] px-1 py-0.5 rounded border border-[rgb(var(--border))]/40 text-ink-muted">
                        {fmtStatus(e.status)}
                      </span>
                    )}
                    {e.studyHref && (
                      <a
                        href={e.studyHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-[rgb(var(--accent))] hover:underline"
                      >
                        {e.nct ?? "View"}
                      </a>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right mt-0.5">
                  <p className={`text-[11px] tabular-nums ${urgencyClass(e.daysToCd)}`}>
                    {cdBadge(e.daysToCd)}
                  </p>
                  <p className="text-[10px] text-ink-muted/60 tabular-nums">{e.cdDisplay}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* footer */}
        <div className="px-4 py-2.5 flex justify-end border-t border-[rgb(var(--border))]/30">
          <button
            type="button"
            className="btn-ghost text-xs px-3 py-1"
            onClick={onClose}
          >
            {diff.noChange ? "OK" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Refresh header ────────────────────────────────────────────────────────────

function RefreshHeader({
  lastRefresh,
  nextRefresh,
  loading,
  onTrigger,
}: {
  lastRefresh: Date | null;
  nextRefresh: Date | null;
  loading: boolean;
  onTrigger: () => void;
}) {
  const fmtDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

  const daysToNext = nextRefresh
    ? Math.max(0, Math.ceil((nextRefresh.getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="clinical-view-refresh flex items-center gap-3 px-3 py-2 text-[11px]">
      <span className="text-[rgb(var(--accent))]">↻</span>
      <span className="text-ink-muted">
        CD auto-refresh <strong className="text-ink">quarterly</strong>
      </span>
      <span className="text-ink-muted/60">·</span>
      {lastRefresh ? (
        <span className="text-ink-muted">
          Last: <span className="text-ink tabular-nums">{fmtDate(lastRefresh)}</span>
        </span>
      ) : (
        <span className="text-ink-muted">Not yet refreshed</span>
      )}
      {nextRefresh && daysToNext !== null && (
        <>
          <span className="text-ink-muted/60">·</span>
          <span className="text-ink-muted">
            Next auto:{" "}
            <span className="text-ink tabular-nums">
              {fmtDate(nextRefresh)}{" "}
              <span className="text-ink-muted">({daysToNext}d)</span>
            </span>
          </span>
        </>
      )}
      <button
        type="button"
        className="ml-auto btn-ghost text-[11px] px-2.5 py-1 flex items-center gap-1.5 disabled:opacity-50"
        onClick={onTrigger}
        disabled={loading}
        title="Reload clinical snapshot now and reset the 3-month timer"
      >
        <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
        {loading ? "Loading…" : "Refresh now"}
      </button>
    </div>
  );
}

// ── Calendar card ─────────────────────────────────────────────────────────────

type SummaryTarget = { nct: string; ticker: string; company: string; briefTitle?: string | null };

function CdCalendarRow({
  entry,
  onOpenSummary,
}: {
  entry: FutureCdEntry;
  onOpenSummary: (t: SummaryTarget) => void;
}) {
  return (
    <div className="clinical-view-divider flex items-start gap-3 py-2 border-b last:border-0">
      <span className="shrink-0 w-[52px] text-center px-1 py-0.5 rounded text-[10px] font-bold bg-accent/15 text-[rgb(var(--accent))]">
        {entry.ticker}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink leading-tight truncate" title={entry.company}>
          {entry.company || entry.ticker}
        </p>
        {entry.briefTitle && (
          <p
            className="text-[10px] text-ink-muted/80 leading-tight mt-0.5 line-clamp-2"
            title={entry.briefTitle}
          >
            {entry.briefTitle}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {entry.phase && (
            <span className="clinical-chip text-[9px] px-1.5 py-0.5 rounded-full">
              {fmtPhase(entry.phase)}
            </span>
          )}
          {entry.status && (
            <span className="clinical-chip text-[9px] px-1.5 py-0.5 rounded-full">
              {fmtStatus(entry.status)}
            </span>
          )}
          {entry.studyHref && (
            <a
              href={entry.studyHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-[rgb(var(--accent))] hover:underline"
              title={entry.nct ?? "Open study"}
            >
              {entry.nct ?? "View"}
            </a>
          )}
          {entry.nct && (
            <button
              type="button"
              onClick={() =>
                onOpenSummary({
                  nct: entry.nct!,
                  ticker: entry.ticker,
                  company: entry.company,
                  briefTitle: entry.briefTitle,
                })
              }
              className="clinical-ai-summary-btn text-[9px] font-semibold px-1.5 py-0.5 rounded-full transition"
              title="Generate AI summary of study outcomes"
            >
              ✦ AI Summary
            </button>
          )}
          {!entry.hasClinicalData && (
            <span className="text-[9px] text-ink-muted/50 italic">no study matched</span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className={`text-[11px] tabular-nums ${urgencyClass(entry.daysToCd)}`}>
          {cdBadge(entry.daysToCd)}
        </p>
        <p className="text-[10px] text-ink-muted/70 tabular-nums">{entry.cdDisplay}</p>
      </div>
    </div>
  );
}

function ClinicalCdCalendar({
  calendar,
  onOpenSummary,
}: {
  calendar: FutureCdEntry[];
  onOpenSummary: (t: SummaryTarget) => void;
}) {
  const withinHot = calendar.filter((e) => e.daysToCd <= CLINICAL_HOT_CD_DAYS);
  const withinWatch = calendar.filter(
    (e) => e.daysToCd > CLINICAL_HOT_CD_DAYS && e.daysToCd <= CLINICAL_MAX_CD_DAYS,
  );
  const beyondMonitor = calendar.filter((e) => e.daysToCd > CLINICAL_MAX_CD_DAYS);

  if (calendar.length === 0) {
    return (
      <p className="text-xs text-ink-muted/60 py-4 text-center">
        No upcoming CDs within {CLINICAL_6M_DAYS} days in the Simulation sheet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {withinHot.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--warn))] mb-2">
            ⚡ Hot zone (≤{CLINICAL_HOT_CD_DAYS}d) — {withinHot.length} catalyst{withinHot.length !== 1 ? "s" : ""}
          </p>
          <div>
            {withinHot.map((e) => (
              <CdCalendarRow key={e.ticker} entry={e} onOpenSummary={onOpenSummary} />
            ))}
          </div>
        </div>
      )}
      {withinWatch.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--accent))] mb-2">
            👁 Watch ({CLINICAL_HOT_CD_DAYS + 1}–{CLINICAL_MAX_CD_DAYS}d) — {withinWatch.length} catalyst{withinWatch.length !== 1 ? "s" : ""}
          </p>
          <div>
            {withinWatch.map((e) => (
              <CdCalendarRow key={`watch-${e.ticker}`} entry={e} onOpenSummary={onOpenSummary} />
            ))}
          </div>
        </div>
      )}
      {beyondMonitor.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted mb-2">
            Beyond {CLINICAL_MAX_CD_DAYS}d — {beyondMonitor.length}
          </p>
          <div className="opacity-60">
            {beyondMonitor.map((e) => (
              <CdCalendarRow key={`beyond-${e.ticker}`} entry={e} onOpenSummary={onOpenSummary} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function ClinicalSimulationView({
  simTable,
  clinicalTable,
  loading,
  error,
  onReload,
}: {
  simTable: SheetTable | null;
  clinicalTable: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  // ── Diff popup state ────────────────────────────────────────────────────────
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  // ── AI Study Summary modal ───────────────────────────────────────────────────
  const [selectedStudy, setSelectedStudy] = useState<SummaryTarget | null>(null);

  // Snapshot taken just before a manual refresh fires.
  // null means no refresh is pending.
  const snapshotRef = useRef<Set<string> | null>(null);
  // Distinguish manual vs auto-refresh (auto only shows popup if there are new entries)
  const isManualRefreshRef = useRef(false);

  // ── Calendar data ───────────────────────────────────────────────────────────
  const catalog = useMemo(() => buildSimulationCdCatalog(simTable), [simTable]);

  const cdTable = useMemo(
    () => filterClinicalForSimulationCd(clinicalTable, catalog),
    [clinicalTable, catalog]
  );

  const simCdByTicker = useMemo(() => {
    const o: Record<string, SimCdCatalyst> = {};
    for (const [k, v] of catalog) o[k] = v;
    return o;
  }, [catalog]);

  const missingCd = useMemo(() => {
    const simTickers = new Set(catalog.keys());
    const withStudy = new Set(
      (cdTable?.rows ?? []).map((r) =>
        String(r.ticker ?? r.Ticker ?? "").trim().toUpperCase()
      )
    );
    return [...simTickers].filter((t) => !withStudy.has(t));
  }, [catalog, cdTable?.rows]);

  const calendar = useMemo(
    () => buildFutureCdCalendar(simTable, clinicalTable, CLINICAL_6M_DAYS),
    [simTable, clinicalTable]
  );

  // ── Detect loading completion and compute diff ──────────────────────────────
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    if (wasLoading && !loading && snapshotRef.current !== null) {
      const snapshot = snapshotRef.current;
      snapshotRef.current = null;
      const newEntries = calendar.filter((e) => !snapshot.has(entryKey(e)));
      const noChange = newEntries.length === 0;

      // Auto-refresh: only show popup if there are new entries
      if (isManualRefreshRef.current || !noChange) {
        setDiffResult({ newEntries, noChange });
      }
    }
  }, [loading, calendar]);

  // ── Quarterly refresh hook ──────────────────────────────────────────────────
  const captureSnapshotAndReload = useCallback(() => {
    snapshotRef.current = new Set(calendar.map(entryKey));
    onReload();
  }, [calendar, onReload]);

  const { lastRefresh, nextRefresh, trigger } = useQuarterlyRefresh(captureSnapshotAndReload);

  const handleManualRefresh = useCallback(() => {
    isManualRefreshRef.current = true;
    trigger(() => {
      snapshotRef.current = new Set(calendar.map(entryKey));
    });
  }, [trigger, calendar]);

  return (
    <>
      {diffResult && (
        <DiffPopup
          diff={diffResult}
          onClose={() => {
            setDiffResult(null);
            isManualRefreshRef.current = false;
          }}
        />
      )}

      <div className="clinical-view-shell flex flex-col flex-1 gap-4 p-4">
        {/* Refresh header */}
        <RefreshHeader
          lastRefresh={lastRefresh}
          nextRefresh={nextRefresh}
          loading={loading}
          onTrigger={handleManualRefresh}
        />

        {/* Section 1: 2-month Simulation study match */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--signal-up))]">
              ⚡ Next 2 months — Simulation studies
            </span>
            <span className="clinical-view-section-muted text-[10px]">
              (CD ≤ {CLINICAL_MAX_CD_DAYS} d · OpenFDA match)
            </span>
          </div>
          <ClinicalStudyCardsPanel
            title="Clinical — Simulation catalyst study"
            sourceHint={
              <>
                Simulation tickers with CD within{" "}
                <strong className="text-ink">{CLINICAL_MAX_CD_DAYS} days</strong>
                {" "}and OpenFDA match on{" "}
                <strong className="text-ink">Primary Completion Date</strong> (±7 d) and NCT
              </>
            }
            simTable={simTable}
            dataTable={cdTable}
            fullClinicalTable={clinicalTable}
            loading={loading}
            error={error}
            onReload={onReload}
            simCdByTicker={simCdByTicker}
            emptyTickerHint="No clinical study with matching CD/NCT"
          />
          {missingCd.length > 0 && !loading && (
            <p className="text-xs text-ink-muted px-1 mt-1">
              No clinical match: {missingCd.join(", ")} — check NCT/CD in the Simulation sheet
              or update the OpenFDA file.
            </p>
          )}
        </section>

        {/* Section 2: Full 6-month CD calendar */}
        <section>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[rgb(var(--accent))]">
              📅 Full CD calendar — Next 6 months
            </span>
            <span className="clinical-view-section-muted text-[10px]">
              (all Simulation tickers · CD ≤ {CLINICAL_6M_DAYS} d)
            </span>
            {calendar.length > 0 && (
              <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-[rgb(var(--accent))]">
                {calendar.length} upcoming
              </span>
            )}
          </div>
          <div className="clinical-view-panel px-3 py-2">
            {loading ? (
              <p className="text-xs text-ink-muted/60 py-4 text-center animate-pulse">
                Loading clinical data…
              </p>
            ) : (
              <ClinicalCdCalendar calendar={calendar} onOpenSummary={setSelectedStudy} />
            )}
          </div>
        </section>
      </div>

      {selectedStudy && (
        <StudySummaryModal
          nctId={selectedStudy.nct}
          ticker={selectedStudy.ticker}
          company={selectedStudy.company}
          briefTitle={selectedStudy.briefTitle}
          onClose={() => setSelectedStudy(null)}
        />
      )}
    </>
  );
}
