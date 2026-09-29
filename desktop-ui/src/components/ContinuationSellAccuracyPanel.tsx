/**
 * Model Lab — continuation sell prediction quality + stretch improvement.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import {
  chartPointsMapFromBundle,
  loadSimulationChartsBundle,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { normalizedRowKey } from "../sheet/investSimKeys";
import {
  applyContSellStretchProposal,
  CONT_SELL_LEARNING_CHANGED_EVENT,
  revertContSellStretch,
  runContSellLearningLoop,
  type ContSellLearningView,
} from "../sheet/continuationSellLearningLoop";
import {
  buildContSellWeeklyRows,
  recordContSellWeeklySnapshot,
} from "../sheet/continuationSellLearningHistory";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { ModelLabAccuracyUpdatedBar } from "./ModelLabAccuracyUpdatedBar";

type Props = {
  simTable?: SheetTable | null;
  chartBundle?: ChartBundle | null;
  reloadToken?: number;
  dataUpdatedAt?: string | null;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function KpiCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-800"
      : tone === "bad"
        ? "text-rose-800"
        : "text-ink";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/40 px-3 py-2 min-w-[7.5rem] flex-1">
      <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">{title}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${cls}`}>{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

export function ContinuationSellAccuracyPanel({
  simTable,
  chartBundle = null,
  reloadToken = 0,
  dataUpdatedAt,
}: Props) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable ?? null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ContSellLearningView | null>(null);
  const [weekly, setWeekly] = useState(buildContSellWeeklyRows());
  const [chartMode, setChartMode] = useState<"day" | "week">("day");

  const runLoop = useCallback(
    async (bundle: ChartBundle | null) => {
      if (!simTable?.rows?.length) {
        setView(null);
        return;
      }
      const pointsBySeriesKey = bundle
        ? chartPointsMapFromBundle(bundle)
        : new Map<string, ChartPoint[]>();
      const chartByKey = new Map<string, ChartPoint[] | null | undefined>();
      const freezeRows = simTable.rows.map((row) => {
        const tk = String(row.Ticker ?? "")
          .trim()
          .toUpperCase();
        const key = normalizedRowKey(tk, row["Completion Date"]);
        const sk = simulationRowSeriesKey(row);
        const pts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
        chartByKey.set(key, pts);
        const entry = inputs[key];
        const hasPosition = Boolean(
          entry && !entry.ignoreSheet && (entry.capital ?? 0) > 0,
        );
        let pnlPct: number | null = null;
        if (hasPosition && entry && entry.buyPrice > 0) {
          const cur = Number(row["Current Price"] ?? row["Price"] ?? row["Last"]);
          if (Number.isFinite(cur) && cur > 0) {
            pnlPct = Math.round(((cur - entry.buyPrice) / entry.buyPrice) * 1000) / 10;
          }
        }
        return {
          key,
          ticker: tk,
          simRow: row,
          chartPts: pts,
          hasPosition,
          pnlPct,
        };
      });
      const next = runContSellLearningLoop({ rows: freezeRows, chartByKey });
      setView(next);
      recordContSellWeeklySnapshot({
        rawHitPct: next.rawHitPct,
        stretchHitPct: next.stretchHitPct,
        scoredN: next.scoredN,
        pendingN: next.pendingScoreN,
        edgeMin: next.stretch.applied.edgeMin,
        edgeStretch: next.stretch.applied.edgeStretch,
      });
      setWeekly(buildContSellWeeklyRows());
    },
    [simTable, inputs],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        let bundle = chartBundle;
        if (!bundle) {
          const loaded = await loadSimulationChartsBundle();
          if (cancelled) return;
          bundle = loaded.bundle;
          if (loaded.error) setErr(loaded.error);
        }
        if (cancelled) return;
        await runLoop(bundle);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, simTable, chartBundle, runLoop]);

  useEffect(() => {
    const bump = () => {
      void runLoop(chartBundle);
    };
    window.addEventListener(CONT_SELL_LEARNING_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CONT_SELL_LEARNING_CHANGED_EVENT, bump);
  }, [chartBundle, runLoop]);

  const chartData = useMemo(() => {
    if (chartMode === "week") {
      return weekly.map((w) => ({
        label: w.week,
        rawHitPct: w.rawHitPct,
        stretchHitPct: w.stretchHitPct,
        n: w.scoredN,
      }));
    }
    return (view?.daySeries ?? []).map((d) => ({
      label: d.label,
      rawHitPct: d.rawHitPct,
      stretchHitPct: d.stretchHitPct,
      n: d.stretchN,
    }));
  }, [chartMode, weekly, view]);

  const verdictTone =
    view?.verdict === "improved"
      ? "good"
      : view?.verdict === "worse"
        ? "bad"
        : "neutral";

  if (loading) {
    return (
      <div className="px-4 py-3 text-[11px] text-ink-muted">
        {t("modelLab.contSellAccuracy.loading")}
      </div>
    );
  }

  return (
    <ViewErrorBoundary label="Continuation sell accuracy">
      <div className="flex flex-col gap-3 px-1 pb-4">
        <ModelLabAccuracyUpdatedBar updatedAt={dataUpdatedAt} />
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("modelLab.contSellAccuracy.title")}
          </h2>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-3xl">
            {t("modelLab.contSellAccuracy.intro")}
          </p>
        </div>

        {err ? (
          <p className="text-[11px] text-amber-800 bg-amber-50/80 border border-amber-200/80 rounded px-2 py-1">
            {err}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <KpiCard
            title={t("modelLab.contSellAccuracy.kpi.raw")}
            value={fmtPct(view?.rawHitPct)}
            sub={
              it
                ? `n scored ${view?.scoredN ?? 0} · pending ${view?.pendingScoreN ?? 0}`
                : `n scored ${view?.scoredN ?? 0} · pending ${view?.pendingScoreN ?? 0}`
            }
          />
          <KpiCard
            title={t("modelLab.contSellAccuracy.kpi.stretch")}
            value={fmtPct(view?.stretchHitPct)}
            sub={`edgeMin ${view?.stretch.applied.edgeMin ?? 0} · ×${(
              view?.stretch.applied.edgeStretch ?? 1
            ).toFixed(2)}`}
            tone={verdictTone}
          />
          <KpiCard
            title={t("modelLab.contSellAccuracy.kpi.delta")}
            value={
              view?.deltaPp == null
                ? "—"
                : `${view.deltaPp >= 0 ? "+" : ""}${view.deltaPp.toFixed(1)} pp`
            }
            sub={
              view?.verdict === "improved"
                ? t("modelLab.contSellAccuracy.verdict.improved")
                : view?.verdict === "worse"
                  ? t("modelLab.contSellAccuracy.verdict.worse")
                  : t("modelLab.contSellAccuracy.verdict.neutral")
            }
            tone={verdictTone}
          />
        </div>

        {view?.stretch.pending ? (
          <div className="rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[12rem]">
              <p className="text-[10px] font-semibold uppercase text-amber-900">
                {t("modelLab.contSellAccuracy.proposal")}
              </p>
              <p className="text-[11px] text-ink mt-0.5">
                {it ? view.stretch.pending.reasonIt : view.stretch.pending.reason}
              </p>
              <p className="text-[10px] text-ink-muted tabular-nums mt-0.5">
                edgeMin {view.stretch.pending.from.edgeMin} → {view.stretch.pending.to.edgeMin}
                {" · "}×{view.stretch.pending.from.edgeStretch.toFixed(2)} → ×
                {view.stretch.pending.to.edgeStretch.toFixed(2)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white"
              onClick={() => {
                applyContSellStretchProposal();
                void runLoop(chartBundle);
              }}
            >
              {t("modelLab.contSellAccuracy.apply")}
            </button>
            <button
              type="button"
              className="rounded-md border border-[rgb(var(--border))]/60 px-3 py-1.5 text-xs text-ink-muted"
              onClick={() => {
                revertContSellStretch();
                void runLoop(chartBundle);
              }}
            >
              {t("modelLab.contSellAccuracy.revert")}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-[rgb(var(--border))]/60 px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
              onClick={() => {
                revertContSellStretch();
                void runLoop(chartBundle);
              }}
            >
              {t("modelLab.contSellAccuracy.resetStretch")}
            </button>
          </div>
        )}

        <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[11px] font-semibold text-ink">
              {t("modelLab.contSellAccuracy.chartTitle")}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className={`rounded-full border px-2.5 py-0.5 text-[10px] ${
                  chartMode === "day"
                    ? "border-accent bg-accent/10 text-[rgb(var(--accent))]"
                    : "border-[rgb(var(--border))]/50 text-ink-muted"
                }`}
                onClick={() => setChartMode("day")}
              >
                {t("modelLab.contSellAccuracy.chart.day")}
              </button>
              <button
                type="button"
                className={`rounded-full border px-2.5 py-0.5 text-[10px] ${
                  chartMode === "week"
                    ? "border-accent bg-accent/10 text-[rgb(var(--accent))]"
                    : "border-[rgb(var(--border))]/50 text-ink-muted"
                }`}
                onClick={() => setChartMode("week")}
              >
                {t("modelLab.contSellAccuracy.chart.week")}
              </button>
            </div>
          </div>
          {chartData.length === 0 ? (
            <p className="text-[11px] text-ink-muted py-8 text-center">
              {t("modelLab.contSellAccuracy.empty")}
            </p>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${v}%`}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(value: number | string, name: string) => [
                      typeof value === "number" ? `${value.toFixed(1)}%` : value,
                      name === "rawHitPct"
                        ? t("modelLab.contSellAccuracy.series.raw")
                        : t("modelLab.contSellAccuracy.series.stretch"),
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(value) =>
                      value === "rawHitPct"
                        ? t("modelLab.contSellAccuracy.series.raw")
                        : t("modelLab.contSellAccuracy.series.stretch")
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="rawHitPct"
                    name="rawHitPct"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="stretchHitPct"
                    name="stretchHitPct"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </ViewErrorBoundary>
  );
}
