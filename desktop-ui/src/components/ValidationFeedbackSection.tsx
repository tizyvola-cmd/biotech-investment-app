import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  applyFeedbackLoop,
  previewFeedbackLoop,
  type FeedbackLoopCalChange,
  type FeedbackLoopSummary,
} from "../api/supernova";
import { useT } from "../shared/i18n";

export type ValidationFeedbackOverview = {
  summary?: FeedbackLoopSummary | null;
  history?: { run_at?: string; summary?: FeedbackLoopSummary | null }[];
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtMae(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)} pp`;
}

function hasDisplayableSummary(summary: FeedbackLoopSummary | null | undefined): boolean {
  if (!summary) return false;
  if ((summary.n_tickers ?? 0) > 0) return true;
  return summary.portfolio_avg_mae != null || summary.portfolio_direction_acc != null;
}

export function ValidationFeedbackSection({
  data,
  active = true,
  onReload,
}: {
  data: ValidationFeedbackOverview | null | undefined;
  active?: boolean;
  onReload?: () => void | Promise<void>;
}) {
  const t = useT();
  const savedSummary = data?.summary;
  const history = data?.history ?? [];
  const hasSaved = hasDisplayableSummary(savedSummary);

  const [previewSummary, setPreviewSummary] = useState<FeedbackLoopSummary | null>(null);
  const [previewChanges, setPreviewChanges] = useState<FeedbackLoopCalChange[]>([]);
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await previewFeedbackLoop();
      if (!res.ok) {
        setError(res.error ?? "Preview failed");
        return;
      }
      setPreviewSummary(res.summary ?? null);
      setPreviewChanges(res.cal_factor_changes ?? res.summary?.cal_factor_changes ?? []);
      setPreviewAt(res.run_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    if (hasSaved) return;
    void loadPreview();
  }, [active, hasSaved, loadPreview]);

  const summary = hasSaved ? savedSummary : previewSummary;
  const isPreviewOnly = !hasSaved && hasDisplayableSummary(previewSummary);

  const trend = history
    .map((h) => ({
      week: String(h.run_at ?? "").slice(5, 10),
      mae: h.summary?.portfolio_avg_mae ?? null,
      dir: h.summary?.portfolio_direction_acc != null ? h.summary.portfolio_direction_acc * 100 : null,
    }))
    .filter((r) => r.mae != null || r.dir != null);

  const confirmApply = async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await applyFeedbackLoop();
      if (!res.ok) {
        setError(res.error ?? "Apply failed");
        return;
      }
      setApplyOpen(false);
      setPreviewSummary(null);
      await onReload?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const previewLabel = useMemo(() => {
    if (!previewAt) return null;
    try {
      return new Date(previewAt).toLocaleString();
    } catch {
      return previewAt;
    }
  }, [previewAt]);

  if (!hasDisplayableSummary(summary) && !loading) {
    return (
      <div className="space-y-3 py-4">
        <p className="text-[11px] text-ink-muted leading-relaxed">{t("learningLab.feedback.empty")}</p>
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
        <button type="button" className="btn-ghost text-xs" disabled={loading} onClick={() => void loadPreview()}>
          {t("modelHealth.runPreview")}
        </button>
      </div>
    );
  }

  if (loading && !hasDisplayableSummary(summary)) {
    return <p className="text-[11px] text-ink-muted py-4">{t("modelHealth.running")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1 flex-1 min-w-0">
          <p className="text-[11px] font-medium text-ink">{t("learningLab.feedback.introTitle")}</p>
          <p className="text-[11px] leading-relaxed text-ink-muted">{t("learningLab.feedback.introBody")}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {isPreviewOnly ? (
            <span className="rounded-md border border-amber-200/80 bg-amber-50/80 px-2 py-1 text-[10px] text-amber-800">
              {t("learningLab.feedback.previewBadge")}
            </span>
          ) : null}
          <button type="button" className="btn-ghost text-xs" disabled={loading || applying} onClick={() => void loadPreview()}>
            {loading ? t("modelHealth.running") : t("modelHealth.runPreview")}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={loading || applying}
            onClick={async () => {
              if (!previewChanges.length) await loadPreview();
              setApplyOpen(true);
            }}
          >
            {t("modelHealth.applyConfirm")}
          </button>
        </div>
      </div>

      {isPreviewOnly && previewLabel ? (
        <p className="text-[10px] text-ink-muted">{t("learningLab.feedback.previewAt", { at: previewLabel })}</p>
      ) : null}

      {error ? <p className="text-[11px] text-negative">{error}</p> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.feedback.kpiMae")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtMae(summary?.portfolio_avg_mae)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.feedback.kpiDir")}</p>
          <p className="font-semibold tabular-nums text-ink">{fmtPct(summary?.portfolio_direction_acc)}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.feedback.kpiUnder")}</p>
          <p className="font-semibold tabular-nums text-red-600 dark:text-red-400">{summary?.underperformers?.length ?? 0}</p>
        </div>
        <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
          <p className="text-ink-muted">{t("learningLab.feedback.kpiTickers")}</p>
          <p className="font-semibold tabular-nums text-ink">{summary?.n_tickers ?? 0}</p>
        </div>
      </div>

      {trend.length >= 2 ? (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-surface/20 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t("learningLab.feedback.trendTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("learningLab.feedback.trendSubtitle")}</p>
          </div>
          <div style={{ height: 200 }} className="w-full min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="mae" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="dir" orientation="right" domain={[40, 80]} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v: number, name: string) => (name === "dir" ? `${v.toFixed(1)}%` : `${v.toFixed(2)} pp`)} />
                <Line yAxisId="mae" type="monotone" dataKey="mae" stroke="#6366f1" dot={false} name="MAE" />
                <Line yAxisId="dir" type="monotone" dataKey="dir" stroke="#22c55e" dot={false} name="dir" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : isPreviewOnly ? (
        <p className="text-[10px] text-ink-muted leading-relaxed">{t("learningLab.feedback.noHistoryYet")}</p>
      ) : null}

      {(summary?.underperformers?.length ?? 0) > 0 ? (
        <p className="text-[10px] text-ink-muted">
          {t("learningLab.feedback.underList")}: {summary?.underperformers?.slice(0, 8).join(", ")}
        </p>
      ) : null}

      {previewChanges.length > 0 ? (
        <details className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2">
          <summary className="text-[10px] font-semibold cursor-pointer">
            {t("modelHealth.recentCal")} ({previewChanges.length})
          </summary>
          <ul className="mt-2 max-h-40 overflow-y-auto text-[10px] font-mono space-y-0.5">
            {previewChanges.slice(0, 24).map((c) => (
              <li key={c.ticker}>
                {c.ticker}: {c.old_cal.toFixed(3)} → {c.new_cal.toFixed(3)}
              </li>
            ))}
            {previewChanges.length > 24 ? (
              <li className="text-ink-muted">+{previewChanges.length - 24} …</li>
            ) : null}
          </ul>
        </details>
      ) : null}

      {applyOpen ? (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-xl border border-[rgb(var(--border))] shadow-xl max-w-lg w-full p-4 space-y-3">
            <h4 className="text-sm font-semibold">{t("modelHealth.previewTitle")}</h4>
            <p className="text-[10px] text-ink-muted">{t("modelHealth.previewHint")}</p>
            {previewChanges.length === 0 ? (
              <p className="text-[11px] text-ink-muted">{t("modelHealth.previewEmpty")}</p>
            ) : (
              <ul className="text-[10px] max-h-48 overflow-y-auto font-mono space-y-0.5">
                {previewChanges.slice(0, 20).map((c) => (
                  <li key={c.ticker}>
                    {c.ticker}: {c.old_cal.toFixed(3)} → {c.new_cal.toFixed(3)} — {c.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" disabled={applying} onClick={() => setApplyOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary text-xs" disabled={applying} onClick={() => void confirmApply()}>
                {applying ? t("modelHealth.running") : t("modelHealth.applyConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
