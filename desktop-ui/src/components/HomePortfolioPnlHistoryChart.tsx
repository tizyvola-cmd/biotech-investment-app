import { useEffect, useId, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import type { SheetTable } from "../types";
import {
  buildHomePortfolioPnlHistorySeries,
  buildHomeTickerEquityCurve,
  compressHomeSeriesByDay,
  filterHomeSeriesByRange,
  listHomeInvestedTickers,
  summarizeHomePortfolioPnlCurve,
  toHomePortfolioBreakevenPlot,
  withLiveHomePortfolioHistoryTip,
  type HomePnlHistoryRange,
  type HomePortfolioBreakevenRow,
  type HomePortfolioPnlHistoryRow,
  type HomeTickerEquityRow,
} from "../sheet/homePortfolioPnlHistory";
import { type BreakevenLogicPosition } from "../sheet/breakevenRecLogicFill";
import {
  buildBreakevenWeekSessions,
  type BreakevenWeekSession,
} from "../sheet/breakevenWeekSessions";
import {
  buildSoftLogicEraGradientStops,
  resolveSoftLogicEra,
  softLogicEraFill,
  softLogicEraHex,
  SOFT_LOGIC_ERAS,
  type SoftLogicEra,
} from "../sheet/softLogicChronology";
import { tickerLogicChipTone } from "../sheet/tickerLogicChipTone";
import { investTrendEurDomain } from "../sheet/investTrendOutlook";
import { fmtAxisEurTick } from "../sheet/chartAxisFormat";
import { isUsEquityTradingDay, isAfterUsEquityRegularClose } from "../sheet/marketSession";
import { useLang } from "../shared/i18n";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { PortfolioBriefcaseMark } from "./PortfolioScopeToggle";
/** Aggregate open book · aggregate closed book · or a live open ticker key. */
type Scope = "portfolio-open" | "portfolio-closed" | string;

function isPortfolioScope(scope: Scope): scope is "portfolio-open" | "portfolio-closed" {
  return scope === "portfolio-open" || scope === "portfolio-closed";
}

const RANGE_OPTIONS: { id: HomePnlHistoryRange; en: string; it: string }[] = [
  { id: "all", en: "All", it: "Tutto" },
  { id: "24h", en: "24h", it: "24h" },
  { id: "3d", en: "3 days", it: "3 giorni" },
  { id: "7d", en: "7 days", it: "7 giorni" },
];

/** Chart / tooltip unit: dollars vs return % on invested capital. */
type CurveUnit = "usd" | "pct";

function toCurvePlotY(
  valueUsd: number,
  capital: number | null | undefined,
  unit: CurveUnit,
  /** Fallback when a history row has no capital (avoid flat 0% curve). */
  capitalFallback?: number | null,
): number {
  if (unit === "usd") return valueUsd;
  const raw =
    capital != null && Number.isFinite(capital) && capital > 0
      ? capital
      : capitalFallback != null && Number.isFinite(capitalFallback) && capitalFallback > 0
        ? capitalFallback
        : null;
  if (raw == null) return 0;
  return Math.round((valueUsd / raw) * 1000) / 10;
}

function fmtAxisPctTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return `${Math.round(v)}%`;
  if (abs >= 10) return `${v.toFixed(0)}%`;
  return `${v.toFixed(1)}%`;
}

/**
 * Zoom Y to the P&L-% band (not −100%→0 recovery).
 * Linear % of $ is the same shape as $; without zoom the ricavi look flat.
 * Log scale is a poor fit across 0% (signed returns).
 */
function pctReturnDomain(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    n++;
  }
  if (n === 0) return [-8, 8];
  min = Math.min(min, 0);
  max = Math.max(max, 0);
  const span = Math.max(max - min, 6);
  const pad = Math.max(1.2, span * 0.2);
  const lo = Math.max(min - pad, -60);
  const hi = max + pad;
  return [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10];
}

function isSeedDayLabel(day: string): boolean {
  const d = day.trim().toLowerCase();
  return d === "entry" || d === "ingresso" || d === "exit" || d === "uscita";
}

/** Entry/−capital seed only (keep Exit on ticker curves for week/era Î”). */
function isEntrySeedDayLabel(day: string): boolean {
  const d = day.trim().toLowerCase();
  return d === "entry" || d === "ingresso";
}

function fmtSignedUsd(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtUsdAbs(v: number): string {
  return `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSignedPct(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

/** Skip zero-height Y bands (equal bounds) — same Recharts hang class as x1===x2. */
function BreakevenYBands({
  domain,
  belowFill,
  aboveFill,
}: {
  domain: [number, number];
  belowFill: string;
  aboveFill: string;
}) {
  const [lo, hi] = domain;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  return (
    <>
      {lo < 0 ? (
        <ReferenceArea
          y1={lo}
          y2={Math.min(0, hi)}
          fill={belowFill}
          ifOverflow="hidden"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {hi > 0 ? (
        <ReferenceArea
          y1={Math.max(0, lo)}
          y2={hi}
          fill={aboveFill}
          ifOverflow="hidden"
          style={{ pointerEvents: "none" }}
        />
      ) : null}
    </>
  );
}

/** Last-wins dedupe — duplicate category X keys lock Recharts ReferenceArea/Tooltip. */
function dedupeChartRowsByTs<T extends { ts: string }>(rows: T[]): T[] {
  if (rows.length < 2) return rows;
  const byTs = new Map<string, T>();
  for (const r of rows) {
    if (!r.ts) continue;
    byTs.set(r.ts, r);
  }
  return [...byTs.values()].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
}

/** Vertical markers at each Gen era transition (Gen 1+). Gen 0 = gradient from start. */
function EraBoundaryMarkers({
  markers,
}: {
  markers: { ts: string; era: SoftLogicEra }[];
}) {
  return (
    <>
      {markers.map((m, i) =>
        i === 0 ? null : (
          <ReferenceLine
            key={m.era.id}
            x={m.ts}
            stroke={softLogicEraHex(m.era)}
            strokeDasharray="4 3"
            strokeOpacity={0.55}
            ifOverflow="hidden"
            label={{
              value: m.era.shortLabel,
              position: "insideTopLeft",
              fontSize: 9,
              fontWeight: 700,
              fill: softLogicEraHex(m.era),
            }}
          />
        ),
      )}
    </>
  );
}

function formatRangeTickLabel(
  iso: string,
  lang: "it" | "en",
  range: HomePnlHistoryRange,
): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  if (range === "24h" || range === "3d" || range === "7d") {
    return d.toLocaleString(lang === "it" ? "it-IT" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

function findWeekSessionForTs(
  sessions: BreakevenWeekSession[],
  ts: string | undefined,
  day: string | undefined,
): BreakevenWeekSession | null {
  if (!sessions.length) return null;
  if (ts) {
    for (const s of sessions) {
      if (ts >= s.startTs && ts <= s.endTs) return s;
    }
    // Nearest week by start (hover can land on a compressed day just outside bounds).
    let best: BreakevenWeekSession | null = null;
    let bestDist = Infinity;
    const t = new Date(ts).getTime();
    if (Number.isFinite(t)) {
      for (const s of sessions) {
        const mid =
          (new Date(s.startTs).getTime() + new Date(s.endTs).getTime()) / 2;
        const dist = Math.abs(mid - t);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      if (best && bestDist < 8 * 86_400_000) return best;
    }
  }
  if (day) {
    const byDay = sessions.find((s) => s.x1 === day || s.x2 === day);
    if (byDay) return byDay;
  }
  return null;
}

function ChartTooltip({
  active,
  label,
  payload,
  it,
  mode,
  weekSessions,
  unit,
}: {
  active?: boolean;
  label?: string;
  payload?: {
    dataKey?: string;
    name?: string;
    value?: number;
    color?: string;
    payload?: { ts?: string; day?: string; capital?: number };
  }[];
  it: boolean;
  mode: "portfolio" | "ticker";
  weekSessions: BreakevenWeekSession[];
  unit: CurveUnit;
}) {
  if (!active || !payload?.length) return null;
  const fmtUsd = (v: number) =>
    `$ ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const row = payload.find((p) => p.payload)?.payload as
    | {
        ts?: string;
        day?: string;
        capital?: number;
        pnlPlot?: number;
        pnlOpen?: number;
        pnlClosed?: number;
        equity?: number;
        plotY?: number;
      }
    | undefined;
  const ts = row?.ts;
  const era = ts ? resolveSoftLogicEra(ts) : null;
  const week = findWeekSessionForTs(weekSessions, ts, row?.day ?? label);
  const isEntry = isEntrySeedDayLabel(String(row?.day ?? label ?? ""));
  const invested =
    row?.capital != null && Number.isFinite(row.capital) && row.capital > 0
      ? row.capital
      : null;
  const gainUsd =
    mode === "ticker"
      ? row?.equity != null && Number.isFinite(row.equity)
        ? isEntry
          ? null
          : row.equity
        : null
      : isEntry
        ? null
        : row?.pnlPlot != null && Number.isFinite(row.pnlPlot)
          ? row.pnlPlot
          : null;
  const gainPct =
    gainUsd != null && invested != null && invested > 0
      ? (gainUsd / invested) * 100
      : isEntry && invested != null
        ? -100
        : row?.plotY != null && unit === "pct"
          ? row.plotY
          : null;
  const pctMode = unit === "pct";
  const alignLabel =
    week == null
      ? null
      : week.logicGainAlign === "aligned"
        ? it
          ? "logica↔gain"
          : "logic↔gain"
        : week.logicGainAlign === "mismatch"
          ? it
            ? "logica≠gain"
            : "logic≠gain"
          : it
            ? "neutro"
            : "flat";

  const title =
    row?.day?.trim() ||
    (ts
      ? new Date(ts).toLocaleString(it ? "it-IT" : "en-GB", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : label);

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface-elevated))]/95 px-3 py-2 text-xs shadow-lg min-w-[12.5rem] max-w-[18rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
        {title}
      </p>
      <div className="space-y-1">
        {payload
          .filter((p) => p.value != null && Number.isFinite(Number(p.value)))
          .filter((p, i, arr) => arr.findIndex((x) => x.dataKey === p.dataKey) === i)
          .map((p) => (
            <div
              key={String(p.dataKey)}
              className="flex items-center justify-between gap-4 tabular-nums"
            >
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: p.color }}
                />
                {pctMode
                  ? it
                    ? "% su investito"
                    : "% on invested"
                  : p.name}
              </span>
              <span className="font-semibold text-ink">
                {pctMode
                  ? fmtSignedPct(Number(p.value))
                  : fmtUsd(Number(p.value))}
              </span>
            </div>
          ))}
      </div>

      {invested != null || gainUsd != null || gainPct != null ? (
        <div className="mt-2 rounded-md border border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-2))]/70 px-2 py-1.5 space-y-0.5">
          {pctMode ? (
            <>
              {isEntry ? (
                <p className="text-[12px] font-bold text-ink-muted tabular-nums">
                  {it
                    ? "Ingresso (in % la curva parte dai ricavi, non da −100%)"
                    : "Entry (% curve starts on returns, not −100%)"}
                </p>
              ) : gainPct != null ? (
                <p className="text-[12px] tabular-nums">
                  <span className="text-ink-muted">
                    {it ? "% ricavi su investito" : "% return on invested"}
                  </span>{" "}
                  <span
                    className={
                      gainPct >= 0
                        ? "font-bold text-emerald-700"
                        : "font-bold text-rose-700"
                    }
                  >
                    {fmtSignedPct(gainPct)}
                  </span>
                </p>
              ) : null}
              {gainUsd != null ? (
                <p className="text-[10px] tabular-nums text-ink-muted">
                  {it ? "Guadagno" : "Gain"} {fmtSignedUsd(gainUsd)}
                  {invested != null ? ` · ${it ? "su" : "on"} ${fmtUsdAbs(invested)}` : ""}
                </p>
              ) : invested != null ? (
                <p className="text-[10px] tabular-nums text-ink-muted">
                  {it ? "Capitale" : "Capital"} {fmtUsdAbs(invested)}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {invested != null ? (
                <p className="text-[11px] tabular-nums text-ink">
                  <span className="text-ink-muted">
                    {it ? "Capitale investito" : "Invested capital"}
                  </span>{" "}
                  <span className="font-semibold">{fmtUsdAbs(invested)}</span>
                </p>
              ) : null}
              {isEntry ? (
                <p className="text-[11px] font-semibold text-rose-700 tabular-nums">
                  {it
                    ? `Ingresso · curva a −${fmtUsdAbs(invested ?? 0)}`
                    : `Entry · curve at −${fmtUsdAbs(invested ?? 0)}`}
                </p>
              ) : gainUsd != null ? (
                <p className="text-[11px] tabular-nums">
                  <span className="text-ink-muted">
                    {it ? "Guadagno su investito" : "Gain on invested"}
                  </span>{" "}
                  <span
                    className={
                      gainUsd >= 0
                        ? "font-semibold text-emerald-700"
                        : "font-semibold text-rose-700"
                    }
                  >
                    {fmtSignedUsd(gainUsd)}
                    {gainPct != null ? ` (${fmtSignedPct(gainPct)})` : ""}
                  </span>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {era ? (
        <div
          className="mt-2 rounded-md border px-2 py-1.5"
          style={{
            borderColor: softLogicEraFill(era, 0.5),
            background: softLogicEraFill(era, 0.12),
          }}
        >
          <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">
            {it ? "Generazione logica in vigore" : "Logic generation in force"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold text-ink">
            <span
              className="rounded px-1 py-0.5 text-[9px] font-bold text-white"
              style={{ background: softLogicEraHex(era) }}
            >
              {era.shortLabel}
            </span>
            <span className="font-semibold leading-tight">
              {it ? era.labelIt : era.labelEn}
            </span>
          </p>
        </div>
      ) : null}

      {week ? (
        <div className="mt-1.5 rounded-md border border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-2))]/70 px-2 py-1.5 space-y-1">
          <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">
            {it ? "Efficienza finestra" : "Window efficiency"}
            <span className="ml-1 font-medium normal-case tracking-normal text-ink-muted/90">
              · {week.weekLabel}
            </span>
          </p>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums text-[11px]">
            <span
              className={
                week.delta >= 0
                  ? "font-bold text-emerald-700"
                  : "font-bold text-rose-700"
              }
            >
              {fmtSignedUsd(week.delta)}
            </span>
            {week.gainPctOnInvested != null ? (
              <span
                className={
                  week.gainPctOnInvested >= 0
                    ? "font-semibold text-emerald-700"
                    : "font-semibold text-rose-700"
                }
              >
                {fmtSignedPct(week.gainPctOnInvested)}
              </span>
            ) : null}
            {alignLabel ? (
              <span
                className={
                  week.logicGainAlign === "aligned"
                    ? "text-[9px] font-semibold text-emerald-800"
                    : week.logicGainAlign === "mismatch"
                      ? "text-[9px] font-semibold text-amber-800"
                      : "text-[9px] text-ink-muted"
                }
              >
                {alignLabel}
              </span>
            ) : null}
          </div>
          <p className="text-[10px] text-ink leading-snug">
            Soft BUY {Math.round(week.buyStrength * 100)}%
            {" · "}
            Soft SELL {Math.round(week.sellStrength * 100)}%
            {" · "}
            <span className="font-semibold" style={{ color: softLogicEraHex(week.era) }}>
              {week.era.shortLabel}
            </span>
          </p>
          {week.investedCapital != null && week.investedCapital > 0 ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              {it ? "Capitale settimana" : "Week capital"}{" "}
              {fmtUsdAbs(week.investedCapital)}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-1.5 text-[9px] text-ink-muted leading-snug">
        {mode === "ticker"
          ? it
            ? "Curva equity: parte da −capitale (rosso) e sale fino a superare $0 quando recuperi l'investimento."
            : "Equity curve: starts at −capital (red) and climbs past $0 when the investment recovers."
          : pctMode
            ? it
              ? "% = P&L ÷ capitale · asse zoomato sui ricavi · 0% = pareggio."
              : "% = P&L ÷ capital · axis zoomed on returns · 0% = breakeven."
            : it
              ? "Parte da −capitale investito · sale col P&L · $0 = pareggio (capitale recuperato)."
              : "Starts at −invested capital · rises with P&L · $0 = breakeven (capital recovered)."}
      </p>
    </div>
  );
}

/**
 * Open / closed portfolio mark-to-market P&L (Model Quality → Today).
 *  - Aggregate: Portafoglio Open or Portafoglio Closed (single P&L curve)
 *  - Per-company equity curve (−capital → past $0) for live open tickers only
 */
export function HomePortfolioPnlHistoryChart({
  history,
  inputs,
  simTable = null,
  logicPositions = null,
}: {
  history: InvestSimHistoryPoint[];
  inputs: InvestSimInputs;
  /** Live Simulation sheet — required so «open» chips match Pulse OPEN POSITIONS. */
  simTable?: SheetTable | null;
  /** Soft BUY/SELL index scores — week context in tooltip. */
  logicPositions?: BreakevenLogicPosition[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const eraGradId = useId().replace(/:/g, "");
  const [scope, setScope] = useState<Scope>("portfolio-open");
  const [range, setRange] = useState<HomePnlHistoryRange>("all");
  const [unit, setUnit] = useState<CurveUnit>("usd");

  /** Extend stored snapshots with today's Simulation marks when history is stale. */
  const historyLive = useMemo(
    () => withLiveHomePortfolioHistoryTip(history, inputs, simTable),
    [history, inputs, simTable],
  );
  const liveTipAppended =
    historyLive.length > 0 &&
    (history.length === 0 ||
      historyLive[historyLive.length - 1]!.ts !== history[history.length - 1]?.ts);

  const tickersAll = useMemo(
    () => listHomeInvestedTickers(historyLive, inputs, { simTable }),
    [historyLive, inputs, simTable],
  );
  /** Individual chips: live open positions only (closed names use Portafoglio Closed). */
  const openTickers = useMemo(
    () => tickersAll.filter((t) => t.status === "open"),
    [tickersAll],
  );

  // Closed ticker selection is no longer offered — snap back to open book.
  useEffect(() => {
    if (isPortfolioScope(scope)) return;
    if (!openTickers.some((t) => t.key === scope)) setScope("portfolio-open");
  }, [scope, openTickers]);

  const portfolioDataFull = useMemo(
    () => buildHomePortfolioPnlHistorySeries(historyLive, inputs, it ? "it" : "en"),
    [historyLive, inputs, it],
  );

  const selected = openTickers.find((t) => t.key === scope) ?? null;
  const portfolioBook: "open" | "closed" =
    scope === "portfolio-closed" ? "closed" : "open";

  const tickerDataFull = useMemo(
    () =>
      selected
        ? buildHomeTickerEquityCurve(historyLive, inputs, selected.key, it ? "it" : "en")
        : [],
    [historyLive, inputs, selected, it],
  );

  const closedCapitalInvested = useMemo(() => {
    let sum = 0;
    for (const e of Object.values(inputs)) {
      if (!e?.ignoreSheet) continue;
      const c = e.closedCapital;
      if (c != null && Number.isFinite(c) && c > 0) sum += c;
    }
    return Math.round(sum * 100) / 100;
  }, [inputs]);

  const shortRange = range === "24h" || range === "3d" || range === "7d";

  const portfolioData = useMemo(() => {
    let sliced = filterHomeSeriesByRange(portfolioDataFull, range);
    if (range === "all") sliced = compressHomeSeriesByDay(sliced);
    const withDay = shortRange
      ? sliced.map((r) => ({
          ...r,
          day: formatRangeTickLabel(r.ts, it ? "it" : "en", range),
        }))
      : sliced;
    // Short windows / % mode: no Entry/−capitale seed.
    // % drops Entry so Y zooms on returns; keeping Entry only in $ mode.
    // Mismatch (bands on Entry ts while axis lacks it) freezes Recharts + kills Unit %.
    return toHomePortfolioBreakevenPlot(
      withDay,
      portfolioBook,
      it ? "it" : "en",
      closedCapitalInvested,
      { includeEntrySeed: !shortRange && unit === "usd" },
    );
  }, [
    portfolioDataFull,
    range,
    shortRange,
    it,
    portfolioBook,
    closedCapitalInvested,
    unit,
  ]);
  const tickerData = useMemo(() => {
    let sliced = filterHomeSeriesByRange(tickerDataFull, range);
    if (range === "all") sliced = compressHomeSeriesByDay(sliced);
    // Drop Entry seed on short windows and in % mode (axis must match bands).
    if (shortRange || unit === "pct") {
      sliced = sliced.filter((r) => !isSeedDayLabel(r.day));
    }
    if (shortRange) {
      return sliced.map((r) => ({
        ...r,
        day: formatRangeTickLabel(r.ts, it ? "it" : "en", range),
      }));
    }
    return sliced;
  }, [tickerDataFull, range, shortRange, it, unit]);

  const isTicker = !isPortfolioScope(scope) && selected != null;
  const chartData = isTicker ? tickerData : portfolioData;
  const sparseHistory = chartData.length > 0 && chartData.length < 5;
  const showPointDots = chartData.length > 0 && chartData.length <= 8;

  const xTickFormatter = useMemo(() => {
    const dayByTs = new Map(chartData.map((r) => [r.ts, r.day]));
    return (ts: string) => {
      const label = dayByTs.get(ts);
      if (label) return label;
      return formatRangeTickLabel(ts, it ? "it" : "en", range);
    };
  }, [chartData, it, range]);

  const portfolioChartData = useMemo(() => {
    // Entry seed already omitted when unit==="pct" (see portfolioData).
    const rows = dedupeChartRowsByTs(portfolioData);
    const capFallback =
      [...rows].reverse().find((r) => r.capital > 0)?.capital ??
      closedCapitalInvested ??
      null;
    return rows.map((r) => ({
      ...r,
      plotY: toCurvePlotY(r.pnlPlot, r.capital, unit, capFallback),
    }));
  }, [portfolioData, unit, closedCapitalInvested]);
  const tickerChartData = useMemo(() => {
    const rows = dedupeChartRowsByTs(tickerData);
    const capFallback =
      selected?.capital ??
      [...rows].reverse().find((r) => r.capital > 0)?.capital ??
      null;
    return rows.map((r) => ({
      ...r,
      plotY: toCurvePlotY(r.equity, r.capital, unit, capFallback),
    }));
  }, [tickerData, unit, selected]);
  const displayChartData = isTicker ? tickerChartData : portfolioChartData;

  /** Under-curve Gen 0–5 colors along the timeline (horizontal fade between eras). */
  const eraGradientStops = useMemo(() => {
    if (chartData.length < 2) return [] as { offset: string; color: string }[];
    return buildSoftLogicEraGradientStops(
      chartData.map((r) => ({ ts: r.ts })),
      0.32,
    );
  }, [chartData]);

  const weekSessions = useMemo(() => {
    // Week bands are for multi-week «All» context — skip on 24h/3d/7d (also
    // avoids ReferenceArea + sparse category axes locking the pointer).
    if (shortRange || chartData.length < 2) return [] as BreakevenWeekSession[];
    // Skip Entry/−capital seed so week Î” is gain-on-capital, not the jump from −invested.
    const points = chartData
      .filter((r) => !isEntrySeedDayLabel(r.day))
      .map((r) => ({
        ts: r.ts,
        day: r.day,
        value: isTicker
          ? (r as HomeTickerEquityRow).equity
          : (r as HomePortfolioBreakevenRow).pnlPlot,
        capital: isTicker
          ? (r as HomeTickerEquityRow).capital
          : (r as HomePortfolioPnlHistoryRow).capital,
      }));
    return buildBreakevenWeekSessions(
      points,
      logicPositions ?? [],
      historyLive,
      it ? "it" : "en",
    );
  }, [chartData, shortRange, isTicker, logicPositions, historyLive, it]);

  const eraBoundaryMarkers = useMemo(() => {
    if (shortRange || chartData.length < 2) return [];
    const seen = new Set<string>();
    const out: { ts: string; era: SoftLogicEra }[] = [];
    for (const r of chartData) {
      if (!r.ts || isEntrySeedDayLabel(r.day)) continue;
      const era = resolveSoftLogicEra(r.ts);
      if (seen.has(era.id)) continue;
      seen.add(era.id);
      out.push({ ts: r.ts, era });
    }
    return out;
  }, [chartData, shortRange]);

  const pnlDomain = useMemo((): [number, number] => {
    const vals = displayChartData.map((r) =>
      "plotY" in r ? (r as { plotY: number }).plotY : 0,
    );
    if (unit === "pct") return pctReturnDomain(vals);
    return investTrendEurDomain(vals, [-1000, 1000]);
  }, [displayChartData, unit]);

  const latestPortfolio =
    !isTicker && portfolioData.length
      ? portfolioData[portfolioData.length - 1]!
      : null;
  const latestPortfolioPnl = latestPortfolio
    ? portfolioBook === "closed"
      ? latestPortfolio.pnlClosed
      : latestPortfolio.pnlOpen
    : null;
  const curveStats = useMemo(() => {
    if (isTicker) return null;
    return summarizeHomePortfolioPnlCurve(
      portfolioDataFull.map((r) => ({
        day: r.day,
        pnlTotal: portfolioBook === "closed" ? r.pnlClosed : r.pnlOpen,
      })),
    );
  }, [isTicker, portfolioDataFull, portfolioBook]);
  const latestTicker =
    isTicker && tickerData.length ? tickerData[tickerData.length - 1]! : null;

  /** % gain on total invested capital for the active scope (top-right badge). */
  const returnOnInvested = useMemo((): {
    pct: number;
    capital: number;
    pnl: number;
  } | null => {
    if (isTicker && selected && latestTicker) {
      const capital = selected.capital;
      if (!(capital > 0)) return null;
      return {
        capital,
        pnl: latestTicker.equity,
        pct: (latestTicker.equity / capital) * 100,
      };
    }
    if (!isTicker && latestPortfolio && latestPortfolioPnl != null) {
      const capital =
        portfolioBook === "closed"
          ? closedCapitalInvested
          : latestPortfolio.capital;
      if (!(capital > 0)) return null;
      return {
        capital,
        pnl: latestPortfolioPnl,
        pct: (latestPortfolioPnl / capital) * 100,
      };
    }
    return null;
  }, [
    isTicker,
    selected,
    latestTicker,
    latestPortfolio,
    latestPortfolioPnl,
    portfolioBook,
    closedCapitalInvested,
  ]);

  const emptyMsg =
    chartData.length < 2
      ? range !== "all"
        ? it
          ? "Troppi pochi punti in questa finestra — prova 7 giorni o Tutto."
          : "Too few points in this window — try 7 days or All."
        : it
          ? "Servono almeno 2 letture nello storico per questa vista."
          : "Need at least 2 history readings for this view."
      : null;

  const portfolioMarkTitle = it ? "Posizione in portafoglio" : "Portfolio position";

  return (
    <section className="shrink-0 rounded-xl border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface))]/80 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-ink">
            {isTicker
              ? it
                ? `Curva investimento · ${selected!.ticker}`
                : `Investment curve · ${selected!.ticker}`
              : portfolioBook === "closed"
                ? it
                  ? "Portafoglio Closed · P&L realizzato"
                  : "Closed portfolio · realized P&L"
                : it
                  ? "Portafoglio Open · P&L mark-to-market"
                  : "Open portfolio · mark-to-market P&L"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug">
            {isTicker
              ? it
                ? "Parte da −capitale · sale con il mark-to-market · supera $0 al pareggio"
                : "Starts at −capital · rises with mark-to-market · crosses $0 at breakeven"
              : unit === "pct"
                ? it
                  ? "Modalità % · scala zoomata sui ricavi (P&L÷capitale) · 0% = pareggio — non −100% ingresso"
                  : "% mode · zoomed on returns (P&L÷capital) · 0% = breakeven — not −100% entry"
                : portfolioBook === "closed"
                  ? it
                    ? "Closed aggregato · parte da −capitale · $0 = pareggio · sopra = guadagno"
                    : "Closed aggregate · starts at −capital · $0 = breakeven · above = gain"
                  : it
                    ? "Open aggregato · parte da −capitale · $0 = pareggio · sopra = guadagno"
                    : "Open aggregate · starts at −capital · $0 = breakeven · above = gain"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-0">
          {returnOnInvested ? (
            <div
              className={`rounded-lg border px-2.5 py-1.5 text-right tabular-nums ${
                returnOnInvested.pct >= 0
                  ? "border-emerald-400/50 bg-emerald-50/90"
                  : "border-rose-400/50 bg-rose-50/90"
              }`}
              title={
                it
                  ? `Guadagno % = P&L ${fmtSignedUsd(returnOnInvested.pnl)} ÷ capitale investito $${Math.round(returnOnInvested.capital).toLocaleString("en-US")}`
                  : `Return % = P&L ${fmtSignedUsd(returnOnInvested.pnl)} ÷ invested capital $${Math.round(returnOnInvested.capital).toLocaleString("en-US")}`
              }
            >
              <p
                className={`text-[18px] font-bold leading-none ${
                  returnOnInvested.pct >= 0
                    ? "text-emerald-800"
                    : "text-rose-800"
                }`}
              >
                {returnOnInvested.pct >= 0 ? "+" : ""}
                {returnOnInvested.pct.toFixed(1)}%
              </p>
              <p className="text-[9px] font-medium text-ink-muted mt-0.5 leading-tight">
                {it ? "su investito totale" : "on total invested"}
              </p>
            </div>
          ) : null}
          {latestPortfolio && latestPortfolioPnl != null ? (
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] tabular-nums">
              <span className="text-ink-muted">
                {portfolioBook === "closed"
                  ? it
                    ? "Capitale chiuso"
                    : "Closed capital"
                  : it
                    ? "Capitale investito"
                    : "Capital invested"}{" "}
                <span className="font-semibold text-ink">
                  $
                  {(portfolioBook === "closed"
                    ? closedCapitalInvested
                    : latestPortfolio.capital
                  ).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </span>
              <span
                className={
                  latestPortfolioPnl >= 0
                    ? "text-[rgb(var(--signal-up))]"
                    : "text-[rgb(var(--signal-down))]"
                }
              >
                {it ? "P&L cumulato" : "Cumulative P&L"}{" "}
                <span className="font-semibold">
                  {latestPortfolioPnl >= 0 ? "+" : ""}
                  ${latestPortfolioPnl.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </span>
              {curveStats ? (
                <>
                  <span className="text-ink-muted">
                    {it ? "Drawdown max" : "Max drawdown"}{" "}
                    <span className="font-semibold text-[rgb(var(--signal-down))]">
                      ${curveStats.maxDrawdown.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </span>
                  <span className="text-ink-muted">
                    {it ? "Picco" : "Peak"}{" "}
                    <span className="font-semibold text-[rgb(var(--signal-up))]">
                      {curveStats.peakPnl >= 0 ? "+" : ""}
                      ${curveStats.peakPnl.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </span>
                  </span>
                  {curveStats.breakevenDay ? (
                    <span className="text-ink-muted">
                      {it ? "Ritorno in pari" : "Break-even"}{" "}
                      <span className="font-semibold text-ink">{curveStats.breakevenDay}</span>
                    </span>
                  ) : null}
                  {curveStats.leftOnTable > 0 ? (
                    <span className="text-ink-muted">
                      {it ? "Lasciato sul tavolo" : "Left on table"}{" "}
                      <span className="font-semibold text-ink">
                        ${curveStats.leftOnTable.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {latestTicker && selected ? (
            <div className="flex flex-wrap justify-end gap-3 text-[11px] tabular-nums">
              <span className="text-ink-muted">
                {it ? "Investito" : "Invested"}{" "}
                <span className="font-semibold text-ink">
                  ${selected.capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </span>
              <span
                className={
                  latestTicker.equity >= 0
                    ? "text-[rgb(var(--signal-up))]"
                    : "text-[rgb(var(--signal-down))]"
                }
              >
                {it ? "Ricavo / P&L" : "Gain / P&L"}{" "}
                <span className="font-semibold">
                  {latestTicker.equity >= 0 ? "+" : ""}
                  ${latestTicker.equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </span>
              </span>
              <span className="text-ink-muted inline-flex items-center gap-1">
                {selected.status === "open" ? (
                  <PortfolioBriefcaseMark title={portfolioMarkTitle} className="text-[10px]" />
                ) : null}
                {selected.status === "open"
                  ? it
                    ? "aperto"
                    : "open"
                  : it
                    ? "chiuso"
                    : "closed"}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
          {it ? "Area sotto curva · Gen" : "Under-curve · Gen"}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 text-[9px] text-ink-muted">
          {SOFT_LOGIC_ERAS.map((era) => (
            <span
              key={era.id}
              className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))]/80 px-1.5 py-0.5"
              title={it ? era.labelIt : era.labelEn}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: softLogicEraHex(era) }}
              />
              <span className="font-semibold text-ink">{era.shortLabel}</span>
            </span>
          ))}
          <span className="text-ink-muted/70">
            {it ? "· sfumatura tra ere" : "· fade between eras"}
          </span>
        </div>
      </div>

      <div className="mb-2 space-y-2">
        {/* Period/Unit above portfolio chips: ticker pills used to wrap over the
            right side and steal hits on Unit % (custom pointerdown+preventDefault
            also interfered). Same SelectionChip pattern as Flash Test. */}
        <div className="relative isolate z-40 flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md bg-[rgb(var(--surface))] py-0.5 pointer-events-auto">
          <div className="shrink-0">
            <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
              {it ? "Periodo" : "Period"}
            </p>
            <SelectionChipGroup>
              {RANGE_OPTIONS.map((opt) => (
                <SelectionChip
                  key={opt.id}
                  active={range === opt.id}
                  aria-pressed={range === opt.id}
                  className="min-h-[28px] min-w-[2.5rem] px-2.5"
                  onClick={() => {
                    setRange(opt.id);
                  }}
                  title={
                    it
                      ? opt.id === "all"
                        ? "Tutta la storia disponibile"
                        : `Ultime ${opt.it}`
                      : opt.id === "all"
                        ? "Full available history"
                        : `Last ${opt.en}`
                  }
                >
                  {it ? opt.it : opt.en}
                </SelectionChip>
              ))}
            </SelectionChipGroup>
          </div>
          <div className="shrink-0">
            <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
              {it ? "Unità" : "Unit"}
              <span className="ml-1.5 normal-case tracking-normal font-medium text-ink">
                {unit === "pct" ? (it ? "· % su capitale" : "· % on capital") : "· $"}
              </span>
            </p>
            <div
              role="group"
              aria-label={it ? "Unità curva" : "Chart unit"}
              className="relative z-50"
            >
              <SelectionChipGroup>
                <SelectionChip
                  active={unit === "usd"}
                  aria-pressed={unit === "usd"}
                  className="min-h-[30px] min-w-[40px] px-3 text-[12px] font-bold"
                  title={
                    it
                      ? "Curva in $ · capitale e guadagno"
                      : "Curve in $ · capital and gain"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setUnit("usd");
                  }}
                >
                  $
                </SelectionChip>
                <SelectionChip
                  active={unit === "pct"}
                  aria-pressed={unit === "pct"}
                  className="min-h-[30px] min-w-[40px] px-3 text-[12px] font-bold"
                  title={
                    it
                      ? "% ricavi su capitale · asse zoomato (senza −100% ingresso)"
                      : "% return on capital · zoomed axis (no −100% entry)"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setUnit("pct");
                  }}
                >
                  %
                </SelectionChip>
              </SelectionChipGroup>
            </div>
          </div>
        </div>

        <div className="relative z-10 min-w-0 pointer-events-auto">
          <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            {it ? "Portafoglio" : "Portfolio"}
          </p>
          <SelectionChipGroup>
            <SelectionChip
              active={scope === "portfolio-open"}
              onClick={() => setScope("portfolio-open")}
              title={
                it
                  ? "P&L aggregato delle sole posizioni aperte"
                  : "Aggregate P&L of open positions only"
              }
            >
              <span className="inline-flex items-center gap-1 tabular-nums">
                <PortfolioBriefcaseMark
                  title={it ? "Portafoglio Open" : "Open portfolio"}
                  className="text-[10px]"
                />
                {it ? "Portafoglio Open" : "Open portfolio"}
                {portfolioDataFull.length ? (
                  <span
                    className={
                      (portfolioDataFull[portfolioDataFull.length - 1]!.pnlOpen ?? 0) >= 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]"
                    }
                  >
                    {(portfolioDataFull[portfolioDataFull.length - 1]!.pnlOpen ?? 0) >= 0
                      ? "+"
                      : ""}
                    {Math.round(portfolioDataFull[portfolioDataFull.length - 1]!.pnlOpen)}
                  </span>
                ) : null}
              </span>
            </SelectionChip>
            <SelectionChip
              active={scope === "portfolio-closed"}
              onClick={() => setScope("portfolio-closed")}
              title={
                it
                  ? "P&L aggregato dei soli deal chiusi (niente ticker singoli)"
                  : "Aggregate P&L of closed deals only (no per-ticker chips)"
              }
            >
              <span className="inline-flex items-center gap-1 tabular-nums">
                <span
                  className="rounded px-0.5 text-[8px] font-bold uppercase tracking-wide text-ink-muted border border-[rgb(var(--border))]/40"
                  title={it ? "Deal chiusi" : "Closed deals"}
                >
                  {it ? "chiuso" : "closed"}
                </span>
                {it ? "Portafoglio Closed" : "Closed portfolio"}
                {portfolioDataFull.length ? (
                  <span
                    className={
                      (portfolioDataFull[portfolioDataFull.length - 1]!.pnlClosed ?? 0) >= 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]"
                    }
                  >
                    {(portfolioDataFull[portfolioDataFull.length - 1]!.pnlClosed ?? 0) >= 0
                      ? "+"
                      : ""}
                    {Math.round(portfolioDataFull[portfolioDataFull.length - 1]!.pnlClosed)}
                  </span>
                ) : null}
              </span>
            </SelectionChip>
            {openTickers.map((t) => {
              const pos = logicPositions?.find((p) => p.key === t.key) ?? null;
              const tone = tickerLogicChipTone(pos, t.lastEquity);
              const logicTip = tone
                ? it
                  ? ` · Soft ${tone.dominant === "buy" ? "BUY" : tone.dominant === "sell" ? "SELL" : "mix"} (B${Math.round(tone.buyStrength * 100)}/S${Math.round(tone.sellStrength * 100)}) · ${tone.align === "aligned" ? "logica↔gain" : tone.align === "mismatch" ? "logica≠gain" : "neutro"}`
                  : ` · Soft ${tone.dominant === "buy" ? "BUY" : tone.dominant === "sell" ? "SELL" : "mix"} (B${Math.round(tone.buyStrength * 100)}/S${Math.round(tone.sellStrength * 100)}) · ${tone.align === "aligned" ? "logic↔gain" : tone.align === "mismatch" ? "logic≠gain" : "flat"}`
                : "";
              return (
                <SelectionChip
                  key={t.key}
                  active={scope === t.key}
                  onClick={() => setScope(t.key)}
                  className={tone?.className ?? ""}
                  title={`${t.ticker} · ${it ? "aperto" : "open"} · $${t.capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}${logicTip}`}
                >
                  <span className="inline-flex flex-col items-stretch gap-0.5 min-w-0">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <PortfolioBriefcaseMark
                        title={portfolioMarkTitle}
                        className="text-[10px]"
                      />
                      {t.ticker}
                      {t.lastEquity != null ? (
                        <span
                          className={
                            t.lastEquity >= 0
                              ? "text-[rgb(var(--signal-up))]"
                              : "text-[rgb(var(--signal-down))]"
                          }
                        >
                          {t.lastEquity >= 0 ? "+" : ""}
                          {Math.round(t.lastEquity)}
                        </span>
                      ) : null}
                      {tone ? (
                        <span className="text-[8px] font-bold opacity-80">
                          {tone.dominant === "buy"
                            ? "BUY"
                            : tone.dominant === "sell"
                              ? "SELL"
                              : "·"}
                        </span>
                      ) : null}
                    </span>
                    {tone ? (
                      <span
                        className="flex h-0.5 w-full overflow-hidden rounded-full"
                        aria-hidden
                      >
                        <span
                          className="bg-emerald-500"
                          style={{ width: `${tone.barBuyPct}%` }}
                        />
                        <span
                          className="bg-rose-500"
                          style={{ width: `${tone.barSellPct}%` }}
                        />
                      </span>
                    ) : null}
                  </span>
                </SelectionChip>
              );
            })}
          </SelectionChipGroup>
        </div>
      </div>

      {emptyMsg ? (
        <p className="text-[11px] text-ink-muted py-6 text-center">{emptyMsg}</p>
      ) : (
        <div className="relative z-0 w-full min-w-0 space-y-1.5 overflow-hidden">
          {sparseHistory ? (
            <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-snug text-amber-950 dark:text-amber-100">
              {it
                ? `Pochi snapshot (${chartData.length}) in questa finestra — la curva usa anche punti appena prima del periodo per avere una forma. Lo storico non è tick-by-tick: più refresh = più densità su 24h/3g/7g. «Tutto» resta la vista completa.`
                : `Few snapshots (${chartData.length}) in this window — the curve also uses marks just before the period for shape. History is not tick-by-tick: more refreshes = denser 24h/3d/7d. «All» remains the full view.`}
            </p>
          ) : null}
          <div
            key={`home-pnl-${scope}-${range}-${unit}`}
            className="relative z-0 h-[240px] w-full min-w-0 overflow-hidden isolate"
          >
          <ResponsiveContainer width="100%" height="100%">
            {isTicker ? (
              <ComposedChart
                key={`tk-${scope}-${range}-${unit}`}
                data={tickerChartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <defs>
                  {/* Below breakeven: deep blue → azure toward $0 */}
                  <linearGradient id="homeEqBelowBe" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.38} />
                    <stop offset="55%" stopColor="#2563eb" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#7dd3fc" stopOpacity={0.42} />
                  </linearGradient>
                  {/* Above breakeven: soft azure → yellow */}
                  <linearGradient id="homeEqAboveBe" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#bae6fd" stopOpacity={0.35} />
                    <stop offset="35%" stopColor="#fde68a" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#eab308" stopOpacity={0.45} />
                  </linearGradient>
                  {eraGradientStops.length >= 2 ? (
                    <linearGradient id={`home-era-${eraGradId}`} x1="0" y1="0" x2="1" y2="0">
                      {eraGradientStops.map((s, i) => (
                        <stop key={i} offset={s.offset} stopColor={s.color} />
                      ))}
                    </linearGradient>
                  ) : null}
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgb(var(--border))", strokeOpacity: 0.5 }}
                  interval="preserveStartEnd"
                  minTickGap={28}
                  height={28}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
                  tickLine={false}
                  axisLine={false}
                  width={unit === "pct" ? 44 : 52}
                  domain={pnlDomain}
                  allowDataOverflow
                  tickFormatter={(v) =>
                    unit === "pct" ? fmtAxisPctTick(v) : `$${fmtAxisEurTick(v)}`
                  }
                />
                <BreakevenYBands
                  domain={pnlDomain}
                  belowFill="url(#homeEqBelowBe)"
                  aboveFill="url(#homeEqAboveBe)"
                />
                {!shortRange ? (
                  <EraBoundaryMarkers markers={eraBoundaryMarkers} />
                ) : null}
                <ReferenceLine
                  y={0}
                  stroke="#2563eb"
                  strokeOpacity={0.7}
                  strokeDasharray="5 4"
                  label={{
                    value:
                      unit === "pct"
                        ? it
                          ? "Pareggio 0%"
                          : "Breakeven 0%"
                        : it
                          ? "Pareggio $0"
                          : "Breakeven $0",
                    position: "insideTopRight",
                    fontSize: 9,
                    fill: "#1d4ed8",
                  }}
                />
                <Tooltip
                  wrapperStyle={{ pointerEvents: "none" }}
                  content={
                    <ChartTooltip
                      it={it}
                      mode="ticker"
                      weekSessions={weekSessions}
                      unit={unit}
                    />
                  }
                />
                {eraGradientStops.length >= 2 ? (
                  <Area
                    type="monotone"
                    dataKey="plotY"
                    stroke="none"
                    fill={`url(#home-era-${eraGradId})`}
                    fillOpacity={1}
                    baseValue={0}
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="plotY"
                  name={
                    unit === "pct"
                      ? it
                        ? "% su investito"
                        : "% on invested"
                      : it
                        ? "Equity (da −capitale)"
                        : "Equity (from −capital)"
                  }
                  stroke="#0f766e"
                  strokeWidth={2.4}
                  dot={showPointDots ? { r: 3.5, strokeWidth: 1.5 } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            ) : (
              <ComposedChart
                key={`pf-${portfolioBook}-${range}-${unit}`}
                data={portfolioChartData}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="homePnlCumFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.04} />
                  </linearGradient>
                  {eraGradientStops.length >= 2 ? (
                    <linearGradient id={`home-era-${eraGradId}`} x1="0" y1="0" x2="1" y2="0">
                      {eraGradientStops.map((s, i) => (
                        <stop key={i} offset={s.offset} stopColor={s.color} />
                      ))}
                    </linearGradient>
                  ) : null}
                  <linearGradient id="homePfBelowBe" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#1e3a8a" stopOpacity={0.32} />
                    <stop offset="55%" stopColor="#2563eb" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#7dd3fc" stopOpacity={0.38} />
                  </linearGradient>
                  <linearGradient id="homePfAboveBe" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#bae6fd" stopOpacity={0.3} />
                    <stop offset="35%" stopColor="#fde68a" stopOpacity={0.36} />
                    <stop offset="100%" stopColor="#eab308" stopOpacity={0.42} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={xTickFormatter}
                  tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
                  tickLine={false}
                  axisLine={{ stroke: "rgb(var(--border))", strokeOpacity: 0.5 }}
                  interval="preserveStartEnd"
                  minTickGap={36}
                  height={28}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgb(var(--ink-muted))" }}
                  tickLine={false}
                  axisLine={false}
                  width={unit === "pct" ? 44 : 52}
                  domain={pnlDomain}
                  allowDataOverflow
                  tickFormatter={(v) =>
                    unit === "pct" ? fmtAxisPctTick(v) : `$${fmtAxisEurTick(v)}`
                  }
                />
                <BreakevenYBands
                  domain={pnlDomain}
                  belowFill="url(#homePfBelowBe)"
                  aboveFill="url(#homePfAboveBe)"
                />
                {!shortRange ? (
                  <EraBoundaryMarkers markers={eraBoundaryMarkers} />
                ) : null}
                <ReferenceLine
                  y={0}
                  stroke="#2563eb"
                  strokeOpacity={0.75}
                  strokeDasharray="5 4"
                  label={{
                    value: (() => {
                      if (unit === "pct") {
                        return it ? "Pareggio 0%" : "Breakeven 0%";
                      }
                      const cap =
                        portfolioBook === "closed"
                          ? closedCapitalInvested
                          : latestPortfolio?.capital ?? 0;
                      if (cap > 0) {
                        return it
                          ? `Pareggio $0 · capitale $${cap.toLocaleString("en-US", { maximumFractionDigits: 0 })} recuperato`
                          : `Breakeven $0 · $${cap.toLocaleString("en-US", { maximumFractionDigits: 0 })} capital recovered`;
                      }
                      return it
                        ? "Pareggio $0 = capitale recuperato"
                        : "Breakeven $0 = capital recovered";
                    })(),
                    position: "insideTopRight",
                    fontSize: 9,
                    fill: "#1d4ed8",
                  }}
                />
                <Tooltip
                  wrapperStyle={{ pointerEvents: "none" }}
                  content={
                    <ChartTooltip
                      it={it}
                      mode="portfolio"
                      weekSessions={weekSessions}
                      unit={unit}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="plotY"
                  stroke="none"
                  fill={
                    eraGradientStops.length >= 2
                      ? `url(#home-era-${eraGradId})`
                      : "url(#homePnlCumFill)"
                  }
                  fillOpacity={1}
                  baseValue={0}
                  isAnimationActive={false}
                  legendType="none"
                  tooltipType="none"
                />
                <Line
                  type="monotone"
                  dataKey="plotY"
                  name={
                    unit === "pct"
                      ? it
                        ? "% ricavi su investito"
                        : "% return on invested"
                      : portfolioBook === "closed"
                        ? it
                          ? "Breakeven Closed (−cap → P&L)"
                          : "Closed breakeven (−cap → P&L)"
                        : it
                          ? "Breakeven Open (−cap → P&L)"
                          : "Open breakeven (−cap → P&L)"
                  }
                  stroke="#2563eb"
                  strokeWidth={2.4}
                  dot={showPointDots ? { r: 3.5, strokeWidth: 1.5, fill: "#fff" } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="mt-1 text-[9px] text-ink-muted leading-snug">
        {(() => {
          const offSession =
            !isUsEquityTradingDay() || isAfterUsEquityRegularClose();
          const asOf = offSession
            ? it
              ? " · asse = ultima sessione Nasdaq (non orario app)"
              : " · axis = last Nasdaq session (not app clock)"
            : it
              ? " · asse = orario sessione (mark live)"
              : " · axis = session clock (live mark)";
          if (isTicker) {
            return it
              ? `Periodo ${RANGE_OPTIONS.find((o) => o.id === range)?.it ?? range} · parte da −capitale · $0 = pareggio · Gen colorate sotto la curva${asOf}`
              : `Period ${RANGE_OPTIONS.find((o) => o.id === range)?.en ?? range} · starts at −capital · $0 = breakeven · Gen eras tinted under curve${asOf}`;
          }
          return it
            ? `${portfolioChartData.length} snapshot · ${portfolioBook === "closed" ? "Portafoglio Closed" : "Portafoglio Open"} · $0 = capitale recuperato · Gen 0–5 sotto la curva${liveTipAppended ? " · punta = mark live Simulation" : ""}${sparseHistory ? " · poche misure = segmento corto" : ""}${asOf}`
            : `${portfolioChartData.length} snapshots · ${portfolioBook === "closed" ? "Closed portfolio" : "Open portfolio"} · $0 = capital recovered · Gen 0–5 under curve${liveTipAppended ? " · tip = live Simulation mark" : ""}${sparseHistory ? " · few marks = short segment" : ""}${asOf}`;
        })()}
      </p>
    </section>
  );
}
