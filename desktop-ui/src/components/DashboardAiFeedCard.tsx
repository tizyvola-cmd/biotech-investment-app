import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchClinicalPreCdSnapshot,
  type ClinicalPreCdRecord,
  type ClinicalPublicationEvent,
} from "../api/supernova";
import { useLang } from "../shared/i18n";
import { eisColor, resolveEventEis } from "../sheet/eventImpactScore";
import { openExternalUrl } from "../sheet/k8ChartLinks";
import { isClinicalPreCdRecordTrusted, isEventReferenceVerified, trustedRecordEvents } from "../sheet/referenceVerification";
import {
  hydrateClinicalPreCdRecords,
  readClinicalPreCdSnapshotCache,
  readClinicalPreCdSnapshotSavedAt,
  writeClinicalPreCdSnapshotCache,
} from "../sheet/clinicalPreCdSnapshotCache";
import { isDashboardPanelStale } from "../sheet/dashboardPanelDailyRefresh";
import { timelineKind } from "../sheet/clinicalTimeline";
import { EisDetailDrawer } from "./EisDetailDrawer";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";

export type DashboardAiFeedItem = {
  id: string;
  ticker: string;
  company: string;
  eventDate: string;
  eventDateMs: number;
  title: string;
  drug: string;
  delta1d: number | null;
  eis: number | null;
  impactAbs: number;
  sourceType: string;
  link: string | null;
  linkLabel: string;
  verified: boolean;
};

function recordEvents(rec: ClinicalPreCdRecord): ClinicalPublicationEvent[] {
  return trustedRecordEvents(rec);
}

function isSecK8Event(ev: ClinicalPublicationEvent): boolean {
  return String(ev.source_type ?? "").toLowerCase() === "sec_8k";
}

function eventDateMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function eventDrug(ev: ClinicalPublicationEvent): string {
  const raw = ev.drug ?? ev.asset ?? "—";
  return String(raw ?? "—").trim() || "—";
}

function fmtFeedDate(iso: string | null | undefined, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(it ? "it-IT" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtPctSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

const AI_FEED_DAILY_CHECK_MS = 60 * 60 * 1000;

function dirIcon(v: number | null): string {
  if (v == null) return "";
  return v > 0.05 ? "▲ " : v < -0.05 ? "▼ " : "● ";
}

/** Skip synthetic future CD milestones with no price/KPI signal — they are not feed news. */
function includeInDashboardFeed(item: DashboardAiFeedItem, now: number): boolean {
  if (item.sourceType !== "cd_milestone") return true;
  if (item.eventDateMs <= now) return true;
  return item.impactAbs >= 0.5 || item.delta1d != null;
}

function feedRank(item: DashboardAiFeedItem, now: number, past30: number): number {
  const isPast = item.eventDateMs <= now;
  const isRecentPast = isPast && item.eventDateMs >= past30;
  let rank = 0;
  if (isRecentPast) rank += 10_000;
  else if (isPast) rank += 5_000;
  rank += item.impactAbs * 100;
  if (item.delta1d != null) rank += Math.abs(item.delta1d) * 10;
  rank += isPast ? item.eventDateMs / 1e10 : -item.eventDateMs / 1e10;
  return rank;
}

function flattenAiFeed(
  records: ClinicalPreCdRecord[],
  scopeTickers: Set<string>,
): DashboardAiFeedItem[] {
  const out: DashboardAiFeedItem[] = [];
  for (const rec of records) {
    const ticker = String(rec.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || !scopeTickers.has(ticker)) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;

    for (const ev of recordEvents(rec)) {
      if (isSecK8Event(ev)) continue;
      const ms = eventDateMs(ev.event_date);
      if (!ms) continue;
      const indicators = ev.indicators?.length ? ev.indicators : rec.clinical_indicators;
      const resolved = resolveEventEis(ev, indicators);
      const delta1dRaw = ev.price?.delta_p_1d ?? resolved?.delta_p_1d ?? null;
      const delta1d =
        delta1dRaw != null && Number.isFinite(delta1dRaw) ? delta1dRaw : null;
      const eis =
        resolved?.score != null && Number.isFinite(resolved.score)
          ? resolved.score
          : null;
      const impactAbs = Math.abs(eis ?? 0);
      out.push({
        id: `${ticker}_${ev.event_date}_${ev.event_title ?? ""}`,
        ticker,
        company: String(rec.company ?? ticker),
        eventDate: String(ev.event_date ?? ""),
        eventDateMs: ms,
        title: String(ev.event_title ?? "—"),
        drug: eventDrug(ev),
        delta1d,
        eis,
        impactAbs,
        sourceType: timelineKind(ev),
        link: ev.link ? String(ev.link) : null,
        linkLabel: String(ev.link_label ?? "Link"),
        verified: isEventReferenceVerified(ev, rec),
      });
    }
  }
  return out;
}

function rankAndSliceFeed(items: DashboardAiFeedItem[], limit: number): DashboardAiFeedItem[] {
  const now = Date.now();
  const past30 = now - 30 * 86400000;
  const eligible = items.filter((item) => includeInDashboardFeed(item, now));
  return [...eligible]
    .sort((a, b) => feedRank(b, now, past30) - feedRank(a, now, past30))
    .slice(0, limit);
}

function countRecentPastEvents(items: DashboardAiFeedItem[]): number {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  return items.filter(
    (r) => r.eventDateMs >= cutoff && r.eventDateMs <= now && includeInDashboardFeed(r, now),
  ).length;
}

export function useDashboardAiFeed(scopeTickers: Set<string>) {
  const [records, setRecords] = useState<ClinicalPreCdRecord[]>(() =>
    hydrateClinicalPreCdRecords(),
  );
  const [loading, setLoading] = useState(() => records.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(() =>
    readClinicalPreCdSnapshotSavedAt(),
  );

  const load = useCallback(async () => {
    const showSpinner = records.length === 0;
    if (showSpinner) setLoading(true);
    try {
      const snap = await fetchClinicalPreCdSnapshot();
      const rows = Array.isArray(snap.records) ? snap.records : [];
      setRecords(rows);
      writeClinicalPreCdSnapshotCache(snap);
      setUpdatedAt(snap.updated_at ?? new Date().toISOString());
      setLoadError(null);
    } catch (e) {
      const cached = readClinicalPreCdSnapshotCache();
      if (cached?.records?.length) setRecords(cached.records);
      setUpdatedAt(readClinicalPreCdSnapshotSavedAt());
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [records.length]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Almeno un fetch al giorno — ricontrolla ogni ora e al ritorno sul tab. */
  useEffect(() => {
    const maybeRefresh = () => {
      if (isDashboardPanelStale(readClinicalPreCdSnapshotSavedAt())) {
        void load();
      }
    };
    maybeRefresh();
    const intervalId = window.setInterval(maybeRefresh, AI_FEED_DAILY_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const allFeedItems = useMemo(
    () => flattenAiFeed(records, scopeTickers),
    [records, scopeTickers],
  );

  const feed = useMemo(() => rankAndSliceFeed(allFeedItems, 10), [allFeedItems]);

  const recentCount = useMemo(
    () => countRecentPastEvents(allFeedItems),
    [allFeedItems],
  );

  return { feed, recentCount, loading, loadError, updatedAt, reload: load };
}

/** Local-storage key for the collapsed/expanded state of the dashboard AI
 *  feed card. Persisted so the user keeps their layout choice across reloads
 *  (the panel is dense and many testers wanted a way to tuck it away). */
const TOP_AI_FEED_COLLAPSED_KEY = "supernova:dashboard:topAiFeed:collapsed";

function readCollapsedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOP_AI_FEED_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsedPref(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOP_AI_FEED_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* swallow — non-essential persistence */
  }
}

export function DashboardAiFeedCard({
  feed,
  recentCount,
  loading,
  loadError,
  updatedAt,
  scopeLabel,
  onOpenFeed,
  className,
  fill = false,
}: {
  feed: DashboardAiFeedItem[];
  recentCount: number;
  loading: boolean;
  loadError: string | null;
  updatedAt?: string | null;
  scopeLabel: string;
  onOpenFeed: () => void;
  className?: string;
  fill?: boolean;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [eisDrawer, setEisDrawer] = useState<{
    ticker: string;
    clinicalKpi: number | null;
  } | null>(null);

  // Persisted collapsed/expanded state — keeps the user's choice across
  // reloads so the dashboard layout doesn't reset every refresh.
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedPref());
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsedPref(next);
      return next;
    });
  }, []);

  const openEisDetail = useCallback((ticker: string) => {
    setEisDrawer({ ticker, clinicalKpi: null });
  }, []);

  return (
    <div
      className={`card dashboard-feed-card flex flex-col min-h-0 min-w-0 ${fill && !collapsed ? "h-full" : ""} ${className ?? ""}`}
    >
      <div className={`dashboard-feed-card-head flex items-center gap-2 px-4 py-3 shrink-0 ${collapsed ? "" : "border-b"}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="top-ai-feed-body"
          title={
            collapsed
              ? it
                ? "Espandi il pannello AI feed"
                : "Expand the AI feed panel"
              : it
                ? "Nascondi il pannello AI feed"
                : "Hide the AI feed panel"
          }
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path
              d="M2 4l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="font-semibold text-sm text-slate-900">
          {it ? "Top AI feed" : "Top AI feed"}
          <span className="ml-1 font-medium text-slate-600">· {scopeLabel}</span>
        </h2>
        <span className="text-xs font-medium text-slate-600">
          {recentCount} {it ? "ultimi 30g" : "last 30d"}
        </span>
        <button
          type="button"
          className="ml-auto text-[11px] text-accent/80 hover:text-accent transition"
          onClick={onOpenFeed}
        >
          → {it ? "Feed AI" : "AI feed"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <div className="px-4 pb-2 border-b border-[rgb(var(--border))]/40 shrink-0">
            <DashboardPanelUpdatedLabel updatedAt={updatedAt} />
          </div>
          <div
            id="top-ai-feed-body"
            className={`px-3 py-2 space-y-1.5 ${fill ? "flex-1 min-h-0 overflow-y-auto" : ""}`}
          >
        {loadError && (
          <p className="text-[11px] text-red-600 px-2 py-1">{loadError}</p>
        )}
        {loading ? (
          <div className="p-2 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 rounded dashboard-feed-row animate-pulse opacity-60"
              />
            ))}
          </div>
        ) : feed.length === 0 ? (
          <p className="text-ink-muted text-xs p-2">
            {it
              ? `Nessuna pubblicazione clinica AI per i ticker in ${scopeLabel} — apri Feed AI e clicca «Arricchisci».`
              : `No AI clinical publications for tickers in ${scopeLabel} — open AI feed and run «Enrich».`}
          </p>
        ) : (
          feed.map((row) => {
            const d1Color =
              row.delta1d == null
                ? "text-ink-muted"
                : row.delta1d >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]";
            const eisLabel =
              row.eis != null
                ? `${row.eis >= 0 ? "+" : ""}${row.eis.toFixed(1)}`
                : null;

            return (
              <div
                key={row.id}
                className="flex items-start gap-2 rounded-lg border px-3 py-2 dashboard-feed-row transition"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm tracking-wide text-slate-900">{row.ticker}</span>
                    <span className="text-xs font-medium text-slate-600">
                      {fmtFeedDate(row.eventDate, it)}
                    </span>
                    {row.sourceType === "cd_milestone" && (
                      <span className="text-[9px] font-semibold text-violet-800 bg-violet-100/90 px-1.5 py-0.5 rounded-full">
                        CD
                      </span>
                    )}
                    {row.verified && (
                      <span className="text-[9px] font-semibold text-violet-700 bg-violet-100/80 px-1.5 py-0.5 rounded-full">
                        ✓ ref
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5 shrink-0">
                      {row.delta1d != null && (
                        <span
                          className={`font-semibold text-xs tabular-nums ${d1Color}`}
                        >
                          T+1 {dirIcon(row.delta1d)}
                          {fmtPctSignedPct(row.delta1d)}
                        </span>
                      )}
                      {eisLabel != null && (
                        <button
                          type="button"
                          className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full hover:ring-2 hover:ring-[rgb(var(--accent))]/25 transition"
                          style={{
                            color: eisColor(row.eis!),
                            background: `${eisColor(row.eis!)}18`,
                          }}
                          title={
                            it
                              ? "Apri dettaglio EIS (breakdown evento e feed)"
                              : "Open EIS detail (event breakdown and feed)"
                          }
                          onClick={() => openEisDetail(row.ticker)}
                        >
                          EIS {eisLabel}
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] font-medium text-ink mt-0.5 leading-snug line-clamp-2">
                    {row.title}
                  </p>
                  <p className="text-[10px] text-ink-muted mt-0.5 truncate">
                    {row.drug !== "—" ? row.drug : row.company}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
                  {row.link && (
                    <button
                      type="button"
                      className="text-[10px] text-accent hover:underline whitespace-nowrap"
                      onClick={(e) => openExternalUrl(row.link!, e)}
                    >
                      {row.linkLabel} →
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[10px] text-accent/90 hover:text-accent hover:underline whitespace-nowrap font-medium"
                    onClick={() => openEisDetail(row.ticker)}
                    title={
                      it
                        ? "Breakdown EIS: ΔP, volume, KPI endpoint per evento"
                        : "EIS breakdown: ΔP, volume, endpoint KPIs per event"
                    }
                  >
                    {it ? "Dettaglio EIS →" : "EIS details →"}
                  </button>
                </div>
              </div>
            );
          })
        )}
          </div>
        </>
      )}

      <EisDetailDrawer
        open={eisDrawer != null}
        onClose={() => setEisDrawer(null)}
        ticker={eisDrawer?.ticker ?? null}
        clinicalKpi={eisDrawer?.clinicalKpi}
        it={it}
      />
    </div>
  );
}
