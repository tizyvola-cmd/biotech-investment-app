/**
 * Wind tab — 24h / 10-day run / P(continuation) / Google Trends.
 * No equal-weight $5k what-if P&L. Hourly curves are % vs previous close,
 * for the live session or the last completed Nasdaq day.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type ReactNode,
} from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchIntraday1h,
  fetchSearchInterest,
  fetchSearchInterestLeaders,
  type Intraday1hPoint,
  type SearchInterestPayload,
  type SearchInterestRow,
} from "../api/supernova";
import type { SheetTable } from "../types";
import {
  investSimInputsUpdatedAtIso,
  type InvestSimInputs,
} from "../sheet/investSimStorage";
import {
  isSearchInterestScored,
  missingSearchInterestTickers,
  peekSearchInterestRows,
  rememberSearchInterestPayload,
  subscribeSearchInterestStore,
} from "../sheet/searchInterestStore";
import {
  buildSimUniverse24hWhatIf,
  buildWindHourlyPctSeries,
  filterWhatIfRowsByBook,
  isWhatIf24hGainer,
  isWhatIfStrongWindContinuation,
  resolveWhatIfPriceBaselines,
  whatIfLastHourlyValues,
  whatIfSparklinePath,
  type SimUniverse24hWhatIf,
  type SimUniverse24hWhatIfRow,
  type WhatIfBookFilter,
  type WhatIfHourlyCurvePoint,
} from "../sheet/simUniverse24hWhatIf";
import { filterSimTableToHotZoneCd, SIM_HOT_ZONE_DAYS } from "../sheet/simCdHorizonScope";
import { priceRefreshAtFromRow } from "../sheet/simulationPosition";
import {
  ContG10Badge,
  ContPContBadge,
  contRunHeaderLabel,
  G10_HELP_EN,
  G10_HELP_IT,
  WindIcon,
} from "./ContG10Badge";
import { GoogleTrendsLegendModal } from "./GoogleTrendsLegendModal";
import { SearchInterestDualMark } from "./SearchInterestTrendMark";
import { TickerCompanyStack } from "./TickerCompanyStack";
import type { WhatIfPanelRefreshPhase } from "../sheet/whatIfPanelRefresh";

const TABLE_COLS = 6;
/** Stable identity so memoized rows without a curve don't re-render. */
const EMPTY_SPARK: number[] = [];
/** Paint large lists in idle batches so filter clicks stay responsive. */
const ROW_RENDER_BATCH = 24;
const WIND_CURVE_MAX_LINES = 12;
const WIND_LINE_COLORS = [
  "#0ea5e9",
  "#16a34a",
  "#ca8a04",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#db2777",
  "#65a30d",
  "#0369a1",
  "#b45309",
];

function resolveEffectiveBookFilter(
  book: WhatIfBookFilter,
  model: SimUniverse24hWhatIf,
): WhatIfBookFilter {
  if (book === "portfolio" && model.portfolio.n === 0) return "all";
  return book;
}

function PfIcon({ title, it }: { title?: string; it: boolean }) {
  return (
    <span
      className="inline-flex items-center shrink-0 text-[rgb(var(--accent))]"
      title={title ?? (it ? "In portafoglio" : "In portfolio")}
      aria-label={title ?? (it ? "In portafoglio" : "In portfolio")}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M5 3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V4h2.5A1.5 1.5 0 0 1 15 5.5v7A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-7A1.5 1.5 0 0 1 2.5 4H5v-.5zM6.5 3a.5.5 0 0 0-.5.5V4h4v-.5a.5.5 0 0 0-.5-.5h-3zM8 8a.75.75 0 0 0-.75.75v.5h-2.5a.75.75 0 0 0 0 1.5h2.5v.5a.75.75 0 0 0 1.5 0v-.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-.5A.75.75 0 0 0 8 8z" />
      </svg>
    </span>
  );
}

type SortDir = "desc" | "asc";
type DayFilter = "all" | "up24h";

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtPctInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function sheetVarGiornUpdatedAt(simTable: SheetTable | null | undefined): string | null {
  let bestMs = 0;
  let bestIso: string | null = null;
  for (const r of simTable?.rows ?? []) {
    const iso = priceRefreshAtFromRow(r as Record<string, unknown>);
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || ms <= bestMs) continue;
    bestMs = ms;
    bestIso = iso;
  }
  return bestIso;
}

function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function GroupKpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "muted" | "accent";
}) {
  const cls =
    tone === "up"
      ? "text-[rgb(var(--signal-up))]"
      : tone === "down"
        ? "text-[rgb(var(--signal-down))]"
        : tone === "accent"
          ? "text-[rgb(var(--accent))]"
          : "text-ink";
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted font-semibold">{label}</p>
      <p className={`text-sm font-bold tabular-nums leading-tight ${cls}`}>{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums leading-snug">{sub}</p> : null}
    </div>
  );
}

/** Nasdaq trading day of a curve, e.g. 2026-09-01 → 01/09. */
function fmtSessionDay(iso: string | null): string {
  const day = (iso ?? "").slice(0, 10);
  const parts = day.split("-");
  if (parts.length !== 3) return day || "—";
  return `${parts[2]}/${parts[1]}`;
}

/** Segmented control: live session vs previous Nasdaq day. */
function SessionChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`relative z-30 pointer-events-auto min-h-[28px] text-[10px] font-semibold px-2.5 py-1 transition ${
        active
          ? "bg-sky-500/20 text-sky-950 dark:text-sky-100"
          : "bg-surface/40 text-ink-muted hover:bg-surface/70 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function BookChip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  const lastActivateRef = useRef(0);
  const activate = (e: React.MouseEvent | React.PointerEvent) => {
    if ("button" in e && e.button !== 0) return;
    e.stopPropagation();
    const now = Date.now();
    if (now - lastActivateRef.current < 120) return;
    lastActivateRef.current = now;
    onClick();
  };
  return (
    <button
      type="button"
      onClick={activate}
      title={title}
      className={`relative z-30 pointer-events-auto min-h-[28px] text-[10px] font-semibold px-2.5 py-1 rounded-md border transition ${
        active
          ? "border-[rgb(var(--accent))]/60 bg-[rgb(var(--accent))]/18 text-ink shadow-sm ring-1 ring-[rgb(var(--accent))]/25"
          : "border-[rgb(var(--border))]/50 bg-surface/40 text-ink-muted hover:bg-surface/70 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

type SheetTableRow = SimUniverse24hWhatIfRow & {
  strongWindCont: boolean;
};

const WhatIfSheetTableRow = memo(function WhatIfSheetTableRow({
  row,
  it,
  sparkValues,
  trendRow,
  trendsLoading,
  onOpenEvaluationTopKpi,
}: {
  row: SheetTableRow;
  it: boolean;
  /** Hourly % path of the selected session for this ticker. */
  sparkValues: number[];
  trendRow?: SearchInterestRow | null;
  trendsLoading?: boolean;
  onOpenEvaluationTopKpi?: (focus: { ticker: string; cd?: string; rowKey?: string }) => void;
}) {
  const deltaCls =
    row.dailyPct24h == null
      ? "text-ink-muted"
      : row.dailyPct24h >= 0
        ? "text-[rgb(var(--signal-up))]"
        : "text-[rgb(var(--signal-down))]";
  const tk = row.ticker.trim().toUpperCase();
  const trendLoading = Boolean(trendsLoading && !trendRow);
  const canOpen = Boolean(onOpenEvaluationTopKpi);
  const openEval = () => {
    if (!onOpenEvaluationTopKpi) return;
    const rowKey = row.key;
    const cd = rowKey.includes("|") ? rowKey.split("|").slice(1).join("|") : undefined;
    onOpenEvaluationTopKpi({
      ticker: row.ticker,
      cd: cd && cd !== "—" ? cd : undefined,
      rowKey,
    });
  };
  const rowTitle = canOpen
    ? `${row.ticker} → Evaluation · Top KPI`
    : row.strongWindCont
      ? it
        ? "Vento forte / picco nascente"
        : "Strong wind / early peak"
      : row.ticker;

  return (
    <tr
      className={`min-h-[2rem] border-b border-[rgb(var(--border))]/25 ${
        row.strongWindCont
          ? "bg-emerald-50/70 hover:bg-emerald-50"
          : "hover:bg-[rgb(var(--accent))]/8"
      } ${canOpen ? "cursor-pointer" : ""}`}
      title={rowTitle}
      onClick={canOpen ? openEval : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openEval();
              }
            }
          : undefined
      }
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      <td className="px-2 py-1 align-middle">
        <TickerCompanyStack
          ticker={row.ticker}
          company={row.company}
          className="pointer-events-none"
          tickerNode={
            <span className="inline-flex items-center gap-1 min-w-0 font-semibold tabular-nums text-ink">
              {row.inPortfolio ? <PfIcon it={it} /> : <span className="inline-block w-[11px]" aria-hidden />}
              <span
                className={
                  row.strongWindCont
                    ? "text-emerald-800 underline decoration-emerald-500 decoration-2 underline-offset-2"
                    : undefined
                }
              >
                {row.ticker}
              </span>
            </span>
          }
        />
      </td>
      <td className="px-2 py-1 align-middle pointer-events-none">
        <WindRowSparkline values={sparkValues} it={it} />
      </td>
      <td className={`px-2 py-1 align-middle text-right font-semibold tabular-nums pointer-events-none ${deltaCls}`}>
        {fmtPct(row.dailyPct24h)}
      </td>
      <td className="px-2 py-1 align-middle text-right pointer-events-none">
        <SearchInterestDualMark
          row={trendRow}
          loading={trendLoading}
          ticker={tk}
          it={it}
          align="right"
        />
      </td>
      <td className="px-2 py-1 align-middle text-right pointer-events-none">
        <ContG10Badge g10={row.contG10} it={it} dense />
      </td>
      <td className="px-2 py-1 align-middle text-right pointer-events-none">
        <ContPContBadge pCont={row.pCont} g10={row.contG10} it={it} dense />
      </td>
    </tr>
  );
});

function pickWindChartTickers(rows: SheetTableRow[], limit = WIND_CURVE_MAX_LINES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (tk: string) => {
    const u = tk.trim().toUpperCase();
    if (!u || seen.has(u) || out.length >= limit) return;
    seen.add(u);
    out.push(u);
  };
  for (const r of rows) {
    if (r.inPortfolio) push(r.ticker);
  }
  for (const r of rows) {
    if (r.strongWindCont) push(r.ticker);
  }
  const rest = [...rows].sort(
    (a, b) => Math.abs(b.dailyPct24h ?? 0) - Math.abs(a.dailyPct24h ?? 0),
  );
  for (const r of rest) push(r.ticker);
  return out;
}

function WindHourlyPctTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload
    .filter((p) => typeof p.value === "number" && Number.isFinite(p.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/60 bg-surface px-2 py-1.5 text-[10px] shadow-sm max-h-40 overflow-y-auto">
      <p className="font-semibold text-ink mb-0.5">{label}</p>
      {rows.slice(0, 10).map((p) => (
        <p key={p.name} className="tabular-nums" style={{ color: p.color }}>
          {p.name}: {fmtPct(p.value)}
        </p>
      ))}
    </div>
  );
}

export type WindSessionMode = "live" | "prior";

type WindSessionCurves = {
  chartRows: WhatIfHourlyCurvePoint[];
  tickersWithData: string[];
  /** Nasdaq trading day the curve belongs to. */
  sessionDate: string | null;
};

const EMPTY_WIND_CURVES: WindSessionCurves = {
  chartRows: [],
  tickersWithData: [],
  sessionDate: null,
};

/**
 * One intraday request feeding both the live session and the previous Nasdaq
 * day, so the big curve, the row sparklines and the session toggle never fetch
 * twice for the same tickers.
 */
function useWindSessionCurves(
  tickers: string[],
  dailyPctByTicker: Record<string, number | null | undefined>,
  enabled: boolean,
): {
  live: WindSessionCurves;
  prior: WindSessionCurves;
  loading: boolean;
  err: string | null;
} {
  const [live, setLive] = useState<WindSessionCurves>(EMPTY_WIND_CURVES);
  const [prior, setPrior] = useState<WindSessionCurves>(EMPTY_WIND_CURVES);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tickerKey = tickers.join(",");
  const dailyPctRef = useRef(dailyPctByTicker);
  dailyPctRef.current = dailyPctByTicker;

  useEffect(() => {
    const list = tickerKey.split(",").filter(Boolean);
    if (!enabled || !list.length) {
      setLive(EMPTY_WIND_CURVES);
      setPrior(EMPTY_WIND_CURVES);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const payload = await fetchIntraday1h(list);
        if (cancelled) return;
        const liveSeries = payload.live?.series ?? payload.series ?? {};
        const priorSeries = payload.prior?.series ?? {};
        const build = (
          series: Record<string, Intraday1hPoint[] | undefined>,
          sessionDate: string | null,
          opts: {
            prevCloseByTicker?: Record<string, number | null | undefined>;
            priorSeries?: Record<string, Intraday1hPoint[] | undefined>;
            useSheetDailyPct?: boolean;
          },
        ): WindSessionCurves => {
          if (!Object.keys(series).length) return EMPTY_WIND_CURVES;
          const baselines = resolveWhatIfPriceBaselines(list, series, {
            prevCloseByTicker: opts.prevCloseByTicker,
            priorSeries: opts.priorSeries,
            dailyPctByTicker: opts.useSheetDailyPct ? dailyPctRef.current : undefined,
          });
          const built = buildWindHourlyPctSeries(list, series, baselines);
          return {
            chartRows: built.chartRows.map((row, i) => ({
              ...row,
              x: `${String(row.ts).slice(0, 13)}-${i}`,
            })),
            tickersWithData: built.tickersWithData,
            sessionDate,
          };
        };
        setLive(
          build(liveSeries, payload.live?.session_date ?? payload.as_of ?? null, {
            prevCloseByTicker: payload.live?.prev_close,
            priorSeries,
            // Sheet Var. Giorn. % only aligns with the live session.
            useSheetDailyPct: true,
          }),
        );
        setPrior(
          build(priorSeries, payload.prior?.session_date ?? null, {
            prevCloseByTicker: payload.prior?.prev_close,
          }),
        );
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
          setLive(EMPTY_WIND_CURVES);
          setPrior(EMPTY_WIND_CURVES);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tickerKey, enabled]);

  return { live, prior, loading, err };
}

/** Compact per-row curve of the selected session (% vs baseline). */
function WindRowSparkline({ values, it }: { values: number[]; it: boolean }) {
  const w = 90;
  const h = 22;
  const path = whatIfSparklinePath(values, w, h);
  if (!path) {
    return (
      <span className="text-[9px] text-ink-muted" title={it ? "Curva non disponibile" : "No curve"}>
        —
      </span>
    );
  }
  const last = values[values.length - 1]!;
  const stroke = last >= 0 ? "rgb(var(--signal-up))" : "rgb(var(--signal-down))";
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      role="img"
      aria-label={`${it ? "Curva" : "Curve"} ${fmtPct(last)}`}
    >
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WindHourlyPctChart({
  curves,
  lines,
  loading,
  err,
  it,
  heading,
}: {
  curves: WindSessionCurves;
  /** Tickers to plot (kept short so the chart stays readable). */
  lines: string[];
  loading: boolean;
  err: string | null;
  it: boolean;
  heading?: string;
}) {
  const rows = curves.chartRows;
  const withData = useMemo(() => {
    const have = new Set(curves.tickersWithData);
    return lines.filter((tk) => have.has(tk));
  }, [curves.tickersWithData, lines]);

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted font-semibold mb-1">
        {heading ??
          (it ? "Curva oraria · % vs chiusura prec." : "Hourly curve · % vs prev close")}
      </p>
      {loading && !rows.length ? (
        <p className="text-[10px] text-ink-muted py-6 text-center">
          {it ? "Caricamento curva…" : "Loading curve…"}
        </p>
      ) : err ? (
        <p className="text-[10px] text-rose-700 dark:text-rose-300 py-4 text-center">{err}</p>
      ) : !rows.length ? (
        <p className="text-[10px] text-ink-muted py-4 text-center">
          {it ? "Curva oraria non disponibile." : "Hourly curve unavailable."}
        </p>
      ) : (
        <div className="h-[160px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgb(var(--border))"
                strokeOpacity={0.3}
                vertical={false}
              />
              <XAxis
                dataKey="x"
                tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
                tickFormatter={(x) => {
                  const row = rows.find((r) => r.x === x);
                  return row?.hour ? String(row.hour) : "";
                }}
              />
              <YAxis
                orientation="right"
                width={40}
                tick={{ fontSize: 9, fill: "rgb(var(--ink-muted))" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(0)}%`}
              />
              <Tooltip content={<WindHourlyPctTooltip />} />
              <ReferenceLine y={0} stroke="rgb(var(--ink-muted))" strokeDasharray="4 3" strokeOpacity={0.5} />
              {withData.map((tk, i) => (
                <Line
                  key={tk}
                  type="linear"
                  dataKey={tk}
                  name={tk}
                  stroke={WIND_LINE_COLORS[i % WIND_LINE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {withData.length ? (
        <p className="text-[9px] text-ink-muted mt-0.5 tabular-nums">
          {it
            ? `${withData.length} titoli in curva${
                lines.length > withData.length ? ` · ${lines.length} richiesti` : ""
              }`
            : `${withData.length} names on curve${
                lines.length > withData.length ? ` · ${lines.length} requested` : ""
              }`}
        </p>
      ) : null}
    </div>
  );
}

export type WindTabViewProps = {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  it?: boolean;
  onOpenEvaluationTopKpi?: (focus: {
    ticker: string;
    cd?: string;
    rowKey?: string;
  }) => void;
  /** Live signals → Simulation sheet → book hydrate (no Yahoo curves). */
  onRefreshPanel?: (opts: {
    onPhase?: (phase: WhatIfPanelRefreshPhase) => void;
  }) => void | Promise<{ warning?: string } | void>;
};

/**
 * Wind tab — universe with CD ≤ ~2 months (ticker, session sparkline, Δ 24h, Trends,
 * 10d %, P(cont)) with a live / previous-Nasdaq-day switch on top.
 */
export function WindTabView({
  simTable,
  inputs,
  it = false,
  onOpenEvaluationTopKpi,
  onRefreshPanel,
}: WindTabViewProps) {
  const hotSimTable = useMemo(() => filterSimTableToHotZoneCd(simTable), [simTable]);
  const model = useMemo(
    () => buildSimUniverse24hWhatIf(hotSimTable, inputs),
    [hotSimTable, inputs],
  );

  const [session, setSession] = useState<WindSessionMode>("live");
  // Opens on the complete universe — losers included.
  const [book, setBook] = useState<WhatIfBookFilter>("all");
  const [dayFilter, setDayFilter] = useState<DayFilter>("all");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [panelRefreshing, setPanelRefreshing] = useState(false);
  const [panelPhase, setPanelPhase] = useState<WhatIfPanelRefreshPhase>("idle");
  const [panelErr, setPanelErr] = useState<string | null>(null);
  const [renderRowLimit, setRenderRowLimit] = useState(ROW_RENDER_BATCH);
  const [trendsByTicker, setTrendsByTicker] = useState<Record<string, SearchInterestRow>>(
    () => peekSearchInterestRows(),
  );
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsLegendOpen, setTrendsLegendOpen] = useState(false);

  const selectBookFilter = useCallback((next: WhatIfBookFilter) => {
    setBook(next);
    setDayFilter("all");
  }, []);

  /** Every rising name — the green curves — whatever the book. */
  const selectUpWind = useCallback(() => {
    setBook("all");
    setDayFilter("up24h");
  }, []);

  const effectiveBook = model ? resolveEffectiveBookFilter(book, model) : book;

  const bookRows = useMemo(() => {
    if (!model) return [];
    return filterWhatIfRowsByBook(model.rows, effectiveBook);
  }, [model, effectiveBook]);

  const tableRows = useMemo((): SheetTableRow[] => {
    let rows = bookRows.map((r) => ({
      ...r,
      strongWindCont: isWhatIfStrongWindContinuation({
        contG10: r.contG10,
        pCont: r.pCont,
        dailyPct24h: r.dailyPct24h,
        exhaustEdge: r.exhaustEdge,
      }),
    }));
    if (dayFilter === "up24h") {
      rows = rows.filter((r) => isWhatIf24hGainer(r));
    }
    rows.sort((a, b) => {
      const av = a.dailyPct24h;
      const bv = b.dailyPct24h;
      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [bookRows, dayFilter, sortDir]);

  useEffect(() => {
    setRenderRowLimit(ROW_RENDER_BATCH);
  }, [tableRows.length, book, dayFilter]);

  useEffect(() => {
    if (renderRowLimit >= tableRows.length) return;
    let cancelled = false;
    const pump = () => {
      if (cancelled) return;
      setRenderRowLimit((n) => Math.min(tableRows.length, n + ROW_RENDER_BATCH));
    };
    const id =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(pump, { timeout: 120 })
        : window.setTimeout(pump, 32);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function" && typeof id === "number") {
        window.cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };
  }, [renderRowLimit, tableRows.length]);

  const displayedTableRows = useMemo(
    () => tableRows.slice(0, renderRowLimit),
    [tableRows, renderRowLimit],
  );

  const portfolioPinnedRows = useMemo(
    () => displayedTableRows.filter((r) => r.inPortfolio),
    [displayedTableRows],
  );
  const scopedTableRows = useMemo(
    () =>
      effectiveBook === "all"
        ? displayedTableRows.filter((r) => !r.inPortfolio)
        : displayedTableRows,
    [displayedTableRows, effectiveBook],
  );

  const upWindCount = useMemo(() => (model ? model.all.nUp24h : 0), [model]);

  // Stable universe list (book/sort chips must not reshuffle the fetch key).
  const universeTickers = useMemo(() => {
    if (!model) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of model.rows) {
      const tk = r.ticker.trim().toUpperCase();
      if (!tk || seen.has(tk)) continue;
      seen.add(tk);
      out.push(tk);
    }
    return out;
  }, [model]);
  const universeTickerKey = universeTickers.join(",");
  const visibleTrendTickers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of displayedTableRows) {
      const tk = r.ticker.trim().toUpperCase();
      if (!tk || seen.has(tk)) continue;
      seen.add(tk);
      out.push(tk);
    }
    return out;
  }, [displayedTableRows]);
  const visibleTrendTickersRef = useRef(visibleTrendTickers);
  visibleTrendTickersRef.current = visibleTrendTickers;

  useEffect(() => {
    if (!universeTickerKey) {
      setTrendsByTicker({});
      setTrendsLoading(false);
      return;
    }
    let alive = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const all = universeTickerKey.split(",").filter(Boolean);
    // Seed from shared store (Wind / prior Top KPI / leaders).
    setTrendsByTicker((prev) => ({ ...peekSearchInterestRows(all), ...prev }));
    setTrendsLoading(missingSearchInterestTickers(visibleTrendTickersRef.current).length > 0);

    const mergeChunk = (payload: SearchInterestPayload) => {
      rememberSearchInterestPayload(payload);
      const rows = payload.rows ?? {};
      setTrendsByTicker((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [raw, value] of Object.entries(rows)) {
          const tk = raw.trim().toUpperCase();
          const row = value as SearchInterestRow | null | undefined;
          if (!tk || !row) continue;
          if (isSearchInterestScored(row) || !isSearchInterestScored(next[tk])) {
            next[tk] = row;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      return Boolean(payload.warming);
    };

    /** Progressive chunk fetch — paint after each chunk so Wind is not blank for minutes. */
    const pullList = async (list: string[]): Promise<{ warming: boolean; scored: number }> => {
      let warming = false;
      let scoredN = 0;
      for (let i = 0; i < list.length; i += 8) {
        if (!alive) return { warming, scored: scoredN };
        const chunk = list.slice(i, i + 8);
        try {
          const payload = await fetchSearchInterest(chunk);
          if (!alive) return { warming, scored: scoredN };
          if (mergeChunk(payload)) warming = true;
          scoredN += Object.values(payload.rows ?? {}).filter((r) =>
            isSearchInterestScored(r),
          ).length;
        } catch {
          warming = true;
        }
      }
      return { warming, scored: scoredN };
    };

    const load = () => {
      void (async () => {
        const prefer = visibleTrendTickersRef.current;
        const preferMissing = missingSearchInterestTickers(prefer.length ? prefer : all.slice(0, 24));
        // 1) Visible Wind rows first — only what's still missing from the shared store.
        const first = await pullList(
          preferMissing.length
            ? preferMissing
            : prefer.length
              ? []
              : missingSearchInterestTickers(all.slice(0, 24)),
        );
        if (!alive) return;
        if (first.scored > 0 || preferMissing.length === 0 || attempt >= 2) {
          setTrendsLoading(false);
        }

        // 2) Rest of universe in the background.
        const restMissing = missingSearchInterestTickers(all);
        if (restMissing.length) await pullList(restMissing);
        if (!alive) return;

        const stillMissing = missingSearchInterestTickers(prefer.length ? prefer : all.slice(0, 24));
        const needRetry = (first.warming || stillMissing.length > 0) && attempt < 8;
        if (needRetry) {
          attempt += 1;
          timer = setTimeout(load, attempt <= 2 ? 2500 : 5000);
          return;
        }
        setTrendsLoading(false);
      })();
    };

    // Keep local Wind cells in sync when Top KPI / other desks fill the store.
    const unsub = subscribeSearchInterestStore(() => {
      if (!alive) return;
      setTrendsByTicker((prev) => ({ ...prev, ...peekSearchInterestRows(all) }));
    });

    void fetchSearchInterestLeaders(40)
      .then((leaders) => {
        if (!alive || !leaders.rows) return;
        mergeChunk(leaders);
        if (Object.values(leaders.rows).some((r) => isSearchInterestScored(r))) {
          setTrendsLoading(false);
        }
      })
      .catch(() => undefined);

    load();
    return () => {
      alive = false;
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [universeTickerKey]);

  const universeDailyPct = useMemo(() => {
    const out: Record<string, number | null | undefined> = {};
    for (const r of model?.rows ?? []) {
      out[r.ticker.trim().toUpperCase()] = r.dailyPct24h;
    }
    return out;
  }, [model]);

  const {
    live: liveCurves,
    prior: priorCurves,
    loading: curvesLoading,
    err: curvesErr,
  } = useWindSessionCurves(universeTickers, universeDailyPct, true);
  const activeCurves = session === "prior" ? priorCurves : liveCurves;

  const sparkByTicker = useMemo(() => {
    const out = new Map<string, number[]>();
    if (!activeCurves.chartRows.length) return out;
    for (const r of displayedTableRows) {
      const tk = r.ticker.trim().toUpperCase();
      if (out.has(tk)) continue;
      out.set(tk, whatIfLastHourlyValues(activeCurves.chartRows, tk, 16));
    }
    return out;
  }, [activeCurves.chartRows, displayedTableRows]);

  const gainerChartLines = useMemo(
    () => pickWindChartTickers(tableRows.filter((r) => isWhatIf24hGainer(r))),
    [tableRows],
  );

  const sheetUpdatedAt = useMemo(() => sheetVarGiornUpdatedAt(simTable), [simTable]);
  const bookUpdatedAt = investSimInputsUpdatedAtIso();

  const handleRefreshPanel = useCallback(async () => {
    if (!onRefreshPanel || panelRefreshing) return;
    setPanelRefreshing(true);
    setPanelErr(null);
    setPanelPhase("live_signals");
    try {
      const result = await onRefreshPanel({
        onPhase: (phase) => setPanelPhase(phase),
      });
      if (result && "warning" in result && result.warning) {
        setPanelErr(result.warning);
      }
    } catch (e) {
      setPanelErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPanelPhase("idle");
      setPanelRefreshing(false);
    }
  }, [onRefreshPanel, panelRefreshing]);

  if (!model) return null;

  return (
    <section className="relative z-[2] isolate shrink-0 min-w-0 rounded-lg border-0 bg-transparent px-0 py-0 space-y-1.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
            <WindIcon className="w-4 h-4 text-sky-600 shrink-0" />
            Wind
          </h2>
          <p className="text-[10px] text-ink-muted leading-snug max-w-prose mt-0.5">
            {it
              ? `${model.rows.length} titoli · CD ≤ ${SIM_HOT_ZONE_DAYS}g (~2 mesi) · anche i negativi · Δ 24h, corsa 10 giorni e P(cont).`
              : `${model.rows.length} names · CD ≤ ${SIM_HOT_ZONE_DAYS}d (~2 mo) · losers included · Δ 24h, 10-day run and P(cont).`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <GroupKpi
            label={it ? "PF 10g" : "PF 10d"}
            value={fmtPct(model.portfolio.meanG10)}
            sub={`${model.portfolio.nWith24h}/${model.portfolio.n} · Δ ${fmtPct(model.portfolio.meanPct)}`}
            tone={
              model.portfolio.meanG10 == null
                ? "muted"
                : model.portfolio.meanG10 >= 0
                  ? "up"
                  : "down"
            }
          />
          <GroupKpi
            label="P(cont)"
            value={fmtPctInt(model.portfolio.meanPCont ?? model.all.meanPCont)}
            sub={it ? "prob. che la corsa continui" : "prob. the run continues"}
            tone="accent"
          />
          <GroupKpi
            label={it ? "Up wind" : "Up wind"}
            value={String(model.all.nUp24h)}
            sub={it ? "titoli con curva verde" : "names with a green curve"}
            tone={model.all.nUp24h > 0 ? "up" : "muted"}
          />
        </div>
      </header>

      <p className="text-[9px] text-ink-muted leading-snug tabular-nums">
        {it ? "Fonti" : "Sources"}
        {" · "}
        <span className="text-ink">
          {it ? "Foglio Var.%" : "Sheet Var.%"} {fmtClock(sheetUpdatedAt)}
        </span>
        {" · "}
        <span className="text-ink">
          {it ? "Book PF" : "Book PF"} {fmtClock(bookUpdatedAt)}
        </span>
        {panelErr ? (
          <>
            {" · "}
            <span className="text-rose-700 dark:text-rose-300">{panelErr}</span>
          </>
        ) : null}
      </p>

      <div
        className="relative z-30 sticky top-0 flex flex-wrap items-center gap-2 pointer-events-auto py-1 -mx-0.5 px-0.5 bg-[rgb(var(--bg-deep))] border-b border-[rgb(var(--border))]/25"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center rounded-md border border-[rgb(var(--border))]/50 overflow-hidden shrink-0">
          <SessionChip
            active={session === "live"}
            onClick={() => setSession("live")}
            title={
              it
                ? "Curve della sessione in corso (o dell'ultima chiusa fuori orario)"
                : "Curves of the running session (or the last settled one out of hours)"
            }
          >
            {it ? "Tempo reale" : "Real time"}
            {liveCurves.sessionDate ? (
              <span className="opacity-70"> · {fmtSessionDay(liveCurves.sessionDate)}</span>
            ) : null}
          </SessionChip>
          <SessionChip
            active={session === "prior"}
            onClick={() => setSession("prior")}
            title={
              it
                ? "Curve dell'ultimo giorno di contrattazioni Nasdaq concluso"
                : "Curves of the last completed Nasdaq trading day"
            }
          >
            {it ? "Ultimo giorno Nasdaq" : "Last Nasdaq day"}
            {priorCurves.sessionDate ? (
              <span className="opacity-70"> · {fmtSessionDay(priorCurves.sessionDate)}</span>
            ) : null}
          </SessionChip>
        </div>
        <span className="w-px self-stretch bg-[rgb(var(--border))]/40" aria-hidden />
        <BookChip
          active={effectiveBook === "portfolio" && dayFilter === "all"}
          onClick={() => selectBookFilter("portfolio")}
        >
          <span className="inline-flex items-center gap-1 pointer-events-none">
            <PfIcon it={it} />
            {it ? `Portafoglio (${model.portfolio.n})` : `Portfolio (${model.portfolio.n})`}
          </span>
        </BookChip>
        <BookChip
          active={effectiveBook === "all" && dayFilter === "all"}
          onClick={() => selectBookFilter("all")}
        >
          {it ? `Tutti (${model.all.n})` : `All (${model.all.n})`}
        </BookChip>
        <BookChip
          active={dayFilter === "up24h"}
          onClick={selectUpWind}
          title={
            it
              ? "Tutti i titoli in rialzo: curva verde, Var. Giorn. % positiva"
              : "Every rising name: green curve, positive day change"
          }
        >
          <span className="inline-flex items-center gap-1 pointer-events-none">
            <WindIcon className="w-3.5 h-3.5 shrink-0" />
            {`Up wind (${upWindCount})`}
          </span>
        </BookChip>
        {onRefreshPanel ? (
          <button
            type="button"
            className="relative z-10 pointer-events-auto min-h-[28px] text-[10px] font-semibold px-2.5 py-1 rounded-md border border-amber-400/60 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            disabled={panelRefreshing}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleRefreshPanel();
            }}
            title={
              it
                ? "Aggiorna Var. Giorn. %: live signals → foglio Simulation → book PF."
                : "Refresh day %: live signals → Simulation sheet → PF book."
            }
          >
            {panelRefreshing
              ? panelPhase === "live_signals"
                ? "Live signals…"
                : panelPhase === "sheet"
                  ? it
                    ? "Foglio…"
                    : "Sheet…"
                  : it
                    ? "Book…"
                    : "Book…"
              : it
                ? "Aggiorna foglio"
                : "Refresh sheet"}
          </button>
        ) : null}
        <span className="text-[9px] text-ink-muted ml-auto tabular-nums">
          {tableRows.length}/{model.rows.length} {it ? "righe" : "rows"}
          {renderRowLimit < tableRows.length ? (
            <span className="text-amber-700 dark:text-amber-300">
              {" · "}
              {it ? `mostra ${renderRowLimit}…` : `showing ${renderRowLimit}…`}
            </span>
          ) : null}
        </span>
      </div>

      <WindHourlyPctChart
        curves={activeCurves}
        lines={gainerChartLines}
        loading={curvesLoading}
        err={curvesErr}
        it={it}
        heading={
          session === "prior"
            ? it
              ? `Ultimo giorno Nasdaq ${fmtSessionDay(priorCurves.sessionDate)} · solo titoli in rialzo (${gainerChartLines.length})`
              : `Last Nasdaq day ${fmtSessionDay(priorCurves.sessionDate)} · gainers only (${gainerChartLines.length})`
            : it
              ? `Tempo reale · solo titoli in rialzo (${gainerChartLines.length}) · % vs chiusura prec.`
              : `Real time · gainers only (${gainerChartLines.length}) · % vs prev close`
        }
      />

      <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 overflow-hidden">
        {tableRows.length === 0 ? (
          <p className="text-[11px] text-ink-muted py-6 text-center px-4">
            {dayFilter === "up24h"
              ? it
                ? "Nessun titolo in rialzo nelle ultime 24h."
                : "No names up on the day."
              : it
                ? "Nessun titolo per questo filtro."
                : "No names for this filter."}
          </p>
        ) : (
          <table className="w-full text-[11px] border-collapse what-if-compact-table">
            <thead className="bg-[rgb(var(--surface-elevated))] border-b border-[rgb(var(--border))]/50 sticky top-0">
              <tr className="text-[9px] uppercase tracking-wide text-ink-muted">
                <th className="text-left font-semibold px-2 py-1.5 w-[1%] whitespace-nowrap">
                  Ticker
                </th>
                <th
                  className="text-left font-semibold px-2 py-1.5 w-[1%] whitespace-nowrap"
                  title={
                    it
                      ? "Curva oraria della sessione selezionata (% vs baseline)."
                      : "Hourly curve of the selected session (% vs baseline)."
                  }
                >
                  {session === "prior"
                    ? it
                      ? "Curva Nasdaq"
                      : "Nasdaq curve"
                    : it
                      ? "Curva live"
                      : "Live curve"}
                </th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 hover:text-ink"
                    onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                    title={it ? "Ordina per Δ 24h" : "Sort by Δ 24h"}
                  >
                    Δ 24h
                    <span className="tabular-nums opacity-70" aria-hidden>
                      {sortDir === "desc" ? "↓" : "↑"}
                    </span>
                  </button>
                </th>
                <th className="text-right font-semibold px-2 py-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    className="inline-flex items-center hover:text-ink"
                    onClick={() => setTrendsLegendOpen(true)}
                    title={
                      it
                        ? "Google Trends — variazione % vs stampa precedente. Clic per legenda."
                        : "Google Trends — % change vs previous print. Click for legend."
                    }
                  >
                    G-Trends
                  </button>
                </th>
                <th
                  className="text-right font-semibold px-2 py-1.5 whitespace-nowrap"
                  title={it ? G10_HELP_IT : G10_HELP_EN}
                >
                  {contRunHeaderLabel(it)}
                </th>
                <th
                  className="text-right font-semibold px-2 py-1.5 whitespace-nowrap"
                  title={
                    it
                      ? "P(continuation) — solo in regime sell (10g % ≥ +5%)."
                      : "P(continuation) — sell regime only (10d % ≥ +5%)."
                  }
                >
                  P(cont)
                </th>
              </tr>
            </thead>
            <tbody>
              {effectiveBook === "all" && portfolioPinnedRows.length > 0 ? (
                <>
                  <tr className="border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--accent))]/5">
                    <td
                      colSpan={TABLE_COLS}
                      className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      {it ? "In portafoglio" : "In portfolio"} ({portfolioPinnedRows.length})
                    </td>
                  </tr>
                  {portfolioPinnedRows.map((row) => (
                    <WhatIfSheetTableRow
                      key={row.key}
                      row={row}
                      it={it}
                      sparkValues={sparkByTicker.get(row.ticker.trim().toUpperCase()) ?? EMPTY_SPARK}
                      trendRow={trendsByTicker[row.ticker.trim().toUpperCase()]}
                      trendsLoading={trendsLoading}
                      onOpenEvaluationTopKpi={onOpenEvaluationTopKpi}
                    />
                  ))}
                </>
              ) : null}
              {effectiveBook === "portfolio"
                ? displayedTableRows.map((row) => (
                    <WhatIfSheetTableRow
                      key={row.key}
                      row={row}
                      it={it}
                      sparkValues={sparkByTicker.get(row.ticker.trim().toUpperCase()) ?? EMPTY_SPARK}
                      trendRow={trendsByTicker[row.ticker.trim().toUpperCase()]}
                      trendsLoading={trendsLoading}
                      onOpenEvaluationTopKpi={onOpenEvaluationTopKpi}
                    />
                  ))
                : null}
              {effectiveBook !== "portfolio" ? (
                <>
                  {effectiveBook === "all" && scopedTableRows.length > 0 ? (
                    <tr className="border-b border-[rgb(var(--border))]/30 bg-surface/50">
                      <td
                        colSpan={TABLE_COLS}
                        className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted"
                      >
                        {it ? "Resto universo" : "Rest of universe"} ({scopedTableRows.length})
                      </td>
                    </tr>
                  ) : null}
                  {scopedTableRows.map((row) => (
                    <WhatIfSheetTableRow
                      key={row.key}
                      row={row}
                      it={it}
                      sparkValues={sparkByTicker.get(row.ticker.trim().toUpperCase()) ?? EMPTY_SPARK}
                      trendRow={trendsByTicker[row.ticker.trim().toUpperCase()]}
                      trendsLoading={trendsLoading}
                      onOpenEvaluationTopKpi={onOpenEvaluationTopKpi}
                    />
                  ))}
                </>
              ) : null}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[10px] leading-snug text-emerald-800/90 px-0.5">
        <span className="font-semibold underline decoration-emerald-500 decoration-2 underline-offset-2">
          {it ? "Ticker sottolineato verde" : "Green-underlined ticker"}
        </span>
        {it
          ? " = vento forte / picco nascente da foglio: (10d≥5%·P≥50%) oppure (0≤10d<5%·Δ≥8%) · edge ≤0."
          : " = strong wind / early peak from sheet: (10d≥5%·P≥50%) or (0≤10d<5%·Δ≥8%) · edge ≤0."}
      </p>

      <GoogleTrendsLegendModal
        open={trendsLegendOpen}
        it={it}
        onClose={() => setTrendsLegendOpen(false)}
      />
    </section>
  );
}

