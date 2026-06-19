import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLang } from "../shared/i18n";
import type { PortfolioSimulationResult } from "../sheet/portfolioBuilderTypes";

type ComparisonDataPoint = {
  day: number;
  builderPnl: number;
  simLoopPnl: number;
  actualPnl: number;
  builderDaily: number;
  simLoopDaily: number;
  actualDaily: number;
};

export function PortfolioComparisonChart({
  builderResult,
  simLoopResult,
  actualPortfolio,
}: {
  builderResult: PortfolioSimulationResult | null;
  simLoopResult?: PortfolioSimulationResult | null;
  actualPortfolio?: { days: { day: number; totalPnlEur: number; dailyPnlEur: number }[] } | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const chartData = useMemo((): ComparisonDataPoint[] => {
    if (!builderResult) return [];

    const maxDays = Math.max(
      builderResult.days.length,
      simLoopResult?.days?.length ?? 0,
      actualPortfolio?.days?.length ?? 0
    );

    const data: ComparisonDataPoint[] = [];
    for (let day = 0; day <= maxDays; day++) {
      const builderDay = builderResult.days.find(d => d.day === day);
      const simLoopDay = simLoopResult?.days?.find(d => d.day === day);
      const actualDay = actualPortfolio?.days?.find(d => d.day === day);

      data.push({
        day,
        builderPnl: builderDay?.totalPnlEur ?? 0,
        simLoopPnl: simLoopDay?.totalPnlEur ?? 0,
        actualPnl: actualDay?.totalPnlEur ?? 0,
        builderDaily: builderDay?.dailyPnlEur ?? 0,
        simLoopDaily: simLoopDay?.dailyPnlEur ?? 0,
        actualDaily: actualDay?.dailyPnlEur ?? 0,
      });
    }

    return data;
  }, [builderResult, simLoopResult, actualPortfolio]);

  if (!builderResult || chartData.length === 0) {
    return (
      <p className="text-xs text-ink-muted text-center py-8">
        {it ? "Esegui la simulazione per vedere i grafici" : "Run simulation to see charts"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cumulative P&L Chart */}
      <div>
        <h4 className="text-sm font-semibold text-ink mb-2">
          {it ? "📈 P&L Cumulativo (30 giorni)" : "📈 Cumulative P&L (30 days)"}
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              label={{ value: it ? "Giorno" : "Day", position: "insideBottom", offset: -5, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              label={{ value: "P&L (€)", angle: -90, position: "insideLeft", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => `€${value.toLocaleString()}`}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="builderPnl"
              name={it ? "Portfolio Builder" : "Portfolio Builder"}
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
            />
            {simLoopResult && (
              <Line
                type="monotone"
                dataKey="simLoopPnl"
                name="Sim Loop"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            )}
            {actualPortfolio && (
              <Line
                type="monotone"
                dataKey="actualPnl"
                name={it ? "Portfolio Reale" : "Actual Portfolio"}
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Daily P&L Chart */}
      <div>
        <h4 className="text-sm font-semibold text-ink mb-2">
          {it ? "📊 Gain Giornaliero (24h)" : "📊 Daily Gain (24h)"}
        </h4>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              label={{ value: it ? "Giorno" : "Day", position: "insideBottom", offset: -5, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              label={{ value: "P&L 24h (€)", angle: -90, position: "insideLeft", fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(var(--surface))",
                border: "1px solid rgb(var(--border))",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => {
                const sign = value > 0 ? "+" : "";
                return `${sign}€${value.toLocaleString()}`;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="builderDaily"
              name={it ? "Portfolio Builder" : "Portfolio Builder"}
              stroke="#10b981"
              strokeWidth={1.5}
              dot={{ r: 2 }}
            />
            {simLoopResult && (
              <Line
                type="monotone"
                dataKey="simLoopDaily"
                name="Sim Loop"
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={{ r: 2 }}
              />
            )}
            {actualPortfolio && (
              <Line
                type="monotone"
                dataKey="actualDaily"
                name={it ? "Portfolio Reale" : "Actual Portfolio"}
                stroke="#8b5cf6"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={{ r: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Comparison Table */}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3">
        <h4 className="text-sm font-semibold text-ink mb-2">
          {it ? "📋 Confronto Metriche" : "📋 Metrics Comparison"}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-[rgb(var(--border))]/30">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold text-ink"></th>
                <th className="text-center px-2 py-1.5 font-semibold text-green-600">Portfolio Builder</th>
                {simLoopResult && <th className="text-center px-2 py-1.5 font-semibold text-blue-600">Sim Loop</th>}
                {actualPortfolio && <th className="text-center px-2 py-1.5 font-semibold text-purple-600">{it ? "Portfolio Reale" : "Actual"}</th>}
                {simLoopResult && <th className="text-center px-2 py-1.5 font-semibold text-amber-600">Δ vs Sim Loop</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border))]/30">
              <tr>
                <td className="px-2 py-1.5 text-ink-muted">{it ? "P&L finale" : "Final P&L"}</td>
                <td className="px-2 py-1.5 text-center font-bold text-green-600">
                  +€{builderResult.finalPnlEur.toLocaleString()}
                </td>
                {simLoopResult && (
                  <>
                    <td className="px-2 py-1.5 text-center font-bold text-blue-600">
                      +€{(simLoopResult.days[simLoopResult.days.length - 1]?.totalPnlEur ?? 0).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-center font-bold text-amber-600">
                      {builderResult.finalPnlEur > (simLoopResult.days[simLoopResult.days.length - 1]?.totalPnlEur ?? 0) ? "+" : ""}
                      {(((builderResult.finalPnlEur / (simLoopResult.days[simLoopResult.days.length - 1]?.totalPnlEur ?? 1) - 1) * 100).toFixed(0))}%
                    </td>
                  </>
                )}
                {actualPortfolio && (
                  <td className="px-2 py-1.5 text-center font-bold text-purple-600">
                    +€{(actualPortfolio.days[actualPortfolio.days.length - 1]?.totalPnlEur ?? 0).toLocaleString()}
                  </td>
                )}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-ink-muted">{it ? "Max drawdown" : "Max drawdown"}</td>
                <td className="px-2 py-1.5 text-center font-bold text-green-600">
                  {builderResult.maxDrawdownEur.toLocaleString()}€
                </td>
                {simLoopResult && (
                  <>
                    <td className="px-2 py-1.5 text-center font-bold text-blue-600">—</td>
                    <td className="px-2 py-1.5 text-center font-bold text-amber-600">—</td>
                  </>
                )}
                {actualPortfolio && <td className="px-2 py-1.5 text-center font-bold text-purple-600">—</td>}
              </tr>
              <tr>
                <td className="px-2 py-1.5 text-ink-muted">Win Rate</td>
                <td className="px-2 py-1.5 text-center font-bold text-green-600">
                  {builderResult.winRate.toFixed(0)}%
                </td>
                {simLoopResult && (
                  <>
                    <td className="px-2 py-1.5 text-center font-bold text-blue-600">—</td>
                    <td className="px-2 py-1.5 text-center font-bold text-amber-600">—</td>
                  </>
                )}
                {actualPortfolio && <td className="px-2 py-1.5 text-center font-bold text-purple-600">—</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
