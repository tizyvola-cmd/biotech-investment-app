import { useMemo, useState } from "react";
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
import type { ModelStretchView, RecalibScheduleItem } from "../sheet/modelStretchView";
import { stretchVerdictTone } from "../sheet/modelStretchView";
import { useLang, useT, type TranslationKey } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

type OutcomeMode = "price" | "sign";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtFactor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(4);
}

function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function fmtStretchPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function scheduleKindLabel(
  kind: RecalibScheduleItem["kind"],
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  switch (kind) {
    case "completed":
      return t("modelLab.qc.modelStretch.scheduleCompleted");
    case "current":
      return t("modelLab.qc.modelStretch.scheduleCurrent");
    case "next":
      return t("modelLab.qc.modelStretch.scheduleNext");
    default:
      return t("modelLab.qc.modelStretch.schedulePlanned");
  }
}

function scheduleRelativeDays(
  days: number | null,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
): string {
  if (days == null) return "";
  if (days === 0) return t("modelLab.qc.modelStretch.scheduleToday");
  if (days > 0) return t("modelLab.qc.modelStretch.scheduleInDays", { days });
  return t("modelLab.qc.modelStretch.scheduleDaysAgo", { days: Math.abs(days) });
}

function RecalibScheduleTimeline({
  schedule,
  refreshDays,
  t,
}: {
  schedule: RecalibScheduleItem[];
  refreshDays: number;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  if (!schedule.length) return null;

  return (
    <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/30 px-2.5 py-2 space-y-2">
      <div>
        <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.modelStretch.scheduleTitle")}</p>
        <p className="text-[9px] text-ink-muted leading-snug mt-0.5">
          {t("modelLab.qc.modelStretch.scheduleCaption", { days: refreshDays })}
        </p>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {schedule.map((slot) => {
          const isFuture = slot.kind === "next" || slot.kind === "planned";
          const dotCls =
            slot.kind === "current"
              ? "bg-[#ea580c] ring-2 ring-[#ea580c]/30"
              : slot.kind === "next"
                ? "bg-amber-400 ring-2 ring-amber-300/50"
                : isFuture
                  ? "bg-transparent border-2 border-dashed border-slate-300"
                  : "bg-slate-400";
          return (
            <div
              key={`${slot.kind}-${slot.dateIso}`}
              className={`flex items-start gap-1.5 min-w-[108px] text-[9px] ${
                slot.kind === "next" ? "rounded-md bg-amber-50/80 px-1.5 py-1 border border-amber-200/60" : ""
              }`}
            >
              <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotCls}`} aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold text-ink tabular-nums">{slot.label}</p>
                <p className="text-ink-muted">{scheduleKindLabel(slot.kind, t)}</p>
                {slot.calFactor != null ? (
                  <p className="tabular-nums text-ink">
                    ×{slot.calFactor.toFixed(2)}
                    {slot.stretchPctFromNeutral != null ? (
                      <span className="text-ink-muted ml-1">
                        ({fmtStretchPct(slot.stretchPctFromNeutral)})
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-ink-muted italic">cal_factor TBD</p>
                )}
                {slot.daysFromNow != null ? (
                  <p className="text-ink-muted">{scheduleRelativeDays(slot.daysFromNow, t)}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ModelStretchPanel({ view }: { view: ModelStretchView | null }) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [mode, setMode] = useState<OutcomeMode>("price");

  const outcomeChart = useMemo(() => {
    if (!view?.outcomePoints.length) return [];
    return view.outcomePoints.map((p) => ({
      label: p.label,
      before: mode === "price" ? p.beforePrice : p.beforeSign,
      after: mode === "price" ? p.afterPrice : p.afterSign,
    }));
  }, [view?.outcomePoints, mode]);

  const historyChart = useMemo(() => {
    if (!view) return [];
    const labels = new Set<string>();
    for (const h of view.history) labels.add(h.label);
    for (const s of view.recalibSchedule) {
      if (s.kind === "next" || s.kind === "planned") labels.add(s.label);
    }
    const sorted = [...labels].sort();
    const byLabel = new Map(view.history.map((h) => [h.label, h.calFactor]));
    return sorted.map((label) => ({
      label: label.slice(5),
      fullLabel: label,
      calFactor: byLabel.get(label) ?? null,
      isPlanned: !byLabel.has(label),
    }));
  }, [view]);

  const yDomain = useMemo(() => {
    const vals = view?.history.map((h) => h.calFactor) ?? [];
    if (!vals.length) return [0.5, 1.5] as [number, number];
    const lo = Math.min(...vals, 1);
    const hi = Math.max(...vals, 1);
    const pad = Math.max(0.08, (hi - lo) * 0.15);
    return [Math.floor((lo - pad) * 100) / 100, Math.ceil((hi + pad) * 100) / 100] as [number, number];
  }, [view?.history]);

  if (!view) return null;

  const verdictCls = stretchVerdictTone(view.verdict);
  const verdictLabel = (() => {
    switch (view.verdict) {
      case "improved":
        return t("modelLab.qc.modelStretch.verdict.improved");
      case "worse":
        return t("modelLab.qc.modelStretch.verdict.worse");
      case "neutral":
        return t("modelLab.qc.modelStretch.verdict.neutral");
      default:
        return t("modelLab.qc.modelStretch.verdict.unknown");
    }
  })();

  const hasOutcome = view.hasOutcomeChart && outcomeChart.some((r) => r.before != null || r.after != null);
  const hasHistory = view.history.length >= 1;

  const hasStretch =
    view.stretchFactor != null || hasOutcome || hasHistory || view.recalibSchedule.length > 0;

  if (!hasStretch) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.modelStretch.title")}
          </p>
          <p className="text-sm font-semibold text-ink leading-snug">
            {t("modelLab.qc.modelStretch.lead")}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-prose">
            {t("modelLab.qc.modelStretch.body")}
          </p>
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          <p className={`text-xs font-semibold ${verdictCls}`}>{verdictLabel}</p>
          <p className="text-lg font-semibold tabular-nums text-ink">
            {fmtFactor(view.stretchFactor)}
            {view.stretchPctFromNeutral != null ? (
              <span className="text-[11px] font-normal text-ink-muted ml-1">
                ({fmtStretchPct(view.stretchPctFromNeutral)} {it ? "vs neutro" : "vs neutral"})
              </span>
            ) : null}
          </p>
          {view.stretchDelta != null ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              {t("modelLab.qc.kpi.sub.calFactorDelta", { delta: fmtFactor(view.stretchDelta) })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
          <p className="text-ink-muted uppercase tracking-wide truncate">
            {t("modelLab.qc.modelStretch.priceBefore")}
          </p>
          <p className="font-semibold tabular-nums">{fmtPct(view.priceAccBefore)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
          <p className="text-ink-muted uppercase tracking-wide truncate">
            {t("modelLab.qc.modelStretch.priceAfter")}
          </p>
          <p className="font-semibold tabular-nums">{fmtPct(view.priceAccAfter)}</p>
          <p className={`text-[9px] tabular-nums ${verdictCls}`}>{fmtPp(view.priceAccDeltaPp)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
          <p className="text-ink-muted uppercase tracking-wide truncate">
            {t("modelLab.qc.modelStretch.signBefore")}
          </p>
          <p className="font-semibold tabular-nums">{fmtPct(view.signHitBefore)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
          <p className="text-ink-muted uppercase tracking-wide truncate">
            {t("modelLab.qc.modelStretch.signAfter")}
          </p>
          <p className="font-semibold tabular-nums">{fmtPct(view.signHitAfter)}</p>
          <p className={`text-[9px] tabular-nums ${verdictCls}`}>{fmtPp(view.signHitDeltaPp)}</p>
        </div>
      </div>

      {hasOutcome ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-medium text-ink flex-1">
              {t("modelLab.qc.modelStretch.outcomeChartTitle")}
            </p>
            <div className="flex gap-1 shrink-0">
              {(["price", "sign"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`text-[10px] px-2 py-0.5 rounded border ${
                    mode === m
                      ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-accent font-semibold"
                      : "border-[rgb(var(--border))]/50 text-ink-muted"
                  }`}
                  onClick={() => setMode(m)}
                >
                  {t(m === "price" ? "modelLab.qc.modelStretch.modePrice" : "modelLab.qc.modelStretch.modeSign")}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[9px] text-ink-muted">{t("modelLab.qc.modelStretch.outcomeChartCaption")}</p>
          <div className="h-[150px] w-full">
            <ViewErrorBoundary label="Model stretch outcome">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={outcomeChart} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" height={28} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 9 }} unit="%" width={36} />
                  <Tooltip
                    formatter={(v: number) => fmtPct(v)}
                    labelFormatter={(l) => `${it ? "Giorni alla CD" : "Days to CD"}: ${l}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  <Line
                    type="monotone"
                    dataKey="before"
                    name={t("modelLab.qc.modelStretch.lineBefore")}
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={{ r: 2, fill: "#94a3b8" }}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="after"
                    name={t("modelLab.qc.modelStretch.lineAfter")}
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={{ r: 2, fill: "#2563eb" }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ViewErrorBoundary>
          </div>
        </div>
      ) : null}

      {hasHistory ? (
        <div className="space-y-2">
          <div>
            <p className="text-[10px] font-medium text-ink">{t("modelLab.qc.modelStretch.historyTitle")}</p>
            <p className="text-[10px] text-ink/90 leading-snug mt-0.5">
              {t("modelLab.qc.modelStretch.historyLead")}
            </p>
            <p className="text-[9px] text-ink-muted leading-snug mt-0.5">
              {t("modelLab.qc.modelStretch.historyCaption")}
            </p>
          </div>
          <div className="h-[130px] w-full">
            <ViewErrorBoundary label="Model stretch history">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={historyChart} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                  <XAxis
                    dataKey="label"
                    tick={({ x, y, payload }) => {
                      const row = historyChart.find((d) => d.label === payload.value);
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            x={0}
                            y={0}
                            dy={10}
                            textAnchor="middle"
                            fill={row?.isPlanned ? "#94a3b8" : "#64748b"}
                            fontSize={8}
                            fontStyle={row?.isPlanned ? "italic" : "normal"}
                          >
                            {payload.value}
                          </text>
                        </g>
                      );
                    }}
                    interval="preserveStartEnd"
                    height={28}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 9 }}
                    width={44}
                    tickFormatter={(v) => `×${Number(v).toFixed(2)}`}
                    label={{
                      value: t("modelLab.qc.modelStretch.yAxisLabel"),
                      angle: -90,
                      position: "insideLeft",
                      offset: 8,
                      style: { fontSize: 9, fill: "#64748b" },
                    }}
                  />
                  <ReferenceLine
                    y={1}
                    stroke="#64748b"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    label={{
                      value: t("modelLab.qc.modelStretch.neutralLine"),
                      position: "insideTopRight",
                      fill: "#64748b",
                      fontSize: 9,
                    }}
                  />
                  {view.recalibSchedule
                    .filter((s) => s.kind === "next")
                    .map((s) => (
                      <ReferenceLine
                        key={s.dateIso}
                        x={s.label.slice(5)}
                        stroke="#f59e0b"
                        strokeDasharray="3 3"
                        strokeWidth={1}
                      />
                    ))}
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const row = payload[0].payload as (typeof historyChart)[0];
                      if (row.calFactor == null) {
                        return (
                          <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                            <p className="font-semibold">{row.fullLabel ?? row.label}</p>
                            <p className="text-ink-muted">
                              {t("modelLab.qc.modelStretch.scheduleNext")} — cal_factor TBD
                            </p>
                          </div>
                        );
                      }
                      const pct = Math.round((row.calFactor - 1) * 1000) / 10;
                      const dir =
                        pct < 0
                          ? t("modelLab.qc.modelStretch.tooltipCompressed")
                          : pct > 0
                            ? t("modelLab.qc.modelStretch.tooltipElongated")
                            : it
                              ? "neutro"
                              : "neutral";
                      return (
                        <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                          <p className="font-semibold">{row.fullLabel ?? row.label}</p>
                          <p>
                            {t("modelLab.qc.modelStretch.tooltipFactor")}: ×{row.calFactor.toFixed(4)}
                          </p>
                          <p>
                            {t("modelLab.qc.modelStretch.tooltipStretch", { pct: fmtStretchPct(pct) })} · {dir}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  <Line
                    type="monotone"
                    dataKey="calFactor"
                    name={t("modelLab.qc.modelStretch.lineCalFactor")}
                    stroke="#ea580c"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props as {
                        cx?: number;
                        cy?: number;
                        payload?: (typeof historyChart)[0];
                      };
                      if (payload?.calFactor == null || cx == null || cy == null) {
                        return <circle cx={cx ?? 0} cy={cy ?? 0} r={0} fill="transparent" />;
                      }
                      return <circle cx={cx} cy={cy} r={3} fill="#ea580c" stroke="#fff" strokeWidth={1} />;
                    }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ViewErrorBoundary>
          </div>
          <RecalibScheduleTimeline
            schedule={view.recalibSchedule}
            refreshDays={view.calibRefreshDays}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
