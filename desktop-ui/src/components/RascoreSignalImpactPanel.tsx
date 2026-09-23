import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildRascoreCalibrationChartRows,
  buildRascoreEvolutionSummary,
  recordRascoreWeeklySnapshot,
} from "../sheet/rascoreCalibrationHistory";
import { rascoreCalibrationTrendVisual } from "../sheet/rascoreCalibrationTrendVisual";
import { RascoreCalibrationTrendChart } from "./RascoreCalibrationTrendChart";
import { loadSdsCohort, type SdsRow } from "../api/supernova";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import type { SheetTable } from "../types";
import {
  buildRascoreObservations,
  buildRascoreSignalImpactView,
  rascoreChartHasPlottableSeries,
  type RascoreSignalImpactView,
} from "../sheet/rascoreSignalImpactView";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { RascoreCurveChart } from "./RascoreCurveChart";
import { RascoreReliabilityAnswers } from "./RascoreReliabilityAnswers";
import { formatCorrelationWithStars } from "../sheet/statSignificance";

function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 10 ** digits) / 10 ** digits}%`;
}

function fmtScore(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(Math.round(v));
}

function DidascaliaBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-medium text-ink">{title}</p>
      {children}
    </div>
  );
}

function RascoreImpactCaption() {
  const t = useT();
  return (
    <DidascaliaBox title={t("modelLab.qc.rascoreImpact.caption.title")}>
      <p className="text-[11px] leading-relaxed text-ink-muted">{t("modelLab.qc.rascoreImpact.caption.intro")}</p>
      <ul className="text-[10px] text-ink-muted space-y-1 list-disc pl-4">
        <li>{t("modelLab.qc.rascoreImpact.caption.growWindow")}</li>
        <li>{t("modelLab.qc.rascoreImpact.caption.declineWindow")}</li>
        <li>{t("modelLab.qc.rascoreImpact.caption.thresholds")}</li>
      </ul>
      <p className="text-[10px] text-ink-muted leading-snug">{t("modelLab.qc.rascoreImpact.caption.footnote")}</p>
    </DidascaliaBox>
  );
}

function ThresholdTiles({ view }: { view: RascoreSignalImpactView }) {
  const t = useT();
  const th = view.thresholds;
  const cq = view.calibrationQuality;
  const rhoLabel =
    cq.spearmanGrow7d != null
      ? formatCorrelationWithStars(cq.spearmanGrow7d, cq.nBinsUsed)
      : "—";
  const rhoTierClass =
    cq.tier === "strong"
      ? "text-emerald-800"
      : cq.tier === "inverted"
        ? "text-rose-800"
        : "text-amber-800";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
      <div className="rounded border border-emerald-300/50 bg-emerald-50/70 px-2 py-1.5">
        <p className="text-ink-muted uppercase tracking-wide truncate">
          {t("modelLab.qc.rascoreImpact.tile.investMin")}
        </p>
        <p className="font-semibold tabular-nums text-emerald-800">{fmtScore(th.investMinScore)}</p>
        <p className="text-[9px] text-ink-muted">{t("modelLab.qc.rascoreImpact.tile.investMinHint")}</p>
      </div>
      <div className="rounded border border-rose-300/50 bg-rose-50/70 px-2 py-1.5">
        <p className="text-ink-muted uppercase tracking-wide truncate">
          {t("modelLab.qc.rascoreImpact.tile.divestBelow")}
        </p>
        <p className="font-semibold tabular-nums text-rose-800">{fmtScore(th.divestBelowScore)}</p>
        <p className="text-[9px] text-ink-muted">{t("modelLab.qc.rascoreImpact.tile.divestHint")}</p>
      </div>
      <div className="rounded border border-violet-300/50 bg-violet-50/70 px-2 py-1.5">
        <p className="text-ink-muted uppercase tracking-wide truncate">
          {t("modelLab.qc.rascoreImpact.tile.peakBin")}
        </p>
        <p className="font-semibold tabular-nums">{fmtScore(th.peakSuccessBinMid)}</p>
        <p className="text-[9px] text-ink-muted">
          {th.peakGrow7dPct != null ? fmtPct(th.peakGrow7dPct) : "—"}{" "}
          {t("modelLab.qc.rascoreImpact.tile.peakGrow7dSuffix")}
        </p>
      </div>
      <div className="rounded border border-sky-300/50 bg-sky-50/70 px-2 py-1.5">
        <p className="text-ink-muted uppercase tracking-wide truncate">
          {t("modelLab.qc.rascoreImpact.tile.monotonicity")}
        </p>
        <p className={`font-semibold tabular-nums ${rhoTierClass}`}>ρ {rhoLabel}</p>
        <p className="text-[9px] text-ink-muted">{t(`modelLab.qc.rascoreImpact.tile.monotonicity.${cq.tier}`)}</p>
      </div>
    </div>
  );
}

export function RascoreSignalImpactPanel({
  simTable,
  reloadToken = 0,
}: {
  simTable?: SheetTable | null;
  reloadToken?: number;
}) {
  const t = useT();
  const { lang } = useLang();
  const langCode = lang === "it" ? "it" : "en";
  const inputs = useInvestSimInputs(simTable ?? null);
  const history = useInvestSimPortfolioHistory();

  const [sdsRows, setSdsRows] = useState<SdsRow[]>([]);
  const [chartBundle, setChartBundle] = useState<Awaited<ReturnType<typeof loadSimulationChartsBundle>>["bundle"]>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void Promise.all([loadSdsCohort(false), loadSimulationChartsBundle()])
      .then(([sds, charts]) => {
        if (cancelled) return;
        setSdsRows(sds.rows ?? []);
        setChartBundle(charts.bundle);
        if (charts.error) setLoadError(charts.error);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const view = useMemo(() => {
    const observations = buildRascoreObservations({
      simTable,
      chartBundle,
      sdsRows,
      inputs,
      history,
      lang: langCode,
    });
    return buildRascoreSignalImpactView(observations);
  }, [simTable, chartBundle, sdsRows, inputs, history, langCode]);

  const hasChartData =
    view.bins.length > 0 &&
    view.nTotal > 0 &&
    rascoreChartHasPlottableSeries(view.bins);

  const [evolutionSummary, setEvolutionSummary] = useState(() => buildRascoreEvolutionSummary());

  useEffect(() => {
    if (!view.hasData || loading) return;
    recordRascoreWeeklySnapshot(view);
    setEvolutionSummary(buildRascoreEvolutionSummary());
  }, [view, loading]);

  const evolutionChartRows = useMemo(
    () => buildRascoreCalibrationChartRows(evolutionSummary),
    [evolutionSummary],
  );
  const evolutionVisual = useMemo(
    () => rascoreCalibrationTrendVisual(evolutionSummary.trend, langCode === "it"),
    [evolutionSummary.trend, langCode],
  );

  if (!simTable?.rows?.length) {
    return (
      <div className="space-y-3">
        <RascoreImpactCaption />
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.rascoreImpact.title")}
          </p>
          <p className="text-[11px] text-ink-muted mt-1 leading-snug">{t("modelLab.qc.rascoreImpact.noSim")}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <RascoreImpactCaption />
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-4">
          <p className="text-[11px] text-ink-muted">{t("modelLab.qc.rascoreImpact.loading")}</p>
        </div>
      </div>
    );
  }

  if (!hasChartData) {
    return (
      <div className="space-y-3">
        <RascoreImpactCaption />
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {t("modelLab.qc.rascoreImpact.title")}
          </p>
          <p className="text-[11px] text-ink-muted mt-1 leading-snug">
            {loadError ? t("modelLab.qc.rascoreImpact.loadError") : t("modelLab.qc.rascoreImpact.empty")}
          </p>
          {view.nTotal > 0 ? (
            <p className="text-[10px] text-ink-muted mt-2">
              {t("modelLab.qc.rascoreImpact.noPriceData", { n: String(view.nTotal) })}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <ViewErrorBoundary label="RA score impact">
      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/20 px-3 py-2.5 space-y-3">
        <RascoreImpactCaption />

        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-wide text-ink-muted">{t("modelLab.qc.rascoreImpact.title")}</p>
          <p className="text-sm font-semibold text-ink leading-snug">{t("modelLab.qc.rascoreImpact.lead")}</p>
          <p className="text-[10px] text-ink tabular-nums">
            {t("modelLab.qc.rascoreImpact.cohortCounts", {
              signals: String(view.nTotal),
              with24h: String(view.nWith24h),
              with7d: String(view.nWith7d),
              invested: String(view.nWithPosition),
            })}
          </p>
        </div>

        <RascoreReliabilityAnswers view={view} />
        <ThresholdTiles view={view} />
        <RascoreCalibrationTrendChart rows={evolutionChartRows} visual={evolutionVisual} />
        {rascoreChartHasPlottableSeries(view.bins) ? <RascoreCurveChart view={view} /> : null}
      </div>
    </ViewErrorBoundary>
  );
}
