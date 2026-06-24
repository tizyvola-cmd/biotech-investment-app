import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { useLang, useT } from "../shared/i18n";
import { buildPlanProbLearningSummary } from "../sheet/planProbOutcomeAudit";

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "warn";
}) {
  const color =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "warn"
          ? "text-[rgb(var(--warn))]"
          : "";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

export function PlanProbLearningPanel({
  rows,
  simRowByKey,
}: {
  rows: SimOutcomeRow[];
  simRowByKey: Map<string, Record<string, unknown>>;
}) {
  const t = useT();
  const { lang } = useLang();
  const summary = useMemo(
    () => buildPlanProbLearningSummary(rows, simRowByKey, lang === "it" ? "it" : "en"),
    [rows, simRowByKey, lang],
  );

  const calChartData = summary.calibrationBins.map((b) => ({
    bin: b.binLabel,
    predicted: b.meanProbPct,
    actual: b.hitRatePct ?? 0,
    n: b.n,
  }));

  const scatterData = summary.scatter.map((p) => ({
    x: p.probPct,
    y: p.success * 100,
    z: 80,
    ticker: p.ticker,
    decision: p.decision,
  }));

  const decisionRows = Object.entries(summary.byDecision).sort((a, b) => b[1].n - a[1].n);

  if (!rows.length) {
    return (
      <p className="text-sm text-ink-muted py-6 text-center">{t("simOutcomes.planProb.empty")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1">
        <p className="text-[11px] font-medium text-ink">{t("simOutcomes.planProb.introTitle")}</p>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("simOutcomes.planProb.introBody")}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi
          label={t("simOutcomes.planProb.kpiAccuracy")}
          value={summary.accuracyPct != null ? `${summary.accuracyPct.toFixed(1)}%` : "—"}
          sub={t("simOutcomes.planProb.kpiAccuracySub", {
            correct: summary.correct,
            total: summary.evaluable,
          })}
          accent={
            summary.accuracyPct == null
              ? undefined
              : summary.accuracyPct >= 60
                ? "up"
                : summary.accuracyPct < 45
                  ? "down"
                  : "warn"
          }
        />
        <Kpi
          label={t("simOutcomes.planProb.kpiBrier")}
          value={summary.meanBrier != null ? summary.meanBrier.toFixed(3) : "—"}
          sub={t("simOutcomes.planProb.kpiBrierSub")}
          accent={
            summary.meanBrier == null
              ? undefined
              : summary.meanBrier <= 0.2
                ? "up"
                : summary.meanBrier >= 0.35
                  ? "down"
                  : "warn"
          }
        />
        <Kpi
          label={t("simOutcomes.planProb.kpiPenalty")}
          value={summary.weightedPenalty != null ? `${summary.weightedPenalty.toFixed(1)} pp` : "—"}
          sub={t("simOutcomes.planProb.kpiPenaltySub")}
          accent={
            summary.weightedPenalty == null
              ? undefined
              : summary.weightedPenalty >= 50
                ? "down"
                : summary.weightedPenalty <= 25
                  ? "up"
                  : "warn"
          }
        />
        <Kpi
          label={t("simOutcomes.planProb.kpiPending")}
          value={String(summary.pending)}
          sub={t("simOutcomes.planProb.kpiPendingSub")}
        />
      </div>

      {decisionRows.length ? (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          {decisionRows.map(([dec, stats]) => (
            <div key={dec} className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
              <p className="text-ink-muted uppercase tracking-wide">{dec}</p>
              <p className="font-semibold tabular-nums text-ink">
                {stats.accuracyPct != null ? `${stats.accuracyPct.toFixed(0)}%` : "—"}
              </p>
              <p className="text-[9px] text-ink-muted">
                {stats.correct}/{stats.n} {t("simOutcomes.planProb.correctShort")}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{t("simOutcomes.planProb.chartCalibTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("simOutcomes.planProb.chartCalibSub")}</p>
          </div>
          {calChartData.length >= 2 ? (
            <div style={{ height: 240 }} className="w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calChartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis dataKey="bin" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} unit="%" />
                  <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 3" />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar
                    dataKey="predicted"
                    name={t("simOutcomes.planProb.linePredicted")}
                    fill="#6366f1"
                    opacity={0.85}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name={t("simOutcomes.planProb.lineActual")}
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted py-6 text-center">
              {t("simOutcomes.planProb.chartNeedMore")}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{t("simOutcomes.planProb.chartScatterTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("simOutcomes.planProb.chartScatterSub")}</p>
          </div>
          {scatterData.length >= 3 ? (
            <div style={{ height: 240 }} className="w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, left: 4, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.35} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, 100]}
                    tick={{ fontSize: 9 }}
                    name="P(plan)"
                    label={{
                      value: "P(plan) %",
                      position: "insideBottom",
                      offset: -8,
                      style: { fontSize: 9, fill: "#64748b" },
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    domain={[-5, 105]}
                    tick={{ fontSize: 9 }}
                    ticks={[0, 100]}
                    tickFormatter={(v) => (v >= 50 ? "OK" : "ERR")}
                  />
                  <ZAxis type="number" dataKey="z" range={[40, 120]} />
                  <Tooltip
                    content={({ payload }) => {
                      const p = payload?.[0]?.payload as {
                        ticker?: string;
                        x?: number;
                        y?: number;
                        decision?: string;
                      };
                      if (!p) return null;
                      return (
                        <div className="rounded border bg-surface px-2 py-1 text-[10px] shadow">
                          <p className="font-semibold">{p.ticker}</p>
                          <p>
                            P(plan) {p.x?.toFixed(0)}% · {p.decision}
                          </p>
                          <p>
                            {p.y === 100
                              ? t("simOutcomes.planProb.hit")
                              : t("simOutcomes.planProb.miss")}
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={scatterData} fill="#6366f1" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted py-6 text-center">
              {t("simOutcomes.planProb.chartNeedMore")}
            </p>
          )}
        </div>
      </div>

      {summary.evaluable > 0 ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-x-auto">
          <table className="w-full text-[10px] border-collapse min-w-[520px]">
            <thead>
              <tr className="text-ink-muted border-b border-[rgb(var(--border))]/40">
                <th className="text-left py-1.5 px-2 font-medium">{t("simOutcomes.planProb.colTicker")}</th>
                <th className="text-right py-1.5 px-2 font-medium">P(plan)</th>
                <th className="text-left py-1.5 px-2 font-medium">{t("simOutcomes.planProb.colRec")}</th>
                <th className="text-right py-1.5 px-2 font-medium">P&L %</th>
                <th className="text-center py-1.5 px-2 font-medium">{t("simOutcomes.planProb.colResult")}</th>
                <th className="text-right py-1.5 px-2 font-medium">Brier</th>
              </tr>
            </thead>
            <tbody>
              {summary.auditRows
                .filter((r) => r.evaluable)
                .slice(0, 24)
                .map((r) => (
                  <tr key={r.rowKey} className="border-b border-[rgb(var(--border))]/20">
                    <td className="py-1 px-2 font-semibold text-ink">{r.ticker}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.probPct.toFixed(0)}%</td>
                    <td className="py-1 px-2 uppercase text-[9px] font-medium">{r.decisionLabel}</td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {r.pnlPct != null ? `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-1 px-2 text-center">
                      {r.correct ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 font-semibold">✗</span>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-ink-muted">
                      {r.brier?.toFixed(3) ?? "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-[10px] text-ink-muted leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
        {t("simOutcomes.planProb.learningNote")}
      </p>
    </div>
  );
}
