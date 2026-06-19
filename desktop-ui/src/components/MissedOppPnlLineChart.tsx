import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Altezza compatta (default singolo grafico). */
export const MISSED_OPP_PNL_PAIR_CHART_HEIGHT = 132;
/** Daily + Cumulative affiancati — stessa riga, area grafico più alta. */
export const MISSED_OPP_PNL_PAIR_CHART_HEIGHT_LG = 210;

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("it-IT")} €`;
}

export type MissedOppPnlLineDef = {
  dataKey: string;
  name: string;
  stroke: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  fillOpacity?: number;
};

export function MissedOppPnlLineChart({
  data,
  lines,
  height = MISSED_OPP_PNL_PAIR_CHART_HEIGHT,
  fill = false,
  areaFill = false,
  curveType = "monotone",
}: {
  data: Record<string, string | number | null>[];
  lines: MissedOppPnlLineDef[];
  height?: number;
  /** Riempie l'altezza residua della card (dashboard affiancata al grafico sim). */
  fill?: boolean;
  /** Area colorata sotto ogni serie (tipico grafico cumulativo). */
  areaFill?: boolean;
  /** natural = curve più morbide; monotone = default lineare-smooth. */
  curveType?: "monotone" | "natural" | "linear";
}) {
  const chartData = useMemo(() => {
    if (data.length !== 1) return data;
    const only = data[0]!;
    const baseline: Record<string, string | number | null> = { date: "…" };
    for (const key of Object.keys(only)) {
      if (key === "date") continue;
      baseline[key] = 0;
    }
    return [baseline, only];
  }, [data]);

  if (!chartData.length) return null;
  const resolvedHeight = height;
  const ChartRoot = areaFill ? ComposedChart : LineChart;

  return (
    <div
      className={`w-full flex flex-col min-h-0 ${fill ? "flex-1 h-full" : "space-y-1"}`}
    >
      <div
        className={`w-full min-h-0 ${fill ? "flex-1 min-h-[100px]" : ""}`}
        style={fill ? undefined : { height: resolvedHeight }}
      >
        <ResponsiveContainer width="100%" height={fill ? "100%" : resolvedHeight}>
          <ChartRoot data={chartData} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
            <XAxis dataKey="date" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 8 }}
              width={48}
              tickFormatter={(v: number) =>
                `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("it-IT")} €`
              }
            />
            <Tooltip
              formatter={(value: number, name: string) => [fmtEur(value), name]}
              labelFormatter={(label) => label}
            />
            {areaFill
              ? lines.map((line) => (
                  <Area
                    key={`area-${line.dataKey}`}
                    type={curveType}
                    dataKey={line.dataKey}
                    name={line.name}
                    stroke="none"
                    fill={line.stroke}
                    fillOpacity={line.fillOpacity ?? 0.14}
                    legendType="none"
                    hide
                    isAnimationActive={false}
                  />
                ))
              : null}
            {lines.map((line) => (
              <Line
                key={line.dataKey}
                type={curveType}
                dataKey={line.dataKey}
                name={line.name}
                stroke={line.stroke}
                strokeWidth={line.strokeWidth ?? (areaFill ? 2 : 2)}
                strokeDasharray={line.strokeDasharray}
                dot={{ r: areaFill ? 2.5 : 3 }}
                activeDot={{ r: 4 }}
                legendType="none"
                isAnimationActive={false}
              />
            ))}
          </ChartRoot>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-0.5 shrink-0">
        {lines.map((line) => (
          <span
            key={line.dataKey}
            className="inline-flex items-center gap-1 text-[8px] text-ink-muted"
          >
            {line.strokeDasharray ? (
              <span
                className="inline-block w-3.5 border-t-2 border-dashed shrink-0"
                style={{ borderColor: line.stroke }}
                aria-hidden
              />
            ) : (
              <span
                className="inline-block w-2 h-0.5 rounded-full shrink-0"
                style={{ backgroundColor: line.stroke }}
                aria-hidden
              />
            )}
            <span>{line.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
