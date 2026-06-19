import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LearningAuditLog, LearningWeeklyMetric } from "../api/learningBus";
import { useLang } from "../shared/i18n";

const KIND_TONE: Record<string, string> = {
  info: "text-sky-700 dark:text-sky-300",
  cycle: "text-indigo-700 dark:text-indigo-300",
  apply: "text-emerald-700 dark:text-emerald-300",
  reset: "text-rose-700 dark:text-rose-300",
  snapshot: "text-amber-700 dark:text-amber-300",
  learning: "text-violet-700 dark:text-violet-300",
  error: "text-rose-700 dark:text-rose-300",
};

function WeeklyMaeChart({ rows, it }: { rows: LearningWeeklyMetric[]; it: boolean }) {
  const data = rows.map((w) => ({
    week: w.week_label ?? String(w.week ?? "").slice(5),
    baseline: w.mae_baseline ?? null,
    withAll: w.mae_with_all ?? null,
    afterCluster: w.mae_after_cluster ?? null,
    afterRegime: w.mae_after_regime ?? null,
  }));
  if (data.length < 2) {
    return (
      <p className="text-[11px] text-ink-muted py-4 text-center">
        {it ? "Servono almeno 2 settimane con n≥15 per il trend MAE." : "Need at least 2 weeks with n≥15 for MAE trend."}
      </p>
    );
  }
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
          <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9 }} unit="%" width={36} />
          <Tooltip contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="baseline" name="Baseline" stroke="#94a3b8" strokeDasharray="4 4" dot={false} connectNulls />
          <Line type="monotone" dataKey="withAll" name={it ? "Tutti i meccanismi" : "All mechanisms"} stroke="#6366f1" dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="afterCluster" name={it ? "Dopo cluster" : "After cluster"} stroke="#22c55e" dot={false} connectNulls />
          <Line type="monotone" dataKey="afterRegime" name={it ? "Dopo regime" : "After regime"} stroke="#f59e0b" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeeklyDirChart({ rows, it }: { rows: LearningWeeklyMetric[]; it: boolean }) {
  const data = rows.map((w) => ({
    week: w.week_label ?? String(w.week ?? "").slice(5),
    withAll: w.dir_with_all != null ? Number(w.dir_with_all) * 100 : null,
    afterCluster: w.dir_after_cluster != null ? Number(w.dir_after_cluster) * 100 : null,
    afterRegime: w.dir_after_regime != null ? Number(w.dir_after_regime) * 100 : null,
  }));
  if (data.length < 2) return null;
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
          <XAxis dataKey="week" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9 }} unit="%" domain={[40, 75]} width={36} />
          <ReferenceLine y={50} stroke="rgb(var(--warn))" strokeDasharray="2 4" />
          <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="withAll" name={it ? "Dir · tutti" : "Dir · all"} stroke="#6366f1" dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="afterCluster" name={it ? "Dir · cluster" : "Dir · cluster"} stroke="#22c55e" dot={false} connectNulls />
          <Line type="monotone" dataKey="afterRegime" name={it ? "Dir · regime" : "Dir · regime"} stroke="#f59e0b" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTs(ts: string, it: boolean): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  return new Date(t).toLocaleString(it ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LearningLabAuditLogPanel({
  data,
  loading,
  error,
}: {
  data: LearningAuditLog | null;
  loading?: boolean;
  error?: string | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const logOnly = useMemo(
    () => (data?.entries ?? []).filter((e) => e.source === "learning_log" || e.kind === "apply" || e.kind === "cycle"),
    [data?.entries],
  );

  const weekly = data?.weekly_metrics ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/30 p-3 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-ink">
            {it ? "Trend settimanale (audit cross-loop)" : "Weekly trend (cross-loop audit)"}
          </h4>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it
              ? "Snapshot da learning_history.json — stesse curve del tab Calibrazione, vista audit."
              : "Snapshots from learning_history.json — same curves as Model tab, audit view."}
          </p>
        </div>
        {loading && !data ? (
          <p className="text-[11px] text-ink-muted py-4 text-center">{it ? "Caricamento…" : "Loading…"}</p>
        ) : error ? (
          <p className="text-[11px] text-negative">{error}</p>
        ) : (
          <>
            <WeeklyMaeChart rows={weekly} it={it} />
            <WeeklyDirChart rows={weekly} it={it} />
          </>
        )}
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/30 p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-ink">
            {it ? "Log eventi learning" : "Learning event log"}
          </h4>
          {data?.counts ? (
            <span className="text-[10px] text-ink-muted tabular-nums">
              {data.counts.audit_entries} {it ? "eventi" : "events"}
            </span>
          ) : null}
        </div>
        {!logOnly.length && !loading ? (
          <p className="text-[11px] text-ink-muted py-3">
            {it ? "Nessun evento nel learning_log.json." : "No events in learning_log.json."}
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {(data?.entries ?? []).slice(0, 80).map((e) => (
              <li
                key={e.id}
                className="flex gap-2 text-[11px] border-b border-[rgb(var(--border))]/25 pb-1.5 last:border-0"
              >
                <span className="shrink-0 text-[10px] text-ink-muted tabular-nums w-[108px]">
                  {formatTs(e.ts, it)}
                </span>
                <span className={`shrink-0 text-[9px] uppercase font-semibold w-14 ${KIND_TONE[e.kind] ?? "text-ink-muted"}`}>
                  {e.kind}
                </span>
                <span className="text-ink min-w-0 flex-1 leading-snug">{e.message}</span>
                <span className="shrink-0 text-[9px] text-ink-muted/70">{e.source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Mini sparkline for loop detail modal — global CF over weeks. */
export function LoopWeeklyMetricSparkline({
  weekly,
  dataKey,
  label,
  scale = 1,
}: {
  weekly: LearningWeeklyMetric[];
  dataKey: keyof LearningWeeklyMetric;
  label: string;
  scale?: number;
}) {
  const rows = weekly
    .map((w) => {
      const raw = w[dataKey];
      const v = typeof raw === "number" ? raw * scale : null;
      return {
        week: w.week_label ?? String(w.week ?? "").slice(5),
        value: v,
      };
    })
    .filter((r) => r.value != null);
  if (rows.length < 2) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-ink-muted">{label}</p>
      <div className="h-[100px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="week" tick={{ fontSize: 8 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 8 }} width={28} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={1.5} dot={{ r: 2 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
