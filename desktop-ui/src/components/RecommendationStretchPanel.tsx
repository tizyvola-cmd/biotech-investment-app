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
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { buildAdviceCalibrationForLearnings } from "./DecisionSimAdviceCalibrationPanel";
import {
  ADVICE_FEEDBACK_CHANGED_EVENT,
  loadAdviceFeedback,
} from "../sheet/adviceFeedback";
import {
  ADVICE_LEARNING_HISTORY_CHANGED_EVENT,
  loadAdviceLearningHistory,
} from "../sheet/adviceLearningHistory";
import {
  buildRecommendationStretchView,
  recStretchVerdictTone,
  type RecommendationStretchView,
  type RecStretchActionStats,
} from "../sheet/recommendationStretchView";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

type Props = {
  simTable: SheetTable | null | undefined;
  chartBundle?: ChartBundle | null;
  lang: "it" | "en";
};

function ActionCard({
  title,
  tip,
  stats,
  tone,
}: {
  title: string;
  tip: string;
  stats: RecStretchActionStats;
  tone: "buy" | "sell" | "hold";
}) {
  const border =
    tone === "buy"
      ? "border-emerald-300/70 bg-emerald-50/70"
      : tone === "sell"
        ? "border-rose-300/70 bg-rose-50/70"
        : "border-sky-300/70 bg-sky-50/70";
  const rateCls =
    stats.successRatePct == null
      ? "text-ink-muted"
      : stats.successRatePct >= 55
        ? "text-emerald-800"
        : stats.successRatePct < 45
          ? "text-rose-800"
          : "text-amber-900";
  return (
    <div className={`rounded-lg border px-2.5 py-2 min-w-[7.5rem] flex-1 ${border}`} title={tip}>
      <p className="text-[9px] uppercase tracking-wide font-semibold text-ink-muted">{title}</p>
      <p className={`text-xl font-bold tabular-nums leading-tight ${rateCls}`}>
        {stats.successRatePct != null ? `${stats.successRatePct.toFixed(1)}%` : "—"}
      </p>
      <p className="text-[9px] text-ink-muted tabular-nums mt-0.5">
        {stats.good}✓ / {stats.bad}✗ · n={stats.scored}
        {stats.avgMovePct != null
          ? ` · Δ ${stats.avgMovePct >= 0 ? "+" : ""}${stats.avgMovePct.toFixed(1)}%`
          : ""}
      </p>
    </div>
  );
}

export function RecommendationStretchPanel({ simTable, chartBundle, lang }: Props) {
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable ?? null);
  const [view, setView] = useState<RecommendationStretchView | null>(null);
  const [mode, setMode] = useState<"actions" | "overall">("actions");
  const [err, setErr] = useState<string | null>(null);

  const recompute = useCallback(() => {
    if (!simTable?.rows?.length) {
      setView(null);
      return;
    }
    try {
      const pointsBySeriesKey = chartBundle ? chartPointsMapFromBundle(chartBundle) : new Map();
      const ds = loadDecisionSimState();
      const monitorRows = buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        paperPortfolio: ds.paperPortfolio,
      });
      const points = buildAdviceCalibrationForLearnings({
        monitorRows,
        paperPortfolio: ds.paperPortfolio,
        decisionSimTicks: ds.ticks,
        liveEvaluations: monitorRows,
        simTable,
        lang,
      });
      const feedback = loadAdviceFeedback();
      const history = loadAdviceLearningHistory().snapshots;
      setView(
        buildRecommendationStretchView({
          points,
          feedback,
          learningHistory: history,
        }),
      );
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [simTable, chartBundle, inputs, lang]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const onChange = () => recompute();
    window.addEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
    window.addEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
      window.removeEventListener(ADVICE_LEARNING_HISTORY_CHANGED_EVENT, onChange);
    };
  }, [recompute]);

  const chartData = useMemo(() => {
    if (!view) return [];
    if (view.daySeries.length >= 2) {
      return view.daySeries.map((d) => ({
        label: d.label,
        buy: d.buyPct,
        sell: d.sellPct,
        hold: d.holdPct,
        overall: d.overallPct,
      }));
    }
    // Fallback: learning timeline overall / buy only
    return view.timelineOverall.map((d) => ({
      label: d.day.slice(5),
      buy: d.buyPct,
      sell: null as number | null,
      hold: null as number | null,
      overall: d.pct,
    }));
  }, [view]);

  if (!simTable?.rows?.length) return null;
  if (!view || view.scoredTotal < 1) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-1">
        <p className="text-[9px] uppercase tracking-wide text-ink-muted font-semibold">
          {it ? "Recommendation stretch — esito trading" : "Recommendation stretch — trading outcome"}
        </p>
        <p className="text-[10px] text-ink-muted">
          {it
            ? "Ancora pochi advice scored (BUY/SELL/HOLD vs movimento prezzo). Torna quando il Decision Sim ha valutato almeno qualche consiglio a 24h."
            : "Not enough scored advice yet (BUY/SELL/HOLD vs price move). Come back when Decision Sim has graded some 24h outcomes."}
        </p>
        {err ? <p className="text-[10px] text-rose-600">{err}</p> : null}
      </div>
    );
  }

  const verdictLabel =
    view.verdict === "improved"
      ? it
        ? "In miglioramento"
        : "Improving"
      : view.verdict === "worse"
        ? it
          ? "In peggioramento"
          : "Worsening"
        : view.verdict === "neutral"
          ? it
            ? "Stabile"
            : "Flat / mixed"
          : it
            ? "Dati insufficienti"
            : "Insufficient data";

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted font-semibold">
            {it ? "Recommendation stretch — esito trading" : "Recommendation stretch — trading outcome"}
          </p>
          <p className="text-sm font-semibold text-ink leading-snug">
            {it
              ? "Le raccomandazioni si traducono in successo di trading?"
              : "Do recommendations translate into trading success?"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-prose">
            {it
              ? "BUY ok se il prezzo sale (≥ +0.5%). SELL ok se scende (≤ −0.5%). HOLD fallisce se il prezzo cade (doveva essere SELL); flat o salita = HOLD giustificato. Diverso dallo stretch delle curve di prezzo sopra."
              : "BUY ok if price rises (≥ +0.5%). SELL ok if it falls (≤ −0.5%). HOLD fails if price drops (should have been SELL); flat or up = HOLD justified. Separate from price-curve stretch above."}
          </p>
          <p className="text-[9px] text-amber-800/90 dark:text-amber-300/90 leading-snug max-w-prose">
            {it
              ? "Fuori finestra canonica: metriche a 24h (non CD−2m→−10g). Per l’efficienza sistema usa Impatto per canale A/B/C."
              : "Outside canonical window: 24h metrics (not CD−2m→−10d). For system efficiency use Per-channel impact A/B/C."}
          </p>
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          <p className={`text-xs font-semibold ${recStretchVerdictTone(view.verdict)}`}>{verdictLabel}</p>
          <p className="text-lg font-semibold tabular-nums text-ink">
            {view.overall.successRatePct != null ? `${view.overall.successRatePct.toFixed(1)}%` : "—"}
            <span className="text-[11px] font-normal text-ink-muted ml-1">
              {it ? "successo complessivo" : "overall success"}
            </span>
          </p>
          {view.stretchFactor != null ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              {it ? "Stretch P(plan) medio" : "Mean P(plan) stretch"} ×{view.stretchFactor.toFixed(3)}
              {view.stretchPctFromNeutral != null
                ? ` (${view.stretchPctFromNeutral >= 0 ? "+" : ""}${view.stretchPctFromNeutral}% vs 1.0)`
                : ""}
              {view.bucketCorrectionsActive || view.actionDemotionsActive
                ? ` · ${view.bucketCorrectionsActive}b / ${view.actionDemotionsActive}a`
                : ""}
            </p>
          ) : null}
          {view.recentOverallPct != null && view.priorOverallPct != null ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              {it ? "Recente vs prima:" : "Recent vs prior:"} {view.priorOverallPct}% → {view.recentOverallPct}%
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ActionCard
          title="BUY"
          tip={
            it
              ? "Successo se il prezzo sale ≥ +0.5% dopo il consiglio."
              : "Success if price rises ≥ +0.5% after the advice."
          }
          stats={view.buy}
          tone="buy"
        />
        <ActionCard
          title="SELL"
          tip={
            it
              ? "Successo se il prezzo scende ≤ −0.5% dopo il consiglio."
              : "Success if price falls ≤ −0.5% after the advice."
          }
          stats={view.sell}
          tone="sell"
        />
        <ActionCard
          title="HOLD"
          tip={
            it
              ? "Fallisce se il prezzo cade (≤ −0.5%) — avrebbe dovuto essere SELL. Flat o salita = HOLD ok."
              : "Fails if price drops (≤ −0.5%) — should have been SELL. Flat or up = HOLD ok."
          }
          stats={view.hold}
          tone="hold"
        />
      </div>

      {chartData.length >= 2 ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-medium text-ink">
              {it ? "Successo nel tempo (per azione)" : "Success over time (by action)"}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium border ${
                  mode === "actions"
                    ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 text-ink-muted"
                }`}
                onClick={() => setMode("actions")}
              >
                BUY / SELL / HOLD
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium border ${
                  mode === "overall"
                    ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 text-ink-muted"
                }`}
                onClick={() => setMode("overall")}
              >
                {it ? "Complessivo" : "Overall"}
              </button>
            </div>
          </div>
          <p className="text-[9px] text-ink-muted">
            {it
              ? "Asse Y = % consigli corretti vs movimento prezzo successivo (tipicamente 24h)."
              : "Y-axis = % advice correct vs subsequent price move (typically 24h)."}
          </p>
          <ViewErrorBoundary label="Recommendation stretch chart">
            <div className="h-[200px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 9 }}
                    tickFormatter={(v) => `${v}%`}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 10 }}
                    formatter={(v: number | string) =>
                      typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—"
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {mode === "actions" ? (
                    <>
                      <Line
                        type="monotone"
                        dataKey="buy"
                        name="BUY"
                        stroke="#059669"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="sell"
                        name="SELL"
                        stroke="#e11d48"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="hold"
                        name="HOLD"
                        stroke="#0284c7"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="overall"
                      name={it ? "Complessivo" : "Overall"}
                      stroke="#4f46e5"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ViewErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}
