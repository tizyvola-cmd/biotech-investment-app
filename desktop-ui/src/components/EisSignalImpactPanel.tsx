import { useEffect, useMemo, useState } from "react";
import { fetchEisCohortComparison, fetchEisMagnitudeAnalysis } from "../api/supernova";
import type { CurveImpactCumulative, EisMagnitudeAnalysisDoc } from "../data/signalCalibrationData";
import {
  loadStableEisMagnitudeAnalysis,
  writeEisMagnitudeLocalCache,
} from "../data/eisMagnitudeSnapshot";
import { invalidateProjectJsonCache } from "../data/projectData";
import { buildEisMagnitudeView, mergeEisMagnitudeAnalysis } from "../sheet/eisSignalImpactView";
import { useT } from "../shared/i18n";
import { EisExpectedMoveCurveChart } from "./EisExpectedMoveCurveChart";
import { ModelLabAccuracyUpdatedBar } from "./ModelLabAccuracyUpdatedBar";
import { EisScatterRegressionChart, EisSignSplitByWindowChart, EisSlopeByCdWindowChart } from "./EisRegressionCharts";

function scatterPointCount(doc: EisMagnitudeAnalysisDoc | null | undefined): number {
  return (
    (doc?.scatter?.delta_p_1d?.points?.length ?? 0) +
    (doc?.scatter?.delta_p_7d?.points?.length ?? 0)
  );
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtPp(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

function fmtSlope(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp/EIS`;
}

function fmtCorr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(3);
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "low" | "high" | "neutral";
}) {
  const bg =
    tone === "low"
      ? "border-slate-300/50 bg-slate-50/80"
      : tone === "high"
        ? "border-emerald-300/50 bg-emerald-50/70"
        : "border-[rgb(var(--border))]/50 bg-white/80";
  return (
    <div className={`rounded border px-2 py-1.5 text-[10px] ${bg}`}>
      <p className="text-ink-muted uppercase tracking-wide truncate">{label}</p>
      <p className="font-semibold tabular-nums text-sm">{value}</p>
      {sub ? <p className="text-[9px] text-ink-muted">{sub}</p> : null}
    </div>
  );
}

export function EisSignalImpactPanel({
  curveImpact,
  reloadToken = 0,
  dataUpdatedAt,
}: {
  curveImpact: CurveImpactCumulative | null | undefined;
  reloadToken?: number;
  dataUpdatedAt?: string | null;
}) {
  const t = useT();
  const bundled = curveImpact?.eis_magnitude_analysis;
  const [stableAnalysis, setStableAnalysis] = useState<EisMagnitudeAnalysisDoc | null>(
    bundled && (bundled.n_events_scored ?? 0) > 0 ? bundled : null,
  );
  const [liveAnalysis, setLiveAnalysis] = useState<EisMagnitudeAnalysisDoc | null>(null);
  const [stableLoading, setStableLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStableLoading(true);
    invalidateProjectJsonCache("eis_magnitude_analysis.json");
    invalidateProjectJsonCache("signal_calibration.json");
    void loadStableEisMagnitudeAnalysis(bundled)
      .then((doc) => {
        if (cancelled) return;
        if (doc) setStableAnalysis(doc);
      })
      .finally(() => {
        if (!cancelled) setStableLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bundled?.n_events_scored, bundled?.built_at, reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    setLiveError(null);

    async function loadLiveAnalysis(): Promise<EisMagnitudeAnalysisDoc | null> {
      let doc: EisMagnitudeAnalysisDoc | null = null;
      try {
        doc = await fetchEisMagnitudeAnalysis();
      } catch {
        /* fallback below */
      }
      if (scatterPointCount(doc) > 0) return doc;
      try {
        const cohort = await fetchEisCohortComparison();
        const rebuilt = cohort?.eis_magnitude_analysis ?? null;
        if (rebuilt) {
          return mergeEisMagnitudeAnalysis(doc ?? undefined, rebuilt) ?? doc ?? rebuilt;
        }
      } catch {
        /* keep primary */
      }
      return doc;
    }

    void loadLiveAnalysis()
      .then((doc) => {
        if (cancelled) return;
        if (doc && (doc.n_events_scored ?? 0) > 0) {
          setLiveAnalysis(doc);
          writeEisMagnitudeLocalCache(doc);
        }
      })
      .catch((e) => {
        if (!cancelled) setLiveError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bundled?.n_events_scored, bundled?.built_at, reloadToken]);

  const mergedAnalysis = useMemo(() => {
    const base = stableAnalysis ?? bundled ?? null;
    if (liveAnalysis) return mergeEisMagnitudeAnalysis(base ?? undefined, liveAnalysis);
    return base;
  }, [stableAnalysis, bundled, liveAnalysis]);

  const view = useMemo(
    () => buildEisMagnitudeView(curveImpact, mergedAnalysis ?? undefined),
    [curveImpact, mergedAnalysis],
  );
  const a = view.analysis;

  if ((stableLoading || liveLoading) && !view.hasData) {
    return (
      <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-4">
        <p className="text-[11px] text-ink-muted">{t("modelLab.qc.eisImpact.loading")}</p>
      </div>
    );
  }

  if (!view.hasData) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5">
          <p className="text-[11px] font-medium text-ink">{t("modelLab.qc.eisMagnitude.captionTitle")}</p>
          <p className="text-[10px] text-ink-muted leading-snug mt-1">{t("modelLab.qc.eisMagnitude.captionBody")}</p>
        </div>
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-4">
          <p className="text-[11px] text-ink-muted">
            {liveError ? t("modelLab.qc.eisMagnitude.loadError") : t("modelLab.qc.eisMagnitude.empty")}
          </p>
          {liveError ? (
            <p className="text-[10px] text-rose-600/80 mt-1 font-mono break-all">{liveError}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const split = a?.split;
  const corr = a?.correlation;
  const low = split?.low_eis;
  const high = split?.high_eis;
  const signSplit = a?.sign_split;
  const negEis = signSplit?.negative_eis;
  const posEis = signSplit?.positive_eis;
  const peak = view.peakWindow;
  const reg1d = corr?.regression_1d;
  const reg7d = corr?.regression_7d;

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-4">
      <ModelLabAccuracyUpdatedBar updatedAt={dataUpdatedAt} />
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1.5">
        <p className="text-[11px] font-medium text-ink">{t("modelLab.qc.eisMagnitude.captionTitle")}</p>
        <p className="text-[10px] text-ink-muted leading-snug">{t("modelLab.qc.eisMagnitude.captionBody")}</p>
        <p className="text-[10px] text-ink-muted/90 italic">{t("modelLab.qc.eisMagnitude.scopeNote")}</p>
      </div>

      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-wide text-ink-muted">{t("modelLab.qc.eisMagnitude.title")}</p>
        <p className="text-sm font-semibold text-ink">{t("modelLab.qc.eisMagnitude.lead")}</p>
        <p className="text-[10px] text-ink tabular-nums">
          {t("modelLab.qc.eisMagnitude.counts", {
            scored: String(a?.n_events_scored ?? 0),
            withPrice: String(a?.n_with_price_1d ?? a?.n_with_price_3d ?? 0),
          })}
          {a?.n_with_price_7d != null ? (
            <span className="text-ink-muted">
              {" · "}
              {t("modelLab.qc.eisMagnitude.countsWeek", { n: String(a.n_with_price_7d) })}
            </span>
          ) : null}
        </p>
      </div>

      {(negEis?.n_with_price ?? 0) > 0 || (posEis?.n_with_price ?? 0) > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            tone="low"
            label={t("modelLab.qc.eisMagnitude.negativeAvgMove")}
            value={fmtPp(negEis?.avg_move_pp)}
            sub={t("modelLab.qc.eisMagnitude.nWithPrice", { n: String(negEis?.n_with_price ?? 0) })}
          />
          <StatCard
            tone="high"
            label={t("modelLab.qc.eisMagnitude.positiveAvgMove")}
            value={fmtPp(posEis?.avg_move_pp)}
            sub={t("modelLab.qc.eisMagnitude.nWithPrice", { n: String(posEis?.n_with_price ?? 0) })}
          />
          <StatCard
            tone="low"
            label={t("modelLab.qc.eisMagnitude.negativePositiveRate")}
            value={fmtPct(negEis?.pct_positive)}
            sub={t("modelLab.qc.eisMagnitude.horizonT3")}
          />
          <StatCard
            tone="high"
            label={t("modelLab.qc.eisMagnitude.positivePositiveRate")}
            value={fmtPct(posEis?.pct_positive)}
            sub={
              negEis?.avg_move_pp != null && posEis?.avg_move_pp != null
                ? t("modelLab.qc.eisMagnitude.posMinusNeg", {
                    v: fmtPp((posEis.avg_move_pp ?? 0) - (negEis.avg_move_pp ?? 0)),
                  })
                : undefined
            }
          />
        </div>
      ) : null}

      {!view.hasPriceData ? (
        <p className="text-[10px] rounded border border-amber-300/40 bg-amber-50/70 px-2.5 py-2 text-amber-900">
          {t("modelLab.qc.eisMagnitude.sparsePriceWarning", {
            n: String(a?.n_events_scored ?? 0),
          })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          tone="low"
          label={t("modelLab.qc.eisMagnitude.lowAvgMove")}
          value={fmtPp(low?.avg_move_pp)}
          sub={t("modelLab.qc.eisMagnitude.nWithPrice", { n: String(low?.n_with_price ?? 0) })}
        />
        <StatCard
          tone="high"
          label={t("modelLab.qc.eisMagnitude.highAvgMove")}
          value={fmtPp(high?.avg_move_pp)}
          sub={t("modelLab.qc.eisMagnitude.nWithPrice", { n: String(high?.n_with_price ?? 0) })}
        />
        <StatCard
          tone="low"
          label={t("modelLab.qc.eisMagnitude.lowPositiveRate")}
          value={fmtPct(low?.pct_positive)}
          sub={t("modelLab.qc.eisMagnitude.threshold", { v: String(split?.threshold ?? "—") })}
        />
        <StatCard
          tone="high"
          label={t("modelLab.qc.eisMagnitude.highPositiveRate")}
          value={fmtPct(high?.pct_positive)}
          sub={t("modelLab.qc.eisMagnitude.liftPositive", {
            v: fmtPp(split?.high_minus_low_positive_rate_pp, 1),
          })}
        />
      </div>

      {view.hasPriceData ? (
        <>
          <div className="rounded border border-[rgb(var(--border))]/45 bg-white/80 px-2.5 py-2 text-[10px] space-y-1">
            <p className="font-medium text-ink">{t("modelLab.qc.eisMagnitude.correlationTitle")}</p>
            <p className="text-ink-muted">{t("modelLab.qc.eisMagnitude.correlationBody")}</p>
            <p className="tabular-nums">
              T+1: ρ {fmtCorr(corr?.pearson_eis_vs_delta_p_1d)} · {fmtSlope(reg1d?.slope)} · n=
              {corr?.n_1d ?? 0}
            </p>
            {view.hasWeekPriceData ? (
              <p className="tabular-nums">
                T+7: ρ {fmtCorr(corr?.pearson_eis_vs_delta_p_7d)} · {fmtSlope(reg7d?.slope)} · n=
                {corr?.n_7d ?? 0}
              </p>
            ) : (
              <p className="text-amber-800/90">{t("modelLab.qc.eisMagnitude.weekDataHint")}</p>
            )}
          </div>

          <EisExpectedMoveCurveChart view={view.expectedMoveCurve} />

          <EisSlopeByCdWindowChart
            rows={view.slopeChartRows}
            peakDaysMin={peak?.days_min}
            peakDaysMax={peak?.days_max}
          />

          <EisSignSplitByWindowChart rows={view.signSplitChartRows} showWeek={view.hasWeekPriceData} />

          {peak ? (
            <p className="text-[10px] rounded border border-emerald-300/40 bg-emerald-50/60 px-2 py-1.5">
              <span className="font-medium text-emerald-900">{t("modelLab.qc.eisMagnitude.peakWindow")}: </span>
              {peak.window}
              {peak.days_min != null ? (
                <span className="text-emerald-800">
                  {" "}
                  · {peak.days_min}
                  {peak.days_max != null ? `–${peak.days_max}` : "+"}d {t("modelLab.qc.eisMagnitude.beforeCd")}
                </span>
              ) : null}
              {peak.horizon ? (
                <span className="text-emerald-800">
                  {" "}
                  · {peak.horizon === "7d" ? t("modelLab.qc.eisMagnitude.horizonT7") : t("modelLab.qc.eisMagnitude.horizonT1")}
                </span>
              ) : null}
              {peak.slope_pp_per_eis != null ? (
                <span className="text-emerald-800"> · {fmtSlope(peak.slope_pp_per_eis)}</span>
              ) : peak.high_minus_low_avg_pp != null ? (
                <span className="text-emerald-800"> · Δ {fmtPp(peak.high_minus_low_avg_pp)}</span>
              ) : null}
              {peak.pearson_r != null || peak.pearson_eis_vs_d3 != null ? (
                <span className="text-ink-muted"> · ρ {fmtCorr(peak.pearson_r ?? peak.pearson_eis_vs_d3)}</span>
              ) : null}
            </p>
          ) : null}

          {view.scatterIsSynthesized ? (
            <p className="text-[10px] rounded border border-amber-300/50 bg-amber-50/80 px-2.5 py-2 text-amber-950">
              {t("modelLab.qc.eisMagnitude.scatterSynthesizedHint", {
                shown: String(view.scatterEventPoints1d),
                total: String(a?.n_with_price_1d ?? a?.correlation?.n_1d ?? 0),
              })}
            </p>
          ) : null}

          {!view.hasWeekPriceData ? (
            <p className="text-[10px] rounded border border-amber-300/50 bg-amber-50/80 px-2.5 py-2 text-amber-950">
              {t("modelLab.qc.eisMagnitude.t7MissingHint", {
                withT1: String(a?.n_with_price_1d ?? 0),
                scored: String(a?.n_events_scored ?? 0),
              })}
            </p>
          ) : null}

          {view.chartsFromSnapshot && !view.scatterIsSynthesized ? (
            <p className="text-[10px] rounded border border-sky-300/40 bg-sky-50/70 px-2.5 py-2 text-sky-900">
              {t("modelLab.qc.eisMagnitude.chartsSnapshotHint")}
            </p>
          ) : null}

          {view.chartsNeedLiveApi ? (
            <p className="text-[10px] rounded border border-amber-300/40 bg-amber-50/70 px-2.5 py-2 text-amber-900">
              {t("modelLab.qc.eisMagnitude.chartsStaleHint")}
            </p>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <EisScatterRegressionChart
              title={t("modelLab.qc.eisMagnitude.scatter1dTitle")}
              body={t("modelLab.qc.eisMagnitude.scatter1dBody")}
              bundle={view.scatter1d}
              lineColor="#2563eb"
              dotColor="#6366f1"
              hasPriceSummary={view.hasPriceData}
            />
            <EisScatterRegressionChart
              title={t("modelLab.qc.eisMagnitude.scatter7dTitle")}
              body={t("modelLab.qc.eisMagnitude.scatter7dBody")}
              bundle={view.scatter7d}
              lineColor="#059669"
              dotColor="#10b981"
              hasPriceSummary={view.hasWeekPriceData}
            />
          </div>
          <p className="text-[9px] text-ink-muted italic">{t("modelLab.qc.eisMagnitude.temporalFootnote")}</p>
        </>
      ) : null}
    </div>
  );
}
