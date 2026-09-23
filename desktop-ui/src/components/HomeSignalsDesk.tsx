/**
 * Home decision desk — catalysts in the next ~20 days (+ red-★ interest) + excitement tells
 * (G-Trends, vol, Sentiment, skew, Δ visit, Δ24h, Last Order, Insider Buying, FDA Briefing).
 * Soft BUY/SELL still feed the mobile companion snapshot.
 * Rec column (Soft BUY/SELL/HOLD) is owner-admin only (tizyvola@gmail.com).
 *
 * Column cache:
 * - Morning (weekday): Ticker / Event / Days + Insider + Exec Exit + FDA Brief + G-Trends
 * - Hourly (Nasdaq open): Vol, Conviction, Expectation, Skew, Short Δ, vs XBI, Last Order
 * Open path paints the server desk pack (GET); Refresh POSTs server refresh.
 * Clients never call Yahoo for hourly desk columns — server owns the prints.
 */
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DeskReferenceModal } from "./DeskReferenceModal";
import {
  registerPageRefresh,
  setPageRefreshLoading,
} from "../sheet/pageRefreshBridge";
import {
  HomeSignalsDeskRow,
} from "./HomeSignalsDeskRow";
import { createDeskLiveStores, flushDeskLiveUiBridge, setDeskLiveUiBridge } from "../sheet/deskLiveStores";
import { clearDeskBootBusy, markDeskBootBusy } from "../sheet/deskBootGate";
import {
  useVirtualTableBody,
  VirtualTablePadRow,
} from "../sheet/useVirtualTableBody";
import {
  findScrollableParent,
  offsetInScrollContent,
} from "../sheet/scrollInContainer";
import {
  type DeskReferenceDoc,
} from "../sheet/deskReferenceExplain";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { invalidateProjectJsonCache } from "../data/projectData";
import {
  eventVolPairKey,
  fetchCatalystAccumulation,
  fetchCatalystDeskCache,
  fetchCatalystOutcomesResolved,
  fetchDailyNews,
  fetchCatalystCalendarSnapshot,
  fetchFdaAdcomCalendarSnapshot,
  fetchFdaDesignationsBatch,
  fetchGuidanceCalendarSnapshot,
  fetchIntraday1h,
  fetchPendingHypotheses,
  fetchVolumeAcceleration,
  fetchVolumeVsPrevSession,
  refreshCatalystDeskCache,
  type ClinicalPreCdRecord,
  type CatalystAccumulationRow,
  type CatalystShortInterestRow,
  type CatalystVsXbiRow,
  type EventVolIndexRow,
  type FdaDesignationRow,
  type GuidanceCalendarEvent,
  type PendingHypothesisItem,
  type PreMktConvictionRow,
  type SearchInterestRow,
  type VolumeVsPrevSessionRow,
} from "../api/supernova";

import {
  buildMobileDashboardSnapshot,
  scheduleMobileDashboardSnapshotPublish,
} from "../api/mobileDashboardSnapshot";
import {
  fdaRowsFromSnapshot,
  mergeCalendarSources,
  simRowsToCdEvents,
} from "../sheet/calendarCatalystEvents";
import type { FdaAdcomRow } from "../sheet/fdaAdcomCalendar";
import { FdaAdcomBriefingModal } from "./FdaAdcomBriefingModal";
import { ProductBriefingModal } from "./ProductBriefingModal";
import {
  clinicalAssetProductName,
  collectEisProductBriefing,
  type EisProductBriefing,
} from "../sheet/eisProductBriefing";
import {
  formatBiasCell,
  priceVolKindFromLabel,
} from "../sheet/catalystBiasDisplay";
import {
  getAttentionStarsVersion,
  isAttentionStarred,
} from "../sheet/attentionStarStore";
import { isCatalystInterestTicker } from "../sheet/catalystInterestStore";
import {
  deskIndexTextClass,
} from "../sheet/deskIndexTone";
import type { InvestSimInputs, InvestSimHistoryPoint } from "../sheet/investSimStorage";
import { isDuringUsEquityRegularHours } from "../sheet/marketSession";
import {
  formatPriceVolDivergence,
  isVolumeSurge,
  mergeVolumeVsPrevMaps,
  peekVolumeVsPrevCache,
  rememberVolumeVsPrevRows,
  setVolumeVsPrevManyCoalesced,
} from "../sheet/volumeVsPrevSession";
import { maybeTriggerEisForHighVol } from "../sheet/volumeAccelEisTrigger";
import {
  fdaRowsFromMorningBrief,
  hourlyDeskCacheHasData,
  isHourlyDeskCacheUsable,
  isMorningAccumulationUsable,
  isMorningDeskCacheFreshForToday,
  listTickersMissingSignal,
  mergeTickerMapsPreferSignal,
  peekCatalystDeskColumnCache,
  rememberCatalystDeskColumnCache,
  setDeskStoreManyPreferSignal,
  DESK_SIGNAL_KEYS,
  deskRowHasSignal,
  deskSignalValueUsable,
} from "../sheet/catalystDeskColumnCache";
import { aliasEventVolRowsForPairs } from "../sheet/eventVolIndexDisplay";
import { auditDeskMissingSignals } from "../sheet/deskEmptyCellDiag";
import {
  dailyChangePctFromRow,
  isValidMarketTicker,
  isWarrantTicker,
  sheetTickerFromRow,
} from "../sheet/simulationPosition";
import { companyNameFromSimRow } from "../sheet/tickerCompanyLabel";
import { daysToCdFromSimRow } from "../sheet/sdsCohortScope";
import { useLang, useT } from "../shared/i18n";
import {
  buildOperationalRecResult,
  type OperationalRecResult,
  type OperationalSellTag,
  type OperationalSuggestedAction,
} from "../sheet/operationalRecommendation";
import { buildPriorSessionPctByTicker } from "../sheet/softBuyRisingStreak";
import {
  getStoredTester,
  isAllowedOwnerEmail,
  TESTER_SESSION_CHANGED_EVENT,
} from "../sheet/testerSession";
import {
  suggestedActionLabel,
  suggestedActionToneClass,
} from "../sheet/suggestionMonitor";
import {
  DESK_CALENDAR_HORIZON_DAYS,
  DESK_G_TRENDS_SPIKE_PCT,
  DESK_POST_CD_RETENTION_DAYS,
  buildDeskCalendarEvents,
  deskCatalystOutcomeKey,
  deskEventTypeShort,
  deskRowStarPinRank,
  mergeHighTrendDeskEvents,
  mergePinnedDeskEvents,
  mergeSoftBuyDeskEvents,
  type DeskCalendarEvent,
  type DeskCalendarTicker,
} from "../sheet/deskCalendarEvents";
import { isDebugRendersEnabled } from "../sheet/debugRenderCount";
import {
  msUntilNextRomeMidnight,
  recordCatalystDeskTickers,
  romeDateKey,
} from "../sheet/catalystDeskNewLedger";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { buildPickSignalsFromSimTable } from "../sheet/top2FromSimulation";
import { normalizedRowKey } from "../sheet/investSimKeys";
import {
  clinicalDrugFromSimRow,
  clinicalIndicationFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
  clinicalStudyHrefFromSimRow,
  clinicalStudyTitleFromSimRow,
  resolveSimRowForDeskEvent,
  usableProductName,
} from "../sheet/simRowClinicalMeta";
import { clinicalStudyMetaForDesk } from "../sheet/tickerEisSummary";
import {
  designationsFromText,
  daysUntilMigrationAnchor,
  formatSourceList,
  isWithinCatalystHorizon,
  normalizeFdaDesignationLabel,
} from "../sheet/calendarPhase1";
import {
  newsProductDesignationByTicker,
  type NewsProductDesignationHint,
} from "../sheet/dailyNewsProductDesignations";
import {
  clinicalDimensionScoresByTicker,
  mergeDimensionScoreMaps,
  newsDimensionScoresByTicker,
  newsDimSortKey,
  type NewsDimensionScores,
} from "../sheet/newsDimensionScores";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import { useCatalystInterestTickers } from "../hooks/useCatalystInterestTickers";
import type { LossRiskEntry } from "./LossRiskPoopCell";
import { EventVolLegendModal, catalystColumnHint, type CatalystLegendTopic } from "./EventVolLegendModal";
import {
  searchInterest1dDeltaPct,
  searchInterestDeltaPct,
} from "../sheet/searchInterestDisplay";
import {
  peekSearchInterestRows,
  rememberSearchInterestRows,
  subscribeSearchInterestStore,
} from "../sheet/searchInterestStore";

export type CutoffTopKpiFocus = {
  ticker: string;
  cd?: string;
  rowKey?: string;
  openDeepDive?: boolean;
};

/** Sortable metric columns on the Catalyst desk table. */
type DeskSortCol =
  | "ticker"
  | "productDesig"
  | "newsScores"
  | "event"
  | "day"
  | "bias"
  | "trends"
  | "vol"
  | "diverge"
  | "ivr"
  | "skew"
  | "short"
  | "vsxbi"
  | "d1h"
  | "d24"
  | "premkt"
  | "accum"
  | "gov"
  | "fda"
  | "rec";

type DeskSortDir = "asc" | "desc";

function defaultDeskSortDir(col: DeskSortCol): DeskSortDir {
  if (
    col === "day" ||
    col === "ticker" ||
    col === "event" ||
    col === "productDesig" ||
    col === "rec"
  )
    return "asc";
  return "desc";
}

function compareDeskSortValues(
  a: number | string | null,
  b: number | string | null,
  dir: DeskSortDir,
): number {
  const aNull =
    a == null || a === "" || (typeof a === "number" && !Number.isFinite(a));
  const bNull =
    b == null || b === "" || (typeof b === "number" && !Number.isFinite(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let c = 0;
  if (typeof a === "string" && typeof b === "string") {
    c = a.localeCompare(b, undefined, { sensitivity: "base" });
  } else {
    c = Number(a) - Number(b);
  }
  return dir === "asc" ? c : -c;
}

function SortColHeader({
  col,
  topic,
  sortKey,
  sortDir,
  onSort,
  onLegend,
  align = "center",
  it,
  children,
}: {
  col: DeskSortCol;
  topic: CatalystLegendTopic;
  sortKey: DeskSortCol | null;
  sortDir: DeskSortDir;
  onSort: (col: DeskSortCol) => void;
  onLegend: (topic: CatalystLegendTopic) => void;
  align?: "left" | "center";
  it: boolean;
  children: ReactNode;
}) {
  const active = sortKey === col;
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | null>(null);
  const showTimer = useRef<number | null>(null);
  const [hintPos, setHintPos] = useState<{ top: number; left: number } | null>(null);
  const hint = catalystColumnHint(topic, it);

  const clearTimers = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };

  const openHint = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 300;
    let left = r.left + r.width / 2 - width / 2;
    if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
    if (left < 8) left = 8;
    let top = r.bottom + 8;
    if (top + 170 > window.innerHeight) top = Math.max(8, r.top - 170);
    setHintPos({ top, left });
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <>
    <button
      type="button"
      ref={btnRef}
      className={`text-[10px] font-medium uppercase tracking-[0.06em] leading-tight hover:text-[rgb(var(--accent))] ${
        active ? "text-[rgb(var(--accent))]" : "text-ink-muted"
      } ${align === "center" ? "w-full text-center" : "text-left"}`}
      aria-label={`${typeof children === "string" ? children : hint.title}. ${hint.body}`}
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
      onMouseEnter={() => {
        clearTimers();
        showTimer.current = window.setTimeout(openHint, 140);
      }}
      onMouseLeave={() => {
        clearTimers();
        hideTimer.current = window.setTimeout(() => setHintPos(null), 80);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          setHintPos(null);
          onLegend(topic);
          return;
        }
        onSort(col);
      }}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active ? (
          <span className="text-[9px] opacity-80" aria-hidden>
            {col === "day" || col === "ticker" || col === "event" || col === "productDesig"
              ? sortDir === "asc"
                ? "↑"
                : "↓"
              : sortDir === "desc"
                ? "↑"
                : "↓"}
          </span>
        ) : null}
      </span>
    </button>
    {hintPos && typeof document !== "undefined"
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[80] w-[18.5rem] rounded-xl border border-white/16 bg-[#121729] px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
            style={{ top: hintPos.top, left: hintPos.left }}
          >
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#F3C451]">
              {hint.title}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-[#F3F5FA]">{hint.body}</p>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}

/** Compact Excel-like gutters — body/header centered except Ticker (left).
 *  max-w-0 forces table-fixed columns to honor % widths (ignore intrinsic chip width). */
const DESK_CELL =
  "px-0.5 py-1 align-middle text-center border-b border-[rgb(var(--border))]/25 overflow-hidden max-w-0";
const DESK_CELL_LEFT =
  "px-0.5 py-1 align-middle text-left border-b border-[rgb(var(--border))]/25 overflow-hidden max-w-0";
const DESK_TH = `${DESK_CELL} font-medium bg-[rgb(var(--surface-elevated))]`;
const DESK_TH_LEFT = `${DESK_CELL_LEFT} font-medium bg-[rgb(var(--surface-elevated))]`;
/** thead column count — spacer rows for virtual tbody (base; +1 Rec when owner-admin). */
const DESK_TABLE_COL_SPAN_BASE = 19;
/**
 * Fixed column weights — sum = 100% so the table fills the tab
 * with no horizontal scroll (no min-width floor).
 */
const DESK_COL_WIDTHS = [
  "9%", // ticker
  "7%", // product
  "8%", // Daily Score (Clin/Fin/Corp/Acc)
  "4%", // event
  "3%", // days
  "5%", // momentum
  "4%", // g-trends
  "4%", // vol
  "5%", // conviction
  "4%", // sentiment
  "4%", // skew
  "5%", // short Δ
  "3%", // vs xbi
  "3%", // Δ visit (hourly)
  "4%", // Δ24h
  "7%", // last order
  "7%", // insider
  "7%", // exec exit
  "7%", // fda brief
] as const;

/** Owner-admin: squeeze ticker/FDA to make room for Rec (still 100%). */
const DESK_COL_WIDTHS_ADMIN_REC = [
  "7%", // ticker
  "7%", // product
  "8%", // Daily Score (Clin/Fin/Corp/Acc)
  "4%", // event
  "3%", // days
  "5%", // momentum
  "4%", // g-trends
  "4%", // vol
  "5%", // conviction
  "4%", // sentiment
  "4%", // skew
  "5%", // short Δ
  "3%", // vs xbi
  "3%", // Δ visit (hourly)
  "4%", // Δ24h
  "7%", // last order
  "7%", // insider
  "6%", // exec exit
  "5%", // fda brief
  "5%", // rec (admin)
] as const;

type DeskRecCell = {
  action: OperationalSuggestedAction;
  hasPosition: boolean;
  sellTag?: OperationalSellTag;
};

function deskRecActionRank(action: OperationalSuggestedAction): number {
  switch (action) {
    case "sell":
      return 4;
    case "buy":
      return 3;
    case "hold":
      return 2;
    case "review":
      return 1;
    default:
      return 0;
  }
}

function buildDeskRecByTicker(
  ops: Pick<OperationalRecResult, "byKey" | "buys" | "sells">,
): Map<string, DeskRecCell> {
  const m = new Map<string, DeskRecCell>();
  for (const [key, action] of ops.byKey) {
    const tk = String(key.split("|")[0] ?? "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    const prev = m.get(tk);
    if (!prev || deskRecActionRank(action) > deskRecActionRank(prev.action)) {
      m.set(tk, { action, hasPosition: prev?.hasPosition ?? false, sellTag: prev?.sellTag });
    }
  }
  for (const b of ops.buys) {
    const tk = b.ticker.trim().toUpperCase();
    if (!tk) continue;
    const prev = m.get(tk);
    if (!prev || prev.action !== "sell") {
      m.set(tk, { action: "buy", hasPosition: false });
    }
  }
  for (const s of ops.sells) {
    const tk = s.ticker.trim().toUpperCase();
    if (!tk) continue;
    m.set(tk, { action: "sell", hasPosition: true, sellTag: s.tag });
  }
  return m;
}

function formatDeskRecLabel(
  cell: DeskRecCell | null | undefined,
  it: boolean,
): string {
  if (!cell) return "—";
  if (cell.action === "sell" && cell.sellTag === "G2") return "SELL G2";
  if (cell.action === "sell") return "SELL";
  if (cell.action === "buy") return "BUY";
  return suggestedActionLabel(cell.action, it ? "it" : "en", cell.hasPosition);
}

function subscribeTesterSession(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(TESTER_SESSION_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(TESTER_SESSION_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function readIsOwnerAdmin(): boolean {
  return isAllowedOwnerEmail(getStoredTester()?.email ?? "");
}

function resolveDeskProductDesig(opts: {
  ticker: string;
  rowProduct?: string | null;
  simRow?: Record<string, unknown> | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  guidanceEvents?: GuidanceCalendarEvent[];
  fda?: FdaDesignationRow | null;
  news?: NewsProductDesignationHint | null;
}): { product: string; designation: string } {
  const tk = opts.ticker.trim().toUpperCase();
  const product =
    usableProductName(opts.rowProduct) ||
    usableProductName(
      clinicalAssetProductName(opts.clinicalRecords, {
        ticker: tk,
        nctId: clinicalNctFromSimRow(opts.simRow ?? undefined),
      }),
    ) ||
    clinicalDrugFromSimRow(opts.simRow ?? undefined) ||
    usableProductName(opts.news?.product) ||
    usableProductName(opts.fda?.product) ||
    "";
  const parts = new Set<string>();
  for (const d of opts.fda?.designations ?? []) {
    const n = normalizeFdaDesignationLabel(d);
    if (n) parts.add(n);
    else {
      for (const x of designationsFromText(d)) parts.add(x);
    }
  }
  for (const d of opts.news?.designations ?? []) {
    const n = normalizeFdaDesignationLabel(d);
    if (n) parts.add(n);
    else {
      for (const x of designationsFromText(d)) parts.add(x);
    }
  }
  for (const ev of opts.guidanceEvents ?? []) {
    if (String(ev.ticker ?? "").trim().toUpperCase() !== tk) continue;
    for (const d of ev.regulatory_designations ?? []) {
      if (d?.trim()) parts.add(d.trim());
    }
    for (const d of designationsFromText(ev.timing_quote, ev.asset_name, ev.indication)) {
      parts.add(d);
    }
  }
  for (const rec of opts.clinicalRecords ?? []) {
    if (String(rec.ticker ?? "").trim().toUpperCase() !== tk) continue;
    const raw = rec.ai?.study_clinical_profile?.fda_designation;
    const norm = normalizeFdaDesignationLabel(raw);
    if (norm) parts.add(norm);
    for (const d of designationsFromText(raw)) parts.add(d);
  }
  return { product, designation: formatSourceList([...parts]) };
}
const DESK_CHIP_TH = DESK_TH;


function cdFromRowKey(rowKey: string | undefined): string | undefined {
  if (!rowKey?.includes("|")) return undefined;
  const cd = rowKey.split("|").slice(1).join("|").trim();
  return cd && cd !== "—" ? cd : undefined;
}

function topKpiFocus(
  ticker: string,
  rowKey?: string,
  openDeepDive = true,
): CutoffTopKpiFocus {
  return { ticker, rowKey, cd: cdFromRowKey(rowKey), openDeepDive };
}

export function HomeSignalsDesk({
  simTable,
  inputs,
  sdsRows = [],
  chartBundle = null,
  history = [],
  lossRiskCatalog = null,
  catalogByRowKey = null,
  operationalRec = null,
  priorSessionPctByTicker = null,
  clinicalRecords = [],
  onOpenEvaluationTopKpi,
  onReloadSimulation,
  onExtraRefresh,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  sdsRows?: SdsRow[];
  chartBundle?: ChartBundle | null;
  history?: InvestSimHistoryPoint[];
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  operationalRec?: OperationalRecResult | null;
  priorSessionPctByTicker?: Map<string, number> | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  onOpenEvaluationTopKpi?: (focus: CutoffTopKpiFocus) => void;
  onReloadSimulation?: () => Promise<SheetTable | null> | Promise<void> | void;
  /** Extra work on the same Refresh (e.g. Daily News search). */
  onExtraRefresh?: () => Promise<void> | void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const showAdminRecCol = useSyncExternalStore(
    subscribeTesterSession,
    readIsOwnerAdmin,
    () => false,
  );
  const deskColWidths = showAdminRecCol ? DESK_COL_WIDTHS_ADMIN_REC : DESK_COL_WIDTHS;
  const deskColSpan = showAdminRecCol
    ? DESK_TABLE_COL_SPAN_BASE + 1
    : DESK_TABLE_COL_SPAN_BASE;
  const [deskReloadToken, setDeskReloadToken] = useState(0);
  const [deskRefreshing, setDeskRefreshing] = useState(false);

  /** Yahoo prior-session % + High Vol — same Soft BUY context as the old Home. */
  const [livePriorSessionPct, setLivePriorSessionPct] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [volumeAccelByTicker, setVolumeAccelByTicker] = useState<
    Map<
      string,
      {
        flagged: boolean;
        score: number | null;
        doublingMinutes: number | null;
        rvol: number | null;
      }
    >
  >(() => new Map());
  const [volumeSurgeTickers, setVolumeSurgeTickers] = useState<string[]>([]);
  const [volByTicker, setVolByTicker] = useState<
    Record<string, VolumeVsPrevSessionRow>
  >({});
  /** Clin/Fin/Corp/Access from Daily News (merged with Deep Dive below). */
  const [newsOnlyScoresByTicker, setNewsOnlyScoresByTicker] = useState<
    Record<string, NewsDimensionScores>
  >({});
  const newsScoresByTicker = useMemo(
    () =>
      mergeDimensionScoreMaps(
        clinicalDimensionScoresByTicker(clinicalRecords, it ? "it" : "en"),
        newsOnlyScoresByTicker,
      ),
    [clinicalRecords, newsOnlyScoresByTicker, it],
  );

  const priorPctForOps = priorSessionPctByTicker ?? livePriorSessionPct;

  useEffect(() => {
    if (!simTable?.rows?.length) {
      setVolumeSurgeTickers([]);
      setVolumeAccelByTicker(new Map());
      return;
    }
    const tickers: string[] = [];
    const seen = new Set<string>();
    for (const r of simTable.rows) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (!isValidMarketTicker(tk) || seen.has(tk)) continue;
      seen.add(tk);
      tickers.push(tk);
      if (tickers.length >= 80) break;
    }
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const vsPrev = await fetchVolumeVsPrevSession(tickers);
          if (cancelled) return;
          const surge = Object.entries(vsPrev.rows ?? {})
            .filter(([, row]) => isVolumeSurge(row.pct_of_prev))
            .map(([tk]) => tk.trim().toUpperCase())
            .filter(Boolean);
          if (!cancelled) {
            // After boot, keep surge maps warm only if UI bridge is open (Refresh).
            if (!firstLoadDoneRef.current || uiColumnBridgeRef.current) {
              startTransition(() => setVolumeSurgeTickers(surge));
            }
          }
          maybeTriggerEisForHighVol(surge);
          if (!surge.length) {
            if (!firstLoadDoneRef.current || uiColumnBridgeRef.current) {
              startTransition(() => setVolumeAccelByTicker(new Map()));
            }
            return;
          }
          const accel = await fetchVolumeAcceleration(surge);
          if (cancelled) return;
          const map = new Map<
            string,
            {
              flagged: boolean;
              score: number | null;
              doublingMinutes: number | null;
              rvol: number | null;
            }
          >();
          for (const [tk, row] of Object.entries(accel.rows ?? {})) {
            map.set(tk, {
              flagged: Boolean(row.flagged),
              score: row.score ?? null,
              doublingMinutes: row.doubling_time_minutes ?? null,
              rvol: row.rvol ?? null,
            });
          }
          if (!firstLoadDoneRef.current || uiColumnBridgeRef.current) {
            startTransition(() => {
              if (!cancelled) setVolumeAccelByTicker(map);
            });
          }
        } catch {
          if (!cancelled) {
            startTransition(() => {
              setVolumeSurgeTickers([]);
              setVolumeAccelByTicker(new Map());
            });
          }
        }
      })();
    };
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 6_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 2_500);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [simTable]);

  useEffect(() => {
    if (!simTable?.rows?.length) {
      setLivePriorSessionPct(new Map());
      return;
    }
    if (priorSessionPctByTicker) return;
    const openTickers = new Set<string>();
    for (const [key, e] of Object.entries(inputs)) {
      if (!e || e.ignoreSheet || !(e.capital > 0)) continue;
      const tk = (key.split("|")[0] || "").trim().toUpperCase();
      if (isValidMarketTicker(tk)) openTickers.add(tk);
    }
    const nearCd: string[] = [];
    for (const r of simTable.rows) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (!isValidMarketTicker(tk) || openTickers.has(tk)) continue;
      const d = daysToCdFromSimRow(r);
      if (d != null && d >= 0 && d <= DESK_CALENDAR_HORIZON_DAYS) nearCd.push(tk);
    }
    // Prefer open / surge / near-CD; keep room for the full desk near-CD set
    // so weekday prior-session Δ can fill when sheet Var. Giorn. is blank.
    const tickers = [
      ...new Set([...openTickers, ...volumeSurgeTickers, ...nearCd]),
    ].slice(0, 80);
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const payload = await fetchIntraday1h(tickers);
          if (cancelled) return;
          const next = buildPriorSessionPctByTicker(payload);
          if (!firstLoadDoneRef.current || uiColumnBridgeRef.current) {
            startTransition(() => {
              // Weekend/poisoned payload often returns {} — do not wipe a warm map.
              if (!cancelled && next.size > 0) setLivePriorSessionPct(next);
            });
          }
        } catch {
          /* keep prior map; empty wipe caused Δ24h holes after first paint */
        }
      })();
    };
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 4_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 1_500);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [simTable, inputs, volumeSurgeTickers, priorSessionPctByTicker]);

  const ops = useMemo((): Pick<
    OperationalRecResult,
    "buys" | "sells" | "buyNearMisses" | "gateStrengthByKey" | "byKey" | "urgentKeys"
  > => {
    if (operationalRec) {
      return {
        buys: operationalRec.buys,
        sells: operationalRec.sells,
        buyNearMisses: operationalRec.buyNearMisses,
        gateStrengthByKey: operationalRec.gateStrengthByKey,
        byKey: operationalRec.byKey,
        urgentKeys: operationalRec.urgentKeys,
      };
    }
    if (!simTable?.rows?.length) {
      return {
        buys: [],
        sells: [],
        buyNearMisses: [],
        gateStrengthByKey: new Map(),
        byKey: new Map(),
        urgentKeys: new Set(),
      };
    }
    try {
      return buildOperationalRecResult({
        simTable,
        inputs,
        chartBundle,
        history,
        lang: it ? "it" : "en",
        sdsRows,
        lossRiskCatalog,
        catalogByRowKey,
        priorSessionPctByTicker: priorPctForOps,
        volumeAccelByTicker,
        highVolTickers: volumeSurgeTickers,
        volPctByTicker: Object.fromEntries(
          Object.entries(volByTicker)
            .filter(
              ([, row]) =>
                row?.pct_of_prev != null && Number.isFinite(row.pct_of_prev),
            )
            .map(([tk, row]) => [tk, row!.pct_of_prev as number]),
        ),
        newsScoresByTicker,
      });
    } catch (err) {
      console.error("[HomeSignalsDesk] buildOperationalRecResult failed", err);
      return {
        buys: [],
        sells: [],
        buyNearMisses: [],
        gateStrengthByKey: new Map(),
        byKey: new Map(),
        urgentKeys: new Set(),
      };
    }
  }, [
    operationalRec,
    simTable,
    inputs,
    chartBundle,
    history,
    lossRiskCatalog,
    catalogByRowKey,
    priorPctForOps,
    volumeAccelByTicker,
    volumeSurgeTickers,
    volByTicker,
    newsScoresByTicker,
    sdsRows,
    it,
  ]);

  // Soft BUY/SELL → mobile companion (was only published from the retired Main Dashboard).
  // Build off the critical path — snapshot assembly walks the full sim book.
  useEffect(() => {
    if (!simTable?.rows?.length) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      try {
        const snap = buildMobileDashboardSnapshot({
          simTable,
          inputs,
          history: history ?? [],
          chartBundle: chartBundle ?? null,
          probOptions: { sdsRows: sdsRows ?? [] },
          portfolioRows: [],
          opportunityRows: [],
          totalCapital: 0,
          aiFeed: [],
          aiFeedRecentCount: 0,
          lang: it ? "it" : "en",
          lossRiskCatalog: lossRiskCatalog ?? null,
          catalogByRowKey: catalogByRowKey ?? undefined,
          priorSessionPctByTicker: priorPctForOps,
          operationalRec: {
            buys: ops.buys,
            sells: ops.sells,
            buyNearMisses: ops.buyNearMisses,
            gateStrengthByKey: ops.gateStrengthByKey,
            byKey: ops.byKey,
            urgentKeys: ops.urgentKeys,
          },
        });
        if (!cancelled) scheduleMobileDashboardSnapshotPublish(snap);
      } catch {
        /* companion sync best-effort */
      }
    };
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 3_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 400);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [
    simTable,
    inputs,
    history,
    chartBundle,
    sdsRows,
    lossRiskCatalog,
    catalogByRowKey,
    priorPctForOps,
    ops,
    it,
  ]);

  const [guidanceEvents, setGuidanceEvents] = useState<GuidanceCalendarEvent[]>(
    [],
  );
  const [hypotheses, setHypotheses] = useState<PendingHypothesisItem[]>([]);
  const [trendByTicker, setTrendByTicker] = useState<
    Record<string, SearchInterestRow>
  >({});
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [columnLegend, setColumnLegend] = useState<CatalystLegendTopic | null>(null);
  const [refDoc, setRefDoc] = useState<DeskReferenceDoc | null>(null);
  const [fdaRows, setFdaRows] = useState<FdaAdcomRow[]>([]);
  const [resolvedOutcomeKeys, setResolvedOutcomeKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [eventVolByKey, setEventVolByKey] = useState<
    Record<string, EventVolIndexRow>
  >({});
  const [eventVolLoading, setEventVolLoading] = useState(false);
  const [shortInterestByTicker, setShortInterestByTicker] = useState<
    Record<string, CatalystShortInterestRow>
  >({});
  const [shortInterestLoading, setShortInterestLoading] = useState(false);
  const [accumByTicker, setAccumByTicker] = useState<
    Record<string, CatalystAccumulationRow>
  >({});
  const [accumLoading, setAccumLoading] = useState(false);
  const [vsXbiByTicker, setVsXbiByTicker] = useState<Record<string, CatalystVsXbiRow>>({});
  const [vsXbiLoading, setVsXbiLoading] = useState(false);
  const [preMktByTicker, setPreMktByTicker] = useState<
    Record<string, PreMktConvictionRow>
  >({});
  const [preMktLoading, setPreMktLoading] = useState(false);
  const [openBriefing, setOpenBriefing] = useState<FdaAdcomRow | null>(null);
  const [productModal, setProductModal] = useState<{
    ticker: string;
    company: string | null;
    designation: string;
    nctId: string | null;
    briefing: EisProductBriefing;
  } | null>(null);
  const [calendarSourcesReady, setCalendarSourcesReady] = useState(false);
  /** First open only: hourglass above the table until calendar + column caches settle. */
  const [tableBootLoading, setTableBootLoading] = useState(true);
  const firstLoadDoneRef = useRef(false);
  const bootPartsRef = useRef({ calendar: false, accum: false, hourly: false });
  const onOpenEvaluationTopKpiRef = useRef(onOpenEvaluationTopKpi);
  onOpenEvaluationTopKpiRef.current = onOpenEvaluationTopKpi;
  /** Ticker click → company Deep Dive (Top KPI removed). */
  const openTopKpiRow = useCallback((ticker: string, rowKey?: string) => {
    onOpenEvaluationTopKpiRef.current?.(topKpiFocus(ticker, rowKey, true));
  }, []);
  const openEventRef = useCallback((doc: DeskReferenceDoc) => {
    setRefDoc(doc);
  }, []);
  const openBriefingStable = useCallback((row: FdaAdcomRow) => {
    setOpenBriefing(row);
  }, []);

  const openProductBriefing = useCallback(
    (opts: {
      ticker: string;
      company: string | null;
      productLabel: string;
      designationLabel: string;
      simRow: Record<string, unknown> | undefined;
    }) => {
      const briefing = collectEisProductBriefing(clinicalRecords, {
        ticker: opts.ticker,
        nctId: clinicalNctFromSimRow(opts.simRow),
        productHint: opts.productLabel,
      });
      setProductModal({
        ticker: opts.ticker,
        company: opts.company,
        designation: opts.designationLabel,
        nctId: clinicalNctFromSimRow(opts.simRow),
        briefing,
      });
    },
    [clinicalRecords],
  );
  const deskLiveRef = useRef<ReturnType<typeof createDeskLiveStores> | null>(null);
  if (!deskLiveRef.current) deskLiveRef.current = createDeskLiveStores();
  const deskLive = deskLiveRef.current;
  /**
   * Column UI bridge: true only during first boot / Refresh recall.
   * Stores stay warm; React sort mirrors + row notifications stay off while using the app.
   */
  const uiColumnBridgeRef = useRef(true);
  const detachLiveUi = useCallback(() => {
    uiColumnBridgeRef.current = false;
    setDeskLiveUiBridge(deskLive, false);
  }, [deskLive]);
  const attachLiveUiForRecall = useCallback(() => {
    uiColumnBridgeRef.current = true;
    setDeskLiveUiBridge(deskLive, true);
    flushDeskLiveUiBridge(deskLive);
    setVolByTicker(deskLive.vol.peekAll());
    setTrendByTicker(deskLive.trend.peekAll());
    setEventVolByKey(deskLive.eventVol.peekAll());
    setShortInterestByTicker(deskLive.shortInterest.peekAll());
    setAccumByTicker(deskLive.accum.peekAll());
    setVsXbiByTicker(deskLive.vsXbi.peekAll());
    setPreMktByTicker(deskLive.preMkt.peekAll());
  }, [deskLive]);
  const pushColumnUi = useCallback((fn: () => void) => {
    if (!uiColumnBridgeRef.current) return;
    fn();
  }, []);
  const tryFinishTableBoot = () => {
    if (firstLoadDoneRef.current) return;
    const b = bootPartsRef.current;
    if (!(b.calendar && b.accum && b.hourly)) return;
    firstLoadDoneRef.current = true;
    setTableBootLoading(false);
    clearDeskBootBusy();
    // Paint once with boot data, then unlink live UI until Refresh.
    requestAnimationFrame(() => detachLiveUi());
  };
  const [romeDay, setRomeDay] = useState(() => romeDateKey());
  const [newTodayTickers, setNewTodayTickers] = useState<Set<string>>(() => new Set());
  const [deskSort, setDeskSort] = useState<{
    key: DeskSortCol | null;
    dir: DeskSortDir;
  }>({ key: null, dir: "desc" });
  /** Discovery + FDA-site designations by product name. */
  const [fdaDesigByTicker, setFdaDesigByTicker] = useState<
    Record<string, FdaDesignationRow>
  >({});
  /** Product + designations mined from Daily News / Manual. */
  const [newsDesigByTicker, setNewsDesigByTicker] = useState<
    Record<string, NewsProductDesignationHint>
  >({});
  /** Quick find ticker or company name in the Catalyst table (filters rows). */
  const [tickerQuery, setTickerQuery] = useState("");
  /** Re-pin when interest (red ★) list changes. Yellow ★ no longer keeps rows beyond the desk horizon. */
  const [starVersion, setStarVersion] = useState(() => getAttentionStarsVersion());
  useEffect(() => {
    const onStars = () => setStarVersion(getAttentionStarsVersion());
    window.addEventListener("supernova:attention-stars-changed", onStars);
    return () =>
      window.removeEventListener("supernova:attention-stars-changed", onStars);
  }, []);
  const interestTickers = useCatalystInterestTickers();
  const pinnedTickers = useMemo(() => {
    const s = new Set<string>();
    for (const tk of interestTickers) {
      const n = tk.trim().toUpperCase();
      if (n) s.add(n);
    }
    return [...s];
  }, [interestTickers]);
  const pinnedSet = useMemo(() => new Set(pinnedTickers), [pinnedTickers]);
  const interestHydratedKey = useRef("");
  useEffect(() => {
    const key = interestTickers.slice().sort().join(",");
    if (!key || interestHydratedKey.current === key) return;
    const isFirstHydrate = !interestHydratedKey.current;
    interestHydratedKey.current = key;
    // Entry already runs reloadSimulation — skip the first interest hydrate stampede.
    if (isFirstHydrate) return;
    void onReloadSimulation?.();
  }, [interestTickers, onReloadSimulation]);
  const toggleDeskSort = (col: DeskSortCol) => {
    setDeskSort((prev) => {
      if (prev.key === col) {
        return { key: col, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key: col, dir: defaultDeskSortDir(col) };
    });
  };
  const calendarTickers = useMemo((): DeskCalendarTicker[] => {
    // Walk Simulation rows directly — do not gate desk membership on pickSignal
    // (affid / macro / curve gates). Every CD inside the horizon belongs on the desk.
    const points = chartBundle ? chartPointsMapFromBundle(chartBundle) : undefined;
    const signals = buildPickSignalsFromSimTable(simTable, inputs, points);
    const hasPos = new Map(
      signals.map((s) => [s.ticker.trim().toUpperCase(), Boolean(s.hasPosition)]),
    );
    const out: DeskCalendarTicker[] = [];
    const seen = new Set<string>();
    for (const row of simTable?.rows ?? []) {
      const ticker = String(row.Ticker ?? "")
        .trim()
        .toUpperCase();
      if (!ticker || ticker.includes("TOTALE") || seen.has(ticker)) continue;
      const cd = String(row["Completion Date"] ?? "").trim();
      const days = daysToCdFromSimRow(row);
      const inHorizon =
        days != null &&
        Number.isFinite(days) &&
        days >= -DESK_POST_CD_RETENTION_DAYS &&
        days <= DESK_CALENDAR_HORIZON_DAYS;
      if (!inHorizon && !pinnedSet.has(ticker)) continue;
      seen.add(ticker);
      const fromSimStudy = clinicalStudyTitleFromSimRow(row);
      const fromSimPhase = clinicalPhaseFromSimRow(row);
      const fromSimHref = clinicalStudyHrefFromSimRow(row);
      const fromSimDrug = clinicalDrugFromSimRow(row);
      const clinical = clinicalStudyMetaForDesk(ticker, clinicalRecords, {
        cd,
        drugHint: fromSimDrug || null,
      });
      out.push({
        ticker,
        cd,
        daysToCd: days,
        hasPosition: hasPos.get(ticker) ?? false,
        drug: fromSimDrug || undefined,
        indication: clinicalIndicationFromSimRow(row) || undefined,
        study: fromSimStudy || clinical?.studyTitle || undefined,
        phase: fromSimPhase || clinical?.studyPhase || undefined,
        studyHref: fromSimHref || clinical?.studyHref || undefined,
        rowKey: normalizedRowKey(ticker, cd),
      });
    }
    // Guidance / FDA / SEC names inside the horizon even when not on the sim sheet.
    for (const ev of guidanceEvents) {
      const ticker = String(ev.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!ticker || seen.has(ticker) || isWarrantTicker(ticker)) continue;
      if (!isWithinCatalystHorizon(ev) && !pinnedSet.has(ticker)) continue;
      seen.add(ticker);
      const cd = String(ev.window_start || ev.window_end || "").slice(0, 10);
      out.push({
        ticker,
        cd,
        daysToCd: daysUntilMigrationAnchor(ev),
        hasPosition: false,
        drug: usableProductName(ev.asset_name) || undefined,
        indication: String(ev.indication || "").trim() || undefined,
        phase: String(ev.trial_phase || "").trim() || undefined,
        rowKey: normalizedRowKey(ticker, cd),
      });
    }
    return out;
  }, [simTable, inputs, chartBundle, pinnedSet, clinicalRecords, guidanceEvents]);

  const buyTickers = useMemo(
    () => new Set(ops.buys.map((b) => b.ticker.trim().toUpperCase())),
    [ops.buys],
  );

  const simUniverseTickerKey = useMemo(
    () =>
      [...new Set(calendarTickers.map((t) => t.ticker.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [calendarTickers],
  );

  // Shared Wind/Top-KPI store — drives G-Trends >80% desk merge without waiting on desk fetch.
  useEffect(() => {
    const list = simUniverseTickerKey ? simUniverseTickerKey.split(",") : [];
    const sync = () => {
      const peeked = peekSearchInterestRows(list);
      if (!Object.keys(peeked).length) return;
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.trend.get(k),
        (rows) => deskLive.trend.setMany(rows),
        peeked,
        DESK_SIGNAL_KEYS.trends,
      );
      pushColumnUi(() =>
        setTrendByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.trends),
        ),
      );
    };
    sync();
    return subscribeSearchInterestStore(sync);
  }, [simUniverseTickerKey, pushColumnUi]);

  const hotTrendTickers = useMemo(() => {
    const hot: string[] = [];
    const seen = new Set<string>();
    const simSet = new Set(
      calendarTickers.map((t) => t.ticker.trim().toUpperCase()).filter(Boolean),
    );
    for (const [raw, row] of Object.entries(trendByTicker)) {
      const tk = raw.trim().toUpperCase();
      if (!tk || !simSet.has(tk) || seen.has(tk)) continue;
      // Phase 1: prefer ~24h Δ%; fall back to primary print-to-print Δ%.
      const pct = searchInterest1dDeltaPct(row) ?? searchInterestDeltaPct(row);
      if (pct != null && pct > DESK_G_TRENDS_SPIKE_PCT) {
        seen.add(tk);
        hot.push(tk);
      }
    }
    return hot;
  }, [trendByTicker, calendarTickers]);
  // Membership-stable: ignore trend score churn that does not change who is "hot".
  const hotTrendKey = hotTrendTickers.join(",");
  const hotTrendTickersStable = useMemo(
    () => hotTrendTickers,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by membership string
    [hotTrendKey],
  );

  const calendarRows = useMemo((): DeskCalendarEvent[] => {
    const catalystRows = buildDeskCalendarEvents({
      tickers: calendarTickers,
      guidanceEvents,
      hypotheses,
      clinicalRecords,
      it,
      horizonDays: DESK_CALENDAR_HORIZON_DAYS,
    });
    const withSoft = mergeSoftBuyDeskEvents(catalystRows, ops.buys, calendarTickers);
    const withTrend = mergeHighTrendDeskEvents(withSoft, hotTrendTickersStable, calendarTickers);
    const withPinned = mergePinnedDeskEvents(withTrend, pinnedTickers, calendarTickers, { it });
    // Hard filter: ≤horizon forward, or ≤7d after CD (outcome week), or red-★.
    // Drop rows whose outcome already migrated to Deep Dive.
    return withPinned.filter((row) => {
      const tk = row.ticker.trim().toUpperCase();
      if (!tk) return false;
      if (row.daysUntil < 0) {
        const key = deskCatalystOutcomeKey({
          ticker: row.ticker,
          eventDate: row.eventDate,
          eventType: row.eventType,
          product: row.product,
        });
        const prefix = `${row.ticker.trim().toUpperCase()}|${String(row.eventDate || "").slice(0, 10)}|`;
        const resolved =
          resolvedOutcomeKeys.has(key) ||
          [...resolvedOutcomeKeys].some((k) => k.startsWith(prefix));
        if (resolved) return false;
      }
      if (pinnedSet.has(tk) || row.source === "interest" || isCatalystInterestTicker(tk)) {
        return true;
      }
      return (
        row.daysUntil >= -DESK_POST_CD_RETENTION_DAYS &&
        Number.isFinite(row.daysUntil) &&
        row.daysUntil <= DESK_CALENDAR_HORIZON_DAYS
      );
    });
  }, [
    calendarTickers,
    guidanceEvents,
    hypotheses,
    clinicalRecords,
    it,
    ops.buys,
    hotTrendTickersStable,
    pinnedTickers,
    pinnedSet,
    resolvedOutcomeKeys,
  ]);

  const simByTicker = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of simTable?.rows ?? []) {
      const tk = sheetTickerFromRow(r);
      if (tk && !m.has(tk)) m.set(tk, r);
    }
    return m;
  }, [simTable]);

  /** First FDA AdCom row per ticker|date (same semantics as Array.find). */
  const fdaHitByTickerDate = useMemo(() => {
    const m = new Map<string, (typeof fdaRows)[number]>();
    for (const f of fdaRows) {
      const tk = String(f.ticker ?? "")
        .trim()
        .toUpperCase();
      const day = String(f.date ?? "").slice(0, 10);
      if (!tk || !day) continue;
      const key = `${tk}|${day}`;
      if (!m.has(key)) m.set(key, f);
    }
    return m;
  }, [fdaRows]);

  /** First company name from FDA then guidance (same order as the old .find chain). */
  const companyFallbackByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fdaRows) {
      const tk = String(f.ticker ?? "")
        .trim()
        .toUpperCase();
      const company = String(f.company ?? "").trim();
      if (tk && company && !m.has(tk)) m.set(tk, company);
    }
    for (const g of guidanceEvents) {
      const tk = String(g.ticker ?? "")
        .trim()
        .toUpperCase();
      const company = String(g.company ?? "").trim();
      if (tk && company && !m.has(tk)) m.set(tk, company);
    }
    return m;
  }, [fdaRows, guidanceEvents]);

  /** Guidance events grouped by ticker — first-seen order preserved within each bucket. */
  const guidanceByTicker = useMemo(() => {
    const m = new Map<string, GuidanceCalendarEvent[]>();
    for (const ev of guidanceEvents) {
      const tk = String(ev.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!tk) continue;
      const list = m.get(tk);
      if (list) list.push(ev);
      else m.set(tk, [ev]);
    }
    return m;
  }, [guidanceEvents]);

  /**
   * Clinical records grouped by ticker for product/desig lookup only.
   * Does not change the global clinicalRecords prop passed to rows (Lotto 2).
   */
  const clinicalByTicker = useMemo(() => {
    const m = new Map<string, ClinicalPreCdRecord[]>();
    for (const rec of clinicalRecords ?? []) {
      const tk = String(rec.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!tk) continue;
      const list = m.get(tk);
      if (list) list.push(rec);
      else m.set(tk, [rec]);
    }
    return m;
  }, [clinicalRecords]);

  const fdaQueryKey = useMemo(() => {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const row of calendarRows) {
      const tk = row.ticker.trim().toUpperCase();
      if (!tk || seen.has(tk)) continue;
      seen.add(tk);
      const sim = simByTicker.get(tk);
      const product =
        String(row.product || "").trim() ||
        clinicalAssetProductName(clinicalRecords, {
          ticker: tk,
          nctId: clinicalNctFromSimRow(sim),
        }) ||
        clinicalDrugFromSimRow(sim) ||
        "";
      parts.push(`${tk}|${product}`);
    }
    return parts.sort().join(";");
  }, [calendarRows, simByTicker, clinicalRecords]);

  useEffect(() => {
    if (!fdaQueryKey) return;
    let cancelled = false;
    const items = fdaQueryKey.split(";").filter(Boolean).map((part) => {
      const [ticker, ...rest] = part.split("|");
      return { ticker: ticker || "", product: rest.join("|") || undefined };
    });
    void fetchFdaDesignationsBatch(items).then((payload) => {
      if (cancelled) return;
      setFdaDesigByTicker(payload.by_ticker ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [fdaQueryKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchDailyNews()
      .then((payload) => {
        if (cancelled) return;
        setNewsDesigByTicker(newsProductDesignationByTicker(payload));
        setNewsOnlyScoresByTicker(newsDimensionScoresByTicker(payload));
      })
      .catch(() => {
        /* keep prior News chips — empty wipe made the column flash blank */
      });
    return () => {
      cancelled = true;
    };
  }, [fdaQueryKey]);

  const sellTickers = useMemo(
    () => new Set(ops.sells.map((s) => s.ticker.trim().toUpperCase())),
    [ops.sells],
  );

  const recByTicker = useMemo(
    () => (showAdminRecCol ? buildDeskRecByTicker(ops) : new Map<string, DeskRecCell>()),
    [showAdminRecCol, ops],
  );

  const sortedCalendarRows = useMemo((): DeskCalendarEvent[] => {
    if (calendarRows.length < 2) return calendarRows;
    const key = deskSort.key;

    const biasFor = (row: DeskCalendarEvent) => {
      const tk = row.ticker;
      const vol = volByTicker[tk];
      const diverge = formatPriceVolDivergence(vol, it);
      const ev = eventVolByKey[eventVolPairKey(tk, row.eventDate)];
      return formatBiasCell(
        {
          rr10: ev?.rr10 ?? null,
          priceVolKind: priceVolKindFromLabel(diverge.label),
          insiderNetBuy30d: accumByTicker[tk]?.insider_net_buy_30d ?? null,
          relativeMove: vsXbiByTicker[tk]?.relative_move ?? null,
        },
        it,
      );
    };

    /** 0 = ★ rossa, 1 = ★ gialla, 2 = Momentum↑, 3 = rest. */
    const pinRank = (row: DeskCalendarEvent): number =>
      deskRowStarPinRank({
        enrolled: isCatalystInterestTicker(row.ticker),
        starred: isAttentionStarred(row.ticker),
        momentumUp: biasFor(row).tone === "up",
      });

    const valueFor = (row: DeskCalendarEvent): number | string | null => {
      if (!key) return null;
      const tk = row.ticker;
      switch (key) {
        case "ticker":
          return tk;
        case "productDesig": {
          const hint = resolveDeskProductDesig({
            ticker: tk,
            rowProduct: row.product,
            simRow: simByTicker.get(tk),
            clinicalRecords: clinicalByTicker.get(tk) ?? [],
            guidanceEvents: guidanceByTicker.get(tk) ?? [],
            fda: fdaDesigByTicker[tk] ?? null,
            news: newsDesigByTicker[tk] ?? null,
          });
          return [hint.product, hint.designation].filter(Boolean).join(" · ") || null;
        }
        case "newsScores":
          return newsDimSortKey(newsScoresByTicker[tk]);
        case "event":
          return deskEventTypeShort(row, it);
        case "day":
          return row.daysUntil;
        case "trends": {
          // Highest G-Trends score (0–100) on top; delta only as fallback.
          const trend = trendByTicker[tk];
          const score = trend?.interest_score;
          if (score != null && Number.isFinite(score)) return score;
          const delta = searchInterestDeltaPct(trend);
          return delta != null && Number.isFinite(delta) ? delta : null;
        }
        case "vol": {
          const pct = volByTicker[tk]?.pct_of_prev;
          return pct != null && Number.isFinite(pct) ? pct : null;
        }
        case "diverge": {
          const diverge = formatPriceVolDivergence(volByTicker[tk], it);
          const kind = priceVolKindFromLabel(diverge.label);
          if (kind === "together_up") return 2;
          if (kind === "together_down") return -2;
          if (kind === "diverge") return 0;
          return null;
        }
        case "ivr": {
          const ev = eventVolByKey[eventVolPairKey(tk, row.eventDate)];
          return ev?.ivr ?? null;
        }
        case "skew": {
          const ev = eventVolByKey[eventVolPairKey(tk, row.eventDate)];
          return ev?.rr10 ?? ev?.pcr_vol ?? null;
        }
        case "short": {
          const si = shortInterestByTicker[tk]?.si_delta_pct;
          return si != null && Number.isFinite(si) ? si : null;
        }
        case "vsxbi": {
          const rm = vsXbiByTicker[tk]?.relative_move;
          return rm != null && Number.isFinite(rm) ? rm : null;
        }
        case "d1h": {
          const h = volByTicker[tk]?.hour_chg_pct;
          return h != null && Number.isFinite(h) ? h : null;
        }
        case "d24": {
          const sim = simByTicker.get(tk);
          const pct =
            (sim ? dailyChangePctFromRow(sim) : null) ??
            priorPctForOps?.get(tk) ??
            priorPctForOps?.get(tk.trim().toUpperCase()) ??
            null;
          return pct != null && Number.isFinite(pct) ? pct : null;
        }
        case "premkt": {
          const px = preMktByTicker[tk]?.pre_mkt_price_change_pct;
          return px != null && Number.isFinite(px) ? px : null;
        }
        case "bias": {
          return biasFor(row).score;
        }
        case "accum": {
          const n = accumByTicker[tk]?.insider_net_buy_30d;
          return n != null && Number.isFinite(n) ? n : null;
        }
        case "gov": {
          const flag = accumByTicker[tk]?.governance_flag;
          if (flag === true) return 1;
          if (flag === false) return 0;
          return null;
        }
        case "fda": {
          const hit =
            fdaHitByTickerDate.get(`${tk}|${String(row.eventDate || "").slice(0, 10)}`) ?? null;
          const score = hit?.briefing?.score;
          return score != null && Number.isFinite(score) ? score : null;
        }
        case "rec": {
          const cell = recByTicker.get(tk);
          return cell ? deskRecActionRank(cell.action) : null;
        }
        default:
          return null;
      }
    };

    const decorated = calendarRows.map((row, idx) => ({
      row,
      idx,
      pin: pinRank(row),
      biasScore: biasFor(row).score,
      v: valueFor(row),
    }));
    decorated.sort((a, b) => {
      if (a.pin !== b.pin) return a.pin - b.pin;
      if (key) {
        const c = compareDeskSortValues(a.v, b.v, deskSort.dir);
        if (c !== 0) return c;
      } else if (a.pin <= 2) {
        // Within ★ and Momentum↑ blocks, stronger bias first.
        const as = a.biasScore;
        const bs = b.biasScore;
        const aNull = as == null || !Number.isFinite(as);
        const bNull = bs == null || !Number.isFinite(bs);
        if (!aNull && !bNull && as !== bs) return (bs as number) - (as as number);
        if (aNull !== bNull) return aNull ? 1 : -1;
      }
      return a.idx - b.idx;
    });
    return decorated.map((d) => d.row);
  }, [
    calendarRows,
    deskSort,
    it,
    starVersion,
    interestTickers,
    trendByTicker,
    volByTicker,
    eventVolByKey,
    shortInterestByTicker,
    vsXbiByTicker,
    preMktByTicker,
    accumByTicker,
    fdaHitByTickerDate,
    simByTicker,
    priorPctForOps,
    clinicalByTicker,
    guidanceByTicker,
    fdaDesigByTicker,
    newsDesigByTicker,
    newsScoresByTicker,
    recByTicker,
  ]);

  const displayCalendarRows = useMemo((): DeskCalendarEvent[] => {
    const q = tickerQuery.trim().toUpperCase();
    if (!q) return sortedCalendarRows;
    return sortedCalendarRows.filter((r) => {
      const tk = (r.ticker || "").trim().toUpperCase();
      if (tk.includes(q)) return true;
      const simRow = simByTicker.get(r.ticker) ?? simByTicker.get(tk) ?? null;
      const company = (
        companyNameFromSimRow(simRow) ||
        companyFallbackByTicker.get(tk) ||
        ""
      ).toUpperCase();
      return company.includes(q);
    });
  }, [sortedCalendarRows, tickerQuery, simByTicker, companyFallbackByTicker]);

  const watchTickers = useMemo(() => {
    const set = new Set(calendarRows.map((r) => r.ticker));
    for (const t of buyTickers) set.add(t);
    for (const t of sellTickers) set.add(t);
    return [...set];
  }, [calendarRows, buyTickers, sellTickers]);
  const watchTickerKey = useMemo(
    () => [...watchTickers].sort().join(","),
    [watchTickers],
  );

  const deskTableScrollRef = useRef<HTMLDivElement | null>(null);
  const [deskScrollEl, setDeskScrollEl] = useState<HTMLElement | null>(null);
  const [deskScrollMargin, setDeskScrollMargin] = useState(0);
  useEffect(() => {
    const wrap = deskTableScrollRef.current;
    if (!wrap) {
      setDeskScrollEl(null);
      return;
    }
    // When the table card is the scrollport (Catalyst Days fill layout), use it —
    // do not prefer .desk-page-scroll if that shell is overflow:hidden.
    const wrapOy = getComputedStyle(wrap).overflowY;
    if (wrapOy === "auto" || wrapOy === "scroll") {
      setDeskScrollEl(wrap);
      return;
    }
    const page =
      (wrap.closest(".desk-page-scroll") as HTMLElement | null) ??
      findScrollableParent(wrap);
    setDeskScrollEl(page ?? wrap);
  }, [displayCalendarRows.length]);
  useLayoutEffect(() => {
    const wrap = deskTableScrollRef.current;
    const scroll = deskScrollEl;
    if (!wrap || !scroll) {
      setDeskScrollMargin(0);
      return;
    }
    const measure = () => {
      setDeskScrollMargin(
        Math.max(0, Math.round(offsetInScrollContent(wrap, scroll))),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (wrap.parentElement) ro.observe(wrap.parentElement);
    ro.observe(scroll);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [deskScrollEl, displayCalendarRows.length]);
  const virtualizeDesk = displayCalendarRows.length > 20;
  const deskVirtual = useVirtualTableBody({
    count: displayCalendarRows.length,
    scrollElement: deskScrollEl,
    estimateSize: 52,
    overscan: 8,
    scrollMargin: deskScrollMargin,
    enabled: virtualizeDesk && Boolean(deskScrollEl),
  });
  const deskRowsToRender = useMemo(() => {
    if (!virtualizeDesk || !deskScrollEl || deskVirtual.virtualRows.length === 0) {
      return displayCalendarRows.map((row, index) => ({ row, index }));
    }
    return deskVirtual.virtualRows.map((vr) => ({
      row: displayCalendarRows[vr.index]!,
      index: vr.index,
    }));
  }, [
    virtualizeDesk,
    deskScrollEl,
    deskVirtual.virtualRows,
    displayCalendarRows,
  ]);
  const measureDeskRow = useCallback(
    (node: HTMLTableRowElement | null) => {
      if (node && virtualizeDesk) {
        deskVirtual.virtualizer.measureElement(node);
      }
    },
    [virtualizeDesk, deskVirtual.virtualizer],
  );
  const calendarTickerKey = useMemo(
    () =>
      [...new Set(calendarRows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [calendarRows],
  );

  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        setRomeDay(romeDateKey());
        arm();
      }, msUntilNextRomeMidnight());
    };
    arm();
    const onVis = () => {
      if (document.visibilityState === "visible") setRomeDay(romeDateKey());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!calendarSourcesReady) return;
    const tickers = calendarTickerKey ? calendarTickerKey.split(",") : [];
    setNewTodayTickers(new Set(recordCatalystDeskTickers(tickers)));
  }, [calendarSourcesReady, calendarTickerKey, romeDay]);

  const applyHourlyDeskCache = (hourly: {
    vol?: Record<string, VolumeVsPrevSessionRow>;
    event_vol?: Record<string, EventVolIndexRow>;
    short_interest?: Record<string, CatalystShortInterestRow>;
    vs_xbi?: Record<string, CatalystVsXbiRow>;
    pre_mkt?: Record<string, PreMktConvictionRow>;
    trends?: Record<string, SearchInterestRow>;
  } | null | undefined) => {
    if (!hourly) return;
    if (hourly.vol && Object.keys(hourly.vol).length) {
      const patch = setVolumeVsPrevManyCoalesced(
        (tk) => deskLive.vol.get(tk),
        (rows) => deskLive.vol.setMany(rows),
        hourly.vol,
      );
      rememberVolumeVsPrevRows(patch);
      pushColumnUi(() => setVolByTicker((prev) => mergeVolumeVsPrevMaps(prev, patch)));
    }
    if (hourly.event_vol && Object.keys(hourly.event_vol).length) {
      const aliased = aliasEventVolRowsForPairs(
        hourly.event_vol,
        eventVolPairKeyList
          ? eventVolPairKeyList.split(",").map((k) => {
              const [ticker, eventDate] = k.split("|");
              return { ticker: ticker || "", eventDate: eventDate || "" };
            })
          : [],
      );
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.eventVol.get(k),
        (rows) => deskLive.eventVol.setMany(rows),
        aliased,
        DESK_SIGNAL_KEYS.eventVol,
      );
      pushColumnUi(() =>
        setEventVolByKey((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.eventVol),
        ),
      );
    }
    if (hourly.short_interest && Object.keys(hourly.short_interest).length) {
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.shortInterest.get(k),
        (rows) => deskLive.shortInterest.setMany(rows),
        hourly.short_interest,
        DESK_SIGNAL_KEYS.shortInterest,
      );
      pushColumnUi(() =>
        setShortInterestByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.shortInterest),
        ),
      );
    }
    if (hourly.vs_xbi && Object.keys(hourly.vs_xbi).length) {
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.vsXbi.get(k),
        (rows) => deskLive.vsXbi.setMany(rows),
        hourly.vs_xbi,
        DESK_SIGNAL_KEYS.vsXbi,
      );
      pushColumnUi(() =>
        setVsXbiByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.vsXbi),
        ),
      );
    }
    if (hourly.pre_mkt && Object.keys(hourly.pre_mkt).length) {
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.preMkt.get(k),
        (rows) => deskLive.preMkt.setMany(rows),
        hourly.pre_mkt,
        DESK_SIGNAL_KEYS.preMkt,
      );
      pushColumnUi(() =>
        setPreMktByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.preMkt),
        ),
      );
    }
    // Legacy hourly snapshots may still carry trends — accept once, then prefer morning.
    if (hourly.trends && Object.keys(hourly.trends).length) {
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.trend.get(k),
        (rows) => deskLive.trend.setMany(rows),
        hourly.trends,
        DESK_SIGNAL_KEYS.trends,
      );
      rememberSearchInterestRows(patch);
      pushColumnUi(() => {
        setTrendByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.trends),
        );
        setTrendsLoading(false);
      });
    }
  };

  const applyMorningTrends = (
    trends: Record<string, SearchInterestRow> | null | undefined,
    opts?: { weekendCarry?: boolean },
  ) => {
    if (!trends || !Object.keys(trends).length) return;
    const tagged =
      opts?.weekendCarry
        ? Object.fromEntries(
            Object.entries(trends).map(([tk, row]) => [
              tk,
              {
                ...row,
                stale: true,
                delta_basis: row.delta_basis || "weekend_vs_last_nasdaq",
              },
            ]),
          )
        : trends;
    const patch = setDeskStoreManyPreferSignal(
      (k) => deskLive.trend.get(k),
      (rows) => deskLive.trend.setMany(rows),
      tagged,
      DESK_SIGNAL_KEYS.trends,
    );
    rememberSearchInterestRows(patch);
    pushColumnUi(() => {
      setTrendByTicker((prev) =>
        mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.trends),
      );
      setTrendsLoading(false);
    });
  };

  // Instant paint from local morning/hourly cache, then server desk cache.
  useEffect(() => {
    let cancelled = false;
    void fetchCatalystOutcomesResolved().then((payload) => {
      if (cancelled) return;
      const keys = Array.isArray(payload.keys) ? payload.keys : [];
      setResolvedOutcomeKeys(new Set(keys.map((k) => String(k || "").trim()).filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
  }, [deskReloadToken]);

  // Instant paint from local morning/hourly cache, then server desk cache.
  useEffect(() => {
    let cancelled = false;
    const local = peekCatalystDeskColumnCache();
    const morningFresh = local?.morning && isMorningDeskCacheFreshForToday(local.morning);
    if (morningFresh) {
      const accum = local!.morning!.accumulation;
      if (accum && Object.keys(accum).length) {
        const patch = setDeskStoreManyPreferSignal(
          (k) => deskLive.accum.get(k),
          (rows) => deskLive.accum.setMany(rows),
          accum,
          DESK_SIGNAL_KEYS.accumulation,
        );
        pushColumnUi(() =>
          setAccumByTicker((prev) =>
            mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.accumulation),
          ),
        );
      }
      const weekendCarry = Boolean(
        local!.morning!.rome_date && local!.morning!.rome_date !== romeDateKey(),
      );
      applyMorningTrends(local!.morning!.trends, { weekendCarry });
      const briefRows = fdaRowsFromMorningBrief(local!.morning!.fda_brief);
      if (briefRows.length) setFdaRows(briefRows);
    }
    if (local?.hourly) applyHourlyDeskCache(local.hourly);

    void fetchCatalystDeskCache().then((payload) => {
      if (cancelled) return;
      rememberCatalystDeskColumnCache(payload);
      const morning = payload.morning;
      if (morning && isMorningDeskCacheFreshForToday(morning)) {
        if (morning.accumulation && Object.keys(morning.accumulation).length) {
          const patch = setDeskStoreManyPreferSignal(
            (k) => deskLive.accum.get(k),
            (rows) => deskLive.accum.setMany(rows),
            morning.accumulation,
            DESK_SIGNAL_KEYS.accumulation,
          );
          pushColumnUi(() =>
            setAccumByTicker((prev) =>
              mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.accumulation),
            ),
          );
        }
        const weekendCarry = Boolean(
          morning.rome_date && morning.rome_date !== romeDateKey(),
        );
        applyMorningTrends(morning.trends ?? undefined, { weekendCarry });
        setTrendByTicker(deskLive.trend.peekAll());
        const briefRows = fdaRowsFromMorningBrief(morning.fda_brief as never);
        if (briefRows.length) {
          setFdaRows((prev) => {
            const byTk = new Map(prev.map((r) => [r.ticker, r]));
            for (const row of briefRows) {
              const cur = byTk.get(row.ticker);
              if (!cur || (row.briefing && !cur.briefing)) byTk.set(row.ticker, row);
              else if (!cur) byTk.set(row.ticker, row);
            }
            return [...byTk.values()];
          });
        }
      }
      applyHourlyDeskCache(payload.hourly);
      setVolByTicker(deskLive.vol.peekAll());
      setEventVolByKey(deskLive.eventVol.peekAll());
      setShortInterestByTicker(deskLive.shortInterest.peekAll());
      setVsXbiByTicker(deskLive.vsXbi.peekAll());
      setPreMktByTicker(deskLive.preMkt.peekAll());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Calendars + FDA AdCom snapshot — network once per desk reload; sim CDs fold via row count.
  const simRowsRef = useRef(simTable?.rows);
  simRowsRef.current = simTable?.rows;
  const simRowsLen = simTable?.rows?.length ?? 0;
  useEffect(() => {
    let cancelled = false;
    markDeskBootBusy(30_000);
    const applyCalendar = (
      guidance: Awaited<ReturnType<typeof fetchGuidanceCalendarSnapshot>> | null,
      fda: Awaited<ReturnType<typeof fetchFdaAdcomCalendarSnapshot>> | null,
      sec: Awaited<ReturnType<typeof fetchCatalystCalendarSnapshot>> | null,
      pending: { items?: unknown[] } | null,
    ) => {
      if (cancelled) return;
      const rows = fdaRowsFromSnapshot(fda);
      setFdaRows((prev) => (rows.length ? rows : prev));
      const simCds = simRowsToCdEvents(
        (simRowsRef.current as Array<Record<string, unknown>> | undefined) ?? [],
      );
      const merged = mergeCalendarSources(
        guidance?.events,
        rows,
        sec?.entries,
        false,
        simCds,
      );
      setGuidanceEvents(
        merged.filter(
          (ev) =>
            isWithinCatalystHorizon(ev) ||
            isCatalystInterestTicker(String(ev.ticker || "")),
        ),
      );
      if (pending && Array.isArray(pending.items) && pending.items.length) {
        setHypotheses(pending.items as PendingHypothesisItem[]);
      }
      setCalendarSourcesReady(true);
      bootPartsRef.current.calendar = true;
      tryFinishTableBoot();
    };
    void Promise.all([
      fetchGuidanceCalendarSnapshot().catch(() => null),
      fetchFdaAdcomCalendarSnapshot().catch(() => null),
      fetchCatalystCalendarSnapshot().catch(() => null),
      fetchPendingHypotheses().catch(() => ({ items: [] })),
    ]).then(([guidance, fda, sec, pending]) => {
      applyCalendar(guidance, fda, sec, pending);
    });
    // Soft unblock: never leave Loading… stuck if one snap queues past 12s.
    const soft = window.setTimeout(() => {
      if (cancelled || bootPartsRef.current.calendar) return;
      applyCalendar(null, null, null, { items: [] });
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearTimeout(soft);
    };
    // simRowsLen: re-fold when Simulation arrives (0→N) without re-fetching on every setSimTable identity.
  }, [deskReloadToken, simRowsLen]);

  // If Catalyst desk never finishes boot, report a freeze (session_ping still ticks while UI is stuck).
  useEffect(() => {
    markDeskBootBusy(30_000);
    // Force-finish boot parts at 12s so the table paints; 25s report only if still stuck.
    const softUnblock = window.setTimeout(() => {
      if (firstLoadDoneRef.current) return;
      bootPartsRef.current.calendar = true;
      bootPartsRef.current.accum = true;
      bootPartsRef.current.hourly = true;
      tryFinishTableBoot();
    }, 12_000);
    const t = window.setTimeout(() => {
      if (firstLoadDoneRef.current) return;
      const b = bootPartsRef.current;
      const stuck = [
        !b.calendar ? "calendar" : null,
        !b.accum ? "insider/accum" : null,
        !b.hourly ? "hourly columns" : null,
      ].filter(Boolean);
      void import("../sheet/reportUiError").then(({ reportUiError }) => {
        reportUiError({
          label: "Catalyst desk freeze",
          message: `UI freeze on entry: Catalyst desk boot stuck after 25s (${stuck.join(", ") || "unknown"}). Session may still ping while the desk is unusable.`,
          source: "window",
        });
      });
    }, 25_000);
    return () => {
      window.clearTimeout(softUnblock);
      window.clearTimeout(t);
    };
  }, []);

  // Morning columns: Insider + Exec Exit — never block first paint on live SEC (90s).
  useEffect(() => {
    if (!watchTickerKey) {
      if (calendarSourcesReady) {
        bootPartsRef.current.accum = true;
        tryFinishTableBoot();
      }
      return;
    }
    let cancelled = false;
    const list = watchTickerKey.split(",").filter(Boolean);
    const forceLive = deskReloadToken > 0;

    const markAccumBootDone = () => {
      if (cancelled || bootPartsRef.current.accum) return;
      bootPartsRef.current.accum = true;
      tryFinishTableBoot();
    };
    // Hard deadline: paint desk even if desk-cache / live accum is slow.
    const accumDeadline = window.setTimeout(markAccumBootDone, 3_000);

    const run = async () => {
      let morning = peekCatalystDeskColumnCache()?.morning ?? null;
      if (!forceLive && isMorningAccumulationUsable(morning, list)) {
        const patch = setDeskStoreManyPreferSignal(
          (k) => deskLive.accum.get(k),
          (rows) => deskLive.accum.setMany(rows),
          morning?.accumulation,
          DESK_SIGNAL_KEYS.accumulation,
        );
        pushColumnUi(() =>
          setAccumByTicker((prev) =>
            mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.accumulation),
          ),
        );
        setAccumLoading(false);
        markAccumBootDone();
        return;
      }
      try {
        const payload = await fetchCatalystDeskCache();
        if (cancelled) return;
        rememberCatalystDeskColumnCache(payload);
        morning = payload.morning ?? morning;
        if (!forceLive && isMorningAccumulationUsable(morning, list)) {
          const patch = setDeskStoreManyPreferSignal(
            (k) => deskLive.accum.get(k),
            (rows) => deskLive.accum.setMany(rows),
            morning?.accumulation,
            DESK_SIGNAL_KEYS.accumulation,
          );
          pushColumnUi(() =>
            setAccumByTicker((prev) =>
              mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.accumulation),
            ),
          );
          setAccumLoading(false);
          markAccumBootDone();
          return;
        }
      } catch {
        /* fall through to live */
      }
      // Unblock boot before live SEC — keep fetching in background.
      markAccumBootDone();
      if (cancelled) return;
      setAccumLoading(true);
      const accum = await fetchCatalystAccumulation(list);
      if (cancelled) return;
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.accum.get(k),
        (rows) => deskLive.accum.setMany(rows),
        accum.rows ?? {},
        DESK_SIGNAL_KEYS.accumulation,
      );
      pushColumnUi(() =>
        setAccumByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.accumulation),
        ),
      );
      setAccumLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(accumDeadline);
    };
  }, [watchTickerKey, deskReloadToken, calendarSourcesReady]);

  const eventVolPairKeyList = useMemo(
    () =>
      calendarRows
        .map((r) => eventVolPairKey(r.ticker, r.eventDate))
        .sort()
        .join(","),
    [calendarRows],
  );

  const clearHourlyLoading = () => {
    setEventVolLoading(false);
    setShortInterestLoading(false);
    setVsXbiLoading(false);
    setPreMktLoading(false);
  };

  /**
   * Server-owned hourly refresh. Client never hits Yahoo for desk columns —
   * POST /api/market/catalyst-desk-cache/refresh (RTH full / off-hours hole-fill).
   */
  const refreshHourlyDeskColumns = async (opts?: { force?: boolean }) => {
    setEventVolLoading(true);
    setShortInterestLoading(true);
    setVsXbiLoading(true);
    setPreMktLoading(true);
    try {
      const payload = await refreshCatalystDeskCache({ force: Boolean(opts?.force) });
      rememberCatalystDeskColumnCache(payload);
      if (payload.hourly) applyHourlyDeskCache(payload.hourly);
    } catch {
      try {
        const payload = await fetchCatalystDeskCache();
        rememberCatalystDeskColumnCache(payload);
        if (payload.hourly) applyHourlyDeskCache(payload.hourly);
      } catch {
        /* keep peeked pack */
      }
    } finally {
      clearHourlyLoading();
    }
  };

  // Hourly columns — paint server pack first; Yahoo only via server POST (RTH / hole-fill / Refresh).
  useEffect(() => {
    if (!watchTickerKey) {
      setShortInterestByTicker({});
      setVsXbiByTicker({});
      setPreMktByTicker({});
      if (calendarSourcesReady) {
        bootPartsRef.current.hourly = true;
        tryFinishTableBoot();
      }
      return;
    }
    let cancelled = false;
    const list = watchTickerKey.split(",").filter(Boolean);
    const forceLive = deskReloadToken > 0;
    const peekedVol = peekVolumeVsPrevCache(list).rows;
    if (Object.keys(peekedVol).length) {
      const patch = setVolumeVsPrevManyCoalesced(
        (tk) => deskLive.vol.get(tk),
        (rows) => deskLive.vol.setMany(rows),
        peekedVol,
      );
      pushColumnUi(() =>
        setVolByTicker((prev) => mergeVolumeVsPrevMaps(prev, patch)),
      );
    }
    const pairs = eventVolPairKeyList
      ? eventVolPairKeyList.split(",").map((k) => {
          const [ticker, eventDate] = k.split("|");
          return { ticker, eventDate };
        })
      : [];

    const markHourlyBootDone = () => {
      if (cancelled) return;
      bootPartsRef.current.hourly = true;
      tryFinishTableBoot();
      // After a Refresh recall, paint once then unlink again.
      if (forceLive && firstLoadDoneRef.current) {
        requestAnimationFrame(() => detachLiveUi());
      }
    };

    /** Paint React from stores even if the UI bridge already detached (boot race).
     * Prefer-signal merge so a sparse store peek cannot blank already-painted cells. */
    const flushHourlyUiFromStores = () => {
      setVolByTicker((prev) =>
        mergeVolumeVsPrevMaps(prev, deskLive.vol.peekAll()),
      );
      setEventVolByKey((prev) =>
        mergeTickerMapsPreferSignal(
          prev,
          deskLive.eventVol.peekAll(),
          DESK_SIGNAL_KEYS.eventVol,
        ),
      );
      setShortInterestByTicker((prev) =>
        mergeTickerMapsPreferSignal(
          prev,
          deskLive.shortInterest.peekAll(),
          DESK_SIGNAL_KEYS.shortInterest,
        ),
      );
      setVsXbiByTicker((prev) =>
        mergeTickerMapsPreferSignal(
          prev,
          deskLive.vsXbi.peekAll(),
          DESK_SIGNAL_KEYS.vsXbi,
        ),
      );
      setPreMktByTicker((prev) =>
        mergeTickerMapsPreferSignal(
          prev,
          deskLive.preMkt.peekAll(),
          DESK_SIGNAL_KEYS.preMkt,
        ),
      );
    };

    const deskHasHourlyHoles = () => {
      const missVol = listTickersMissingSignal(
        list,
        deskLive.vol.peekAll(),
        DESK_SIGNAL_KEYS.vol,
      );
      const missSi = listTickersMissingSignal(
        list,
        deskLive.shortInterest.peekAll(),
        DESK_SIGNAL_KEYS.shortInterest,
      );
      const missVs = listTickersMissingSignal(
        list,
        deskLive.vsXbi.peekAll(),
        DESK_SIGNAL_KEYS.vsXbi,
      );
      const missEv = pairs.some(
        (p) =>
          !deskRowHasSignal(
            deskLive.eventVol.get(eventVolPairKey(p.ticker, p.eventDate)) ??
              Object.entries(deskLive.eventVol.peekAll()).find(([k]) =>
                k.startsWith(`${p.ticker.trim().toUpperCase()}|`),
              )?.[1],
            DESK_SIGNAL_KEYS.eventVol,
          ),
      );
      return Boolean(missVol.length || missSi.length || missVs.length || missEv);
    };

    const run = async () => {
      const local = peekCatalystDeskColumnCache();
      let hourly = local?.hourly ?? null;
      if (hourly) applyHourlyDeskCache(hourly);

      // Unblock hourglass spinners; do NOT finish boot until desk-cache attempt lands —
      // otherwise detachLiveUi races ahead of Friday→weekend server snapshot paint.
      if (!forceLive) {
        clearHourlyLoading();
      }

      try {
        const payload = await fetchCatalystDeskCache();
        if (cancelled) return;
        rememberCatalystDeskColumnCache(payload);
        const merged = peekCatalystDeskColumnCache();
        if (merged?.hourly) {
          applyHourlyDeskCache(merged.hourly);
          hourly = merged.hourly;
        }
      } catch {
        /* keep peeked hourly */
      }
      if (cancelled) return;

      flushHourlyUiFromStores();

      const hasLocalData = hourlyDeskCacheHasData(hourly);
      const usable = isHourlyDeskCacheUsable(hourly, Date.now(), {
        sameRomeDayOk: true,
        weekendCarryOk: true,
      });
      const rthOpen = isDuringUsEquityRegularHours();

      // Refresh button → server force refresh (Yahoo only on server).
      if (forceLive) {
        await refreshHourlyDeskColumns({ force: true });
        if (cancelled) return;
        flushHourlyUiFromStores();
        markHourlyBootDone();
        return;
      }

      // Off-hours: paint Friday pack; if holes remain, ask server to hole-fill (no client Yahoo).
      if (!rthOpen) {
        clearHourlyLoading();
        if (usable && !deskHasHourlyHoles()) {
          flushHourlyUiFromStores();
          markHourlyBootDone();
          return;
        }
        if (hasLocalData || usable || deskHasHourlyHoles()) {
          auditDeskMissingSignals({
            tickers: list,
            column: "vol/Δ24h",
            signalKeys: DESK_SIGNAL_KEYS.vol,
            byTicker: deskLive.vol.peekAll(),
            valueOk: deskSignalValueUsable,
            reason: "offhours_pack_hole_before_server_fill",
          });
          await refreshHourlyDeskColumns({ force: false });
          if (cancelled) return;
          flushHourlyUiFromStores();
          auditDeskMissingSignals({
            tickers: list,
            column: "vol/Δ24h",
            signalKeys: DESK_SIGNAL_KEYS.vol,
            byTicker: deskLive.vol.peekAll(),
            valueOk: deskSignalValueUsable,
            reason: "offhours_still_empty_after_server_hole_fill",
          });
        }
        markHourlyBootDone();
        return;
      }

      // RTH: usable pack still gets a server hourly pass; stale/empty → server refresh.
      clearHourlyLoading();
      void refreshHourlyDeskColumns({ force: false }).finally(() => {
        if (cancelled) return;
        flushHourlyUiFromStores();
        markHourlyBootDone();
      });
    };

    void run();

    // Warm in-memory stores on tab focus; do not push React while bridge is detached.
    const onVis = () => {
      if (document.visibilityState !== "visible" || cancelled) return;
      const hourly = peekCatalystDeskColumnCache()?.hourly ?? null;
      if (hourly) applyHourlyDeskCache(hourly);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
    // trend buzz key intentionally omitted — hourly path re-reads current trends map.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll from watch set + event pairs only
  }, [watchTickerKey, eventVolPairKeyList, deskReloadToken, calendarSourcesReady, detachLiveUi, pushColumnUi]);

  // G-Trends: morning desk cache only (once/day). Shared store may still fill from Wind.
  useEffect(() => {
    if (!simUniverseTickerKey) {
      setTrendsLoading(false);
      return;
    }
    const list = simUniverseTickerKey.split(",").filter(Boolean);
    const peeked = peekSearchInterestRows(list);
    if (Object.keys(peeked).length) {
      const patch = setDeskStoreManyPreferSignal(
        (k) => deskLive.trend.get(k),
        (rows) => deskLive.trend.setMany(rows),
        peeked,
        DESK_SIGNAL_KEYS.trends,
      );
      pushColumnUi(() => {
        setTrendByTicker((prev) =>
          mergeTickerMapsPreferSignal(prev, patch, DESK_SIGNAL_KEYS.trends),
        );
        setTrendsLoading(false);
      });
      if (!uiColumnBridgeRef.current) setTrendsLoading(false);
    }
  }, [simUniverseTickerKey, pushColumnUi]);

  const handleHomeRefresh = useCallback(async () => {
    attachLiveUiForRecall();
    setDeskRefreshing(true);
    try {
      if (onExtraRefresh) {
        try {
          await onExtraRefresh();
        } catch {
          /* news search optional — desk still refreshes */
        }
      }
      invalidateProjectJsonCache("simulation_sheet_snapshot.json");
      if (onReloadSimulation) {
        await onReloadSimulation();
      }
      setDeskReloadToken((n) => n + 1);
      try {
        const { hydrateInvestSimHistory } = await import("../sheet/investSimStorage");
        await hydrateInvestSimHistory();
      } catch {
        /* optional */
      }
    } finally {
      setDeskRefreshing(false);
    }
  }, [onExtraRefresh, onReloadSimulation, attachLiveUiForRecall]);

  useEffect(() => {
    const unreg = registerPageRefresh({
      handler: handleHomeRefresh,
      loading: deskRefreshing,
      tooltip: t("refresh.page.catalyst.tooltip"),
    });
    return unreg;
  }, [handleHomeRefresh, deskRefreshing, t]);

  useEffect(() => {
    setPageRefreshLoading(deskRefreshing);
  }, [deskRefreshing]);

  const simMissing = !simTable?.rows?.length;
  const liveSession = isDuringUsEquityRegularHours();

  return (
    <section
      className="desk-signals-section min-w-0 w-full max-w-full shrink-0 flex flex-col gap-1.5"
      aria-label="Catalyst Days"
    >
      {simMissing ? (
        <div
          className="shrink-0 flex items-center gap-2 px-0.5 py-1.5 text-[12px] text-ink-muted"
          role="status"
          aria-live="polite"
        >
          <span className="inline-block animate-pulse text-[14px]" aria-hidden>
            ⏳
          </span>
          <span>{it ? "Caricamento Simulation…" : "Loading Simulation…"}</span>
        </div>
      ) : null}
      <div className="shrink-0 flex items-center justify-between gap-3 flex-wrap">
        <label className="relative flex items-center min-w-0">
          <span className="sr-only">
            {it ? "Cerca ticker o società" : "Search ticker or company"}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#5B6580]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="8.5" cy="8.5" r="5.2" />
            <path d="M12.4 12.4 17 17" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={tickerQuery}
            onChange={(e) => setTickerQuery(e.target.value)}
            placeholder={it ? "Ticker o società…" : "Ticker or company…"}
            autoComplete="off"
            spellCheck={false}
            className="w-[12rem] sm:w-[14rem] rounded-full border border-white/[0.08] bg-[rgb(var(--surface))] pl-8 pr-3 py-1.5 text-[12px] text-ink placeholder:text-[#5B6580] focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgb(var(--accent))]/50"
            aria-label={
              it
                ? "Cerca ticker o società nella tabella Catalyst"
                : "Search ticker or company in Catalyst table"
            }
          />
          {tickerQuery.trim() ? (
            <span className="ml-2 text-[9px] tabular-nums text-ink-muted shrink-0">
              {displayCalendarRows.length}/{sortedCalendarRows.length}
            </span>
          ) : null}
        </label>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-ink-muted">
          {isDebugRendersEnabled() ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide bg-amber-400 text-black border border-amber-700">
              DEBUG r: badges ON
            </span>
          ) : null}
          <span className={`inline-flex items-center gap-1.5 ${deskIndexTextClass("pos")}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--positive))]" />
            {it ? "Positivo" : "Positive"}
          </span>
          <span className={`inline-flex items-center gap-1.5 ${deskIndexTextClass("neu")}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--signal-neutral))]" />
            {it ? "Neutro" : "Neutral"}
          </span>
          <span className={`inline-flex items-center gap-1.5 ${deskIndexTextClass("neg")}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--negative))]" />
            {it ? "Negativo" : "Negative"}
          </span>
          <span className={`inline-flex items-center gap-1.5 ${deskIndexTextClass("stale")}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--ink-muted))]" />
            {it ? "Outdated (mkt chiuso)" : "Outdated (mkt closed)"}
          </span>
          <span className="text-[#5B6580]">
            {it
              ? `· Solo catalyst ≤${DESK_CALENDAR_HORIZON_DAYS}g + ★ priorità in cima`
              : `· Only ≤${DESK_CALENDAR_HORIZON_DAYS}d catalysts + priority star on top`}
          </span>
        </div>
      </div>

      {tableBootLoading ? (
        <div
          className="shrink-0 flex items-center gap-2 px-0.5 py-1.5 text-[12px] text-ink-muted"
          role="status"
          aria-live="polite"
        >
          <span className="inline-block animate-pulse text-[14px]" aria-hidden>
            ⏳
          </span>
          <span>Loading...</span>
        </div>
      ) : null}

      {/* Table grows with rows — page (.desk-page-scroll) owns the only scrollbar. */}
      <div
        ref={deskTableScrollRef}
        className="desk-signals-table-scroll min-w-0 w-full max-w-full overflow-x-clip overflow-y-visible"
        data-virtual-desk={virtualizeDesk ? "1" : "0"}
      >
          {sortedCalendarRows.length === 0 ? (
            <p className="text-[11px] text-ink-muted leading-snug mb-2">
              {it
                ? `Nessun catalyst entro ${DESK_CALENDAR_HORIZON_DAYS} giorni e nessuna ★ rossa.`
                : `No catalyst inside ${DESK_CALENDAR_HORIZON_DAYS} days, and no red ★.`}
            </p>
          ) : displayCalendarRows.length === 0 ? (
            <p className="text-[11px] text-ink-muted leading-snug mb-2">
              {it
                ? `Nessun ticker o società corrisponde a “${tickerQuery.trim()}”.`
                : `No ticker or company matches “${tickerQuery.trim()}”.`}
            </p>
          ) : (
          <table className="w-full max-w-full min-w-0 table-fixed text-[10px] border-collapse">
            <colgroup>
              {deskColWidths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[2] bg-[rgb(var(--surface-elevated))] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
              <tr className="text-[9px] uppercase tracking-[0.04em] text-ink-muted text-center border-b border-[rgb(var(--border))]/50">
                <th className={DESK_TH_LEFT}>
                  <SortColHeader
                    col="ticker"
                    topic="ticker"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    align="left"
                    it={it}
                  >
                    Ticker
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="productDesig"
                    topic="productDesig"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    {it ? "Prodotto" : "Product"}
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="newsScores"
                    topic="newsScores"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Daily Score
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="event"
                    topic="event"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    {it ? "Evento" : "Event"}
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="day"
                    topic="day"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    {it ? "Giorni" : "Days"}
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="bias"
                    topic="bias"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Momentum
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="trends"
                    topic="trends"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    G-Trends
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="vol"
                    topic="vol"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Vol
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="diverge"
                    topic="diverge"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Conviction
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="ivr"
                    topic="ivr"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Expect.
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="skew"
                    topic="skew"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Skew
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="short"
                    topic="short"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Short Δ
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="vsxbi"
                    topic="vsxbi"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    vs XBI
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="d1h"
                    topic="d1h"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Δ visit
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="d24"
                    topic="d24"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Δ24h
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="premkt"
                    topic="premkt"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    Last Order
                  </SortColHeader>
                </th>
                <th className={DESK_CHIP_TH}>
                  <SortColHeader
                    col="accum"
                    topic="accum"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    align="center"
                    it={it}
                  >
                    Insider
                  </SortColHeader>
                </th>
                <th className={DESK_CHIP_TH}>
                  <SortColHeader
                    col="gov"
                    topic="gov"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    align="center"
                    it={it}
                  >
                    Exec Exit
                  </SortColHeader>
                </th>
                <th className={DESK_TH}>
                  <SortColHeader
                    col="fda"
                    topic="fda"
                    sortKey={deskSort.key}
                    sortDir={deskSort.dir}
                    onSort={toggleDeskSort}
                    onLegend={setColumnLegend}
                    it={it}
                  >
                    FDA Brief
                  </SortColHeader>
                </th>
                {showAdminRecCol ? (
                  <th className={DESK_TH}>
                    <SortColHeader
                      col="rec"
                      topic="rec"
                      sortKey={deskSort.key}
                      sortDir={deskSort.dir}
                      onSort={toggleDeskSort}
                      onLegend={setColumnLegend}
                      it={it}
                    >
                      Rec
                    </SortColHeader>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody data-desk-row-count={displayCalendarRows.length}>
              {virtualizeDesk && deskScrollEl ? (
                <VirtualTablePadRow
                  height={deskVirtual.paddingTop}
                  colSpan={deskColSpan}
                />
              ) : null}
              {deskRowsToRender.map(({ row, index }) => {
                const tk = row.ticker.trim().toUpperCase();
                const simRow =
                  resolveSimRowForDeskEvent(simTable?.rows as Record<string, unknown>[] | undefined, {
                    ticker: row.ticker,
                    rowKey: row.rowKey,
                    eventDate: row.eventDate,
                  }) ?? simByTicker.get(row.ticker);
                const fdaHit =
                  fdaHitByTickerDate.get(`${tk}|${String(row.eventDate || "").slice(0, 10)}`) ??
                  null;
                const companyFallback = companyFallbackByTicker.get(tk) ?? null;
                const productDesig = resolveDeskProductDesig({
                  ticker: row.ticker,
                  rowProduct: row.product,
                  simRow,
                  clinicalRecords: clinicalByTicker.get(tk) ?? [],
                  guidanceEvents: guidanceByTicker.get(tk) ?? [],
                  fda: fdaDesigByTicker[tk] ?? null,
                  news: newsDesigByTicker[tk] ?? null,
                });
                return (
                  <HomeSignalsDeskRow
                    key={row.key}
                    row={row}
                    virtualIndex={virtualizeDesk ? index : undefined}
                    measureElement={virtualizeDesk ? measureDeskRow : undefined}
                    it={it}
                    liveSession={liveSession}
                    simRow={simRow}
                    companyFallback={companyFallback}
                    productLabel={productDesig.product}
                    designationLabel={productDesig.designation}
                    newsScores={newsScoresByTicker[tk] ?? null}
                    live={deskLive}
                    priorSessionPct={
                      priorPctForOps?.get(row.ticker) ??
                      priorPctForOps?.get(tk) ??
                      null
                    }
                    fdaHit={fdaHit}
                    isNewToday={newTodayTickers.has(tk)}
                    trendsLoading={trendsLoading}
                    eventVolLoading={eventVolLoading}
                    shortInterestLoading={shortInterestLoading}
                    accumLoading={accumLoading}
                    vsXbiLoading={vsXbiLoading}
                    preMktLoading={preMktLoading}
                    showRecCol={showAdminRecCol}
                    recLabel={
                      showAdminRecCol
                        ? formatDeskRecLabel(recByTicker.get(tk), it)
                        : undefined
                    }
                    recToneClass={
                      showAdminRecCol
                        ? suggestedActionToneClass(
                            recByTicker.get(tk)?.action ?? "none",
                            recByTicker.get(tk)?.hasPosition ?? false,
                          )
                        : undefined
                    }
                    recTitle={
                      showAdminRecCol
                        ? it
                          ? "Raccomandazione operativa (Soft BUY/SELL) — solo admin"
                          : "Operational recommendation (Soft BUY/SELL) — admin only"
                        : undefined
                    }
                    onOpenTopKpi={openTopKpiRow}
                    onOpenEventRef={openEventRef}
                    onOpenBriefing={openBriefingStable}
                    onOpenProduct={() =>
                      openProductBriefing({
                        ticker: row.ticker,
                        company: companyFallback,
                        productLabel: productDesig.product,
                        designationLabel: productDesig.designation,
                        simRow,
                      })
                    }
                    clinicalRecords={clinicalRecords}
                  />
                );
              })}
              {virtualizeDesk && deskScrollEl ? (
                <VirtualTablePadRow
                  height={deskVirtual.paddingBottom}
                  colSpan={deskColSpan}
                />
              ) : null}
            </tbody>
          </table>
          )}

      </div>

      <EventVolLegendModal
        topic={columnLegend}
        it={it}
        onClose={() => setColumnLegend(null)}
      />
      <DeskReferenceModal
        doc={refDoc}
        it={it}
        onClose={() => setRefDoc(null)}
      />
      {openBriefing ? (
        <FdaAdcomBriefingModal
          row={openBriefing}
          it={it}
          onClose={() => setOpenBriefing(null)}
        />
      ) : null}
      {productModal ? (
        <ProductBriefingModal
          open
          it={it}
          ticker={productModal.ticker}
          company={productModal.company}
          designation={productModal.designation}
          nctId={productModal.nctId}
          briefing={productModal.briefing}
          onClose={() => setProductModal(null)}
        />
      ) : null}
    </section>
  );
}
