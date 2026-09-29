import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonitorEntry } from "../sheet/accuracyMetrics";
import { buildWeeklyEvolution, parseMonitorIsoWeek, type WeeklyEvolutionRow, type EvolutionTrend } from "../sheet/modelEvolution";
import { formatPct, formatPp, sortMonitorEntries } from "../sheet/accuracyMetrics";
import { cellStyleToCss, hitCellStyle, maeCellStyle, signedPpCellStyle } from "../sheet/modelLabTableStyles";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

// ── Trend banner ─────────────────────────────────────────────────────────────

function TrendBanner({ trend }: { trend: EvolutionTrend }) {
  const { label, description } = trend;

  const icon = label === "improving" ? "↗" : label === "degrading" ? "↘" : label === "stable" ? "→" : "?";
  const bg =
    label === "improving"
      ? "bg-positive/10 border-positive/25"
      : label === "degrading"
        ? "bg-negative/10 border-negative/25"
        : label === "stable"
          ? "bg-accent/8 border-accent/20"
          : "bg-surface/50 border-[rgb(var(--border))]/40";
  const txt =
    label === "improving"
      ? "text-positive"
      : label === "degrading"
        ? "text-negative"
        : label === "stable"
          ? "text-accent"
          : "text-ink-muted";

  return (
    <div className={`shrink-0 rounded-lg border px-4 py-3 flex items-center gap-3 ${bg}`}>
      <span className={`text-2xl font-bold ${txt}`}>{icon}</span>
      <div>
        <span className={`text-sm font-semibold ${txt}`}>
          {label === "improving"
            ? "Improving"
            : label === "degrading"
              ? "Degrading"
              : label === "stable"
                ? "Stable"
                : "Insufficient data"}
        </span>
        <p className="text-[11px] text-ink-muted mt-0.5">{description}</p>
      </div>
      {trend.accSlope != null && (
        <span className={`ml-auto text-xs font-mono tabular-nums ${txt}`}>
          {trend.accSlope >= 0 ? "+" : ""}
          {trend.accSlope.toFixed(2)} pp/wk
        </span>
      )}
    </div>
  );
}

// ── KPI cards ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  color,
}: {
  label: string;
  value: string;
  delta?: string | null;
  deltaLabel?: string;
  color?: "positive" | "warn" | "negative" | "neutral";
}) {
  const bg =
    color === "positive"
      ? "bg-positive/8 border-positive/20"
      : color === "warn"
        ? "bg-warn/8 border-warn/20"
        : color === "negative"
          ? "bg-negative/8 border-negative/20"
          : "bg-surface/50 border-[rgb(var(--border))]/40";
  const txt =
    color === "positive"
      ? "text-positive"
      : color === "warn"
        ? "text-warn"
        : color === "negative"
          ? "text-negative"
          : "text-ink";
  return (
    <div className={`rounded-lg border px-3 py-2 flex flex-col gap-0.5 ${bg}`}>
      <span className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${txt}`}>{value}</span>
      {delta != null && (
        <span className="text-[10px] text-ink-muted">
          {deltaLabel ?? "WoW"}: {delta}
        </span>
      )}
    </div>
  );
}

function KpiCards({ week }: { week: WeeklyEvolutionRow }) {
  const accColor: "positive" | "warn" | "negative" | "neutral" =
    week.accV4Pct == null
      ? "neutral"
      : week.accV4Pct >= 60
        ? "positive"
        : week.accV4Pct >= 50
          ? "warn"
          : "negative";

  const deltaAcc =
    week.deltaAcc != null
      ? `${week.deltaAcc >= 0 ? "+" : ""}${week.deltaAcc.toFixed(1)} pp`
      : null;
  const deltaMae =
    week.deltaMae7 != null
      ? `${week.deltaMae7 >= 0 ? "+" : ""}${week.deltaMae7.toFixed(1)} pp`
      : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
      <KpiCard
        label="Acc. ↑/↓ v4 (week)"
        value={formatPct(week.accV4Pct)}
        delta={deltaAcc}
        color={accColor}
      />
      <KpiCard
        label="MAE T+7"
        value={formatPp(week.m2Mae7)}
        delta={deltaMae}
        color="neutral"
      />
      <KpiCard
        label="Hit% T+5"
        value={formatPct(week.m2HitD5)}
        color={
          week.m2HitD5 == null ? "neutral" : week.m2HitD5 >= 60 ? "positive" : week.m2HitD5 >= 50 ? "warn" : "negative"
        }
      />
      <KpiCard
        label="Bias T+7"
        value={formatPp(week.m2Bias7)}
        color={
          week.m2Bias7 == null
            ? "neutral"
            : Math.abs(week.m2Bias7) <= 3
              ? "positive"
              : Math.abs(week.m2Bias7) <= 7
                ? "warn"
                : "negative"
        }
      />
    </div>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────

type ChartRow = {
  weekLabel: string;
  accV4Pct: number | null;
  m2Mae7: number | null;
  m2Bias7: number | null;
};

function EvolutionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: number | null; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-semibold text-ink">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span>
            {p.name}:{" "}
            <strong>
              {p.value != null
                ? p.name?.includes("MAE") || p.name?.includes("Bias")
                  ? `${p.value.toFixed(1)} pp`
                  : `${p.value.toFixed(1)}%`
                : "—"}
            </strong>
          </span>
        </p>
      ))}
    </div>
  );
}

// ── Individual runs table ─────────────────────────────────────────────────────

function formatRunTimestamp(runIso: string): string {
  const d = new Date(runIso);
  if (Number.isNaN(d.getTime())) return runIso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Max run/week rows shown in accuracy score tables. */
const MAX_SCORE_TABLE_ROWS = 3;

function RunsTable({ entries }: { entries: MonitorEntry[] }) {
  const sorted = useMemo(() => [...sortMonitorEntries(entries)].reverse(), [entries]);
  const visible = useMemo(() => sorted.slice(0, MAX_SCORE_TABLE_ROWS), [sorted]);
  const hiddenCount = sorted.length - visible.length;
  const accRange = useMemo(() => {
    const vals = visible.map((e) => e.accV4Pct).filter((v): v is number => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [visible]);
  const mae7Range = useMemo(() => {
    const vals = visible.map((e) => e.m2Mae7).filter((v): v is number => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [visible]);

  return (
    <div className="flex flex-col gap-1 min-h-0 shrink-0">
      <p className="text-xs text-ink-muted">
        Individual runs — latest {visible.length}
        {sorted.length > MAX_SCORE_TABLE_ROWS ? ` of ${sorted.length}` : ""}
        {hiddenCount > 0 ? ` (${hiddenCount} older hidden)` : ""}
      </p>
      <div className="overflow-auto max-h-[200px] border border-[rgb(var(--border))] rounded-lg">
        <table className={`${SHEET_GRID_TABLE_CLASS} text-xs`}>
          <SheetGridColgroup columnCount={6} />
          <thead className="sticky top-0 bg-surface-elevated z-10">
            <tr className="border-b-2 border-[rgb(var(--border))]">
              <th className={gridTh("left")}>Run time</th>
              <th className={gridTh("left")}>Week</th>
              <th className={gridTh("center")}>Acc. ↑/↓ v4</th>
              <th className={gridTh("center")}>MAE T+7</th>
              <th className={gridTh("center")}>Hit% T+5</th>
              <th className={gridTh("left")}>Trigger</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e, i) => {
              const week = parseMonitorIsoWeek(e.runIso);
              return (
                <tr
                  key={`${e.runIso}-${i}`}
                  className={[
                    "border-b border-[rgb(var(--border))]/40 hover:bg-surface-elevated/50",
                    i === 0 ? "bg-accent/5" : "",
                    e.invalid ? "opacity-50" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className={`${gridTd("left", "py-1")} whitespace-nowrap font-medium text-ink`}>
                    {formatRunTimestamp(e.runIso)}
                    {i === 0 && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide text-accent bg-accent/10 rounded px-1 py-0.5">
                        latest
                      </span>
                    )}
                  </td>
                  <td className={`${gridTd("left", "py-1")} text-ink-muted whitespace-nowrap`}>
                    {week ? week.key.replace("-W", "·W") : "—"}
                  </td>
                  <td
                    className={gridTd("center", "py-1")}
                    style={cellStyleToCss(hitCellStyle(e.accV4Pct, accRange))}
                  >
                    {formatPct(e.accV4Pct)}
                  </td>
                  <td
                    className={gridTd("center", "py-1")}
                    style={cellStyleToCss(maeCellStyle(e.m2Mae7, mae7Range))}
                  >
                    {formatPp(e.m2Mae7)}
                  </td>
                  <td className={gridTd("center", "py-1")}>{formatPct(e.m2HitD5)}</td>
                  <td className={`${gridTd("left", "py-1")} text-ink-muted truncate max-w-[120px]`}>
                    {e.trigger ?? "—"}
                    {e.invalid && (
                      <span className="ml-1 text-[9px] text-negative">(skipped)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Weekly table ──────────────────────────────────────────────────────────────

function WeeklyTable({ weeks }: { weeks: WeeklyEvolutionRow[] }) {
  const sorted = useMemo(() => [...weeks].reverse(), [weeks]);
  const visible = useMemo(() => sorted.slice(0, MAX_SCORE_TABLE_ROWS), [sorted]);
  const accRange = useMemo(() => {
    const vals = visible.map((w) => w.accV4Pct).filter((v): v is number => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [visible]);
  const mae7Range = useMemo(() => {
    const vals = visible.map((w) => w.m2Mae7).filter((v): v is number => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [visible]);
  const hit5Range = useMemo(() => {
    const vals = visible.map((w) => w.m2HitD5).filter((v): v is number => v != null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [visible]);

  return (
    <div className="overflow-auto flex-1 min-h-0 border border-[rgb(var(--border))] rounded-lg">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-xs`}>
        <SheetGridColgroup columnCount={9} />
        <thead className="sticky top-0 bg-surface-elevated z-10">
          <tr className="border-b-2 border-[rgb(var(--border))]">
            <th className={gridTh("left")}>Week</th>
            <th className={gridTh("center")}>Run</th>
            <th className={gridTh("center")}>Acc. ↑/↓ v4</th>
            <th className={gridTh("center")}>Δ Acc.</th>
            <th className={gridTh("center")}>MAE T+7</th>
            <th className={gridTh("center")}>Δ MAE</th>
            <th className={gridTh("center")}>Hit% T+5</th>
            <th className={gridTh("center")}>Bias T+7</th>
            <th className={gridTh("left")}>Trigger</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((w, i) => (
            <tr
              key={w.weekKey}
              className={[
                "border-b border-[rgb(var(--border))]/40 hover:bg-surface-elevated/50",
                i === 0 ? "bg-surface-elevated/25" : "",
                w.hasModelChange ? "ring-1 ring-inset ring-accent/20" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <td className={`${gridTd("left", "py-1")} whitespace-nowrap`}>
                <span className="font-medium text-ink">{w.weekLabel}</span>
                {w.hasModelChange && (
                  <span className="ml-1.5 text-[9px] uppercase tracking-wide text-accent bg-accent/10 rounded px-1 py-0.5">
                    model
                  </span>
                )}
              </td>
              <td className={`${gridTd("center", "py-1")} text-ink-muted`}>{w.nRuns}</td>
              <td
                className={`${gridTd("center", "py-1")} font-medium`}
                style={cellStyleToCss(hitCellStyle(w.accV4Pct, accRange))}
              >
                {formatPct(w.accV4Pct)}
              </td>
              <td
                className={gridTd("center", "py-1")}
                style={cellStyleToCss(signedPpCellStyle(w.deltaAcc, 3))}
              >
                {w.deltaAcc != null
                  ? `${w.deltaAcc >= 0 ? "+" : ""}${w.deltaAcc.toFixed(1)}`
                  : "—"}
              </td>
              <td
                className={gridTd("center", "py-1")}
                style={cellStyleToCss(maeCellStyle(w.m2Mae7, mae7Range))}
              >
                {formatPp(w.m2Mae7)}
              </td>
              <td
                className={gridTd("center", "py-1")}
                style={cellStyleToCss(signedPpCellStyle(w.deltaMae7 != null ? -w.deltaMae7 : null, 2))}
              >
                {w.deltaMae7 != null
                  ? `${w.deltaMae7 >= 0 ? "+" : ""}${w.deltaMae7.toFixed(1)}`
                  : "—"}
              </td>
              <td
                className={gridTd("center", "py-1")}
                style={cellStyleToCss(hitCellStyle(w.m2HitD5, hit5Range))}
              >
                {formatPct(w.m2HitD5)}
              </td>
              <td
                className={gridTd("center", "py-1")}
                style={cellStyleToCss(signedPpCellStyle(w.m2Bias7, 5))}
              >
                {formatPp(w.m2Bias7)}
              </td>
              <td className={`${gridTd("left", "py-1")} text-ink-muted truncate max-w-[140px]`}>
                {w.triggers.length ? w.triggers.join(", ") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ModelEvolutionPanel({
  entries,
  source,
  error,
}: {
  entries: MonitorEntry[];
  source: string;
  error: string | null;
}) {
  const summary = useMemo(() => buildWeeklyEvolution(entries), [entries]);

  const chartData = useMemo<ChartRow[]>(
    () =>
      summary.weeks.map((w) => ({
        weekLabel: w.weekLabel,
        accV4Pct: w.accV4Pct,
        m2Mae7: w.m2Mae7,
        m2Bias7: w.m2Bias7,
      })),
    [summary.weeks]
  );

  if (error) {
    return <p className="text-sm text-negative px-1">{error}</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        No snapshots in{" "}
        <code className="text-[10px]">model_accuracy_monitor_history.json</code>. Use{" "}
        <strong>Run monitor test</strong> above, or wait for the weekly task / recalibration.
      </p>
    );
  }

  if (summary.totalWeeks === 0) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">
        No week with valid runs to analyze.
      </p>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {source && (
        <p className="text-[10px] text-ink-muted shrink-0">
          Source: {source} · {summary.totalRuns} valid runs · {summary.totalWeeks} weeks
        </p>
      )}

      <TrendBanner trend={summary.trend} />

      {summary.currentWeek && <KpiCards week={summary.currentWeek} />}

      {chartData.length >= 2 && (
        <div className="shrink-0 h-[220px]">
          <p className="text-xs text-ink-muted mb-1">
            v4 directional accuracy and MAE T+7 per week (last run of the week)
          </p>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                dataKey="weekLabel"
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="acc"
                domain={[40, 80]}
                tick={{ fontSize: 10 }}
                unit="%"
                ticks={[40, 50, 55, 60, 70, 80]}
              />
              <YAxis
                yAxisId="mae"
                orientation="right"
                tick={{ fontSize: 10 }}
                unit=" pp"
              />
              <ReferenceLine
                yAxisId="acc"
                y={50}
                stroke="rgb(var(--warn))"
                strokeDasharray="2 4"
              />
              <ReferenceLine
                yAxisId="acc"
                y={60}
                stroke="rgb(var(--positive))"
                strokeDasharray="2 4"
              />
              <Tooltip content={<EvolutionTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                yAxisId="acc"
                type="monotone"
                dataKey="accV4Pct"
                name="Acc. ↑/↓ v4"
                stroke="rgb(var(--accent))"
                fill="rgb(var(--accent))"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                yAxisId="mae"
                type="monotone"
                dataKey="m2Mae7"
                name="MAE T+7"
                stroke="rgb(var(--warn))"
                strokeWidth={1.5}
                dot={{ r: 2 }}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex flex-col gap-1 min-h-0 flex-1">
        <p className="text-xs text-ink-muted shrink-0">
          Weekly summary — latest {Math.min(MAX_SCORE_TABLE_ROWS, summary.weeks.length)} ISO week
          {summary.weeks.length !== 1 ? "s" : ""} (metrics from the last run of each week). The{" "}
          <strong>Run</strong> column counts snapshots in the week, not a new table row.
        </p>
        <WeeklyTable weeks={summary.weeks} />
        <RunsTable entries={entries} />
      </div>
    </div>
  );
}
