import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DecisionCohortView } from "../sheet/decisionCohortView";
import { decisionHitTone } from "../sheet/decisionCohortView";
import { useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

type ChartRow = {
  rebuild: number;
  label: string;
  date: string;
  hitPct: number | null;
  nEvents: number | null;
  deltaFromPrev: number | null;
};

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function hitDotColor(hitPct: number | null | undefined): string {
  if (hitPct == null || !Number.isFinite(hitPct)) return "#94a3b8";
  if (hitPct >= 58) return "#059669";
  if (hitPct >= 50) return "#d97706";
  return "#dc2626";
}

export function DecisionCohortPanel({ view }: { view: DecisionCohortView | null }) {
  const t = useT();

  const chartData = useMemo((): ChartRow[] => {
    let prev: number | null = null;
    return (view?.historyPoints ?? []).map((p, i) => {
      const delta =
        p.hitPct != null && prev != null ? Math.round((p.hitPct - prev) * 10) / 10 : null;
      if (p.hitPct != null) prev = p.hitPct;
      return {
        rebuild: i + 1,
        label: `#${i + 1}`,
        date: p.label,
        hitPct: p.hitPct,
        nEvents: p.nEvents,
        deltaFromPrev: delta,
      };
    });
  }, [view?.historyPoints]);

  const rangeSummary = useMemo(() => {
    const hits = chartData.map((r) => r.hitPct).filter((v): v is number => v != null);
    if (!hits.length) return null;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const best = Math.max(...hits);
    const worst = Math.min(...hits);
    return {
      first,
      last,
      delta: Math.round((last - first) * 10) / 10,
      best,
      worst,
    };
  }, [chartData]);

  if (!view || (view.currentHitPct == null && !view.hasChart)) return null;

  const hitCls = decisionHitTone(view.currentHitPct);

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.decisionCohort.title")}
          </p>
          <p className="text-sm font-semibold text-ink leading-snug">
            {t("modelLab.qc.decisionCohort.lead")}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-prose">
            {t("modelLab.qc.decisionCohort.body")}
          </p>
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          <p className={`text-lg font-semibold tabular-nums ${hitCls}`}>
            {fmtPct(view.currentHitPct)}
          </p>
          {view.previousHitPct != null ? (
            <p className="text-[9px] text-ink-muted tabular-nums">
              {t("modelLab.qc.decisionCohort.wasPct", { pct: fmtPct(view.previousHitPct) })}
              {view.hitDeltaPp != null ? ` · ${fmtPp(view.hitDeltaPp)}` : ""}
            </p>
          ) : null}
          {view.updatedAt ? (
            <p className="text-[9px] text-ink-muted">
              {t("modelLab.qc.kpi.sub.decisionAt", { date: view.updatedAt.slice(0, 10) })}
            </p>
          ) : null}
        </div>
      </div>

      {view.hasChart ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[10px] font-medium text-ink">
              {t("modelLab.qc.decisionCohort.chartTitle")}
            </p>
            {rangeSummary ? (
              <p className="text-[9px] text-ink-muted tabular-nums">
                {t("modelLab.qc.decisionCohort.rangeSummary", {
                  start: fmtPct(rangeSummary.first, 1),
                  now: fmtPct(rangeSummary.last, 1),
                  delta: fmtPp(rangeSummary.delta),
                  best: fmtPct(rangeSummary.best, 1),
                })}
              </p>
            ) : null}
          </div>
          <p className="text-[9px] text-ink-muted leading-snug">
            {t("modelLab.qc.decisionCohort.chartCaption")}
          </p>
          <div className="flex flex-wrap gap-2 text-[9px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden />
              {t("modelLab.qc.decisionCohort.legendGood")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              {t("modelLab.qc.decisionCohort.legendOk")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden />
              {t("modelLab.qc.decisionCohort.legendBad")}
            </span>
          </div>
          <div className="h-[168px] w-full">
            <ViewErrorBoundary label="Decision cohort hit rate">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
                  <ReferenceArea y1={0} y2={50} fill="#fecaca" fillOpacity={0.12} />
                  <ReferenceArea y1={50} y2={100} fill="#bbf7d0" fillOpacity={0.08} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9 }}
                    interval={0}
                    height={28}
                    label={{
                      value: t("modelLab.qc.decisionCohort.xAxisLabel"),
                      position: "insideBottom",
                      offset: -2,
                      style: { fontSize: 9, fill: "#64748b" },
                    }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tick={{ fontSize: 9 }}
                    unit="%"
                    width={40}
                    label={{
                      value: t("modelLab.qc.decisionCohort.yAxisLabel"),
                      angle: -90,
                      position: "insideLeft",
                      offset: 8,
                      style: { fontSize: 9, fill: "#64748b" },
                    }}
                  />
                  <ReferenceLine
                    y={50}
                    stroke="#d97706"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    label={{
                      value: t("modelLab.qc.decisionCohort.randomLine"),
                      position: "insideTopRight",
                      fill: "#b45309",
                      fontSize: 9,
                    }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const row = payload[0].payload as ChartRow;
                      return (
                        <div className="rounded-md border bg-white px-2.5 py-1.5 text-[10px] shadow-md max-w-[220px]">
                          <p className="font-semibold text-ink">
                            {t("modelLab.qc.decisionCohort.rebuildN", { n: row.rebuild })}
                          </p>
                          <p className="text-ink-muted">{row.date}</p>
                          <p className="mt-1 tabular-nums">
                            {t("modelLab.qc.decisionCohort.lineHit")}:{" "}
                            <span className="font-semibold" style={{ color: hitDotColor(row.hitPct) }}>
                              {fmtPct(row.hitPct)}
                            </span>
                          </p>
                          {row.nEvents != null ? (
                            <p className="text-ink-muted tabular-nums">n={row.nEvents}</p>
                          ) : null}
                          {row.deltaFromPrev != null ? (
                            <p className="text-ink-muted tabular-nums">
                              {t("modelLab.qc.decisionCohort.tooltipDelta", {
                                delta: fmtPp(row.deltaFromPrev),
                              })}
                            </p>
                          ) : null}
                          {row.hitPct != null ? (
                            <p className="text-[9px] text-ink-muted mt-0.5">
                              {row.hitPct >= 50
                                ? t("modelLab.qc.decisionCohort.aboveRandom")
                                : t("modelLab.qc.decisionCohort.belowRandom")}
                            </p>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 9 }} />
                  <Line
                    type="monotone"
                    dataKey="hitPct"
                    name={t("modelLab.qc.decisionCohort.lineHit")}
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={(props) => {
                      const { cx, cy, payload } = props as {
                        cx?: number;
                        cy?: number;
                        payload?: ChartRow;
                      };
                      if (cx == null || cy == null || payload?.hitPct == null) {
                        return <circle cx={cx ?? 0} cy={cy ?? 0} r={0} fill="transparent" />;
                      }
                      const fill = hitDotColor(payload.hitPct);
                      return (
                        <circle cx={cx} cy={cy} r={4} fill={fill} stroke="#fff" strokeWidth={1.5} />
                      );
                    }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ViewErrorBoundary>
          </div>
        </div>
      ) : null}

      {view.nEvents != null ? (
        <p className="text-[9px] text-ink-muted tabular-nums">
          {t("modelLab.qc.decisionCohort.nEvents", { n: view.nEvents })}
        </p>
      ) : null}
    </div>
  );
}
