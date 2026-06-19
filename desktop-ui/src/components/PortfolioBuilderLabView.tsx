import { useEffect, useMemo, useState } from "react";
import type { ChartPoint, SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { useLang } from "../shared/i18n";
import { PortfolioComparisonChart } from "./PortfolioComparisonChart";
import {
  STRATEGY_PRESETS,
  type PortfolioBuilderDeal,
  type PortfolioSimulationResult,
  type PortfolioStrategy,
} from "../sheet/portfolioBuilderTypes";
import { buildPortfolioBuilderDeals } from "../sheet/portfolioBuilderLoader";
import {
  simulatePortfolio,
  simulateSimLoopBaseline,
} from "../sheet/portfolioBuilderSim";

export type PortfolioBuilderLabViewProps = {
  simTable: SheetTable | null;
  investInputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  probOptions?: LossAnalysisProbOptions | null;
};

export function PortfolioBuilderLabView({
  simTable,
  investInputs,
  pointsBySeriesKey,
  probOptions,
}: PortfolioBuilderLabViewProps) {
  const { lang } = useLang();
  const it = lang === "it";

  const [strategy, setStrategy] = useState<PortfolioStrategy>("balanced");
  const [deals, setDeals] = useState<PortfolioBuilderDeal[]>([]);
  const [builderResult, setBuilderResult] = useState<PortfolioSimulationResult | null>(null);
  const [simLoopResult, setSimLoopResult] = useState<PortfolioSimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [seed, setSeed] = useState(42);

  const config = STRATEGY_PRESETS[strategy];

  // Load real opportunities from simTable.
  useEffect(() => {
    const loaded = buildPortfolioBuilderDeals({
      simTable,
      inputs: investInputs,
      pointsBySeriesKey,
      lang,
      probOptions,
    });
    // Cap to top 20 by EV to keep the panel readable.
    setDeals(loaded.slice(0, 20));
    setBuilderResult(null);
    setSimLoopResult(null);
  }, [simTable, investInputs, pointsBySeriesKey, lang, probOptions]);

  const totalCapital = useMemo(
    () =>
      deals
        .filter((d) => d.selected)
        .reduce((sum, d) => sum + d.selectedCapital, 0),
    [deals],
  );

  const selectedDeals = useMemo(() => deals.filter((d) => d.selected), [deals]);

  // Phase distribution of currently-selected portfolio.
  const phaseDistribution = useMemo(() => {
    const dist = { early: 0, mid: 0, late: 0 };
    if (totalCapital <= 0) return dist;
    for (const d of selectedDeals) {
      const p = (d.phase || "").toLowerCase();
      const w = (d.selectedCapital / totalCapital) * 100;
      if (p.includes("3") || p.includes("late")) dist.late += w;
      else if (p.includes("1") && !p.includes("/2")) dist.early += w;
      else if (p.includes("preclin") || p.includes("early")) dist.early += w;
      else dist.mid += w;
    }
    return dist;
  }, [selectedDeals, totalCapital]);

  function handleStrategyChange(next: PortfolioStrategy) {
    setStrategy(next);
    setBuilderResult(null);
    setSimLoopResult(null);
  }

  function handleToggleDeal(ticker: string) {
    setDeals((prev) =>
      prev.map((d) => (d.ticker === ticker ? { ...d, selected: !d.selected } : d)),
    );
    setBuilderResult(null);
    setSimLoopResult(null);
  }

  function handleCapitalChange(ticker: string, capital: number) {
    setDeals((prev) =>
      prev.map((d) =>
        d.ticker === ticker
          ? { ...d, selectedCapital: Math.max(0, capital) }
          : d,
      ),
    );
    setBuilderResult(null);
    setSimLoopResult(null);
  }

  function handleAutoAllocate() {
    if (selectedDeals.length === 0) return;
    // Equal-weight subject to maxWeightPerDeal.
    const target = Math.min(
      100 / selectedDeals.length,
      config.maxWeightPerDeal,
    );
    const equalCap = (totalCapital > 0 ? totalCapital : 50000) * (target / 100);
    setDeals((prev) =>
      prev.map((d) =>
        d.selected ? { ...d, selectedCapital: Math.round(equalCap) } : d,
      ),
    );
    setBuilderResult(null);
    setSimLoopResult(null);
  }

  async function runSimulation() {
    setSimulating(true);
    try {
      // Run synchronously — sim is fast (<10ms typical) — but yield to UI first.
      await new Promise((r) => setTimeout(r, 30));
      const builder = simulatePortfolio(deals, config, { seed, days: 30 });
      const baseline = simulateSimLoopBaseline(deals, { seed, days: 30 });
      setBuilderResult(builder);
      setSimLoopResult(baseline);
    } finally {
      setSimulating(false);
    }
  }

  function handleReroll() {
    setSeed((s) => s + 1);
  }

  useEffect(() => {
    if (builderResult && seed !== undefined) {
      // Re-run automatically when user re-rolls seed.
      const builder = simulatePortfolio(deals, config, { seed, days: 30 });
      const baseline = simulateSimLoopBaseline(deals, { seed, days: 30 });
      setBuilderResult(builder);
      setSimLoopResult(baseline);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  return (
    <section className="card flex flex-col flex-1">
      {/* Header */}
      <div className="sticky top-0 z-10 shrink-0 flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3 bg-surface">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-ink">Portfolio Builder Lab</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            {it
              ? "Costruisci il portfolio ottimale con simulazione 30g e bilanciamento attivo"
              : "Build optimal portfolio with 30-day simulation and active rebalancing"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">{it ? "Strategia:" : "Strategy:"}</span>
          {(["conservative", "balanced", "aggressive"] as const).map((s) => {
            const active = strategy === s;
            const palette =
              s === "conservative"
                ? "bg-blue-500"
                : s === "balanced"
                  ? "bg-emerald-500"
                  : "bg-purple-500";
            return (
              <button
                key={s}
                onClick={() => handleStrategyChange(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition ${
                  active
                    ? `${palette} text-white`
                    : "bg-surface/40 text-ink-muted hover:bg-surface/70"
                }`}
              >
                {s === "conservative" && (it ? "Conservativo" : "Conservative")}
                {s === "balanced" && (it ? "Bilanciato" : "Balanced")}
                {s === "aggressive" && (it ? "Aggressivo" : "Aggressive")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 p-4">
        {/* Left: opportunity pool + config */}
        <div className="lg:w-80 shrink-0 flex flex-col gap-3">
          <div className="rounded-xl border border-[rgb(var(--border))] bg-surface/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-ink">
                {it ? "Opportunità reali" : "Real opportunities"}
              </h3>
              <span className="text-[10px] text-ink-muted">
                {deals.length} {it ? "deal" : "deals"}
              </span>
            </div>

            {deals.length === 0 ? (
              <p className="text-xs text-ink-muted text-center py-8">
                {it
                  ? "Nessuna opportunità nei dati attuali. Carica/refresha la simulation table."
                  : "No opportunities in current data. Load/refresh the simulation table."}
              </p>
            ) : (
              <div className="space-y-2">
                {deals.map((deal) => {
                  const ev =
                    (deal.planProbPct / 100) * (deal.planReturnPct ?? 0);
                  return (
                    <div
                      key={deal.ticker}
                      className={`p-2.5 rounded-lg border cursor-pointer transition ${
                        deal.selected
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : "border-[rgb(var(--border))]/30 hover:border-[rgb(var(--border))]/60"
                      }`}
                      onClick={() => handleToggleDeal(deal.ticker)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="min-w-0">
                          <div className="font-mono font-bold text-sm">
                            {deal.ticker}
                            {deal.inPortfolio ? (
                              <span className="ml-1 text-[9px] px-1 py-0.5 bg-amber-500/20 text-amber-700 rounded">
                                IN PF
                              </span>
                            ) : null}
                          </div>
                          {deal.company ? (
                            <div className="text-[10px] text-ink-muted truncate">
                              {deal.company}
                            </div>
                          ) : null}
                        </div>
                        <input
                          type="checkbox"
                          checked={deal.selected}
                          onChange={() => handleToggleDeal(deal.ticker)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />
                      </div>
                      <div className="text-[10px] text-ink-muted grid grid-cols-2 gap-x-2 gap-y-0.5">
                        <span>
                          RA:{" "}
                          <strong className="text-ink">
                            {deal.raScore != null ? deal.raScore.toFixed(0) : "—"}
                          </strong>
                        </span>
                        <span>
                          SDS:{" "}
                          <strong className="text-ink">
                            {deal.sdsScore != null
                              ? deal.sdsScore.toFixed(0)
                              : "—"}
                          </strong>
                        </span>
                        <span className="truncate" title={deal.phase}>
                          {deal.phase}
                        </span>
                        <span>CD: {deal.daysToCD}d</span>
                        <span className="text-blue-600">
                          P: {deal.planProbPct.toFixed(0)}%
                        </span>
                        <span className="text-emerald-600">
                          R: +{deal.planReturnPct.toFixed(0)}%
                        </span>
                        <span className="col-span-2 text-purple-600 font-semibold">
                          EV: {ev >= 0 ? "+" : ""}
                          {ev.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Config card */}
          <div className="rounded-xl border border-[rgb(var(--border))] bg-surface/30 p-4">
            <h3 className="text-sm font-bold text-ink mb-3">
              {it ? "Regole strategia" : "Strategy rules"}
            </h3>
            <div className="space-y-1.5 text-xs">
              <Row label={it ? "Max peso/deal" : "Max weight/deal"} value={`${config.maxWeightPerDeal}%`} />
              <Row label={it ? "Max settore" : "Max sector"} value={`${config.maxWeightPerSector}%`} />
              <Row label="Stop-loss" value={`-${config.stopLossPct}%`} tone="bad" />
              <Row label="Take-profit" value={`+${config.takeProfitPct}%`} tone="good" />
              <Row label="Rebalance" value={`±${config.rebalanceTrigger}%`} />
              <Row
                label={it ? "Mix Early/Mid/Late" : "Early/Mid/Late mix"}
                value={`${config.diversificationTarget.earlyStage}/${config.diversificationTarget.midStage}/${config.diversificationTarget.lateStage}%`}
              />
            </div>
          </div>
        </div>

        {/* Center: portfolio table + simulation */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="rounded-xl border border-[rgb(var(--border))] bg-surface/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-ink">
                {it ? "Portfolio corrente" : "Current portfolio"}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-muted">
                  {selectedDeals.length} {it ? "posizioni" : "positions"} · €{totalCapital.toLocaleString()}
                </span>
                <button
                  onClick={handleAutoAllocate}
                  disabled={selectedDeals.length === 0}
                  className="px-2.5 py-1 text-[11px] font-medium border border-[rgb(var(--border))]/60 rounded hover:bg-surface/70 transition disabled:opacity-50"
                >
                  {it ? "Auto-alloca" : "Auto-allocate"}
                </button>
                <button
                  onClick={runSimulation}
                  disabled={selectedDeals.length === 0 || simulating}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {simulating
                    ? it ? "Simulo..." : "Running..."
                    : it ? "Simula 30g" : "Run 30d"}
                </button>
                {builderResult ? (
                  <button
                    onClick={handleReroll}
                    className="px-2.5 py-1 text-[11px] font-medium border border-[rgb(var(--border))]/60 rounded hover:bg-surface/70 transition"
                    title={it ? "Nuovo seed casuale" : "Re-roll random seed"}
                  >
                    🎲 Re-roll
                  </button>
                ) : null}
              </div>
            </div>

            {/* Phase mix bar */}
            {selectedDeals.length > 0 ? (
              <div className="mb-3 flex items-center gap-2 text-[10px]">
                <span className="text-ink-muted">{it ? "Mix:" : "Mix:"}</span>
                <div className="flex-1 h-2 rounded-full overflow-hidden bg-surface/60 flex">
                  <div
                    className="bg-amber-500"
                    style={{ width: `${phaseDistribution.early}%` }}
                    title={`Early: ${phaseDistribution.early.toFixed(0)}%`}
                  />
                  <div
                    className="bg-emerald-500"
                    style={{ width: `${phaseDistribution.mid}%` }}
                    title={`Mid: ${phaseDistribution.mid.toFixed(0)}%`}
                  />
                  <div
                    className="bg-blue-500"
                    style={{ width: `${phaseDistribution.late}%` }}
                    title={`Late: ${phaseDistribution.late.toFixed(0)}%`}
                  />
                </div>
                <span className="text-amber-600">E {phaseDistribution.early.toFixed(0)}%</span>
                <span className="text-emerald-600">M {phaseDistribution.mid.toFixed(0)}%</span>
                <span className="text-blue-600">L {phaseDistribution.late.toFixed(0)}%</span>
              </div>
            ) : null}

            {selectedDeals.length === 0 ? (
              <p className="text-xs text-ink-muted text-center py-8">
                {it
                  ? "Seleziona almeno un deal dal pannello sinistro"
                  : "Select at least one deal from the left panel"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-[rgb(var(--border))]/30">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-semibold text-ink">Ticker</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">RA</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">SDS</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">CD</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">P(plan)</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">+ROI</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-ink">€</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink">%</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-ink"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border))]/30">
                    {selectedDeals.map((d) => {
                      const w = totalCapital > 0 ? (d.selectedCapital / totalCapital) * 100 : 0;
                      const overWeight = w > config.maxWeightPerDeal;
                      return (
                        <tr key={d.ticker} className="hover:bg-surface/40">
                          <td className="px-2 py-1.5 font-mono font-semibold">{d.ticker}</td>
                          <td className="px-2 py-1.5 text-center">{d.raScore?.toFixed(0) ?? "—"}</td>
                          <td className="px-2 py-1.5 text-center">{d.sdsScore?.toFixed(0) ?? "—"}</td>
                          <td className="px-2 py-1.5 text-center">{d.daysToCD}d</td>
                          <td className="px-2 py-1.5 text-center text-blue-600">{d.planProbPct.toFixed(0)}%</td>
                          <td className="px-2 py-1.5 text-center text-emerald-600">+{d.planReturnPct.toFixed(0)}%</td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              value={d.selectedCapital}
                              onChange={(e) =>
                                handleCapitalChange(d.ticker, Number(e.target.value))
                              }
                              className="w-24 px-2 py-0.5 text-xs text-right border border-[rgb(var(--border))]/30 rounded bg-surface/50"
                            />
                          </td>
                          <td
                            className={`px-2 py-1.5 text-center font-semibold ${
                              overWeight ? "text-red-600" : ""
                            }`}
                            title={overWeight ? `Over max ${config.maxWeightPerDeal}%` : ""}
                          >
                            {w.toFixed(1)}%
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleDeal(d.ticker);
                              }}
                              className="text-red-500 hover:text-red-700 font-bold"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Simulation result summary */}
          {builderResult ? (
            <div className="rounded-xl border border-[rgb(var(--border))] bg-surface/30 p-4">
              <h3 className="text-sm font-bold text-ink mb-3">
                {it ? "Risultati simulazione (30 giorni)" : "Simulation results (30 days)"}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Metric
                  label={it ? "P&L finale" : "Final P&L"}
                  value={`${builderResult.finalPnlEur >= 0 ? "+" : ""}€${builderResult.finalPnlEur.toFixed(0)}`}
                  tone={builderResult.finalPnlEur >= 0 ? "good" : "bad"}
                />
                <Metric
                  label={it ? "Max drawdown" : "Max drawdown"}
                  value={`€${builderResult.maxDrawdownEur.toFixed(0)}`}
                  tone="bad"
                />
                <Metric label="Win rate" value={`${builderResult.winRate.toFixed(0)}%`} tone="info" />
                <Metric label="Sharpe" value={builderResult.sharpeRatio.toFixed(2)} tone="info" />
              </div>

              <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/50 rounded-lg">
                <p className="text-xs text-emerald-800 dark:text-emerald-200 font-semibold mb-1">
                  {it ? "Vantaggi rebalancing attivo" : "Active rebalancing benefits"}
                </p>
                <ul className="space-y-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  <li>
                    • {it ? "Profit lock-in (TP + trim):" : "Profit lock-in (TP + trim):"}{" "}
                    +€{builderResult.profitFromRebalancing.toFixed(0)}
                  </li>
                  <li>
                    • {it ? "Loss saved (stop-loss):" : "Loss saved (stop-loss):"}{" "}
                    €{builderResult.lossSaved.toFixed(0)}
                  </li>
                  <li>
                    • {it ? "Hold medio:" : "Avg hold:"} {builderResult.avgHoldDays.toFixed(1)}{" "}
                    {it ? "giorni" : "days"}
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          {/* Comparison charts */}
          <div className="rounded-xl border border-[rgb(var(--border))] bg-surface/30 p-4">
            <h3 className="text-sm font-bold text-ink mb-3">
              {it ? "Confronto Builder vs Sim Loop" : "Builder vs Sim Loop comparison"}
            </h3>
            <PortfolioComparisonChart
              builderResult={builderResult}
              simLoopResult={simLoopResult}
              actualPortfolio={null}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const valColor =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad"
        ? "text-red-600"
        : "text-ink";
  return (
    <div className="flex justify-between items-center">
      <span className="text-ink-muted">{label}</span>
      <span className={`font-semibold ${valColor}`}>{value}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "info";
}) {
  const palette =
    tone === "good"
      ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-200/50 dark:border-green-800/50"
      : tone === "bad"
        ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200/50 dark:border-red-800/50"
        : "bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200/50 dark:border-blue-800/50";
  return (
    <div className={`text-center p-3 rounded-lg border ${palette}`}>
      <div className="text-[10px] opacity-80 font-medium uppercase tracking-wide">
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}
