import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCatalystCalendarSnapshot,
  fetchCatalystCalendarStatus,
  fetchCalendarIdentityIndex,
  fetchFdaAdcomCalendarSnapshot,
  fetchGuidanceCalendarSnapshot,
  fetchGuidanceCalendarStatus,
  fetchSearchInterest,
  fetchSimulationSheet,
  postManualSimEntry,
  runCatalystCalendarRefresh,
  runFdaAdcomCalendarRefresh,
  runGuidanceCalendarRefresh,
  type CalendarIdentityIndex,
  type CatalystCalendarSnapshot,
  type CatalystCalendarStatus,
  type FdaAdcomBriefingCard,
  type FdaAdcomCalendarSnapshot,
  type GuidanceCalendarEvent,
  type GuidanceCalendarSnapshot,
  type GuidanceCalendarStatus,
  type SearchInterestRow,
} from "../api/supernova";
import { daysUntilIso } from "../sheet/nextCatalystEvent";
import { CalendarPromoteStarToggle } from "./CalendarPromoteStarToggle";
import { RegulatoryCatalystDetailModal } from "./RegulatoryCatalystDetailModal";
import { useCatalystInterestTickers } from "../hooks/useCatalystInterestTickers";
import {
  CALENDAR_FOCUS_EVENT,
  consumeCalendarFocusTicker,
  getCalendarFocusTicker,
} from "../sheet/calendarFocusStore";
import {
  fdaRowsFromSnapshot,
  mergeCalendarSources,
  simRowsToCdEvents,
} from "../sheet/calendarCatalystEvents";
import {
  CALENDAR_CATALYST_HORIZON_DAYS,
  CALENDAR_NEAR_COMPLETE_DAYS,
  calendarSortAnchorIso,
  designationsFromText,
  formatSourceList,
  identityForTicker,
  isCalendarNearCompletePin,
  isCalendarOpenWindowUnderway,
  isWithinCalendarForwardHorizon,
} from "../sheet/calendarPhase1";
import {
  msUntilNextRomeMidnight,
  recordCalendarForwardTickers,
  romeDateKey,
} from "../sheet/catalystDeskNewLedger";
import {
  FDA_ADCOM_MATERIALS_URL,
  type FdaAdcomBriefing,
  type FdaAdcomRow,
} from "../sheet/fdaAdcomCalendar";
import {
  manualCatalystInsertReady,
  parseManualCatalystInsert,
} from "../sheet/parseManualCatalystInsert";
import {
  clearCalendarTabWeeklyCache,
  markCalendarMondayPullDone,
  peekCalendarTabWeeklyCache,
  peekCalendarTrendsDailyCache,
  rememberCalendarTabWeeklyCache,
  rememberCalendarTrendsDailyCache,
  romeIsoWeekKey,
  shouldReattachCalendarMondayMorning,
} from "../sheet/calendarTabWeeklyCache";
import {
  assignTickerMapsPreserving,
  isMorningDeskCacheFreshForToday,
  peekCatalystDeskColumnCache,
} from "../sheet/catalystDeskColumnCache";
import {
  isSearchInterestScored,
  missingSearchInterestTickers,
  peekSearchInterestRows,
  rememberSearchInterestPayload,
  rememberSearchInterestRows,
  subscribeSearchInterestStore,
} from "../sheet/searchInterestStore";
import {
  missingTopKpiTrendsTickers,
  peekTopKpiTrendsDailyCache,
  rememberTopKpiTrendsDailyCache,
} from "../sheet/topKpiTrendsDailyCache";
import { invalidateGuidanceSnapshotCache } from "./TickerCatalystEventsTable";
import { FdaAdcomBriefingModal, FdaBriefingCell } from "./FdaAdcomBriefingModal";
import { GoogleTrendsLegendModal } from "./GoogleTrendsLegendModal";
import { SearchInterestDualMark } from "./SearchInterestTrendMark";
/* i18n handled inline via `it` prop */

const CELL = "px-1.5 py-1 align-middle text-center overflow-hidden";
const CELL_LEFT = "px-1.5 py-1 align-middle text-left overflow-hidden";
const HEAD = "px-1.5 py-1.5 text-center";
const HEAD_LEFT = "px-1.5 py-1.5 text-left";

const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  readout:     { bg: "bg-[#1E3A8A]", text: "text-[#DBEAFE]" },
  submission:  { bg: "bg-[#4C1D95]", text: "text-[#EDE9FE]" },
  approval:    { bg: "bg-[#065F46]", text: "text-[#D1FAE5]" },
  pdufa:       { bg: "bg-[#14532D]", text: "text-[#BBF7D0]" },
  partnership: { bg: "bg-[#78350F]", text: "text-[#FDE68A]" },
  preclinical: { bg: "bg-[#1E293B]", text: "text-[#E2E8F0]" },
  initiation:  { bg: "bg-[#155E75]", text: "text-[#CFFAFE]" },
  fda_vote:    { bg: "bg-[#065F46]", text: "text-[#A7F3D0]" },
  fda_safety:  { bg: "bg-[#1E293B]", text: "text-[#E2E8F0]" },
  cd:          { bg: "bg-[#312E81]", text: "text-[#E0E7FF]" },
  other:       { bg: "bg-[#1A2136]", text: "text-[#F3F5FA]" },
};

function EventTypeBadge({
  type,
  it,
  onClick,
}: {
  type: string | undefined;
  it: boolean;
  onClick?: () => void;
}) {
  const key = type || "other";
  const colors = EVENT_TYPE_COLORS[key] || EVENT_TYPE_COLORS.other;
  const labels: Record<string, { en: string; it: string }> = {
    readout: { en: "Readout", it: "Readout" },
    submission: { en: "Submission", it: "Submission" },
    approval: { en: "Approval", it: "Approvazione" },
    pdufa: { en: "PDUFA", it: "PDUFA" },
    partnership: { en: "Partnership", it: "Partnership" },
    preclinical: { en: "Preclinical", it: "Preclinico" },
    initiation: { en: "Initiation", it: "Inizio trial" },
    fda_vote: { en: "FDA vote", it: "Voto FDA" },
    fda_safety: { en: "FDA safety", it: "FDA safety" },
    cd: { en: "CD day", it: "CD day" },
    other: { en: "Other", it: "Altro" },
  };
  const label = labels[key]?.[it ? "it" : "en"] ?? key;
  const cls = `inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${colors.bg} ${colors.text}${
    onClick ? " cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40" : ""
  }`;
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={it ? "Dettaglio evento + referenza" : "Event detail + reference"}
      >
        {label}
      </button>
    );
  }
  return <span className={cls}>{label}</span>;
}

function fmtWindow(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  const fmt = (iso: string) => {
    try {
      const d = new Date(`${iso}T12:00:00`);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
    } catch {
      return iso;
    }
  };
  if (start && end && start !== end) return `${fmt(start)} → ${fmt(end)}`;
  return fmt(start || end || "");
}

function completesWithinOneMonth(ev: {
  window_start?: string | null;
  window_end?: string | null;
}): boolean {
  return isCalendarNearCompletePin(ev);
}

/** Sort tier: 0 = near pin, 1 = upcoming 6m timeline, 2 = long windows already open. */
function calendarSortTier(ev: {
  window_start?: string | null;
  window_end?: string | null;
}): number {
  if (isCalendarNearCompletePin(ev)) return 0;
  if (isCalendarOpenWindowUnderway(ev)) return 2;
  return 1;
}

/** Short label for the ID-source URL (study page, FDA, EDGAR, press, …). */
function calendarSourceLinkLabel(href: string, it: boolean): string {
  const u = href.trim();
  if (!u) return it ? "Apri fonte" : "Open source";
  if (/clinicaltrials\.gov/i.test(u)) return "CT.gov";
  if (/fda\.gov/i.test(u)) return "FDA.gov";
  if (/sec\.gov|edgar/i.test(u)) return "EDGAR";
  if (/businesswire|prnewswire|globenewswire|newsfilecorp|accesswire/i.test(u)) {
    return it ? "Press release" : "Press release";
  }
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return it ? "Apri fonte" : "Open source";
  }
}

function confidenceBar(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null;
  const pct = Math.min(100, Math.max(0, v * 100));
  const color =
    pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="inline-flex items-center justify-center gap-1">
      <div className="h-1 w-10 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] tabular-nums text-[#D7DEEE]">{pct.toFixed(0)}%</span>
    </div>
  );
}

type SortKey = "window" | "days" | "ticker" | "type" | "confidence";

type UnifiedEvent = GuidanceCalendarEvent & {
  origin: "guidance" | "fda" | "sec";
  fdaRow?: FdaAdcomRow | null;
};

function asFdaBriefing(
  raw: FdaAdcomBriefingCard | FdaAdcomBriefing | null | undefined,
): FdaAdcomBriefing | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    status: raw.status || "none",
    score: raw.score ?? null,
    stance: raw.stance ?? null,
    title: raw.title || "",
    summaryEn: raw.summaryEn || "",
    summaryIt: raw.summaryIt || "",
    resultsEn: ("resultsEn" in raw ? raw.resultsEn : undefined) ?? [],
    resultsIt: ("resultsIt" in raw ? raw.resultsIt : undefined) ?? [],
    statisticsEn: ("statisticsEn" in raw ? raw.statisticsEn : undefined) ?? [],
    statisticsIt: ("statisticsIt" in raw ? raw.statisticsIt : undefined) ?? [],
    conclusionsEn: ("conclusionsEn" in raw ? raw.conclusionsEn : undefined) ?? [],
    conclusionsIt: ("conclusionsIt" in raw ? raw.conclusionsIt : undefined) ?? [],
    bulletsEn: raw.bulletsEn ?? [],
    bulletsIt: raw.bulletsIt ?? [],
    materialsUrl: raw.materialsUrl || FDA_ADCOM_MATERIALS_URL,
    pdfUrl: raw.pdfUrl || "",
    matchOk: "matchOk" in raw ? raw.matchOk : undefined,
    matchHint: "matchHint" in raw ? raw.matchHint : undefined,
    source: raw.source,
    updated_at: raw.updated_at,
  };
}

function snapshotFdaRows(snap: FdaAdcomCalendarSnapshot | null): FdaAdcomRow[] {
  const rows = fdaRowsFromSnapshot(snap);
  const byId = new Map((snap?.rows ?? []).map((r) => [r.id, r]));
  return rows.map((row) => ({
    ...row,
    briefing: asFdaBriefing(byId.get(row.id)?.briefing) ?? row.briefing,
  }));
}

/**
 * Calendar tab: future-only + within ~6 months (internal store keeps the rest).
 */
function isUpcomingEvent(ev: Pick<UnifiedEvent, "window_start" | "window_end">): boolean {
  return isWithinCalendarForwardHorizon(ev);
}

/* ── Week cache (Rome Monday→Sunday) — survives tab switches + reloads ───── */

let _cachedSnap: GuidanceCalendarSnapshot | null = null;
let _cachedStatus: GuidanceCalendarStatus | null = null;
let _cachedFda: FdaAdcomCalendarSnapshot | null = null;
let _cachedSec: CatalystCalendarSnapshot | null = null;
let _cachedSecStatus: CatalystCalendarStatus | null = null;
let _cachedIdentity: CalendarIdentityIndex | null = null;
let _cachedSimCd: GuidanceCalendarEvent[] = [];
let _cachedWeekKey: string | null = null;
const _IDENTITY_CACHE_TTL = 7 * 24 * 60 * 60_000; // week — identity is static-ish
let _identityCacheAge = 0;

function hydrateFromWeeklyCache(): boolean {
  const week = romeIsoWeekKey();
  if (_cachedSnap && _cachedWeekKey === week) return true;
  const stored = peekCalendarTabWeeklyCache(week);
  if (!stored?.snap) return false;
  _cachedSnap = stored.snap;
  _cachedStatus = stored.status;
  _cachedFda = stored.fda;
  _cachedSec = stored.sec;
  _cachedSecStatus = stored.secStatus;
  _cachedIdentity = stored.identity;
  _cachedSimCd = stored.simCd ?? [];
  _cachedWeekKey = stored.weekKey;
  _identityCacheAge = stored.savedAt || Date.now();
  return true;
}

function persistWeeklyCache(): void {
  const week = romeIsoWeekKey();
  _cachedWeekKey = week;
  const prev = peekCalendarTabWeeklyCache(week);
  rememberCalendarTabWeeklyCache({
    weekKey: week,
    snap: _cachedSnap,
    status: _cachedStatus,
    fda: _cachedFda,
    sec: _cachedSec,
    secStatus: _cachedSecStatus,
    identity: _cachedIdentity,
    simCd: _cachedSimCd,
    trendsRomeDay: prev?.trendsRomeDay,
    trends: prev?.trends,
  });
}

function invalidateWeeklyCalendarCache(): void {
  _cachedWeekKey = null;
  clearCalendarTabWeeklyCache();
}

export function GuidanceCalendarPanel({ it = false }: { it?: boolean }) {
  // Hydrate red-★ interest list so Calendar promote stars show correct state.
  useCatalystInterestTickers();
  const [snap, setSnap] = useState<GuidanceCalendarSnapshot | null>(_cachedSnap);
  const [status, setStatus] = useState<GuidanceCalendarStatus | null>(_cachedStatus);
  const [fdaSnap, setFdaSnap] = useState<FdaAdcomCalendarSnapshot | null>(_cachedFda);
  const [secSnap, setSecSnap] = useState<CatalystCalendarSnapshot | null>(_cachedSec);
  const [secStatus, setSecStatus] = useState<CatalystCalendarStatus | null>(_cachedSecStatus);
  const [identity, setIdentity] = useState<CalendarIdentityIndex | null>(_cachedIdentity);
  const [simCdEvents, setSimCdEvents] = useState<GuidanceCalendarEvent[]>(_cachedSimCd);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("window");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterTicker, setFilterTicker] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [typeDetail, setTypeDetail] = useState<UnifiedEvent | null>(null);
  const [trendByTicker, setTrendByTicker] = useState<Record<string, SearchInterestRow>>(() => {
    const day = romeDateKey();
    const desk = peekCatalystDeskColumnCache();
    const fromDeskMorning =
      desk?.morning && isMorningDeskCacheFreshForToday(desk.morning)
        ? (desk.morning.trends ?? {})
        : {};
    const fromDeskHourly = desk?.hourly?.trends ?? {};
    const fromTop = peekTopKpiTrendsDailyCache(day) ?? {};
    const fromCal = peekCalendarTrendsDailyCache(day) ?? {};
    const fromStore = peekSearchInterestRows();
    return { ...fromDeskMorning, ...fromDeskHourly, ...fromTop, ...fromCal, ...fromStore };
  });
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [openBriefing, setOpenBriefing] = useState<FdaAdcomRow | null>(null);
  const [newTodayTickers, setNewTodayTickers] = useState<Set<string>>(() => new Set());
  const [romeDay, setRomeDay] = useState(0);

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertText, setInsertText] = useState("");
  const [insertBusy, setInsertBusy] = useState(false);
  const [insertMsg, setInsertMsg] = useState<string | null>(null);
  const [insertErr, setInsertErr] = useState<string | null>(null);

  const insertParsed = useMemo(
    () => parseManualCatalystInsert(insertText),
    [insertText],
  );
  const insertReady = manualCatalystInsertReady(insertParsed);

  const handleInsertCatalyst = async () => {
    if (!insertParsed || !insertReady) {
      setInsertErr(
        it
          ? "Servono almeno TICKER e CD day (es. 2026-09-30 o 30/09/2026)."
          : "Need at least TICKER and CD day (e.g. 2026-09-30 or 30/09/2026).",
      );
      return;
    }
    setInsertBusy(true);
    setInsertErr(null);
    setInsertMsg(null);
    try {
      const res = await postManualSimEntry({
        ticker: insertParsed.ticker,
        company: insertParsed.company,
        nct_id: insertParsed.nctId || undefined,
        cd_iso: insertParsed.cdIso,
        drug: insertParsed.drug || undefined,
        phase: insertParsed.phase || undefined,
        indication: insertParsed.indication || undefined,
        note: insertParsed.raw.slice(0, 400),
      });
      if (!res.ok) {
        setInsertErr(res.error || (it ? "Inserimento fallito" : "Insert failed"));
        return;
      }
      setInsertMsg(
        it
          ? `${insertParsed.ticker} → Calendar + Catalyst / Eval Lab${
              res.replaced ? " (aggiornato)" : ""
            }`
          : `${insertParsed.ticker} → Calendar + Catalyst / Eval Lab${
              res.replaced ? " (updated)" : ""
            }`,
      );
      setInsertText("");
      invalidateWeeklyCalendarCache();
      await load({ force: true });
    } catch (e) {
      setInsertErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInsertBusy(false);
    }
  };

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const force = Boolean(opts?.force);
    try {
      const week = romeIsoWeekKey();
      if (!force && _cachedSnap && _cachedWeekKey === week) {
        setSnap(_cachedSnap);
        setStatus(_cachedStatus);
        setFdaSnap(_cachedFda);
        setSecSnap(_cachedSec);
        setSecStatus(_cachedSecStatus);
        setIdentity(_cachedIdentity);
        setSimCdEvents(_cachedSimCd);
        return;
      }
      const needIdentity =
        force ||
        !_cachedIdentity ||
        Date.now() - _identityCacheAge >= _IDENTITY_CACHE_TTL;
      const [s, st, fda, sec, secSt, id, sim] = await Promise.all([
        fetchGuidanceCalendarSnapshot(),
        fetchGuidanceCalendarStatus(),
        fetchFdaAdcomCalendarSnapshot().catch(() => null),
        fetchCatalystCalendarSnapshot().catch(() => null),
        fetchCatalystCalendarStatus().catch(() => null),
        needIdentity
          ? fetchCalendarIdentityIndex().catch(() => null)
          : Promise.resolve(_cachedIdentity),
        fetchSimulationSheet().catch(() => null),
      ]);
      _cachedSnap = s;
      _cachedStatus = st;
      if (fda) _cachedFda = fda;
      if (sec) _cachedSec = sec;
      if (secSt) _cachedSecStatus = secSt;
      if (id) {
        _cachedIdentity = id;
        _identityCacheAge = Date.now();
      }
      const cdFromSim = simRowsToCdEvents(
        (sim?.rows as Array<Record<string, unknown>> | undefined) ?? [],
      );
      _cachedSimCd = cdFromSim;
      persistWeeklyCache();
      setSnap(s);
      setStatus(st);
      if (fda) setFdaSnap(fda);
      if (sec) setSecSnap(sec);
      if (secSt) setSecStatus(secSt);
      if (id) setIdentity(id);
      setSimCdEvents(cdFromSim);
      invalidateGuidanceSnapshotCache();
    } catch {
      /* keep prior */
    }
  }, []);

  useEffect(() => {
    if (hydrateFromWeeklyCache()) {
      setSnap(_cachedSnap);
      setStatus(_cachedStatus);
      setFdaSnap(_cachedFda);
      setSecSnap(_cachedSec);
      setSecStatus(_cachedSecStatus);
      setIdentity(_cachedIdentity);
      setSimCdEvents(_cachedSimCd);
      // Same paint as weekly events: seed G-Trends from desk + Top KPI + Calendar caches.
      const day = romeDateKey();
      const desk = peekCatalystDeskColumnCache();
      const fromDeskMorning =
        desk?.morning && isMorningDeskCacheFreshForToday(desk.morning)
          ? (desk.morning.trends ?? {})
          : {};
      const fromDeskHourly = desk?.hourly?.trends ?? {};
      const fromTop = peekTopKpiTrendsDailyCache(day) ?? {};
      const fromCal = peekCalendarTrendsDailyCache(day) ?? {};
      const seeded = { ...fromDeskMorning, ...fromDeskHourly, ...fromTop, ...fromCal };
      if (Object.keys(seeded).length) {
        rememberSearchInterestRows(seeded);
        rememberTopKpiTrendsDailyCache(seeded, day);
        rememberCalendarTrendsDailyCache(seeded, day);
        setTrendByTicker((prev) => ({ ...seeded, ...prev }));
        setTrendsLoading(false);
      }
      return;
    }
    void load({ force: true });
  }, [load]);

  useEffect(() => {
    const apply = (tk: string) => {
      const up = tk.trim().toUpperCase();
      if (!up) return;
      setFilterTicker(up);
      invalidateWeeklyCalendarCache();
      void load({ force: true });
    };
    const pending = getCalendarFocusTicker();
    if (pending) {
      consumeCalendarFocusTicker();
      apply(pending);
    }
    const onFocus = (ev: Event) => {
      const tk =
        (ev as CustomEvent<{ ticker?: string }>).detail?.ticker ||
        getCalendarFocusTicker() ||
        "";
      consumeCalendarFocusTicker();
      apply(tk);
    };
    window.addEventListener(CALENDAR_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(CALENDAR_FOCUS_EVENT, onFocus);
  }, [load]);

  useEffect(() => {
    const wait = msUntilNextRomeMidnight();
    const id = window.setTimeout(() => setRomeDay((n) => n + 1), wait);
    return () => window.clearTimeout(id);
  }, [romeDay]);

  /** Poll until Guidance + SEC jobs finish — do not rely on a single status read (race). */
  const pollUntilIdle = useCallback(async () => {
    const started = Date.now();
    const maxMs = 12 * 60_000;
    while (Date.now() - started < maxMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const [st, secSt] = await Promise.all([
          fetchGuidanceCalendarStatus(),
          fetchCatalystCalendarStatus().catch(() => null),
        ]);
        _cachedStatus = st;
        setStatus(st);
        if (secSt) {
          _cachedSecStatus = secSt;
          setSecStatus(secSt);
        }
        const busy = !!(st.running || secSt?.running);
        if (!busy) {
          await load({ force: true });
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    await load({ force: true });
  }, [load]);

  /**
   * Weekly Calendar pull (Monday ~10:30 Rome, catch-up Tue–Sun if missed):
   * drop weekly cache, reload snapshot, and kick server refresh so names
   * newly inside the 6-month horizon enter the tab.
   */
  useEffect(() => {
    let cancelled = false;
    const tryWeeklyReattach = () => {
      const week = romeIsoWeekKey();
      // ISO week rolled while the app stayed open (Sun→Mon).
      if (_cachedWeekKey && _cachedWeekKey !== week) {
        invalidateWeeklyCalendarCache();
        void load({ force: true });
      }
      if (!shouldReattachCalendarMondayMorning()) return;
      markCalendarMondayPullDone();
      invalidateWeeklyCalendarCache();
      void load({ force: true });
      // Kick server weekly job (server also self-schedules + catch-up).
      void runGuidanceCalendarRefresh()
        .then(() => {
          if (!cancelled) void pollUntilIdle();
        })
        .catch(() => {
          /* snapshot fetch still refreshes visible list */
        });
    };
    tryWeeklyReattach();
    const id = window.setInterval(tryWeeklyReattach, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") tryWeeklyReattach();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, romeDay, pollUntilIdle]);

  useEffect(() => {
    if (!status?.running && !secStatus?.running) return;
    const iv = setInterval(async () => {
      try {
        const [st, secSt] = await Promise.all([
          fetchGuidanceCalendarStatus(),
          fetchCatalystCalendarStatus().catch(() => null),
        ]);
        _cachedStatus = st;
        setStatus(st);
        if (secSt) {
          _cachedSecStatus = secSt;
          setSecStatus(secSt);
        }
        if (!st.running && !(secSt?.running)) {
          clearInterval(iv);
          void load({ force: true });
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [status?.running, secStatus?.running, load]);

  const handleRefresh = async (force = false) => {
    setLoading(true);
    setRefreshError(null);
    invalidateWeeklyCalendarCache();
    try {
      // Mark busy immediately so the UI does not flash idle before the server thread starts.
      setSecStatus((prev) => ({
        ...(prev || {}),
        running: true,
        message: it
          ? "Simulation + Discovery → scan date catalyst…"
          : "Simulation + Discovery → catalyst-date scan…",
      }));
      const results = await Promise.allSettled([
        runGuidanceCalendarRefresh(force),
        runFdaAdcomCalendarRefresh(true),
        runCatalystCalendarRefresh(),
      ]);
      const errs: string[] = [];
      for (const r of results) {
        if (r.status === "rejected") {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errs.push(msg);
        }
      }
      if (errs.length) {
        setRefreshError(
          errs.some((e) => /401|token|unauthor/i.test(e))
            ? it
              ? "Token API mancante o non valido (X-SuperNova-Token). Impostalo in System / Settings."
              : "Missing or invalid API token (X-SuperNova-Token). Set it in System / Settings."
            : errs[0] || "Refresh failed",
        );
      }
      await pollUntilIdle();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const fdaRows = useMemo(() => snapshotFdaRows(fdaSnap), [fdaSnap]);

  const events = useMemo<UnifiedEvent[]>(() => {
    const merged = mergeCalendarSources(
      snap?.events,
      fdaRows,
      secSnap?.entries ?? [],
      it,
      simCdEvents,
    );
    const fdaByKey = new Map<string, FdaAdcomRow>();
    for (const row of fdaRows) {
      fdaByKey.set(`${row.ticker}|${row.date}`, row);
    }
    return merged
      .map((ev): UnifiedEvent => {
        const id = identityForTicker(identity, ev.ticker || "");
        const fromOrigin =
          ev.source_type === "fda_adcom"
            ? ["FDA"]
            : ev.source_type === "sec_forward"
              ? []
              : ev.source_type === "manual_calendar_insert"
                ? (ev as GuidanceCalendarEvent & { nct_id?: string }).nct_id ||
                  (ev.link || "").includes("clinicaltrials.gov")
                  ? ["ClinicalTrials.gov"]
                  : []
                : ev.source_type === "clinicaltrials.gov" || ev.event_type === "cd"
                  ? ["ClinicalTrials.gov"]
                  : [];
        const sources = [
          ...new Set([...(id?.identification_sources ?? []), ...fromOrigin]),
        ];
        // SEC-only without Discovery/CT/FDA still gets empty sources — OK
        if (ev.source_type === "sec_forward" && !sources.length && id?.identification_sources?.length) {
          sources.push(...id.identification_sources);
        }
        const desig = [
          ...new Set([
            ...(id?.regulatory_designations ?? []),
            ...designationsFromText(ev.timing_quote, ev.asset_name, ev.indication),
          ]),
        ];
        const enriched: UnifiedEvent = {
          ...ev,
          identification_sources: sources,
          identification_sources_label: formatSourceList(sources),
          regulatory_designations: desig,
          regulatory_designations_label: formatSourceList(desig),
          main_inflection:
            ev.main_inflection === true ||
            ev.event_type === "pdufa" ||
            ev.event_type === "fda_vote",
          inflection_importance:
            ev.inflection_importance ??
            (ev.event_type === "pdufa" ? 80 : ev.event_type === "fda_vote" ? 50 : null),
          inflection_label:
            ev.inflection_label ??
            (ev.event_type === "pdufa"
              ? "PDUFA date"
              : ev.event_type === "fda_vote"
                ? "Advisory Committee"
                : null),
          origin:
            ev.source_type === "fda_adcom"
              ? "fda"
              : ev.source_type === "sec_forward"
                ? "sec"
                : "guidance",
          fdaRow:
            ev.source_type === "fda_adcom"
              ? fdaByKey.get(`${ev.ticker}|${ev.window_start || ""}`) ?? null
              : null,
        };
        return enriched;
      })
      .filter(isUpcomingEvent);
  }, [snap?.events, fdaRows, secSnap?.entries, it, identity, simCdEvents]);

  const observedCalendarTickers = useMemo(() => {
    return [
      ...new Set(
        events
          .map((ev) => String(ev.ticker || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
  }, [events]);

  useEffect(() => {
    if (!observedCalendarTickers.length) {
      setNewTodayTickers(new Set());
      return;
    }
    // New names that just entered the ≤6mo Calendar list (🔖).
    setNewTodayTickers(new Set(recordCalendarForwardTickers(observedCalendarTickers)));
  }, [observedCalendarTickers, romeDay]);

  const tickers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ev of events) {
      const tk = (ev.ticker || "").trim().toUpperCase();
      if (!tk || seen.has(tk)) continue;
      seen.add(tk);
      out.push(tk);
    }
    return out;
  }, [events]);

  // Align with Top KPI: Rome-day G-Trends cache + shared store (morning refresh).
  const trendsTickerKey = tickers.join(",");

  useEffect(() => {
    if (!trendsTickerKey) return;
    const list = trendsTickerKey.split(",");
    const sync = () => {
      const daily = peekTopKpiTrendsDailyCache() ?? {};
      const cal = peekCalendarTrendsDailyCache() ?? {};
      if (Object.keys(daily).length) rememberSearchInterestRows(daily);
      if (Object.keys(cal).length) rememberSearchInterestRows(cal);
      const merged = { ...daily, ...cal, ...peekSearchInterestRows(list) };
      setTrendByTicker((prev) => assignTickerMapsPreserving(prev, merged));
    };
    sync();
    return subscribeSearchInterestStore(sync);
  }, [trendsTickerKey]);

  useEffect(() => {
    if (!trendsTickerKey) {
      setTrendsLoading(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const day = romeDateKey();
    const list = trendsTickerKey.split(",");

    const persistBoth = (rows: Record<string, SearchInterestRow>) => {
      if (!Object.keys(rows).length) return;
      rememberTopKpiTrendsDailyCache(rows, day);
      rememberCalendarTrendsDailyCache(rows, day);
    };

    // Mirror Catalyst Days: paint immediately from desk morning/hourly + Rome-day caches.
    const desk = peekCatalystDeskColumnCache();
    const fromDeskMorning =
      desk?.morning && isMorningDeskCacheFreshForToday(desk.morning)
        ? (desk.morning.trends ?? {})
        : {};
    const fromDeskHourly = desk?.hourly?.trends ?? {};
    const daily = peekTopKpiTrendsDailyCache(day);
    const cal = peekCalendarTrendsDailyCache(day);
    const seeded = {
      ...fromDeskMorning,
      ...fromDeskHourly,
      ...(daily ?? {}),
      ...(cal ?? {}),
      ...peekSearchInterestRows(list),
    };
    if (Object.keys(seeded).length) {
      rememberSearchInterestRows(seeded);
      persistBoth(seeded);
      setTrendByTicker((prev) => assignTickerMapsPreserving(prev, seeded));
    }

    const needNet = [
      ...new Set([
        ...missingTopKpiTrendsTickers(list, day),
        ...missingSearchInterestTickers(list),
      ]),
    ].filter((tk) => !isSearchInterestScored(peekSearchInterestRows([tk])[tk]));

    if (!needNet.length) {
      setTrendsLoading(false);
      return;
    }

    const pull = async () => {
      const missing = [
        ...new Set([
          ...missingTopKpiTrendsTickers(list, day),
          ...missingSearchInterestTickers(list),
        ]),
      ].filter((tk) => !isSearchInterestScored(peekSearchInterestRows([tk])[tk]));
      if (!missing.length) {
        const have = {
          ...(peekTopKpiTrendsDailyCache(day) ?? {}),
          ...peekSearchInterestRows(list),
        };
        persistBoth(have);
        if (!cancelled) {
          setTrendByTicker((prev) => assignTickerMapsPreserving(prev, have));
          setTrendsLoading(false);
        }
        return;
      }
      // Same as Top KPI: persist every payload row (not score-only) so warming can settle.
      let anyWarming = false;
      for (let i = 0; i < missing.length; i += 8) {
        if (cancelled) return;
        const chunk = missing.slice(i, i + 8);
        try {
          const payload = await fetchSearchInterest(chunk);
          if (cancelled) return;
          if (payload.warming) anyWarming = true;
          if (payload.rows) {
            rememberSearchInterestPayload(payload);
            persistBoth(payload.rows);
            setTrendByTicker((prev) =>
              assignTickerMapsPreserving(prev, payload.rows ?? {}),
            );
          }
        } catch {
          anyWarming = true;
        }
      }
      if (cancelled) return;
      const stillMissing = [
        ...new Set([
          ...missingTopKpiTrendsTickers(list, day),
          ...missingSearchInterestTickers(list),
        ]),
      ].filter((tk) => !isSearchInterestScored(peekSearchInterestRows([tk])[tk]));
      attempts += 1;
      if ((anyWarming || stillMissing.length > 0) && attempts < 4) {
        timer = setTimeout(() => {
          if (!cancelled) void pull();
        }, attempts <= 2 ? 2500 : 5000);
        return;
      }
      setTrendsLoading(false);
    };

    setTrendsLoading(true);
    void pull().catch(() => {
      if (!cancelled) setTrendsLoading(false);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [trendsTickerKey]);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const ev of events) {
      if (ev.event_type) types.add(ev.event_type);
    }
    return Array.from(types).sort();
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (filterTicker.trim()) {
      const ft = filterTicker.trim().toUpperCase();
      list = list.filter(
        (ev) =>
          ev.ticker?.toUpperCase().includes(ft) ||
          ev.company?.toUpperCase().includes(ft),
      );
    }
    if (filterType) {
      list = list.filter((ev) => ev.event_type === filterType);
    }
    const sorted = [...list].sort((a, b) => {
      // 0 near · 1 upcoming timeline · 2 long Q/H already underway (bottom)
      const aTier = calendarSortTier(a);
      const bTier = calendarSortTier(b);
      if (aTier !== bTier) return aTier - bTier;
      let cmp = 0;
      switch (sortKey) {
        case "window":
          cmp = calendarSortAnchorIso(a).localeCompare(calendarSortAnchorIso(b));
          break;
        case "days": {
          const dayOf = (ev: UnifiedEvent) => {
            const ds = daysUntilIso(ev.window_start || "");
            if (ds != null && ds >= 0) return ds;
            const de = daysUntilIso(ev.window_end || ev.window_start || "");
            return de ?? 9999;
          };
          cmp = dayOf(a) - dayOf(b);
          break;
        }
        case "ticker":
          cmp = (a.ticker || "").localeCompare(b.ticker || "");
          break;
        case "type":
          cmp = (a.event_type || "").localeCompare(b.event_type || "");
          break;
        case "confidence":
          cmp = (b.confidence ?? 0) - (a.confidence ?? 0);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [events, filterTicker, filterType, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  const isRunning = !!(status?.running || secStatus?.running);
  const isEmpty = !events.length && !isRunning;
  const fdaCount = events.filter((e) => e.origin === "fda").length;
  const secCount = events.filter((e) => e.origin === "sec").length;
  const runningMsg =
    status?.running
      ? status.message || (it ? "Guidance…" : "Guidance…")
      : secStatus?.running
        ? secStatus.message || (it ? "Scan SEC…" : "SEC scan…")
        : null;
  const runningProg = status?.running
    ? status
    : secStatus?.running
      ? secStatus
      : null;

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 shrink-0 border-b border-white/16 bg-[#121729]">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[#F3F5FA]">
            📅 {it ? "Calendario" : "Calendar"}
          </h3>
          <p className="text-[10px] text-[#D7DEEE] leading-snug mt-0.5">
            {it
              ? `Orizzonte 6 mesi · solo eventi futuri (oltre → calendario interno nascosto). Ogni lunedì ~10:30 (catch-up automatico se saltato) riattacca e porta in lista le società entrate nei 6 mesi. ≤${CALENDAR_CATALYST_HORIZON_DAYS}g + ★ rosse → Catalyst. 🔖 = nuovo oggi. `
              : `6-month horizon · future only (farther → hidden internal store). Every Monday ~10:30 (auto catch-up if missed) reattaches and pulls companies newly inside 6 months. ≤${CALENDAR_CATALYST_HORIZON_DAYS}d + red ★ → Catalyst. 🔖 = new today. `}
            <span className="font-bold text-[#F3C451]">
              {it
                ? "Ocra grassetto = main inflection (PDUFA / AdCom / Ph3–pivotal)."
                : "Ochre bold = main inflection (PDUFA / AdCom / Ph3–pivotal)."}
            </span>{" "}
            <span className="text-rose-500 font-semibold">
              {it
                ? "☆/★ rossa = promuovi in Catalyst."
                : "Red ☆/★ = promote to Catalyst."}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-[min(100%,22rem)]">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {snap?.updated_at || fdaSnap?.updated_at || secSnap?.updated_at ? (
              <span className="text-[9px] text-[#C5CDDC] tabular-nums">
                {it ? "Aggiornato:" : "Updated:"}{" "}
                {new Date(
                  snap?.updated_at || fdaSnap?.updated_at || secSnap?.updated_at || "",
                ).toLocaleDateString(it ? "it-IT" : "en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {status?.last_weekly_week ? (
                  <span className="ml-1 opacity-80">
                    · {it ? "sett." : "wk"} {status.last_weekly_week}
                  </span>
                ) : null}
              </span>
            ) : null}
            {refreshError ? (
              <span className="text-[10px] text-red-600 dark:text-red-400 max-w-[16rem] leading-snug">
                {refreshError}
              </span>
            ) : null}
            <button
              type="button"
              className="text-[10px] font-semibold px-2 py-1 rounded border border-[rgb(var(--border))]/60 text-ink hover:bg-[rgb(var(--accent))]/10 transition"
              onClick={() => {
                setInsertOpen((v) => !v);
                setInsertErr(null);
                setInsertMsg(null);
              }}
            >
              {insertOpen
                ? it
                  ? "Chiudi insert"
                  : "Close insert"
                : it
                  ? "+ Catalyst"
                  : "+ Catalyst"}
            </button>
            {isRunning ? (
              <span className="text-[10px] text-[rgb(var(--accent))] animate-pulse font-medium">
                {runningMsg}
                {runningProg?.total
                  ? ` (${runningProg.processed ?? 0}/${runningProg.total})`
                  : ""}
              </span>
            ) : (
              <button
                type="button"
                className="text-[10px] font-semibold px-2 py-1 rounded border border-[rgb(var(--accent))]/40 text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10 transition"
                onClick={() => handleRefresh(false)}
                disabled={loading}
              >
                {loading
                  ? it
                    ? "Avvio…"
                    : "Starting…"
                  : it
                    ? "🔄 Sim + Discovery → Calendar"
                    : "🔄 Sim + Discovery → Calendar"}
              </button>
            )}
          </div>
          {insertOpen ? (
            <div className="w-full rounded-md border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/40 p-2 shadow-sm">
              <p className="text-[9px] text-ink-muted leading-snug mb-1">
                {it
                  ? "Testo libero → ticker, società, NCT, CD day → Catalyst / Eval Lab."
                  : "Free text → ticker, company, NCT, CD day → Catalyst / Eval Lab."}
              </p>
              <textarea
                className="w-full text-[10px] leading-snug px-1.5 py-1 rounded border border-[rgb(var(--border))]/50 bg-white dark:bg-black/20 min-h-[4.5rem] resize-y placeholder:text-ink-muted/50"
                placeholder={
                  it
                    ? "TICKER: NRIX\nCOMPANY: Nurix Therapeutics\nNCT: NCT05107674\nCD: 2026-09-30\n\noppure: NRIX | Nurix | NCT05107674 | 30/09/2026"
                    : "TICKER: NRIX\nCOMPANY: Nurix Therapeutics\nNCT: NCT05107674\nCD: 2026-09-30\n\nor: NRIX | Nurix | NCT05107674 | 30/09/2026"
                }
                value={insertText}
                onChange={(e) => {
                  setInsertText(e.target.value);
                  setInsertErr(null);
                  setInsertMsg(null);
                }}
              />
              {insertParsed ? (
                <div className="mt-1 text-[9px] text-ink tabular-nums leading-snug">
                  <span className="font-bold">{insertParsed.ticker}</span>
                  {" · "}
                  <span className="truncate">{insertParsed.company}</span>
                  {insertParsed.nctId ? ` · ${insertParsed.nctId}` : ""}
                  {` · CD ${insertParsed.cdIso}`}
                </div>
              ) : insertText.trim() ? (
                <div className="mt-1 text-[9px] text-amber-700 dark:text-amber-300">
                  {it
                    ? "Anteprima incompleta — aggiungi ticker e data CD."
                    : "Incomplete preview — add ticker and CD date."}
                </div>
              ) : null}
              <div className="mt-1.5 flex items-center gap-2 justify-end">
                {insertErr ? (
                  <span className="text-[9px] text-red-600 dark:text-red-400 mr-auto max-w-[12rem] leading-snug">
                    {insertErr}
                  </span>
                ) : null}
                {insertMsg ? (
                  <span className="text-[9px] text-emerald-700 dark:text-emerald-300 mr-auto max-w-[12rem] leading-snug">
                    {insertMsg}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="text-[10px] font-semibold px-2 py-1 rounded border border-[rgb(var(--accent))]/50 text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10 disabled:opacity-40"
                  disabled={insertBusy || !insertReady}
                  onClick={() => void handleInsertCatalyst()}
                >
                  {insertBusy
                    ? it
                      ? "Salvo…"
                      : "Saving…"
                    : it
                      ? "Inserisci → Eval Lab"
                      : "Insert → Eval Lab"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {events.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 shrink-0 border-b border-white/16 bg-[#1A2136]">
          <span className="text-[10px] font-semibold text-[#F3F5FA]">
            {events.length} {it ? "eventi" : "events"} · {fdaCount} FDA · {secCount} SEC
            {secSnap?.meta?.companies_scanned != null
              ? it
                ? ` (scan ${secSnap.meta.companies_scanned} co. → ${secSnap.count ?? 0} date)`
                : ` (scan ${secSnap.meta.companies_scanned} co. → ${secSnap.count ?? 0} dates)`
              : ""}
            {newTodayTickers.size ? ` · 🔖 ${newTodayTickers.size}` : ""} ·{" "}
            {snap?.tickers_scanned ?? tickers.length} ticker
          </span>
          <input
            type="text"
            className="text-[10px] px-2 py-0.5 rounded border border-white/20 bg-[#0B0D17] text-[#F3F5FA] w-28 placeholder:text-[#97A2BA]"
            placeholder={it ? "Filtra ticker…" : "Filter ticker…"}
            value={filterTicker}
            onChange={(e) => setFilterTicker(e.target.value)}
          />
          <select
            className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 bg-[#0B0D17] text-[#F3F5FA]"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">{it ? "Tutti i tipi" : "All types"}</option>
            {eventTypes.map((et) => (
              <option key={et} value={et}>
                {et === "fda_vote"
                  ? it
                    ? "Voto FDA"
                    : "FDA vote"
                  : et === "fda_safety"
                    ? it
                      ? "FDA safety"
                      : "FDA safety"
                    : et}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-[#D7DEEE] ml-auto">
            {filtered.length !== events.length
              ? `${filtered.length} / ${events.length}`
              : ""}
          </span>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <p className="text-3xl">📅</p>
          <p className="text-sm text-ink-muted font-medium">
            {it
              ? "Nessun evento in calendario ancora."
              : "No calendar events yet."}
          </p>
          <p className="text-[11px] text-ink-muted max-w-md leading-snug">
            {it
              ? "Clicca \"Aggiorna calendario\" per estrarre guidance, AdCom FDA e date SEC (Discovery + roster)."
              : "Click \"Refresh calendar\" to extract guidance, FDA AdCom, and SEC dates (Discovery + roster)."}
          </p>
          <button
            type="button"
            className="mt-2 text-[11px] font-semibold px-3 py-1.5 rounded-md border border-[rgb(var(--accent))]/50 text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10"
            onClick={() => handleRefresh(false)}
            disabled={loading || isRunning}
          >
            {it ? "🔄 Sim + Discovery → Calendar" : "🔄 Sim + Discovery → Calendar"}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-h-0 bg-[#121729]">
          <table className="calendar-contrast-table w-full table-fixed text-[11px] border-collapse text-[#F3F5FA]">
            <colgroup>
              {/* Ticker slightly wider; all other columns equal share */}
              <col style={{ width: "10%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "7.5%" }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#1A2136]">
              <tr className="text-center text-[9px] uppercase tracking-wide text-[#F3F5FA] border-b border-white/16">
                <th
                  className={`${HEAD_LEFT} cursor-pointer hover:text-ink select-none`}
                  onClick={() => toggleSort("ticker")}
                >
                  {it ? "Titolo" : "Ticker"}
                  {sortArrow("ticker")}
                </th>
                <th
                  className={`${HEAD} cursor-pointer hover:text-ink select-none`}
                  onClick={() => toggleSort("window")}
                >
                  {it ? "Finestra" : "Window"}
                  {sortArrow("window")}
                </th>
                <th
                  className={`${HEAD} cursor-pointer hover:text-ink select-none`}
                  onClick={() => toggleSort("days")}
                >
                  {it ? "Giorni" : "Days"}
                  {sortArrow("days")}
                </th>
                <th
                  className={`${HEAD} select-none`}
                  title={
                    it
                      ? "Google Trends: riga principale = Δ% giorno-su-giorno (~3 mesi); sotto = 24h se disponibile. Verde su / rosso giù. Doppio click sul titolo per come si legge. Indice a parte — non è Soft BUY/SELL."
                      : "Google Trends: main line = day-vs-day % (~3 months); below = 24h when available. Green up / red down. Double-click header for how to read. Separate index — not Soft BUY/SELL."
                  }
                >
                  <span
                    className="cursor-help"
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLegendOpen(true);
                    }}
                  >
                    G-Trends
                  </span>
                </th>
                <th
                  className={`${HEAD} cursor-pointer hover:text-ink select-none`}
                  onClick={() => toggleSort("type")}
                >
                  {it ? "Tipo" : "Type"}
                  {sortArrow("type")}
                </th>
                <th className={HEAD}>Asset</th>
                <th className={HEAD}>{it ? "Fase" : "Phase"}</th>
                <th className={HEAD}>
                  {it ? "Quote dalla fonte" : "Source quote"}
                </th>
                <th className={HEAD}>{it ? "Fonte" : "Source"}</th>
                <th className={HEAD}>{it ? "ID fonte" : "ID source"}</th>
                <th className={HEAD}>{it ? "Designazioni" : "Designations"}</th>
                <th
                  className={`${HEAD} cursor-pointer hover:text-ink select-none`}
                  onClick={() => toggleSort("confidence")}
                >
                  {it ? "Conf." : "Conf."}
                  {sortArrow("confidence")}
                </th>
                <th className={HEAD}>{it ? "Briefing FDA" : "FDA briefing"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev, i) => {
                // Exact day → start; open window already underway → days to end (≥0).
                const dStart = daysUntilIso(ev.window_start || "");
                const dEnd = daysUntilIso(ev.window_end || ev.window_start || "");
                const startPast = dStart != null && dStart < 0;
                const days =
                  dStart != null && dStart >= 0
                    ? dStart
                    : dEnd != null && dEnd >= 0
                      ? dEnd
                      : dStart;
                const daysLabel =
                  days == null
                    ? "—"
                    : startPast && dEnd != null && dEnd >= 0
                      ? (it ? `fine ${dEnd}g` : `end ${dEnd}d`)
                      : `${days}${it ? "g" : "d"}`;
                const withinMonth = completesWithinOneMonth(ev);
                const tier = calendarSortTier(ev);
                const prevTier = i > 0 ? calendarSortTier(filtered[i - 1]!) : tier;
                const showMonthSeparator = i > 0 && prevTier === 0 && tier === 1;
                const showUnderwaySeparator = i > 0 && prevTier < 2 && tier === 2;
                const isNear = withinMonth;
                const tk = (ev.ticker || "").trim().toUpperCase();
                const trend = trendByTicker[tk];
                const isNew = newTodayTickers.has(tk);
                const windowLabel = fmtWindow(ev.window_start, ev.window_end);
                return (
                  <Fragment
                    key={`${ev.origin}-${ev.ticker}-${ev.window_start}-${ev.event_type}-${i}`}
                  >
                    {showMonthSeparator ? (
                      <tr className="bg-[#1A2136]">
                        <td
                          colSpan={13}
                          className="px-2 py-1.5 border-y-2 border-white/16"
                        >
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-[#F3F5FA]">
                            {it
                              ? `Prossimi 6 mesi — timeline (oltre ~${CALENDAR_NEAR_COMPLETE_DAYS}g)`
                              : `Next 6 months — timeline (beyond ~${CALENDAR_NEAR_COMPLETE_DAYS}d)`}
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    {showUnderwaySeparator ? (
                      <tr className="bg-[#1A2136]">
                        <td
                          colSpan={13}
                          className="px-2 py-1.5 border-y-2 border-white/16"
                        >
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-[#C5CDDC]">
                            {it
                              ? "Finestre Q/H già aperte (in corso) — sotto la timeline"
                              : "Q/H windows already open (underway) — below timeline"}
                          </span>
                        </td>
                      </tr>
                    ) : null}
                  <tr
                    className={`border-b border-white/10 hover:bg-white/[0.06] transition-colors${
                      isNear ? " cal-row-near bg-[#1A2136]" : " bg-[#121729]"
                    }${ev.main_inflection ? " calendar-main-inflection" : ""}`}
                    title={
                      ev.main_inflection
                        ? ev.inflection_label
                          ? `${it ? "Main inflection" : "Main inflection"}: ${ev.inflection_label}`
                          : it
                            ? "Main inflection point"
                            : "Main inflection point"
                        : undefined
                    }
                  >
                    <td className={`${CELL_LEFT} leading-tight overflow-hidden`}>
                      <span
                        className={`inline-flex items-center gap-1 font-bold${
                          ev.main_inflection ? " text-[#F3C451]" : " text-[#F3F5FA]"
                        }`}
                      >
                        <CalendarPromoteStarToggle
                          ticker={ev.ticker || ""}
                          company={ev.company}
                          cdIso={ev.window_start || ev.window_end || null}
                          it={it}
                          sizeClass="text-[14px]"
                        />
                        {ev.ticker}
                        {isNew ? (
                          <span title={it ? "Nuovo oggi" : "New today"} aria-label="new">
                            🔖
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`block text-[9px] font-medium truncate${
                          ev.main_inflection ? " text-[#F3C451]" : " text-[#C5CDDC]"
                        }`}
                        title={ev.company}
                      >
                        {ev.company}
                      </span>
                    </td>
                    <td
                      className={`${CELL} tabular-nums overflow-hidden`}
                      title={windowLabel}
                    >
                      <div
                        className={`whitespace-nowrap truncate${
                          ev.main_inflection
                            ? " font-bold text-[#F3C451]"
                            : " font-medium text-[#F3F5FA]"
                        }`}
                      >
                        {windowLabel}
                      </div>
                    </td>
                    <td
                      className={`${CELL} tabular-nums whitespace-nowrap overflow-hidden${
                        ev.main_inflection
                          ? " font-bold text-[#F3C451]"
                          : " font-semibold text-[#F3F5FA]"
                      }`}
                      title={
                        startPast && dEnd != null && dEnd >= 0
                          ? it
                            ? `Finestra già iniziata — fine tra ${dEnd} giorni`
                            : `Window already open — ends in ${dEnd} days`
                          : undefined
                      }
                    >
                      {daysLabel}
                    </td>
                    <td className={`${CELL} tabular-nums font-semibold`}>
                      <SearchInterestDualMark
                        row={trend}
                        loading={trendsLoading && !isSearchInterestScored(trend)}
                        ticker={ev.ticker || ""}
                        it={it}
                        align="center"
                      />
                    </td>
                    <td className={CELL}>
                      <span className={ev.main_inflection ? "font-bold text-[#F3C451]" : undefined}>
                        <EventTypeBadge
                          type={ev.event_type}
                          it={it}
                          onClick={() => setTypeDetail(ev)}
                        />
                      </span>
                    </td>
                    <td
                      className={`${CELL} overflow-hidden${
                        ev.main_inflection ? " font-bold text-[#F3C451]" : " text-[#F3F5FA]"
                      }`}
                      title={ev.asset_name ?? ""}
                    >
                      <span className="block truncate">{ev.asset_name || "—"}</span>
                    </td>
                    <td className={`${CELL} text-[#F3F5FA] overflow-hidden whitespace-nowrap`}>
                      {ev.trial_phase ? `Ph ${ev.trial_phase}` : "—"}
                    </td>
                    <td className={`${CELL} overflow-hidden`}>
                      {ev.timing_quote ? (
                        <p
                          className="text-[10px] text-[#E8ECF5] leading-snug line-clamp-2"
                          title={ev.timing_quote}
                        >
                          "{ev.timing_quote}"
                        </p>
                      ) : (
                        <span className="text-[#C5CDDC]">—</span>
                      )}
                    </td>
                    <td className={`${CELL} whitespace-nowrap`}>
                      <div className="inline-flex flex-col items-center">
                      <span className="text-[9px] text-[#D7DEEE]">
                        {ev.origin === "fda"
                          ? "FDA AdCom"
                          : ev.origin === "sec"
                            ? "SEC 8-K"
                            : ev.source_type === "manual_calendar_insert"
                              ? it
                                ? "Insert manuale"
                                : "Manual insert"
                              : ev.source_type === "clinicaltrials.gov"
                                ? "CT.gov CD"
                                : ev.source_type?.replace("_", " ") ?? "—"}
                      </span>
                      {ev.source_date ? (
                        <span className="text-[8px] text-[#C5CDDC]">
                          {ev.source_date.slice(5)}
                        </span>
                      ) : null}
                      {ev.origin === "fda" && ev.link ? (
                        <a
                          href={ev.link}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[8px] font-semibold text-[rgb(var(--accent))] hover:underline mt-0.5"
                        >
                          {it ? "Dettaglio FDA" : "FDA detail"}
                        </a>
                      ) : ev.origin === "sec" && ev.link ? (
                        <a
                          href={ev.link}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[8px] font-semibold text-[rgb(var(--accent))] hover:underline mt-0.5"
                        >
                          EDGAR
                        </a>
                      ) : ev.estimation_method ? (
                        <span
                          className="block text-[8px] text-[#A79AFF] font-medium mt-0.5"
                          title={ev.estimation_method}
                        >
                          {ev.estimation_method === "external_calendar"
                            ? "📅 ext. cal"
                            : ev.estimation_method === "priority_review_estimate"
                              ? "⚡ priority est."
                              : ev.estimation_method === "standard_review_estimate"
                                ? "📋 standard est."
                                : ev.estimation_method === "explicit_pdufa"
                                  ? "✅ explicit"
                                  : ev.estimation_method === "sec_8k_extract"
                                    ? "SEC extract"
                                    : ""}
                        </span>
                      ) : null}
                      </div>
                    </td>
                    <td className={`${CELL} text-[9px]`}>
                      {(() => {
                        const href = (ev.link || "").trim();
                        const idLabel = (ev.identification_sources_label || "").trim();
                        if (href) {
                          return (
                            <div className="inline-flex flex-col items-center max-w-full">
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-[#34D399] hover:underline break-all line-clamp-2"
                                title={href}
                              >
                                {calendarSourceLinkLabel(href, it)}
                              </a>
                              {idLabel ? (
                                <span
                                  className="block text-[8px] text-[#C5CDDC] mt-0.5 truncate max-w-full"
                                  title={idLabel}
                                >
                                  {idLabel}
                                </span>
                              ) : null}
                            </div>
                          );
                        }
                        return (
                          <div className="inline-flex flex-col items-center max-w-full">
                            <span
                              className="font-semibold text-[#F87185]"
                              title={
                                it
                                  ? "Nessun link alla fonte (studio / FDA / press / EDGAR)"
                                  : "No source link (study / FDA / press / EDGAR)"
                              }
                            >
                              {it ? "Link assente" : "No link"}
                            </span>
                            {idLabel ? (
                              <span
                                className="block text-[8px] text-[#C5CDDC] mt-0.5 truncate max-w-full"
                                title={idLabel}
                              >
                                {idLabel}
                              </span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td
                      className={`${CELL} text-[9px] text-[#F3F5FA] truncate`}
                      title={ev.regulatory_designations_label || ""}
                    >
                      {ev.regulatory_designations_label || "—"}
                    </td>
                    <td className={CELL}>
                      {confidenceBar(ev.confidence)}
                    </td>
                    <td className={CELL}>
                      <FdaBriefingCell
                        row={ev.fdaRow ?? null}
                        days={days}
                        it={it}
                        onOpen={() => ev.fdaRow && setOpenBriefing(ev.fdaRow)}
                      />
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
      {typeDetail ? (
        <RegulatoryCatalystDetailModal
          event={typeDetail}
          ticker={typeDetail.ticker || ""}
          it={it}
          onClose={() => setTypeDetail(null)}
        />
      ) : null}
    </div>
  );
}
