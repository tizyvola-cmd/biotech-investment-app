import { useMemo } from "react";
import {
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
import type { DirectionalCalibDoc } from "../data/accuracyModelData";
import { buildWeeklyEvolution } from "../sheet/modelEvolution";
import { resolveLearningsTrendDisplay } from "../sheet/learningTrendVisual";
import { TrendNarrativeSummaryBox, TrendStatusBadge } from "./LearningTrendUi";
import {
  buildCurveEngineChartRows,
  buildCurveEngineNarrative,
  type CurveEngineChartRow,
} from "../sheet/curveEngineNarrative";
import {
  formatPct,
  formatPp,
  type MonitorEntry,
  type TemporalModelRow,
} from "../sheet/accuracyMetrics";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function MetricPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-white/80 px-3 py-2 text-center min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-ink-muted truncate">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-ink">{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums">{sub}</p> : null}
    </div>
  );
}

function EngineChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2 text-[11px] shadow-md space-y-0.5">
      <p className="font-semibold text-ink">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-ink-muted tabular-nums">
          {p.name}:{" "}
          <span className="font-medium text-ink">
            {p.value != null
              ? p.name?.includes("MAE")
                ? `${p.value.toFixed(1)} pp`
                : `${p.value.toFixed(1)}%`
              : "—"}
          </span>
        </p>
      ))}
    </div>
  );
}

function EngineTrendChart({
  rows,
  visual,
  it,
}: {
  rows: CurveEngineChartRow[];
  visual: ReturnType<typeof resolveLearningsTrendDisplay>;
  it: boolean;
}) {
  const hasAcc = rows.some((r) => r.accV4Pct != null);
  const hasMae = rows.some((r) => r.m2Mae7 != null);

  if (rows.length < 2) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center rounded-lg border border-dashed border-[rgb(var(--border))]/50">
        {it
          ? "Servono almeno 2 settimane di monitor per il grafico."
          : "Need at least 2 monitor weeks for the chart."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] text-ink-muted flex-1">
          {it ? "Acc. v4 settimanale · MAE T+7" : "Weekly v4 acc. · MAE T+7"}
        </p>
        <TrendStatusBadge visual={visual} it={it} />
      </div>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: hasMae ? 32 : 8, left: 0, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
            <XAxis dataKey="weekLabel" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis yAxisId="acc" domain={[40, 80]} tick={{ fontSize: 9 }} unit="%" ticks={[40, 50, 60, 70, 80]} />
            {hasMae && (
              <YAxis yAxisId="mae" orientation="right" domain={["auto", "auto"]} tick={{ fontSize: 9 }} width={30} />
            )}
            <ReferenceLine yAxisId="acc" y={50} stroke="rgb(var(--warn))" strokeDasharray="2 4" />
            <ReferenceLine yAxisId="acc" y={60} stroke="rgb(var(--positive))" strokeDasharray="2 4" strokeOpacity={0.5} />
            <Tooltip content={<EngineChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {hasAcc && (
              <Line
                yAxisId="acc"
                type="monotone"
                dataKey="accV4Pct"
                name="Acc. v4"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            )}
            {hasMae && (
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
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HorizonSnapshot({
  v4Row,
  v5Row,
  it,
}: {
  v4Row: TemporalModelRow | null;
  v5Row: TemporalModelRow | null;
  it: boolean;
}) {
  if (!v4Row && !v5Row) return null;
  const offsets = [5, 7] as const;
  const models = (
    [
      ["v4", v4Row],
      ["v5", v5Row],
    ] as const
  ).filter(([, row]) => row != null);

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 overflow-hidden">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-xs`}>
        <SheetGridColgroup columnCount={6} />
        <thead className="bg-surface-elevated/80">
          <tr className="text-[10px] uppercase text-ink-muted">
            <th className={gridTh("left")}>{it ? "Modello" : "Model"}</th>
            {offsets.map((o) => (
              <th key={`h-${o}`} className={gridTh("center")}>
                Hit T+{o}
              </th>
            ))}
            {offsets.map((o) => (
              <th key={`m-${o}`} className={gridTh("center")}>
                MAE T+{o}
              </th>
            ))}
            <th className={gridTh("center")}>{it ? "Hit glob." : "Hit glob."}</th>
          </tr>
        </thead>
        <tbody>
          {models.map(([id, row]) => (
            <tr key={id} className="border-t border-[rgb(var(--border))]/30">
              <td className={`${gridTd("left")} font-semibold text-accent`}>{id}</td>
              {offsets.map((o) => {
                const h = row!.horizons.find((x) => x.offset === o);
                return (
                  <td key={`h-${id}-${o}`} className={gridTd("center")}>
                    {formatPct(h?.hitPct ?? null)}
                  </td>
                );
              })}
              {offsets.map((o) => {
                const h = row!.horizons.find((x) => x.offset === o);
                return (
                  <td key={`m-${id}-${o}`} className={`${gridTd("center")} text-ink-muted`}>
                    {formatPp(h?.mae ?? null)}
                  </td>
                );
              })}
              <td className={`${gridTd("center")} font-medium`}>{formatPct(row!.hitGlobal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniWeekTable({
  entries,
  it,
}: {
  entries: MonitorEntry[];
  it: boolean;
}) {
  const evolution = useMemo(() => buildWeeklyEvolution(entries), [entries]);
  const weeks = useMemo(() => [...evolution.weeks].reverse().slice(0, 3), [evolution.weeks]);
  if (weeks.length === 0) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 overflow-hidden">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-xs`}>
        <SheetGridColgroup columnCount={5} />
        <thead className="bg-surface-elevated/80">
          <tr className="text-[10px] uppercase text-ink-muted">
            <th className={gridTh("left")}>{it ? "Settimana" : "Week"}</th>
            <th className={gridTh("center")}>Acc. v4</th>
            <th className={gridTh("center")}>Δ Acc.</th>
            <th className={gridTh("center")}>Hit T+5</th>
            <th className={gridTh("center")}>MAE T+7</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr
              key={w.weekKey}
              className={`border-t border-[rgb(var(--border))]/30 ${i === 0 ? "bg-accent/5" : ""}`}
            >
              <td className={`${gridTd("left")} font-medium`}>{w.weekLabel}</td>
              <td className={gridTd("center")}>{formatPct(w.accV4Pct)}</td>
              <td className={`${gridTd("center")} text-ink-muted`}>
                {w.deltaAcc != null ? `${w.deltaAcc >= 0 ? "+" : ""}${w.deltaAcc.toFixed(1)}` : "—"}
              </td>
              <td className={gridTd("center")}>{formatPct(w.m2HitD5)}</td>
              <td className={gridTd("center")}>{formatPp(w.m2Mae7)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Weekly monitor chart, horizon table, run-monitor — no narrative/KPI duplicate. */
export type CurveEngineDiagnosticsProps = {
  monitorEntries: MonitorEntry[];
  monitorSource: string;
  monitorRunning: boolean;
  monitorRunMsg: string | null;
  onRunMonitor: () => void;
  summaryRows: TemporalModelRow[];
  trendVisual: ReturnType<typeof resolveLearningsTrendDisplay>;
  onOpenGuide?: () => void;
};

export function CurveEngineDiagnostics({
  monitorEntries,
  monitorSource,
  monitorRunning,
  monitorRunMsg,
  onRunMonitor,
  summaryRows,
  trendVisual,
  onOpenGuide,
}: CurveEngineDiagnosticsProps) {
  const { lang } = useLang();
  const it = lang === "it";
  const evolution = useMemo(() => buildWeeklyEvolution(monitorEntries), [monitorEntries]);
  const chartRows = useMemo(() => buildCurveEngineChartRows(evolution), [evolution]);
  const v4Row = useMemo(() => summaryRows.find((r) => r.model === "v4") ?? null, [summaryRows]);
  const v5Row = useMemo(() => summaryRows.find((r) => r.model === "v5") ?? null, [summaryRows]);

  return (
    <div className="space-y-4 pt-2 border-t border-[rgb(var(--border))]/40">
      <h3 className="text-sm font-semibold">
        {it ? "Diagnostica curve (v4/v5)" : "Curve diagnostics (v4/v5)"}
      </h3>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold text-ink-muted">
            {it ? "Trend settimanale monitor" : "Weekly monitor trend"}
          </h4>
          <button
            type="button"
            className="btn-primary text-xs shrink-0 disabled:opacity-50"
            disabled={monitorRunning}
            onClick={onRunMonitor}
          >
            {monitorRunning ? (it ? "Test in corso…" : "Running test…") : it ? "Esegui monitor" : "Run monitor"}
          </button>
          {onOpenGuide ? (
            <button type="button" className="btn-ghost text-xs ml-auto" onClick={onOpenGuide}>
              {it ? "Guida metriche" : "Metrics guide"}
            </button>
          ) : null}
        </div>
        {monitorRunMsg ? (
          <p
            className={`text-[11px] ${
              monitorRunMsg.includes("failed") ? "text-negative" : "text-[rgb(var(--signal-up))]"
            }`}
          >
            {monitorRunMsg}
          </p>
        ) : null}
        {monitorSource ? <p className="text-[10px] text-ink-muted">{monitorSource}</p> : null}
        <EngineTrendChart rows={chartRows} visual={trendVisual} it={it} />
      </div>

      {(v4Row || v5Row) && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-ink-muted px-0.5">
            {it ? "Snapshot orizzonti (ultimo refresh)" : "Horizon snapshot (latest refresh)"}
          </h4>
          <HorizonSnapshot v4Row={v4Row} v5Row={v5Row} it={it} />
        </div>
      )}

      {monitorEntries.length > 0 && (
        <details className="rounded-lg border border-[rgb(var(--border))]/50 bg-white">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold select-none">
            {it ? "Ultime 3 settimane monitor" : "Last 3 monitor weeks"}
          </summary>
          <div className="border-t border-[rgb(var(--border))]/40 p-3">
            <MiniWeekTable entries={monitorEntries} it={it} />
          </div>
        </details>
      )}
    </div>
  );
}

export type CurveEnginePanelProps = {
  monitorEntries: MonitorEntry[];
  monitorSource: string;
  monitorError: string | null;
  monitorLoading: boolean;
  monitorRunning: boolean;
  monitorRunMsg: string | null;
  onRunMonitor: () => void;
  summaryRows: TemporalModelRow[];
  summaryError: string | null;
  summaryLoading: boolean;
  calibDoc: DirectionalCalibDoc | null;
  onOpenGuide?: () => void;
};

export function CurveEnginePanel({
  monitorEntries,
  monitorSource,
  monitorError,
  monitorLoading,
  monitorRunning,
  monitorRunMsg,
  onRunMonitor,
  summaryRows,
  summaryError,
  summaryLoading,
  calibDoc,
  onOpenGuide,
}: CurveEnginePanelProps) {
  const { lang } = useLang();
  const it = lang === "it";

  const narrative = useMemo(
    () =>
      buildCurveEngineNarrative({
        monitorEntries,
        summaryRows,
        calibDoc,
        lang: it ? "it" : "en",
      }),
    [monitorEntries, summaryRows, calibDoc, it],
  );

  const evolution = useMemo(() => buildWeeklyEvolution(monitorEntries), [monitorEntries]);
  const v4Row = useMemo(() => summaryRows.find((r) => r.model === "v4") ?? null, [summaryRows]);
  const cw = evolution.currentWeek;
  const trendVisual = useMemo(
    () =>
      resolveLearningsTrendDisplay(narrative.trend, {
        deltaPpLastMonitor: cw?.deltaAcc ?? null,
      }),
    [narrative.trend, cw?.deltaAcc],
  );
  const latestAcc = useMemo(() => {
    if (cw?.accV4Pct != null) return cw.accV4Pct;
    const last = [...monitorEntries].reverse().find((e) => !e.invalid && e.accV4Pct != null);
    return last?.accV4Pct ?? null;
  }, [cw, monitorEntries]);

  const loading = monitorLoading || summaryLoading;

  if (loading) {
    return (
      <p className="text-sm text-ink-muted py-8 text-center">
        {it ? "Caricamento curve engine…" : "Loading curve engine…"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {(monitorError || summaryError) && (
        <div className="rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-xs text-warn space-y-0.5">
          {monitorError ? <p>{monitorError}</p> : null}
          {summaryError ? <p>{summaryError}</p> : null}
        </div>
      )}

      <TrendNarrativeSummaryBox
        headline={narrative.headline}
        whatHappened={narrative.whatHappened}
        modelImpact={narrative.modelImpact}
        visual={trendVisual}
        it={it}
        impactHeading={it ? "Impatto sulle curve" : "Impact on curves"}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MetricPill
          label={it ? "Acc. v4" : "v4 acc."}
          value={fmtPct(latestAcc)}
          sub={cw?.deltaAcc != null ? `Δ ${cw.deltaAcc >= 0 ? "+" : ""}${cw.deltaAcc.toFixed(1)} pp` : undefined}
        />
        <MetricPill label="Hit% T+5" value={fmtPct(cw?.m2HitD5)} sub={it ? "settimana corrente" : "current week"} />
        <MetricPill label="MAE T+7" value={formatPp(cw?.m2Mae7 ?? null)} sub={it ? "settimana corrente" : "current week"} />
        <MetricPill
          label={it ? "Hit glob. v4" : "v4 global Hit"}
          value={fmtPct(v4Row?.hitGlobal ?? calibDoc?.useful_hit_pct ?? null)}
          sub={v4Row?.nRows != null ? `N=${v4Row.nRows}` : undefined}
        />
      </div>

      <CurveEngineDiagnostics
        monitorEntries={monitorEntries}
        monitorSource={monitorSource}
        monitorRunning={monitorRunning}
        monitorRunMsg={monitorRunMsg}
        onRunMonitor={onRunMonitor}
        summaryRows={summaryRows}
        trendVisual={trendVisual}
        onOpenGuide={onOpenGuide}
      />
    </div>
  );
}
