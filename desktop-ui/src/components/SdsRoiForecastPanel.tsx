import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ErrorBar,
  Cell,
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
import { useLang, useT, t as tr } from "../shared/i18n";
import {
  errorTone,
  fmtPct,
  fmtPp,
  horizonLabel,
  maeTone,
  qcStatusIcon,
  qcStatusIconFromMae,
  type SdsRoiBacktestScoresDoc,
  type SdsRoiForecastLogDoc,
  type SdsRoiHorizonKey,
  type SdsSnapshotDoc,
} from "../sheet/sdsRoiForecast";
import {
  buildSdsRoiSimConvergenceView,
  loadSdsRoiConvergenceSources,
  type SdsRoiSimMaeTrendPoint,
  type SdsRoiSimScatterPoint,
  type SimulationSheetSnapshotDoc,
} from "../sheet/sdsRoiSimConvergence";
import {
  buildSdsRoiBlendEvalView,
  type BlendHorizonCurvePoint,
  type BlendMaeTrendPoint,
  type BlendTimelinePoint,
  type BlendVsPredEventRow,
} from "../sheet/sdsRoiBlendEval";
import { SdsClusterCoverageSection } from "./SdsClusterCoverageDrawer";
import {
  buildRoiTemporalConvergenceView,
  type RoiTemporalConvergencePoint,
} from "../sheet/sdsRoiTemporalConvergence";
import {
  CHART_CURVES_AXIS_LINE,
  CHART_CURVES_AXIS_TICK,
  CHART_CURVES_GRID,
  CHART_CURVES_PANEL,
  chartCurvesLegendStyle,
} from "../sheet/chartTheme";
import { toneClass } from "../data/evaluationModelData";
import { refreshSdsCohort, loadSdsCohort, type SdsRow } from "../api/supernova";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { loadSdsReferenceCurves, type SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { RefreshControls } from "./RefreshControls";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

const HORIZON: SdsRoiHorizonKey = "pre_5";

const TILE_BG: Record<"green" | "amber" | "red" | "muted", string> = {
  green: "border-emerald-300/70 bg-emerald-50/95",
  amber: "border-amber-300/70 bg-amber-50/95",
  red: "border-rose-300/70 bg-rose-50/95",
  muted: "border-[rgb(var(--border))]/55 bg-white/90",
};

function MetricTile({
  label,
  value,
  sub,
  tone = "muted",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red" | "muted";
  icon: string;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 min-w-[118px] ${TILE_BG[tone]}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-base leading-none" aria-hidden>
          {icon}
        </span>
        <p className="text-[9px] uppercase tracking-wide text-ink-muted truncate">{label}</p>
      </div>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 ${toneClass(tone)}`}>{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted mt-0.5">{sub}</p> : null}
    </div>
  );
}

function RoiTemporalConvergenceChart({
  points,
  it,
  nWithActual,
  nSimCohort,
}: {
  points: RoiTemporalConvergencePoint[];
  it: boolean;
  nWithActual: number;
  nSimCohort: number;
}) {
  const t = useT();
  const data = points
    .map((p) => ({
      offset: p.offset,
      label: p.label,
      sdsMean: p.sds.meanAbsErrPp,
      sdsSd: p.sds.sdAbsErrPp,
      sdsN: p.sds.n,
      predMean: p.pred.meanAbsErrPp,
      predSd: p.pred.sdAbsErrPp,
      predN: p.pred.n,
      blendMean: p.blend.meanAbsErrPp,
      blendSd: p.blend.sdAbsErrPp,
      blendN: p.blend.n,
    }))
    .filter((p) => p.sdsN > 0 || p.predN > 0 || p.blendN > 0);

  if (!data.length) {
    return (
      <div className={`${CHART_CURVES_PANEL} px-3 py-4 text-center`}>
        <p className="text-[11px] text-ink-muted">{t("modelLab.qc.sdsRoi.temporalConvergence.awaiting")}</p>
        {nSimCohort > 0 ? (
          <p className="text-[10px] text-ink-muted mt-1 tabular-nums">
            {nSimCohort} {it ? "eventi Simulation tracciati" : "Simulation events tracked"} · {nWithActual}{" "}
            {it ? "con ROI realizzato" : "with realized ROI"}
          </p>
        ) : null}
      </div>
    );
  }

  const yVals = data.flatMap((p) =>
    [p.sdsMean, p.predMean, p.blendMean].filter((v): v is number => v != null),
  );
  const yMax = Math.max(...yVals, 1) * 1.15;

  return (
    <div className={`${CHART_CURVES_PANEL} p-3`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink mb-0.5">
        {t("modelLab.qc.sdsRoi.temporalConvergence.title")}
      </p>
      <p className="text-[9px] text-ink-muted mb-2 leading-snug max-w-3xl">
        {t("modelLab.qc.sdsRoi.temporalConvergence.subtitle")}
      </p>
      {nWithActual > 0 ? (
        <p className="text-[9px] text-ink tabular-nums mb-2">
          n={nWithActual}/{nSimCohort} {it ? "con ROI storico" : "with historical ROI"}
        </p>
      ) : null}
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid {...CHART_CURVES_GRID} vertical={false} />
            <XAxis
              dataKey="offset"
              type="number"
              domain={[-60, 10]}
              ticks={points.map((p) => p.offset)}
              tick={CHART_CURVES_AXIS_TICK}
              axisLine={CHART_CURVES_AXIS_LINE}
              tickLine={false}
              tickFormatter={(v: number) => {
                const pt = points.find((p) => p.offset === v);
                return pt?.label ?? String(v);
              }}
            />
            <YAxis
              domain={[0, yMax]}
              tick={CHART_CURVES_AXIS_TICK}
              axisLine={CHART_CURVES_AXIS_LINE}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${Number(v).toFixed(0)}`}
              label={{
                value: t("modelLab.qc.sdsRoi.temporalConvergence.yAxis"),
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 9,
              }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as (typeof data)[number];
                const fmt = (mean: number | null, sd: number | null, n: number) =>
                  mean != null ? `${mean.toFixed(1)} ± ${(sd ?? 0).toFixed(1)} pp (n=${n})` : "—";
                return (
                  <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] shadow-md">
                    <p className="font-semibold text-ink mb-1">{row.label}</p>
                    <p className="text-blue-700">
                      {t("modelLab.qc.sdsRoi.temporalConvergence.legend.sds")}:{" "}
                      {fmt(row.sdsMean, row.sdsSd, row.sdsN)}
                    </p>
                    <p className="text-teal-700">
                      {t("modelLab.qc.sdsRoi.temporalConvergence.legend.pred")}:{" "}
                      {fmt(row.predMean, row.predSd, row.predN)}
                    </p>
                    <p className="text-violet-700">
                      {t("modelLab.qc.sdsRoi.temporalConvergence.legend.blend")}:{" "}
                      {fmt(row.blendMean, row.blendSd, row.blendN)}
                    </p>
                  </div>
                );
              }}
            />
            <Legend {...chartCurvesLegendStyle()} wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
            <Line
              type="monotone"
              dataKey="sdsMean"
              name={t("modelLab.qc.sdsRoi.temporalConvergence.legend.sds")}
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#2563eb", strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            >
              <ErrorBar dataKey="sdsSd" width={6} stroke="#2563eb" strokeOpacity={0.45} direction="y" />
            </Line>
            <Line
              type="monotone"
              dataKey="predMean"
              name={t("modelLab.qc.sdsRoi.temporalConvergence.legend.pred")}
              stroke="#0d9488"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#0d9488", strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            >
              <ErrorBar dataKey="predSd" width={6} stroke="#0d9488" strokeOpacity={0.45} direction="y" />
            </Line>
            <Line
              type="monotone"
              dataKey="blendMean"
              name={t("modelLab.qc.sdsRoi.temporalConvergence.legend.blend")}
              stroke="#7c3aed"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#7c3aed", strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            >
              <ErrorBar dataKey="blendSd" width={6} stroke="#7c3aed" strokeOpacity={0.45} direction="y" />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MaeTrendChart({
  points,
  it,
}: {
  points: SdsRoiSimMaeTrendPoint[];
  it: boolean;
}) {
  if (points.length < 2) return null;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-white/95 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-0.5">
        {it ? "MAE cumulativo — Simulation" : "Cumulative MAE — Simulation"}
      </p>
      <p className="text-[9px] text-ink-muted mb-2">
        {it
          ? "Si aggiorna man mano che nuovi eventi Simulation maturano e ottengono ROI reale."
          : "Updates as new Simulation events mature and receive realized ROI."}
      </p>
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
            <XAxis dataKey="chartLabel" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} unit=" pp" width={34} />
            <ReferenceLine y={8} stroke="#059669" strokeDasharray="4 4" strokeOpacity={0.5} />
            <ReferenceLine y={20} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as SdsRoiSimMaeTrendPoint;
                return (
                  <div className="rounded-md border bg-white px-2 py-1 text-[10px] shadow-md">
                    <p className="font-semibold">{d.ticker}</p>
                    <p>
                      MAE: {fmtPp(d.maePp, 1)} · n={d.n}
                    </p>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="maePp"
              name="MAE"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 3, fill: "#6366f1" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DidascaliaBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

function BlendHorizonCurveChart({
  points,
  it,
}: {
  points: BlendHorizonCurvePoint[];
  it: boolean;
}) {
  const data = points.filter((p) => p.predAvg != null || p.blendAvg != null);
  if (data.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-violet-200/70 bg-violet-50/10 px-3 py-4 text-center">
        <p className="text-[11px] text-ink-muted">
          {it
            ? "Servono almeno 2 nodi (T−10 / T−5 / T+4) con stime Pred o μ blend — Refresh SDS o Simulation charts."
            : "Need at least 2 horizon knots (T−10 / T−5 / T+4) with Pred or μ blend estimates — run SDS refresh or load Simulation charts."}
        </p>
      </div>
    );
  }

  const vals = data.flatMap((p) => [p.predAvg, p.blendAvg].filter((v): v is number => v != null));
  const lo = Math.min(...vals, 0) - 2;
  const hi = Math.max(...vals, 0) + 2;

  return (
    <div className="rounded-lg border border-violet-200/60 bg-gradient-to-br from-white via-blue-50/25 to-violet-50/25 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-0.5">
        {it ? "Curva media coorte — Pred vs μ blend" : "Cohort mean curve — Pred vs μ blend"}
      </p>
      <p className="text-[9px] text-ink-muted mb-2">
        {it
          ? "Due linee sui nodi calendario T−10 / T−5 / T+4 (% vs T−60) · media delle opportunità Simulation"
          : "Dual lines at calendar knots T−10 / T−5 / T+4 (% vs T−60) · Simulation cohort average"}
      </p>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis
              domain={[lo, hi]}
              tick={{ fontSize: 9 }}
              unit="%"
              width={36}
              tickFormatter={(v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(0)}`}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as BlendHorizonCurvePoint;
                return (
                  <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                    <p className="font-semibold">{d.label}</p>
                    {d.predAvg != null ? <p className="text-blue-700">Pred+Recal: {fmtPct(d.predAvg)} (n={d.nPred})</p> : null}
                    {d.blendAvg != null ? <p className="text-violet-700">μ blend: {fmtPct(d.blendAvg)} (n={d.nBlend})</p> : null}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="predAvg"
              name={it ? "Pred+Recal (media)" : "Pred+Recal (mean)"}
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#3b82f6" }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="blendAvg"
              name={it ? "μ blend SDS (media)" : "μ SDS blend (mean)"}
              stroke="#8b5cf6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#8b5cf6" }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BlendConvergenceTimelineChart({
  events,
  it,
  horizonLabelText,
}: {
  events: BlendTimelinePoint[];
  it: boolean;
  horizonLabelText: string;
}) {
  const data = events.filter((e) => e.predictedPred != null || e.predictedBlend != null);
  if (!data.length) return null;

  const vals = data.flatMap((e) =>
    [
      e.predictedPred,
      e.predictedBlend,
      e.actual,
    ].filter((v): v is number => v != null),
  );
  const lo = Math.min(...vals, 0) - 3;
  const hi = Math.max(...vals, 0) + 3;

  return (
    <div className="rounded-lg border border-violet-200/60 bg-gradient-to-br from-white via-violet-50/20 to-blue-50/20 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-0.5">
        {it ? "Stime Pred vs μ blend — nel tempo" : "Pred vs μ blend estimates — over time"}
      </p>
      <p className="text-[9px] text-ink-muted mb-2">
        {it
          ? `Orizzonte ${horizonLabelText} · blu = Pred+Recal · viola = μ blend SDS · verde = ROI reale`
          : `${horizonLabelText} horizon · blue = Pred+Recal · violet = μ SDS blend · green = realized ROI`}
      </p>
      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
            <XAxis
              dataKey="chartLabel"
              tick={{ fontSize: 9 }}
              interval={0}
              angle={data.length > 8 ? -35 : 0}
              textAnchor={data.length > 8 ? "end" : "middle"}
              height={data.length > 8 ? 48 : 24}
            />
            <YAxis
              domain={[lo, hi]}
              tick={{ fontSize: 9 }}
              unit="%"
              width={36}
              tickFormatter={(v) => `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(0)}`}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as BlendTimelinePoint;
                return (
                  <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md max-w-[220px]">
                    <p className="font-semibold">
                      {d.ticker}
                      <span className="font-normal text-ink-muted"> · {d.completionDate}</span>
                    </p>
                    {d.predictedPred != null ? (
                      <p>
                        Pred+Recal: {fmtPct(d.predictedPred)}
                      </p>
                    ) : null}
                    {d.predictedBlend != null ? (
                      <p>
                        μ blend: {fmtPct(d.predictedBlend)}
                      </p>
                    ) : null}
                    {d.actual != null ? (
                      <p>
                        {it ? "Reale" : "Act."}: {fmtPct(d.actual)}
                      </p>
                    ) : (
                      <span className="text-amber-700">
                        {it ? "in attesa CD+14g" : "pending CD+14d"}
                      </span>
                    )}
                    {d.errorPredPp != null ? (
                      <p className={toneClass(errorTone(d.errorPredPp))}>
                        Pred Δ {fmtPp(d.errorPredPp, 1)}
                      </p>
                    ) : null}
                    {d.errorBlendPp != null ? (
                      <p className={toneClass(errorTone(d.errorBlendPp))}>
                        Blend Δ {fmtPp(d.errorBlendPp, 1)}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value) =>
                value === "predictedPred"
                  ? "Pred+Recal"
                  : value === "predictedBlend"
                    ? it
                      ? "μ blend SDS"
                      : "μ SDS blend"
                    : value === "actual"
                      ? it
                        ? "ROI reale"
                        : "Realized ROI"
                      : value
              }
            />
            <Bar
              dataKey="predictedPred"
              name="predictedPred"
              fill="#3b82f6"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              opacity={0.9}
            />
            <Bar
              dataKey="predictedBlend"
              name="predictedBlend"
              fill="#8b5cf6"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              opacity={0.9}
            />
            <Bar
              dataKey="actual"
              name="actual"
              fill="#059669"
              radius={[3, 3, 0, 0]}
              maxBarSize={16}
              opacity={0.92}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BlendMaeTrendChart({
  points,
  it,
}: {
  points: BlendMaeTrendPoint[];
  it: boolean;
}) {
  if (points.length < 2) return null;

  return (
    <div className="rounded-lg border border-violet-200/50 bg-white/95 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-0.5">
        {it ? "MAE cumulativo Pred vs blend" : "Cumulative MAE — Pred vs blend"}
      </p>
      <p className="text-[9px] text-ink-muted mb-2">
        {it
          ? "Due curve: errore medio assoluto man mano che gli eventi Simulation maturano."
          : "Dual curves: mean absolute error as Simulation events mature."}
      </p>
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
            <XAxis dataKey="chartLabel" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9 }} unit=" pp" width={34} />
            <ReferenceLine y={8} stroke="#059669" strokeDasharray="4 4" strokeOpacity={0.5} />
            <ReferenceLine y={20} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as BlendMaeTrendPoint;
                return (
                  <div className="rounded-md border bg-white px-2 py-1 text-[10px] shadow-md">
                    <p className="font-semibold">{d.ticker}</p>
                    {d.maePredPp != null ? (
                      <p className="text-blue-700">
                        Pred MAE: {fmtPp(d.maePredPp, 1)} · n={d.nPred}
                      </p>
                    ) : null}
                    {d.maeBlendPp != null ? (
                      <p className="text-violet-700">
                        Blend MAE: {fmtPp(d.maeBlendPp, 1)} · n={d.nBlend}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="maePredPp"
              name={it ? "MAE Pred+Recal" : "MAE Pred+Recal"}
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3, fill: "#3b82f6" }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="maeBlendPp"
              name={it ? "MAE μ blend" : "MAE μ blend"}
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ r: 3, fill: "#8b5cf6" }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BlendErrorCompareChart({
  rows,
  it,
}: {
  rows: BlendVsPredEventRow[];
  it: boolean;
}) {
  const data = rows
    .filter((r) => r.errorPredPp != null || r.errorBlendPp != null)
    .map((r) => ({
      ticker: r.ticker,
      absPred: r.errorPredPp != null ? Math.abs(r.errorPredPp) : null,
      absBlend: r.errorBlendPp != null ? Math.abs(r.errorBlendPp) : null,
      blendBetter: r.blendBetter,
    }));
  if (!data.length) return null;

  return (
    <div className="rounded-lg border border-violet-200/60 bg-gradient-to-br from-white via-violet-50/20 to-indigo-50/15 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-0.5">
        {it ? "Errore assoluto — Pred vs μ blend" : "Absolute error — Pred vs μ blend"}
      </p>
      <p className="text-[9px] text-ink-muted mb-2">
        {it
          ? "Barre più basse = migliore · viola = blend SDS vince sul prediction"
          : "Lower bars = better · violet tint = SDS blend beats prediction"}
      </p>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
            <XAxis
              dataKey="ticker"
              tick={{ fontSize: 9 }}
              interval={0}
              angle={data.length > 6 ? -30 : 0}
              textAnchor={data.length > 6 ? "end" : "middle"}
              height={data.length > 6 ? 44 : 24}
            />
            <YAxis tick={{ fontSize: 9 }} unit=" pp" width={36} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                    <p className="font-semibold">{d.ticker}</p>
                    <p>Pred |Δ|: {d.absPred != null ? `${d.absPred.toFixed(1)} pp` : "—"}</p>
                    <p>Blend |Δ|: {d.absBlend != null ? `${d.absBlend.toFixed(1)} pp` : "—"}</p>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="absPred" name={it ? "Pred+Recal" : "Pred+Recal"} fill="#3b82f6" maxBarSize={18} radius={[2, 2, 0, 0]} />
            <Bar dataKey="absBlend" name={it ? "μ blend SDS" : "μ SDS blend"} fill="#8b5cf6" maxBarSize={18} radius={[2, 2, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SimScatterChart({ points, it }: { points: SdsRoiSimScatterPoint[]; it: boolean }) {
  if (points.length < 2) return null;
  const vals = points.flatMap((p) => [p.actual, p.predicted]);
  const lo = Math.min(...vals, 0) - 5;
  const hi = Math.max(...vals, 0) + 5;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-gradient-to-br from-white via-emerald-50/20 to-amber-50/25 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-2">
        {it ? "Convergenza stima ↔ reale" : "Estimate ↔ realized convergence"}
      </p>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis
              type="number"
              dataKey="actual"
              name={it ? "Reale" : "Actual"}
              unit="%"
              domain={[lo, hi]}
              tick={{ fontSize: 9 }}
            />
            <YAxis
              type="number"
              dataKey="predicted"
              name={it ? "Stimato" : "Est."}
              unit="%"
              domain={[lo, hi]}
              tick={{ fontSize: 9 }}
              width={36}
            />
            <ZAxis range={[52, 52]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const p = payload[0].payload as SdsRoiSimScatterPoint;
                return (
                  <div className="rounded-md border bg-white px-2 py-1.5 text-[10px] shadow-md">
                    <p className="font-semibold">{p.ticker}</p>
                    <p>
                      {it ? "Stimato" : "Est."}: {fmtPct(p.predicted)} · {it ? "Reale" : "Act."}:{" "}
                      {fmtPct(p.actual)}
                    </p>
                    <p className={toneClass(errorTone(p.errorPp))}>Δ {fmtPp(p.errorPp, 1)}</p>
                  </div>
                );
              }}
            />
            <ReferenceLine segment={[{ x: lo, y: lo }, { x: hi, y: hi }]} stroke="#94a3b8" strokeDasharray="4 4" />
            <Scatter name={it ? "Simulation" : "Simulation"} data={points} fill="#2563eb">
              {points.map((p, i) => (
                <Cell
                  key={`${p.ticker}-${i}`}
                  fill={
                    Math.abs(p.errorPp) <= 8 ? "#059669" : Math.abs(p.errorPp) <= 20 ? "#d97706" : "#dc2626"
                  }
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[9px] text-ink-muted mt-1">
        {it ? "Linea = previsione perfetta · punti vicini = buona convergenza" : "Line = perfect forecast · close points = good convergence"}
      </p>
    </div>
  );
}

function BlendEvalVerdictStrip({
  summary,
  it,
}: {
  summary: import("../sheet/sdsRoiBlendEval").BlendVsPredHorizonSummary;
  it: boolean;
}) {
  const maeWinner =
    summary.maePredPp != null && summary.maeBlendPp != null
      ? summary.maeBlendPp < summary.maePredPp - 0.05
        ? "blend"
        : summary.maePredPp < summary.maeBlendPp - 0.05
          ? "pred"
          : "tie"
      : null;
  const hitWinner =
    summary.hitRatePred != null && summary.hitRateBlend != null
      ? summary.hitRateBlend > summary.hitRatePred + 0.5
        ? "blend"
        : summary.hitRatePred > summary.hitRateBlend + 0.5
          ? "pred"
          : "tie"
      : null;

  if (maeWinner == null && hitWinner == null) return null;

  const label = (kind: "mae" | "hit", winner: "pred" | "blend" | "tie") => {
    if (winner === "tie") return kind === "mae" ? (it ? "MAE: pari" : "MAE: tie") : it ? "Hit segno: pari" : "Sign hit: tie";
    const name = winner === "blend" ? (it ? "μ blend SDS" : "μ SDS blend") : "Pred+Recal";
    return kind === "mae" ? (it ? `MAE migliore: ${name}` : `Lower MAE: ${name}`) : it ? `Hit segno migliore: ${name}` : `Sign hit: ${name}`;
  };

  return (
    <div className="flex flex-wrap gap-2 text-[10px]">
      {maeWinner ? (
        <span
          className={`rounded-full border px-2.5 py-1 font-medium ${
            maeWinner === "blend"
              ? "border-violet-300/70 bg-violet-50 text-violet-900"
              : maeWinner === "pred"
                ? "border-blue-300/70 bg-blue-50 text-blue-900"
                : "border-slate-300/60 bg-slate-50 text-ink-muted"
          }`}
        >
          {label("mae", maeWinner)}
        </span>
      ) : null}
      {hitWinner ? (
        <span
          className={`rounded-full border px-2.5 py-1 font-medium ${
            hitWinner === "blend"
              ? "border-violet-300/70 bg-violet-50 text-violet-900"
              : hitWinner === "pred"
                ? "border-blue-300/70 bg-blue-50 text-blue-900"
                : "border-slate-300/60 bg-slate-50 text-ink-muted"
          }`}
        >
          {label("hit", hitWinner)}
        </span>
      ) : null}
    </div>
  );
}

export function SdsRoiForecastPanel({ reloadToken = 0 }: { reloadToken?: number }) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backtest, setBacktest] = useState<SdsRoiBacktestScoresDoc | null>(null);
  const [forecast, setForecast] = useState<SdsRoiForecastLogDoc | null>(null);
  const [sdsSnap, setSdsSnap] = useState<SdsSnapshotDoc | null>(null);
  const [simSnap, setSimSnap] = useState<SimulationSheetSnapshotDoc | null>(null);
  const [chartBundle, setChartBundle] = useState<Awaited<ReturnType<typeof loadSimulationChartsBundle>>["bundle"]>(null);
  const [refCurves, setRefCurves] = useState<Partial<Record<SdsRoiProfileId, (number | null)[]>>>({});
  const [sdsRows, setSdsRows] = useState<SdsRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const scoredBeforeRefresh = useRef<number | null>(null);

  const reloadSources = useCallback(async () => {
    const [sources, charts, refs, sds] = await Promise.all([
      loadSdsRoiConvergenceSources(),
      loadSimulationChartsBundle(),
      loadSdsReferenceCurves(),
      loadSdsCohort(false),
    ]);
    setBacktest(sources.backtest);
    setForecast(sources.forecast);
    setSdsSnap(sources.sdsSnap);
    setSimSnap(sources.simSnap);
    setChartBundle(charts.bundle);
    setRefCurves(refs.refs);
    setSdsRows(sds.rows ?? []);
    setError(
      !sources.backtest && !sources.forecast && !sources.sdsSnap && !sources.simSnap
        ? tr("modelLab.qc.sdsRoi.emptyData")
        : null,
    );
    return sources;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reloadSources()
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, reloadSources]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshNote(null);
    scoredBeforeRefresh.current = buildSdsRoiSimConvergenceView(
      forecast,
      sdsSnap,
      simSnap,
      backtest,
      HORIZON,
    ).summary.nScored;

    let apiOk = true;
    try {
      await refreshSdsCohort({ fetchFmp: false, fetchClusterA: true });
    } catch {
      apiOk = false;
    }

    try {
      const sources = await reloadSources();
      const nextView = buildSdsRoiSimConvergenceView(
        sources.forecast,
        sources.sdsSnap,
        sources.simSnap,
        sources.backtest,
        HORIZON,
      );
      const prev = scoredBeforeRefresh.current ?? 0;
      const delta = nextView.summary.nScored - prev;
      if (delta > 0) {
        setRefreshNote(t("modelLab.qc.sdsRoi.refreshProgress", { n: String(delta) }));
      } else if (!apiOk) {
        setRefreshNote(t("modelLab.qc.sdsRoi.refreshLocalOnly"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, [backtest, forecast, reloadSources, sdsSnap, simSnap, t]);

  const view = useMemo(
    () => buildSdsRoiSimConvergenceView(forecast, sdsSnap, simSnap, backtest, HORIZON),
    [forecast, sdsSnap, simSnap, backtest],
  );

  const blendEval = useMemo(
    () =>
      buildSdsRoiBlendEvalView(forecast, sdsSnap, simSnap, HORIZON, {
        chartBundle,
        refCurves,
        sdsRows,
      }),
    [forecast, sdsSnap, simSnap, chartBundle, refCurves, sdsRows],
  );

  const temporalConvergence = useMemo(
    () =>
      buildRoiTemporalConvergenceView(forecast, sdsSnap, simSnap, backtest, {
        chartBundle,
        refCurves,
        sdsRows,
      }),
    [forecast, sdsSnap, simSnap, backtest, chartBundle, refCurves, sdsRows],
  );

  const pendingEvents = useMemo(
    () => view.events.filter((e) => e.status === "pending").slice(0, 12),
    [view.events],
  );

  const maeToneVal = maeTone(view.summary.maePp);
  const hzLabel = horizonLabel(HORIZON, it);
  const dataUpdatedAt = forecast?.updated_at ?? sdsSnap?.generated_at ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <span aria-hidden>📈</span>
            {t("modelLab.qc.sdsRoi.title")}
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5 leading-snug max-w-2xl">
            {t("modelLab.qc.sdsRoi.lead")}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 ml-auto">
          <RefreshControls
            onRefresh={handleRefresh}
            loading={refreshing}
            loadingLabel={it ? "Aggiornamento SDS…" : "Updating SDS…"}
            tooltip={t("refresh.page.sdsRoiConvergence.tooltip")}
            extraInfo={
              dataUpdatedAt
                ? `${view.summary.nScored} scored · ${view.summary.nPending} pending`
                : undefined
            }
            className="shrink-0"
          />
          <div className="flex flex-wrap gap-1 text-[9px] text-ink-muted">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5">
              <span className="text-emerald-600">●</span> {it ? "buono ≤8pp" : "good ≤8pp"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5">
              <span className="text-amber-600">●</span> {it ? "medio ≤20pp" : "ok ≤20pp"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300/60 bg-rose-50 px-2 py-0.5">
              <span className="text-rose-600">●</span> {it ? "lontano" : "far"}
            </span>
          </div>
        </div>
      </div>

      <DidascaliaBox title={t("modelLab.qc.sdsRoi.caption.title")}>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("modelLab.qc.sdsRoi.caption.body")}</p>
      </DidascaliaBox>

      <DidascaliaBox title={t("modelLab.qc.sdsRoi.blendEval.title")}>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("modelLab.qc.sdsRoi.blendEval.body")}</p>
        <ol className="text-[10px] text-ink-muted list-decimal list-inside space-y-0.5 mt-1">
          <li>{t("modelLab.qc.sdsRoi.blendEval.step1")}</li>
          <li>{t("modelLab.qc.sdsRoi.blendEval.step2")}</li>
          <li>{t("modelLab.qc.sdsRoi.blendEval.step3")}</li>
        </ol>
      </DidascaliaBox>

      {!loading ? (
        <div className="rounded-lg border border-violet-200/50 bg-violet-50/15 p-3 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-900/80">
            {t("modelLab.qc.sdsRoi.blendEval.panelTitle", { horizon: hzLabel })}
          </p>

          {blendEval.hasData ? (
            <>
              <div className="flex flex-wrap gap-2">
                <MetricTile
                  label={t("modelLab.qc.sdsRoi.blendEval.maePred")}
                  value={blendEval.summary.maePredPp != null ? fmtPp(blendEval.summary.maePredPp, 1) : "—"}
                  sub={
                    blendEval.summary.hitRatePred != null
                      ? `${it ? "hit segno" : "sign hit"} ${blendEval.summary.hitRatePred}%`
                      : undefined
                  }
                  tone={maeTone(blendEval.summary.maePredPp)}
                  icon="📐"
                />
                <MetricTile
                  label={t("modelLab.qc.sdsRoi.blendEval.maeBlend")}
                  value={blendEval.summary.maeBlendPp != null ? fmtPp(blendEval.summary.maeBlendPp, 1) : "—"}
                  sub={
                    blendEval.summary.hitRateBlend != null
                      ? `${it ? "hit segno" : "sign hit"} ${blendEval.summary.hitRateBlend}%`
                      : undefined
                  }
                  tone={maeTone(blendEval.summary.maeBlendPp)}
                  icon="🟣"
                />
                <MetricTile
                  label={t("modelLab.qc.sdsRoi.blendEval.blendWins")}
                  value={
                    blendEval.summary.blendBetterPct != null
                      ? `${blendEval.summary.blendBetterPct}%`
                      : "—"
                  }
                  sub={
                    blendEval.summary.nComparable != null
                      ? `${blendEval.summary.blendBetterN ?? 0}/${blendEval.summary.nComparable}`
                      : undefined
                  }
                  tone={
                    (blendEval.summary.blendBetterPct ?? 0) >= 55
                      ? "green"
                      : (blendEval.summary.blendBetterPct ?? 0) >= 40
                        ? "amber"
                        : "muted"
                  }
                  icon="⚖"
                />
              </div>
              <BlendEvalVerdictStrip summary={blendEval.summary} it={it} />
            </>
          ) : null}

          <ViewErrorBoundary label="SDS blend curve">
            <BlendHorizonCurveChart points={blendEval.horizonCurve} it={it} />
          </ViewErrorBoundary>

          {blendEval.hasData ? (
            <>
              {blendEval.hasTimeline ? (
                <BlendConvergenceTimelineChart
                  events={blendEval.timeline}
                  it={it}
                  horizonLabelText={hzLabel}
                />
              ) : null}
              {blendEval.hasMaeTrend || blendEval.scoredRows.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {blendEval.hasMaeTrend ? (
                    <BlendMaeTrendChart points={blendEval.maeTrend} it={it} />
                  ) : (
                    <p className="text-[10px] text-ink-muted rounded border border-dashed border-violet-200/70 px-3 py-3">
                      {t("modelLab.qc.sdsRoi.blendEval.awaitingHistory")}
                    </p>
                  )}
                  {blendEval.scoredRows.length > 0 ? (
                    <BlendErrorCompareChart rows={blendEval.scoredRows} it={it} />
                  ) : null}
                </div>
              ) : blendEval.pendingRows.length > 0 ? (
                <p className="text-[10px] text-ink-muted rounded border border-dashed border-violet-200/70 px-3 py-3">
                  {t("modelLab.qc.sdsRoi.blendEval.awaitingHistory")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-[10px] text-ink-muted rounded border border-dashed border-violet-200/60 px-3 py-3">
              {t("modelLab.qc.sdsRoi.blendEval.noEstimates")}
            </p>
          )}
        </div>
      ) : null}

      {refreshNote ? (
        <p className="text-xs text-emerald-800 rounded-lg border border-emerald-200/80 bg-emerald-50/90 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>✓</span> {refreshNote}
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-warn rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 flex items-center gap-2">
          <span aria-hidden>⚠</span> {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <MetricTile
          label={it ? "Scored Simulation" : "Scored Simulation"}
          value={String(view.summary.nScored)}
          sub={it ? `ROI reale a ${hzLabel}` : `realized ROI at ${hzLabel}`}
          tone={view.summary.nScored > 0 ? "green" : "muted"}
          icon={qcStatusIcon(view.summary.nScored > 0 ? "good" : "wait")}
        />
        <MetricTile
          label={it ? "In attesa" : "Pending"}
          value={String(view.summary.nPending)}
          sub={it ? "CD+14g non ancora maturo" : "CD+14d not yet mature"}
          tone="muted"
          icon={qcStatusIcon("wait")}
        />
        <MetricTile
          label={it ? "MAE Simulation" : "Simulation MAE"}
          value={view.summary.maePp != null ? fmtPp(view.summary.maePp, 1) : "—"}
          sub={
            view.summary.meanSignedErrPp != null
              ? `${it ? "bias" : "bias"} ${fmtPp(view.summary.meanSignedErrPp, 1)}`
              : hzLabel
          }
          tone={maeToneVal}
          icon={qcStatusIcon(qcStatusIconFromMae(view.summary.maePp))}
        />
        <MetricTile
          label={it ? "Coorte Simulation" : "Simulation cohort"}
          value={String(view.summary.nSimTracked)}
          sub={
            sdsSnap?.generated_at
              ? new Date(sdsSnap.generated_at).toLocaleString(it ? "it-IT" : "en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : undefined
          }
          tone="muted"
          icon="🧪"
        />
      </div>

      {!loading ? <SdsClusterCoverageSection sdsSnap={sdsSnap} simSnap={simSnap} it={it} /> : null}

      {loading ? (
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-8 text-center text-sm text-ink-muted">
          {it ? "Caricamento convergenza SDS↔ROI…" : "Loading SDS↔ROI convergence…"}
        </div>
      ) : view.hasTimeline || temporalConvergence.hasCurve ? (
        <ViewErrorBoundary label="ROI temporal convergence">
          <RoiTemporalConvergenceChart
            points={temporalConvergence.points}
            it={it}
            nWithActual={temporalConvergence.nWithActual}
            nSimCohort={temporalConvergence.nSimCohort}
          />
        </ViewErrorBoundary>
      ) : (
        <p className="text-[11px] text-ink-muted rounded-lg border border-dashed border-amber-200/80 bg-amber-50/50 px-3 py-4 flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            ⏳
          </span>
          {t("modelLab.qc.sdsRoi.forwardEmpty")}
        </p>
      )}

      {!loading && (view.hasScatter || view.maeTrend.length >= 2) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <MaeTrendChart points={view.maeTrend} it={it} />
          <SimScatterChart points={view.scatter} it={it} />
        </div>
      )}

      {!loading && pendingEvents.length > 0 ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-surface/25 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted mb-2">
            {t("modelLab.qc.sdsRoi.pendingSim")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pendingEvents.map((ev) => (
              <span
                key={ev.key}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200/70 bg-blue-50/80 px-2 py-0.5 text-[10px] tabular-nums"
                title={`${ev.completionDate} · ${it ? "stima" : "est."} ${fmtPct(ev.predicted)}`}
              >
                <span className="font-semibold text-ink">{ev.ticker}</span>
                <span className="text-ink-muted">{fmtPct(ev.predicted)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
