import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { rebuildSignalCalibration, type SignalCalibrationRebuildResult } from "../api/supernova";
import { useT } from "../shared/i18n";

export type SignalCalibrationSnippet = {
  generated_at?: string;
  log_rows?: number;
  closed_rows?: number;
  pending_outcomes?: number;
  useful_hit_pct?: number | null;
  useful_n?: number | null;
  weekly_actionable?: { week_key?: string; hit_pct?: number | null; n?: number | null }[];
  cohorts?: Record<string, { hit_pct?: number | null; n?: number | null }>;
};

function snippetFromRebuild(res: SignalCalibrationRebuildResult): SignalCalibrationSnippet {
  const useful = res.cohorts?.useful;
  return {
    generated_at: res.generated_at,
    log_rows: res.log_rows,
    closed_rows: res.closed_rows,
    pending_outcomes: res.pending_outcomes,
    useful_hit_pct: res.useful_hit_pct ?? useful?.hit_pct ?? null,
    useful_n: res.useful_n ?? useful?.n ?? null,
    weekly_actionable: res.weekly_actionable,
    cohorts: res.cohorts,
  };
}

function hasDisplayableData(data: SignalCalibrationSnippet | null | undefined): boolean {
  if (!data) return false;
  if ((data.useful_n ?? 0) > 0) return true;
  if ((data.closed_rows ?? 0) > 0) return true;
  return (data.weekly_actionable?.length ?? 0) > 0;
}

export function SignalCalibrationLearningSection({
  data,
  active = true,
  onReload,
}: {
  data: SignalCalibrationSnippet | null | undefined;
  active?: boolean;
  onReload?: () => void | Promise<void>;
}) {
  const t = useT();
  const [live, setLive] = useState<SignalCalibrationSnippet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastClosed, setLastClosed] = useState<number | null>(null);

  const display = live ?? data;
  const weekly = display?.weekly_actionable ?? [];
  const MIN_SIGNAL_WEEK_N = 5;
  const trend = weekly
    .filter((w) => Number(w.n ?? 0) >= MIN_SIGNAL_WEEK_N)
    .map((w) => ({
      week: String(w.week_key ?? "").slice(5),
      hit: w.hit_pct ?? null,
      n: w.n ?? 0,
    }));
  const lowSampleWeeks = weekly.filter((w) => Number(w.n ?? 0) > 0 && Number(w.n ?? 0) < MIN_SIGNAL_WEEK_N);
  const lowSampleHit = (display?.useful_n ?? 0) > 0 && (display?.useful_n ?? 0) < 10;

  const runRebuild = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rebuildSignalCalibration();
      if (!res.ok) {
        setError(res.error ?? "Rebuild failed");
        return;
      }
      setLastClosed(res.closed ?? null);
      setLive(snippetFromRebuild(res));
      await onReload?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onReload]);

  useEffect(() => {
    if (!active) return;
    if (hasDisplayableData(data)) return;
    void runRebuild();
  }, [active, data, runRebuild]);

  const generatedLabel = useMemo(() => {
    if (!display?.generated_at) return null;
    try {
      return new Date(display.generated_at).toLocaleString();
    } catch {
      return display.generated_at;
    }
  }, [display?.generated_at]);

  if (!hasDisplayableData(display) && loading) {
    return <p className="text-[11px] text-ink-muted py-4">{t("learningLab.signals.rebuilding")}</p>;
  }

  if (!hasDisplayableData(display) && !loading) {
    return (
      <div className="space-y-3 py-4">
        <p className="text-[11px] text-ink-muted leading-relaxed">{t("learningLab.signals.empty")}</p>
        {(data?.log_rows ?? 0) > 0 ? (
          <p className="text-[10px] text-ink-muted">
            {t("learningLab.signals.pendingNote", {
              log: data?.log_rows ?? 0,
              pending: data?.pending_outcomes ?? 0,
            })}
          </p>
        ) : null}
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
        <button type="button" className="btn-ghost text-xs" disabled={loading} onClick={() => void runRebuild()}>
          {t("learningLab.signals.rebuild")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1 flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink">{t("learningLab.signals.introTitle")}</p>
          <p className="text-[11px] leading-relaxed text-ink-muted">{t("learningLab.signals.introBody")}</p>
        </div>
        <button type="button" className="btn-ghost text-xs shrink-0" disabled={loading} onClick={() => void runRebuild()}>
          {loading ? t("learningLab.signals.rebuilding") : t("learningLab.signals.rebuild")}
        </button>
      </div>

      {generatedLabel ? (
        <p className="text-[10px] text-ink-muted">
          {t("learningLab.signals.updatedAt", { at: generatedLabel })}
          {lastClosed != null ? ` · ${t("learningLab.signals.closedCount", { n: lastClosed })}` : ""}
        </p>
      ) : null}

      {error ? <p className="text-[11px] text-negative">{error}</p> : null}

      {lowSampleHit ? (
        <p className="text-[10px] text-[rgb(var(--warn))] bg-[rgb(var(--warn))]/10 border border-[rgb(var(--warn))]/25 rounded-md px-2.5 py-1.5">
          {t("learningLab.signals.lowSampleWarning", { n: display?.useful_n ?? 0 })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.signals.kpiHit")}</p>
          <p className="font-semibold tabular-nums text-ink">
            {display?.useful_hit_pct != null ? `${display.useful_hit_pct.toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.signals.kpiN")}</p>
          <p className="font-semibold tabular-nums text-ink">{display?.useful_n ?? 0}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.signals.kpiWeeks")}</p>
          <p className="font-semibold tabular-nums text-ink">{trend.length}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.signals.kpiPending")}</p>
          <p className="font-semibold tabular-nums text-ink">{display?.pending_outcomes ?? 0}</p>
        </div>
      </div>

      {trend.length >= 2 ? (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("learningLab.signals.trendTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("learningLab.signals.trendSubtitle")}</p>
          </div>
          <div style={{ height: 200 }} className="w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                <YAxis domain={[40, 80]} tick={{ fontSize: 9 }} unit="%" />
                <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 3" />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Line type="monotone" dataKey="hit" stroke="#6366f1" dot={{ r: 2 }} name={t("learningLab.signals.trendLine")} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-ink-muted">
          {lowSampleWeeks.length > 0
            ? t("learningLab.signals.trendLowSample", { n: lowSampleWeeks.length })
            : t("learningLab.signals.trendNeedMore")}
        </p>
      )}
    </div>
  );
}
