import {
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LearningLoopChartRow } from "../sheet/modelLearningsTimeline";
import type { LearningTrendVisual } from "../sheet/learningTrendVisual";
import { TrendStatusBadge } from "./LearningTrendUi";

function LearningLoopTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: Array<{ payload?: LearningLoopChartRow }>;
  it: boolean;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2 text-[11px] shadow-md space-y-1 max-w-[200px]">
      <p className="font-semibold text-ink">{p.label}</p>
      {p.accV4 != null && (
        <p className="text-ink-muted">
          {it ? "Precisione" : "Accuracy"}: <span className="font-medium text-ink">{p.accV4.toFixed(1)}%</span>
        </p>
      )}
      {p.calFactor != null && (
        <p className="text-ink-muted">
          {it ? "Correzione curve" : "Curve tweak"}: <span className="font-medium text-ink">{p.calFactor.toFixed(4)}</span>
        </p>
      )}
      {p.recalib && (
        <p className="text-accent font-medium">
          {it ? "↻ Aggiornamento automatico" : "↻ Auto-update"}
        </p>
      )}
    </div>
  );
}

export function LearningTrendChart({
  rows,
  visual,
  it,
  compact = false,
}: {
  rows: LearningLoopChartRow[];
  visual: LearningTrendVisual;
  it: boolean;
  compact?: boolean;
}) {
  const hasAcc = rows.some((r) => r.accV4 != null);
  const hasCal = rows.some((r) => r.calFactor != null);
  const recalibPoints = rows.filter((r) => r.recalib && r.accV4 != null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center rounded-lg border border-dashed border-[rgb(var(--border))]/50">
        {it
          ? "Nessun dato — servono snapshot monitor o ricalibrazioni."
          : "No data yet — need monitor snapshots or recalibrations."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] text-ink-muted flex-1 min-w-[180px]">
          {it
            ? "Blu = precisione · Arancione = correzione curve · ◆ = aggiornamento"
            : "Blue = accuracy · Orange = curve tweak · ◆ = update"}
        </p>
        <TrendStatusBadge visual={visual} it={it} />
      </div>
      <div className={`${compact ? "h-[160px]" : "h-[200px]"} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: hasCal ? 32 : 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis
              yAxisId="pct"
              domain={[40, 80]}
              tick={{ fontSize: 9 }}
              unit="%"
              ticks={[40, 50, 60, 70, 80]}
            />
            {hasCal && (
              <YAxis
                yAxisId="cal"
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fontSize: 9 }}
                width={30}
              />
            )}
            <ReferenceLine yAxisId="pct" y={50} stroke="rgb(var(--warn))" strokeDasharray="2 4" />
            <Tooltip content={<LearningLoopTooltip it={it} />} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {hasAcc && (
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="accV4"
                name={it ? "Precisione" : "Accuracy"}
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            )}
            {hasCal && (
              <Line
                yAxisId="cal"
                type="monotone"
                dataKey="calFactor"
                name={it ? "Correzione curve" : "Curve correction"}
                stroke="rgb(var(--warn))"
                strokeWidth={1.5}
                dot={{ r: 2 }}
                connectNulls
              />
            )}
            {recalibPoints.map((p) => (
              <ReferenceDot
                key={`recalib-${p.dayKey}`}
                yAxisId="pct"
                x={p.label}
                y={p.accV4 ?? 50}
                r={4}
                fill="rgb(var(--accent))"
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
