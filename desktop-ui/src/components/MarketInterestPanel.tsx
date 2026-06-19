import { useEffect, useMemo, useState } from "react";

import type { SheetTable, ChartBundle, ChartPoint } from "../types";

import { simulationRowSeriesKey } from "../data/simulationCharts";
import { resolveRecalibratedChartPoints } from "../sheet/predictionCurveDailyRecalib";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { sparklineTargetStopFromSimRow } from "../sheet/simRowTargetStop";

import { loadSdsCohort, type SdsRow } from "../api/supernova";

import {
  DEFAULT_MIG_CONFIG,
  evaluateBatch,
  type MIGConfig,
  type MIGResult,
  type MIGVerdict,
  type ModelSlopeCalibrationTier,
} from "../sheet/marketInterestGate";
import {
  buildMarketInterestSnapshotsFromSimulation,
  sdsRowsToMap,
} from "../sheet/marketInterestFromSimulation";
import {
  loadMigCdUnder60Only,
  loadMigMinSlopeAngleDeg,
  loadMigPositiveSlopeOnly,
  saveMigCdUnder60Only,
  saveMigMinSlopeAngleDeg,
  saveMigPositiveSlopeOnly,
} from "../sheet/marketInterestPrefs";
import { isHotZone } from "../sheet/cdHorizons";
import {
  buildMigDeltaSourceLine,
  buildMigDeltaColumnTooltip,
  buildMigSlopeTooltip,
  migDeltaDivergesFrom24h,
} from "../sheet/marketInterestTooltips";
import { computeSimulationPosition, dailyChangePctFromRow, portfolioDailyPnlFromRow, priceRefreshAtFromRow } from "../sheet/simulationPosition";
import { extractCurveInputs } from "../sheet/precatCurve";
import { buildPnlRankIndexMap, pnlTableRankIcon } from "../sheet/dealRankIcon";
import {
  fmtPortfolioPnlPct,
  fmtSignedUsdPnl,
  portfolioPnlTextClass,
  portfolioPnlTone,
} from "../sheet/portfolioGainLossStyle";
import {
  recordMatchesScope,
  useSimulationPortfolioScope,
  type PortfolioScopeMode,
} from "../sheet/portfolioScope";
import { useRefreshStatus } from "../shared/refreshStatusStore";
import {
  MIG_INTEREST_GRID_COL_PCT,
  SHEET_GRID_TABLE_CLASS,
  sheetGridTdClass,
  sheetGridThClass,
} from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { useLang, useT, type TranslationKey } from "../shared/i18n";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { TickerWithCdLifecycle } from "./CdLifecycleBadge";
import { SlopeAngleGlyph } from "./SlopeAngleGlyph";
import { MigCalibVisual } from "./MigCalibVisual";
import { MigCalibModal } from "./MigCalibModal";
import { MiiAngleGuideModal } from "./MiiAngleGuideModal";
import { PortfolioScopeToggle, PortfolioTickerMark } from "./PortfolioScopeToggle";
import { RankAnimalIcon } from "./DealRankBadge";

const MIG_COL_COUNT = 9;
const GLYPH_SIZE = 104;

function MigColHeader({ label, tip }: { label: string; tip: string }) {
  return (
    <span
      className="inline-block cursor-help border-b border-dotted border-ink-muted/25 hover:border-ink-muted/70 transition-colors"
      title={tip}
    >
      {label}
    </span>
  );
}

function resolveMigChartPoints(
  simRow: Record<string, unknown> | null,
  chartsBundle: ChartBundle | null | undefined,
): ChartPoint[] | null {
  if (!simRow || !chartsBundle?.series) return null;
  const sk = simulationRowSeriesKey(simRow);
  const raw = sk ? chartsBundle.series[sk]?.points : null;
  return raw?.length ? resolveRecalibratedChartPoints(raw, simRow) : null;
}

function calibrationTierLabel(
  tier: ModelSlopeCalibrationTier,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  return tr(`signals.mig.calibTier.${tier}`);
}

function buildMigCalibTooltip(
  row: MIGResult,
  dailyPct24h: number | null | undefined,
  tr: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}°`;
  parts.push(`MII ${fmt(row.slopeAngleDeg)}`);
  parts.push(buildMigDeltaSourceLine(row, tr));
  if (migDeltaDivergesFrom24h(row, dailyPct24h)) {
    parts.push(
      tr("signals.mig.deltaSource.divergenceShort", {
        daily: `${dailyPct24h! >= 0 ? "+" : ""}${dailyPct24h!.toFixed(1)}%`,
      }),
    );
  }
  if (row.calibPreDaily.modelSlopeAngleDeg != null) {
    parts.push(`pre ${fmt(row.calibPreDaily.modelSlopeAngleDeg)}`);
    if (row.calibPreDaily.calibrationScore != null) {
      parts.push(
        `pre≈MII ${row.calibPreDaily.calibrationScore.toFixed(0)}/100 · ${calibrationTierLabel(row.calibPreDaily.calibrationTier, tr)}`,
      );
    }
  }
  if (row.calibPostDaily.modelSlopeAngleDeg != null) {
    parts.push(`post ${fmt(row.calibPostDaily.modelSlopeAngleDeg)}`);
    if (row.calibPostDaily.calibrationScore != null) {
      parts.push(`post≈MII ${row.calibPostDaily.calibrationScore.toFixed(0)}/100`);
    }
  }
  return parts.join(" · ");
}

function migRowKey(row: MIGResult): string {
  return `${row.ticker}|${row.cd ?? ""}`;
}

export function findSimRowForMig(
  simTable: SheetTable | null,
  row: MIGResult,
): Record<string, unknown> | null {
  if (!simTable?.rows?.length) return null;
  const tk = row.ticker.trim().toUpperCase();
  const cd = (row.cd ?? "").trim();
  for (const r of simTable.rows) {
    const rt = String(r["Ticker"] ?? r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (rt !== tk) continue;
    const rc = String(r["Completion Date"] ?? "").trim();
    if (!cd || rc === cd) return r;
  }
  return null;
}

function verdictTone(v: MIGVerdict): string {
  switch (v) {
    case "PASS":
      return "text-emerald-700 dark:text-emerald-400 bg-emerald-500/12 border-emerald-500/35";
    case "WATCH":
      return "text-amber-800 dark:text-amber-300 bg-amber-500/12 border-amber-500/35";
    case "BLOCK":
      return "text-slate-600 dark:text-slate-400 bg-slate-500/10 border-slate-400/35";
  }
}

export function MarketInterestPanel({
  simTable,
  chartsBundle,
  onOpenPredictionCharts,
}: {
  simTable: SheetTable | null;
  chartsBundle?: ChartBundle | null;
  onOpenPredictionCharts?: (focus: { ticker: string; seriesKey: string | null }) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [minAngle, setMinAngle] = useState(() => loadMigMinSlopeAngleDeg());
  const [verdictFilter, setVerdictFilter] = useState<"all" | MIGVerdict>("all");
  const [listMode, setListMode] = useState<PortfolioScopeMode>("portfolio");
  const [positiveSlopeOnly, setPositiveSlopeOnly] = useState(() => loadMigPositiveSlopeOnly());
  const [cdUnder60Only, setCdUnder60Only] = useState(() => loadMigCdUnder60Only());
  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [sdsLoading, setSdsLoading] = useState(false);
  const [calibModalKey, setCalibModalKey] = useState<string | null>(null);
  const [angleGuideOpen, setAngleGuideOpen] = useState(false);
  const { lastReloadAt, finishedAt } = useRefreshStatus();
  const { inputs, portfolioTickers, watchTickers, counts, isPortfolioTicker } =
    useSimulationPortfolioScope(simTable);

  const dataFreshKey = `${simTable?.rows?.length ?? 0}:${lastReloadAt?.getTime() ?? 0}:${finishedAt?.getTime() ?? 0}:${chartsBundle?.loaded_at ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    setSdsLoading(true);
    void loadSdsCohort(false, false)
      .then((doc) => {
        if (!cancelled) setSdsRows(doc.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setSdsRows([]);
      })
      .finally(() => {
        if (!cancelled) setSdsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [simTable?.rows?.length]);

  const config: MIGConfig = useMemo(
    () => ({ ...DEFAULT_MIG_CONFIG, minSlopeAngleDeg: minAngle }),
    [minAngle],
  );

  const batch = useMemo(() => {
    const sdsMap = sdsRowsToMap(sdsRows);
    const snapshots = buildMarketInterestSnapshotsFromSimulation(simTable, sdsMap, {
      chartsBundle,
    });
    return evaluateBatch(snapshots, config);
  }, [simTable, sdsRows, config, chartsBundle, dataFreshKey]);

  const calibModalRow = useMemo(() => {
    if (!calibModalKey) return null;
    return batch.all.find((r) => migRowKey(r) === calibModalKey) ?? null;
  }, [calibModalKey, batch.all]);

  const calibModalSimRow = useMemo(
    () => (calibModalRow ? findSimRowForMig(simTable, calibModalRow) : null),
    [calibModalRow, simTable],
  );

  const scoped = useMemo(
    () =>
      batch.all.filter((r) =>
        recordMatchesScope(r.ticker, listMode, portfolioTickers, watchTickers),
      ),
    [batch.all, listMode, portfolioTickers, watchTickers],
  );

  const positiveSlopeInScope = useMemo(
    () => scoped.filter((r) => r.slopeAngleDeg > 0).length,
    [scoped],
  );

  const cdUnder60InScope = useMemo(
    () => scoped.filter((r) => isHotZone(r.daysToCd)).length,
    [scoped],
  );

  const filtered = useMemo(() => {
    let rows = verdictFilter === "all" ? scoped : scoped.filter((r) => r.verdict === verdictFilter);
    if (cdUnder60Only) {
      rows = rows.filter((r) => isHotZone(r.daysToCd));
    }
    if (positiveSlopeOnly) {
      rows = rows.filter((r) => r.slopeAngleDeg > 0);
      rows = [...rows].sort((a, b) => b.slopeAngleDeg - a.slopeAngleDeg);
    } else if (cdUnder60Only) {
      rows = [...rows].sort((a, b) => {
        const da = a.daysToCd ?? 999;
        const db = b.daysToCd ?? 999;
        if (da !== db) return da - db;
        return a.ticker.localeCompare(b.ticker);
      });
    } else if (listMode === "all") {
      rows = [...rows].sort((a, b) => {
        const ap = isPortfolioTicker(a.ticker) ? 0 : 1;
        const bp = isPortfolioTicker(b.ticker) ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.ticker.localeCompare(b.ticker);
      });
    }
    return rows;
  }, [scoped, verdictFilter, positiveSlopeOnly, cdUnder60Only, listMode, isPortfolioTicker]);

  const portfolioRank = useMemo(() => {
    const items = filtered
      .filter((r) => isPortfolioTicker(r.ticker))
      .map((r) => {
        const simRow = findSimRowForMig(simTable, r);
        const pos = simRow ? computeSimulationPosition(simRow, inputs) : null;
        return {
          key: migRowKey(r),
          pnlEur: pos?.pnlUnavailable ? null : pos?.pnlEur ?? null,
          pnlPct: pos?.pnlUnavailable ? null : pos?.pnlPct ?? null,
          pnlPctToday: null,
          hasToday: false,
        };
      });
    return buildPnlRankIndexMap(items, "total", (item) => item.key);
  }, [filtered, simTable, inputs, isPortfolioTicker]);

  const handleAngleChange = (v: number) => {
    setMinAngle(v);
    saveMigMinSlopeAngleDeg(v);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="invest-trend-chart-panel rounded-xl border px-3 py-2.5 space-y-2 shrink-0">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{t("signals.mig.title")}</p>
            <p className="text-[11px] text-ink-muted leading-snug mt-0.5">
              {t("signals.mig.subtitle")}
            </p>
            <p className="text-[10px] text-[rgb(var(--panel-feed-accent-strong))]/85 leading-snug mt-1 border-l-2 border-[rgb(var(--panel-feed-accent))]/35 pl-2">
              {t("signals.mig.tableGuide")}
            </p>
          </div>
          <div className="text-[11px] tabular-nums text-ink-muted shrink-0">
            {batch.pass.length} PASS · {batch.watch.length} WATCH · {batch.block.length} BLOCK
            {sdsLoading ? ` · SDS…` : ""}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[rgb(var(--border))]/30">
          <PortfolioScopeToggle mode={listMode} onModeChange={setListMode} counts={counts} it={it} />
          <SelectionChip
            active={positiveSlopeOnly}
            title={t("signals.mig.filterPositiveSlopeTip")}
            onClick={() => {
              setPositiveSlopeOnly((on) => {
                const next = !on;
                saveMigPositiveSlopeOnly(next);
                return next;
              });
            }}
          >
            <span
              className="mr-0.5"
              style={{ color: positiveSlopeOnly ? "inherit" : "rgb(var(--signal-up))" }}
              aria-hidden
            >
              ↑
            </span>
            {t("signals.mig.filterPositiveSlope", { n: positiveSlopeInScope })}
          </SelectionChip>
          <SelectionChip
            active={cdUnder60Only}
            title={t("signals.mig.filterCdUnder60Tip")}
            onClick={() => {
              setCdUnder60Only((on) => {
                const next = !on;
                saveMigCdUnder60Only(next);
                return next;
              });
            }}
          >
            {t("signals.mig.filterCdUnder60", { n: cdUnder60InScope })}
          </SelectionChip>
          <span className="text-[11px] text-ink-muted tabular-nums">
            {filtered.length} / {scoped.length}
            {listMode !== "all" ? ` · ${batch.all.length} ${it ? "totali" : "total"}` : ""}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[rgb(var(--border))]/30">
          <label className="flex flex-col gap-1 min-w-[200px] flex-1">
            <span className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              <span>{t("signals.mig.minAngle", { deg: minAngle })}</span>
              <button
                type="button"
                className="normal-case font-semibold text-[rgb(var(--accent))] underline underline-offset-2 hover:opacity-80"
                title={t("signals.mig.angleGuide.openTip")}
                onClick={() => setAngleGuideOpen(true)}
              >
                {t("signals.mig.angleGuide.openButton")}
              </button>
            </span>
            <input
              type="range"
              min={10}
              max={35}
              step={1}
              value={minAngle}
              onChange={(e) => handleAngleChange(Number(e.target.value))}
              className="w-full accent-[rgb(var(--accent))]"
            />
          </label>
          <SelectionChipGroup>
            {(
              [
                ["all", t("signals.mig.filterAll")],
                ["PASS", "PASS"],
                ["WATCH", "WATCH"],
                ["BLOCK", "BLOCK"],
              ] as const
            ).map(([id, label]) => (
              <SelectionChip
                key={id}
                active={verdictFilter === id}
                onClick={() => setVerdictFilter(id)}
              >
                {label}
              </SelectionChip>
            ))}
          </SelectionChipGroup>
        </div>
      </div>

      <details className="rounded-lg border border-[rgb(var(--panel-lab-border))]/40 px-3 py-2 text-[11px] text-ink-muted shrink-0">
        <summary className="cursor-pointer font-semibold text-ink/90 select-none">
          {t("signals.mig.formulaTitle")}
        </summary>
        <div className="mt-2 space-y-1 leading-relaxed font-mono text-[10px]">
          <p>MII_raw = ΔPrice% × log(VolRatio + 1) × √VolRatio</p>
          <p>slope° = arctan(MII_raw / {DEFAULT_MIG_CONFIG.normalizationFactor}) × 180/π</p>
          <p>
            {it
              ? `mod° pre = Pred+5 curva prima daily open · mod° post = dopo ancoraggio live · Calib 0–100 = MII vs mod°`
              : `mod° pre = Pred+5 before daily open · mod° post = after live anchor · Calib 0–100 = MII vs mod°`}
          </p>
          <p>
            {it
              ? `PASS ≥ ${minAngle}° · WATCH ≥ ${minAngle - DEFAULT_MIG_CONFIG.watchBandDeg}° · sotto = rumore`
              : `PASS ≥ ${minAngle}° · WATCH ≥ ${minAngle - DEFAULT_MIG_CONFIG.watchBandDeg}° · below = noise`}
          </p>
          <p>{t("signals.mig.gateNote")}</p>
          <p className="font-sans not-italic pt-1 text-ink-muted/90">{t("signals.mig.glyphLegend")}</p>
          <p className="font-sans not-italic text-ink-muted/90">{t("signals.mig.calibVisualLegend")}</p>
          <p className="font-sans not-italic text-ink-muted/80">
            {it ? "Clic sulla torta Calib per il grafico ad alta risoluzione." : "Click Calib pie for high-resolution slope chart."}
          </p>
        </div>
      </details>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto rounded-lg border border-[rgb(var(--panel-feed-border))]/40">
        <table className={`${SHEET_GRID_TABLE_CLASS} mig-interest-table text-[13px] min-w-[860px]`}>
          <SheetGridColgroup widths={MIG_INTEREST_GRID_COL_PCT} />
          <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-elevated))] shadow-[0_1px_0_rgb(var(--border)/0.55)]">
            <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
              <th className={`${sheetGridThClass("ticker")} py-2 font-semibold`} data-col="ticker">
                <MigColHeader label="Ticker" tip={t("signals.mig.col.tickerTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_curve")} py-2 font-semibold`} data-col="mig_curve">
                <MigColHeader label={t("signals.mig.col.curve")} tip={t("signals.mig.col.curveTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_slope")} py-2 font-semibold`} data-col="mig_slope">
                <MigColHeader label={t("signals.mig.col.miiAngle")} tip={t("signals.mig.col.miiAngleTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_calib")} py-2 font-semibold`} data-col="mig_calib">
                <MigColHeader label={t("signals.mig.col.calibVisual")} tip={t("signals.mig.col.calibVisualTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_gate")} py-2 font-semibold`} data-col="mig_gate">
                <MigColHeader label={t("signals.mig.col.gate")} tip={t("signals.mig.col.gateTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_pnl24h")} py-2 font-semibold`} data-col="mig_pnl24h">
                <MigColHeader label={t("signals.mig.col.pnl24h")} tip={t("signals.mig.col.pnl24hTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_delta")} py-2 font-semibold`} data-col="mig_delta">
                <MigColHeader label={t("signals.mig.col.delta")} tip={t("signals.mig.col.deltaTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_vol")} py-2 font-semibold`} data-col="mig_vol">
                <MigColHeader label={t("signals.mig.col.vol")} tip={t("signals.mig.col.volTip")} />
              </th>
              <th className={`${sheetGridThClass("mig_mii")} py-2 font-semibold`} data-col="mig_mii">
                <MigColHeader label={t("signals.mig.col.miiRaw")} tip={t("signals.mig.col.miiRawTip")} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={MIG_COL_COUNT} className="px-3 py-8 text-center text-ink-muted text-sm">
                  {simTable?.rows?.length
                    ? t("signals.mig.emptyFilter")
                    : t("signals.mig.emptySim")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <MigRow
                  key={migRowKey(r)}
                  row={r}
                  simTable={simTable}
                  chartsBundle={chartsBundle}
                  inputs={inputs}
                  inPortfolio={isPortfolioTicker(r.ticker)}
                  rankIndex={portfolioRank.rankByKey.get(migRowKey(r))}
                  rankTotal={portfolioRank.total}
                  minAngle={minAngle}
                  onOpenCalib={() => setCalibModalKey(migRowKey(r))}
                  onOpenPredictionCharts={onOpenPredictionCharts}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <MiiAngleGuideModal
        open={angleGuideOpen}
        onClose={() => setAngleGuideOpen(false)}
        currentMinAngle={minAngle}
      />

      <MigCalibModal
        open={calibModalKey != null && calibModalRow != null}
        onClose={() => setCalibModalKey(null)}
        row={calibModalRow}
        priceRefreshAt={calibModalSimRow ? priceRefreshAtFromRow(calibModalSimRow) : null}
        chartsUpdatedAt={chartsBundle?.loaded_at ?? null}
        changePct24h={calibModalSimRow ? dailyChangePctFromRow(calibModalSimRow) : null}
        pnlEur24h={
          calibModalSimRow && calibModalRow && isPortfolioTicker(calibModalRow.ticker)
            ? (() => {
                const pos = computeSimulationPosition(calibModalSimRow, inputs);
                if (!pos || pos.pnlUnavailable) return null;
                return portfolioDailyPnlFromRow(pos, calibModalSimRow).pnlEur24h;
              })()
            : null
        }
      />
    </div>
  );
}

function MigRow({
  row,
  simTable,
  chartsBundle,
  inputs,
  inPortfolio,
  rankIndex,
  rankTotal,
  minAngle,
  onOpenCalib,
  onOpenPredictionCharts,
}: {
  row: MIGResult;
  simTable: SheetTable | null;
  chartsBundle?: ChartBundle | null;
  inputs: ReturnType<typeof useSimulationPortfolioScope>["inputs"];
  inPortfolio: boolean;
  rankIndex: number | undefined;
  rankTotal: number;
  minAngle: number;
  onOpenCalib: () => void;
  onOpenPredictionCharts?: (focus: { ticker: string; seriesKey: string | null }) => void;
}) {
  const t = useT();
  const simRow = findSimRowForMig(simTable, row);
  const dailyPct = simRow ? dailyChangePctFromRow(simRow) : null;
  const tip = buildMigSlopeTooltip(row, dailyPct, t);
  const deltaTip = buildMigDeltaColumnTooltip(row, dailyPct, t);
  const calibTip = buildMigCalibTooltip(row, dailyPct, t);
  const chartPts = resolveMigChartPoints(simRow, chartsBundle);
  const pos = simRow && inPortfolio ? computeSimulationPosition(simRow, inputs) : null;
  const curves = simRow ? extractCurveInputs(simRow) : null;
  const targetStop =
    simRow && simTable?.columns?.length
      ? sparklineTargetStopFromSimRow(simRow, simTable.columns)
      : null;
  const seriesKey = simRow ? simulationRowSeriesKey(simRow) ?? null : null;
  const pnlTone = portfolioPnlTone(
    pos?.pnlUnavailable ? null : pos?.pnlEur ?? null,
    pos?.pnlUnavailable ? null : pos?.pnlPct ?? null,
  );
  const dailyPnl =
    simRow && inPortfolio && pos && !pos.pnlUnavailable
      ? portfolioDailyPnlFromRow(pos, simRow)
      : { pnlEur24h: null as number | null, pnlPct24h: dailyPct };
  const dailyTone = portfolioPnlTone(dailyPnl.pnlEur24h, dailyPnl.pnlPct24h);
  const deltaDiverges = migDeltaDivergesFrom24h(row, dailyPct);
  const rankIcon =
    inPortfolio && rankIndex != null
      ? pnlTableRankIcon(rankIndex, rankTotal, pnlTone)
      : null;

  return (
    <tr className="border-t border-[rgb(var(--border))]/30 hover:bg-[rgb(var(--surface-3))]/25">
      <td className={sheetGridTdClass("ticker")} data-col="ticker">
        <div className="flex items-center gap-1.5 min-w-0">
          {rankIcon ? (
            <RankAnimalIcon visual={rankIcon} basePx={18} />
          ) : (
            <span className="inline-block w-[18px] shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            {inPortfolio ? (
              <PortfolioTickerMark
                ticker={row.ticker}
                inPortfolio
                pnlPct={pos?.pnlUnavailable ? null : pos?.pnlPct}
                pnlEur={pos?.pnlUnavailable ? null : pos?.pnlEur}
                slope5d={curves?.slope5d ?? null}
                slope20d={curves?.slope20d ?? null}
                className="text-[13px]"
              />
            ) : (
              <TickerWithCdLifecycle ticker={row.ticker} cd={row.cd ?? ""} days={row.daysToCd} />
            )}
            {inPortfolio && row.cd ? (
              <p className="text-[10px] text-ink-muted truncate mt-0.5">
                CD {row.cd}
                {row.daysToCd != null ? ` · T−${row.daysToCd}d` : ""}
              </p>
            ) : null}
          </div>
        </div>
      </td>
      <td className={`${sheetGridTdClass("mig_curve")} align-middle overflow-hidden`} data-col="mig_curve">
        {simRow ? (
          <div className="flex justify-center min-w-0">
            <button
              type="button"
              className={`rounded-md border border-transparent p-0.5 transition ${
                onOpenPredictionCharts
                  ? "cursor-pointer hover:border-[rgb(var(--accent))]/35 hover:bg-[rgb(var(--surface-3))]/35"
                  : "cursor-default"
              }`}
              title={t("signals.mig.col.curveTip")}
              onClick={() =>
                onOpenPredictionCharts?.({
                  ticker: row.ticker,
                  seriesKey,
                })
              }
              disabled={!onOpenPredictionCharts}
            >
              <SimulationSparkline
                row={simRow}
                points={chartPts}
                width={92}
                height={30}
                showCdZones
                showZoneLabels={false}
                targetStop={targetStop}
                portfolio={
                  inPortfolio && pos && !pos.pnlUnavailable && pos.buyPrice > 0
                    ? {
                        pnlPct: pos.pnlPct,
                        buyPriceUsd: pos.buyPrice,
                      }
                    : null
                }
              />
            </button>
          </div>
        ) : (
          <span className="text-ink-muted/40 text-[10px]">—</span>
        )}
      </td>
      <td className={sheetGridTdClass("mig_slope")} data-col="mig_slope" title={tip}>
        <SlopeAngleGlyph
          angleDeg={row.slopeAngleDeg}
          thresholdDeg={minAngle}
          size={GLYPH_SIZE}
          showLabel
        />
      </td>
      <td className={`${sheetGridTdClass("mig_calib")} align-middle`} data-col="mig_calib">
        <MigCalibVisual
          miiAngleDeg={row.slopeAngleDeg}
          calibPre={row.calibPreDaily}
          calibPost={row.calibPostDaily}
          tip={calibTip}
          clickHint={t("signals.mig.col.calibClickHint")}
          onOpenDetail={onOpenCalib}
        />
      </td>
      <td className={sheetGridTdClass("mig_gate")} data-col="mig_gate">
        <span
          className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-bold ${verdictTone(row.verdict)}`}
        >
          {row.verdict}
        </span>
      </td>
      <td
        className={`${sheetGridTdClass("mig_pnl24h")} tabular-nums text-[13px]`}
        data-col="mig_pnl24h"
        title={
          deltaDiverges && dailyPct != null
            ? `${t("signals.mig.col.pnl24hTip")} · ${t("signals.mig.deltaSource.divergenceShort", {
                daily: `${dailyPct >= 0 ? "+" : ""}${dailyPct.toFixed(1)}%`,
              })}`
            : t("signals.mig.col.pnl24hTip")
        }
      >
        {dailyPct != null ? (
          <div className="leading-tight">
            <span className={portfolioPnlTextClass(null, dailyPct)}>{fmtPortfolioPnlPct(dailyPct)}</span>
            {inPortfolio && dailyPnl.pnlEur24h != null && dailyTone !== "flat" ? (
              <p className={`text-[10px] mt-0.5 ${portfolioPnlTextClass(dailyPnl.pnlEur24h, dailyPct)}`}>
                {fmtSignedUsdPnl(dailyPnl.pnlEur24h)}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-ink-muted/40 text-[10px]">—</span>
        )}
      </td>
      <td
        className={`${sheetGridTdClass("mig_delta")} tabular-nums text-[13px] ${
          row.deltaPricePct >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]"
        }`}
        data-col="mig_delta"
        title={deltaTip}
      >
        {row.deltaPricePct >= 0 ? "+" : ""}
        {row.deltaPricePct.toFixed(1)}%
        {row.deltaSource === "Var.1M→5d" ? (
          <span
            className="ml-0.5 text-[9px] font-semibold uppercase text-amber-700/90 dark:text-amber-300/90"
            title={t("signals.mig.deltaSource.var1m", { delta: `${row.deltaPricePct.toFixed(1)}%` })}
          >
            1M
          </span>
        ) : null}
      </td>
      <td className={`${sheetGridTdClass("mig_vol")} tabular-nums text-[13px]`} data-col="mig_vol">
        {row.volRatio.toFixed(2)}×
        {row.lowVolumePenalty ? (
          <span className="ml-0.5 text-amber-600" title="Low volume penalty">
            ⚠
          </span>
        ) : null}
      </td>
      <td
        className={`${sheetGridTdClass("mig_mii")} tabular-nums text-ink-muted text-[13px]`}
        data-col="mig_mii"
        title={t("signals.mig.col.miiRawTip")}
      >
        {row.miiRaw.toFixed(2)}
      </td>
    </tr>
  );
}
