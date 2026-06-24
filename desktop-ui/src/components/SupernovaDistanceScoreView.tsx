import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadSdsCohort,
  readLocalSdsSnapshot,
  refreshSdsCohort,
  restoreSdsFromBackup,
  syncSdsFromSimulation,
  isDegradedSdsSnapshot,
  type SdsCohortPayload,
  type SdsRow,
} from "../api/supernova";
import type { ChartPoint } from "../types";
import { t as tr, useT } from "../shared/i18n";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { completionDateToNowOffset, type NowOffsetMarker } from "../sheet/chartNowOffset";
import { computeSimulationPosition } from "../sheet/simulationPosition";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { supernovaOffsetLabel } from "../sheet/sdsHistoryCurve";
import { SdsLegendPanel } from "./SdsLegendModal";
import { SdsHistoryPanel } from "./SdsHistoryModal";
import { SdsSupernovaCompareChart } from "./SdsSupernovaCompareChart";
import { SdsScoreReadoutPanel } from "./SdsScoreReadoutPanel";
import { SdsComponentBreakdown } from "./SdsComponentBreakdown";
import {
  blendOverlayColor,
  buildOverlayCurve,
  formatEstRoiPct,
  formatEstRoiSigned,
  formatSdsPeakChipPct,
  type SdsBlendOverlayCurve,
  type SdsOverlayCurve,
} from "../sheet/sdsCompareOverlay";
import {
  estimateRoiFromSdsCorrelation,
  formatCorrelationTooltip,
  loadSdsRoiCorrelation,
  type SdsCorrelationEstimate,
  type SdsRoiCorrelationDoc,
} from "../sheet/sdsRoiCorrelation";
import {
  blendCurveFromSimChart,
  curveRoiFromSimChart,
  formatHorizonRoi,
  formatHorizonRoiTooltip,
  formatProfileFitShort,
  loadSdsReferenceCurves,
  SDS_REF_PROFILE_LABELS,
  type SdsCurveRoiBlend,
  type SdsCurveRoiHorizonKey,
  type SdsRoiProfileId,
} from "../sheet/sdsRoiBlend";
import { looksLikeTicker } from "../sheet/simulationTickers";
import { isRowInSdsCohortScope } from "../sheet/sdsCohortScope";
import { SIM_HOT_ZONE_DAYS } from "../sheet/cdHorizons";
import { sdsZoneBarColor, sdsSimulationTableScoreClass, sdsZoneTextColor } from "../sheet/sdsZoneColors";
import { extractCurveInputs } from "../sheet/precatCurve";
import {
  portfolioTableOutlookClass,
  portfolioToneSignalClass,
  resolveModelMetricTone,
  resolvePortfolioTableOutlook,
  type PortfolioTableOutlook,
} from "../sheet/portfolioGainLossStyle";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { sparklineTargetStopFromSimRow } from "../sheet/simRowTargetStop";
import {
  SHEET_GRID_TABLE_CLASS,
  SDS_SCORE_GRID_COL_PCT,
  sheetGridTdClassAlign,
  sheetGridThClassAlign,
} from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

type SdsTab = "score" | "history";

export type SdsSimChartMeta = {
  row: Record<string, unknown>;
  points: ChartPoint[];
};

type SupernovaDistanceScoreViewProps = {
  simChartsByTicker?: Map<string, SdsSimChartMeta>;
  investInputs?: InvestSimInputs;
  /** Simulation sheet columns — for target/stop markers on sparklines. */
  simTableColumns?: string[];
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  /** Seleziona ticker in tabella/dettaglio SDS all'apertura. */
  focusTicker?: string | null;
  onFocusTickerConsumed?: () => void;
  /** Parent page refresh — rilegge snapshot SDS locali. */
  parentReloadToken?: number;
};

type SdsTableFilter = "all" | "candidate" | "portfolio";
type SdsCdHorizonFilter = "all" | "within2mo" | "beyond2mo";
type SdsSortKey = "default" | SdsCurveRoiHorizonKey | "days_to_cd";

function matchesSdsCdHorizon(
  days: number | null | undefined,
  horizon: SdsCdHorizonFilter,
): boolean {
  if (horizon === "all") return true;
  if (days == null || !Number.isFinite(days) || days < 0) return false;
  if (horizon === "within2mo") return days <= SIM_HOT_ZONE_DAYS;
  return days > SIM_HOT_ZONE_DAYS;
}

function roiSortValue(roi: SdsCurveRoiBlend | undefined, key: SdsCurveRoiHorizonKey): number {
  const v = roi?.horizons?.[key]?.pct_vs_m60;
  return v != null && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

function daysToCdDisplay(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days < 0) return `T+${Math.abs(days)}`;
  return String(Math.round(days));
}

function daysToCdClass(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "text-ink-muted";
  if (days < 0) return "text-violet-600 dark:text-violet-400";
  if (days <= 3) return "text-red-600 dark:text-red-400 font-bold";
  if (days <= 7) return "text-amber-600 dark:text-amber-400 font-semibold";
  if (days <= 30) return "text-ink font-medium";
  return "text-ink-muted";
}

const SDS_TAB_STYLE: Record<SdsTab | "legend", { active: string; inactive: string }> = {
  score: {
    active: "bg-[#cfe8a8] text-[#2d5016] border-[#a8d878] font-semibold shadow-sm",
    inactive: "bg-white text-[#6b7280] border-[#e5e7eb] hover:bg-[#f7fdf0]",
  },
  legend: {
    active: "bg-[#ddd6fe] text-[#5b21b6] border-[#c4b5fd] font-semibold shadow-sm",
    inactive: "bg-white text-[#6b7280] border-[#e5e7eb] hover:bg-[#faf5ff]",
  },
  history: {
    active: "bg-white text-[#374151] border-[#d1d5db] font-semibold shadow-sm",
    inactive: "bg-white text-[#6b7280] border-[#e5e7eb] hover:bg-[#fafafa]",
  },
};

function SdsGauge({ value }: { value: number }) {
  const barColor = sdsZoneBarColor(value);
  const scoreCls = sdsSimulationTableScoreClass(value);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="sds-gauge-cell flex items-center gap-1.5 min-w-0 w-full max-w-full">
      <div className="flex-1 min-w-0 h-2 rounded-full bg-[rgb(var(--surface-3))]/60 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className={`text-sm tabular-nums shrink-0 w-7 text-right ${scoreCls}`}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

function HorizonRoiPctCell({
  pct,
  slope5d,
  slope20d,
}: {
  pct: number | null | undefined;
  slope5d?: number | null;
  slope20d?: number | null;
}) {
  const toneCls = TABLE_COLORS_ENABLED
    ? portfolioToneSignalClass(resolveModelMetricTone(pct, slope5d, slope20d))
    : "";
  return (
    <span className={`text-[10px] font-medium tabular-nums whitespace-nowrap ${toneCls}`}>
      {formatHorizonRoi(pct)}
    </span>
  );
}

function ClusterBars({ clusters }: { clusters: SdsRow["cluster_scores"] }) {
  const t = useT();
  const items = [
    { key: "catalyst_quality", label: t("decisionLab.sds.cluster.catalyst"), max: 30 },
    { key: "institutional_signal", label: t("decisionLab.sds.cluster.institutional"), max: 25 },
    { key: "price_structure", label: t("decisionLab.sds.cluster.price"), max: 20 },
    { key: "fundamentals", label: t("decisionLab.sds.cluster.fundamentals"), max: 15 },
    { key: "timing", label: t("decisionLab.sds.cluster.timing"), max: 10 },
  ] as const;
  return (
    <div className="space-y-2">
      {items.map(({ key, label, max }) => {
        const v = clusters?.[key] ?? 0;
        return (
          <div key={key} className="text-[11px]">
            <div className="flex justify-between text-ink-muted mb-0.5">
              <span>{label}</span>
              <span className="tabular-nums">
                {v.toFixed(1)} / {max}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[rgb(var(--surface-3))]/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent/80"
                style={{ width: `${Math.min(100, (v / max) * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandidateCard({ row, rank }: { row: SdsRow; rank: number }) {
  const inv = row.investment;
  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/55 bg-surface/35 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[10px] uppercase text-ink-muted">#{rank}</span>
          <h4 className="text-base font-bold text-ink">{row.ticker}</h4>
        </div>
        <SdsGauge value={row.sds} />
      </div>
      <p className="text-xs font-medium" style={{ color: sdsZoneTextColor(row.sds) }}>
        {row.zone_label}
      </p>
      <p className="text-[11px] text-ink-muted">{inv?.rationale ?? row.zone_action}</p>
    </div>
  );
}

function DetailPanel({ row, onClose }: { row: SdsRow; onClose: () => void }) {
  const t = useT();
  const inv = row.investment;
  return (
    <div className="rounded-xl border border-accent/30 bg-surface/50 p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">{row.ticker}</h3>
          <p className="text-xs text-ink-muted">
            {row.phase ?? "—"} · T-{row.days_to_cd ?? "?"}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onClose}>
          {t("decisionLab.sds.closeDetail")}
        </button>
      </div>
      <SdsGauge value={row.sds} />
      <ClusterBars clusters={row.cluster_scores} />
      <SdsComponentBreakdown row={row} />
      {(row.cluster_b?.short_interest?.short_pct != null ||
        row.short_interest_pct != null ||
        row.analyst_upgrade_score != null ||
        row.cluster_b) ? (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {row.cluster_b?.short_interest?.short_pct != null || row.short_interest_pct != null ? (
            <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-1 tabular-nums">
              {t("decisionLab.sds.clusterB.shortLabel", {
                pct: (row.cluster_b?.short_interest?.short_pct ?? row.short_interest_pct ?? 0).toFixed(1),
                dtc: (
                  row.cluster_b?.short_interest?.days_to_cover ??
                  row.days_to_cover ??
                  "—"
                ).toString(),
              })}
            </span>
          ) : null}
          {row.cluster_b?.short_interest?.squeeze_setup ? (
            <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1">
              {t("decisionLab.sds.clusterB.squeezeSetup")}
            </span>
          ) : null}
          {row.cluster_b?.short_interest?.structural_bearish ? (
            <span className="rounded-md bg-red-500/15 text-red-700 dark:text-red-300 px-2 py-1">
              {t("decisionLab.sds.clusterB.bearishSignal")}
            </span>
          ) : null}
          {row.analyst_upgrade_score != null ? (
            <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-1 tabular-nums">
              {t("decisionLab.sds.analystScore")}: {row.analyst_upgrade_score.toFixed(1)}/8
            </span>
          ) : null}
          {row.cluster_b?.analyst_upgrades?.tier1_coverage ? (
            <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1">
              {t("decisionLab.sds.clusterB.tier1Coverage")}
            </span>
          ) : null}
          {(row.cluster_b?.analyst_upgrades?.downgrades_60d ?? 0) >= 2 ? (
            <span className="rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2 py-1">
              {t("decisionLab.sds.clusterB.multipleDowngrades")}
            </span>
          ) : null}
          {row.cluster_b?.institutional_delta?.premium_fund_present ? (
            <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-1">
              {t("decisionLab.sds.clusterB.premiumFund")}
            </span>
          ) : null}
        </div>
      ) : null}
      {(row.unmet_need_score != null ||
        row.market_size_score != null ||
        row.approved_drugs_count != null ||
        row.first_in_class != null) ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-1.5 text-[11px]">
          <p className="font-semibold text-ink">{t("decisionLab.sds.clusterA.title")}</p>
          {row.indication ? (
            <p className="text-ink-muted">{row.indication}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {row.approved_drugs_count != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5 tabular-nums">
                {t("decisionLab.sds.approvedDrugs")}: {row.approved_drugs_count}
              </span>
            ) : null}
            {row.unmet_need_score != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5 tabular-nums">
                {t("decisionLab.sds.unmetNeed")}: {row.unmet_need_score.toFixed(1)}/13
              </span>
            ) : null}
            {row.market_size_score != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5 tabular-nums">
                {t("decisionLab.sds.marketSize")}: {row.market_size_score.toFixed(1)}/10
              </span>
            ) : null}
            {row.first_in_class != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5">
                {t("decisionLab.sds.firstInClass")}: {row.first_in_class ? "Yes" : "No"}
              </span>
            ) : null}
            {row.tam_billions != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5 tabular-nums">
                TAM ~${row.tam_billions.toFixed(1)}B
              </span>
            ) : null}
            {row.pipeline_value_estimate != null ? (
              <span className="rounded-md border border-[rgb(var(--border))]/50 px-2 py-0.5 tabular-nums">
                {t("decisionLab.sds.pipelineValue")}: ${(row.pipeline_value_estimate / 1e9).toFixed(2)}B
              </span>
            ) : null}
          </div>
          {row.mechanism_class ? (
            <p className="text-[10px] text-ink-muted">{row.mechanism_class}</p>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-1 text-xs">
        <p className="font-semibold text-ink">{t("decisionLab.sds.investmentCard")}</p>
        <p>
          <span className="text-ink-muted">{t("decisionLab.sds.action")}: </span>
          {inv?.action ?? "—"}
        </p>
        <p>
          <span className="text-ink-muted">{t("decisionLab.sds.size")}: </span>
          {inv?.position_size ?? "—"}
        </p>
        <p className="text-ink-muted">{inv?.rationale}</p>
        {inv?.exit_target ? (
          <p className="text-[10px] text-ink-muted pt-1">↗ {inv.exit_target}</p>
        ) : null}
        {inv?.stop_loss ? <p className="text-[10px] text-ink-muted">⛔ {inv.stop_loss}</p> : null}
      </div>
      <p className="text-[10px] text-ink-muted">
        {t("decisionLab.sds.missingData", { pct: row.missing_data_pct ?? 0 })}
      </p>
    </div>
  );
}

export function SupernovaDistanceScoreView({
  simChartsByTicker,
  investInputs,
  simTableColumns,
  onOpenSimulationRow,
  focusTicker,
  onFocusTickerConsumed,
  parentReloadToken = 0,
}: SupernovaDistanceScoreViewProps) {
  const t = useT();
  const [data, setData] = useState<SdsCohortPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SdsRow | null>(null);
  const [filter, setFilter] = useState<SdsTableFilter>("all");
  const [cdHorizonFilter, setCdHorizonFilter] = useState<SdsCdHorizonFilter>("within2mo");
  const [sortKey, setSortKey] = useState<SdsSortKey>("default");
  const [sdsTab, setSdsTab] = useState<SdsTab>("score");
  const [legendOpen, setLegendOpen] = useState(false);
  const [chartOverlays, setChartOverlays] = useState<SdsOverlayCurve[]>([]);
  const [refCurves, setRefCurves] = useState<Partial<Record<SdsRoiProfileId, (number | null)[]>>>({});
  const [corrDoc, setCorrDoc] = useState<SdsRoiCorrelationDoc | null>(null);
  const dataRef = useRef<SdsCohortPayload | null>(null);
  const syncInFlightRef = useRef(false);
  dataRef.current = data;

  const expectedSdsTickers = useMemo(() => {
    const out = new Set<string>();
    for (const [tk, meta] of simChartsByTicker ?? []) {
      const sym = tk.trim().toUpperCase();
      if (isRowInSdsCohortScope(meta.row, sym)) out.add(sym);
    }
    return out;
  }, [simChartsByTicker]);

  const toggleChartOverlay = useCallback(
    (ticker: string) => {
      const tk = ticker.toUpperCase();
      setChartOverlays((prev) => {
        const idx = prev.findIndex((o) => o.ticker === tk);
        if (idx >= 0) return prev.filter((o) => o.ticker !== tk);
        const meta = simChartsByTicker?.get(tk);
        if (!meta) return prev;
        const built = buildOverlayCurve(tk, meta.points, meta.row, prev.length);
        if (!built) return prev;
        return [...prev, built];
      });
    },
    [simChartsByTicker],
  );

  const removeChartOverlay = useCallback((ticker: string) => {
    setChartOverlays((prev) => prev.filter((o) => o.ticker !== ticker.toUpperCase()));
  }, []);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (!dataRef.current?.rows?.length) {
      setLoading(true);
    }
    try {
      const local = await readLocalSdsSnapshot();
      if (!force && local?.rows?.length) {
        setData(local);
        return;
      }
      const remote = await loadSdsCohort(force);
      if (remote?.rows?.length) {
        setData(remote);
        if (isDegradedSdsSnapshot(remote)) {
          setError(tr("decisionLab.sds.errorApiFallback"));
        }
        return;
      }
      throw new Error(tr("decisionLab.sds.errorLoad"));
    } catch (e) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) {
        setData(local);
        setError(tr("decisionLab.sds.errorApiFallback"));
      } else {
        setError(e instanceof Error ? e.message : tr("decisionLab.sds.errorLoad"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    void loadSdsReferenceCurves().then(({ refs }) => setRefCurves(refs));
    void loadSdsRoiCorrelation().then(setCorrDoc);
    // Mount-only: useT() returns a new function each render — do not depend on load/t here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!parentReloadToken) return;
    void load(true);
    void loadSdsReferenceCurves().then(({ refs }) => setRefCurves(refs));
    void loadSdsRoiCorrelation().then(setCorrDoc);
  }, [parentReloadToken, load]);

  useEffect(() => {
    if (loading || !data?.rows?.length || expectedSdsTickers.size === 0) return;
    const current = new Set(
      (data?.rows ?? [])
        .map((r) => String(r.ticker ?? "").trim().toUpperCase())
        .filter((tk) => looksLikeTicker(tk)),
    );
    let missing = false;
    for (const tk of expectedSdsTickers) {
      if (!current.has(tk)) {
        missing = true;
        break;
      }
    }
    if (!missing || syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const doc = await syncSdsFromSimulation();
        if (cancelled || !doc?.rows?.length || isDegradedSdsSnapshot(doc)) return;
        setData(doc);
      } catch {
        /* keep current snapshot */
      } finally {
        syncInFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, expectedSdsTickers, data?.rows]);

  const handleRestoreBackup = async () => {
    setRestoring(true);
    setError(null);
    try {
      const doc = await restoreSdsFromBackup();
      if (doc?.rows?.length) setData(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await refreshSdsCohort({ fetchFmp: true, fetchClusterA: true });
      if (isDegradedSdsSnapshot(next)) {
        const local = await readLocalSdsSnapshot();
        if (local?.rows?.length) {
          setData(local);
          setError(t("decisionLab.sds.refreshDegraded"));
          return;
        }
      }
      setData(next);
    } catch (e) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) {
        setData(local);
        setError(t("decisionLab.sds.refreshDegraded"));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRefreshing(false);
    }
  };

  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => looksLikeTicker(String(r.ticker ?? "").trim().toUpperCase())),
    [data?.rows],
  );

  useEffect(() => {
    const tk = focusTicker?.trim().toUpperCase();
    if (!tk || !rows.length) return;
    const row = rows.find((r) => r.ticker.toUpperCase() === tk);
    if (row) {
      setSelected(row);
      setSdsTab("score");
    }
    onFocusTickerConsumed?.();
  }, [focusTicker, rows, onFocusTickerConsumed]);

  const snapshotStale = useMemo(
    () => rows.length > 0 && isDegradedSdsSnapshot({ rows }),
    [rows],
  );

  const nowMarkers = useMemo((): NowOffsetMarker[] => {
    const markers: NowOffsetMarker[] = [];
    const seen = new Set<number>();

    const addMarker = (ticker: string, simRow: Record<string, unknown> | undefined) => {
      if (!simRow) return;
      const off = completionDateToNowOffset(simRow["Completion Date"]);
      if (off == null || !Number.isFinite(off)) return;
      if (seen.has(off)) return;
      seen.add(off);
      markers.push({
        offset: off,
        label: tr("decisionLab.sds.compareChart.nowMarker", {
          ticker: ticker.toUpperCase(),
          offset: supernovaOffsetLabel(off),
        }),
      });
    };

    if (selected) {
      addMarker(selected.ticker, simChartsByTicker?.get(selected.ticker.toUpperCase())?.row);
    }

    for (const ovl of chartOverlays) {
      if (selected && ovl.ticker.toUpperCase() === selected.ticker.toUpperCase()) continue;
      addMarker(ovl.ticker, simChartsByTicker?.get(ovl.ticker.toUpperCase())?.row);
    }

    return markers.sort((a, b) => a.offset - b.offset);
  }, [selected, chartOverlays, simChartsByTicker]);

  const blendOverlays = useMemo((): SdsBlendOverlayCurve[] => {
    const out: SdsBlendOverlayCurve[] = [];
    for (const ovl of chartOverlays) {
      const tk = ovl.ticker.toUpperCase();
      const meta = simChartsByTicker?.get(tk);
      const row = rows.find((r) => r.ticker.toUpperCase() === tk);
      if (!meta || !row) continue;
      const ctx = {
        sds: row.sds,
        days_to_cd: row.days_to_cd,
        cluster_scores: row.cluster_scores,
        cluster_a: row.cluster_a,
        cluster_b: row.cluster_b,
        cluster_c: row.cluster_c,
        cluster_d: row.cluster_d,
      };
      const values = blendCurveFromSimChart(meta.points, meta.row, refCurves, ctx);
      if (!values) continue;
      out.push({
        ticker: tk,
        color: blendOverlayColor(ovl.color),
        values,
      });
    }
    return out;
  }, [chartOverlays, simChartsByTicker, rows, refCurves]);

  const portfolioByTicker = useMemo(() => {
    const m = new Map<
      string,
      {
        inPortfolio: boolean;
        pnlPct: number | null;
        pnlEur: number | null;
        pnlUnavailable?: boolean;
        buyPrice: number;
      }
    >();
    if (!investInputs) return m;
    for (const [tk, meta] of simChartsByTicker ?? []) {
      const pos = computeSimulationPosition(meta.row, investInputs);
      if (!pos) continue;
      const inPortfolio = pos.capital > 0;
      m.set(tk, {
        inPortfolio,
        pnlPct: pos.pnlUnavailable ? null : pos.pnlPct,
        pnlEur: pos.pnlUnavailable ? null : pos.pnlEur,
        pnlUnavailable: pos.pnlUnavailable,
        buyPrice: pos.buyPrice,
      });
    }
    return m;
  }, [simChartsByTicker, investInputs]);

  const roiByTicker = useMemo(() => {
    const m = new Map<string, SdsCurveRoiBlend>();
    for (const r of rows) {
      const tk = r.ticker.toUpperCase();
      const meta = simChartsByTicker?.get(tk);
      const ctx = {
        sds: r.sds,
        days_to_cd: r.days_to_cd,
        cluster_scores: r.cluster_scores,
        cluster_a: r.cluster_a,
        cluster_b: r.cluster_b,
        cluster_c: r.cluster_c,
        cluster_d: r.cluster_d,
      };
      let base = r.curve_roi as SdsCurveRoiBlend | undefined;
      if (!base?.horizons?.pre_10 && meta) {
        base = curveRoiFromSimChart(meta.row, meta.points, refCurves, ctx) ?? base;
      }
      const prof = base?.best_profile as SdsRoiProfileId | undefined;
      const est = estimateRoiFromSdsCorrelation(r.sds, corrDoc, prof);
      if (est?.horizons) {
        const corrEst: SdsCorrelationEstimate = est;
        m.set(tk, {
          ...(base ?? {}),
          sds_correlation_estimate: corrEst,
          horizons_curve: base?.horizons_curve ?? base?.horizons,
          horizons: est.horizons,
        });
      } else if (base) {
        m.set(tk, base);
      }
    }
    return m;
  }, [rows, simChartsByTicker, refCurves, corrDoc]);

  const rowOutlookByTicker = useMemo(() => {
    const m = new Map<string, PortfolioTableOutlook>();
    for (const r of rows) {
      const tk = r.ticker.toUpperCase();
      const meta = simChartsByTicker?.get(tk);
      const port = portfolioByTicker.get(tk);
      const curves = meta?.row ? extractCurveInputs(meta.row) : null;
      const roi = roiByTicker.get(tk);
      m.set(
        tk,
        resolvePortfolioTableOutlook({
          inPortfolio: port?.inPortfolio ?? false,
          pnlEur: port?.pnlEur ?? null,
          pnlPct: port?.pnlPct ?? null,
          planReturnPct: roi?.horizons?.pre_5?.pct_vs_m60 ?? null,
          slope5d: curves?.slope5d ?? null,
          slope20d: curves?.slope20d ?? null,
          simRow: meta?.row ?? null,
          chartPoints: meta?.points ?? null,
        }),
      );
    }
    return m;
  }, [rows, simChartsByTicker, portfolioByTicker, roiByTicker]);

  const filtered = useMemo(() => {
    let list = rows;
    if (filter === "candidate") list = list.filter((r) => r.sds >= 55);
    else if (filter === "portfolio") {
      list = list.filter((r) => portfolioByTicker.get(r.ticker.toUpperCase())?.inPortfolio);
    }
    list = list.filter((r) => matchesSdsCdHorizon(r.days_to_cd, cdHorizonFilter));
    if (sortKey === "default") {
      return [...list].sort((a, b) => b.sds - a.sds);
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === "days_to_cd") {
        const da = a.days_to_cd ?? Number.POSITIVE_INFINITY;
        const db = b.days_to_cd ?? Number.POSITIVE_INFINITY;
        return da - db;
      }
      const ka = sortKey as SdsCurveRoiHorizonKey;
      const ra = roiByTicker.get(a.ticker.toUpperCase());
      const rb = roiByTicker.get(b.ticker.toUpperCase());
      return roiSortValue(rb, ka) - roiSortValue(ra, ka);
    });
    return sorted;
  }, [rows, filter, cdHorizonFilter, sortKey, portfolioByTicker, roiByTicker]);

  const cdHorizonCounts = useMemo(() => {
    let within2mo = 0;
    let beyond2mo = 0;
    for (const r of rows) {
      const d = r.days_to_cd;
      if (d == null || !Number.isFinite(d) || d < 0) continue;
      if (d <= SIM_HOT_ZONE_DAYS) within2mo += 1;
      else beyond2mo += 1;
    }
    return { within2mo, beyond2mo };
  }, [rows]);

  const portfolioCount = useMemo(
    () => rows.filter((r) => portfolioByTicker.get(r.ticker.toUpperCase())?.inPortfolio).length,
    [rows, portfolioByTicker],
  );

  const top3 = useMemo(() => filtered.slice(0, 3), [filtered]);

  return (
    <div className="p-4 space-y-4 w-full min-w-0 max-w-none mx-auto">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 rounded-lg bg-white border border-[#e5e7eb] shadow-sm">
          {(
            [
              ["score", t("decisionLab.sds.tab.score")],
              ["history", t("decisionLab.sds.tab.history")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition border ${
                sdsTab === id ? SDS_TAB_STYLE[id].active : SDS_TAB_STYLE[id].inactive
              }`}
              onClick={() => setSdsTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sdsTab === "history" ? (
        <SdsHistoryPanel />
      ) : (
        <>
          <SdsSupernovaCompareChart
            overlayCurves={chartOverlays}
            blendOverlays={blendOverlays}
            onRemoveOverlay={removeChartOverlay}
            nowMarkers={nowMarkers}
            refCurves={refCurves}
          />

          <SdsScoreReadoutPanel />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <h3 className="text-base font-semibold text-ink">{t("decisionLab.sds.title")}</h3>
              <p className="text-xs text-ink-muted max-w-3xl">{t("decisionLab.sds.lead")}</p>
              {data?.market_regime ? (
                <p className="text-[10px] text-ink-muted">
                  {t("decisionLab.sds.regime")}: <span className="font-medium">{data.market_regime}</span>
                  {data.generated_at ? ` · ${data.generated_at}` : null}
                  {data.refresh_mode === "light" ? ` · ${t("decisionLab.sds.lightRefresh")}` : null}
                  {data.fmp_fetched ? ` · ${t("decisionLab.sds.fmpFetched")}` : null}
                  {data.cluster_a_fetched ? ` · ${t("decisionLab.sds.clusterAFetched")}` : null}
                  {data.last_fmp_refresh_at ? ` · ${t("decisionLab.sds.lastFmpRefresh", { at: data.last_fmp_refresh_at })}` : null}
                  {data.fmp_enabled === false ? ` · ${t("decisionLab.sds.fmpMissingKey")}` : null}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium transition border ${
                legendOpen ? SDS_TAB_STYLE.legend.active : SDS_TAB_STYLE.legend.inactive
              }`}
              onClick={() => setLegendOpen((o) => !o)}
            >
              {t("decisionLab.sds.tab.legend")}
            </button>
          </div>

          {legendOpen ? (
            <div className="rounded-xl border border-[#c4b5fd]/50 overflow-hidden">
              <SdsLegendPanel />
            </div>
          ) : null}

          {snapshotStale ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-ink-muted leading-relaxed">
              {t("decisionLab.sds.staleSnapshot")}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            >
              {refreshing ? t("decisionLab.sds.refreshing") : t("decisionLab.sds.refresh")}
            </button>
            {(rows.length === 0 || snapshotStale) && !loading ? (
              <button
                type="button"
                className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5 text-xs disabled:opacity-50"
                disabled={restoring}
                onClick={() => void handleRestoreBackup()}
              >
                {restoring ? "…" : t("decisionLab.sds.restoreBackup")}
              </button>
            ) : null}
            <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30">
              {(
                [
                  ["all", t("decisionLab.sds.filterAll")],
                  ["candidate", t("decisionLab.sds.filterCandidate")],
                  ["portfolio", t("decisionLab.sds.filterPortfolio")],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded px-2 py-1 text-[10px] font-medium ${
                    filter === id ? "seg-btn-active" : "seg-btn"
                  }`}
                  onClick={() => setFilter(id)}
                >
                  {id === "portfolio" ? `${label} (${portfolioCount})` : label}
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30">
              {(
                [
                  ["all", t("decisionLab.sds.cdHorizon.all"), null],
                  ["within2mo", t("decisionLab.sds.cdHorizon.within2mo"), cdHorizonCounts.within2mo],
                  ["beyond2mo", t("decisionLab.sds.cdHorizon.beyond2mo"), cdHorizonCounts.beyond2mo],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap ${
                    cdHorizonFilter === id ? "seg-btn-active" : "seg-btn"
                  }`}
                  title={
                    id === "within2mo"
                      ? t("decisionLab.sds.cdHorizon.within2moTip")
                      : id === "beyond2mo"
                        ? t("decisionLab.sds.cdHorizon.beyond2moTip")
                        : t("decisionLab.sds.cdHorizon.allTip")
                  }
                  onClick={() => setCdHorizonFilter(id)}
                >
                  {label}
                  {count != null ? ` (${count})` : ""}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-ink-muted shrink-0">{t("decisionLab.sds.sortLabel")}</span>
              <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30">
                {(
                  [
                    ["default", t("decisionLab.sds.sortDefault")],
                    ["pre_10", t("decisionLab.sds.colRoiPre10")],
                    ["pre_5", t("decisionLab.sds.colRoiPre5")],
                    ["post_4", t("decisionLab.sds.colRoiPost4")],
                    ["days_to_cd", t("decisionLab.sds.colDaysToCd")],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap ${
                      sortKey === id ? "seg-btn-active" : "seg-btn"
                    }`}
                    title={
                      id === "days_to_cd"
                        ? t("decisionLab.sds.sortDaysTip")
                        : t("decisionLab.sds.sortRoiTip", { horizon: label })
                    }
                    onClick={() => setSortKey(id)}
                  >
                    {label}
                    {sortKey === id && id !== "default" ? " ↓" : null}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-[10px] text-ink-muted ml-auto">
              {t("decisionLab.sds.count", { n: filtered.length, total: rows.length })}
            </span>
          </div>

          {loading && !data ? (
            <p className="text-sm text-ink-muted py-8 text-center">{t("decisionLab.sds.loading")}</p>
          ) : null}
          {rows.length > 0 && filtered.length === 0 && filter === "candidate" ? (
            <p className="text-xs text-ink-muted rounded-lg border border-[rgb(var(--border))]/40 p-3">
              {t("decisionLab.sds.noCandidates")}
            </p>
          ) : null}
          {rows.length > 0 && filtered.length === 0 && filter === "portfolio" ? (
            <p className="text-xs text-ink-muted rounded-lg border border-[rgb(var(--border))]/40 p-3">
              {t("decisionLab.sds.noPortfolio")}
            </p>
          ) : null}
          {rows.length > 0 &&
          filtered.length === 0 &&
          cdHorizonFilter === "within2mo" &&
          filter !== "portfolio" ? (
            <p className="text-xs text-ink-muted rounded-lg border border-[rgb(var(--border))]/40 p-3">
              {t("decisionLab.sds.noWithin2mo")}
            </p>
          ) : null}
          {rows.length > 0 &&
          filtered.length === 0 &&
          cdHorizonFilter === "beyond2mo" &&
          filter !== "portfolio" &&
          filter !== "candidate" ? (
            <p className="text-xs text-ink-muted rounded-lg border border-[rgb(var(--border))]/40 p-3">
              {t("decisionLab.sds.noBeyond2mo")}
            </p>
          ) : null}
          {!loading && rows.length === 0 ? (
            <p className="text-xs text-ink-muted rounded-lg border border-dashed border-[rgb(var(--border))]/50 p-4 text-center">
              {t("decisionLab.sds.emptyCohort")}
            </p>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {top3.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t("decisionLab.sds.topCandidates")}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {top3.map((r, i) => (
                  <button
                    key={r.ticker}
                    type="button"
                    className="text-left"
                    onClick={() => setSelected(r)}
                  >
                    <CandidateCard row={r} rank={i + 1} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="space-y-4">
            <div className="rounded-xl border border-[rgb(var(--border))]/55 overflow-x-auto">
              <table className={`${SHEET_GRID_TABLE_CLASS} sds-score-table text-xs`}>
                <SheetGridColgroup widths={SDS_SCORE_GRID_COL_PCT} />
                <thead>
                  <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40 bg-surface/30">
                    <th className={`${sheetGridThClassAlign("left")} py-1.5 font-medium whitespace-nowrap`}>
                      {t("decisionLab.sds.colTicker")}
                    </th>
                    <th
                      className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}
                      title={t("sim.workspace.table.trajectoryTip")}
                    >
                      {t("sim.workspace.table.trajectory")}
                    </th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}>SDS</th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}>{t("decisionLab.sds.colZone")}</th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}>{t("decisionLab.sds.colDaysToCd")}</th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}>{t("decisionLab.sds.colFit")}</th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`} title={t("decisionLab.sds.colRoiPre10Tip")}>
                      {t("decisionLab.sds.colRoiPre10")}
                    </th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`} title={t("decisionLab.sds.colRoiPre5Tip")}>
                      {t("decisionLab.sds.colRoiPre5")}
                    </th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`} title={t("decisionLab.sds.colRoiPost4Tip")}>
                      {t("decisionLab.sds.colRoiPost4")}
                    </th>
                    <th className={`${sheetGridThClassAlign("center")} py-1.5 font-medium whitespace-nowrap`}>{t("decisionLab.sds.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const tk = r.ticker.toUpperCase();
                    const onChart = chartOverlays.some((o) => o.ticker === tk);
                    const overlayMeta = chartOverlays.find((o) => o.ticker === tk);
                    const canOverlay = simChartsByTicker?.has(tk) ?? false;
                    const simMeta = simChartsByTicker?.get(tk);
                    const port = portfolioByTicker.get(tk);
                    const roi = roiByTicker.get(tk);
                    const completionCd = simMeta?.row
                      ? String(simMeta.row["Completion Date"] ?? "").trim()
                      : undefined;
                    const curvesForTone = simMeta?.row ? extractCurveInputs(simMeta.row) : null;
                    const rowOutlook = rowOutlookByTicker.get(tk) ?? "flat";
                    const isRowFocused = selected?.ticker === r.ticker;
                    const portfolioRowCls =
                      !isRowFocused && TABLE_COLORS_ENABLED
                        ? portfolioTableOutlookClass(rowOutlook)
                        : "";
                    return (
                    <tr
                      key={r.ticker}
                      className={`border-b border-[rgb(var(--border))]/20 cursor-pointer ${
                        portfolioRowCls || (!isRowFocused ? "hover:bg-surface/40" : "")
                      } ${isRowFocused ? "bg-accent/5" : ""} ${onChart ? "bg-[#86c040]/8" : ""}`}
                      onClick={() => setSelected(r)}
                    >
                      <td
                        className={`${sheetGridTdClassAlign("left")} whitespace-nowrap ${
                          selected?.ticker === r.ticker
                            ? "!bg-accent/5"
                            : onChart
                              ? "!bg-[#86c040]/8"
                              : ""
                        }`}
                      >
                        <div className="flex flex-col items-start gap-0.5 min-w-0">
                          <div className="flex items-center gap-1 flex-wrap">
                            <PortfolioTickerMark
                              ticker={r.ticker}
                              inPortfolio={port?.inPortfolio ?? false}
                              pnlPct={port?.pnlPct}
                              pnlEur={port?.pnlEur}
                              pnlUnavailable={port?.pnlUnavailable}
                              slope5d={curvesForTone?.slope5d ?? null}
                              slope20d={curvesForTone?.slope20d ?? null}
                              tableOutlook={port?.inPortfolio ? rowOutlook : null}
                              className="text-xs"
                            />
                            {onChart && overlayMeta ? (
                              <button
                                type="button"
                                className="text-[10px] font-bold tabular-nums underline-offset-2 hover:underline"
                                style={{ color: overlayMeta.color }}
                                title={
                                  overlayMeta.peakKind === "cd_outlook"
                                    ? t("decisionLab.sds.compareChart.cdOutlookTooltip", {
                                        pct: formatEstRoiSigned(overlayMeta.peakRoi),
                                        offset: supernovaOffsetLabel(overlayMeta.peakOffset),
                                      })
                                    : t("decisionLab.sds.compareChart.estimatedRoiTooltip", {
                                        pct: formatEstRoiPct(overlayMeta.peakRoi),
                                        offset: supernovaOffsetLabel(overlayMeta.peakOffset),
                                      })
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleChartOverlay(r.ticker);
                                }}
                              >
                                {overlayMeta.peakKind === "cd_outlook"
                                  ? t("decisionLab.sds.compareChart.cdOutlookShort", {
                                      pct: formatSdsPeakChipPct(
                                        overlayMeta.peakRoi,
                                        overlayMeta.peakKind,
                                      ),
                                      offset: supernovaOffsetLabel(overlayMeta.peakOffset),
                                    })
                                  : t("decisionLab.sds.compareChart.estimatedRoiShort", {
                                      pct: formatEstRoiPct(overlayMeta.peakRoi),
                                      offset: supernovaOffsetLabel(overlayMeta.peakOffset),
                                    })}
                              </button>
                            ) : canOverlay ? (
                              <button
                                type="button"
                                className="text-[9px] font-medium text-accent hover:underline"
                                title={t("decisionLab.sds.compareChart.toggleTicker", { ticker: r.ticker })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleChartOverlay(r.ticker);
                                }}
                              >
                                +chart
                              </button>
                            ) : null}
                            {onOpenSimulationRow ? (
                              <button
                                type="button"
                                className="text-[9px] font-semibold text-accent hover:underline"
                                title={t("decisionLab.sds.openSimulationRow", { ticker: r.ticker })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenSimulationRow({
                                    ticker: tk,
                                    cd: completionCd && completionCd !== "—" ? completionCd : undefined,
                                  });
                                }}
                              >
                                {t("sim.workspace.tickerSimulationLink")}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className={sheetGridTdClassAlign("center")} onClick={(e) => e.stopPropagation()}>
                        {simMeta ? (
                          <div
                            className="flex justify-center min-w-0 mx-auto"
                            title={t("sim.workspace.table.trajectoryTip")}
                          >
                            <SimulationSparkline
                              row={simMeta.row}
                              points={simMeta.points}
                              width={88}
                              height={28}
                              showCdZones
                              showZoneLabels={false}
                              targetStop={
                                simTableColumns?.length
                                  ? sparklineTargetStopFromSimRow(simMeta.row, simTableColumns)
                                  : null
                              }
                              portfolio={
                                port?.inPortfolio && !port.pnlUnavailable
                                  ? {
                                      pnlPct: port.pnlPct,
                                      buyPriceUsd: port.buyPrice > 0 ? port.buyPrice : null,
                                    }
                                  : null
                              }
                            />
                          </div>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className={sheetGridTdClassAlign("center")}>
                        <SdsGauge value={r.sds} />
                      </td>
                      <td className={`${sheetGridTdClassAlign("center")} font-medium whitespace-nowrap ${sdsSimulationTableScoreClass(r.sds)}`}>
                        {r.zone_label}
                      </td>
                      <td
                        className={`${sheetGridTdClassAlign("center")} whitespace-nowrap ${daysToCdClass(r.days_to_cd)}`}
                        title={t("decisionLab.sds.daysToCdTooltip", {
                          days: r.days_to_cd ?? "—",
                        })}
                      >
                        {daysToCdDisplay(r.days_to_cd)}
                        {r.days_to_cd != null && Number.isFinite(r.days_to_cd) && r.days_to_cd >= 0 ? (
                          <span className="text-[9px] text-ink-muted ml-0.5">g</span>
                        ) : null}
                      </td>
                      <td
                        className={`${sheetGridTdClassAlign("center")} text-[10px] whitespace-nowrap`}
                        title={
                          roi?.best_profile
                            ? t("decisionLab.sds.fitTooltip", {
                                profile: SDS_REF_PROFILE_LABELS[roi.best_profile as SdsRoiProfileId] ?? roi.best_profile,
                                pct: roi.best_fit_pct?.toFixed(0) ?? "—",
                              })
                            : undefined
                        }
                      >
                        {formatProfileFitShort(
                          roi?.best_profile as SdsRoiProfileId | undefined,
                          roi?.best_fit_pct,
                        )}
                      </td>
                      <td
                        className={`${sheetGridTdClassAlign("center")} text-[10px] font-medium whitespace-nowrap`}
                        title={[
                          formatCorrelationTooltip(roi?.sds_correlation_estimate, "T−10", "pre_10"),
                          formatHorizonRoiTooltip(roi?.horizons_curve?.pre_10, "μ T−10"),
                        ].filter(Boolean).join(" · ") || t("decisionLab.sds.roiHorizonTooltip")}
                      >
                        <HorizonRoiPctCell
                          pct={roi?.horizons?.pre_10?.pct_vs_m60}
                          slope5d={curvesForTone?.slope5d}
                          slope20d={curvesForTone?.slope20d}
                        />
                      </td>
                      <td
                        className={`${sheetGridTdClassAlign("center")} whitespace-nowrap`}
                        title={[
                          formatCorrelationTooltip(roi?.sds_correlation_estimate, "T−5", "pre_5"),
                          formatHorizonRoiTooltip(roi?.horizons_curve?.pre_5, "μ T−5"),
                        ].filter(Boolean).join(" · ") || t("decisionLab.sds.roiHorizonTooltip")}
                      >
                        <HorizonRoiPctCell
                          pct={roi?.horizons?.pre_5?.pct_vs_m60}
                          slope5d={curvesForTone?.slope5d}
                          slope20d={curvesForTone?.slope20d}
                        />
                      </td>
                      <td
                        className={`${sheetGridTdClassAlign("center")} whitespace-nowrap`}
                        title={[
                          formatCorrelationTooltip(roi?.sds_correlation_estimate, "T+4", "post_4"),
                          formatHorizonRoiTooltip(roi?.horizons_curve?.post_4, "μ T+4"),
                        ].filter(Boolean).join(" · ") || t("decisionLab.sds.roiHorizonTooltip")}
                      >
                        <HorizonRoiPctCell
                          pct={roi?.horizons?.post_4?.pct_vs_m60}
                          slope5d={curvesForTone?.slope5d}
                          slope20d={curvesForTone?.slope20d}
                        />
                      </td>
                      <td className={`${sheetGridTdClassAlign("center")} text-ink-muted whitespace-nowrap`}>{r.investment?.action ?? "—"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selected ? (
              <DetailPanel row={selected} onClose={() => setSelected(null)} />
            ) : (
              <div className="rounded-xl border border-dashed border-[rgb(var(--border))]/50 p-6 text-xs text-ink-muted flex items-center justify-center">
                {t("decisionLab.sds.selectRow")}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
