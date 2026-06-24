import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ZAxis,
  ReferenceLine,
} from "recharts";
import type { MissedOppRow } from "../sheet/missedOpportunityAudit";
import { MISSED_OPP_CAPITAL_EUR, pnlEurFrom24hPct } from "../sheet/missedOpportunityAudit";

function getBlockerColor(blockers: string[]): string {
  const first = blockers[0]?.toLowerCase() ?? "";
  if (first.includes("target")) return "rgb(239, 68, 68)"; // red-500
  if (first.includes("roi") || first.includes("negative")) return "rgb(249, 115, 22)"; // orange-500
  if (first.includes("polygon") || first.includes("match")) return "rgb(168, 85, 247)"; // purple-500
  if (first.includes("slope") || first.includes("watch")) return "rgb(234, 179, 8)"; // yellow-500
  return "rgb(107, 114, 128)"; // gray-500
}

function getBlockerLabel(blockers: string[]): string {
  const first = blockers[0]?.toLowerCase() ?? "";
  if (first.includes("target")) return "Low target";
  if (first.includes("roi") || first.includes("negative")) return "Negative ROI";
  if (first.includes("polygon") || first.includes("match")) return "Low polygon match";
  if (first.includes("slope") || first.includes("watch")) return "Slope WATCH";
  return "Other";
}

interface ChartData {
  ticker: string;
  target: number;
  gain24h: number;
  match: number;
  blockers: string[];
  color: string;
  row: MissedOppRow;
}

export function MissedGainersScatterChart({
  rows,
  onSelect,
  height = 300,
}: {
  rows: MissedOppRow[];
  onSelect: (row: MissedOppRow) => void;
  height?: number;
}) {
  const data = useMemo((): ChartData[] => {
    return rows.map((row) => ({
      ticker: row.ticker,
      target: row.planReturnPct ?? 0,
      gain24h: row.dailyPct24h ?? 0,
      match: row.matchPct ?? 50,
      blockers: row.blockers,
      color: getBlockerColor(row.blockers),
      row,
    }));
  }, [rows]);

  const blockerGroups = useMemo(() => {
    const groups = new Map<string, { label: string; color: string; count: number }>();
    data.forEach((d) => {
      const label = getBlockerLabel(d.blockers);
      const existing = groups.get(label) ?? { label, color: d.color, count: 0 };
      existing.count += 1;
      groups.set(label, existing);
    });
    return Array.from(groups.values()).sort((a, b) => b.count - a.count);
  }, [data]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 justify-center">
        {blockerGroups.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5 text-[10px]">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: g.color }}
            />
            <span className="text-ink-muted">
              {g.label} ({g.count})
            </span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="target"
            name="Target"
            unit="%"
            stroke="rgb(var(--ink-muted))"
            tick={{ fontSize: 10 }}
            label={{
              value: "Target return %",
              position: "insideBottom",
              offset: -10,
              fontSize: 10,
              fill: "rgb(var(--ink-muted))",
            }}
          />
          <YAxis
            type="number"
            dataKey="gain24h"
            name="24h gain"
            unit="%"
            stroke="rgb(var(--ink-muted))"
            tick={{ fontSize: 10 }}
            label={{
              value: "24h gain %",
              angle: -90,
              position: "insideLeft",
              fontSize: 10,
              fill: "rgb(var(--ink-muted))",
            }}
          />
          <ZAxis type="number" dataKey="match" range={[50, 400]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0].payload as ChartData;
              const gain24hEur = pnlEurFrom24hPct(MISSED_OPP_CAPITAL_EUR, d.gain24h);
              const targetEur = pnlEurFrom24hPct(MISSED_OPP_CAPITAL_EUR, d.target);
              return (
                <div className="rounded-lg border border-[rgb(var(--border))] bg-surface/95 backdrop-blur-sm px-3 py-2 shadow-lg">
                  <p className="text-xs font-bold text-ink mb-1">{d.ticker}</p>
                  <p className="text-[10px] text-ink-muted">
                    24h: <span className="text-[rgb(var(--signal-up))] font-semibold">+{d.gain24h.toFixed(1)}%</span>
                    {" "}
                    <span className="text-[rgb(var(--signal-up))] font-semibold">(${gain24hEur.toLocaleString()})</span>
                  </p>
                  <p className="text-[10px] text-ink-muted">
                    Target: <span className="font-semibold">{d.target > 0 ? "+" : ""}{d.target.toFixed(1)}%</span>
                    {" "}
                    <span className="font-semibold">(${targetEur > 0 ? "+" : ""}${targetEur.toLocaleString()})</span>
                  </p>
                  <p className="text-[10px] text-ink-muted">
                    Match: <span className="font-semibold">{d.match.toFixed(0)}%</span>
                  </p>
                  <p className="text-[9px] text-ink-muted/80 mt-1 leading-tight">
                    {d.blockers[0]}
                  </p>
                  <p className="text-[8px] text-ink-muted/60 mt-0.5">
                    Based on ${MISSED_OPP_CAPITAL_EUR.toLocaleString()} stake
                  </p>
                </div>
              );
            }}
          />
          <ReferenceLine x={0} stroke="rgb(var(--ink-muted))" strokeDasharray="2 2" opacity={0.5} />
          <ReferenceLine y={0} stroke="rgb(var(--ink-muted))" strokeDasharray="2 2" opacity={0.5} />
          <Scatter data={data} onClick={(d: ChartData) => onSelect(d.row)} cursor="pointer">
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.7} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <p className="text-[9px] text-center text-ink-muted/80 leading-snug">
        Bubble size = Match % · Click on a bubble to see details
      </p>
    </div>
  );
}
