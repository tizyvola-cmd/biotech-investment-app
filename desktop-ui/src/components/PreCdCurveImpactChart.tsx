import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CurveImpactCumulative } from "../data/signalCalibrationData";
import { useT } from "../shared/i18n";

type MetricMode = "mae" | "hit";
type ChartVariant = "historic" | "eis";

function CurveImpactMetricHelp({ mode }: { mode: MetricMode }) {
  const t = useT();
  return (
    <details className="relative">
      <summary
        className="cursor-pointer list-none select-none text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--border))]/50 text-ink-muted hover:text-ink hover:border-[rgb(var(--accent))]/40 [&::-webkit-details-marker]:hidden"
        title={t("preCd.curveImpact.metricHelp.openTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        {t("preCd.curveImpact.metricHelp.open")}
      </summary>
      <div
        role="note"
        className="absolute right-0 z-50 top-[calc(100%+4px)] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2.5 text-[10px] text-ink/90 shadow-[0_8px_28px_rgba(0,0,0,0.18)] leading-snug space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-semibold text-ink text-[11px]">{t("preCd.curveImpact.metricHelp.title")}</p>
        <div className="space-y-1.5">
          <p className="font-medium text-ink">{t("preCd.curveImpact.metricHelp.rmseTitle")}</p>
          <p className="text-ink-muted">{t("preCd.curveImpact.metricHelp.rmseBody")}</p>
          <p className="text-ink-muted">{t("preCd.curveImpact.metricHelp.rmseHow")}</p>
        </div>
        <div className="space-y-1.5 pt-1 border-t border-[rgb(var(--border))]/40">
          <p className="font-medium text-ink">{t("preCd.curveImpact.metricHelp.hitTitle")}</p>
          <p className="text-ink-muted">{t("preCd.curveImpact.metricHelp.hitBody")}</p>
          <p className="text-ink-muted">{t("preCd.curveImpact.metricHelp.hitHow")}</p>
        </div>
        <p className="text-[9px] text-ink-muted pt-1 border-t border-[rgb(var(--border))]/30">
          {t("preCd.curveImpact.metricHelp.activeMode", {
            mode: mode === "mae" ? t("preCd.curveImpact.modeMae") : t("preCd.curveImpact.modeHit"),
          })}
        </p>
      </div>
    </details>
  );
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function mapHistoricRow(
  row: NonNullable<CurveImpactCumulative["chart_series"]>[number],
  mode: MetricMode,
) {
  return {
    label: row.n != null ? `H#${row.n}` : "",
    n: row.n,
    day: row.day,
    ticker: row.ticker,
    base: mode === "mae" ? row.cum_mae_base : row.cum_hit_base_pct,
    daily:
      mode === "mae"
        ? (row.cum_mae_daily ?? row.cum_mae_recalib)
        : (row.cum_hit_daily_pct ?? row.cum_hit_recalib_pct),
    k8: mode === "mae" ? row.cum_mae_k8 : row.cum_hit_k8_pct,
  };
}

function mapEisRow(
  row: NonNullable<CurveImpactCumulative["enrichment_chart_series"]>[number],
  mode: MetricMode,
) {
  return {
    label: row.n != null ? `E#${row.n}` : "",
    n: row.n,
    day: row.day,
    ticker: row.ticker,
    enrichedAt: row.enriched_at,
    eisShiftPp: row.eis_shift_pp,
    raw:
      mode === "mae"
        ? (row.cum_mae_raw ?? row.cum_mae_base)
        : (row.cum_hit_raw_pct ?? row.cum_hit_base_pct),
    k8Hist:
      mode === "mae"
        ? (row.cum_mae_k8_historic ?? row.cum_mae_k8)
        : (row.cum_hit_k8_historic_pct ?? row.cum_hit_k8_pct),
    rawEis:
      mode === "mae"
        ? (row.cum_mae_raw_eis ?? row.cum_mae_eis)
        : (row.cum_hit_raw_eis_pct ?? row.cum_hit_eis_pct),
  };
}

export function PreCdCurveImpactChart({ impact }: { impact: CurveImpactCumulative | null | undefined }) {
  const t = useT();
  const [mode, setMode] = useState<MetricMode>("mae");

  const chartData = useMemo(
    () => (impact?.chart_series ?? []).map((row) => mapHistoricRow(row, mode)),
    [impact?.chart_series, mode],
  );

  const enrichmentData = useMemo(
    () => (impact?.enrichment_chart_series ?? []).map((row) => mapEisRow(row, mode)),
    [impact?.enrichment_chart_series, mode],
  );

  const summary = impact?.summary;
  const enrichmentSummary = impact?.enrichment_summary;
  const n = impact?.n_events ?? 0;
  const nEnriched = impact?.n_with_eis_data ?? impact?.n_enriched_events ?? enrichmentSummary?.n_events ?? 0;

  if (!impact || impact.error) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3 h-[280px] flex items-center justify-center">
        <p className="text-[11px] text-ink-muted text-center px-4">
          {impact?.error ?? t("preCd.curveImpact.empty")}
        </p>
      </div>
    );
  }

  if (n === 0 || chartData.length === 0) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3 h-[280px] flex items-center justify-center">
        <p className="text-[11px] text-ink-muted text-center px-4">{t("preCd.curveImpact.empty")}</p>
      </div>
    );
  }

  const yUnit = "%";
  const yAxisLabel = mode === "mae" ? t("preCd.curveImpact.yAxisMae") : t("preCd.curveImpact.yAxisHit");
  const yDomain: [number, number | "auto"] = mode === "hit" ? [0, 100] : [0, "auto"];
  const fmtValue = (v: number | null | undefined) => fmtPct(v, mode === "mae" ? 2 : 1);

  const maeDaily = summary?.mae_daily_pp ?? summary?.mae_recalib_pp;
  const maeK8 = summary?.mae_k8_pp;
  const hitDaily = summary?.hit_daily_pct ?? summary?.hit_recalib_pct;
  const hitK8 = summary?.hit_k8_pct;

  const deltaDaily =
    summary?.delta_mae_daily_vs_base_pp ?? summary?.delta_mae_recalib_vs_base_pp;
  const deltaK8 = summary?.delta_mae_k8_vs_daily_pp;

  const deltaEisRaw =
    enrichmentSummary?.delta_mae_raw_eis_vs_raw_pp ??
    enrichmentSummary?.delta_mae_eis_vs_pre_eis_pp;
  const deltaK8Raw = enrichmentSummary?.delta_mae_k8_vs_raw_pp;

  const renderTooltipLabel = (
    variant: ChartVariant,
    p:
      | {
          n?: number;
          day?: string | null;
          ticker?: string;
          enrichedAt?: string | null;
          eisShiftPp?: number | null;
        }
      | undefined,
  ) => {
    if (!p) return "";
    const prefix = variant === "historic" ? "H" : "E";
    const parts = [`${prefix}#${p.n ?? "?"}`];
    if (p.day) parts.push(p.day);
    if (p.ticker) parts.push(p.ticker);
    if (variant === "eis" && p.enrichedAt) parts.push(`feed ${String(p.enrichedAt).slice(0, 10)}`);
    if (variant === "eis" && p.eisShiftPp != null && Math.abs(p.eisShiftPp) > 0.01) {
      parts.push(`EIS ${p.eisShiftPp >= 0 ? "+" : ""}${p.eisShiftPp.toFixed(2)} pp`);
    }
    return parts.join(" · ");
  };

  const renderHistoricChart = (data: typeof chartData, height = 200) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis
            tick={{ fontSize: 10 }}
            unit={yUnit}
            domain={yDomain}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
            }}
          />
          <Tooltip
            formatter={(v: number, name: string) => [fmtValue(v), name]}
            labelFormatter={(_, payload) =>
              renderTooltipLabel("historic", payload?.[0]?.payload as typeof chartData[number])
            }
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="base"
            name={t("preCd.curveImpact.histLineBase")}
            stroke="#94a3b8"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="daily"
            name={t("preCd.curveImpact.histLineDaily")}
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="k8"
            name={t("preCd.curveImpact.histLineK8")}
            stroke="#0d9488"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  const renderEisChart = (data: typeof enrichmentData, height = 160) => (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis
            tick={{ fontSize: 10 }}
            unit={yUnit}
            domain={yDomain}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: "insideLeft",
              style: { fontSize: 9, fill: "rgb(var(--ink-muted))" },
            }}
          />
          <Tooltip
            formatter={(v: number, name: string) => [fmtValue(v), name]}
            labelFormatter={(_, payload) =>
              renderTooltipLabel("eis", payload?.[0]?.payload as typeof enrichmentData[number])
            }
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="raw"
            name={t("preCd.curveImpact.eisLineRaw")}
            stroke="#94a3b8"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="k8Hist"
            name={t("preCd.curveImpact.eisLineK8Hist")}
            stroke="#0d9488"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="rawEis"
            name={t("preCd.curveImpact.eisLineRawEis")}
            stroke="#7c3aed"
            strokeWidth={2.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/30 p-3 space-y-3 shrink-0">
      <div className="flex flex-wrap items-start gap-2 justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold text-ink">{t("preCd.curveImpact.histTitle")}</p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-xl">
            {t("preCd.curveImpact.histSubtitle")} · {impact.horizon_label}
          </p>
          <p className="text-[10px] text-ink-muted tabular-nums">
            {t("preCd.curveImpact.histSampleLabel")} n={n.toLocaleString()}
            {impact.n_events_total != null && impact.n_events_total > n && (
              <span className="ml-1">
                ({t("preCd.curveImpact.histPoolNote", {
                  total: impact.n_events_total.toLocaleString(),
                })})
              </span>
            )}
            {impact.n_with_seq_curve != null && impact.n_with_seq_curve > 0 && (
              <span className="ml-1">· seq_curve {impact.n_with_seq_curve.toLocaleString()}</span>
            )}
            {impact.n_with_k8_delta != null && impact.n_with_k8_delta > 0 && (
              <span className="ml-1">· 8-K Δ {impact.n_with_k8_delta.toLocaleString()}</span>
            )}
            {impact.n_new_sim_events_since_last != null && impact.n_new_sim_events_since_last > 0 && (
              <span className="ml-1 text-[rgb(var(--signal-up))]">
                · +{impact.n_new_sim_events_since_last.toLocaleString()} {t("preCd.curveImpact.newSinceRebuild")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="flex gap-1">
            <button
              type="button"
              className={`text-[10px] px-2 py-0.5 rounded border ${
                mode === "mae"
                  ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-accent font-semibold"
                  : "border-[rgb(var(--border))]/50 text-ink-muted"
              }`}
              onClick={() => setMode("mae")}
            >
              {t("preCd.curveImpact.modeMae")}
            </button>
            <button
              type="button"
              className={`text-[10px] px-2 py-0.5 rounded border ${
                mode === "hit"
                  ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/10 text-accent font-semibold"
                  : "border-[rgb(var(--border))]/50 text-ink-muted"
              }`}
              onClick={() => setMode("hit")}
            >
              {t("preCd.curveImpact.modeHit")}
            </button>
          </div>
          <CurveImpactMetricHelp mode={mode} />
        </div>
      </div>

      <div className="rounded border border-[rgb(var(--accent))]/25 bg-[rgb(var(--accent))]/5 px-2.5 py-2 text-[10px] text-ink leading-snug">
        <p className="font-semibold">{t("preCd.curveImpact.histClarifierTitle")}</p>
        <p className="text-ink-muted mt-0.5">{t("preCd.curveImpact.histClarifierBody")}</p>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
            <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.histLineBase")}</p>
            <p className="font-semibold tabular-nums text-ink">
              {fmtValue(mode === "mae" ? summary.mae_base_pp : summary.hit_base_pct)}
            </p>
            <p className="text-[9px] text-ink-muted">{t("preCd.curveImpact.histCardBaseHint")}</p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
            <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.histLineDaily")}</p>
            <p className="font-semibold tabular-nums text-ink">
              {fmtValue(mode === "mae" ? maeDaily : hitDaily)}
            </p>
            <p className="text-[9px] text-ink-muted">{t("preCd.curveImpact.histCardDailyHint")}</p>
            {deltaDaily != null && mode === "mae" && (
              <p className="text-[9px] text-ink-muted tabular-nums">
                {t("preCd.curveImpact.deltaEis")} {deltaDaily >= 0 ? "+" : ""}
                {deltaDaily.toFixed(2)}%
              </p>
            )}
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
            <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.histLineK8")}</p>
            <p className="font-semibold tabular-nums text-ink">
              {fmtValue(mode === "mae" ? maeK8 : hitK8)}
            </p>
            <p className="text-[9px] text-ink-muted">{t("preCd.curveImpact.histCardK8Hint")}</p>
            {deltaK8 != null && mode === "mae" && (
              <p className="text-[9px] text-ink-muted tabular-nums">
                {t("preCd.curveImpact.deltaCal")} {deltaK8 >= 0 ? "+" : ""}
                {deltaK8.toFixed(2)}%
              </p>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/25 px-2.5 py-2 space-y-1.5 text-[10px] text-ink-muted leading-snug">
        <p className="font-semibold text-ink text-[10px]">{t("preCd.curveImpact.histLegendTitle")}</p>
        <p>{mode === "mae" ? t("preCd.curveImpact.histLegendMae") : t("preCd.curveImpact.histLegendHit")}</p>
        <ul className="grid sm:grid-cols-3 gap-x-3 gap-y-1 pt-0.5">
          <li className="flex items-start gap-1.5">
            <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#94a3b8]" aria-hidden />
            <span>{t("preCd.curveImpact.histLegendLineBase")}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#2563eb]" aria-hidden />
            <span>{t("preCd.curveImpact.histLegendLineDaily")}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#0d9488]" aria-hidden />
            <span>{t("preCd.curveImpact.histLegendLineK8")}</span>
          </li>
        </ul>
      </div>

      {mode === "mae" && deltaDaily != null && deltaDaily < -0.5 && (
        <p className="text-[9px] text-[rgb(var(--signal-up))] leading-snug">
          {t("preCd.curveImpact.tryHitMode")}
        </p>
      )}

      {renderHistoricChart(chartData)}

      <p className="text-[9px] text-ink-muted leading-snug">{t("preCd.curveImpact.histFooter")}</p>

      {enrichmentData.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-[rgb(var(--border))]/40">
          <div className="min-w-0 space-y-0.5">
            <p className="text-[11px] font-semibold text-ink">{t("preCd.curveImpact.eisTitle")}</p>
            <p className="text-[10px] text-ink-muted leading-snug">{t("preCd.curveImpact.eisSubtitle")}</p>
            <p className="text-[10px] text-ink-muted tabular-nums">
              {t("preCd.curveImpact.eisSampleLabel")} n={nEnriched.toLocaleString()}
              {deltaEisRaw != null && mode === "mae" && (
                <span
                  className={`ml-1 font-medium tabular-nums ${
                    deltaEisRaw <= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--warn))]"
                  }`}
                >
                  · {t("preCd.curveImpact.eisDeltaRawLabel")} {deltaEisRaw >= 0 ? "+" : ""}
                  {deltaEisRaw.toFixed(2)}%
                  {deltaEisRaw > 0 ? ` (${t("preCd.curveImpact.eisWorseHint")})` : ""}
                </span>
              )}
              {impact.n_new_eis_events_since_last != null && impact.n_new_eis_events_since_last > 0 && (
                <span className="ml-1 text-[rgb(var(--signal-up))]">
                  · +{impact.n_new_eis_events_since_last.toLocaleString()}{" "}
                  {t("preCd.curveImpact.newSinceRebuild")}
                </span>
              )}
            </p>
          </div>

          {enrichmentSummary && (
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
                <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.eisLineRaw")}</p>
                <p className="font-semibold tabular-nums text-ink">
                  {fmtValue(
                    mode === "mae"
                      ? (enrichmentSummary.mae_raw_pp ?? enrichmentSummary.mae_pre_eis_pp)
                      : (enrichmentSummary.hit_raw_pct ?? enrichmentSummary.hit_pre_eis_pct),
                  )}
                </p>
              </div>
              <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
                <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.eisLineK8Hist")}</p>
                <p className="font-semibold tabular-nums text-ink">
                  {fmtValue(
                    mode === "mae"
                      ? enrichmentSummary.mae_k8_historic_pp
                      : enrichmentSummary.hit_k8_historic_pct,
                  )}
                </p>
                {deltaK8Raw != null && mode === "mae" && (
                  <p className="text-[9px] text-ink-muted tabular-nums">
                    {t("preCd.curveImpact.deltaCal")} {deltaK8Raw >= 0 ? "+" : ""}
                    {deltaK8Raw.toFixed(2)}%
                  </p>
                )}
              </div>
              <div className="rounded border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1.5">
                <p className="text-ink-muted uppercase tracking-wide">{t("preCd.curveImpact.eisLineRawEis")}</p>
                <p className="font-semibold tabular-nums text-ink">
                  {fmtValue(
                    mode === "mae"
                      ? (enrichmentSummary.mae_raw_eis_pp ?? enrichmentSummary.mae_eis_pp)
                      : (enrichmentSummary.hit_raw_eis_pct ?? enrichmentSummary.hit_eis_pct),
                  )}
                </p>
                {deltaEisRaw != null && mode === "mae" && (
                  <p
                    className={`text-[9px] tabular-nums ${
                      deltaEisRaw <= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--warn))]"
                    }`}
                  >
                    {t("preCd.curveImpact.eisDeltaRawLabel")} {deltaEisRaw >= 0 ? "+" : ""}
                    {deltaEisRaw.toFixed(2)}%
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded border border-[rgb(var(--border))]/35 bg-surface/25 px-2.5 py-2 space-y-1.5 text-[10px] text-ink-muted leading-snug">
            <p className="font-semibold text-ink text-[10px]">{t("preCd.curveImpact.eisLegendTitle")}</p>
            <p>{mode === "mae" ? t("preCd.curveImpact.eisLegendMae") : t("preCd.curveImpact.eisLegendHit")}</p>
            <ul className="grid sm:grid-cols-3 gap-x-3 gap-y-1 pt-0.5">
              <li className="flex items-start gap-1.5">
                <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#94a3b8]" aria-hidden />
                <span>{t("preCd.curveImpact.eisLegendLineRaw")}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#0d9488]" aria-hidden />
                <span>{t("preCd.curveImpact.eisLegendLineK8Hist")}</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="mt-1.5 h-0.5 w-3 shrink-0 rounded bg-[#7c3aed]" aria-hidden />
                <span>{t("preCd.curveImpact.eisLegendLineRawEis")}</span>
              </li>
            </ul>
            {mode === "mae" && (
              <p className="text-[9px] pt-1">{t("preCd.curveImpact.eisRmseHint")}</p>
            )}
          </div>

          {(impact.n_with_eis_shift ?? 0) === 0 && (
            <p className="text-[9px] text-[rgb(var(--warn))] leading-snug">
              {t("preCd.curveImpact.noEisNote", {
                nFeed: (impact.clinical_feed_records ?? impact.ai_feed_records ?? 0).toLocaleString(),
                nEvents: nEnriched.toLocaleString(),
              })}
            </p>
          )}
          {nEnriched > 0 && nEnriched < 25 && (
            <p className="text-[9px] text-[rgb(var(--warn))] leading-snug">
              {t("preCd.curveImpact.eisSmallSample", { n: nEnriched.toLocaleString() })}
            </p>
          )}

          {renderEisChart(enrichmentData)}

          <p className="text-[9px] text-ink-muted leading-snug">{t("preCd.curveImpact.eisFooter")}</p>
        </div>
      )}
    </div>
  );
}
