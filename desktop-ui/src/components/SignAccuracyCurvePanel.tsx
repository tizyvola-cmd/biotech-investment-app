import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AccuracySummaryDoc } from "../data/accuracyModelData";
import type { SignCurveDailyDoc } from "../data/signCurveDailyData";
import {
  buildSignAccuracyCurveView,
  formatSignPeakOffset,
  peakSignHitFromPoints,
  signChartYDomain,
  signHitToneClass,
  type SignCurvePoint,
} from "../sheet/signAccuracyCurve";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

type ChartRow = SignCurvePoint & { chartLabel: string };

function DualLineTooltip({
  active,
  payload,
  it,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartRow; dataKey?: string; value?: number; color?: string }>;
  it: boolean;
  mode: "sign" | "price";
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const retroVal = mode === "sign" ? p.retroSignPct : p.retroPricePct;
  const simVal = mode === "sign" ? p.simSignPct : p.simPricePct;
  return (
    <div className="rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2 text-[11px] shadow-md space-y-0.5">
      <p className="font-semibold text-ink">
        {it ? "Giorni alla CD" : "Days to CD"}: {p.label}
      </p>
      <p className="text-ink-muted">
        {it ? "Storico" : "Historical"}:{" "}
        <span className="font-medium text-ink">
          {mode === "price"
            ? it
              ? `accuratezza ${fmtPct(retroVal)}`
              : `accuracy ${fmtPct(retroVal)}`
            : fmtPct(retroVal)}
        </span>
        {p.retroN > 0 ? ` · n=${p.retroN}` : ""}
      </p>
      <p className="text-ink-muted">
        Simulation:{" "}
        <span className="font-medium text-ink">
          {mode === "price"
            ? it
              ? `accuratezza ${fmtPct(simVal)}`
              : `accuracy ${fmtPct(simVal)}`
            : fmtPct(simVal)}
        </span>
        {p.simN > 0 ? ` · n=${p.simN}` : ""}
      </p>
    </div>
  );
}

function CohortChart({
  title,
  caption,
  data,
  mode,
  retroLabel,
  simLabel,
  compact,
  it,
  peakLabel,
}: {
  title: string;
  caption: string;
  data: ChartRow[];
  mode: "sign" | "price";
  retroLabel: string;
  simLabel: string;
  compact: boolean;
  it: boolean;
  peakLabel?: string | null;
}) {
  const retroKey = mode === "sign" ? "retroSignPct" : "retroPricePct";
  const simKey = mode === "sign" ? "simSignPct" : "simPricePct";
  const hasRetro = data.some((p) => p[retroKey] != null && p.retroN > 0);
  const hasSim = data.some((p) => p[simKey] != null && p.simN > 0);
  const yAxis = useMemo(() => signChartYDomain(data, mode), [data, mode]);

  if (!hasRetro && !hasSim) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium text-ink">{title}</p>
      <p className="text-[9px] text-ink-muted">{caption}</p>
      <div className={compact ? "h-[220px] w-full min-h-[180px]" : "h-[280px] w-full min-h-[220px]"}>
        <ViewErrorBoundary label={title}>
          <ResponsiveContainer width="100%" height="100%" minHeight={compact ? 180 : 220}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              <XAxis
                dataKey="chartLabel"
                tick={{ fontSize: 9 }}
                interval="preserveStartEnd"
                height={32}
              />
              <YAxis
                domain={yAxis.domain}
                tick={{ fontSize: 9 }}
                unit="%"
                ticks={yAxis.ticks}
                width={36}
              />
              <ReferenceLine y={50} stroke="#d97706" strokeDasharray="4 4" />
              {peakLabel ? (
                <ReferenceLine
                  x={peakLabel}
                  stroke="#2563eb"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{
                    value: it ? "picco" : "peak",
                    position: "insideTopLeft",
                    fill: "#2563eb",
                    fontSize: 8,
                  }}
                />
              ) : null}
              <Tooltip content={<DualLineTooltip it={it} mode={mode} />} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              {hasRetro ? (
                <Line
                  type="monotone"
                  dataKey={retroKey}
                  name={retroLabel}
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: "#2563eb" }}
                  connectNulls={false}
                />
              ) : null}
              {hasSim ? (
                <Line
                  type="monotone"
                  dataKey={simKey}
                  name={simLabel}
                  stroke="#ea580c"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 2.5, fill: "#ea580c" }}
                  connectNulls={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </ViewErrorBoundary>
      </div>
    </div>
  );
}

export type SignAccuracyCurvePanelProps = {
  summaryDoc?: AccuracySummaryDoc | null;
  dailyDoc?: SignCurveDailyDoc | null;
  compact?: boolean;
  /** Hide headline metric when shown in the anticipatory strong-signal row above. */
  hidePeakMetric?: boolean;
};

export function SignAccuracyCurvePanel({
  summaryDoc = null,
  dailyDoc = null,
  compact = false,
  hidePeakMetric = false,
}: SignAccuracyCurvePanelProps) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const view = useMemo(
    () => buildSignAccuracyCurveView(summaryDoc, dailyDoc),
    [summaryDoc, dailyDoc],
  );

  const chartData = useMemo((): ChartRow[] => {
    return [...view.points]
      .sort((a, b) => a.offset - b.offset)
      .map((p) => ({ ...p, chartLabel: p.label }));
  }, [view.points]);

  const peakSignHit = useMemo(() => peakSignHitFromPoints(chartData), [chartData]);

  const hasData = chartData.some(
    (p) =>
      p.retroSignPct != null ||
      p.simSignPct != null ||
      p.retroPricePct != null ||
      p.simPricePct != null,
  );

  const retroLabel = it
    ? (view.retro?.labelIt ?? "Corte storica")
    : (view.retro?.labelEn ?? "Historical cohort");
  const simLabel = it
    ? (view.simulation?.labelIt ?? "Simulation")
    : (view.simulation?.labelEn ?? "Simulation");

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.kpi.signCurve.title")}
          </p>
          {!hidePeakMetric ? (
            <p
              className={`text-lg font-semibold tabular-nums ${signHitToneClass(peakSignHit?.pct ?? view.preCdHitPct, view.metric)}`}
            >
              {fmtPct(peakSignHit?.pct ?? view.preCdHitPct)}
              {peakSignHit ? (
                <span className="text-[11px] font-normal text-ink-muted ml-1.5">
                  {t("modelLab.qc.kpi.signCurve.peakAt", {
                    offset: formatSignPeakOffset(peakSignHit.offset),
                  })}
                </span>
              ) : null}
            </p>
          ) : null}
          <p className="text-[9px] text-ink-muted leading-snug max-w-prose">
            {t("modelLab.qc.kpi.signCurve.dailyHint")}
          </p>
        </div>
        <div className="text-[9px] text-ink-muted tabular-nums shrink-0 text-right space-y-0.5">
          {view.retro?.nEvents != null ? (
            <p>
              {retroLabel}: {view.retro.nEvents} {it ? "trial" : "trials"}
              {view.retro.overallSignPct != null ? ` · ${fmtPct(view.retro.overallSignPct)} segno` : ""}
            </p>
          ) : null}
          {view.simulation?.nEvents != null && view.simulation.nEvents > 0 ? (
            <p>
              {simLabel}: {view.simulation.nEvents} {it ? "trial" : "trials"}
              {view.simulation.overallSignPct != null
                ? ` · ${fmtPct(view.simulation.overallSignPct)} segno`
                : ""}
            </p>
          ) : null}
        </div>
      </div>

      {!hasData ? (
        <p className="text-xs text-ink-muted py-4 text-center border border-dashed border-[rgb(var(--border))]/40 rounded-md">
          {t("modelLab.qc.kpi.signCurve.emptyDaily")}
        </p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <CohortChart
            title={t("modelLab.qc.kpi.signCurve.chartSignTitle")}
            caption={t("modelLab.qc.kpi.signCurve.chartSignCaption")}
            data={chartData}
            mode="sign"
            retroLabel={retroLabel}
            simLabel={simLabel}
            compact={compact}
            it={it}
            peakLabel={peakSignHit?.label ?? null}
          />
          <CohortChart
            title={t("modelLab.qc.kpi.signCurve.chartPriceTitle")}
            caption={t("modelLab.qc.kpi.signCurve.chartPriceCaption")}
            data={chartData}
            mode="price"
            retroLabel={retroLabel}
            simLabel={simLabel}
            compact={compact}
            it={it}
          />
        </div>
      )}
    </div>
  );
}
