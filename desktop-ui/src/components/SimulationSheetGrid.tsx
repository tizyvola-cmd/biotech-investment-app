import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  holdingDaysFromInvestedAt,
  loadInvestSimHistory,
  getInvestSimInputsSnapshot,
  resolveInvestedAt,
} from "../sheet/investSimStorage";
import {
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import {
  enrichSimulationTable,
  rowHasActivePortfolio,
  computeSimulationPosition,
  currentPriceFromRow,
  portfolioDailyPnlFromRow,
  SIM_PNL_NA_TOOLTIP,
  SIM_BUY_PRICE_MISSING_TOOLTIP,
} from "../sheet/simulationPosition";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  buildPortfolioPositionDisplay,
  portfolioTotalDisplayValues,
  portfolioGainFieldLabel,
  portfolioDailyChangeLabel,
  portfolioPnlTone,
  portfolioPnlValueClass,
  portfolioCardOutlookClass,
  portfolioSimulationGridThemeFromOutlook,
  resolvePortfolioTableOutlook,
} from "../sheet/portfolioGainLossStyle";
import { extractCurveInputs } from "../sheet/precatCurve";
import { fmtSimulationCell } from "../sheet/simulationStyles";
import { normalizedRowKey, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { pickSignalFromSimRow } from "../sheet/top2FromSimulation";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
  type SimulationSolidityResult,
} from "../sheet/simulationEntrySolidity";
import { SimulationSolidityBadge } from "./SimulationSolidityBadge";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { sheetCellAsLinkOrNct } from "../sheet/cellLinks";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { PortfolioTrendLegend } from "./PortfolioPnlTrendIcon";
import { readLocalSdsSnapshot, type SdsRow } from "../api/supernova";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { buildSdsByTicker } from "../sheet/sdsTopOppGate";
import { getLang, t as tStatic } from "../shared/i18n";
import { CapitalNumberInput } from "./CapitalNumberInput";
import { DecimalTextInput } from "./DecimalTextInput";
import { formatDecimalInput } from "../sheet/decimalInput";
import { resolveExpectedGainPlan } from "../sheet/simulationPlanGain";
import { primaryReturnPctFromGainPlan } from "../sheet/canonicalRoi";
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  ExpectedRoiCell,
  TargetRoiCell,
} from "../sheet/expectedRoiDisplay";

const CURVA_COLUMN = "__curva_pred__";

function valNum(row: Record<string, unknown>, column: string): number | null {
  const v = Number(row[column]);
  return Number.isFinite(v) ? v : null;
}

function qualityBadge(raw: unknown): { label: string; cls: string } | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("exact")) {
    return {
      label: "Exact",
      cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/35",
    };
  }
  if (v.includes("partial")) {
    return {
      label: "Partial",
      cls: "bg-amber-500/15 text-amber-700 border-amber-500/35",
    };
  }
  if (v.includes("unmatch")) {
    return {
      label: "Unmatch",
      cls: "bg-rose-500/15 text-rose-700 border-rose-500/35",
    };
  }
  return null;
}

/**
 * Portfolio block cards (Catalyst Hub + Simulation blocks).
 * Tema verdino chiaro: card mint, riquadri bianchi, testi scuri + verde/giallo/rosso leggibili.
 */
const PORTFOLIO_BLOCK = {
  // ── Gaining ─────────────────────────────────────────────────────────────
  card:        "rounded-xl border border-emerald-300/80 bg-emerald-50/95 p-3 shadow-sm",
  leftBorder:  { borderLeft: "4px solid rgb(22 163 74)" } as React.CSSProperties,
  metric:      "rounded-lg border border-emerald-300/70 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMuted: "rounded-lg border border-emerald-200/80 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  label:       "text-[10px] uppercase tracking-wide text-emerald-900/75 font-semibold",
  fieldLabel:  "text-[10px] uppercase tracking-wide text-emerald-900/80 flex items-center gap-1 font-semibold",
  tickerSize:  "text-[18px] text-emerald-950",
  company:     "text-[11px] text-emerald-900/85",
  // ── Losing ──────────────────────────────────────────────────────────────
  cardDown:        "rounded-xl border border-rose-300/80 bg-rose-50/95 p-3 shadow-sm",
  leftBorderDown:  { borderLeft: "4px solid rgb(220 38 38)" } as React.CSSProperties,
  metricDown:      "rounded-lg border border-rose-300/70 bg-white/95 px-2 py-1.5 shadow-sm min-w-0",
  metricMutedDown: "rounded-lg border border-rose-200/80 bg-white/90 px-2 py-1.5 shadow-sm min-w-0",
  labelDown:       "text-[10px] uppercase tracking-wide text-rose-900/75 font-semibold",
  fieldLabelDown:  "text-[10px] uppercase tracking-wide text-rose-900/80 flex items-center gap-1 font-semibold",
  tickerSizeDown:  "text-[18px] text-rose-950",
  companyDown:     "text-[11px] text-rose-900/85",
  // ── Shared ──────────────────────────────────────────────────────────────
  value:   "font-semibold text-slate-900 mt-0.5 tabular-nums leading-snug break-words",
  pnlUp:   "text-[13px] font-bold text-emerald-700",
  pnlDown: "text-[13px] font-bold text-red-700",
  pnlFlat: "text-[13px] font-bold text-slate-800",
} as const;

function fieldIcon(column: string): string {
  const c = column.toLowerCase();
  if (c.includes("p&l")) return "💹";
  if (c.includes("capital") || c.includes("capitale")) return "💶";
  if (c.includes("price") || c.includes("prezzo")) return "💲";
  if (c.includes("completion") || c.includes("date")) return "📅";
  if (c.includes("affidabil") || c.includes("reliability")) return "🛡️";
  if (c.includes("nct")) return "🔗";
  if (c.includes("sponsor")) return "🏢";
  if (c.includes("model") || c.includes("modello") || c.includes("inferenz")) return "🧠";
  if (c.includes("azioni") || c.includes("shares")) return "🧾";
  if (c.includes("var.") || c.includes("delta") || c.includes("t-") || c.includes("t+")) return "📈";
  return "";
}

function fieldIconTone(column: string, inPortfolio: boolean): string {
  if (!inPortfolio) return "";
  const c = column.toLowerCase();
  if (c.includes("capital") || c.includes("capitale")) return "text-blue-700";
  if (c.includes("prezzo acquisto") || (c.includes("buy") && c.includes("price"))) {
    return "text-emerald-700";
  }
  return "text-emerald-800/70";
}

function fieldToneClass(column: string, valueText: string): string {
  const c = column.toLowerCase();
  const v = valueText.trim();
  const vl = v.toLowerCase();
  const firstNum = Number(v.replace(",", ".").match(/-?\d+(\.\d+)?/)?.[0] ?? NaN);
  if (c.includes("exact-partial") || c.includes("exact:partial")) {
    if (vl.includes("exact")) return "text-positive font-semibold";
    if (vl.includes("partial")) return "text-[rgb(var(--warn))] font-semibold";
    if (vl.includes("unmatch")) return "text-negative font-semibold";
  }
  if (c.includes("relazione sponsor") || c.includes("sponsor relation")) {
    if (vl.includes("direct sponsor") || vl.includes("exact sponsor")) {
      return "text-positive font-semibold";
    }
    if (
      vl.includes("collaborator") ||
      vl.includes("collaboratori") ||
      vl.includes("subsidiary") ||
      vl.includes("affiliate") ||
      vl.includes("partner")
    ) {
      return "text-[rgb(var(--warn))] font-semibold";
    }
  }
  if (c.includes("liquidit")) {
    if (Number.isFinite(firstNum)) {
      if (firstNum >= 1.5) return "text-positive font-semibold";
      if (firstNum >= 1.0) return "text-[rgb(var(--warn))] font-semibold";
      return "text-negative font-semibold";
    }
  }
  if (c.includes("beta")) {
    if (Number.isFinite(firstNum)) {
      if (firstNum <= 1.2) return "text-positive font-semibold";
      if (firstNum <= 1.8) return "text-[rgb(var(--warn))] font-semibold";
      return "text-negative font-semibold";
    }
  }
  if (c.includes("p&l") || c.includes("var.") || c.includes("delta") || c.includes("pred") || c.includes("t-") || c.includes("t+")) {
    if (Number.isFinite(firstNum)) {
      const tone =
        c.includes("p&l") && c.includes("%")
          ? portfolioPnlTone(null, firstNum)
          : c.includes("p&l")
            ? portfolioPnlTone(firstNum)
            : firstNum > 0
              ? "gain"
              : firstNum < 0
                ? "loss"
                : "flat";
      if (tone === "gain") return "text-positive font-semibold";
      if (tone === "loss") return "text-negative font-semibold";
      if (tone === "flat" && c.includes("p&l")) return "text-slate-700 font-semibold";
    }
    if (v.startsWith("+")) return "text-positive font-semibold";
    if (v.startsWith("-")) return "text-negative font-semibold";
  }
  if (c.includes("affidabil")) {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) {
      if (n >= 70) return "text-positive font-semibold";
      if (n < 50) return "text-negative font-semibold";
      return "text-[rgb(var(--warn))] font-semibold";
    }
  }
  return "text-ink";
}

function pickRowValue(
  row: Record<string, unknown>,
  candidates: string[],
): unknown {
  for (const key of candidates) {
    if (key in row) return row[key];
  }
  const normalized = new Map<string, string>();
  for (const k of Object.keys(row)) {
    normalized.set(k.toLowerCase().replace(/\s+/g, " ").trim(), k);
  }
  for (const key of candidates) {
    const nk = key.toLowerCase().replace(/\s+/g, " ").trim();
    const found = normalized.get(nk);
    if (found) return row[found];
  }
  return undefined;
}

function fmtBoughtAt(iso?: string, dateOnly = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (dateOnly) {
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function holdingDaysLabel(iso?: string | null, endIso?: string | null): string {
  const days = holdingDaysFromInvestedAt(iso, endIso);
  return days == null ? "—" : `${days} d`;
}

function fmtSnapshotPriceLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type SimFocusTicker = { ticker: string; action: "buy" | "sell" };

export type SimulationSheetGridProps = {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  rowFilter?: (row: Record<string, unknown>) => boolean;
  /** Local simulation input; if absent uses localStorage at table load time. */
  inputs?: InvestSimInputs;
  focusTicker?: SimFocusTicker | null;
  onFocusConsumed?: () => void;
  /** Inline Buy € / Capital € on portfolio cards. */
  portfolioEditable?: boolean;
  onPortfolioInput?: (key: string, field: "buyPrice" | "capital", value: number) => void;
  onPortfolioPurchaseDate?: (key: string, date: string) => void;
  onPortfolioBuy?: (key: string) => void;
  onPortfolioSell?: (key: string) => void;
  onPortfolioDetails?: (key: string) => void;
  /** Bumps chart reload after snapshot refresh. */
  tableVersion?: string;
  /** Excel / snapshot timestamp for market prices (ISO). */
  priceSnapshotAt?: string | null;
};

export function SimulationSheetGrid({
  table,
  loading,
  error,
  onReload,
  rowFilter,
  inputs: inputsProp,
  focusTicker,
  onFocusConsumed,
  portfolioEditable,
  onPortfolioInput,
  onPortfolioPurchaseDate,
  onPortfolioBuy,
  onPortfolioSell,
  onPortfolioDetails,
  tableVersion,
  priceSnapshotAt,
}: SimulationSheetGridProps) {
  const lang = getLang();
  const fallbackInputs = useMemo(() => getInvestSimInputsSnapshot(), [table, tableVersion]);
  const resolvedInputs = inputsProp ?? fallbackInputs;
  const portfolioHistory = useMemo(
    () => loadInvestSimHistory(),
    [table, tableVersion, resolvedInputs]
  );

  const enrichedTable = useMemo(
    () => enrichSimulationTable(table, resolvedInputs, { history: portfolioHistory }),
    [table, resolvedInputs, portfolioHistory]
  );

  const tableWithCurva = useMemo((): SheetTable | null => {
    if (!enrichedTable) return null;
    if (enrichedTable.columns.includes(CURVA_COLUMN)) {
      return enrichedTable;
    }
    const tickerIdx = enrichedTable.columns.findIndex((c) => c === "Ticker");
    const cols = [...enrichedTable.columns];
    if (tickerIdx >= 0) {
      cols.splice(tickerIdx + 1, 0, CURVA_COLUMN);
    } else {
      cols.push(CURVA_COLUMN);
    }
    return { ...enrichedTable, columns: cols };
  }, [enrichedTable]);

  // Chart bundle for the recalibrated model curve (sparkline).
  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSimulationChartsBundle().then((res) => {
      if (cancelled) return;
      setChartBundle(res.bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [tableVersion]);

  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readLocalSdsSnapshot().then((doc) => {
      if (cancelled) return;
      setSdsRowsForMig(doc?.rows ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [tableVersion]);

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(tableWithCurva, chartBundle, sdsRowsForMig),
    [tableWithCurva, chartBundle, sdsRowsForMig],
  );
  const sdsByTicker = useMemo(() => buildSdsByTicker(sdsRowsForMig), [sdsRowsForMig]);
  const solidityOpts = useMemo(
    () =>
      migSolidityByKey.size > 0 || sdsByTicker.size > 0
        ? { sdsByTicker, migByKey: migSolidityByKey }
        : undefined,
    [sdsByTicker, migSolidityByKey],
  );

  const pointsBySeriesKey = useMemo(() => {
    const map = new Map<string, ChartPoint[]>();
    const series = chartBundle?.series;
    if (!series) return map;
    for (const [k, s] of Object.entries(series)) {
      if (!k.startsWith("co:")) continue;
      if (Array.isArray(s?.points) && s.points.length > 0) {
        map.set(k, s.points);
      }
    }
    return map;
  }, [chartBundle]);

  const wrapperRef = useRef<HTMLDivElement>(null);

  const visibleRows = useMemo(() => {
    const rows = tableWithCurva?.rows ?? [];
    if (!rowFilter) return rows;
    return rows.filter((r) => rowFilter(r));
  }, [tableWithCurva?.rows, rowFilter]);

  const entrySolidityByKey = useMemo(() => {
    const map = new Map<string, SimulationSolidityResult>();
    if (!tableWithCurva?.rows?.length) return map;
    const merged = reconcileInvestSimInputs(resolvedInputs, tableWithCurva.rows);
    for (const row of tableWithCurva.rows) {
      const ticker = String(row["Ticker"] ?? "").trim();
      if (!ticker || ticker.includes("TOTALE")) continue;
      const simKey = normalizedRowKey(ticker, row["Completion Date"]);
      const sk = simulationRowSeriesKey(row);
      const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
      const pick = pickSignalFromSimRow(row, merged, chartPts, portfolioHistory);
      const inPortfolio = rowHasActivePortfolio(row, merged);
      const sol = resolveSimulationEntrySolidity(
        pick,
        solidityOpts,
        getLang() === "it" ? "it" : "en",
        inPortfolio ? "rascore" : "entry",
      );
      if (simulationSolidityVisible(sol)) map.set(simKey, sol);
    }
    return map;
  }, [tableWithCurva?.rows, resolvedInputs, pointsBySeriesKey, portfolioHistory, solidityOpts]);

  const portfolioCount = useMemo(() => {
    let n = 0;
    for (const r of tableWithCurva?.rows ?? []) {
      if (rowHasActivePortfolio(r, resolvedInputs)) n++;
    }
    return n;
  }, [tableWithCurva?.rows, resolvedInputs]);

  useEffect(() => {
    if (!focusTicker) return;
    const el = wrapperRef.current?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(focusTicker.ticker)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const t = setTimeout(() => onFocusConsumed?.(), 3000);
    return () => clearTimeout(t);
  }, [focusTicker, onFocusConsumed]);

  return (
    <div ref={wrapperRef} className="sim-harmonize flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex-1 min-h-0 h-full overflow-y-auto pr-1">
        {(loading || error) && (
          <div className="mb-3 rounded-md border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-elevated))] px-2.5 py-2 text-[11px]">
            {loading ? (
              <span className="text-ink-muted">Loading simulation data…</span>
            ) : null}
            {error ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[rgb(var(--signal-down))]">{error}</span>
                <button
                  type="button"
                  className="text-accent hover:underline font-medium"
                  onClick={() => onReload()}
                >
                  Reload
                </button>
              </div>
            ) : null}
          </div>
        )}
        <div className="sticky top-0 z-10 mb-3 space-y-1.5 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-600">
              {visibleRows.length} companies
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-[rgb(var(--signal-up))]">
              <span aria-hidden>💼</span>
              {portfolioCount} in portfolio
            </span>
          </div>
          {portfolioCount > 0 ? <PortfolioTrendLegend /> : null}
        </div>
        <div
          className={`grid gap-3 ${
            focusTicker || visibleRows.length <= 2
              ? "grid-cols-1"
              : "grid-cols-1 lg:grid-cols-2"
          }`}
        >
          {visibleRows.map((row, idx) => {
            const ticker = String(row["Ticker"] ?? "").trim();
            const simKey = normalizedRowKey(ticker, row["Completion Date"]);
            const entry = resolvedInputs[simKey];
            const inPortfolio = rowHasActivePortfolio(row, resolvedInputs);
            const portPos = inPortfolio
              ? computeSimulationPosition(row, resolvedInputs, { history: portfolioHistory })
              : null;
            const isFocused = !!focusTicker && ticker.toUpperCase() === focusTicker.ticker.toUpperCase();
            const tickerHref = sheetCellAsLinkOrNct(row["Ticker"], "Ticker")?.href;
            const company = fmtSimulationCell("Società", row["Società"]);
            const completionDate = fmtSimulationCell("Completion Date", row["Completion Date"]);
            const pnlUsd = valNum(row, "P&L ($)");
            const pnlPct = valNum(row, "P&L (%)");
            const investedRaw =
              entry && entry.capital > 0
                ? entry.capital
                : pickRowValue(row, ["Capitale investito ($)", "Capitale Investito ($)"]);
            const currentValueRaw = pickRowValue(row, ["Valore Attuale ($)", "Valore attuale ($)"]);
            const currPriceForBuy = currentPriceFromRow(row);
            const sheetBuy = pickRowValue(row, ["Prezzo acquisto ($)", "Prezzo Acquisto ($)"]) as
              | number
              | undefined;
            const buyPriceResolved =
              entry && entry.buyPrice > 0
                ? entry.buyPrice
                : typeof sheetBuy === "number" && sheetBuy > 0
                  ? sheetBuy
                  : undefined;
            const buyPriceEstimated = false;
            const currPriceRaw = pickRowValue(row, ["Prezzo corrente ($)", "Prezzo Corrente ($)"]);
            const invested = fmtSimulationCell("Capitale investito ($)", investedRaw);
            const currentValue = fmtSimulationCell("Valore Attuale ($)", currentValueRaw);
            const buyPrice = buyPriceResolved && buyPriceResolved > 0
              ? `${buyPriceEstimated ? "~" : ""}${fmtSimulationCell("Prezzo acquisto ($)", buyPriceResolved)}`
              : fmtSimulationCell("Prezzo acquisto ($)", pickRowValue(row, ["Prezzo acquisto ($)", "Prezzo Acquisto ($)"]));
            const currPrice = fmtSimulationCell("Prezzo corrente ($)", currPriceRaw);
            const investedAtIso = resolveInvestedAt(simKey, entry, portfolioHistory);
            const soldAtIso = entry?.soldAt;
            const hasPurchaseMeta =
              inPortfolio || !!(investedAtIso || entry?.purchaseDate || entry?.investedAt);
            const boughtAt = fmtBoughtAt(investedAtIso ?? undefined, !!entry?.purchaseDate);
            const holdingDays = holdingDaysLabel(
              investedAtIso,
              soldAtIso && entry?.ignoreSheet ? soldAtIso : null
            );
            const simPnlPct =
              inPortfolio && portPos && !portPos.pnlUnavailable
                ? portPos.pnlPct
                : pnlPct;
            const simPnlUsd =
              inPortfolio && portPos && !portPos.pnlUnavailable ? portPos.pnlEur : pnlUsd;
            const currentGain =
              inPortfolio && portPos && !portPos.pnlUnavailable
                ? fmtPortfolioPnlUsd(simPnlUsd)
                : fmtSimulationCell("P&L ($)", row["P&L ($)"]);
            const currentGainPct =
              inPortfolio && portPos && !portPos.pnlUnavailable
                ? fmtPortfolioPnlPct(simPnlPct)
                : fmtSimulationCell("P&L (%)", row["P&L (%)"]);
            const dailyPnl =
              inPortfolio && portPos && !portPos.pnlUnavailable
                ? portfolioDailyPnlFromRow(portPos, row)
                : { pnlEur24h: null as number | null, pnlPct24h: null as number | null };
            const portDisplay =
              inPortfolio && portPos
                ? buildPortfolioPositionDisplay(
                    portPos.pnlEur,
                    portPos.pnlPct,
                    dailyPnl,
                    { unavailable: portPos.pnlUnavailable },
                  )
                : null;
            const curvesForTone = extractCurveInputs(row);
            const sk = simulationRowSeriesKey(row);
            const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
            const planCapital =
              entry && entry.capital > 0 ? entry.capital : DEFAULT_PLAN_CAPITAL_EUR;
            const gainPlan = resolveExpectedGainPlan(row, planCapital, { chartPoints: chartPts });
            const rowOutlook = resolvePortfolioTableOutlook({
              inPortfolio,
              pnlEur: inPortfolio && portPos && !portPos.pnlUnavailable ? portPos.pnlEur : null,
              pnlPct: inPortfolio && portPos && !portPos.pnlUnavailable ? portPos.pnlPct : null,
              planReturnPct: gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null,
              slope5d: curvesForTone.slope5d,
              slope20d: curvesForTone.slope20d,
              simRow: row,
              chartPoints: chartPts,
            });
            const totalTone = portDisplay?.totalTone ?? null;
            const usesDailyForColor = portDisplay?.usesDailyForColor ?? false;
            const totalDisp =
              inPortfolio && portPos && !portPos.pnlUnavailable
                ? portfolioTotalDisplayValues(
                    portPos.pnlEur,
                    portPos.pnlPct,
                    dailyPnl.pnlEur24h,
                    dailyPnl.pnlPct24h,
                  )
                : null;
            const summaryGain =
              totalDisp?.eur != null
                ? fmtPortfolioPnlUsd(totalDisp.eur)
                : currentGain;
            const summaryGainPct =
              totalDisp?.pct != null
                ? fmtPortfolioPnlPct(totalDisp.pct)
                : currentGainPct;
            const totalDisplayTone = totalDisp?.tone ?? totalTone;
            const pb = portfolioSimulationGridThemeFromOutlook(rowOutlook);
            const matchBadge = qualityBadge(row["Exact-Partial vs Unmatch"]);
            const modelInference = fmtSimulationCell("Inferenza modello", row["Inferenza modello"]);
            const entrySolidity = entrySolidityByKey.get(simKey);
            return (
              <article
                key={`${ticker || "row"}-${idx}`}
                data-row-id={ticker || undefined}
                data-pnl-outlook={rowOutlook !== "flat" ? rowOutlook : undefined}
                className={`overflow-hidden transition ${
                  entrySolidity?.level === "blocked" && !isFocused && !inPortfolio
                    ? "ring-1 ring-amber-500/45 "
                    : ""
                }${
                  isFocused
                    ? focusTicker?.action === "buy"
                      ? "rounded-xl border-2 border-emerald-500 bg-emerald-50/98 p-3 shadow-md"
                      : "rounded-xl border-2 border-red-400 bg-rose-50/98 p-3 shadow-md"
                    : portfolioCardOutlookClass(rowOutlook)
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {!inPortfolio ? (
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Ticker</p>
                        {matchBadge ? (
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${matchBadge.cls}`}>
                            {matchBadge.label}
                          </span>
                        ) : null}
                      </div>
                    ) : matchBadge ? (
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold mb-0.5 ${matchBadge.cls}`}>
                        {matchBadge.label}
                      </span>
                    ) : null}
                    {tickerHref ? (
                      <a
                        href={tickerHref}
                        target="_blank"
                        rel="noreferrer"
                        className={`hover:underline ${inPortfolio && pb ? pb.tickerSize : ""}`}
                      >
                        <PortfolioTickerMark
                          ticker={ticker || "—"}
                          inPortfolio={inPortfolio}
                          pnlPct={portPos?.pnlUnavailable ? null : portPos?.pnlPct}
                          pnlEur={portPos?.pnlUnavailable ? null : portPos?.pnlEur}
                          slope5d={curvesForTone.slope5d}
                          slope20d={curvesForTone.slope20d}
                          pnlUnavailable={portPos?.pnlUnavailable}
                          tableOutlook={inPortfolio ? rowOutlook : null}
                        />
                      </a>
                    ) : (
                      <p className={`truncate font-extrabold tracking-wide ${inPortfolio && pb ? pb.tickerSize : "text-[16px]"}`}>
                        <PortfolioTickerMark
                          ticker={ticker || "—"}
                          inPortfolio={inPortfolio}
                          pnlPct={portPos?.pnlUnavailable ? null : portPos?.pnlPct}
                          pnlEur={portPos?.pnlUnavailable ? null : portPos?.pnlEur}
                          slope5d={curvesForTone.slope5d}
                          slope20d={curvesForTone.slope20d}
                          pnlUnavailable={portPos?.pnlUnavailable}
                          tableOutlook={inPortfolio ? rowOutlook : null}
                        />
                      </p>
                    )}
                    <p className={`truncate mt-0.5 ${inPortfolio && pb ? pb.company : "text-[11px] text-slate-500"}`}>
                      {company || "—"}
                    </p>
                  </div>
                  <div className="min-w-[132px]">
                    <p className={`${inPortfolio && pb ? pb.label : "text-[10px] uppercase tracking-wide text-slate-500"} mb-1`}>
                      Curve
                    </p>
                    <SimulationSparkline
                      row={row}
                      points={
                        (() => {
                          const sk = simulationRowSeriesKey(row);
                          return sk ? pointsBySeriesKey.get(sk) ?? null : null;
                        })()
                      }
                    />
                  </div>
                </div>
                {entrySolidity ? (
                  <div className="mb-2">
                    <SimulationSolidityBadge result={entrySolidity} variant="strip" />
                  </div>
                ) : null}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div className={inPortfolio && pb ? pb.metricMuted : "rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5"}>
                    <p
                      className={inPortfolio && pb ? pb.label : "text-[10px] uppercase tracking-wide text-slate-500"}
                      title={
                        usesDailyForColor
                          ? lang === "it"
                            ? "P&L totale dall'ingresso (prezzo acquisto → oggi)"
                            : "Total P&L since entry (buy → now)"
                          : undefined
                      }
                    >
                      P&L USD{lang === "it" ? " (tot.)" : " (tot.)"}
                    </p>
                    <p
                      className={
                        inPortfolio && totalDisplayTone
                          ? simPnlUsd == null
                            ? PORTFOLIO_BLOCK.pnlFlat
                            : portfolioPnlValueClass(totalDisplayTone)
                          : `text-[13px] font-bold ${
                              simPnlUsd == null
                                ? "text-ink"
                                : portfolioPnlValueClass(
                                    portfolioPnlTone(simPnlUsd, simPnlPct ?? null)
                                  )
                            }`
                      }
                      title={
                        inPortfolio && portPos?.pnlUnavailable
                          ? SIM_BUY_PRICE_MISSING_TOOLTIP
                          : row.__simPnlMissing === true
                              ? SIM_PNL_NA_TOOLTIP
                              : undefined
                      }
                    >
                      {currentGain || "—"}
                    </p>
                  </div>
                  <div className={inPortfolio && pb ? pb.metricMuted : "rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5"}>
                    <p className={inPortfolio && pb ? pb.label : "text-[10px] uppercase tracking-wide text-slate-500"}>
                      P&L %
                    </p>
                    <p
                      className={
                        inPortfolio && totalDisplayTone
                          ? simPnlPct == null
                            ? PORTFOLIO_BLOCK.pnlFlat
                            : portfolioPnlValueClass(totalDisplayTone)
                          : `text-[13px] font-bold ${
                              simPnlPct == null
                                ? "text-ink"
                                : portfolioPnlValueClass(
                                    portfolioPnlTone(simPnlUsd, simPnlPct)
                                  )
                            }`
                      }
                      title={
                        inPortfolio && portPos?.pnlUnavailable
                          ? SIM_BUY_PRICE_MISSING_TOOLTIP
                          : row.__simPnlMissing === true
                            ? SIM_PNL_NA_TOOLTIP
                            : undefined
                      }
                    >
                      {currentGainPct || "—"}
                    </p>
                  </div>
                </div>
                <div className="mb-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className={inPortfolio && pb ? pb.metric : "rounded-lg border border-slate-200 px-2 py-1.5"}>
                    <p className={inPortfolio && pb ? pb.fieldLabel : "text-slate-500"}>Completion Date</p>
                    <p className={inPortfolio ? PORTFOLIO_BLOCK.value : "font-medium text-slate-900"}>{completionDate || "—"}</p>
                  </div>
                  <div className={inPortfolio && pb ? pb.metric : "rounded-lg border border-slate-200 px-2 py-1.5"}>
                    <p className={inPortfolio && pb ? pb.fieldLabel : "text-slate-500"}>Model inference</p>
                    <p className={`truncate ${inPortfolio ? PORTFOLIO_BLOCK.value : "font-medium text-slate-900"}`}>
                      {modelInference || "—"}
                    </p>
                  </div>
                </div>
                <div
                  className={`mb-2 rounded-lg border px-2.5 py-2 text-[11px] ${
                    inPortfolio && pb ? pb.metric : "border-slate-200 bg-slate-50/60"
                  }`}
                  title={tStatic("sim.col.targetRoiTip")}
                >
                  <p className={inPortfolio && pb ? pb.fieldLabel : "text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1"}>
                    {lang === "it" ? "ROI target" : "Target ROI"}
                  </p>
                  <TargetRoiCell
                    lang={lang === "it" ? "it" : "en"}
                    daysToTarget={gainPlan.daysToTarget}
                    returnPct={gainPlan.targetReturnPct}
                    capitalEur={planCapital}
                    targetHighPct={gainPlan.targetHighPct}
                    variant="table"
                  />
                </div>
                {gainPlan.expectedReturnPct != null && (
                  <div
                    className={`mb-2 rounded-lg border px-2.5 py-2 text-[11px] opacity-85 ${
                      inPortfolio && pb ? pb.metric : "border-slate-200 bg-slate-50/40"
                    }`}
                    title={tStatic("sim.col.expectedRoiTip")}
                  >
                    <p className={inPortfolio && pb ? pb.fieldLabel : "text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1"}>
                      {lang === "it" ? "ROI→CD (info)" : "ROI→CD (info)"}
                    </p>
                    <ExpectedRoiCell
                      lang={lang === "it" ? "it" : "en"}
                      days={gainPlan.daysToCd}
                      returnPct={gainPlan.expectedReturnPct}
                      capitalEur={planCapital}
                      source={gainPlan.source}
                      variant="table"
                    />
                  </div>
                )}
                {hasPurchaseMeta && (
                  <div className="mb-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className={inPortfolio && pb ? pb.metric : "rounded-lg border border-slate-200 px-2 py-1.5"}>
                      <p className={inPortfolio && pb ? pb.fieldLabel : "text-slate-500"}>Bought at</p>
                      <p className={inPortfolio ? PORTFOLIO_BLOCK.value : "font-medium text-slate-900"}>{boughtAt}</p>
                    </div>
                    <div className={inPortfolio && pb ? pb.metric : "rounded-lg border border-slate-200 px-2 py-1.5"}>
                      <p className={inPortfolio && pb ? pb.fieldLabel : "text-slate-500"}>
                        {soldAtIso && entry?.ignoreSheet ? "Held (at sell)" : "Holding days"}
                      </p>
                      <p className={inPortfolio ? PORTFOLIO_BLOCK.value : "font-medium text-slate-900"}>{holdingDays}</p>
                    </div>
                    <div className={inPortfolio && pb ? pb.metric : "rounded-lg border border-slate-200 px-2 py-1.5"}>
                      <p className={inPortfolio && pb ? pb.fieldLabel : "text-slate-500"}>
                        {usesDailyForColor
                          ? portfolioDailyChangeLabel(lang === "it", totalDisplayTone ?? "flat")
                          : portfolioGainFieldLabel(lang === "it", totalDisplayTone ?? "flat")}
                      </p>
                      <p
                        className={
                          inPortfolio && totalDisplayTone
                            ? portfolioPnlValueClass(totalDisplayTone)
                            : `font-medium ${fieldToneClass("P&L (%)", currentGainPct || "")}`
                        }
                        title={
                          usesDailyForColor && dailyPnl.pnlEur24h != null
                            ? lang === "it"
                              ? `Var. giorno: ${fmtPortfolioPnlUsd(dailyPnl.pnlEur24h)}`
                              : `Daily move: ${fmtPortfolioPnlUsd(dailyPnl.pnlEur24h)}`
                            : undefined
                        }
                      >
                        {usesDailyForColor && dailyPnl.pnlEur24h != null
                          ? fmtPortfolioPnlUsd(dailyPnl.pnlEur24h)
                          : summaryGain || "—"}{" "}
                        {usesDailyForColor && dailyPnl.pnlPct24h != null
                          ? `(${fmtPortfolioPnlPct(dailyPnl.pnlPct24h)})`
                          : summaryGainPct && summaryGainPct !== "—"
                            ? `(${summaryGainPct})`
                            : ""}
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div className={`min-w-0 ${inPortfolio && pb ? pb.metric : ""}`}>
                    <p className={`flex items-center gap-1 ${inPortfolio && pb ? pb.fieldLabel : "text-ink-muted"}`}>
                      <span aria-hidden className={fieldIconTone("Capitale investito ($)", inPortfolio)}>
                        {fieldIcon("Capitale investito ($)")}
                      </span>
                      Invested capital {portfolioEditable ? "(€)" : ""}
                    </p>
                    {portfolioEditable && inPortfolio && onPortfolioInput ? (
                      <CapitalNumberInput
                        className="input w-full py-0.5 text-xs mt-0.5 tabular-nums text-slate-900 bg-white"
                        value={entry && entry.capital > 0 ? entry.capital : 0}
                        placeholder="5000"
                        onCommit={(n) => onPortfolioInput(simKey, "capital", n)}
                      />
                    ) : (
                      <div className={inPortfolio ? `${PORTFOLIO_BLOCK.value} truncate` : "truncate mt-0.5 text-ink"}>
                        {invested || "—"}
                      </div>
                    )}
                  </div>
                  <div className={`min-w-0 ${inPortfolio && pb ? pb.metric : ""}`}>
                    <p className={`flex items-center gap-1 ${inPortfolio && pb ? pb.fieldLabel : "text-ink-muted"}`}>
                      <span aria-hidden className={fieldIconTone("Valore Attuale ($)", inPortfolio)}>
                        {fieldIcon("Valore Attuale ($)")}
                      </span>
                      Current value
                    </p>
                    <div className={inPortfolio ? `${PORTFOLIO_BLOCK.value} truncate` : "truncate mt-0.5 text-ink"}>
                      {currentValue || "—"}
                    </div>
                  </div>
                  <div className={`min-w-0 ${inPortfolio && pb ? pb.metric : ""}`}>
                    <p className={`flex items-center gap-1 ${inPortfolio && pb ? pb.fieldLabel : "text-ink-muted"}`}>
                      <span aria-hidden className={fieldIconTone("Prezzo acquisto ($)", inPortfolio)}>
                        {fieldIcon("Prezzo acquisto ($)")}
                      </span>
                      Buy price {portfolioEditable ? "(€)" : ""}
                    </p>
                    {portfolioEditable && inPortfolio && onPortfolioInput ? (
                      <DecimalTextInput
                        className="input w-full py-0.5 text-xs mt-0.5 tabular-nums text-slate-900 bg-white"
                        value={entry && entry.buyPrice > 0 ? entry.buyPrice : 0}
                        placeholder={
                          currPriceForBuy != null
                            ? formatDecimalInput(currPriceForBuy)
                            : undefined
                        }
                        onCommit={(n) => onPortfolioInput(simKey, "buyPrice", n)}
                      />
                    ) : (
                      <div className={inPortfolio ? `${PORTFOLIO_BLOCK.value} truncate` : "truncate mt-0.5 text-ink"}>
                        {buyPrice || "—"}
                      </div>
                    )}
                    {portfolioEditable && inPortfolio && onPortfolioPurchaseDate ? (
                      <input
                        className="input w-full py-0.5 text-xs mt-1"
                        type="date"
                        value={entry?.purchaseDate ?? ""}
                        onChange={(e) => onPortfolioPurchaseDate(simKey, e.target.value)}
                        title="Purchase date"
                      />
                    ) : entry?.purchaseDate ? (
                      <p className="text-[10px] text-ink-muted mt-0.5">
                        {fmtBoughtAt(entry.purchaseDate + "T12:00:00", true)}
                      </p>
                    ) : null}
                  </div>
                  <div className={`min-w-0 ${inPortfolio && pb ? pb.metric : ""}`}>
                    <p className={`flex items-center gap-1 ${inPortfolio && pb ? pb.fieldLabel : "text-ink-muted"}`}>
                      <span aria-hidden className={fieldIconTone("Prezzo corrente ($)", inPortfolio)}>
                        {fieldIcon("Prezzo corrente ($)")}
                      </span>
                      Current price
                    </p>
                    <div className={inPortfolio ? `${PORTFOLIO_BLOCK.value} truncate` : "truncate mt-0.5 text-ink"}>
                      {currPrice || "—"}
                    </div>
                    {priceSnapshotAt ? (
                      <p className="text-[9px] text-ink-muted/65 tabular-nums mt-0.5">
                        {fmtSnapshotPriceLabel(priceSnapshotAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
                {portfolioEditable && (
                  <div
                    className={`mt-2 flex flex-wrap gap-1.5 border-t pt-2 ${
                      inPortfolio && totalDisplayTone
                        ? totalDisplayTone === "loss"
                          ? "border-rose-200/70"
                          : totalDisplayTone === "gain"
                            ? "border-emerald-200/70"
                            : "border-slate-200/80"
                        : "border-slate-200"
                    }`}
                  >
                    {onPortfolioBuy && !inPortfolio ? (
                      <button
                        type="button"
                        className="btn-ghost text-[10px] px-2 text-positive font-semibold"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onPortfolioBuy(simKey);
                        }}
                      >
                        Buy
                      </button>
                    ) : null}
                    {onPortfolioSell && inPortfolio ? (
                      <button
                        type="button"
                        className="btn-ghost text-[10px] px-2 text-positive"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onPortfolioSell(simKey);
                        }}
                      >
                        Sell
                      </button>
                    ) : null}
                    {onPortfolioDetails ? (
                      <button
                        type="button"
                        className="btn-ghost text-[10px] px-2"
                        onClick={() => onPortfolioDetails(simKey)}
                      >
                        Details
                      </button>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {!loading && visibleRows.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-muted">
            No portfolio positions — allocate capital on a ticker or switch to All.
          </p>
        )}
      </div>
    </div>
  );
}
