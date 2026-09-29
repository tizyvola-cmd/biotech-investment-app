import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useInViewOnce } from "../hooks/useInViewOnce";
import { fetchProjectJson } from "../data/projectData";
import {
  getMcsForDate,
  loadMarketContextSnapshot,
  type MarketContextSnapshotDoc,
} from "../sheet/marketContextScore";
import {
  type SimOutcomeRow,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";
import { linearRegressionOLS, linearRegressionTheilSen, partialPearsonR, pearsonR, spearmanR, correlationTwoTailedPValue, fisherZ95Ci, formatFisherCi } from "../sheet/statSignificance";
import {
  CORR_UNMEASURED_N,
  directionalCorrOnRows,
  excludePplanPlaceholders,
  scoreTertileSpread,
  summarizeScoreOutcomeCorr,
  type ScoreTertileSpread,
} from "../sheet/scorePnlCorrelation";
import { loadInvestSimHistory, loadInvestSimInputs, resolveInvestedAt } from "../sheet/investSimStorage";
import { normalizeCompletionDateForKey } from "../sheet/investSimKeys";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import {
  LOSS_ENTRY_THRESHOLD_PCT,
  deriveCauseInputFromSdsRow,
  computeRescueScoreBreakdown,
  computeRescueScoreExtendedBreakdown,
  computeEisFeedWindowScore,
} from "../sheet/lossRescueEngine";
import { readLocalSdsSnapshot, type SdsRow as SdsRowType, fetchRegulatoryRiskSnapshot, type RegulatoryRiskSnapshot, type ClinicalPreCdRecord } from "../api/supernova";
import { listMonitoredAssets, type MonitoredAsset } from "../sheet/catalystAnalysisStore";
import { buildRegulatoryRiskIndex, resolveRegulatoryScore } from "../sheet/regulatoryRiskIndex";
import { buildTickerPhaseMap } from "../sheet/simRowClinicalMeta";
import { hydrateClinicalPreCdRecords } from "../sheet/clinicalPreCdSnapshotCache";
import { useLang } from "../shared/i18n";
import { stockMove3dPctAfterAssignment } from "../sheet/mcsEntryMove3d";
import {
  buildEisFeedEventPoints,
  enrichEntryRowsWithForward3d,
  readoutPointToMini,
  type EntryReadoutRow,
} from "../sheet/readoutForwardMoveValidation";
import { readFrozenFeatureStoreSnapshot, type FrozenEntryFeatures } from "../calibration/featureSnapshotStore";
import { AppModal, AppModalCloseButton } from "./AppModal";
import {
  hydrateResilienceSnapshot,
  lookupResilienceForTicker,
  getResilienceSnapshotMeta,
  RESILIENCE_SNAPSHOT_UPDATED_EVENT,
  type ResilienceEntryDoc,
} from "../sheet/resilienceScoreData";
import { ResilienceScoreDetailModal } from "./ResilienceScoreDetailModal";

const OUTCOMES_FILE = "investment_sim_outcomes.json";
const SIM_SHEET_FILE = "simulation_sheet_snapshot.json";

/**
 * "Loss space" threshold for the Rescue Score cohort.
 *
 * Historically we used strict losses only (`pnl < -2%`). That kept the Rescue
 * Score card stuck at n=6, permanently below `CORR_UNMEASURED_N=8`, so the
 * card was always "Unmeasured — sample too small". Widening to `pnl <= 0`
 * includes break-even deals (which are still non-profitable outcomes the
 * rescue signal should predict) and roughly doubles the sample without
 * changing the underlying question. Sublabel of the card is updated
 * accordingly ("Recovery for loss & break-even positions").
 */
const LOSS_COHORT_PNL_PCT_MAX = 0;
const isLossPnl = (pnl: number): boolean => pnl <= LOSS_COHORT_PNL_PCT_MAX;

// ── Types ────────────────────────────────────────────────────────────────────

/** Row shape from simulation_sheet_snapshot.json — only the fields we need. */
type SimSheetRow = Record<string, unknown>;
type SimSheetSnapshot = { rows?: SimSheetRow[] };

function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type CompRow = {
  ticker: string;
  pplan: number;
  sds: number | null;
  rescueScore: number;
  /** Diagnostic score on all positions — Loss depth = 0 when pnl ≥ 0. */
  rescueScoreExtended: number;
  /** Entry-time rescue for validation scatter — loss depth fixed at 0 (no circular P&L). */
  rescueScoreEntry: number;
  rescueScoreExtendedEntry: number;
  /** Resilience Score — intrinsic recovery+growth per ticker (see
   *  prediction/resilience_score.py). Null / omitted when the snapshot
   *  has no entry for this ticker (short history, missing price cache,
   *  snapshot not yet generated, etc.). Enriched post-hoc in a useMemo
   *  from the `resilienceIndex` state; row builders leave it undefined. */
  resilienceScore?: number | null;
  pnl: number;
  /** Y-axis outcome kind — portfolio uses entry P&L; sim opportunities may use 1M % proxy. */
  yMetric?: "final_pnl" | "entry_pnl" | "var1m_proxy";
  isWin: boolean;
  isLoss: boolean;
  /** True for open positions still in loss — not closed trades. P&L is current running value, not final. */
  isOpen?: boolean;
  /** Signed regulatory score −100…+100 (favorable → risk). */
  regulatoryScore: number | null;
  /** Real portfolio positions only (sim loop removed). */
  universe?: "portafoglio";
  /** True when entryProbPct was null in invest_sim_inputs and no outcomes lookup matched — X=50 is a placeholder. */
  pplanIsDefault?: boolean;
  /** EIS cumulative feed score (~−50…+50). null = no events in the feed window. */
  eisScore: number | null;
  /** MCS global at entry date (market context snapshot). */
  mcsAtEntry?: number | null;
  /** Row key TICKER|CD — portfolio history / MCS assignment. */
  rowKey?: string | null;
  /** ISO timestamp when MCS was assigned (entry / invest date). */
  mcsAssignmentIso?: string | null;
  /** Stock move % over 3 trading days after MCS assignment (not full trade P&L). */
  stockMove3dPct?: number | null;
  /** Original outcome row for detail drill-down. */
  raw?: SimOutcomeRow;
  /** True when SDS comes from entry_sds_score or frozen features — not live snapshot. */
  sdsAtEntry?: boolean;
};

type MiniScatterPt = {
  x: number;
  y: number;
  ticker: string;
  isWin: boolean;
  isOpen?: boolean;
  universe?: string;
  /** MCS global on position entry date — Rescue chart aura. */
  mcsAtEntry?: number | null;
  /** Original outcome row for detail drill-down. */
  raw?: SimOutcomeRow;
};

function mcsAuraStroke(mcs: number | null | undefined): string | null {
  if (mcs == null || !Number.isFinite(mcs)) return null;
  if (mcs > 65) return "#f97316";
  if (mcs < 35) return "#3b82f6";
  return null;
}

function WinLossScatterDot({
  cx,
  cy,
  payload,
}: {
  cx?: number;
  cy?: number;
  payload?: MiniScatterPt;
}) {
  const x = cx ?? 0;
  const y = cy ?? 0;
  const color = payload?.isWin ? "#10b981" : "#f43f5e";
  const ring = mcsAuraStroke(payload?.mcsAtEntry);
  return (
    <g>
      {ring ? (
        <circle cx={x} cy={y} r={7} fill="none" stroke={ring} strokeWidth={2} strokeOpacity={0.55} />
      ) : null}
      <circle cx={x} cy={y} r={4} fill={color} fillOpacity={0.75} stroke={color} strokeWidth={1} />
    </g>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Same column layout for Chart 1, 2 & 3 — five equal cards spanning full row width. */
const SCATTER_CHART_HEIGHT_PX = 260;
/** Regulatory score chart X domain (−100…+100, zoomed to practical range). */
const REGULATORY_SCORE_X_MIN = -50;
const REGULATORY_SCORE_X_MAX = 50;
/** Fixed card height — header + chart + footer; all scatter cards share this. */
const SCATTER_CARD_HEIGHT_PX = 400;
const FIVE_COL_SCATTER_GRID =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 w-full [&>*]:min-w-0 [&>*]:w-full [&>*]:max-w-none [&>*]:h-full";
const modelScatterGridStyle = { gridAutoRows: `${SCATTER_CARD_HEIGHT_PX}px` };
const SCATTER_CARD_SHELL =
  "rounded-lg border border-[rgb(var(--border))]/50 bg-white/80 p-3 flex flex-col gap-2 min-w-0 w-full h-full overflow-hidden";
const SCATTER_HEADER_CLASS = "shrink-0 h-[5rem] overflow-hidden";

/** Axis tick — max 1 decimal, strips float noise (e.g. 60.480000000000004 → 60.5). */
function formatScatterAxisTick(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function formatScatterAxisTickPct(v: number): string {
  const n = Math.round(v * 10) / 10;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

type ScatterUniverseView = "all" | "portfolio";

function ScatterUniverseSwitcher({
  value,
  onChange,
}: {
  value: ScatterUniverseView;
  onChange: (v: ScatterUniverseView) => void;
}) {
  return (
    <div className="flex gap-1 shrink-0" role="group" aria-label="Data universe">
      {(["all", "portfolio"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2 py-0.5 rounded text-[9px] font-medium border transition-colors ${
            value === v
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-white text-ink-muted border-[rgb(var(--border))]/50 hover:bg-indigo-50"
          }`}
        >
          {v === "all" ? "All" : "Portfolio"}
        </button>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB");
  } catch {
    return d;
  }
}

function rescoreApprox(pplan: number, pnl: number): number {
  // Simplified formula (no EIS / cause attribution data available in outcomes)
  // Matches computeRescueScoreBreakdown scaling: P(plan) max 40, loss max 20
  const probPt = clamp(pplan - 30, 0, 40);
  const lossPt = pnl < 0 ? clamp(Math.abs(pnl) * 0.7, 0, 20) : 0;
  return Math.round(probPt + lossPt);
}

/** Shared caches — hydrate clinical feed + catalyst assets once per panel load. */
type ModelComparisonBuildCtx = {
  lang: "it" | "en";
  regSnap: RegulatoryRiskSnapshot | null;
  phaseMap: Map<string, string> | null;
  sdsMap: Map<string, SdsRowType> | null;
  clinicalRecords: ClinicalPreCdRecord[];
  assetByTicker: Map<string, MonitoredAsset>;
  frozenStore: Record<string, FrozenEntryFeatures>;
  eisCache: Map<string, number | null>;
  regCache: Map<string, number | null>;
};

function createModelComparisonBuildCtx(args: {
  lang: "it" | "en";
  regSnap: RegulatoryRiskSnapshot | null;
  phaseMap: Map<string, string> | null;
  sdsMap: Map<string, SdsRowType> | null;
}): ModelComparisonBuildCtx {
  const assetByTicker = new Map<string, MonitoredAsset>();
  for (const asset of listMonitoredAssets()) {
    assetByTicker.set(asset.ticker.toUpperCase(), asset);
  }
  return {
    ...args,
    clinicalRecords: hydrateClinicalPreCdRecords(),
    assetByTicker,
    frozenStore: readFrozenFeatureStoreSnapshot(),
    eisCache: new Map(),
    regCache: new Map(),
  };
}

function ctxEisScore(ctx: ModelComparisonBuildCtx, ticker: string): number | null {
  const tk = ticker.trim().toUpperCase();
  if (ctx.eisCache.has(tk)) return ctx.eisCache.get(tk)!;
  const score = computeEisFeedWindowScore(
    ticker,
    ctx.lang,
    null,
    null,
    ctx.clinicalRecords,
  );
  ctx.eisCache.set(tk, score);
  return score;
}

/**
 * EIS score for a CLOSED sim deal — aggregates only EIS events in the
 * pre-CD window `[CD − 90d, CD]` for the ticker. Matches the pre-CD framing
 * used by SDS so the two scores are directly comparable in the correlation
 * table. Falls back to the default (last-14-days) `ctxEisScore` when the CD
 * date is missing or unparseable.
 *
 * Rationale: `ctxEisScore` uses a rolling "today − 14d" window which is
 * *meaningless* when correlated against past trade P&L (the events used to
 * compute the score happened weeks after the deal closed). Passing the
 * historical CD as `windowEndIso` ensures the score reflects only events
 * that were observable BEFORE the catalyst.
 */
function ctxEisScoreForClosedDeal(
  ctx: ModelComparisonBuildCtx,
  ticker: string,
  cdIsoInput: string | null | undefined,
): number | null {
  if (!cdIsoInput) return ctxEisScore(ctx, ticker);
  const cdIso = normalizeCompletionDateForKey(cdIsoInput);
  if (!cdIso || cdIso === "—" || !/^\d{4}-\d{2}-\d{2}$/.test(cdIso)) {
    return ctxEisScore(ctx, ticker);
  }
  const tk = ticker.trim().toUpperCase();
  const cacheKey = `${tk}|preCD90|${cdIso}`;
  if (ctx.eisCache.has(cacheKey)) return ctx.eisCache.get(cacheKey)!;

  const cdMs = Date.parse(`${cdIso}T12:00:00`);
  if (!Number.isFinite(cdMs)) return ctxEisScore(ctx, ticker);
  const startIso = new Date(cdMs - 90 * 86_400_000).toISOString().slice(0, 10);

  const score = computeEisFeedWindowScore(
    ticker,
    ctx.lang,
    startIso,
    null,
    ctx.clinicalRecords,
    cdIso,
  );
  ctx.eisCache.set(cacheKey, score);
  return score;
}

function ctxRegScore(ctx: ModelComparisonBuildCtx, ticker: string): number | null {
  const tk = ticker.trim().toUpperCase();
  if (ctx.regCache.has(tk)) return ctx.regCache.get(tk)!;
  const asset = ctx.assetByTicker.get(tk) ?? null;
  const manualIdx = asset ? buildRegulatoryRiskIndex(asset) : null;
  const autoSig = ctx.regSnap?.tickers?.[tk] ?? null;
  const score = resolveRegulatoryScore({
    manualIdx,
    autoSig,
    clinicalPhase: ctx.phaseMap?.get(tk) ?? null,
  });
  ctx.regCache.set(tk, score);
  return score;
}

async function loadRegulatorySnapshot(): Promise<RegulatoryRiskSnapshot | null> {
  try {
    const snap = await fetchRegulatoryRiskSnapshot();
    if (snap?.tickers && Object.keys(snap.tickers).length) return snap;
  } catch {
    /* API optional */
  }
  try {
    const { data } = await fetchProjectJson<RegulatoryRiskSnapshot>("regulatory_risk_snapshot.json");
    if (data?.tickers && Object.keys(data.tickers).length) return data;
  } catch {
    /* file optional */
  }
  return null;
}

/** Full rescue score using SDS data for open positions. */
function rescoreWithSds(
  pplan: number,
  pnl: number,
  ticker: string,
  ctx: ModelComparisonBuildCtx,
): number {
  if (pnl >= 0) return rescoreApprox(pplan, pnl);
  const sdsRow = ctx.sdsMap?.get(ticker.trim().toUpperCase()) ?? null;
  const causeInput = deriveCauseInputFromSdsRow(sdsRow);
  const eisScore = ctxEisScore(ctx, ticker);
  const bd = computeRescueScoreBreakdown({
    ticker,
    entryProbPct: pplan,
    lastMarkPct: pnl,
    eisWindowScore: eisScore,
    causeAttribution: causeInput,
  });
  return bd.rescoreScore;
}

/** Extended diagnostic rescue score — all positions, Loss depth = 0 when pnl ≥ 0. */
function rescoreExtended(
  pplan: number,
  pnl: number,
  ticker: string,
  ctx: ModelComparisonBuildCtx,
): number {
  const sdsRow = ctx.sdsMap?.get(ticker.trim().toUpperCase()) ?? null;
  const causeInput = deriveCauseInputFromSdsRow(sdsRow);
  const eisScore = ctxEisScore(ctx, ticker);
  return computeRescueScoreExtendedBreakdown({
    ticker,
    entryProbPct: pplan,
    lastMarkPct: pnl,
    eisWindowScore: eisScore,
    causeAttribution: causeInput,
  }).rescoreScore;
}

/** Entry-time rescue for validation scatter — excludes current P&L from loss depth. */
function rescoreEntryValidation(
  pplan: number,
  ticker: string,
  ctx: ModelComparisonBuildCtx,
): number {
  const sdsRow = ctx.sdsMap?.get(ticker.trim().toUpperCase()) ?? null;
  const causeInput = deriveCauseInputFromSdsRow(sdsRow);
  const eisScore = ctxEisScore(ctx, ticker);
  return computeRescueScoreBreakdown({
    ticker,
    entryProbPct: pplan,
    lastMarkPct: 0,
    eisWindowScore: eisScore,
    causeAttribution: causeInput,
  }).rescoreScore;
}

function rescoreExtendedEntryValidation(
  pplan: number,
  ticker: string,
  ctx: ModelComparisonBuildCtx,
): number {
  const sdsRow = ctx.sdsMap?.get(ticker.trim().toUpperCase()) ?? null;
  const causeInput = deriveCauseInputFromSdsRow(sdsRow);
  const eisScore = ctxEisScore(ctx, ticker);
  return computeRescueScoreExtendedBreakdown({
    ticker,
    entryProbPct: pplan,
    lastMarkPct: 0,
    eisWindowScore: eisScore,
    causeAttribution: causeInput,
  }).rescoreScore;
}

function rescueFieldsForRow(
  pplan: number,
  pnl: number,
  ticker: string,
  ctx: ModelComparisonBuildCtx,
): Pick<CompRow, "rescueScore" | "rescueScoreExtended" | "rescueScoreEntry" | "rescueScoreExtendedEntry"> {
  return {
    rescueScore: rescoreWithSds(pplan, pnl, ticker, ctx),
    rescueScoreExtended: rescoreExtended(pplan, pnl, ticker, ctx),
    rescueScoreEntry: rescoreEntryValidation(pplan, ticker, ctx),
    rescueScoreExtendedEntry: rescoreExtendedEntryValidation(pplan, ticker, ctx),
  };
}

function compRowToScatterPt(
  r: CompRow,
  x: number,
  mcsDoc?: MarketContextSnapshotDoc | null,
): MiniScatterPt {
  const entryRaw = r.raw?.entry_ts ?? r.raw?.completion_date ?? null;
  const mcsAtEntry =
    r.mcsAtEntry ??
    (mcsDoc
      ? (entryRaw ? getMcsForDate(mcsDoc, entryRaw)?.mcs_global : mcsDoc.latest?.mcs_global) ?? null
      : null);
  return {
    x,
    y: r.pnl,
    ticker: r.ticker,
    isWin: r.isWin,
    isOpen: r.isOpen,
    universe: r.universe,
    mcsAtEntry,
    raw: r.raw,
  };
}

function compRowToMiniPt(r: CompRow, x: number, y?: number): MiniScatterPt {
  const yVal = y ?? r.pnl;
  return {
    x,
    y: yVal,
    ticker: r.ticker,
    isWin: yVal >= 0,
    isOpen: r.isOpen,
    universe: r.universe,
    raw: r.raw,
    mcsAtEntry: r.mcsAtEntry,
  };
}

/** Minimum n for Pearson r in correlation summary (pearsonR allows n≥3). */
const CORR_SUMMARY_MIN_N = 3;

type WinRateHighResult = { pct: number; threshold: number; n: number };

function corrOnRows(
  pts: CompRow[],
  x: (r: CompRow) => number | null,
  minN = CORR_SUMMARY_MIN_N,
): number | null {
  const valid = pts.filter((r) => x(r) != null);
  return valid.length >= minN
    ? pearsonR(valid.map((r) => x(r)!), valid.map((r) => r.pnl))
    : null;
}

function winRateAtThreshold(
  rows: CompRow[],
  score: (r: CompRow) => number | null,
  lo: number,
  hi: number,
  minBucket = 2,
): WinRateHighResult | null {
  const bucket = rows.filter((r) => {
    const v = score(r);
    return v != null && v >= lo && v < hi;
  });
  if (bucket.length < minBucket) return null;
    return {
    pct: Math.round((bucket.filter((r) => r.isWin).length / bucket.length) * 100),
    threshold: lo,
    n: bucket.length,
  };
}

/** Win rate in highest score bucket — relax threshold until n≥2. */
function winRateAdaptiveHigh(
  rows: CompRow[],
  score: (r: CompRow) => number | null,
  thresholds: number[],
  minBucket = 2,
): WinRateHighResult | null {
  for (const th of thresholds) {
    const hit = winRateAtThreshold(rows, score, th, 101, minBucket);
    if (hit) return hit;
  }
  return null;
}

function winRateHighLabel(w: WinRateHighResult | null, fallback = 75): string {
  if (!w) return `Win≥${fallback}`;
  return w.threshold === fallback ? `Win≥${fallback}` : `Win≥${w.threshold}`;
}

// ── Mini scatter panel ───────────────────────────────────────────────────────

function MiniScatter({
  title,
  note,
  pts,
  openPts,
  noSignalPts,
  xLabel,
  nTotal,
  rhoUp,
  rhoDown,
  xMin = 0,
  xMax = 100,
  minPts = 3,
  smallSampleThreshold = 10,
  onOpenDetails,
}: {
  title: string;
  note?: string;
  pts: MiniScatterPt[];
  openPts?: MiniScatterPt[];
  /** score=0 evaluated tickers — shown as small gray dots at x=0 */
  noSignalPts?: MiniScatterPt[];
  xLabel: string;
  nTotal?: number;
  rhoUp?: number | null;
  rhoDown?: number | null;
  xMin?: number;
  xMax?: number;
  minPts?: number;
  /** When n < threshold, show reduced-sample warning next to r. */
  smallSampleThreshold?: number;
  onOpenDetails?: () => void;
}) {
  const n = pts.length;
  const smallSample = n > 0 && n < smallSampleThreshold;
  // Threshold uses ALL evaluated pts (signal + no-signal), not just signal pts
  const nEvaluated = n + (noSignalPts?.length ?? 0);
  const rho =
    n >= 5
      ? pearsonR(
          pts.map((p) => p.x),
          pts.map((p) => p.y),
        )
      : null;
  // Two overlays: robust Theil-Sen line (primary, coloured) + dashed grey
  // OLS line (secondary). On small scatters (n ~ 15-30) OLS can be dragged
  // by 1-2 high-leverage points, producing a steep line that decouples
  // from the Pearson r shown in the header. Showing both lets the reader
  // see how much the fit depends on outliers — when they overlap, the
  // relationship is robust; when they diverge, the OLS signal was noise.
  const xsPts = pts.map((p) => p.x);
  const ysPts = pts.map((p) => p.y);
  const regression = n >= 3 ? linearRegressionTheilSen(xsPts, ysPts) : null;
  const regressionOls = n >= 3 ? linearRegressionOLS(xsPts, ysPts) : null;
  const regLineColor =
    rho != null
      ? rho >= 0.3
        ? "#059669"
        : rho <= -0.3
          ? "#e11d48"
          : "#6366f1"
      : "#6366f1";
  const topHalf = pts.filter((p) => p.x >= xMax / 2);
  const winRateTop =
    topHalf.length >= 3
      ? Math.round((topHalf.filter((p) => p.y > 0).length / topHalf.length) * 100)
      : null;

  const allPts = [...pts, ...(openPts ?? []), ...(noSignalPts ?? [])];
  const ys = allPts.map((p) => p.y).filter(Number.isFinite);
  const yMin = ys.length ? Math.min(...ys) : -20;
  const yMax = ys.length ? Math.max(...ys) : 20;
  const yPad = Math.max(4, (yMax - yMin) * 0.12);

  return (
    <div className={SCATTER_CARD_SHELL}>
      <div className={SCATTER_HEADER_CLASS}>
        <div className="flex items-start justify-between gap-1 h-full">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-[11px] font-semibold text-ink leading-tight truncate" title={title}>
              {title}
            </p>
            {note ? (
              <p
                className="text-[9px] text-amber-600/80 leading-tight line-clamp-2 min-h-[2.5em] mt-0.5"
                title={note}
              >
                {note}
              </p>
            ) : (
              <span className="block min-h-[2.5em]" aria-hidden />
            )}
        </div>
          <div className="flex flex-col items-end gap-0.5 text-[9px] text-ink-muted shrink-0 w-[42%] min-w-0 overflow-hidden">
          {rho != null && (
            <span title="Pearson r — correlation: score vs P&L">
              r{" "}
              <strong
                className={`tabular-nums ${
                  smallSample
                    ? "text-amber-500"
                    : rho >= 0.3
                    ? "text-emerald-600"
                    : rho <= -0.3
                      ? "text-rose-500"
                      : "text-amber-500"
                }`}
              >
                {rho.toFixed(2)}
              </strong>
              {smallSample ? (
                <span className="text-amber-600 ml-0.5" title="Small sample — result not yet robust">
                  ⚠
                </span>
              ) : null}
            </span>
          )}
          {rhoUp != null && (
            <span title="r↑ — correlation among gains only">
              r↑{" "}
              <strong className={`tabular-nums ${rhoUp >= 0.3 ? "text-emerald-600" : rhoUp >= 0.1 ? "text-amber-500" : "text-ink-muted"}`}>
                {rhoUp >= 0 ? "+" : ""}{rhoUp.toFixed(2)}
              </strong>
            </span>
          )}
          {rhoDown != null && (
            <span title="r↓ — correlation among losses only (positive = higher score → smaller loss)">
              r↓{" "}
              <strong className={`tabular-nums ${rhoDown >= 0.3 ? "text-emerald-600" : rhoDown < 0 ? "text-rose-500" : "text-amber-500"}`}>
                {rhoDown >= 0 ? "+" : ""}{rhoDown.toFixed(2)}
              </strong>
            </span>
          )}
          {winRateTop != null && (
            <span title={`Win rate when score ≥${Math.round(xMax / 2)}`}>
              W≥{Math.round(xMax / 2)}:{" "}
              <strong className="text-ink tabular-nums">{winRateTop}%</strong>
            </span>
          )}
          <span>
            n=<strong className="text-ink tabular-nums">{nTotal ?? n}</strong>
          </span>
          </div>
        </div>
      </div>

      {nEvaluated < minPts ? (
        <div
          className="flex items-center justify-center shrink-0 w-full"
          style={{ height: SCATTER_CHART_HEIGHT_PX }}
        >
          <p className="text-[10px] text-ink-muted text-center">Insufficient data (n={nEvaluated})</p>
        </div>
      ) : (
        <div className="shrink-0 w-full" style={{ height: SCATTER_CHART_HEIGHT_PX }}>
        <ResponsiveContainer width="100%" height={SCATTER_CHART_HEIGHT_PX}>
          <ComposedChart margin={{ top: 6, right: 8, bottom: 22, left: 6 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[xMin, xMax]}
              tick={{ fontSize: 9 }}
              tickFormatter={(v: number) => formatScatterAxisTick(v)}
              label={{
                value: xLabel,
                position: "bottom",
                offset: 12,
                style: { fontSize: 9, fill: "#94a3b8" },
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[yMin - yPad, yMax + yPad]}
              tick={{ fontSize: 9 }}
              tickFormatter={formatScatterAxisTickPct}
              width={40}
            />
            <ZAxis range={[32, 32]} />
            <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
            {regressionOls?.line.length === 2 ? (
              <Line
                data={regressionOls.line}
                type="linear"
                dataKey="y"
                stroke="#94a3b8"
                strokeWidth={1.25}
                strokeDasharray="4 3"
                strokeOpacity={0.7}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            ) : null}
            {regression?.line.length === 2 ? (
              <Line
                data={regression.line}
                type="linear"
                dataKey="y"
                stroke={regLineColor}
                strokeWidth={2}
                strokeOpacity={0.85}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            ) : null}
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as MiniScatterPt | undefined;
                if (!p) return null;
                return (
                  <div className="rounded border border-[rgb(var(--border))]/60 bg-white px-2 py-1 text-[10px] shadow">
                    <p className="font-semibold">{p.ticker}</p>
                    <p>
                      {xLabel}: {p.x.toFixed(1)}
                    </p>
                    <p>
                      P&L: {p.y >= 0 ? "+" : ""}
                      {p.y.toFixed(1)}%
                    </p>
                    <p className="text-ink-muted">{p.isWin ? "win" : "loss"}</p>
                  </div>
                );
              }}
            />
            {/* Category 2: scanned, no signal — small gray dots at x=0 */}
            {noSignalPts && noSignalPts.length > 0 && (
              <Scatter
                data={noSignalPts}
                shape={(props: { cx?: number; cy?: number }) => (
                  <circle
                    cx={props.cx ?? 0}
                    cy={props.cy ?? 0}
                    r={2.5}
                    fill="#94a3b8"
                    fillOpacity={0.25}
                    stroke="#94a3b8"
                    strokeWidth={0.5}
                    strokeOpacity={0.4}
                  />
                )}
              />
            )}
            {/* Category 1: signal detected — colored dots */}
            <Scatter
              data={pts}
              shape={(props: { cx?: number; cy?: number; payload?: MiniScatterPt }) => (
                <WinLossScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
              )}
            />
            {openPts && openPts.length > 0 && (
              <Scatter
                data={openPts}
                shape={(props: { cx?: number; cy?: number }) => (
                  <circle
                    cx={props.cx ?? 0}
                    cy={props.cy ?? 0}
                    r={4}
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                  />
                )}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      )}
      {onOpenDetails && (
        <div className="flex justify-end mt-auto shrink-0 pt-1">
          <button
            type="button"
            onClick={onOpenDetails}
            className="px-2 py-0.5 rounded text-[9px] font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200/60 transition-colors"
          >
            Dettagli
          </button>
        </div>
      )}
    </div>
  );
}

/** Rescue scatter — Group A (operational rescue) + Group B (extended, not in loss). */
function RescueScoreScatter({
  title,
  note,
  xLabel,
  groupA,
  groupB,
  recoveryLabel,
  minPts = 2,
  compact = false,
  onOpenDetails,
}: {
  title: string;
  note?: string;
  xLabel: string;
  groupA: MiniScatterPt[];
  groupB: MiniScatterPt[];
  recoveryLabel: string;
  minPts?: number;
  /** Smaller chart for side-by-side universe panels. */
  compact?: boolean;
  onOpenDetails?: () => void;
}) {
  const nA = groupA.length;
  const nB = groupB.length;
  const allPts = [...groupA, ...groupB];
  const nEvaluated = allPts.length;
  const smallSampleRescue = nA > 0 && nA < 10;
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const r = nEvaluated >= 3 ? pearsonR(xs, ys) : null;
  const rho = nEvaluated >= 3 ? spearmanR(xs, ys) : null;
  const rhoP = rho != null && nEvaluated >= 3 ? correlationTwoTailedPValue(rho, nEvaluated) : null;
  const xObs = xs.filter(Number.isFinite);
  const xSpan =
    xObs.length >= 2
      ? { min: Math.min(...xObs), max: Math.max(...xObs) }
      : undefined;
  // Two overlays: robust Theil-Sen (primary) + dashed OLS (secondary,
  // grey) — see note on the primary MiniScatter regression. Showing both
  // lets the reader see how much OLS is dragged by outliers.
  const regression =
    nEvaluated >= 3 ? linearRegressionTheilSen(xs, ys, xSpan) : null;
  const regressionOls =
    nEvaluated >= 3 ? linearRegressionOLS(xs, ys, xSpan) : null;
  const regLineColor =
    r != null
      ? r >= 0.3
        ? "#059669"
        : r <= -0.3
          ? "#e11d48"
          : "#6366f1"
      : "#6366f1";

  const chartHeight = compact ? 160 : SCATTER_CHART_HEIGHT_PX;
  const cardShell = compact
    ? "rounded-lg border border-[rgb(var(--border))]/40 bg-white/70 p-2 flex flex-col gap-1 min-w-0 w-full h-full overflow-hidden"
    : SCATTER_CARD_SHELL;
  const headerClass = compact ? "shrink-0 h-[4rem] overflow-hidden" : SCATTER_HEADER_CLASS;

  const ysFin = allPts.map((p) => p.y).filter(Number.isFinite);
  const xMin = xObs.length ? Math.min(...xObs) : 0;
  const xMax = xObs.length ? Math.max(...xObs) : 100;
  const xPad = Math.max(4, (xMax - xMin) * 0.08);
  const yMin = ysFin.length ? Math.min(...ysFin) : -20;
  const yMax = ysFin.length ? Math.max(...ysFin) : 20;
  const yPad = Math.max(4, (yMax - yMin) * 0.12);

  const corrClass = (v: number | null) =>
    v == null
      ? "text-ink-muted"
      : v >= 0.3
        ? "text-emerald-600"
        : v <= -0.3
          ? "text-rose-500"
          : "text-amber-500";

  return (
    <div className={cardShell}>
      <div className={headerClass}>
        <div className="flex items-start justify-between gap-1 h-full">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p
              className={`${compact ? "text-[10px]" : "text-[11px]"} font-semibold text-ink leading-tight truncate`}
              title={title}
            >
              {title}
            </p>
            <p
              className="text-[9px] text-ink-muted leading-tight line-clamp-2 min-h-[2em] mt-0.5"
              title={[recoveryLabel, note, "● rescue space · ◇ extended (≥ −2%)"].filter(Boolean).join(" · ")}
            >
              <span className="text-rose-600/90">{recoveryLabel}</span>
              {note ? <span className="text-amber-600/80"> · {note}</span> : null}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[9px] text-ink-muted shrink-0 w-[46%] min-w-0 overflow-hidden">
            {r != null && (
              <span title="Pearson r — score vs P&L in subset">
                r{" "}
                <strong className={`tabular-nums ${corrClass(r)}`}>{r.toFixed(2)}</strong>
              </span>
            )}
            {rho != null && (
              <span title="Spearman ρ — robust to outliers">
                ρ{" "}
                <strong className={`tabular-nums ${corrClass(rho)}`}>
                  {rho.toFixed(2)}
                  {rhoP != null && rhoP < 0.05 ? "*" : ""}
                </strong>
              </span>
            )}
            {smallSampleRescue && (
              <span className="text-[8px] text-amber-600 text-right leading-tight">
                rescue n&lt;10
              </span>
            )}
            <span>
              ●<strong className="text-ink tabular-nums">{nA}</strong>
              {nB > 0 ? (
                <span className="text-ink-muted">
                  {" "}
                  ◇<strong className="text-sky-600 tabular-nums">{nB}</strong>
                </span>
              ) : null}
              <span className="text-ink-muted"> / {nEvaluated}</span>
            </span>
          </div>
        </div>
      </div>

      {nEvaluated < minPts ? (
        <div
          className="flex items-center justify-center shrink-0 w-full"
          style={{ height: chartHeight }}
        >
          <p className="text-[10px] text-ink-muted text-center">Insufficient data (n={nEvaluated})</p>
        </div>
      ) : (
        <div className="shrink-0 w-full" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ComposedChart margin={{ top: 6, right: 8, bottom: 22, left: 6 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[xMin - xPad, xMax + xPad]}
                tick={{ fontSize: 9 }}
                tickFormatter={(v: number) => formatScatterAxisTick(v)}
                label={{
                  value: xLabel,
                  position: "bottom",
                  offset: 12,
                  style: { fontSize: 9, fill: "#94a3b8" },
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin - yPad, yMax + yPad]}
                tick={{ fontSize: 9 }}
                tickFormatter={formatScatterAxisTickPct}
                width={40}
              />
              <ZAxis range={[32, 32]} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
              {regressionOls?.line.length === 2 ? (
                <Line
                  data={regressionOls.line}
                  type="linear"
                  dataKey="y"
                  stroke="#94a3b8"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  strokeOpacity={0.7}
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              ) : null}
              {regression?.line.length === 2 ? (
                <Line
                  data={regression.line}
                  type="linear"
                  dataKey="y"
                  stroke={regLineColor}
                  strokeWidth={2}
                  strokeOpacity={0.85}
                  dot={false}
                  isAnimationActive={false}
                  legendType="none"
                />
              ) : null}
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as MiniScatterPt | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded border border-[rgb(var(--border))]/60 bg-white px-2 py-1 text-[10px] shadow">
                      <p className="font-semibold">{p.ticker}</p>
                      <p>
                        {xLabel}: {p.x.toFixed(1)}
                      </p>
                      <p>
                        P&L: {p.y >= 0 ? "+" : ""}
                        {p.y.toFixed(1)}%
                      </p>
                    </div>
                  );
                }}
              />
              {groupB.length > 0 && (
                <Scatter
                  data={groupB}
                  shape={(props: { cx?: number; cy?: number; payload?: MiniScatterPt }) => {
                    const cx = props.cx ?? 0;
                    const cy = props.cy ?? 0;
                    const color = props.payload?.isWin ? "#0ea5e9" : "#64748b";
                    const half = 4;
                    return (
                      <polygon
                        points={`${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`}
                        fill={color}
                        fillOpacity={0.45}
                        stroke={color}
                        strokeWidth={1}
                      />
                    );
                  }}
                />
              )}
              <Scatter
                data={groupA}
                shape={(props: { cx?: number; cy?: number; payload?: MiniScatterPt }) => (
                  <WinLossScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {onOpenDetails && !compact && (
        <div className="flex justify-end mt-auto shrink-0 pt-1">
          <button
            type="button"
            onClick={onOpenDetails}
            className="px-2 py-0.5 rounded text-[9px] font-medium bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200/60 transition-colors"
          >
            Dettagli
          </button>
        </div>
      )}
    </div>
  );
}


// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  sublabel,
  rho,
  rhoUp,
  rhoDown,
  rhoCi,
  winRateQ4,
  winRateLabel,
  n,
  nUp,
  nDown,
  color,
  note,
  cohortLabel,
  tertileSpread,
  unmeasured,
  onClick,
}: {
  label: string;
  sublabel: string;
  rho: number | null;
  rhoUp?: number | null;
  rhoDown?: number | null;
  rhoCi?: { lo: number; hi: number } | null;
  winRateQ4: number | null;
  winRateLabel?: string;
  n: number;
  nUp?: number;
  nDown?: number;
  color: string;
  note?: string;
  cohortLabel?: string;
  tertileSpread?: { spreadHighLow: number; spearman: number | null; lowMeanPnl: number; highMeanPnl: number } | null;
  unmeasured?: boolean;
  /** If provided, the whole card becomes a button that opens a details modal. */
  onClick?: () => void;
}) {
  const rhoColor = (v: number | null) =>
    v == null
      ? "text-ink-muted"
      : Math.abs(v) >= 0.3
        ? v >= 0 ? "text-emerald-600" : "text-rose-500"
        : Math.abs(v) >= 0.1
          ? "text-amber-600"
          : "text-ink-muted";

  const fmtR = (v: number | null) =>
    v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : "n/a";

  const Container = onClick ? "button" : "div";
  const containerProps = onClick
    ? {
        type: "button" as const,
        onClick,
        "aria-label": `${label} — open per-ticker breakdown`,
      }
    : {};

  return (
    <Container
      {...containerProps}
      className={`rounded-xl border border-[rgb(var(--border))]/50 bg-white/80 px-3 py-2.5 flex flex-col gap-1.5 flex-1 min-w-[130px] text-left ${
        onClick ? "cursor-pointer hover:bg-white hover:shadow-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500/40" : ""
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <p className="text-[11px] font-bold text-ink">
            {label}
            {onClick ? (
              <span
                className="ml-1 text-[9px] font-semibold text-sky-600 dark:text-sky-400"
                aria-hidden
              >
                ⓘ
              </span>
            ) : null}
          </p>
          <p className="text-[9px] text-ink-muted">{sublabel}</p>
          {cohortLabel ? (
            <p className="text-[8px] text-ink-muted/70 mt-0.5">{cohortLabel}</p>
          ) : null}
        </div>
        <span className="text-[9px] text-ink-muted/70 tabular-nums text-right">
          n={n}
          {nUp != null && nDown != null ? (
            <span className="block text-[8px]">↑{nUp} ↓{nDown}</span>
          ) : null}
        </span>
      </div>

      {unmeasured ? (
        <p className="text-[10px] font-semibold text-amber-700 leading-snug">
          {label === "Resilience Score"
            ? "Unmeasured — snapshot missing or too few scored tickers. Do not conclude."
            : "Unmeasured — do not conclude."}
        </p>
      ) : (
        <>
          {/* Primary: downside / upside decomposition */}
          {(rhoUp !== undefined || rhoDown !== undefined) && (
            <div className="flex items-end gap-3 border-b border-[rgb(var(--border))]/30 pb-1.5">
              <div className="flex items-baseline gap-1">
                <p className="text-[9px] text-emerald-600 shrink-0 font-semibold">r↑</p>
                <p className={`text-[15px] font-black tabular-nums leading-tight ${rhoColor(rhoUp ?? null)}`}>
                  {fmtR(rhoUp ?? null)}
                </p>
              </div>
              <div className="flex items-baseline gap-1">
                <p className="text-[9px] text-rose-500 shrink-0 font-semibold">r↓</p>
                <p className={`text-[15px] font-black tabular-nums leading-tight ${rhoColor(rhoDown ?? null)}`}>
                  {fmtR(rhoDown ?? null)}
                </p>
              </div>
            </div>
          )}

          {/* Secondary: aggregate r + 95% CI */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="flex items-baseline gap-1">
              <p className="text-[8px] text-ink-muted shrink-0">r (all)</p>
              <p className={`text-[12px] font-bold tabular-nums leading-tight ${rhoColor(rho)}`}>
                {fmtR(rho)}
              </p>
            </div>
            {rhoCi ? (
              <p className="text-[8px] text-ink-muted tabular-nums" title="95% CI (Fisher z)">
                CI {formatFisherCi(rhoCi)}
              </p>
            ) : null}
            {winRateQ4 != null && (
              <div className="flex items-baseline gap-1 ml-auto">
                <p className="text-[8px] text-ink-muted">{winRateLabel ?? "Win\u226575"}</p>
                <p className="text-[11px] font-bold text-ink tabular-nums">{winRateQ4}%</p>
              </div>
            )}
          </div>

          {tertileSpread ? (
            <p className="text-[8px] text-ink-muted leading-snug">
              Tertiles ΔP&L {tertileSpread.spreadHighLow >= 0 ? "+" : ""}
              {tertileSpread.spreadHighLow.toFixed(1)}pp (high−low) · ρₛ{" "}
              {tertileSpread.spearman != null ? fmtR(tertileSpread.spearman) : "n/a"}
            </p>
          ) : null}
        </>
      )}

      {note && <p className="text-[9px] text-amber-600/80 leading-tight mt-0.5">{note}</p>}
    </Container>
  );
}

function fmtCorrR(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** P(plan) vs P&L with raw + MCS-adjusted regression (P&L net of MCS linear component). */
function PplanMcsMergedScatter({
  rows,
  it,
  onOpenDetails,
}: {
  rows: CompRow[];
  it: boolean;
  onOpenDetails?: () => void;
}) {
  const merged = useMemo(() => {
    if (rows.length < 3) return null;
    const pplan = rows.map((r) => r.pplan);
    const pnl = rows.map((r) => r.pnl);
    const mcs = rows.map((r) => r.mcsAtEntry!);
    const xSpan = { min: 0, max: 100 };
    const rawReg = linearRegressionOLS(pplan, pnl, xSpan);
    const mcsOnPnl = linearRegressionOLS(mcs, pnl);
    if (!rawReg || !mcsOnPnl) return null;
    const pnlNet = pnl.map((y, i) => y - (mcsOnPnl.intercept + mcsOnPnl.slope * mcs[i]!));
    const netReg = linearRegressionOLS(pplan, pnlNet, xSpan);
    if (!netReg) return null;
    return {
      pts: rows.map((r) => compRowToMiniPt(r, r.pplan)),
      rawLine: rawReg.line,
      netLine: netReg.line,
      rRaw: pearsonR(pplan, pnl),
      rNet: pearsonR(pplan, pnlNet),
      slopeRaw: rawReg.slope,
      slopeNet: netReg.slope,
    };
  }, [rows]);

  const n = rows.length;
  const ys = merged?.pts.map((p) => p.y).filter(Number.isFinite) ?? [];
  const yMin = ys.length ? Math.min(...ys, ...(merged?.netLine.map((l) => l.y) ?? []), 0) : -20;
  const yMax = ys.length ? Math.max(...ys, ...(merged?.netLine.map((l) => l.y) ?? []), 0) : 20;
  const yPad = Math.max(4, (yMax - yMin) * 0.12);

  return (
    <div className={SCATTER_CARD_SHELL}>
      <div className={SCATTER_HEADER_CLASS}>
        <div className="flex items-start justify-between gap-1 h-full">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-[11px] font-semibold text-ink leading-tight truncate" title="P(plan) vs P&L — merge MCS">
              {it ? "P(plan) vs P&L — merge MCS" : "P(plan) vs P&L — MCS merge"}
            </p>
            <p className="text-[9px] text-amber-600/80 leading-tight line-clamp-2 min-h-[2.35em] mt-0.5">
              {it
                ? "Linea indaco = P(plan) grezzo · tratteggio arancio = curva dopo aver sottratto da P&L la componente lineare MCS"
                : "Indigo = raw P(plan) · orange dashed = curve after subtracting MCS linear component from P&L"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[9px] text-ink-muted shrink-0 w-[42%] min-w-0 overflow-hidden">
            {merged?.rRaw != null && (
              <span title={it ? "Correlazione P(plan) grezza" : "Raw P(plan) correlation"}>
                r{" "}
                <strong className="tabular-nums text-indigo-600">{fmtCorrR(merged.rRaw)}</strong>
              </span>
            )}
            {merged?.rNet != null && (
              <span title={it ? "Correlazione P(plan) su P&L netto MCS" : "P(plan) on MCS-net P&L"}>
                r<sub>net</sub>{" "}
                <strong className="tabular-nums text-orange-600">{fmtCorrR(merged.rNet)}</strong>
              </span>
            )}
            {merged?.slopeRaw != null && merged.slopeNet != null && (
              <span className="tabular-nums" title={it ? "Pendenza OLS grezza vs netta" : "Raw vs net OLS slope"}>
                β {merged.slopeRaw.toFixed(3)} → {merged.slopeNet.toFixed(3)}
              </span>
            )}
            <span>
              n=<strong className="text-ink tabular-nums">{n}</strong>
            </span>
          </div>
        </div>
      </div>

      {n < 3 || !merged ? (
        <div
          className="flex items-center justify-center shrink-0 w-full"
          style={{ height: SCATTER_CHART_HEIGHT_PX }}
        >
          <p className="text-[10px] text-ink-muted text-center">Insufficient data (n={n})</p>
        </div>
      ) : (
        <div className="shrink-0 w-full" style={{ height: SCATTER_CHART_HEIGHT_PX }}>
          <ResponsiveContainer width="100%" height={SCATTER_CHART_HEIGHT_PX}>
            <ComposedChart margin={{ top: 4, right: 6, bottom: 20, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                type="number"
                dataKey="x"
          domain={[0, 100]}
                tick={{ fontSize: 8 }}
                tickFormatter={(v: number) => formatScatterAxisTick(v)}
                label={{
                  value: "P(plan) %",
                  position: "bottom",
                  offset: 10,
                  style: { fontSize: 8, fill: "#94a3b8" },
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin - yPad, yMax + yPad]}
                tick={{ fontSize: 8 }}
                tickFormatter={formatScatterAxisTickPct}
                width={36}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
              <Line
                data={merged.rawLine}
                type="linear"
                dataKey="y"
                stroke="#6366f1"
                strokeWidth={2.5}
                strokeOpacity={0.9}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                data={merged.netLine}
                type="linear"
                dataKey="y"
                stroke="#f97316"
                strokeWidth={2}
                strokeOpacity={0.9}
                strokeDasharray="7 4"
                dot={false}
                isAnimationActive={false}
                legendType="none"
        />
        <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as MiniScatterPt | undefined;
                  if (!p) return null;
            return (
                    <div className="rounded border border-[rgb(var(--border))]/60 bg-white px-2 py-1 text-[10px] shadow">
                      <p className="font-semibold">{p.ticker}</p>
                      <p>P(plan): {p.x.toFixed(1)}</p>
                      <p>
                        P&L: {p.y >= 0 ? "+" : ""}
                        {p.y.toFixed(1)}%
                      </p>
              </div>
            );
          }}
        />
              <Scatter
                data={merged.pts}
                shape={(props: { cx?: number; cy?: number; payload?: MiniScatterPt }) => (
                  <WinLossScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            </ComposedChart>
    </ResponsiveContainer>
        </div>
      )}

      <div className="shrink-0 flex items-center justify-between gap-2 pt-0.5 border-t border-[rgb(var(--border))]/30">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-indigo-500 rounded" />
            P(plan)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 border-t-2 border-dashed border-orange-500" />
            P(plan) − MCS
          </span>
        </div>
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="text-[9px] text-indigo-600 hover:underline shrink-0"
          >
            Details
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Generic signal vs P&L with raw + MCS-adjusted OLS lines. Mirrors PplanMcsMergedScatter. */
function GenericMcsMergedScatter({
  rows,
  getX,
  xLabel,
  title,
  xDomain,
  it,
  onOpenDetails,
}: {
  rows: CompRow[];
  getX: (r: CompRow) => number | null;
  xLabel: string;
  title: string;
  xDomain?: { min: number; max: number };
  it: boolean;
  onOpenDetails?: () => void;
}) {
  const validRows = useMemo(
    () => rows.filter((r) => getX(r) != null && r.mcsAtEntry != null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  const merged = useMemo(() => {
    if (validRows.length < 3) return null;
    const xs = validRows.map((r) => getX(r) as number);
    const pnl = validRows.map((r) => r.pnl);
    const mcs = validRows.map((r) => r.mcsAtEntry!);
    const rawReg = linearRegressionOLS(xs, pnl, xDomain);
    const mcsOnPnl = linearRegressionOLS(mcs, pnl);
    if (!rawReg || !mcsOnPnl) return null;
    const pnlNet = pnl.map((y, i) => y - (mcsOnPnl.intercept + mcsOnPnl.slope * mcs[i]!));
    const netReg = linearRegressionOLS(xs, pnlNet, xDomain);
    if (!netReg) return null;
    return {
      pts: validRows.map((r) => compRowToMiniPt(r, getX(r) as number)),
      rawLine: rawReg.line,
      netLine: netReg.line,
      rRaw: pearsonR(xs, pnl),
      rNet: pearsonR(xs, pnlNet),
      slopeRaw: rawReg.slope,
      slopeNet: netReg.slope,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, xDomain]);

  const n = validRows.length;
  const ys = merged?.pts.map((p) => p.y).filter(Number.isFinite) ?? [];
  const yMin = ys.length ? Math.min(...ys, ...(merged?.netLine.map((l) => l.y) ?? []), 0) : -20;
  const yMax = ys.length ? Math.max(...ys, ...(merged?.netLine.map((l) => l.y) ?? []), 0) : 20;
  const yPad = Math.max(4, (yMax - yMin) * 0.12);

  return (
    <div className={SCATTER_CARD_SHELL}>
      <div className={SCATTER_HEADER_CLASS}>
        <div className="flex items-start justify-between gap-1 h-full">
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-[11px] font-semibold text-ink leading-tight truncate" title={title}>
              {title}
            </p>
            <p className="text-[9px] text-amber-600/80 leading-tight line-clamp-2 min-h-[2.35em] mt-0.5">
              {it
                ? "Indaco = segnale grezzo · arancio tratteggio = dopo sottrazione componente lineare MCS"
                : "Indigo = raw signal · orange dashed = after removing MCS linear component"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5 text-[9px] text-ink-muted shrink-0 w-[42%] min-w-0 overflow-hidden">
            {merged?.rRaw != null && (
              <span title={it ? "Correlazione grezza" : "Raw correlation"}>
                r <strong className="tabular-nums text-indigo-600">{fmtCorrR(merged.rRaw)}</strong>
              </span>
            )}
            {merged?.rNet != null && (
              <span title={it ? "Correlazione su P&L netto MCS" : "On MCS-net P&L"}>
                r<sub>net</sub>{" "}
                <strong className="tabular-nums text-orange-600">{fmtCorrR(merged.rNet)}</strong>
              </span>
            )}
            {merged?.slopeRaw != null && merged.slopeNet != null && (
              <span className="tabular-nums" title={it ? "Pendenza OLS grezza vs netta" : "Raw vs net OLS slope"}>
                β {merged.slopeRaw.toFixed(3)} → {merged.slopeNet.toFixed(3)}
              </span>
            )}
            <span>
              n=<strong className="text-ink tabular-nums">{n}</strong>
            </span>
          </div>
        </div>
      </div>

      {n < 3 || !merged ? (
        <div
          className="flex items-center justify-center shrink-0 w-full"
          style={{ height: SCATTER_CHART_HEIGHT_PX }}
        >
          <p className="text-[10px] text-ink-muted text-center">Insufficient data (n={n})</p>
        </div>
      ) : (
        <div className="shrink-0 w-full" style={{ height: SCATTER_CHART_HEIGHT_PX }}>
          <ResponsiveContainer width="100%" height={SCATTER_CHART_HEIGHT_PX}>
            <ComposedChart margin={{ top: 4, right: 6, bottom: 20, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain ? [xDomain.min, xDomain.max] : ["auto", "auto"]}
                tick={{ fontSize: 8 }}
                tickFormatter={(v: number) => formatScatterAxisTick(v)}
                label={{
                  value: xLabel,
                  position: "bottom",
                  offset: 10,
                  style: { fontSize: 8, fill: "#94a3b8" },
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin - yPad, yMax + yPad]}
                tick={{ fontSize: 8 }}
                tickFormatter={formatScatterAxisTickPct}
                width={36}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" strokeWidth={0.8} />
              <Line
                data={merged.rawLine}
                type="linear"
                dataKey="y"
                stroke="#6366f1"
                strokeWidth={2.5}
                strokeOpacity={0.9}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <Line
                data={merged.netLine}
                type="linear"
                dataKey="y"
                stroke="#f97316"
                strokeWidth={2}
                strokeOpacity={0.9}
                strokeDasharray="7 4"
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0]?.payload as MiniScatterPt | undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded border border-[rgb(var(--border))]/60 bg-white px-2 py-1 text-[10px] shadow">
                      <p className="font-semibold">{p.ticker}</p>
                      <p>{xLabel}: {p.x.toFixed(1)}</p>
                      <p>P&L: {p.y >= 0 ? "+" : ""}{p.y.toFixed(1)}%</p>
                    </div>
                  );
                }}
              />
              <Scatter
                data={merged.pts}
                shape={(props: { cx?: number; cy?: number; payload?: MiniScatterPt }) => (
                  <WinLossScatterDot cx={props.cx} cy={props.cy} payload={props.payload} />
                )}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="shrink-0 flex items-center justify-between gap-2 pt-0.5 border-t border-[rgb(var(--border))]/30">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px] text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 bg-indigo-500 rounded" />
            {xLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-4 h-0.5 border-t-2 border-dashed border-orange-500" />
            {xLabel} − MCS
          </span>
        </div>
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            className="text-[9px] text-indigo-600 hover:underline shrink-0"
          >
            Details
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** SDS at trade entry for closed-deal correlation — never uses live snapshot. */
function resolveClosedEntrySds(
  rowKey: string | null | undefined,
  entrySdsScore: number | null | undefined,
  frozenStore?: Record<string, FrozenEntryFeatures>,
): { sds: number | null; atEntry: boolean } {
  if (entrySdsScore != null && Number.isFinite(entrySdsScore)) {
    return { sds: entrySdsScore, atEntry: true };
  }
  if (rowKey) {
    const frozen = frozenStore?.[rowKey] ?? null;
    if (frozen?.sds != null && Number.isFinite(frozen.sds)) {
      return { sds: frozen.sds, atEntry: true };
    }
  }
  return { sds: null, atEntry: false };
}

/** SDS for open positions — frozen features → sheet entry_sds → live SDS snapshot. */
function resolveOpenPositionSds(
  ticker: string,
  sdsMap: Map<string, SdsRowType> | null | undefined,
  opts?: { rowKey?: string; simRow?: SimSheetRow },
  frozenStore?: Record<string, FrozenEntryFeatures>,
): { sds: number | null; atEntry: boolean } {
  const tk = ticker.trim().toUpperCase();
  if (opts?.rowKey) {
    const frozen = frozenStore?.[opts.rowKey] ?? null;
    if (frozen?.sds != null) return { sds: frozen.sds, atEntry: true };
  }
  if (opts?.simRow) {
    const entrySds =
      parseNum(opts.simRow["entry_sds_score"]) ?? parseNum(opts.simRow["entry_sds"]);
    if (entrySds != null) return { sds: entrySds, atEntry: true };
    const fromRow = parseNum(opts.simRow["SDS"]) ?? parseNum(opts.simRow["sds_score"]);
    if (fromRow != null) return { sds: fromRow, atEntry: false };
  }
  const live = sdsMap?.get(tk)?.sds;
  if (live != null && Number.isFinite(live)) return { sds: live, atEntry: false };
  return { sds: null, atEntry: false };
}

function resolveEntryPplan(
  key: string,
  inputs: ReturnType<typeof loadInvestSimInputs>,
  paperByKey: Map<string, { entryProbPct?: number | null }>,
  pplanLookup: Map<string, number> | null,
): { pplan: number; pplanIsDefault: boolean } {
  const fromInputs = inputs[key]?.entryProbPct;
  const fromPaper = paperByKey.get(key)?.entryProbPct;
  const fromLookup = pplanLookup?.get(key) ?? null;
  if (fromInputs != null && Number.isFinite(fromInputs) && fromInputs > 0) {
    return { pplan: fromInputs, pplanIsDefault: false };
  }
  if (fromPaper != null && Number.isFinite(fromPaper) && fromPaper > 0) {
    return { pplan: fromPaper, pplanIsDefault: false };
  }
  if (fromLookup != null && Number.isFinite(fromLookup) && fromLookup > 0) {
    return { pplan: fromLookup, pplanIsDefault: false };
  }
  return { pplan: 50, pplanIsDefault: true };
}

/**
 * Build CompRow entries for CLOSED portfolio positions (soldAt set in investSimInputs).
 * pplanLookup: Map<"TICKER|CD_DATE", affidabilita_pct> built from outcomes rows — fills the
 * gap where entryProbPct was never recorded in invest_sim_inputs at entry time.
 * entrySdsLookup: Map<"TICKER|CD_DATE", entry_sds_score> from outcomes — immutable at entry.
 */
function buildClosedPortfolioRows(
  ctx: ModelComparisonBuildCtx,
  pplanLookup: Map<string, number> | null = null,
  entrySdsLookup: Map<string, number> | null = null,
): CompRow[] {
  if (typeof window === "undefined") return [];
  try {
    const inputs = loadInvestSimInputs();
    const history = loadInvestSimHistory();
    const out: CompRow[] = [];

    for (const [key, entry] of Object.entries(inputs)) {
      if (!entry || !entry.soldAt) continue; // only closed/sold

      const parts = key.split("|");
      const ticker = parts[0] ?? key;
      const cdDate = parts[1] ?? null;
      const mcsAssignmentIso = resolveInvestedAt(key, entry, history);

      // Final P&L%: prefer closedValue/closedCapital, fall back to last history snapshot
      let pnl: number | null = null;
      if (entry.closedCapital && entry.closedValue && entry.closedCapital > 0) {
        pnl = ((entry.closedValue - entry.closedCapital) / entry.closedCapital) * 100;
      } else {
        const snaps = history
          .filter((h) => h.byTicker?.[key] != null)
          .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
        const beforeSale = entry.soldAt
          ? snaps.filter((h) => h.ts <= entry.soldAt!)
          : snaps;
        pnl = (beforeSale[0] ?? snaps[0])?.byTicker?.[key]?.pnlPct ?? null;
      }
      if (pnl == null) continue;

      // P(plan): prefer recorded value, then look up from outcomes rows by TICKER|CD_DATE,
      // finally fall back to 50 (and mark as default so UI can warn).
      const pplanKey = `${ticker.toUpperCase()}|${cdDate ?? ""}`;
      const pplanFromLookup = cdDate ? (pplanLookup?.get(pplanKey) ?? null) : null;
      const pplan = entry.entryProbPct ?? pplanFromLookup ?? 50;
      const pplanIsDefault = entry.entryProbPct == null && pplanFromLookup == null;

      const entrySdsKey = `${ticker.toUpperCase()}|${cdDate ?? ""}`;
      const entrySdsFromOutcomes = cdDate ? (entrySdsLookup?.get(entrySdsKey) ?? null) : null;
      const { sds, atEntry: sdsAtEntry } = resolveClosedEntrySds(
        key,
        entrySdsFromOutcomes,
        ctx.frozenStore,
      );

      const frozen = ctx.frozenStore?.[key];
      const regulatoryScore = frozen?.regulatoryScore ?? ctxRegScore(ctx, ticker);

      const rescueScore = pnl < 0
        ? computeRescueScoreBreakdown({ ticker, entryProbPct: pplan, lastMarkPct: pnl, eisWindowScore: null }).rescoreScore
        : 0;
      const rescueScoreExtended = rescoreExtended(pplan, pnl, ticker, ctx);
      const rescueScoreEntry = rescoreEntryValidation(pplan, ticker, ctx);
      const rescueScoreExtendedEntry = rescoreExtendedEntryValidation(pplan, ticker, ctx);

      out.push({
        ticker,
        rowKey: key,
        mcsAssignmentIso,
        mcsAtEntry: frozen?.mcsAtEntry ?? undefined,
        pplan,
        sds,
        sdsAtEntry,
        rescueScore,
        rescueScoreExtended,
        rescueScoreEntry,
        rescueScoreExtendedEntry,
        pnl,
        yMetric: "final_pnl",
        isWin: pnl > 0,
        isLoss: isLossPnl(pnl),
        isOpen: false,
        regulatoryScore,
        universe: "portafoglio",
        pplanIsDefault,
        // Prefer BUY-time freeze; else pre-CD [CD-90d, CD] feed window.
        eisScore: frozen?.eisScore ?? ctxEisScoreForClosedDeal(ctx, ticker, cdDate),
      });
    }

    return out;
  } catch {
    return [];
  }
}

/** Build CompRow entries for open positions in loss for ≥3 calendar days. */
function buildOpenLossRows(ctx: ModelComparisonBuildCtx): CompRow[] {
  if (typeof window === "undefined") return [];
  try {
    const history = loadInvestSimHistory();
    const inputs = loadInvestSimInputs();
    const seen = new Set<string>();
    const out: CompRow[] = [];

    // --- Portfolio / tracked positions from invest_sim_inputs ---
    // Cross-reference paper book for P&L when history is missing.
    const simState = loadDecisionSimState();
    const paperByKey = new Map(simState.paperPortfolio.map((p) => [p.key, p]));

    for (const [key, entry] of Object.entries(inputs)) {
      if (!entry || entry.capital <= 0) continue;
      if (entry.ignoreSheet || entry.soldAt) continue; // closed
      seen.add(key);

      // Latest pnlPct — try history first, then paper portfolio lastMarkPct
      const snaps = history
        .filter((h) => h.byTicker?.[key] != null)
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
      let latestPnl = snaps[0]?.byTicker?.[key]?.pnlPct ?? null;
      if (latestPnl == null) {
        // Fallback: check paper portfolio for same key
        const paper = paperByKey.get(key);
        if (paper?.lastMarkPct != null) latestPnl = paper.lastMarkPct;
      }
      if (latestPnl == null || latestPnl >= LOSS_ENTRY_THRESHOLD_PCT) continue;

      const ticker = key.split("|")[0] ?? key;
      const savedPplan = entry.entryProbPct;
      const paperPplan = paperByKey.get(key)?.entryProbPct;
      const pplan =
        savedPplan != null && Number.isFinite(savedPplan) && savedPplan > 0
          ? savedPplan
          : paperPplan != null && Number.isFinite(paperPplan) && paperPplan > 0
            ? paperPplan
            : 50;
      const regulatoryScore = ctxRegScore(ctx, ticker);
      const { sds, atEntry: sdsAtEntry } = resolveOpenPositionSds(ticker, ctx.sdsMap, { rowKey: key }, ctx.frozenStore);
      out.push({
        ticker,
        pplan,
        sds,
        sdsAtEntry,
        ...rescueFieldsForRow(pplan, latestPnl, ticker, ctx),
        pnl: latestPnl,
        yMetric: "entry_pnl",
        isWin: false,
        isLoss: isLossPnl(latestPnl),
        isOpen: true,
        regulatoryScore,
        universe: "portafoglio",
        eisScore: ctxEisScore(ctx, ticker),
      });
    }


    return out;
  } catch {
    return [];
  }
}

/** Build CompRow entries for ALL open positions (including those in gain). */
function buildOpenAllRows(
  ctx: ModelComparisonBuildCtx,
  pplanLookup: Map<string, number> | null = null,
): CompRow[] {
  if (typeof window === "undefined") return [];
  try {
    const history = loadInvestSimHistory();
    const inputs = loadInvestSimInputs();
    const seen = new Set<string>();
    const out: CompRow[] = [];

    const simState = loadDecisionSimState();
    const paperByKey = new Map(simState.paperPortfolio.map((p) => [p.key, p]));

    for (const [key, entry] of Object.entries(inputs)) {
      if (!entry) continue;
      if (entry.ignoreSheet || entry.soldAt) continue;

      const snaps = history
        .filter((h) => h.byTicker?.[key] != null)
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
      let latestPnl = snaps[0]?.byTicker?.[key]?.pnlPct ?? null;
      if (latestPnl == null) {
        const paper = paperByKey.get(key);
        if (paper?.lastMarkPct != null) latestPnl = paper.lastMarkPct;
      }
      if (latestPnl == null) {
        if (entry.capital > 0) latestPnl = 0;
        else continue;
      }
      seen.add(key);

      const parts = key.split("|");
      const ticker = parts[0] ?? key;
      const { pplan, pplanIsDefault } = resolveEntryPplan(key, inputs, paperByKey, pplanLookup);
      const regulatoryScore = ctxRegScore(ctx, ticker);
      const { sds, atEntry: sdsAtEntry } = resolveOpenPositionSds(ticker, ctx.sdsMap, { rowKey: key }, ctx.frozenStore);
      const mcsAssignmentIso = resolveInvestedAt(key, entry, history);
      out.push({
        ticker,
        rowKey: key,
        mcsAssignmentIso,
        pplan,
        pplanIsDefault,
        sds,
        sdsAtEntry,
        ...rescueFieldsForRow(pplan, latestPnl, ticker, ctx),
        pnl: latestPnl,
        yMetric: "entry_pnl",
        isWin: latestPnl > 0,
        isLoss: isLossPnl(latestPnl),
        isOpen: true,
        regulatoryScore,
        universe: "portafoglio" as const,
        eisScore: ctxEisScore(ctx, ticker),
      });
    }


    return out;
  } catch {
    return [];
  }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelComparisonPanel() {
  const { lang } = useLang();
  const [openLossRows, setOpenLossRows] = useState<CompRow[]>([]);
  const [openAllRows, setOpenAllRows] = useState<CompRow[]>([]);
  const [closedPortfolioRows, setClosedPortfolioRows] = useState<CompRow[]>([]);
  const [chart1View, setChart1View] = useState<ScatterUniverseView>("portfolio");
  const [chart2View, setChart2View] = useState<ScatterUniverseView>("portfolio");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailModal, setDetailModal] = useState<{ title: string; pts: MiniScatterPt[] } | null>(null);
  const [outcomesGeneratedAt, setOutcomesGeneratedAt] = useState<string | null>(null);
  const [sdsGeneratedAt, setSdsGeneratedAt] = useState<string | null>(null);
  const [sdsN, setSdsN] = useState<number | null>(null);
  const [mcsDoc, setMcsDoc] = useState<MarketContextSnapshotDoc | null>(null);
  // Resilience Score snapshot — intrinsic recovery + growth capacity per ticker.
  // Independent from SDS / Regulatory (see prediction/resilience_score.py).
  // We index by uppercased ticker for O(1) lookup during row builds.
  const [resilienceIndex, setResilienceIndex] = useState<Map<string, ResilienceEntryDoc>>(
    () => new Map(),
  );
  const [resilienceModalOpen, setResilienceModalOpen] = useState(false);

  /*
   * Perf: Chart 1 renders 5 Recharts scatters as soon as the panel opens.
   * Chart 2 / Chart 3 keep the InViewOnce wrappers (force=true) so they always
   * mount; the pattern can be re-enabled later by flipping force back to false.
   */
  const chart2Section = useInViewOnce(true);
  const chart3Section = useInViewOnce(true);

  useEffect(() => {
    // Hydrate the Resilience Score snapshot. Fully async — never blocks
    // the main load and degrades gracefully to an empty index if the API
    // returns 404 or the snapshot has not been generated yet.
    let cancelled = false;

    const applyDoc = (doc: {
      entries?: Record<string, ResilienceEntryDoc>;
    } | null): void => {
      if (cancelled || !doc || !doc.entries) return;
      const m = new Map<string, ResilienceEntryDoc>();
      for (const [tk, entry] of Object.entries(doc.entries)) {
        m.set(tk.toUpperCase(), entry);
      }
      setResilienceIndex(m);
    };

    void hydrateResilienceSnapshot().then(applyDoc);

    const onUpdate = (): void => {
      // Re-read from cachedIndex via lookup — cheaper than re-hydrating.
      void hydrateResilienceSnapshot().then(applyDoc);
    };
    window.addEventListener(RESILIENCE_SNAPSHOT_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(RESILIENCE_SNAPSHOT_UPDATED_EVENT, onUpdate);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const l: "it" | "en" = lang === "it" ? "it" : "en";

    void Promise.all([
      fetchProjectJson<SimOutcomesDoc>(OUTCOMES_FILE),
      readLocalSdsSnapshot(),
      fetchProjectJson<SimSheetSnapshot>(SIM_SHEET_FILE),
      loadRegulatorySnapshot(),
      loadMarketContextSnapshot().catch(() => null),
    ])
      .then(([outcomesRes, sdsSnap, simSnapRes, regSnap, mcs]) => {
        if (cancelled) return;

        const { data, detail } = outcomesRes;
        const simSnap = simSnapRes.data;

        if (data?.generated_at) setOutcomesGeneratedAt(data.generated_at);
        if (sdsSnap?.generated_at) setSdsGeneratedAt(sdsSnap.generated_at);
        if (sdsSnap?.n != null) setSdsN(sdsSnap.n as number);
        setMcsDoc(mcs);

        const simRows = simSnap?.rows ?? null;
        const phaseMap = buildTickerPhaseMap(simRows);
        const sdsMap: Map<string, SdsRowType> | null = sdsSnap?.rows?.length
          ? new Map(sdsSnap.rows.map((r) => [r.ticker.trim().toUpperCase(), r]))
          : null;

        const ctx = createModelComparisonBuildCtx({
          lang: l,
          regSnap,
          phaseMap,
          sdsMap,
        });

        if (detail && !(data?.rows?.length)) setError(detail);

        const pplanLookup = new Map<string, number>();
        const entrySdsLookup = new Map<string, number>();
        for (const row of data?.rows ?? []) {
          if (!row.completion_date) continue;
          const k = `${row.ticker.toUpperCase()}|${row.completion_date.slice(0, 10)}`;
          const pplan = row.entry_affidabilita_pct ?? row.affidabilita_pct;
          if (pplan != null && !pplanLookup.has(k)) pplanLookup.set(k, pplan);
          if (row.entry_sds_score != null && !entrySdsLookup.has(k)) {
            entrySdsLookup.set(k, row.entry_sds_score);
          }
        }

        setOpenLossRows(buildOpenLossRows(ctx));
        setOpenAllRows(buildOpenAllRows(ctx, pplanLookup));
        setClosedPortfolioRows(buildClosedPortfolioRows(ctx, pplanLookup, entrySdsLookup));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lang]);

  // Chart 1: closed portfolio deals only (sim loop removed).
  const chart1Rows = useMemo(() => closedPortfolioRows, [closedPortfolioRows]);

  const chart1SdsRows = useMemo(
    () => chart1Rows.filter((r) => r.sds != null && r.sdsAtEntry),
    [chart1Rows],
  );
  const chart1SdsDirectional = useMemo(
    () => ({
      up: corrOnRows(
        chart1SdsRows.filter((r) => r.pnl > 0),
        (r) => r.sds,
      ),
      down: corrOnRows(
        chart1SdsRows.filter((r) => r.pnl < 0),
        (r) => r.sds,
      ),
    }),
    [chart1SdsRows],
  );


  const chart2PortfolioRows = useMemo(
    () => openAllRows.filter((r) => r.universe === "portafoglio"),
    [openAllRows],
  );

  const chart2BaseRows = useMemo((): CompRow[] => {
    const openPort = chart2PortfolioRows;
    const closedPort = closedPortfolioRows;
    return [...openPort, ...closedPort];
  }, [chart2PortfolioRows, closedPortfolioRows]);

  const eisFeedEventPts = useMemo(
    () => buildEisFeedEventPoints(hydrateClinicalPreCdRecords()),
    [openAllRows.length, closedPortfolioRows.length],
  );

  const chart2UniverseTickers = useMemo(() => {
    if (chart2View === "all") return null;
    const set = new Set<string>();
    for (const r of chart2BaseRows) set.add(r.ticker.trim().toUpperCase());
    return set;
  }, [chart2View, chart2BaseRows]);

  const chart2EisFeedPts = useMemo(() => {
    if (!chart2UniverseTickers) return eisFeedEventPts;
    return eisFeedEventPts.filter((p) => chart2UniverseTickers.has(p.ticker.trim().toUpperCase()));
  }, [eisFeedEventPts, chart2UniverseTickers]);

  const chart2ForwardEntryRows = useMemo(() => {
    const history = loadInvestSimHistory();
    const inputs = loadInvestSimInputs();
    const entryRows: EntryReadoutRow[] = chart2BaseRows
      .filter((r) => r.rowKey)
      .map((r) => ({
        ticker: r.ticker,
        rowKey: r.rowKey!,
        pplan: r.pplan,
        pplanIsDefault: r.pplanIsDefault,
        sds: r.sds,
        sdsAtEntry: r.sdsAtEntry,
        rescueScoreEntry: r.rescueScoreEntry,
        rescueScoreExtendedEntry: r.rescueScoreExtendedEntry,
        regulatoryScore: r.regulatoryScore,
        eisScore: r.eisScore,
        universe: r.universe,
        isOpen: r.isOpen,
        mcsAssignmentIso: r.mcsAssignmentIso,
      }));
    return enrichEntryRowsWithForward3d(entryRows, history, inputs).filter(
      (r) => r.forward3dPct != null && !r.pplanIsDefault,
    );
  }, [chart2BaseRows]);

  const chart2ForwardSdsRows = useMemo(
    () => chart2ForwardEntryRows.filter((r) => r.sds != null && r.sdsAtEntry),
    [chart2ForwardEntryRows],
  );

  const chart1PplanRows = useMemo(
    () => excludePplanPlaceholders(chart1Rows),
    [chart1Rows],
  );

  const chart1PplanDirectional = useMemo(
    () => directionalCorrOnRows(chart1PplanRows, (r) => r.pplan),
    [chart1PplanRows],
  );

  const chart1EisRows = useMemo(
    () => chart1Rows.filter((r) => r.eisScore != null),
    [chart1Rows],
  );

  const chart1EisDirectional = useMemo(
    () => directionalCorrOnRows(chart1EisRows, (r) => r.eisScore),
    [chart1EisRows],
  );

  // Correlation cohort: closed portfolio deals.
  const pplanRows = useMemo(() => excludePplanPlaceholders(closedPortfolioRows), [closedPortfolioRows]);

  const enrichedChart1Rows = useMemo((): CompRow[] => {
    const history = loadInvestSimHistory();
    const inputs = loadInvestSimInputs();
    return chart1Rows.map((r) => {
      const assignmentIso =
        r.mcsAssignmentIso ??
        r.raw?.entry_ts ??
        (r.rowKey ? resolveInvestedAt(r.rowKey, inputs[r.rowKey], history) : null);
      let mcsAtEntry = r.mcsAtEntry;
      if (mcsAtEntry == null && mcsDoc && assignmentIso) {
        mcsAtEntry = getMcsForDate(mcsDoc, assignmentIso)?.mcs_global ?? null;
      }
      const rowKey =
        r.rowKey ??
        r.raw?.row_key ??
        (r.raw?.completion_date
          ? `${r.ticker.toUpperCase()}|${r.raw.completion_date.slice(0, 10)}`
          : null);
      const stockMove3dPct =
        rowKey && assignmentIso
          ? stockMove3dPctAfterAssignment(history, rowKey, assignmentIso)
          : null;
      return {
        ...r,
        mcsAssignmentIso: assignmentIso,
        mcsAtEntry,
        rowKey,
        stockMove3dPct,
      };
    });
  }, [chart1Rows, mcsDoc]);

  const mcsCorrRows = useMemo(
    () => enrichedChart1Rows.filter((r) => r.mcsAtEntry != null && !r.pplanIsDefault),
    [enrichedChart1Rows],
  );
  const mcsMoveRows = useMemo(
    () => mcsCorrRows.filter((r) => r.stockMove3dPct != null),
    [mcsCorrRows],
  );
  const compareWinRows = useMemo(() => mcsCorrRows.filter((r) => r.pnl > 0), [mcsCorrRows]);
  const compareLoseRows = useMemo(() => mcsCorrRows.filter((r) => r.pnl < 0), [mcsCorrRows]);
  const mcsMoveUpRows = useMemo(() => mcsMoveRows.filter((r) => (r.stockMove3dPct ?? 0) > 0), [mcsMoveRows]);
  const mcsMoveDownRows = useMemo(() => mcsMoveRows.filter((r) => (r.stockMove3dPct ?? 0) < 0), [mcsMoveRows]);
  const partialMcsPnlGivenPplan = useMemo(() => {
    if (mcsCorrRows.length < 4) return null;
    return partialPearsonR(
      mcsCorrRows.map((r) => r.mcsAtEntry!),
      mcsCorrRows.map((r) => r.pnl),
      mcsCorrRows.map((r) => r.pplan),
    );
  }, [mcsCorrRows]);

  // All stats derived from closed deals only — SDS correlation uses entry-time scores only.
  const sdsRows = useMemo(
    () => closedPortfolioRows.filter((r) => r.sds != null && r.sdsAtEntry),
    [closedPortfolioRows],
  );
  const lossRows = useMemo(() => closedPortfolioRows.filter((r) => r.isLoss), [closedPortfolioRows]);

  const pplanRho = useMemo(
    () => corrOnRows(pplanRows, (r) => r.pplan),
    [pplanRows],
  );
  const sdsRho = useMemo(
    () => corrOnRows(sdsRows, (r) => r.sds),
    [sdsRows],
  );
  // Resilience Score — enrich rows with score from the snapshot index and
  // compute Spearman ρ against P&L. Cohort = closed deals with a measurable
  // resilience payload (i.e. ticker had enough price history to score at
  // least one of the three blocks). Overlap with SDS / Regulatory is
  // structurally impossible because the resilience score is built from
  // the ticker's own long price history and XBI, not from any SDS cluster
  // or regulatory event stream.
  const resilienceEnrichedRows = useMemo(() => {
    if (resilienceIndex.size === 0) return closedPortfolioRows;
    return closedPortfolioRows.map((r) => {
      if (r.resilienceScore != null) return r;
      const entry =
        resilienceIndex.get(r.ticker.toUpperCase()) ??
        lookupResilienceForTicker(r.ticker);
      if (!entry || entry.status !== "ok") return { ...r, resilienceScore: null };
      return { ...r, resilienceScore: entry.resilience_score };
    });
  }, [closedPortfolioRows, resilienceIndex]);

  const resilienceRows = useMemo(
    () => resilienceEnrichedRows.filter((r) => r.resilienceScore != null),
    [resilienceEnrichedRows],
  );

  const resilienceRho = useMemo(
    () => corrOnRows(resilienceRows, (r) => r.resilienceScore ?? null),
    [resilienceRows],
  );

  const resilienceDirectional = useMemo(() => {
    return directionalCorrOnRows(resilienceRows, (r) => r.resilienceScore ?? null);
  }, [resilienceRows]);

  // EIS: closed deals with a non-null EIS feed score.
  const eisRows = useMemo(() => closedPortfolioRows.filter((r) => r.eisScore != null), [closedPortfolioRows]);
  const eisRho = useMemo(
    () => corrOnRows(eisRows, (r) => r.eisScore),
    [eisRows],
  );
  const eisWinHigh = useMemo(
    () => winRateAdaptiveHigh(eisRows, (r) => r.eisScore, [25, 15, 10]),
    [eisRows],
  );

  // Regulatory: closed deals with a MonitoredAsset entry.
  const regulatoryAllRows = useMemo(
    () => closedPortfolioRows.filter((r) => r.regulatoryScore != null),
    [closedPortfolioRows],
  );
  const regulatoryRho = useMemo(
    () => corrOnRows(regulatoryAllRows, (r) => r.regulatoryScore),
    [regulatoryAllRows],
  );
  const mcsRows = useMemo(
    () => enrichedChart1Rows.filter((r) => r.mcsAtEntry != null),
    [enrichedChart1Rows],
  );
  const mcsRho = useMemo(
    () => corrOnRows(mcsRows, (r) => r.mcsAtEntry ?? null),
    [mcsRows],
  );
  const regulatoryWinHigh = useMemo(
    () => winRateAdaptiveHigh(regulatoryAllRows, (r) => r.regulatoryScore, [50, 25, 15]),
    [regulatoryAllRows],
  );
  const regulatoryHasVariation = useMemo(() => {
    if (regulatoryAllRows.length < 2) return false;
    const scores = regulatoryAllRows.map((r) => r.regulatoryScore!);
    return new Set(scores).size > 1;
  }, [regulatoryAllRows]);

  const pplanWinHigh = useMemo(
    () => winRateAdaptiveHigh(pplanRows, (r) => r.pplan, [75, 60, 50, 40]),
    [pplanRows],
  );
  const sdsWinHigh = useMemo(
    () => winRateAdaptiveHigh(sdsRows, (r) => r.sds, [75, 60, 50, 40]),
    [sdsRows],
  );

  // ── Directional accuracy (up vs down separately) ──────────────────────────
  const winOnlyRows  = useMemo(() => pplanRows.filter((r) => r.pnl > 0), [pplanRows]);
  const loseOnlyRows = useMemo(() => pplanRows.filter((r) => r.pnl < 0), [pplanRows]);
  const sdsWinOnly   = useMemo(() => sdsRows.filter((r) => r.pnl > 0), [sdsRows]);
  const sdsLoseOnly  = useMemo(() => sdsRows.filter((r) => r.pnl < 0), [sdsRows]);
  const regWinOnly   = useMemo(() => regulatoryAllRows.filter((r) => r.pnl > 0), [regulatoryAllRows]);
  const regLoseOnly  = useMemo(() => regulatoryAllRows.filter((r) => r.pnl < 0), [regulatoryAllRows]);
  const eisWinOnly   = useMemo(() => eisRows.filter((r) => r.pnl > 0), [eisRows]);
  const eisLoseOnly  = useMemo(() => eisRows.filter((r) => r.pnl < 0), [eisRows]);
  const mcsWinOnly   = useMemo(() => mcsRows.filter((r) => r.pnl > 0), [mcsRows]);
  const mcsLoseOnly  = useMemo(() => mcsRows.filter((r) => r.pnl < 0), [mcsRows]);

  const rho = (pts: CompRow[], x: (r: CompRow) => number | null) =>
    corrOnRows(pts, x, CORR_SUMMARY_MIN_N);

  const compareDirectional = useMemo(
    () => ({
      pplan: {
        up: rho(compareWinRows, (r) => r.pplan),
        down: rho(compareLoseRows, (r) => r.pplan),
      },
      mcs: {
        up: rho(compareWinRows, (r) => r.mcsAtEntry ?? null),
        down: rho(compareLoseRows, (r) => r.mcsAtEntry ?? null),
      },
      mcsMove: {
        up: rho(mcsMoveUpRows, (r) => r.mcsAtEntry ?? null),
        down: rho(mcsMoveDownRows, (r) => r.mcsAtEntry ?? null),
      },
    }),
    [compareWinRows, compareLoseRows, mcsMoveUpRows, mcsMoveDownRows],
  );

  // Rescue directional: among loss-triggered positions, split by recovery outcome
  const rescueRecovered = useMemo(() => lossRows.filter((r) => r.pnl > -2), [lossRows]);
  const rescueStillLoss = useMemo(() => lossRows.filter((r) => r.pnl <= -2), [lossRows]);

  const directional = useMemo(() => ({
    pplan:      { up: rho(winOnlyRows,  (r) => r.pplan),          down: rho(loseOnlyRows,  (r) => r.pplan),          nUp: winOnlyRows.length,        nDown: loseOnlyRows.length        },
    sds:        { up: rho(sdsWinOnly,   (r) => r.sds),             down: rho(sdsLoseOnly,   (r) => r.sds),             nUp: sdsWinOnly.length,         nDown: sdsLoseOnly.length         },
    regulatory: { up: rho(regWinOnly,   (r) => r.regulatoryScore), down: rho(regLoseOnly,   (r) => r.regulatoryScore), nUp: regWinOnly.length,         nDown: regLoseOnly.length         },
    eis:        { up: rho(eisWinOnly,   (r) => r.eisScore),        down: rho(eisLoseOnly,   (r) => r.eisScore),        nUp: eisWinOnly.length,         nDown: eisLoseOnly.length         },
    rescue:     { up: rho(rescueRecovered, (r) => r.rescueScore),  down: rho(rescueStillLoss, (r) => r.rescueScore),   nUp: rescueRecovered.length,    nDown: rescueStillLoss.length     },
    mcs:        { up: rho(mcsWinOnly,   (r) => r.mcsAtEntry ?? null), down: rho(mcsLoseOnly,   (r) => r.mcsAtEntry ?? null), nUp: mcsWinOnly.length,         nDown: mcsLoseOnly.length         },
  }), [winOnlyRows, loseOnlyRows, sdsWinOnly, sdsLoseOnly, regWinOnly, regLoseOnly, eisWinOnly, eisLoseOnly, rescueRecovered, rescueStillLoss, mcsWinOnly, mcsLoseOnly]);

  const corrCi = (r: number | null, n: number) =>
    r != null && n >= 4 ? fisherZ95Ci(r, n) : null;

  const tertiles = useMemo(
    () => ({
      pplan: scoreTertileSpread(pplanRows, (r) => r.pplan),
      sds: scoreTertileSpread(sdsRows, (r) => r.sds),
      eis: scoreTertileSpread(eisRows, (r) => r.eisScore),
      regulatory: scoreTertileSpread(regulatoryAllRows, (r) => r.regulatoryScore),
    }),
    [pplanRows, sdsRows, eisRows, regulatoryAllRows],
  );

  /** Chart-1 universe with T+3 stock move — second correlation view (not closed-sim P&L). */
  const t3CorrSummary = useMemo(() => {
    const base = excludePplanPlaceholders(
      enrichedChart1Rows.filter((r) => r.stockMove3dPct != null),
    );
    const sdsAtEntry = base.filter((r) => r.sds != null && r.sdsAtEntry);
    return [
      summarizeScoreOutcomeCorr("pplan", "P(plan)", base, (r) => r.pplan, (r) => r.stockMove3dPct),
      ...(sdsAtEntry.length >= 3
        ? [
            summarizeScoreOutcomeCorr(
              "sds",
              "SDS",
              sdsAtEntry,
              (r) => r.sds,
              (r) => r.stockMove3dPct,
            ),
          ]
        : []),
      summarizeScoreOutcomeCorr(
        "regulatory",
        "Regulatory score",
        base.filter((r) => r.regulatoryScore != null),
        (r) => r.regulatoryScore,
        (r) => r.stockMove3dPct,
        { invertedScale: true },
      ),
      summarizeScoreOutcomeCorr(
        "eis",
        "EIS Score",
        base.filter((r) => r.eisScore != null),
        (r) => r.eisScore,
        (r) => r.stockMove3dPct,
      ),
      summarizeScoreOutcomeCorr(
        "mcs",
        "Market Context (MCS)",
        base.filter((r) => r.mcsAtEntry != null),
        (r) => r.mcsAtEntry ?? null,
        (r) => r.stockMove3dPct,
        { invertedScale: true },
      ),
    ].filter((row) => row.n >= 3);
  }, [enrichedChart1Rows]);


  if (loading) {
    return (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-6">
        <p className="text-[11px] text-ink-muted animate-pulse">
          Loading model comparison data...
        </p>
      </div>
    );
  }

  const hasSds = sdsRows.length >= 3;
  const it = lang === "it";
  const portfolioCohortLabel = it
    ? "Coorte: deal portafoglio chiusi"
    : "Cohort: closed portfolio deals";
  const chartCohortNote = (chartN: number, cardN: number, extra?: string) =>
    it
      ? `Grafico n=${chartN} (${chart1View}) · card n=${cardN} (portafoglio)${extra ? ` · ${extra}` : ""}`
      : `Chart n=${chartN} (${chart1View}) · card n=${cardN} (portfolio)${extra ? ` · ${extra}` : ""}`;
  const sdsCoverageNote =
    sdsRows.length > 0
      ? it
        ? `SDS all'ingresso · ${sdsRows.length}/${closedPortfolioRows.length} deal`
        : `Entry SDS only · ${sdsRows.length}/${closedPortfolioRows.length} deals`
      : it
        ? "SDS all'ingresso — nessun deal con entry_sds"
        : "Entry SDS only — no deals with entry_sds yet";

  return (
    <div className="space-y-4 pb-4">

      {/* ── Header + stat cards ──────────────────────────────────────── */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-gradient-to-br from-indigo-50/60 via-violet-50/30 to-white p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Predictive model comparison
          </h3>
          <p className="text-[10px] text-ink-muted mt-0.5 max-w-2xl leading-relaxed">
            Models operate at different stages and are <strong>complementary</strong>, not interchangeable.{" "}
            <strong>P(plan)</strong> evaluates composite entry reliability ·{" "}
            <strong>SDS</strong> captures the pre-catalyst price pattern ·{" "}
            <strong>Rescue</strong> estimates recovery probability for loss positions.
          </p>
        </div>

        {error && (
          <p className="text-[10px] text-rose-500 bg-rose-50 border border-rose-200 rounded px-2 py-1">
            {error}
          </p>
        )}

        <p className="text-[9px] text-ink-muted/80 leading-relaxed">
          <strong>r↑ / r↓</strong> {it ? "sono la metrica principale" : "are the primary metrics"}:{" "}
          {it
            ? "gli score predicono soprattutto la mitigazione delle perdite (r↓), non l'upside (r↑)."
            : "scores mainly predict loss mitigation (r↓), not upside (r↑)."}
          {" "}
          <strong>r (all)</strong> {it ? "con CI 95% Fisher z" : "with 95% Fisher z CI"} —{" "}
          {it
            ? "con n≈26 gli intervalli si sovrappongono: non re-pesare gli indici su questa dashboard."
            : "at n≈26 CIs overlap heavily — do not re-weight indices from this panel alone."}
        </p>

        <p className="text-[9px] text-amber-700/90 bg-amber-50/80 border border-amber-200/60 rounded px-2 py-1.5 leading-relaxed">
          {it ? (
            <>
              <strong>Range restriction:</strong> il portafoglio reale tronca gli score bassi (ingresso condizionato).
              Le card usano i deal <strong>portafoglio chiusi</strong>. I placeholder P(plan)=50 sono esclusi dalla correlazione.
              Regulatory: <strong>+ = rischio, − = favorevole</strong> (r negativo atteso se lo score funziona).
              EIS: somma aggregata su [CD-90g, CD]; n=15 troppo basso per inferire un meccanismo di mean-reversion — CI attraversa zero.
            </>
          ) : (
            <>
              <strong>Range restriction:</strong> real portfolio truncates low scores (entry was score-conditioned).
              Cards use <strong>closed portfolio deals</strong>. P(plan)=50 placeholders excluded from correlation.
              Regulatory: <strong>+ = risk, − = favourable</strong> (negative r expected if score works).
              EIS: aggregate sum over [CD-90d, CD]; n=15 too small to infer a mean-reversion mechanism — CI overlaps zero.
            </>
          )}
        </p>

        {/* ── Data freshness row ─────────────────────────────────────── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-ink-muted/70 border-t border-[rgb(var(--border))]/20 pt-2">
          <span>
            <span className="font-semibold text-ink-muted">Closed deals:</span>{" "}
            <span className="tabular-nums font-bold text-ink">{closedPortfolioRows.length}</span>
            {outcomesGeneratedAt && (
              <> · gen. <span className="tabular-nums">{fmtTs(outcomesGeneratedAt)}</span></>
            )}
          </span>
          {sdsGeneratedAt && (
            <span>
              <span className="font-semibold text-ink-muted">SDS snapshot:</span>{" "}
              {sdsN != null && <><span className="tabular-nums font-bold text-ink">{sdsN}</span> ticker · </>}
              gen. <span className="tabular-nums">{fmtTs(sdsGeneratedAt)}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <StatCard
            label="P(plan)"
            sublabel="Composite entry score"
            rho={pplanRho}
            rhoCi={corrCi(pplanRho, pplanRows.length)}
            rhoUp={directional.pplan.up}
            rhoDown={directional.pplan.down}
            nUp={directional.pplan.nUp}
            nDown={directional.pplan.nDown}
            winRateQ4={pplanWinHigh?.pct ?? null}
            winRateLabel={winRateHighLabel(pplanWinHigh)}
            n={pplanRows.length}
            color="#6366f1"
            cohortLabel={portfolioCohortLabel}
            tertileSpread={tertiles.pplan}
          />
          <StatCard
            label="SDS"
            sublabel="Pre-catalyst price pattern"
            rho={sdsRho}
            rhoCi={corrCi(sdsRho, sdsRows.length)}
            rhoUp={directional.sds.up}
            rhoDown={directional.sds.down}
            nUp={directional.sds.nUp}
            nDown={directional.sds.nDown}
            winRateQ4={sdsWinHigh?.pct ?? null}
            winRateLabel={winRateHighLabel(sdsWinHigh)}
            n={sdsRows.length}
            color="#06b6d4"
            cohortLabel={portfolioCohortLabel}
            tertileSpread={tertiles.sds}
            note={sdsCoverageNote}
          />
          <StatCard
            label="Resilience Score"
            sublabel="Recovery & growth capacity (ticker-intrinsic)"
            rho={resilienceRho}
            rhoCi={corrCi(resilienceRho, resilienceRows.length)}
            rhoUp={resilienceDirectional.up}
            rhoDown={resilienceDirectional.down}
            nUp={resilienceDirectional.nUp}
            nDown={resilienceDirectional.nDown}
            winRateQ4={null}
            winRateLabel={undefined}
            n={resilienceRows.length}
            color="#10b981"
            unmeasured={resilienceRows.length < CORR_UNMEASURED_N}
            cohortLabel={portfolioCohortLabel}
            note={
              resilienceIndex.size === 0
                ? "No snapshot — run desktop-snapshots (rebuild data/resilience_scores_snapshot.json)"
                : `${resilienceRows.length}/${closedPortfolioRows.length} scored · 5y drawdown-recovery + β asym + upside capacity · independent from SDS / Regulatory · click for breakdown`
            }
            onClick={resilienceIndex.size > 0 ? () => setResilienceModalOpen(true) : undefined}
          />
          <StatCard
            label="Regulatory score"
            sublabel="CRL · PDUFA · CMC (− fav · + risk)"
            rho={regulatoryRho}
            rhoCi={corrCi(regulatoryRho, regulatoryAllRows.length)}
            rhoUp={directional.regulatory.up}
            rhoDown={directional.regulatory.down}
            nUp={directional.regulatory.nUp}
            nDown={directional.regulatory.nDown}
            winRateQ4={regulatoryWinHigh?.pct ?? null}
            winRateLabel={winRateHighLabel(regulatoryWinHigh, 50)}
            n={regulatoryAllRows.length}
            color="#dc2626"
            cohortLabel={portfolioCohortLabel}
            tertileSpread={tertiles.regulatory}
            note={
              regulatoryAllRows.length === 0
                ? "No data — run regulatory_risk_refresh.py"
                : !regulatoryHasVariation
                  ? `All ${regulatoryAllRows.length} scanned — uniform score`
                  : `${regulatoryAllRows.filter((r) => (r.regulatoryScore ?? 0) < 0).length} favourable · ${regulatoryAllRows.filter((r) => (r.regulatoryScore ?? 0) > 0).length} at risk · sign OK (+risk/−fav)`
            }
          />
          <StatCard
            label="EIS Score"
            sublabel="Pre-CD [CD−90d, CD] aggregate · exploratory"
            rho={eisRho}
            rhoCi={corrCi(eisRho, eisRows.length)}
            rhoUp={directional.eis.up}
            rhoDown={directional.eis.down}
            nUp={directional.eis.nUp}
            nDown={directional.eis.nDown}
            winRateQ4={eisWinHigh?.pct ?? null}
            winRateLabel={winRateHighLabel(eisWinHigh, 25)}
            n={eisRows.length}
            color="#0ea5e9"
            cohortLabel={portfolioCohortLabel}
            tertileSpread={tertiles.eis}
            note={
              eisRows.length === 0
                ? "No data — run eis_morning_refresh.py"
                : `${eisRows.length}${eisRows.length < pplanRows.length ? `/${pplanRows.length}` : ""} closed sim deals — too few for cohort inference. CI overlaps zero; do not decompose by band or threshold at this n.`
            }
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[9px] text-ink-muted pt-0.5">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            |r| ≥ 0.30 — directional signal (exploratory at this n)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            |r| 0.10–0.29 — weak / CI overlaps zero
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
            |r| &lt; 0.10 — indistinguishable from noise
          </span>
        </div>
      </div>

      {/* ── Chart 1: Closed deals — score vs final P&L ──────────────── */}
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
        <div>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h4 className="text-xs font-semibold text-ink">
                Chart 1 — Closed deals: model score vs final P&L
              </h4>
              <span className="text-[9px] text-ink-muted/60 tabular-nums">
                n=<strong className="text-ink">{chart1Rows.length}</strong> closed deals
                
                {outcomesGeneratedAt && <> · {fmtTs(outcomesGeneratedAt)}</>}
                {(() => {
                  const nDefault = chart1Rows.filter((r) => r.pplanIsDefault).length;
                  const nExcluded = chart1Rows.length - chart1PplanRows.length;
                  return nExcluded > 0 ? (
                    <span className="ml-2 text-amber-600/80">
                      — {nExcluded} excluded from correlation (P(plan) placeholder X=50)
                      {nDefault > 0 ? ` · ${nDefault} portfolio without history` : ""}
                    </span>
                  ) : null;
                })()}
              </span>
            </div>
            <ScatterUniverseSwitcher value={chart1View} onChange={setChart1View} />
          </div>
          <p className="text-[10px] text-ink-muted">
            X = score at entry · Y = final P&L% ·{" "}
            <span className="text-emerald-600 font-medium">green = win</span>{" "}
            <span className="text-rose-500 font-medium">red = loss</span>{" "}
            · dashed reference = y=0
          </p>
          <p className="text-[10px] text-ink-muted/85">
            Fit lines:{" "}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-4 h-0.5 bg-indigo-500 align-middle" />
              <strong>solid</strong> = Theil-Sen (robust, median-of-pairs slope)
            </span>{" "}
            <span className="mx-1 text-ink-muted/50">·</span>
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block w-4 align-middle border-t-[1.5px] border-dashed"
                style={{ borderColor: "#94a3b8" }}
              />
              <strong>dashed grey</strong> = OLS (least-squares, sensitive to outliers)
            </span>
            . When the two diverge, OLS is being pulled by 1-2 high-leverage points and Theil-Sen better reflects the typical relationship.
          </p>
          <p className="text-[10px] text-ink-muted/80">
            Resilience scatter uses the ticker-intrinsic score (5y drawdown-recovery + β asymmetry + upside capacity) — independent from SDS / Regulatory.
          </p>
        </div>

        <div className={FIVE_COL_SCATTER_GRID} style={modelScatterGridStyle}>
          <MiniScatter
            title="P(plan) vs P&L"
            note={chartCohortNote(chart1PplanRows.length, pplanRows.length)}
            pts={chart1PplanRows.map((r) => ({ x: r.pplan, y: r.pnl, ticker: r.ticker, isWin: r.isWin, isOpen: r.isOpen, universe: r.universe, raw: r.raw }))}
            xLabel="P(plan) %"
            nTotal={chart1PplanRows.length}
            rhoUp={chart1PplanDirectional.up}
            rhoDown={chart1PplanDirectional.down}
            onOpenDetails={() => setDetailModal({ title: "P(plan) vs P&L", pts: chart1PplanRows.map((r) => ({ x: r.pplan, y: r.pnl, ticker: r.ticker, isWin: r.isWin, isOpen: r.isOpen, universe: r.universe, raw: r.raw })) })}
          />
          <MiniScatter
            title="SDS vs P&L"
            note={
              hasSds
                ? chartCohortNote(chart1SdsRows.length, sdsRows.length, it ? "SDS all'ingresso" : "entry SDS")
                : sdsCoverageNote
            }
            pts={chart1SdsRows.map((r) => ({
              x: r.sds!,
              y: r.pnl,
              ticker: r.ticker,
              isWin: r.isWin,
              isOpen: r.isOpen,
              universe: r.universe,
              raw: r.raw,
            }))}
            xLabel="SDS score"
            nTotal={chart1SdsRows.length}
            rhoUp={chart1SdsDirectional.up}
            rhoDown={chart1SdsDirectional.down}
            onOpenDetails={() => setDetailModal({ title: "SDS vs P&L", pts: chart1SdsRows.map((r) => ({ x: r.sds!, y: r.pnl, ticker: r.ticker, isWin: r.isWin, isOpen: r.isOpen, universe: r.universe, raw: r.raw })) })}
          />
          <RescueScoreScatter
            title="Resilience Score vs P&L"
            note="● loss cohort · ◇ non-loss · ticker-intrinsic score (5y history)"
            groupA={resilienceEnrichedRows
              .filter((r) => r.isLoss && r.resilienceScore != null)
              .map((r) => compRowToScatterPt(r, r.resilienceScore as number, mcsDoc))}
            groupB={resilienceEnrichedRows
              .filter((r) => !r.isLoss && r.resilienceScore != null)
              .map((r) => compRowToScatterPt(r, r.resilienceScore as number, mcsDoc))}
            recoveryLabel={`${resilienceEnrichedRows.filter((r) => r.isLoss && r.isWin && r.resilienceScore != null).length} recoveries in ${resilienceEnrichedRows.filter((r) => r.isLoss && r.resilienceScore != null).length} scored loss deals`}
            xLabel="Resilience score"
            onOpenDetails={() =>
              setDetailModal({
                title: "Resilience Score vs P&L",
                pts: [
                  ...resilienceEnrichedRows
                    .filter((r) => r.isLoss && r.resilienceScore != null)
                    .map((r) => compRowToScatterPt(r, r.resilienceScore as number, mcsDoc)),
                  ...resilienceEnrichedRows
                    .filter((r) => !r.isLoss && r.resilienceScore != null)
                    .map((r) => compRowToScatterPt(r, r.resilienceScore as number, mcsDoc)),
                ],
              })
            }
          />
          <MiniScatter
            title="Regulatory score vs P&L"
            minPts={2}
            xMin={REGULATORY_SCORE_X_MIN}
            xMax={REGULATORY_SCORE_X_MAX}
            note={(() => {
              const nScanned = new Set(chart1Rows.filter(r => r.regulatoryScore !== null).map(r => r.ticker)).size;
              const nRisk = new Set(chart1Rows.filter(r => r.regulatoryScore != null && r.regulatoryScore > 0).map(r => r.ticker)).size;
              const nFav = new Set(chart1Rows.filter(r => r.regulatoryScore != null && r.regulatoryScore < 0).map(r => r.ticker)).size;
              const nNotScanned = new Set(chart1Rows.filter(r => r.regulatoryScore === null).map(r => r.ticker)).size;
              if (nScanned === 0) return "Run regulatory_risk_refresh.py to populate data";
              return `${nFav} favourable · ${nRisk} at risk · ${nScanned} scanned${nNotScanned > 0 ? ` · ${nNotScanned} not scanned` : ""}`;
            })()}
            pts={(() => {
              const byTicker = new Map<string, { x: number; ys: number[]; wins: number; raw: SimOutcomeRow | undefined }>();
              for (const r of chart1Rows) {
                if (r.regulatoryScore === null || r.regulatoryScore === 0) continue;
                const e = byTicker.get(r.ticker);
                if (e) { e.ys.push(r.pnl); if (r.isWin) e.wins++; }
                else byTicker.set(r.ticker, { x: r.regulatoryScore, ys: [r.pnl], wins: r.isWin ? 1 : 0, raw: r.raw });
              }
              return Array.from(byTicker.entries()).map(([ticker, e]) => ({
                x: e.x,
                y: e.ys.reduce((s, v) => s + v, 0) / e.ys.length,
                ticker,
                isWin: e.wins > e.ys.length / 2,
                raw: e.raw,
              }));
            })()}
            noSignalPts={(() => {
              const byTicker = new Map<string, { ys: number[]; wins: number; raw: SimOutcomeRow | undefined }>();
              for (const r of chart1Rows) {
                if (r.regulatoryScore !== 0) continue;
                const e = byTicker.get(r.ticker);
                if (e) { e.ys.push(r.pnl); if (r.isWin) e.wins++; }
                else byTicker.set(r.ticker, { ys: [r.pnl], wins: r.isWin ? 1 : 0, raw: r.raw });
              }
              return Array.from(byTicker.entries()).map(([ticker, e]) => ({
                x: 0,
                y: e.ys.reduce((s, v) => s + v, 0) / e.ys.length,
                ticker,
                isWin: e.wins > e.ys.length / 2,
                raw: e.raw,
              }));
            })()}
            xLabel="Regulatory score (−100…+100)"
            rhoUp={directional.regulatory.up}
            rhoDown={directional.regulatory.down}
            onOpenDetails={() => {
              const byTicker = new Map<string, { x: number; ys: number[]; wins: number; raw: SimOutcomeRow | undefined }>();
              for (const r of chart1Rows) {
                if (r.regulatoryScore === null || r.regulatoryScore === 0) continue;
                const e = byTicker.get(r.ticker);
                if (e) { e.ys.push(r.pnl); if (r.isWin) e.wins++; }
                else byTicker.set(r.ticker, { x: r.regulatoryScore, ys: [r.pnl], wins: r.isWin ? 1 : 0, raw: r.raw });
              }
              setDetailModal({
                title: "Regulatory score vs P&L",
                pts: Array.from(byTicker.entries()).map(([ticker, e]) => ({
                  x: e.x,
                  y: e.ys.reduce((s, v) => s + v, 0) / e.ys.length,
                  ticker,
                  isWin: e.wins > e.ys.length / 2,
                  raw: e.raw,
                })),
              });
            }}
          />
          <MiniScatter
            title="EIS Score vs P&L"
            minPts={2}
            xMin={-60}
            xMax={60}
            note={(() => {
              const nSignal = chart1EisRows.filter((r) => r.eisScore !== 0).length;
              if (chart1EisRows.length === 0) return "No EIS data — run eis_morning_refresh.py";
              return chartCohortNote(chart1EisRows.length, eisRows.length, `${nSignal} ≠0`);
            })()}
            pts={chart1EisRows.filter((r) => r.eisScore !== 0).map((r) => ({
              x: r.eisScore!,
              y: r.pnl,
              ticker: r.ticker,
              isWin: r.isWin,
              isOpen: r.isOpen,
              universe: r.universe,
              raw: r.raw,
            }))}
            noSignalPts={chart1EisRows.filter((r) => r.eisScore === 0).map((r) => ({
              x: 0,
              y: r.pnl,
              ticker: r.ticker,
              isWin: r.isWin,
              raw: r.raw,
            }))}
            xLabel="EIS score"
            rhoUp={chart1EisDirectional.up}
            rhoDown={chart1EisDirectional.down}
            nTotal={chart1EisRows.length}
            onOpenDetails={() => setDetailModal({
              title: "EIS Score vs P&L",
              pts: chart1EisRows.filter((r) => r.eisScore !== 0).map((r) => ({
                x: r.eisScore!,
                y: r.pnl,
                ticker: r.ticker,
                isWin: r.isWin,
                isOpen: r.isOpen,
                universe: r.universe,
                raw: r.raw,
              })),
            })}
          />
        </div>

        <div className="flex flex-wrap gap-3 text-[9px] text-ink-muted/70 pt-0.5">
          {!hasSds && (
            <span>
              {it
                ? "SDS correlazione: servono ≥3 deal chiusi con entry_sds_score (o snapshot congelato). I nuovi trade lo popolano automaticamente."
                : "SDS correlation: need ≥3 closed deals with entry_sds_score (or frozen snapshot). New trades populate automatically."}
            </span>
          )}
        </div>
      </div>

      {/* ── Chart 2: Readout vs forward 3d stock move ───────────────────────────── */}
      {/*
       * Perf: wrapper element carries the ref so the IntersectionObserver
       * fires as soon as this section approaches the viewport; the heavy
       * ResponsiveContainers below only mount once ``chart2Section.inView``
       * flips. The placeholder is deliberately empty (users see Chart 1
       * fully rendered above; the "Chart 2" block appears within a frame
       * of arriving in view thanks to the 280px rootMargin).
       */}
      <div ref={chart2Section.ref} className="min-h-[8px]">
        {chart2Section.inView && (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h4 className="text-xs font-semibold text-ink">
                Chart 2 — Readout vs forward 3d stock move
            </h4>
            <p className="text-[10px] text-ink-muted">
                X = score at measurement · Y = stock move T+3 (3 trading days after score) ·{" "}
                <span className="text-emerald-600 font-medium">green = up</span>{" "}
                <span className="text-rose-500 font-medium">red = down</span>
                {" · "}
                <span className="font-medium tabular-nums">
                  entries n={chart2ForwardEntryRows.length}
                  {chart2EisFeedPts.length > 0 ? ` · EIS events n=${chart2EisFeedPts.length}` : ""}
                  {chart2View !== "all" ? ` · ${chart2View}` : ""}
                </span>
                {chart2EisFeedPts.length > 0 ? (
                  <span className="text-ink-muted/80">
                    {" "}
                    (EIS: feed events filtered by {chart2View === "all" ? "all tickers" : chart2View} universe)
                  </span>
                ) : null}
            </p>
          </div>
            <ScatterUniverseSwitcher value={chart2View} onChange={setChart2View} />
          </div>
          <div className={FIVE_COL_SCATTER_GRID} style={modelScatterGridStyle}>
            <MiniScatter
              title="P(plan) vs T+3 move"
              note={`n=${chart2ForwardEntryRows.length} · open+closed entries`}
              pts={chart2ForwardEntryRows.map((r) => ({
                x: r.pplan,
                y: r.forward3dPct!,
                ticker: r.ticker,
                isWin: r.forward3dPct! >= 0,
                isOpen: r.isOpen,
                universe: r.universe,
              }))}
              xLabel="P(plan) %"
              onOpenDetails={() =>
                setDetailModal({
                  title: "P(plan) vs T+3 move",
                  pts: chart2ForwardEntryRows.map((r) => ({
                    x: r.pplan,
                    y: r.forward3dPct!,
                    ticker: r.ticker,
                    isWin: r.forward3dPct! >= 0,
                    isOpen: r.isOpen,
                    universe: r.universe,
                  })),
                })
              }
            />
            <MiniScatter
              title="SDS vs T+3 move"
              note={
                chart2ForwardSdsRows.length < chart2ForwardEntryRows.filter((r) => r.sds != null).length
                  ? `n=${chart2ForwardSdsRows.length} entry SDS · live SDS excluded`
                  : `n=${chart2ForwardSdsRows.length} entry SDS`
              }
              pts={chart2ForwardSdsRows.map((r) => ({
                x: r.sds!,
                y: r.forward3dPct!,
                ticker: r.ticker,
                isWin: r.forward3dPct! >= 0,
                isOpen: r.isOpen,
                universe: r.universe,
              }))}
              xLabel="SDS score"
              nTotal={chart2ForwardSdsRows.length}
              onOpenDetails={() =>
                setDetailModal({
                  title: "SDS vs T+3 move",
                  pts: chart2ForwardSdsRows.map((r) => ({
                    x: r.sds!,
                    y: r.forward3dPct!,
                    ticker: r.ticker,
                    isWin: r.forward3dPct! >= 0,
                    isOpen: r.isOpen,
                    universe: r.universe,
                  })),
                })
              }
            />
            <RescueScoreScatter
              title="Resilience Score vs T+3 move"
              note="● down T+3 · ◇ up T+3 · ticker-intrinsic (5y history)"
              groupA={chart2ForwardEntryRows
                .filter((r) => (r.forward3dPct ?? 0) < 0)
                .map((r) => {
                  const entry = resilienceIndex.get(r.ticker.toUpperCase());
                  const x = entry && entry.status === "ok" ? entry.resilience_score : null;
                  return x == null
                    ? null
                    : {
                        x,
                        y: r.forward3dPct!,
                        ticker: r.ticker,
                        isWin: false,
                        isOpen: r.isOpen,
                        universe: r.universe,
                      };
                })
                .filter((p): p is NonNullable<typeof p> => p !== null)}
              groupB={chart2ForwardEntryRows
                .filter((r) => (r.forward3dPct ?? 0) >= 0)
                .map((r) => {
                  const entry = resilienceIndex.get(r.ticker.toUpperCase());
                  const x = entry && entry.status === "ok" ? entry.resilience_score : null;
                  return x == null
                    ? null
                    : {
                        x,
                        y: r.forward3dPct!,
                        ticker: r.ticker,
                        isWin: true,
                        isOpen: r.isOpen,
                        universe: r.universe,
                      };
                })
                .filter((p): p is NonNullable<typeof p> => p !== null)}
              recoveryLabel={`${chart2ForwardEntryRows.filter((r) => (r.forward3dPct ?? 0) < 0).length} down T+3 · ${chart2ForwardEntryRows.filter((r) => (r.forward3dPct ?? 0) >= 0).length} up T+3`}
              xLabel="Resilience score"
              onOpenDetails={() => {
                const buildPt = (r: (typeof chart2ForwardEntryRows)[number], isWin: boolean) => {
                  const entry = resilienceIndex.get(r.ticker.toUpperCase());
                  const x = entry && entry.status === "ok" ? entry.resilience_score : null;
                  return x == null
                    ? null
                    : {
                        x,
                        y: r.forward3dPct!,
                        ticker: r.ticker,
                        isWin,
                        isOpen: r.isOpen,
                        universe: r.universe,
                      };
                };
                setDetailModal({
                  title: "Resilience Score vs T+3 move",
                  pts: [
                    ...chart2ForwardEntryRows
                      .filter((r) => (r.forward3dPct ?? 0) < 0)
                      .map((r) => buildPt(r, false))
                      .filter((p): p is NonNullable<typeof p> => p !== null),
                    ...chart2ForwardEntryRows
                      .filter((r) => (r.forward3dPct ?? 0) >= 0)
                      .map((r) => buildPt(r, true))
                      .filter((p): p is NonNullable<typeof p> => p !== null),
                  ],
                });
              }}
            />
            <MiniScatter
              title="Regulatory score vs T+3 move"
              minPts={2}
              xMin={REGULATORY_SCORE_X_MIN}
              xMax={REGULATORY_SCORE_X_MAX}
              note={`n=${chart2ForwardEntryRows.filter((r) => r.regulatoryScore !== null).length} entries`}
              pts={chart2ForwardEntryRows
                .filter((r) => r.regulatoryScore !== null && r.regulatoryScore !== 0)
                .map((r) => ({
                  x: r.regulatoryScore!,
                  y: r.forward3dPct!,
                  ticker: r.ticker,
                  isWin: r.forward3dPct! >= 0,
                  isOpen: r.isOpen,
                  universe: r.universe,
                }))}
              noSignalPts={chart2ForwardEntryRows
                .filter((r) => r.regulatoryScore === 0)
                .map((r) => ({
                  x: 0,
                  y: r.forward3dPct!,
                  ticker: r.ticker,
                  isWin: r.forward3dPct! >= 0,
                }))}
              xLabel="Regulatory score (−100…+100)"
              onOpenDetails={() =>
                setDetailModal({
                  title: "Regulatory score vs T+3 move",
                  pts: chart2ForwardEntryRows
                    .filter((r) => r.regulatoryScore !== null && r.regulatoryScore !== 0)
                    .map((r) => ({
                      x: r.regulatoryScore!,
                      y: r.forward3dPct!,
                      ticker: r.ticker,
                      isWin: r.forward3dPct! >= 0,
                      isOpen: r.isOpen,
                      universe: r.universe,
                    })),
                })
              }
            />
            <MiniScatter
              title="EIS vs T+3 move"
              minPts={2}
              xMin={-60}
              xMax={60}
              note={(() => {
                const nManual = chart2EisFeedPts.filter((p) => p.source === "feed_manual").length;
                const nAuto = chart2EisFeedPts.filter((p) => p.source === "feed_auto").length;
                const nSignal = chart2EisFeedPts.filter((p) => p.x !== 0).length;
                const nPos = chart2ForwardEntryRows.filter((r) => r.eisScore != null && r.eisScore !== 0).length;
                if (!chart2EisFeedPts.length && !nPos) {
                  return it
                    ? `Nessun evento EIS per universo ${chart2View} — prova All`
                    : `No EIS events for ${chart2View} universe — try All`;
                }
                const universeNote =
                  chart2View === "all"
                    ? it
                      ? "tutti i ticker portafoglio"
                      : "all portfolio tickers"
                    : "portafoglio";
                return `n=${chart2EisFeedPts.length} events (${universeNote}) · ${nSignal} ≠0 · ${nAuto} auto · ${nManual} manual ✍ · ${nPos} posizioni`;
              })()}
              pts={chart2EisFeedPts.filter((p) => p.x !== 0).map(readoutPointToMini)}
              noSignalPts={chart2EisFeedPts.filter((p) => p.x === 0).map(readoutPointToMini)}
              xLabel="EIS score (per event)"
              nTotal={chart2EisFeedPts.length}
              onOpenDetails={() =>
                setDetailModal({
                  title: `EIS vs T+3 move (${chart2View})`,
                  pts: chart2EisFeedPts.map(readoutPointToMini),
                })
              }
            />
          </div>
        </div>
      )}

      {/* ── Correlation summary table ─────────────────────────────────── */}
      {closedPortfolioRows.length >= 5 && (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div>
            <p className="text-xs font-semibold text-ink">
              Correlation summary — model score vs P&L%
            </p>
            <p className="text-[10px] text-ink-muted leading-relaxed">
              Cards: closed <strong>portfolio</strong> cohort with 95% CI (Fisher z). Chart: selected universe (All/Portfolio).
              Primary metrics: <strong>r↑</strong> (gains) and <strong>r↓</strong> (losses — higher score → smaller loss).
              Tertile ΔP&L on cards = robust spread high−low bucket means.
              Regulatory inverted scale: negative r on gains is expected (+risk / −favourable convention verified).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b-2 border-[rgb(var(--border))]/50">
                  <th className="text-left py-2 pr-4 font-semibold text-ink">Model</th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n trades</th>
                  <th className="text-center py-2 px-3 font-semibold text-ink-muted border-l border-[rgb(var(--border))]/30">
                    r (all)
                    <br /><span className="text-[8px] font-normal">95% CI</span>
                  </th>
                  <th className="text-center py-2 px-3 font-semibold text-emerald-600">
                    r↑
                    <br /><span className="text-[8px] font-normal">(gains)</span>
                  </th>
                  <th className="text-center py-2 px-3 font-semibold text-rose-500">
                    r↓
                    <br /><span className="text-[8px] font-normal">(losses)</span>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-emerald-600">
                    Win rate
                    <br /><span className="text-[8px] font-normal">score ≥75</span>
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n ↑</th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n ↓</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    { label: "P(plan)",         nTot: pplanRows.length,               rhoAll: pplanRho,    winHigh: pplanWinHigh,       dir: directional.pplan,      invertedScale: false, tertile: tertiles.pplan },
                    ...(hasSds ? [{ label: "SDS",             nTot: sdsRows.length,            rhoAll: sdsRho,      winHigh: sdsWinHigh,       dir: directional.sds,        invertedScale: false, tertile: tertiles.sds }] : []),
                    ...(resilienceRows.length >= 3 ? [{ label: "Resilience Score", nTot: resilienceRows.length,     rhoAll: resilienceRho, winHigh: null,             dir: resilienceDirectional, invertedScale: false, tertile: null, unmeasured: resilienceRows.length < CORR_UNMEASURED_N }] : []),
                    { label: "Regulatory score", nTot: regulatoryAllRows.length,  rhoAll: regulatoryRho, winHigh: regulatoryWinHigh, dir: directional.regulatory, invertedScale: true, tertile: tertiles.regulatory },
                    ...(eisRows.length >= 3 ? [{ label: "EIS Score",       nTot: eisRows.length,            rhoAll: eisRho,      winHigh: eisWinHigh,       dir: directional.eis,        invertedScale: false, tertile: tertiles.eis }] : []),
                    ...(mcsRows.length >= 3 ? [{ label: "Market Context (MCS)", nTot: mcsRows.length, rhoAll: mcsRho, winHigh: null, dir: directional.mcs, invertedScale: true, tertile: null }] : []),
                  ] as Array<{ label: string; nTot: number; rhoAll: number | null; winHigh: WinRateHighResult | null; dir: { up: number | null; down: number | null; nUp: number; nDown: number }; invertedScale: boolean; tertile: ScoreTertileSpread | null; unmeasured?: boolean }>
                ).map(({ label, nTot, rhoAll, winHigh, dir, invertedScale, tertile, unmeasured: rowUnmeasured }) => {
                  const rhoCell = (v: number | null) => {
                    if (v == null) return <span className="text-ink-muted/40">—</span>;
                    const positive = v >= 0;
                    const strong = Math.abs(v) >= 0.30;
                    const mid    = Math.abs(v) >= 0.10;
                    const goodSign = invertedScale ? !positive : positive;
                    const cls = !goodSign
                      ? (strong ? "text-rose-500 font-bold" : mid ? "text-rose-400" : "text-ink-muted")
                      : (strong ? "text-emerald-600 font-semibold" : mid ? "text-amber-600" : "text-ink-muted");
                    return (
                      <span className={`tabular-nums ${cls}`}>
                        {v >= 0 ? "+" : ""}{v.toFixed(2)}
                        {invertedScale && <span className="text-[8px] ml-0.5 opacity-60">*</span>}
                      </span>
                    );
                  };
                  return (
                    <tr key={label} className="border-b border-[rgb(var(--border))]/20 hover:bg-white/40">
                      <td className="py-2 pr-4 font-semibold text-ink whitespace-nowrap">{label}</td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{nTot}</td>
                      <td className="text-center px-3 border-l border-[rgb(var(--border))]/20">
                        {rowUnmeasured ? (
                          <span className="text-amber-700 text-[9px]">unmeasured</span>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5">
                            {rhoCell(rhoAll)}
                            <span className="text-[8px] text-ink-muted tabular-nums">
                              {formatFisherCi(corrCi(rhoAll, nTot))}
                            </span>
                            {tertile ? (
                              <span className="text-[8px] text-ink-muted/80" title="High tertile mean − low tertile mean P&L%">
                                Δ₃ {tertile.spreadHighLow >= 0 ? "+" : ""}{tertile.spreadHighLow.toFixed(1)}pp
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="text-center px-3">{rhoCell(dir.up)}</td>
                      <td className="text-center px-3">{rhoCell(dir.down)}</td>
                      <td className="text-center px-2 tabular-nums">
                        {winHigh != null ? (
                          <span
                            className={winHigh.pct >= 60 ? "text-emerald-600 font-semibold" : winHigh.pct >= 40 ? "text-amber-600" : "text-ink-muted"}
                            title={`n=${winHigh.n} trades with score ≥${winHigh.threshold}`}
                          >
                            {winHigh.pct}%
                            {winHigh.threshold !== 75 && label !== "EIS Score" && label !== "Regulatory score" ? (
                              <span className="text-[8px] text-ink-muted/70 ml-0.5">≥{winHigh.threshold}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{dir.nUp}</td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{dir.nDown}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[9px] text-ink-muted/60 leading-relaxed">
            <strong>Reading:</strong> prioritize <strong>r↓</strong> for downside filters when it is strong and its CI is away from 0.
            At current n most closed-sim |r| stay weak (≈0–0.3) and Fisher CIs overlap zero — no single index is statistically dominant; avoid winner&apos;s-curse re-weighting.
            See table below for the same scores vs <strong>T+3 stock move</strong> (different target / often stronger signal).
            Δ₃ = tertile spread (high−low mean P&amp;L%). Regulatory * = inverted scale (+risk / −favourable).
          </p>
        </div>
      )}

      {t3CorrSummary.length > 0 && (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div>
            <p className="text-xs font-semibold text-ink">
              Correlation summary — model score vs T+3 stock move%
            </p>
            <p className="text-[10px] text-ink-muted leading-relaxed">
              Same scores, different outcome: 3 trading-day move after entry (Chart 1/2 universe).
              Prefer this view for EIS / MCS timing; use the closed-sim P&amp;L table above for trade P&amp;L.
              New paper BUYs freeze P/SDS/EIS/Reg at entry so future rows stop mixing live drift.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b-2 border-[rgb(var(--border))]/50">
                  <th className="text-left py-2 pr-4 font-semibold text-ink">Model</th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n</th>
                  <th className="text-center py-2 px-3 font-semibold text-ink-muted border-l border-[rgb(var(--border))]/30">
                    r (all)
                    <br /><span className="text-[8px] font-normal">95% CI</span>
                  </th>
                  <th className="text-center py-2 px-3 font-semibold text-emerald-600">r↑</th>
                  <th className="text-center py-2 px-3 font-semibold text-rose-500">r↓</th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n ↑</th>
                  <th className="text-center py-2 px-2 font-semibold text-ink-muted">n ↓</th>
                </tr>
              </thead>
              <tbody>
                {t3CorrSummary.map((row) => {
                  const rhoCell = (v: number | null) => {
                    if (v == null) return <span className="text-ink-muted/40">—</span>;
                    const positive = v >= 0;
                    const strong = Math.abs(v) >= 0.3;
                    const mid = Math.abs(v) >= 0.1;
                    const goodSign = row.invertedScale ? !positive : positive;
                    const cls = !goodSign
                      ? strong
                        ? "text-rose-500 font-bold"
                        : mid
                          ? "text-rose-400"
                          : "text-ink-muted"
                      : strong
                        ? "text-emerald-600 font-semibold"
                        : mid
                          ? "text-amber-600"
                          : "text-ink-muted";
                    return (
                      <span className={`tabular-nums ${cls}`}>
                        {v >= 0 ? "+" : ""}
                        {v.toFixed(2)}
                        {row.invertedScale ? (
                          <span className="text-[8px] ml-0.5 opacity-60">*</span>
                        ) : null}
                      </span>
                    );
                  };
                  return (
                    <tr key={`t3-${row.id}`} className="border-b border-[rgb(var(--border))]/20 hover:bg-white/40">
                      <td className="py-2 pr-4 font-semibold text-ink whitespace-nowrap">{row.label}</td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{row.n}</td>
                      <td className="text-center px-3 border-l border-[rgb(var(--border))]/20">
                        <div className="flex flex-col items-center gap-0.5">
                          {rhoCell(row.rAll)}
                          <span className="text-[8px] text-ink-muted tabular-nums">
                            {formatFisherCi(corrCi(row.rAll, row.n))}
                          </span>
                        </div>
                      </td>
                      <td className="text-center px-3">{rhoCell(row.rUp)}</td>
                      <td className="text-center px-3">{rhoCell(row.rDown)}</td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{row.nUp}</td>
                      <td className="text-center px-2 text-ink-muted tabular-nums">{row.nDown}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
      {/* Chart 2 lazy-mount wrapper closes here. */}


      {/* ── Detail modal for scatter points ─────────────────────────── */}
      {detailModal && (
        <AppModal
          open={!!detailModal}
          onClose={() => setDetailModal(null)}
          aria-label={`Detail: ${detailModal.title}`}
          panelClassName="w-full max-w-5xl bg-white rounded-xl shadow-2xl border border-[rgb(var(--border))]/50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--border))]/50 bg-slate-50/60">
            <div>
              <h4 className="text-sm font-semibold text-ink">Detail: {detailModal.title}</h4>
              <p className="text-[10px] text-ink-muted">{detailModal.pts.length} positions</p>
            </div>
            <AppModalCloseButton onClose={() => setDetailModal(null)} />
          </div>
          <div className="max-h-[70vh] overflow-auto p-3">
            <table className="w-full text-[10px] border-collapse">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b-2 border-[rgb(var(--border))]/50 text-left">
                  <th className="py-2 pr-3 font-semibold text-ink">Ticker</th>
                  <th className="py-2 pr-3 font-semibold text-ink">Company</th>
                  <th className="py-2 pr-3 font-semibold text-ink">Type</th>
                  <th className="py-2 pr-3 font-semibold text-ink">Start date</th>
                  <th className="py-2 pr-3 font-semibold text-ink">Exit date</th>
                  <th className="py-2 pr-3 font-semibold text-ink text-right">Allocated</th>
                  <th className="py-2 pr-3 font-semibold text-ink text-right">P&L %</th>
                  <th className="py-2 pr-3 font-semibold text-ink text-right">P&L €</th>
                  <th className="py-2 pr-3 font-semibold text-ink text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {detailModal.pts.map((p) => {
                  const raw = p.raw;
                  const asset = listMonitoredAssets().find((a) => a.ticker === p.ticker.toUpperCase()) ?? null;
                  const name = asset?.name || "—";
                  const universe = p.universe ?? "portafoglio";
                  const entryDate = raw?.entry_ts || raw?.completion_date || "—";
                  const exitDate = raw?.exit_ts
                    ?? (raw?.cd_passed ? raw?.completion_date : null)
                    ?? (p.isOpen === false ? "closed" : "open");
                  const capital = raw?.capital_eur ?? null;
                  const pnlPct = raw?.pnl_pct ?? p.y;
                  const pnlEur = raw?.pnl_eur ?? null;
                  return (
                    <tr key={p.ticker} className="border-b border-[rgb(var(--border))]/20 hover:bg-slate-50/50">
                      <td className="py-2 pr-3 font-semibold text-ink whitespace-nowrap">{p.ticker}</td>
                      <td className="py-2 pr-3 text-ink-muted max-w-[180px] truncate" title={name}>{name}</td>
                      <td className="py-2 pr-3 text-ink-muted capitalize">{universe === "portafoglio" ? "portfolio" : universe}</td>
                      <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">{fmtDate(entryDate)}</td>
                      <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">{typeof exitDate === "string" ? exitDate : fmtDate(exitDate)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{capital != null ? `€${capital.toLocaleString("en-US")}` : "—"}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${pnlPct >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{pnlEur != null ? `€${Math.round(pnlEur).toLocaleString("en-US")}` : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold text-ink">{p.x.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AppModal>
      )}

      {/* ── Resilience Score detail modal (per-ticker A/B/C breakdown) ─── */}
      <ResilienceScoreDetailModal
        open={resilienceModalOpen}
        onClose={() => setResilienceModalOpen(false)}
        index={resilienceIndex}
        generatedAt={getResilienceSnapshotMeta()?.generatedAt ?? null}
        skippedCount={getResilienceSnapshotMeta()?.skippedCount ?? 0}
      />

      {/* ── Chart 3: MCS + segnali idiosincratici vs P&L (5 chart su una riga) ── */}
      <div ref={chart3Section.ref} className="min-h-[8px]">
      {chart3Section.inView && (
      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
        <div>
            <h4 className="text-xs font-semibold text-ink">
            Chart 3 — MCS · P(plan) · SDS · EIS vs P&L (merge MCS)
            </h4>
          <p className="text-[10px] text-ink-muted leading-relaxed mt-0.5">
            {it
              ? "I 5 chart mostrano: MCS vs direzione stock, MCS vs P&L, poi P(plan)/SDS/EIS vs P&L con la componente lineare MCS sottratta (linea arancio tratteggiata)."
              : "5 charts: MCS vs stock direction, MCS vs P&L, then P(plan)/SDS/EIS vs P&L with MCS linear component removed (orange dashed line)."}
          </p>
          <span className="text-[9px] text-ink-muted/60 tabular-nums">
            n=<strong className="text-ink">{mcsCorrRows.length}</strong>{" "}
            {it ? "deal (P(plan) noto + MCS alla entry)" : "deals (known P(plan) + MCS at entry)"}
            </span>
        </div>

        <div className={FIVE_COL_SCATTER_GRID} style={modelScatterGridStyle}>
          {/* 1 — MCS vs variazione positiva e negativa stock (3g dopo assignment) */}
          <MiniScatter
            title={it ? "MCS vs var. +/−" : "MCS vs move +/−"}
            note={
              it
                ? `Δ prezzo 3g dopo MCS (entry) · n=${mcsMoveRows.length}`
                : `3d price move after MCS (entry) · n=${mcsMoveRows.length}`
            }
            pts={mcsMoveRows.map((r) =>
              compRowToMiniPt(r, r.mcsAtEntry!, r.stockMove3dPct!),
            )}
            xLabel="MCS"
            xMin={-100}
            xMax={100}
            nTotal={mcsMoveRows.length}
            rhoUp={compareDirectional.mcsMove.up}
            rhoDown={compareDirectional.mcsMove.down}
            onOpenDetails={() =>
              setDetailModal({
                title: it ? "MCS vs variazione stock (3g)" : "MCS vs stock move (3d)",
                pts: mcsMoveRows.map((r) =>
                  compRowToMiniPt(r, r.mcsAtEntry!, r.stockMove3dPct!),
                ),
              })
            }
          />

          {/* 2 — MCS vs P&L */}
          <MiniScatter
            title="MCS vs P&L"
            note={
              mcsDoc?.stale_days != null && mcsDoc.stale_days >= 1
                ? it
                  ? `P&L trade · MCS entry da history · snapshot ${mcsDoc.stale_days}g fa`
                  : `Trade P&L · MCS at entry from history · snapshot ${mcsDoc.stale_days}d old`
                : it
                  ? "P&L trade · MCS alla data di entry (history giornaliera)"
                  : "Trade P&L · MCS on entry date (daily history)"
            }
            pts={mcsCorrRows.map((r) => compRowToMiniPt(r, r.mcsAtEntry!))}
            xLabel="MCS"
            xMin={-100}
            xMax={100}
            nTotal={mcsCorrRows.length}
            rhoUp={compareDirectional.mcs.up}
            rhoDown={compareDirectional.mcs.down}
            onOpenDetails={() =>
              setDetailModal({
                title: "MCS vs P&L",
                pts: mcsCorrRows.map((r) => compRowToMiniPt(r, r.mcsAtEntry!)),
              })
            }
          />

          {/* 3 — P(plan) vs P&L — MCS merge */}
          <PplanMcsMergedScatter
            rows={mcsCorrRows}
            it={it}
            onOpenDetails={() =>
              setDetailModal({
                title: "P(plan) vs P&L — merge MCS",
                pts: mcsCorrRows.map((r) => compRowToMiniPt(r, r.pplan)),
              })
            }
          />

          {/* 4 — SDS vs P&L — MCS merge */}
          <GenericMcsMergedScatter
            rows={mcsCorrRows}
            getX={(r) => r.sds}
            xLabel="SDS"
            title={it ? "SDS vs P&L — MCS merge" : "SDS vs P&L — MCS merge"}
            xDomain={{ min: 0, max: 100 }}
            it={it}
            onOpenDetails={() =>
              setDetailModal({
                title: "SDS vs P&L",
                pts: mcsCorrRows.filter((r) => r.sds != null).map((r) => compRowToMiniPt(r, r.sds!)),
              })
            }
          />

          {/* 5 — EIS vs P&L — MCS merge */}
          <GenericMcsMergedScatter
            rows={mcsCorrRows}
            getX={(r) => r.eisScore}
            xLabel="EIS"
            title={it ? "EIS vs P&L — MCS merge" : "EIS vs P&L — MCS merge"}
            xDomain={{ min: -60, max: 60 }}
            it={it}
            onOpenDetails={() =>
              setDetailModal({
                title: "EIS vs P&L",
                pts: mcsCorrRows.filter((r) => r.eisScore != null).map((r) => compRowToMiniPt(r, r.eisScore!)),
              })
            }
          />
        </div>

        <div className="rounded-lg border border-indigo-200/60 bg-indigo-50/50 px-3 py-2 text-[10px] leading-relaxed">
          <p className="font-semibold text-indigo-900">
            {it ? "Segnale incrementale MCS (al netto di P(plan))" : "MCS incremental signal (net of P(plan))"}
          </p>
          <p className="text-indigo-800/90 mt-0.5 tabular-nums">
            r<sub>partial</sub>(MCS ↔ P&L | P(plan)) ={" "}
            <strong>{partialMcsPnlGivenPplan != null ? fmtCorrR(partialMcsPnlGivenPplan) : "—"}</strong>
            {partialMcsPnlGivenPplan != null ? (
              <span className="text-indigo-700/80 font-normal ml-1">
                {it
                  ? partialMcsPnlGivenPplan <= -0.15
                    ? "— MCS spiega parte del movimento oltre P(plan) (stress esterno)"
                    : partialMcsPnlGivenPplan >= 0.15
                      ? "— MCS aggiunge segnale positivo oltre P(plan)"
                      : "— debole / nessun segnale incrementale chiaro"
                  : partialMcsPnlGivenPplan <= -0.15
                    ? "— MCS explains move beyond P(plan) (external stress)"
                    : partialMcsPnlGivenPplan >= 0.15
                      ? "— MCS adds positive signal beyond P(plan)"
                      : "— weak / no clear incremental signal"}
              </span>
            ) : (
              <span className="text-indigo-700/70 font-normal ml-1">
                {it ? "(servono ≥4 deal con MCS e P(plan) noti)" : "(need ≥4 deals with MCS and P(plan))"}
              </span>
            )}
          </p>
          <p className="text-[9px] text-indigo-700/70 mt-1">
            r(P(plan))={fmtCorrR(corrOnRows(mcsCorrRows, (r) => r.pplan))} · r(MCS)=
            {fmtCorrR(corrOnRows(mcsCorrRows, (r) => r.mcsAtEntry ?? null))} · n={mcsCorrRows.length}
          </p>
        </div>
      </div>
      )}
      </div>
      {/* Chart 3 lazy-mount wrapper closes here. */}

      {/* ── Footer note ───────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/10 px-3 py-2 text-[9px] text-ink-muted/70 space-y-0.5">
        <p>
          <strong>Closed trades:</strong> {closedPortfolioRows.length} from your portfolio book (
          <code className="bg-surface/40 px-0.5 rounded">invest_sim_inputs</code> sold positions).
          SDS (entry-time) for {sdsRows.length}/{closedPortfolioRows.length} trades.
          {sdsRows.length < closedPortfolioRows.length && (
            <> {it ? "I deal senza entry_sds sono esclusi dalla correlazione." : "Deals without entry_sds are excluded from correlation."}</>
          )}
        </p>
        {openLossRows.length > 0 && (
          <p>
            <strong>Open positions:</strong> {openLossRows.length}{" "}
            {openLossRows.length === 1 ? "position" : "positions"} in loss —
            real portfolio. Provisional P&L, updates on each visit.
            Entry SDS may be missing for some open rows.
          </p>
        )}
        <p>
          <strong>Rescue score</strong> = P(plan) (max 40) + loss depth (max 20) + EIS (max 15) + sector alignment (max +10) − volume anomaly (max −10) − cash runway risk (max −5).
        </p>
      </div>
    </div>
  );
}
