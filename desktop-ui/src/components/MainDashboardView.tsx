import { useEffect, useMemo, useState } from "react";
import type { AppScreen, ChartBundle, SheetTable } from "../types";
import {
  loadSimulationChartsBundle,
  overlaySheetPredOnPoints,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import {
  hydrateInvestSimInputs,
  loadInvestSimInputs,
} from "../sheet/investSimStorage";
import { reconcileInvestSimInputs } from "../sheet/investSimKeys";
import {
  computeSimulationPosition,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";
import {
  PricePathChart,
  SimulationCurveChart,
} from "./SimulationCurveChart";

type DashboardListMode = "portfolio" | "watch";

// ── Utility ──────────────────────────────────────────────────

function parseDMY(s: string): Date | null {
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPctSigned(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function dirIcon(v: number | null): string {
  if (v == null) return "";
  return v > 0.005 ? "▲ " : v < -0.005 ? "▼ " : "● ";
}

import {
  buildSecK8LinkIndex,
  extractPostK8Markers,
  parseEdgarHrefFromCell,
  type K8ChartMarker,
} from "../sheet/k8ChartLinks";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { buildNowMarkersFromSimulationRows } from "../sheet/chartNowOffset";

function findCol(columns: string[], keyword: string): string {
  return columns.find((c) => c.includes(keyword)) ?? "";
}

function tickerFromRow(row: Record<string, unknown>): string {
  return String(row["Ticker"] ?? "")
    .trim()
    .toUpperCase();
}

function HeroKpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "warn" | "accent";
}) {
  const lineColor =
    accent === "up"
      ? "rgb(var(--signal-up))"
      : accent === "down"
        ? "rgb(var(--signal-down))"
        : accent === "warn"
          ? "rgb(var(--warn))"
          : "rgb(var(--accent))";

  const valueColor =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "warn"
          ? "text-[rgb(var(--warn))]"
          : "text-ink";

  return (
    <div className="flex-1 card px-4 py-3 relative overflow-hidden min-w-0">
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: lineColor }}
      />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted/70 truncate">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 leading-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function FocusKpiCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "muted";
}) {
  const valueClass =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : "text-ink";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-3))]/15 px-3 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted/80 truncate">{label}</p>
      <p className={`text-sm font-semibold tabular-nums mt-0.5 truncate ${valueClass}`}>{value}</p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5 truncate">{sub}</p> : null}
    </div>
  );
}

function TickerFocusKpiPanel({
  row,
  inputs,
}: {
  row: Record<string, unknown>;
  inputs: ReturnType<typeof loadInvestSimInputs>;
}) {
  const ticker = tickerFromRow(row);
  const company = String(row["Società"] ?? row["Nome"] ?? row["Company"] ?? "").trim();
  const cd = String(row["Completion Date"] ?? "");
  const days = daysFromToday(cd);
  const pos = computeSimulationPosition(row, inputs);
  const pred7Raw = row["Δ% vs Pred−60\nPred\n+7"];
  const pred7 = pred7Raw != null ? Number(pred7Raw) : null;
  const affRaw = row["Affidabilità\n%"];
  const aff = affRaw != null ? Number(affRaw) : null;
  const nct = String(row["NCT"] ?? "").trim();
  const linkCell = row["Link studio"];
  const studyHref =
    typeof linkCell === "object" &&
    linkCell != null &&
    "href" in linkCell &&
    typeof (linkCell as { href?: string }).href === "string"
      ? (linkCell as { href: string }).href
      : nct
        ? `https://clinicaltrials.gov/study/${nct.replace(/\s/g, "")}`
        : null;

  return (
    <div className="shrink-0 px-4 py-3 border-b border-[rgb(var(--border))]/50 bg-accent/[0.04]">
      <div className="flex flex-wrap items-baseline gap-2 mb-2">
        <span className="text-base font-bold tracking-wide">{ticker}</span>
        {company ? <span className="text-xs text-ink-muted">{company}</span> : null}
        {studyHref ? (
          <a
            href={studyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-accent hover:underline ml-auto"
          >
            Studio CT.gov →
          </a>
        ) : null}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <FocusKpiCell
          label="Completion Date"
          value={cd || "—"}
          sub={
            days != null
              ? days === 0
                ? "oggi"
                : days > 0
                  ? `tra ${days} gg`
                  : `${Math.abs(days)} gg fa`
              : undefined
          }
          accent={days != null && days <= 7 ? "up" : undefined}
        />
        <FocusKpiCell
          label="Prezzo $"
          value={
            pos?.currPrice != null && Number.isFinite(pos.currPrice)
              ? `$${pos.currPrice.toFixed(2)}`
              : "—"
          }
        />
        <FocusKpiCell
          label="Pred +7"
          value={pred7 != null ? fmtPctSigned(pred7) : "—"}
          accent={pred7 == null ? "muted" : pred7 >= 0 ? "up" : "down"}
        />
        <FocusKpiCell
          label="Affidabilità"
          value={aff != null ? `${aff.toFixed(0)}%` : "—"}
        />
        <FocusKpiCell
          label="Capitale"
          value={
            pos && pos.capital > 0 ? fmtUsd(pos.capital) : "—"
          }
        />
        <FocusKpiCell
          label="P&L"
          value={
            pos && pos.capital > 0 && !pos.pnlUnavailable
              ? `${fmtUsd(pos.pnlEur)} (${pos.pnlPct >= 0 ? "+" : ""}${pos.pnlPct.toFixed(1)}%)`
              : pos?.pnlUnavailable
                ? "N/D prezzo"
                : "—"
          }
          accent={
            pos && pos.capital > 0 && !pos.pnlUnavailable
              ? pos.pnlEur >= 0
                ? "up"
                : "down"
              : "muted"
          }
        />
      </div>
      {nct ? (
        <p className="text-[10px] text-ink-muted mt-2 font-mono">{nct}</p>
      ) : null}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function MainDashboardView({
  simTable,
  simLoading,
  secK8Table,
  secK8Loading,
  onScreen,
  onOpenSecK8,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  secK8Table: SheetTable | null;
  secK8Loading: boolean;
  onScreen: (s: AppScreen) => void;
  onOpenSecK8?: (ticker: string) => void;
}) {
  const simRows = simTable?.rows ?? [];
  const k8Rows = secK8Table?.rows ?? [];

  const [inputs, setInputs] = useState(() => loadInvestSimInputs());
  const [listMode, setListMode] = useState<DashboardListMode>("portfolio");
  const [leftTab, setLeftTab] = useState<"table" | "charts">("charts");
  /** null = tutta la lista; altrimenti solo quel ticker (grafici + tabelle + sidebar). */
  const [focusTicker, setFocusTicker] = useState<string | null>(null);
  const [showK8OnChart, setShowK8OnChart] = useState(false);

  // Chart bundle (for portfolio performance charts)
  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const rows = simTable?.rows ?? [];
    void (async () => {
      if (rows.length) {
        const merged = await hydrateInvestSimInputs(rows);
        if (!cancelled) setInputs(merged);
        return;
      }
      if (!cancelled) setInputs(loadInvestSimInputs());
    })();
    return () => {
      cancelled = true;
    };
  }, [simTable]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "supernova_invest_sim_inputs" || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed && typeof parsed === "object") {
          setInputs(reconcileInvestSimInputs(parsed, simRows));
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [simRows]);

  const portfolioRows = useMemo(
    () => simRows.filter((r) => rowHasActivePortfolio(r, inputs)),
    [simRows, inputs]
  );
  const watchRows = useMemo(
    () => simRows.filter((r) => !rowHasActivePortfolio(r, inputs)),
    [simRows, inputs]
  );
  const displayRows = listMode === "portfolio" ? portfolioRows : watchRows;

  const sortedDisplayTickers = useMemo(() => {
    const s = new Set<string>();
    for (const r of displayRows) {
      const t = tickerFromRow(r);
      if (t && !t.includes("TOTALE")) s.add(t);
    }
    return [...s].sort();
  }, [displayRows]);

  const displayTickers = useMemo(() => new Set(sortedDisplayTickers), [sortedDisplayTickers]);

  const k8ScopeTickers = useMemo(() => {
    if (focusTicker) return new Set([focusTicker]);
    return displayTickers;
  }, [focusTicker, displayTickers]);

  const focusedRows = useMemo(() => {
    if (!focusTicker) return displayRows;
    return displayRows.filter((r) => tickerFromRow(r) === focusTicker);
  }, [displayRows, focusTicker]);

  const focusPrimaryRow = focusedRows[0] ?? null;

  useEffect(() => {
    if (focusTicker && !displayTickers.has(focusTicker)) {
      setFocusTicker(null);
    }
  }, [focusTicker, displayTickers]);

  const portfolioMetrics = useMemo(() => {
    let cap = 0;
    let pnl = 0;
    for (const r of portfolioRows) {
      const p = computeSimulationPosition(r, inputs);
      if (!p || p.capital <= 0) continue;
      cap += p.capital;
      pnl += p.pnlEur;
    }
    return { cap, pnl };
  }, [portfolioRows, inputs]);

  // Lazily resolve K-8 column names (handle unicode variants)
  const k8Cols = secK8Table?.columns ?? [];
  const COL_K8_DATE = findCol(k8Cols, "filing 8-K");
  const COL_K8_D1 = findCol(k8Cols, "seduta +1");
  const COL_K8_EDGAR = findCol(k8Cols, "EDGAR");
  const COL_K8_ITEMS = findCol(k8Cols, "Items");

  // Portfolio rows use merged inputs (locale + foglio)
  const totalCapital = portfolioMetrics.cap;
  const totalPnl = portfolioMetrics.pnl;

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const focusMetrics = useMemo(() => {
    if (!focusTicker || !focusPrimaryRow) return null;
    const pos = computeSimulationPosition(focusPrimaryRow, inputs);
    const cdDays = daysFromToday(String(focusPrimaryRow["Completion Date"] ?? ""));
    return { pos, cdDays };
  }, [focusTicker, focusPrimaryRow, inputs]);

  // Prossimo catalyst: ticker focalizzato o tutta Simulation
  const nextCdDays = useMemo(() => {
    const rows = focusTicker ? focusedRows : simRows;
    return rows.reduce<number | null>((best, r) => {
      const days = daysFromToday(String(r["Completion Date"] ?? ""));
      if (days == null || days < 0) return best;
      return best == null || days < best ? days : best;
    }, null);
  }, [focusTicker, focusedRows, simRows]);

  // K-8 feed: ultimi filing, solo ticker della lista corrente (Portfolio o To Watch)
  const k8Feed = useMemo(() => {
    return [...k8Rows]
      .filter((r) => {
        const t = String(r["Ticker"] ?? "").trim().toUpperCase();
        return t && k8ScopeTickers.has(t);
      })
      .sort((a, b) => {
        const da = parseDMY(String(a[COL_K8_DATE] ?? ""));
        const db = parseDMY(String(b[COL_K8_DATE] ?? ""));
        if (!da || !db) return 0;
        return db.getTime() - da.getTime();
      })
      .slice(0, 10);
  }, [k8Rows, k8ScopeTickers, COL_K8_DATE]);

  const k8RecentCount = useMemo(() => {
    return k8Rows.filter((r) => {
      const t = String(r["Ticker"] ?? "").trim().toUpperCase();
      if (!t || !k8ScopeTickers.has(t)) return false;
      const d = parseDMY(String(r[COL_K8_DATE] ?? ""));
      if (!d) return false;
      return (todayStart - d.getTime()) / 86400000 <= 30;
    }).length;
  }, [k8Rows, k8ScopeTickers, COL_K8_DATE, todayStart]);

  // Load chart bundle once on mount
  useEffect(() => {
    setChartLoading(true);
    void loadSimulationChartsBundle().then((res) => {
      setChartBundle(res.bundle);
      setChartLoading(false);
    });
  }, []);

  // Portfolio series: only invested tickers that have chart data
  const PRED_COLOR = ["#00dc96", "#00af78", "#5eead4", "#34d399", "#6ee7b7", "#2dd4bf"] as const;
  const HIST_COLOR = ["#78c8ff", "#af8cff"] as const;

  const displayChartLines = useMemo(() => {
    if (!chartBundle) return { curve: [], price: [], k8: [] as K8ChartMarker[] };
    const curve: { spec: { id: string; label: string; color: string; strokeWidth: number; field: "pct_foglio" }; points: import("../types").ChartPoint[] }[] = [];
    const price: { id: string; label: string; color: string; points: import("../types").ChartPoint[] }[] = [];
    const k8: K8ChartMarker[] = [];
    const k8Links = buildSecK8LinkIndex(secK8Table);

    focusedRows.forEach((row, i) => {
      const key = simulationRowSeriesKey(row);
      if (!key || !chartBundle.series[key]) return;
      const ticker = String(row["Ticker"] ?? "");
      const meta = chartBundle.series[key];
      const points = overlaySheetPredOnPoints(meta.points, row);
      const ci = i % PRED_COLOR.length;
      const color = PRED_COLOR[ci];
      curve.push({
        spec: {
          id: `${key}_foglio`,
          label: `${ticker} · pred ricalibrata`,
          color,
          strokeWidth: 2.5,
          field: "pct_foglio",
        },
        points,
      });
      k8.push(...extractPostK8Markers(points, ticker, color, k8Links));
      price.push({ id: `${key}_price`, label: `${ticker} · prezzo $`, color: HIST_COLOR[i % 2], points });
    });
    return { curve, price, k8 };
  }, [chartBundle, focusedRows, secK8Table]);

  const chartNowMarkers = useMemo(
    () => buildNowMarkersFromSimulationRows(focusedRows),
    [focusedRows]
  );

  const k8MarkersInScope = useMemo(() => {
    if (!focusTicker) return [];
    return displayChartLines.k8.filter((m) => m.ticker === focusTicker);
  }, [displayChartLines.k8, focusTicker]);

  const visibleK8Markers = useMemo(() => {
    if (!showK8OnChart || !focusTicker) return [];
    return k8MarkersInScope;
  }, [showK8OnChart, focusTicker, k8MarkersInScope]);

  useEffect(() => {
    if (!focusTicker) setShowK8OnChart(false);
  }, [focusTicker]);

  // Catalyst timeline dalla lista corrente (portfolio o to watch)
  const upcoming = useMemo(() => {
    return focusedRows
      .map((r) => ({
        ticker: String(r["Ticker"] ?? ""),
        cd: String(r["Completion Date"] ?? ""),
        days: daysFromToday(String(r["Completion Date"] ?? "")),
        pred7: r["Δ% vs Pred−60\nPred\n+7"] != null ? Number(r["Δ% vs Pred−60\nPred\n+7"]) : null,
        aff: r["Affidabilità\n%"] != null ? Number(r["Affidabilità\n%"]) : null,
      }))
      .filter((r) => r.days != null && r.days >= 0)
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
      .slice(0, 6);
  }, [focusedRows]);

  const setListModeAndTab = (mode: DashboardListMode) => {
    setListMode(mode);
    setFocusTicker(null);
    setShowK8OnChart(false);
    const rows = mode === "portfolio" ? portfolioRows : watchRows;
    if (rows.length > 0) setLeftTab("charts");
    else setLeftTab("table");
  };

  const heroCapital = focusMetrics?.pos?.capital ?? totalCapital;
  const heroPnl = focusMetrics?.pos?.pnlEur ?? totalPnl;
  const heroPnlPct =
    heroCapital > 0 ? (heroPnl / heroCapital) * 100 : null;
  const focusLabel = focusTicker ? ` · ${focusTicker}` : "";

  const listModeToggle = (
    <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30">
      {(
        [
          ["portfolio", "Portfolio"],
          ["watch", "To Watch"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`rounded px-2.5 py-1 text-[10px] font-medium transition ${
            listMode === id ? "bg-accent/20 text-accent" : "text-ink-muted hover:text-ink"
          }`}
          onClick={() => setListModeAndTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">

      {/* Hero KPI strip */}
      <div className="flex gap-2 shrink-0">
        <HeroKpi
          label="Portfolio / To Watch"
          value={`${portfolioRows.length} / ${watchRows.length}`}
          sub="investiti · in osservazione"
        />
        <HeroKpi
          label={focusTicker ? `Capitale${focusLabel}` : "Capitale Totale"}
          value={heroCapital > 0 ? fmtUsd(heroCapital) : "—"}
          accent="accent"
        />
        <HeroKpi
          label={focusTicker ? `P&L${focusLabel}` : "P&L"}
          value={heroCapital > 0 ? fmtUsd(heroPnl) : "—"}
          accent={heroPnl > 0 ? "up" : heroPnl < 0 ? "down" : undefined}
          sub={
            heroCapital > 0 && heroPnl !== 0 && heroPnlPct != null
              ? `${heroPnl >= 0 ? "+" : ""}${heroPnlPct.toFixed(1)}%`
              : undefined
          }
        />
        <HeroKpi
          label={focusTicker ? `Catalyst${focusLabel}` : "Prossimo Catalyst"}
          value={nextCdDays != null ? `${nextCdDays} gg` : "—"}
          accent={nextCdDays != null && nextCdDays <= 3 ? "warn" : undefined}
          sub={nextCdDays != null && nextCdDays <= 7 ? "⚡ imminente" : undefined}
        />
        <HeroKpi
          label={focusTicker ? `K-8${focusLabel}` : "K-8 Recenti"}
          value={String(k8RecentCount)}
          sub="ultimi 30 giorni"
          accent="accent"
        />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0 gap-3">

        {/* Left: Portfolio / To Watch */}
        <div className="flex flex-col min-h-0 min-w-0" style={{ flex: "3" }}>
          <div className="card flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/60 shrink-0">
              {listModeToggle}
              <h2 className="font-semibold text-sm">
                {listMode === "portfolio" ? "Investimenti attivi" : "Società in osservazione"}
              </h2>
              <span className="text-[10px] text-ink-muted">
                {focusTicker
                  ? `focus ${focusTicker}`
                  : `${displayRows.length} ticker`}
                {listMode === "watch" ? " · elenco Simulation" : ""}
              </span>
              {focusTicker && (
                <button
                  type="button"
                  className="text-[10px] text-accent hover:underline"
                  onClick={() => setFocusTicker(null)}
                >
                  ✕ Tutti
                </button>
              )}
              {displayRows.length > 0 && (
                <div className="flex gap-0.5 p-0.5 rounded-md bg-[rgb(var(--surface-3))]/30 ml-1">
                  {(["table", "charts"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                        leftTab === t
                          ? "bg-accent/20 text-accent"
                          : "text-ink-muted hover:text-ink"
                      }`}
                      onClick={() => setLeftTab(t)}
                    >
                      {t === "table" ? "Tabella" : "Grafici"}
                    </button>
                  ))}
                </div>
              )}
              {leftTab === "charts" && (
                <button
                  type="button"
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium border transition ${
                    showK8OnChart
                      ? "bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/40"
                      : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
                  } ${!focusTicker ? "opacity-50" : ""}`}
                  title={
                    focusTicker
                      ? `Mostra filing K-8 di ${focusTicker} (colore = curva pred)`
                      : "Seleziona un ticker (chip o riga) per mostrare i K-8 sul grafico"
                  }
                  disabled={!focusTicker || k8MarkersInScope.length === 0}
                  onClick={() => setShowK8OnChart((v) => !v)}
                >
                  ◆ K-8
                  {focusTicker && showK8OnChart && k8MarkersInScope.length > 0
                    ? ` · ${focusTicker} (${k8MarkersInScope.length})`
                    : focusTicker
                      ? ` · ${focusTicker}`
                      : ""}
                </button>
              )}
              <button
                type="button"
                className="ml-auto text-[11px] text-accent/80 hover:text-accent transition"
                onClick={() => onScreen("simulation")}
              >
                → Simulation
              </button>
            </div>

            {sortedDisplayTickers.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b border-[rgb(var(--border))]/40 shrink-0">
                <span className="text-[10px] text-ink-muted mr-1">Ticker</span>
                <button
                  type="button"
                  className={`rounded-md px-2 py-0.5 text-[10px] font-medium border transition ${
                    !focusTicker
                      ? "bg-accent/20 text-accent border-accent/40"
                      : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
                  }`}
                  onClick={() => setFocusTicker(null)}
                >
                  Tutti
                </button>
                {sortedDisplayTickers.map((tk) => (
                  <button
                    key={tk}
                    type="button"
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border transition ${
                      focusTicker === tk
                        ? "bg-accent/20 text-accent border-accent/40"
                        : "border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink"
                    }`}
                    onClick={() => {
                      setFocusTicker(tk);
                      setLeftTab("charts");
                    }}
                  >
                    {tk}
                  </button>
                ))}
              </div>
            )}

            {focusTicker && focusPrimaryRow && (
              <TickerFocusKpiPanel row={focusPrimaryRow} inputs={inputs} />
            )}

            {leftTab === "charts" && focusedRows.length > 0 ? (
              <div className="overflow-y-auto flex-1 min-h-0 p-3 space-y-4">
                {chartLoading ? (
                  <div className="flex items-center justify-center h-32 text-ink-muted text-sm">
                    Caricamento grafici…
                  </div>
                ) : displayChartLines.curve.length === 0 ? (
                  <p className="text-ink-muted text-sm p-4">
                    {chartBundle
                      ? `Nessun dato grafico per i ticker in ${listMode === "portfolio" ? "Portfolio" : "To Watch"}.`
                      : "Snapshot grafici assente — esegui Export_Desktop_Snapshots.bat."}
                  </p>
                ) : (
                  <>
                    <SimulationCurveChart
                      title={
                        focusTicker
                          ? `Curva predittiva · ${focusTicker}`
                          : `Curva predittiva · ${listMode === "portfolio" ? "Portfolio" : "To Watch"}`
                      }
                      lines={displayChartLines.curve}
                      k8Markers={visibleK8Markers}
                      nowMarkers={chartNowMarkers}
                      onOpenSecK8={onOpenSecK8}
                      yLabel="% vs T−60 · predizione ricalibrata (foglio Simulation)"
                      height={focusTicker ? 300 : 260}
                    />
                    <PricePathChart
                      title={
                        focusTicker
                          ? `Prezzo $ · ${focusTicker}`
                          : "Andamento prezzo $ (close storici)"
                      }
                      lines={displayChartLines.price}
                      field="price_storico_usd"
                      nowMarkers={chartNowMarkers}
                      height={focusTicker ? 220 : 200}
                    />
                    <PricePathChart
                      title={
                        focusTicker
                          ? `Prezzo ricalibrato · ${focusTicker}`
                          : listMode === "portfolio" &&
                              !focusTicker &&
                              displayChartLines.price.length >= 2
                            ? "Prezzo $ path ricalibrato (μ portafoglio · nodi CD)"
                            : `Prezzo $ path ricalibrato · ${listMode === "portfolio" ? "Portfolio" : "To Watch"}`
                      }
                      lines={displayChartLines.price}
                      field="price_usd"
                      nowMarkers={chartNowMarkers}
                      height={220}
                      mode={
                        listMode === "portfolio" &&
                        !focusTicker &&
                        displayChartLines.price.length >= 2
                          ? "portfolio-mean"
                          : "series"
                      }
                      standardNodesOnly
                      aggregateByOffset
                    />
                    <p className="text-[10px] text-ink-muted">
                      Storico reale e confronto dettagliato in{" "}
                      <button type="button" className="text-accent underline" onClick={() => onScreen("catalyst")}>Grafici</button>
                      {" · "}
                      <button type="button" className="text-accent underline" onClick={() => onScreen("secK8")}>SEC K-8</button>
                      .
                    </p>
                  </>
                )}
              </div>
            ) : (
            <div className="overflow-auto flex-1 min-h-0">
              {simLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-8 rounded bg-[rgb(var(--surface-3))]/30 animate-pulse"
                    />
                  ))}
                </div>
              ) : focusedRows.length === 0 ? (
                <p className="text-ink-muted text-sm p-4">
                  {listMode === "portfolio"
                    ? "Nessun investimento attivo — inserisci capitale in Simulation."
                    : "Nessun ticker in osservazione."}
                </p>
              ) : (
                <table className="w-full text-xs border-collapse table-zebra">
                  <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-elevated))]">
                    <tr className="text-[10px] uppercase tracking-wide text-ink-muted/70">
                      <th className="text-left px-4 py-2 font-medium">Ticker</th>
                      <th className="text-left px-2 py-2 font-medium">CD</th>
                      <th className="text-right px-2 py-2 font-medium">Prezzo</th>
                      <th className="text-right px-2 py-2 font-medium">Pred +7</th>
                      <th className="text-center px-2 py-2 font-medium">Curva</th>
                      <th className="text-right px-4 py-2 font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {focusedRows.map((row, i) => {
                      const ticker = String(row["Ticker"] ?? "");
                      const tkUpper = tickerFromRow(row);
                      const isFocused = focusTicker === tkUpper;
                      const cd = String(row["Completion Date"] ?? "");
                      const days = daysFromToday(cd);
                      const pos = computeSimulationPosition(row, inputs);
                      const price = pos?.currPrice ?? Number(row["Prezzo Corrente ($)"]);
                      const pred7Raw = row["Δ% vs Pred−60\nPred\n+7"];
                      const pred7 = pred7Raw != null ? Number(pred7Raw) : null;
                      const hasPosition = pos != null && pos.capital > 0 && pos.buyPrice > 0;
                      const pnl = hasPosition ? pos.pnlEur : null;
                      const pnlPct = hasPosition ? pos.pnlPct : null;

                      const pred7Color =
                        pred7 == null
                          ? "text-ink-muted"
                          : pred7 >= 0
                            ? "text-[rgb(var(--signal-up))]"
                            : "text-[rgb(var(--signal-down))]";
                      const pnlColor =
                        !hasPosition || pnl == null
                          ? "text-ink-muted"
                          : pnl >= 0
                            ? "text-[rgb(var(--signal-up))]"
                            : "text-[rgb(var(--signal-down))]";

                      return (
                        <tr
                          key={ticker + String(i)}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            setFocusTicker(tkUpper);
                            setLeftTab("charts");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setFocusTicker(tkUpper);
                              setLeftTab("charts");
                            }
                          }}
                          className={`border-b border-[rgb(var(--border))]/20 transition-colors cursor-pointer hover:bg-[rgb(var(--surface-3))]/25 ${
                            hasPosition ? "bg-accent/[0.04]" : ""
                          } ${isFocused ? "ring-1 ring-inset ring-accent/60 bg-accent/[0.08]" : ""}`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {hasPosition && (
                                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                              )}
                              <span className="font-bold tracking-wide">{ticker}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-ink-muted tabular-nums">
                            {days != null ? (
                              <span
                                className={
                                  days <= 7 ? "text-[rgb(var(--warn))] font-semibold" : ""
                                }
                              >
                                {days === 0 ? "oggi" : `${days}gg`}
                              </span>
                            ) : (
                              cd
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {Number.isFinite(price) ? `$${price.toFixed(2)}` : "—"}
                          </td>
                          <td className={`px-2 py-2.5 text-right tabular-nums font-semibold ${pred7Color}`}>
                            {pred7 != null ? `${dirIcon(pred7)}${fmtPctSigned(pred7)}` : "—"}
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex justify-center">
                              <SimulationSparkline row={row} />
                            </div>
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${pnlColor}`}>
                            {hasPosition && pnl != null ? (
                              <>
                                {fmtUsd(pnl)}
                                {pnlPct != null && (
                                  <span className="ml-1 text-[10px] opacity-70">
                                    ({pnlPct >= 0 ? "+" : ""}
                                    {pnlPct.toFixed(0)}%)
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Right column: Catalyst timeline + K-8 feed (stesso filtro Portfolio / To Watch) */}
        <div className="flex flex-col min-h-0 min-w-0 gap-3" style={{ flex: "2" }}>
          <div className="flex items-center gap-2 shrink-0 px-1">
            {listModeToggle}
            <span className="text-[10px] text-ink-muted">
              {focusTicker ? (
                <>
                  Catalyst e K-8 per <strong>{focusTicker}</strong>
                </>
              ) : (
                <>
                  Prossimi catalyst e K-8 filtrati per{" "}
                  <strong>{listMode === "portfolio" ? "Portfolio" : "To Watch"}</strong>
                </>
              )}
            </span>
          </div>

          {/* Catalyst timeline */}
          <div className="card flex flex-col overflow-hidden shrink-0" style={{ maxHeight: "46%" }}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/60 shrink-0">
              <h2 className="font-semibold text-sm">
                Prossimi Catalyst
                <span className="ml-1 font-normal text-ink-muted">
                  · {focusTicker ?? (listMode === "portfolio" ? "Portfolio" : "To Watch")}
                </span>
              </h2>
              {focusTicker && (
                <button
                  type="button"
                  className="text-[10px] text-accent hover:underline"
                  onClick={() => setFocusTicker(null)}
                >
                  Tutti
                </button>
              )}
              <button
                type="button"
                className="ml-auto text-[11px] text-accent/80 hover:text-accent transition"
                onClick={() => onScreen("catalyst")}
              >
                → Catalyst Hub
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1">
              {upcoming.length === 0 ? (
                <p className="text-ink-muted text-xs p-2">
                  {simLoading
                    ? "Caricamento..."
                    : `Nessun catalyst imminente in ${listMode === "portfolio" ? "Portfolio" : "To Watch"}.`}
                </p>
              ) : (
                upcoming.map((r) => {
                  const urgent = r.days != null && r.days <= 7;
                  const direction =
                    r.pred7 == null ? "neutral" : r.pred7 >= 0 ? "up" : "down";
                  const signalClass =
                    direction === "up"
                      ? "signal-up"
                      : direction === "down"
                        ? "signal-down"
                        : "signal-neutral";
                  const signalLabel =
                    direction === "up" ? "▲ Long" : direction === "down" ? "▼ Short" : "● Neutro";

                  return (
                    <div
                      key={r.ticker + r.cd}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 border transition ${
                        urgent
                          ? "border-[rgb(var(--warn))]/50 bg-[rgb(var(--warn))]/5"
                          : "border-[rgb(var(--border))]/30 bg-[rgb(var(--surface-3))]/10"
                      }`}
                    >
                      <span className={signalClass}>{signalLabel}</span>
                      <span className="font-bold text-xs tracking-wide">{r.ticker}</span>
                      {r.pred7 != null && (
                        <span
                          className={`text-[10px] tabular-nums ${
                            r.pred7 >= 0
                              ? "text-[rgb(var(--signal-up))]"
                              : "text-[rgb(var(--signal-down))]"
                          }`}
                        >
                          {fmtPctSigned(r.pred7)}
                        </span>
                      )}
                      <span className="text-[11px] text-ink-muted ml-auto tabular-nums">
                        {r.days == null ? "—" : urgent ? `⚡ ${r.days}gg` : `${r.days} gg`}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* K-8 feed */}
          <div className="card flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/60 shrink-0">
              <h2 className="font-semibold text-sm">
                K-8 Recenti
                <span className="ml-1 font-normal text-ink-muted">
                  · {focusTicker ?? (listMode === "portfolio" ? "Portfolio" : "To Watch")}
                </span>
              </h2>
              <span className="text-[10px] text-ink-muted">{k8RecentCount} ultimi 30gg</span>
              <button
                type="button"
                className="ml-auto text-[11px] text-accent/80 hover:text-accent transition"
                onClick={() => onScreen("secK8")}
              >
                → SEC 8-K
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-3 py-2 space-y-1.5">
              {secK8Loading ? (
                <div className="p-2 space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-10 rounded bg-[rgb(var(--surface-3))]/30 animate-pulse"
                    />
                  ))}
                </div>
              ) : k8Feed.length === 0 ? (
                <p className="text-ink-muted text-xs p-2">
                  Nessun filing K-8 negli ultimi periodi per i ticker in{" "}
                  {listMode === "portfolio" ? "Portfolio" : "To Watch"}.
                </p>
              ) : (
                k8Feed.map((row, i) => {
                  const ticker = String(row["Ticker"] ?? "");
                  const date = String(row[COL_K8_DATE] ?? "");
                  const d1Raw = COL_K8_D1 ? row[COL_K8_D1] : null;
                  const d1 = d1Raw != null ? Number(d1Raw) : null;
                  const href = COL_K8_EDGAR ? parseEdgarHrefFromCell(row[COL_K8_EDGAR]) : null;
                  const itemsRaw = COL_K8_ITEMS ? String(row[COL_K8_ITEMS] ?? "") : "";
                  const items = itemsRaw.split("\n")[0].replace("Items 8-K: ", "Items: ");

                  const d1Color =
                    d1 == null
                      ? "text-ink-muted"
                      : d1 >= 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]";

                  return (
                    <div
                      key={ticker + date + String(i)}
                      className="flex items-start gap-2 rounded-lg border border-[rgb(var(--border))]/30 px-3 py-2 bg-[rgb(var(--surface-3))]/10 hover:bg-[rgb(var(--surface-3))]/20 transition"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs tracking-wide">{ticker}</span>
                          <span className="text-[10px] text-ink-muted">{date}</span>
                          {d1 != null && (
                            <span
                              className={`ml-auto font-semibold text-xs tabular-nums ${d1Color}`}
                            >
                              D+1 {dirIcon(d1)}{fmtPctSigned(d1)}
                            </span>
                          )}
                        </div>
                        {items && (
                          <p className="text-[10px] text-ink-muted mt-0.5 truncate">{items}</p>
                        )}
                      </div>
                      {href && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-[10px] text-accent hover:underline whitespace-nowrap mt-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          SEC →
                        </a>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
