import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyFeedbackLoop,
  loadFeedbackSummary,
  loadTickerPerformance,
  previewFeedbackLoop,
  type FeedbackCalChange,
  type FeedbackSummary,
  type TickerPerformanceRow,
} from "../data/modelHealthData";
import { useT } from "../shared/i18n";
import { MODEL_TAB_INTRO_SECTION } from "./modelLabIntroStyles";

function maeTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  if (v > 4) return "text-red-400";
  if (v >= 2) return "text-amber-400";
  return "text-emerald-400";
}

function dirTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  if (v < 0.45) return "text-red-400";
  if (v <= 0.6) return "text-amber-400";
  return "text-emerald-400";
}

function flagBadge(flag: string | undefined, t: ReturnType<typeof useT>): ReactNode {
  if (!flag || flag === "ok") return null;
  const cls =
    flag === "underperformer"
      ? "bg-red-500/20 text-red-300"
      : flag === "strong_performer"
        ? "bg-emerald-500/20 text-emerald-300"
        : flag.includes("optimism") || flag.includes("pessimism")
          ? "bg-amber-500/20 text-amber-300"
          : flag === "direction_unreliable"
            ? "bg-zinc-500/25 text-zinc-300"
            : "bg-surface text-ink-muted";
  const label =
    flag === "underperformer"
      ? t("modelHealth.flag.underperformer")
      : flag === "strong_performer"
        ? t("modelHealth.flag.strong")
        : flag === "systematic_optimism_bias"
          ? t("modelHealth.flag.biasPlus")
          : flag === "systematic_pessimism_bias"
            ? t("modelHealth.flag.biasMinus")
            : flag === "direction_unreliable"
              ? t("modelHealth.flag.suspended")
              : flag === "insufficient_data"
                ? t("modelHealth.flag.insufficient")
                : flag;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="text-ink-muted text-xs">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 120;
  const h = 28;
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-[rgb(var(--accent))]"
        points={pts}
      />
    </svg>
  );
}

export type ModelHealthPanelProps = {
  /** T-5 backtest from Validation snapshot — links the two analyses. */
  validationT5Mae?: number | null;
  validationT5Dir?: number | null;
};

export function ModelHealthPanel({
  validationT5Mae = null,
  validationT5Dir = null,
}: ModelHealthPanelProps) {
  const t = useT();
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [history, setHistory] = useState<Array<{ run_at?: string; summary?: FeedbackSummary }>>(
    [],
  );
  const [tickers, setTickers] = useState<Record<string, TickerPerformanceRow>>({});
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<FeedbackCalChange[]>([]);
  const [previewRunAt, setPreviewRunAt] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [sumRes, perf] = await Promise.all([loadFeedbackSummary(), loadTickerPerformance()]);
    setSummary(sumRes.summary);
    setHistory(sumRes.history);
    setTickers(perf);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maeTrend = useMemo(() => {
    const weeks = history.slice(-8);
    return weeks
      .map((w) => w.summary?.portfolio_avg_mae)
      .filter((v): v is number => v != null && Number.isFinite(v));
  }, [history]);

  const recentChanges = useMemo(() => {
    const fromHist = history
      .flatMap((w) => w.summary?.cal_factor_changes ?? [])
      .slice(-5)
      .reverse();
    if (fromHist.length) return fromHist;
    return (summary?.cal_factor_changes ?? []).slice(-5).reverse();
  }, [history, summary]);

  const tableRows = useMemo(() => {
    const keys = new Set([...Object.keys(tickers)]);
    if (preview.length) {
      for (const c of preview) keys.add(c.ticker);
    }
    return [...keys].sort().map((tk) => ({
      ticker: tk,
      ...(tickers[tk] ?? {}),
      pendingChange: preview.find((c) => c.ticker === tk),
    }));
  }, [tickers, preview]);

  const handlePreview = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const res = await previewFeedbackLoop();
      setPreview(res.cal_factor_changes ?? []);
      setPreviewRunAt(res.run_at ?? new Date().toISOString());
      if (res.summary) setSummary(res.summary);
      if (res.ticker_performance && Object.keys(res.ticker_performance).length > 0) {
        setTickers(res.ticker_performance);
      }
      setPreviewOpen(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMsg(isMethodNotAllowedMsg(raw) ? t("modelHealth.apiUnavailable") : raw);
    } finally {
      setRunning(false);
    }
  };

  const handleApply = async () => {
    setRunning(true);
    setMsg(null);
    try {
      const res = await applyFeedbackLoop();
      const n = res.cal_factor_changes?.length ?? 0;
      setMsg(t("modelHealth.applyOk", { n: String(n) }));
      setPreviewOpen(false);
      setPreview([]);
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className={`${MODEL_TAB_INTRO_SECTION} space-y-4`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="text-2xl leading-none shrink-0 select-none" role="img" aria-hidden>
          🩺
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{t("modelHealth.title")}</h3>
          <p className="text-[13px] leading-snug text-ink/90 mt-1">{t("modelHealth.subtitle")}</p>
          {validationT5Mae != null || validationT5Dir != null ? (
            <p className="text-[12px] leading-snug text-ink-muted mt-2 border-l-2 border-[rgb(var(--accent))]/40 pl-2">
              {t("modelHealth.bridgeFromValidation", {
                mae:
                  validationT5Mae != null && Number.isFinite(validationT5Mae)
                    ? `${validationT5Mae.toFixed(1)}%`
                    : "—",
                dir:
                  validationT5Dir != null && Number.isFinite(validationT5Dir)
                    ? `${Math.round(validationT5Dir * 100)}%`
                    : "—",
              })}
            </p>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={running || loading}
            onClick={() => void reload()}
          >
            {t("common.reload")}
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={running}
            onClick={() => void handlePreview()}
          >
            {running ? t("modelHealth.running") : t("modelHealth.runPreview")}
          </button>
        </div>
      </div>

      {msg ? (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded p-2">
          {msg}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <div className="text-[10px] uppercase text-ink-muted">{t("modelHealth.maeTrend")}</div>
          <Sparkline values={maeTrend} />
        </div>
        <div>
          <div className="text-[10px] uppercase text-ink-muted">{t("modelHealth.portfolioMae")}</div>
          <div className={`text-lg font-semibold tabular-nums ${maeTone(summary?.portfolio_avg_mae)}`}>
            {summary?.portfolio_avg_mae != null ? `${summary.portfolio_avg_mae.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-ink-muted">{t("modelHealth.portfolioDir")}</div>
          <div
            className={`text-lg font-semibold tabular-nums ${dirTone(summary?.portfolio_direction_acc)}`}
          >
            {summary?.portfolio_direction_acc != null
              ? `${(summary.portfolio_direction_acc * 100).toFixed(0)}%`
              : "—"}
          </div>
        </div>
        <div className="text-[10px] text-ink-muted">
          {t("modelHealth.lastRun")}{" "}
          {summary?.updated_at
            ? new Date(summary.updated_at).toLocaleString()
            : t("modelHealth.never")}
        </div>
      </div>

      {recentChanges.length > 0 ? (
        <div>
          <div className="text-[10px] uppercase text-ink-muted mb-1">{t("modelHealth.recentCal")}</div>
          <ul className="text-xs space-y-0.5 font-mono">
            {recentChanges.map((c) => (
              <li key={`${c.ticker}-${c.old_cal}`}>
                {c.ticker}: {c.old_cal.toFixed(3)} → {c.new_cal.toFixed(3)} — {c.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/50">
              <th className="py-1 pr-2">{t("modelHealth.col.ticker")}</th>
              <th className="py-1 pr-2">{t("modelHealth.col.mae")}</th>
              <th className="py-1 pr-2">{t("modelHealth.col.dir")}</th>
              <th className="py-1 pr-2">{t("modelHealth.col.bias")}</th>
              <th className="py-1 pr-2">{t("modelHealth.col.cal")}</th>
              <th className="py-1">{t("modelHealth.col.flag")}</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-ink-muted">
                  {loading ? t("common.loading") : t("modelHealth.noData")}
                </td>
              </tr>
            ) : (
              tableRows.map((row) => (
                <tr key={row.ticker} className="border-b border-[rgb(var(--border))]/30">
                  <td className="py-1 pr-2 font-medium">{row.ticker}</td>
                  <td className={`py-1 pr-2 tabular-nums ${maeTone(row.persistent_mae)}`}>
                    {row.persistent_mae != null ? `${row.persistent_mae.toFixed(1)}%` : "—"}
                  </td>
                  <td className={`py-1 pr-2 tabular-nums ${dirTone(row.direction_acc)}`}>
                    {row.direction_acc != null ? `${(row.direction_acc * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="py-1 pr-2 tabular-nums">
                    {row.bias != null ? `${row.bias >= 0 ? "+" : ""}${row.bias.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-1 pr-2 tabular-nums font-mono">
                    {row.pendingChange ? (
                      <span>
                        {row.pendingChange.old_cal.toFixed(3)} →{" "}
                        <strong>{row.pendingChange.new_cal.toFixed(3)}</strong>
                      </span>
                    ) : row.cal_factor != null ? (
                      row.cal_factor.toFixed(3)
                    ) : (
                      "1.000"
                    )}
                  </td>
                  <td className="py-1">{flagBadge(row.flag, t)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card max-w-lg w-full p-4 space-y-3">
            <h4 className="font-semibold">{t("modelHealth.previewTitle")}</h4>
            <p className="text-xs text-ink-muted">{t("modelHealth.previewHint")}</p>
            {previewRunAt ? (
              <p className="text-[10px] text-ink-muted">{previewRunAt}</p>
            ) : null}
            {preview.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("modelHealth.previewEmpty")}</p>
            ) : (
              <ul className="text-xs font-mono max-h-48 overflow-y-auto space-y-1">
                {preview.map((c) => (
                  <li key={c.ticker}>
                    {c.ticker}: {c.old_cal.toFixed(3)} → {c.new_cal.toFixed(3)} — {c.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost text-xs" onClick={() => setPreviewOpen(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={running || preview.length === 0}
                onClick={() => void handleApply()}
              >
                {t("modelHealth.applyConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function isMethodNotAllowedMsg(msg: string): boolean {
  return msg.includes("405") || /method not allowed/i.test(msg);
}
