import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ADVICE_LEARNING_HISTORY_CHANGED_EVENT,
  clearAdviceLearningHistory,
  loadAdviceLearningHistory,
  type AdviceLearningSnapshot,
} from "../sheet/adviceLearningHistory";
import { useT } from "../shared/i18n";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";

type ChartPoint = AdviceLearningSnapshot & {
  idx: number;
  label: string;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function dayLabel(day: string): string {
  // YYYY-MM-DD → DD MMM
  if (!day || day.length < 10) return day;
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
}

function trendDeltaPp(snaps: AdviceLearningSnapshot[], field: keyof AdviceLearningSnapshot): number | null {
  const valid = snaps
    .map((s) => Number(s[field]))
    .filter((v) => Number.isFinite(v));
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  return Math.round((last - first) * 10) / 10;
}

function TooltipBox({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5 dark:bg-slate-900 dark:border-slate-700">
      <p className="font-semibold">
        {row.label}
        {row.manual ? (
          <span className="ml-1 text-[8px] uppercase tracking-wide text-indigo-600">
            {it ? "checkpoint manuale" : "manual checkpoint"}
          </span>
        ) : null}
      </p>
      <p>
        <span className="text-ink-muted">{it ? "Successo complessivo:" : "Overall success:"}</span>{" "}
        <span className="font-semibold">{fmtPct(row.overallSuccessRatePct)}</span>
        <span className="text-ink-muted"> · n={row.scoredPoints}</span>
      </p>
      <p>
        <span className="text-ink-muted">{it ? "Bucket bassi (<60%):" : "Low buckets (<60%):"}</span>{" "}
        <span>{fmtPct(row.lowProbSuccessRatePct)}</span>
        <span className="text-ink-muted"> · n={row.lowProbScored}</span>
      </p>
      <p>
        <span className="text-ink-muted">{it ? "Bucket alti (≥70%):" : "High buckets (≥70%):"}</span>{" "}
        <span>{fmtPct(row.highProbSuccessRatePct)}</span>
        <span className="text-ink-muted"> · n={row.highProbScored}</span>
      </p>
      {row.unifiedAdviceSuccessPct != null ? (
        <p>
          <span className="text-ink-muted">{it ? "Direzione 24h:" : "24h direction:"}</span>{" "}
          <span>{fmtPct(row.unifiedAdviceSuccessPct)}</span>
        </p>
      ) : null}
      {row.bucketCorrectionsActive > 0 || row.actionDemotionsActive > 0 ? (
        <p className="text-indigo-700 dark:text-indigo-300 pt-0.5 border-t border-slate-100/80">
          {it ? "Correzioni attive:" : "Active corrections:"}{" "}
          <span className="font-semibold">
            {row.bucketCorrectionsActive} {it ? "bucket" : "bucket(s)"} ·{" "}
            {row.actionDemotionsActive} {it ? "azioni" : "actions"}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function AdviceLearningTimelinePanel({
  lang,
  className,
}: {
  lang: "it" | "en";
  className?: string;
}) {
  const t = useT();
  const it = lang === "it";
  const [history, setHistory] = useState(() => loadAdviceLearningHistory());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setHistory(loadAdviceLearningHistory());
    window.addEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
  }, []);

  const snaps = history.snapshots;
  const chartData = useMemo<ChartPoint[]>(
    () =>
      snaps.map((s, idx) => ({
        ...s,
        idx,
        label: dayLabel(s.day),
      })),
    [snaps],
  );

  const overallTrend = useMemo(() => trendDeltaPp(snaps, "overallSuccessRatePct"), [snaps]);
  const lowTrend = useMemo(() => trendDeltaPp(snaps, "lowProbSuccessRatePct"), [snaps]);
  const highTrend = useMemo(() => trendDeltaPp(snaps, "highProbSuccessRatePct"), [snaps]);

  const latest = snaps[snaps.length - 1] ?? null;
  const first = snaps[0] ?? null;

  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 100];
    const values: number[] = [];
    for (const p of chartData) {
      if (p.overallSuccessRatePct != null) values.push(p.overallSuccessRatePct);
      if (p.lowProbSuccessRatePct != null) values.push(p.lowProbSuccessRatePct);
      if (p.highProbSuccessRatePct != null) values.push(p.highProbSuccessRatePct);
      if (p.unifiedAdviceSuccessPct != null) values.push(p.unifiedAdviceSuccessPct);
    }
    if (values.length === 0) return [0, 100];
    const minV = Math.max(0, Math.floor(Math.min(...values) - 5));
    const maxV = Math.min(100, Math.ceil(Math.max(...values) + 5));
    if (maxV - minV < 30) return [Math.max(0, minV - 10), Math.min(100, maxV + 10)];
    return [minV, maxV];
  }, [chartData]);

  const manualCheckpoints = useMemo(
    () => chartData.filter((p) => p.manual && p.overallSuccessRatePct != null),
    [chartData],
  );

  const onResetClick = () => {
    if (typeof window === "undefined") return;
    const confirmed = window.confirm(
      it
        ? "Cancellare lo storico di apprendimento? L'azione non è reversibile."
        : "Clear the learning history? This cannot be undone.",
    );
    if (!confirmed) return;
    clearAdviceLearningHistory();
    setHistory(loadAdviceLearningHistory());
  };

  const hasEnoughData = chartData.length >= 2;

  return (
    <div
      className={
        className ??
        "rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 dark:bg-slate-900/40 p-4 space-y-3"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink">
            {t("adviceLearning.timeline.title")}
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug max-w-[680px]">
            {t("adviceLearning.timeline.lead")}
          </p>
          {latest?.ts ? (
            <DashboardPanelUpdatedLabel updatedAt={latest.ts} className="!text-[9px] mt-0.5" />
          ) : null}
        </div>
        {snaps.length > 0 ? (
          <button
            type="button"
            onClick={onResetClick}
            className="rounded-md border border-rose-200/70 bg-rose-50/70 px-2.5 py-1 text-[10px] font-medium text-rose-700 hover:bg-rose-100/70 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300 transition"
            title={it ? "Cancella lo storico (irreversibile)" : "Clear history (irreversible)"}
          >
            {t("adviceLearning.timeline.reset")}
          </button>
        ) : null}
      </div>

      {snaps.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-md border border-indigo-200/70 bg-indigo-50/70 px-2 py-1 tabular-nums dark:border-indigo-900/40 dark:bg-indigo-950/40">
            <span className="text-ink-muted">{it ? "Checkpoint:" : "Checkpoints:"}</span>{" "}
            <span className="font-semibold">{snaps.length}</span>
          </span>
          {first && latest ? (
            <span className="rounded-md border border-slate-200/70 bg-slate-50/70 px-2 py-1 tabular-nums dark:border-slate-700/60 dark:bg-slate-800/40">
              <span className="text-ink-muted">{it ? "Periodo:" : "Period:"}</span>{" "}
              <span className="font-semibold">
                {dayLabel(first.day)} → {dayLabel(latest.day)}
              </span>
            </span>
          ) : null}
          {overallTrend != null ? (
            <span
              className={`rounded-md border px-2 py-1 tabular-nums ${
                overallTrend >= 0
                  ? "border-emerald-300/70 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-rose-300/70 bg-rose-50/70 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
              title={
                it
                  ? "Variazione del success rate complessivo tra primo e ultimo checkpoint"
                  : "Change in overall success rate between first and last checkpoint"
              }
            >
              {it ? "Δ complessivo:" : "Δ overall:"}{" "}
              <span className="font-semibold">
                {overallTrend >= 0 ? "+" : ""}
                {overallTrend.toFixed(1)} pp
              </span>
            </span>
          ) : null}
          {lowTrend != null ? (
            <span
              className={`rounded-md border px-2 py-1 tabular-nums ${
                lowTrend >= 0
                  ? "border-emerald-300/70 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-rose-300/70 bg-rose-50/70 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
              title={
                it
                  ? "Variazione del success rate sui consigli a bassa P(plan) (<60%)"
                  : "Change in success rate for low-P(plan) advice (<60%)"
              }
            >
              {it ? "Δ bucket bassi:" : "Δ low buckets:"}{" "}
              <span className="font-semibold">
                {lowTrend >= 0 ? "+" : ""}
                {lowTrend.toFixed(1)} pp
              </span>
            </span>
          ) : null}
          {highTrend != null ? (
            <span
              className={`rounded-md border px-2 py-1 tabular-nums ${
                highTrend >= 0
                  ? "border-emerald-300/70 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-rose-300/70 bg-rose-50/70 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
              title={
                it
                  ? "Variazione del success rate sui consigli ad alta P(plan) (≥70%)"
                  : "Change in success rate for high-P(plan) advice (≥70%)"
              }
            >
              {it ? "Δ bucket alti:" : "Δ high buckets:"}{" "}
              <span className="font-semibold">
                {highTrend >= 0 ? "+" : ""}
                {highTrend.toFixed(1)} pp
              </span>
            </span>
          ) : null}
          {latest && (latest.bucketCorrectionsActive > 0 || latest.actionDemotionsActive > 0) ? (
            <span
              className="rounded-md border border-violet-300/70 bg-violet-50/70 px-2 py-1 tabular-nums text-violet-900 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-200"
              title={
                it
                  ? "Numero di correzioni e declassamenti attivi al checkpoint più recente"
                  : "Active corrections and demotions at the latest checkpoint"
              }
            >
              {it ? "Correzioni attive:" : "Active corrections:"}{" "}
              <span className="font-semibold">
                {latest.bucketCorrectionsActive} bucket · {latest.actionDemotionsActive}{" "}
                {it ? "azioni" : "actions"}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      {hasEnoughData ? (
        <div className="space-y-1">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.25)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={yDomain}
                tickFormatter={(v) => `${Math.round(Number(v))}%`}
                width={42}
              />
              <Tooltip content={<TooltipBox it={it} />} />
              <ReferenceLine y={50} stroke="rgba(148, 163, 184, 0.5)" strokeDasharray="4 4" />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconType="line"
              />
              <Line
                type="monotone"
                dataKey="overallSuccessRatePct"
                name={it ? "Successo complessivo" : "Overall success"}
                stroke="#4f46e5"
                strokeWidth={2.4}
                dot={{ r: 2.5, stroke: "#4f46e5", fill: "#4f46e5" }}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="lowProbSuccessRatePct"
                name={it ? "Bucket bassi (<60%)" : "Low buckets (<60%)"}
                stroke="#f59e0b"
                strokeWidth={1.6}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="highProbSuccessRatePct"
                name={it ? "Bucket alti (≥70%)" : "High buckets (≥70%)"}
                stroke="#10b981"
                strokeWidth={1.6}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="unifiedAdviceSuccessPct"
                name={it ? "Direzione 24h (KPI)" : "24h direction (KPI)"}
                stroke="#0ea5e9"
                strokeWidth={1.2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {manualCheckpoints.length > 0 ? (
                <Scatter
                  name={it ? "Apply learnings" : "Apply learnings"}
                  data={manualCheckpoints}
                  dataKey="overallSuccessRatePct"
                  fill="#a855f7"
                  shape="diamond"
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[9px] text-ink-muted leading-snug">
            {t("adviceLearning.timeline.legendHint")}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300/60 bg-slate-50/60 dark:border-slate-700/60 dark:bg-slate-800/40 p-4 text-[11px] text-ink-muted text-center">
          {snaps.length === 0
            ? t("adviceLearning.timeline.empty")
            : t("adviceLearning.timeline.notEnough")}
        </div>
      )}
    </div>
  );
}
