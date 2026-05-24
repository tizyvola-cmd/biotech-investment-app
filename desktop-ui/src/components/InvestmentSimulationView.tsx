import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import {
  appendHistoryPoint,
  clearInvestSimHistory,
  hydrateInvestSimInputs,
  loadInvestSimHistory,
  loadInvestSimInputs,
  loadInvestSimUi,
  persistInvestSimInputs,
  saveInvestSimHistory,
  saveInvestSimUi,
  type InvestSimHistoryPoint,
  type InvestSimInputEntry,
  type InvestSimInputs,
  type InvestSimView,
} from "../sheet/investSimStorage";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import {
  buildPositions,
  rowHasActivePortfolio,
  type SimulationPosition,
} from "../sheet/simulationPosition";
import type { SheetTable } from "../types";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import { SimulationSparkline } from "../sheet/simulationSparkline";

export type { InvestSimInputs };
export { buildPositions } from "../sheet/simulationPosition";

type Position = SimulationPosition;

function parseInputDecimal(raw: string): number {
  const n = Number(raw.trim().replace(/\s/g, "").replace(/,/g, "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Posizione simulata con capitale e prezzo di acquisto (P&L % = 0 se manca il prezzo corrente). */
function isActiveSimPosition(p: Position): boolean {
  return p.capital > 0 && p.buyPrice > 0;
}

function portfolioSnapshot(positions: Position[]) {
  const filled = positions.filter((p) => p.capital > 0 && p.buyPrice > 0);
  const cap = filled.reduce((a, p) => a + p.capital, 0);
  const val = filled.reduce((a, p) => a + p.valueNow, 0);
  const pnl = val - cap;
  const pct = cap > 0 ? (pnl / cap) * 100 : 0;
  const byTicker: InvestSimHistoryPoint["byTicker"] = {};
  for (const p of filled) {
    byTicker[p.key] = {
      value: p.valueNow,
      pnl: p.pnlEur,
      pnlPct: p.pnlPct,
    };
  }
  return { cap, val, pnl, pct, n: filled.length, byTicker };
}

export function InvestmentSimulationView({
  simTable,
  simLoading,
  simError,
  onReloadSimulation,
  onOpenPredictionCharts,
  onOpenSimulationTable,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError: string | null;
  onReloadSimulation: () => void;
  /** Apre Catalyst & curve → Grafici con curve predizione per il ticker. */
  onOpenPredictionCharts: (focus: {
    ticker: string;
    completionDate: string;
    seriesKey: string | null;
  }) => void;
  /** Apre Catalyst Hub → Tabella Simulation. */
  onOpenSimulationTable: () => void;
}) {
  const [inputs, setInputs] = useState<InvestSimInputs>(() => loadInvestSimInputs());
  const [history, setHistory] = useState<InvestSimHistoryPoint[]>(() => loadInvestSimHistory());
  const [ui, setUi] = useState(() => loadInvestSimUi());
  const [simRowTab, setSimRowTab] = useState<"all" | "portfolio">("all");
  const lastSimTableRef = useRef<string | null>(null);
  const inputsHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const rows = simTable?.rows ?? [];
    void (async () => {
      if (!inputsHydratedRef.current) {
        const merged = await hydrateInvestSimInputs(rows.length ? rows : undefined);
        if (cancelled) return;
        setInputs(merged);
        inputsHydratedRef.current = true;
        return;
      }
      if (!rows.length) return;
      setInputs((prev) => {
        const next = reconcileInvestSimInputs(prev, rows);
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [simTable]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "supernova_invest_sim_inputs" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as InvestSimInputs;
          if (parsed && typeof parsed === "object") {
            setInputs(() =>
              reconcileInvestSimInputs(parsed, simTable?.rows ?? [])
            );
          }
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [simTable?.rows]);

  const simKpi = useMemo(() => {
    const rows = simTable?.rows ?? [];
    const totalTickers = rows.length;
    const active = buildPositions(simTable, inputs).filter(
      (p) => p.capital > 0 && p.buyPrice > 0
    );
    const withPosition = active.length;
    const totalCapital = active.reduce((s, p) => s + p.capital, 0);
    const pnlSum = active.reduce((s, p) => s + p.pnlEur, 0);
    const affCol = rows.find((r) =>
      Object.keys(r).some((k) => k.startsWith("Affidabilità"))
    );
    const affKey = affCol
      ? Object.keys(affCol).find((k) => k.startsWith("Affidabilità")) ?? ""
      : "";
    const affVals = affKey
      ? rows.map((r) => Number(r[affKey])).filter((n) => Number.isFinite(n))
      : [];
    const avgAff =
      affVals.length > 0
        ? ((affVals.reduce((a, b) => a + b, 0) / affVals.length) * 100).toFixed(0)
        : "—";
    const dated = rows
      .filter((r) => r["Completion Date"])
      .sort(
        (a, b) =>
          new Date(String(a["Completion Date"])).getTime() -
          new Date(String(b["Completion Date"])).getTime()
      );
    const next = dated[0];
    return { totalTickers, withPosition, totalCapital, pnlSum, avgAff, next };
  }, [simTable, inputs]);

  const view = ui.view;
  const selectedKey = ui.selectedKey;

  const setView = useCallback((v: InvestSimView) => {
    setUi((prev) => {
      const next = { ...prev, view: v };
      saveInvestSimUi(next);
      return next;
    });
  }, []);

  const setSelectedKey = useCallback((key: string | null) => {
    setUi((prev) => {
      const next = { ...prev, selectedKey: key };
      saveInvestSimUi(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!inputsHydratedRef.current) return;
    persistInvestSimInputs(inputs);
  }, [inputs]);

  useEffect(() => {
    saveInvestSimHistory(history);
  }, [history]);

  const positions = useMemo(
    () => buildPositions(simTable, inputs),
    [simTable, inputs]
  );

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows]
  );

  const filteredPositions = useMemo(() => {
    if (simRowTab === "all") return positions;
    return positions.filter((p) => {
      const row = simRowByKey.get(p.key);
      return row ? rowHasActivePortfolio(row, inputs) : isActiveSimPosition(p);
    });
  }, [positions, simRowTab, simRowByKey, inputs]);

  const portfolio = useMemo(() => portfolioSnapshot(positions), [positions]);

  const recordSnapshot = useCallback(
    (force = false) => {
      if (portfolio.n === 0 || portfolio.cap <= 0) return;
      setHistory((prev) =>
        appendHistoryPoint(
          prev,
          {
            capital: portfolio.cap,
            value: portfolio.val,
            pnl: portfolio.pnl,
            pnlPct: portfolio.pct,
            byTicker: portfolio.byTicker,
          },
          { force }
        )
      );
    },
    [portfolio]
  );

  /** Nuovo snapshot quando cambiano i prezzi (ricarica foglio / snapshot). */
  useEffect(() => {
    if (!simTable || simLoading || portfolio.n === 0) return;
    const sig = `${simTable.row_count ?? simTable.rows.length}:${portfolio.val.toFixed(2)}:${portfolio.cap}`;
    if (lastSimTableRef.current === sig) return;
    const isFirst = lastSimTableRef.current === null;
    lastSimTableRef.current = sig;
    if (!isFirst) recordSnapshot(true);
  }, [simTable, simLoading, portfolio.val, portfolio.cap, portfolio.n, recordSnapshot]);

  /** Primo punto storico quando apri una simulazione con capitale. */
  useEffect(() => {
    if (portfolio.n === 0) return;
    setHistory((prev) => {
      if (prev.length > 0) return prev;
      return appendHistoryPoint(prev, {
        capital: portfolio.cap,
        value: portfolio.val,
        pnl: portfolio.pnl,
        pnlPct: portfolio.pct,
        byTicker: portfolio.byTicker,
      });
    });
  }, [portfolio.cap, portfolio.val, portfolio.pnl, portfolio.pct, portfolio.byTicker, portfolio.n]);

  const chartData = useMemo(
    () =>
      positions.filter(isActiveSimPosition).map((p) => ({
        name:
          p.completionDate && p.completionDate !== "—"
            ? `${p.ticker} · ${p.completionDate}`
            : p.ticker,
        pnlPct: Math.round(p.pnlPct * 100) / 100,
        pnlEur: Math.round(p.pnlEur * 100) / 100,
      })),
    [positions]
  );

  const pnlPctDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [-5, 5];
    let min = 0;
    let max = 0;
    for (const d of chartData) {
      min = Math.min(min, d.pnlPct);
      max = Math.max(max, d.pnlPct);
    }
    if (min === max) {
      const pad = Math.max(2, Math.abs(min) * 0.1 + 1);
      return [min - pad, max + pad];
    }
    const pad = Math.max(1, (max - min) * 0.08);
    return [min - pad, max + pad];
  }, [chartData]);

  const hasActivePositions = useMemo(
    () => positions.some(isActiveSimPosition),
    [positions]
  );

  const trendChartData = useMemo(() => {
    return history.map((h) => {
      const d = new Date(h.ts);
      const label = Number.isFinite(d.getTime())
        ? d.toLocaleString("it-IT", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : h.ts;
      const row: Record<string, string | number> = {
        ts: label,
        valore: Math.round(h.value * 100) / 100,
        capitale: Math.round(h.capital * 100) / 100,
        pnl: Math.round(h.pnl * 100) / 100,
        pnlPct: Math.round(h.pnlPct * 100) / 100,
      };
      if (selectedKey && h.byTicker[selectedKey]) {
        row.valoreSel = Math.round(h.byTicker[selectedKey].value * 100) / 100;
      }
      return row;
    });
  }, [history, selectedKey]);

  const setInput = useCallback((key: string, field: "buyPrice" | "capital", v: number) => {
    setInputs((prev) => {
      const cur = prev[key] ?? { buyPrice: 0, capital: 0 };
      const next: InvestSimInputEntry = {
        buyPrice: field === "buyPrice" ? v : cur.buyPrice,
        capital: field === "capital" ? v : cur.capital,
      };
      if (next.buyPrice <= 0 && next.capital <= 0) {
        next.ignoreSheet = true;
      }
      return { ...prev, [key]: next };
    });
  }, []);

  const clearRowSimulation = useCallback(
    (key: string) => {
      setInputs((prev) => ({
        ...prev,
        [key]: { buyPrice: 0, capital: 0, ignoreSheet: true },
      }));
      if (selectedKey === key) setSelectedKey(null);
    },
    [selectedKey, setSelectedKey]
  );

  const selectedPosition = positions.find((p) => p.key === selectedKey) ?? null;

  const seriesKeyForPosition = useCallback(
    (p: Position): string | null => {
      const row = simRowByKey.get(p.key);
      return row ? simulationRowSeriesKey(row) : null;
    },
    [simRowByKey]
  );

  const openPredictionChartsFor = useCallback(
    (p: Position) => {
      onOpenPredictionCharts({
        ticker: p.ticker,
        completionDate: p.completionDate,
        seriesKey: seriesKeyForPosition(p),
      });
    },
    [onOpenPredictionCharts, seriesKeyForPosition]
  );

  const handleReload = useCallback(() => {
    onReloadSimulation();
    setTimeout(() => recordSnapshot(true), 800);
  }, [onReloadSimulation, recordSnapshot]);

  if (view === "trendChart") {
    return (
      <section className="card flex flex-col flex-1 min-h-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
          <button type="button" className="btn-ghost text-xs" onClick={() => setView("workspace")}>
            ← Simulation
          </button>
          <h2 className="text-lg font-semibold">Andamento investimento</h2>
          <p className="text-xs text-ink-muted w-full sm:w-auto">
            {history.length} rilevazioni · aggiorna con <strong>Ricarica</strong> dopo refresh prezzi
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={portfolio.n === 0}
              onClick={() => recordSnapshot(true)}
            >
              Registra ora
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                if (window.confirm("Cancellare tutto lo storico del grafico?")) {
                  clearInvestSimHistory();
                  setHistory([]);
                  lastSimTableRef.current = null;
                }
              }}
            >
              Pulisci storico
            </button>
          </div>
        </div>
        <div className="p-4 pb-6 flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
          {trendChartData.length < 2 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              Servono almeno 2 rilevazioni. Inserisci capitale sulle righe, poi premi{" "}
              <strong>Ricarica</strong> quando aggiorni i prezzi (o <strong>Registra ora</strong>).
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Metric label="Capitale" value={`€ ${portfolio.cap.toLocaleString("it-IT")}`} />
                <Metric label="Valore ora" value={`€ ${portfolio.val.toLocaleString("it-IT")}`} />
                <Metric
                  label="P&L €"
                  value={`${portfolio.pnl >= 0 ? "+" : ""}€ ${portfolio.pnl.toLocaleString("it-IT")}`}
                  accent={portfolio.pnl >= 0 ? "positive" : "negative"}
                />
                <Metric
                  label="P&L %"
                  value={`${portfolio.pct >= 0 ? "+" : ""}${portfolio.pct.toFixed(2)}%`}
                  accent={portfolio.pct >= 0 ? "positive" : "negative"}
                />
              </div>
              <div className="flex flex-col gap-5 shrink-0">
              <div>
                <p className="text-xs text-ink-muted mb-2">
                  Valore portafoglio simulato nel tempo
                  {selectedPosition ? ` · evidenza ${selectedPosition.ticker}` : ""}
                </p>
                <div className="h-[min(38vh,360px)] min-h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendChartData} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
                    <XAxis dataKey="ts" tick={{ fontSize: 10 }} hide />
                    <YAxis tick={{ fontSize: 11 }} unit=" €" width={56} />
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        `€ ${v.toLocaleString("it-IT", { maximumFractionDigits: 2 })}`,
                        name,
                      ]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="capitale"
                      name="Capitale investito"
                      stroke="#94a3b8"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="valore"
                      name="Valore portafoglio"
                      stroke="rgb(var(--accent))"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                    />
                    {selectedKey && (
                      <Line
                        type="monotone"
                        dataKey="valoreSel"
                        name={selectedPosition?.ticker ?? "Selezione"}
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="text-xs text-ink-muted mb-2">P&amp;L % portafoglio</p>
                <div className="h-[min(32vh,300px)] min-h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendChartData} margin={{ top: 8, right: 16, left: 4, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
                    <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" width={48} />
                    <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "P&L %"]} />
                    <Line
                      type="monotone"
                      dataKey="pnlPct"
                      name="P&L %"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                </div>
              </div>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  if (view === "snapshotBar") {
    return (
      <section className="card flex flex-col flex-1 min-h-[28rem]">
        <div className="flex items-center gap-2 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
          <button type="button" className="btn-ghost text-xs" onClick={() => setView("workspace")}>
            ← Simulation
          </button>
          <h2 className="text-lg font-semibold">P&amp;L per titolo</h2>
          <span className="text-xs text-ink-muted ml-auto">{chartData.length} posizioni</span>
        </div>
        <div className="p-4 flex flex-col gap-4 overflow-auto">
          {chartData.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              Inserisci capitale e prezzo di acquisto su almeno una riga nella simulazione portafoglio.
            </p>
          ) : (
            <>
              <div className="w-full h-[400px] shrink-0">
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      angle={-35}
                      textAnchor="end"
                      height={56}
                    />
                    <YAxis tick={{ fontSize: 11 }} unit="%" domain={pnlPctDomain} />
                    <Tooltip
                      formatter={(v: number, name: string) => [
                        name === "pnlPct" ? `${v.toFixed(2)}%` : `€ ${v.toFixed(2)}`,
                        name === "pnlPct" ? "P&L %" : "P&L €",
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="pnlPct" name="P&L %" radius={[4, 4, 0, 0]} minPointSize={4}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.pnlPct >= 0 ? "#00B050" : "#C00000"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-auto max-h-56 rounded border border-[rgb(var(--border))]/50">
                <table className="w-full text-xs">
                  <thead className="bg-surface-elevated sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Titolo</th>
                      <th className="px-2 py-1.5 text-right font-medium">P&amp;L %</th>
                      <th className="px-2 py-1.5 text-right font-medium">P&amp;L €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row) => (
                      <tr key={row.name} className="border-t border-[rgb(var(--border))]/30">
                        <td className="px-2 py-1">{row.name}</td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums${
                            TABLE_COLORS_ENABLED
                              ? row.pnlPct >= 0
                                ? " text-positive"
                                : " text-negative"
                              : ""
                          }`}
                        >
                          {row.pnlPct >= 0 ? "+" : ""}
                          {row.pnlPct.toFixed(2)}%
                        </td>
                        <td
                          className={`px-2 py-1 text-right tabular-nums${
                            TABLE_COLORS_ENABLED
                              ? row.pnlEur >= 0
                                ? " text-positive"
                                : " text-negative"
                              : ""
                          }`}
                        >
                          {row.pnlEur >= 0 ? "+" : ""}€ {row.pnlEur.toLocaleString("it-IT")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="card flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Simulation investimento</h2>
          <p className="text-xs text-ink-muted">
            {simLoading
              ? "Caricamento…"
              : `${positions.length} righe · simulazione salvata in locale (${history.length} punti storico)`}
          </p>
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={portfolio.n === 0}
            title="Andamento valore portafoglio nel tempo"
            onClick={() => setView("trendChart")}
          >
            Grafico
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={!selectedPosition}
            title="Curve predizione in Catalyst & curve → Grafici"
            onClick={() => {
              if (selectedPosition) openPredictionChartsFor(selectedPosition);
            }}
          >
            Dettaglio
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={!hasActivePositions}
            title="Grafico a barre P&L % per titolo"
            onClick={() => setView("snapshotBar")}
          >
            P&amp;L
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={handleReload}>
            Ricarica
          </button>
        </div>
      </div>

      {simError && <p className="px-4 py-2 text-sm text-negative shrink-0">{simError}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0">
        <KpiCard label="Portafoglio attivo" value={`${simKpi.withPosition} / ${simKpi.totalTickers}`} />
        <KpiCard
          label="Capitale investito"
          value={`$${simKpi.totalCapital.toLocaleString("it-IT")}`}
        />
        <KpiCard
          label="P&L stimato"
          value={
            simKpi.pnlSum !== 0 || simKpi.withPosition > 0
              ? `${simKpi.pnlSum >= 0 ? "+" : ""}$${Math.round(simKpi.pnlSum).toLocaleString("it-IT")}`
              : "—"
          }
          accent={simKpi.pnlSum >= 0 ? "positive" : "negative"}
        />
        <KpiCard label="Affidabilità media" value={`${simKpi.avgAff}%`} />
        <KpiCard
          label="Prossima CD"
          value={
            simKpi.next
              ? `${String(simKpi.next.Ticker ?? "—")} · ${new Date(String(simKpi.next["Completion Date"])).toLocaleDateString("it-IT")}`
              : "—"
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[rgb(var(--border))]/40 shrink-0">
        {(
          [
            ["all", "Tutti i ticker"],
            ["portfolio", "Solo portafoglio"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              simRowTab === id ? "bg-accent/15 text-accent" : "text-ink-muted hover:text-ink"
            }`}
            onClick={() => setSimRowTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/40 shrink-0 bg-surface/30">
        <div className="min-w-0">
          <p className="text-sm font-medium">Foglio prediction</p>
          <p className="text-xs text-ink-muted">
            Affidabilità, curve e metriche modello — tabella completa in Catalyst Hub
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-xs shrink-0"
          onClick={onOpenSimulationTable}
        >
          Apri tabella Simulation → Catalyst
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {portfolio.n > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-2 border-b border-[rgb(var(--border))]/40 text-xs shrink-0">
              <Metric label="Capitale totale" value={`€ ${portfolio.cap.toLocaleString("it-IT")}`} />
              <Metric label="Valore attuale" value={`€ ${portfolio.val.toLocaleString("it-IT")}`} />
              <Metric
                label="P&L portafoglio"
                value={`${portfolio.pnl >= 0 ? "+" : ""}€ ${portfolio.pnl.toFixed(0)}`}
                accent={portfolio.pnl >= 0 ? "positive" : "negative"}
              />
              <Metric
                label="P&L %"
                value={`${portfolio.pct >= 0 ? "+" : ""}${portfolio.pct.toFixed(2)}%`}
                accent={portfolio.pct >= 0 ? "positive" : "negative"}
              />
            </div>
          )}
          <PaneHeader
            title="Simulazione portafoglio"
            subtitle="Capitale, prezzo acquisto e P&L per ticker"
          />
          <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-surface-elevated text-left">
            <tr>
              {[
                "",
                "Ticker",
                "Curva",
                "CD",
                "Prezzo $",
                "Acquisto €",
                "Capitale €",
                "Azioni",
                "P&L €",
                "P&L %",
                "",
              ].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium border-b border-[rgb(var(--border))]/50">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPositions.map((p) => {
              const inp = inputs[p.key] ?? { buyPrice: 0, capital: 0 };
              const selected = selectedKey === p.key;
              const hasSim = p.capital > 0 && p.buyPrice > 0;
              const localEntry = Boolean(
                inputs[p.key] &&
                  (inputs[p.key]!.ignoreSheet ||
                    inputs[p.key]!.buyPrice > 0 ||
                    inputs[p.key]!.capital > 0)
              );
              return (
                <tr
                  key={p.key}
                  className={`border-t border-[rgb(var(--border))]/40 hover:bg-surface/80 ${
                    TABLE_COLORS_ENABLED
                      ? selected
                        ? "bg-accent/10"
                        : hasSim
                          ? "bg-positive/5"
                          : ""
                      : selected
                        ? "bg-surface/80"
                        : ""
                  }`}
                >
                  <td className="px-2 py-1">
                    <input
                      type="radio"
                      name="sim_row"
                      checked={selected}
                      onChange={() => setSelectedKey(p.key)}
                    />
                  </td>
                  <td className="px-2 py-1 font-semibold">{p.ticker}</td>
                  <td className="px-2 py-1">
                    <div className="flex justify-center">
                      <SimulationSparkline row={simRowByKey.get(p.key) ?? {}} width={72} height={24} />
                    </div>
                  </td>
                  <td className="px-2 py-1 text-ink-muted">{p.completionDate}</td>
                  <td className="px-2 py-1 tabular-nums">{fmtUsd(p.currPrice)}</td>
                  <td className="px-2 py-1">
                    <input
                      className="input w-24 py-0.5 text-xs"
                      type="number"
                      min={0}
                      step={0.01}
                      value={inp.buyPrice > 0 ? inp.buyPrice : ""}
                      placeholder={
                        localEntry || inp.ignoreSheet
                          ? undefined
                          : p.buyPrice > 0
                            ? String(p.buyPrice)
                            : (p.currPrice?.toFixed(2) ?? "0")
                      }
                      onChange={(e) =>
                        setInput(p.key, "buyPrice", parseInputDecimal(e.target.value))
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="input w-24 py-0.5 text-xs"
                      type="number"
                      min={0}
                      step={100}
                      value={inp.capital > 0 ? inp.capital : ""}
                      placeholder={
                        localEntry || inp.ignoreSheet
                          ? undefined
                          : p.capital > 0 && inp.capital <= 0
                            ? String(p.capital)
                            : undefined
                      }
                      onChange={(e) =>
                        setInput(p.key, "capital", parseInputDecimal(e.target.value))
                      }
                    />
                  </td>
                  <td className="px-2 py-1 tabular-nums">
                    {p.shares > 0 ? p.shares.toFixed(4) : "—"}
                  </td>
                  <td
                    className={`px-2 py-1 tabular-nums${
                      TABLE_COLORS_ENABLED
                        ? p.pnlEur > 0
                          ? " text-positive"
                          : p.pnlEur < 0
                            ? " text-negative"
                            : ""
                        : ""
                    }`}
                  >
                    {p.capital > 0 ? `${p.pnlEur >= 0 ? "+" : ""}${p.pnlEur.toFixed(2)}` : "—"}
                  </td>
                  <td
                    className={`px-2 py-1 tabular-nums${
                      TABLE_COLORS_ENABLED
                        ? p.pnlPct > 0
                          ? " text-positive"
                          : p.pnlPct < 0
                            ? " text-negative"
                            : ""
                        : ""
                    }`}
                  >
                    {p.capital > 0 ? fmtPct(p.pnlPct) : "—"}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {hasSim && (
                      <button
                        type="button"
                        className="btn-ghost text-[10px] px-1 text-negative"
                        title="Azzera simulazione per questa riga"
                        onClick={() => clearRowSimulation(p.key)}
                      >
                        Azzera
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost text-[10px] px-1"
                      title="Curve predizione (Catalyst & curve)"
                      onClick={() => openPredictionChartsFor(p)}
                    >
                      Dettaglio
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!simLoading && filteredPositions.length === 0 && (
          <p className="p-6 text-center text-sm text-ink-muted">
            {positions.length === 0
              ? "Nessuna riga Simulation — esegui refresh e export snapshot."
              : "Nessuna posizione attiva — inserisci capitale o passa a Tutti i ticker."}
          </p>
        )}
          </div>
      </div>
    </section>
  );
}

function PaneHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 shrink-0 bg-surface/40 border-b border-[rgb(var(--border))]/30">
      <div className="min-w-0">
        <p className="text-xs font-medium leading-tight">{title}</p>
        <p className="text-[10px] text-ink-muted truncate">{subtitle}</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 px-3 py-2 bg-surface/50">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p
        className={`font-semibold tabular-nums ${
          accent === "positive"
            ? "text-positive"
            : accent === "negative"
              ? "text-negative"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "positive" | "negative";
}) {
  return <Metric label={label} value={value} accent={accent} />;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  return `$ ${v.toFixed(2)}`;
}

function fmtPct(v: number): string {
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}
