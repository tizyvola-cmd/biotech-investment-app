import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadAccuracySummaryDocument } from "../data/accuracyModelData";
import { loadModelLearningsBundle } from "../data/modelLearningsData";
import {
  buildModelLearningsView,
  type ModelLearningsView,
} from "../sheet/modelLearningsTimeline";
import type { MonitorEntry } from "../sheet/accuracyMetrics";
import {
  formatDaysToCdOffset,
  formatPred5Signed,
} from "../sheet/strongSignalsKpi";
import {
  formatSignPeakOffset,
  signHitToneClass,
  buildModelIntrinsicForecastSummary,
  buildSignAccuracyCurveView,
} from "../sheet/signAccuracyCurve";
import { SignAccuracyCurvePanel } from "./SignAccuracyCurvePanel";
import type { AccuracySummaryDoc } from "../data/accuracyModelData";
import { loadSignCurveDailyDoc, type SignCurveDailyDoc } from "../data/signCurveDailyData";
import { useLang, useT } from "../shared/i18n";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function accToneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-ink";
  if (pct >= 60) return "text-positive";
  if (pct >= 52) return "text-warn";
  return "text-negative";
}

function AnticipatoryStrongSignal({
  label,
  value,
  valueClass,
  valueExtra,
  sub,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  valueExtra?: ReactNode;
  sub?: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-lg border border-[rgb(var(--accent))]/25 bg-gradient-to-r from-sky-50/80 via-white to-amber-50/60 px-3 py-2.5 min-w-0"
      title={hint}
    >
      <p className="text-[9px] uppercase tracking-wide text-ink-muted truncate">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${valueClass ?? "text-ink"}`}>
        {value}
        {valueExtra ? (
          <span className="text-sm font-medium text-ink-muted ml-1.5">{valueExtra}</span>
        ) : null}
      </p>
      {sub ? <p className="text-[9px] text-ink-muted tabular-nums mt-0.5">{sub}</p> : null}
      {hint ? <p className="text-[9px] text-ink-muted/90 leading-snug mt-1 max-w-prose">{hint}</p> : null}
    </div>
  );
}


export type ModelLearningNarrativeCardProps = {
  reloadToken?: number;
  /** Per pill Hit% T+5 / MAE T+7 (opzionale). */
  monitorEntries?: MonitorEntry[];
  /** Se forniti, evita un secondo fetch (es. da ModelLearningsPanel). */
  view?: ModelLearningsView | null;
  /** accuracy_v4_v5_summary + model_sign_curve_daily.json */
  accuracySummary?: AccuracySummaryDoc | null;
  signCurveDaily?: SignCurveDailyDoc | null;
  /** Parent gestisce loadModelLearningsBundle — non rifare il fetch (~16 MB summary). */
  bundleLoading?: boolean;
};

/** Riepilogo in parole semplici: il modello migliora? Cosa aspetta? Cosa cambia per te. */
export function ModelLearningNarrativeCard({
  reloadToken = 0,
  monitorEntries: _monitorEntries = [],
  view: viewProp,
  accuracySummary: accuracySummaryProp = null,
  signCurveDaily: signCurveDailyProp = null,
  bundleLoading,
}: ModelLearningNarrativeCardProps) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const parentOwnsBundle = bundleLoading !== undefined;
  const [loading, setLoading] = useState(() =>
    parentOwnsBundle ? Boolean(bundleLoading) : viewProp == null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [monitorSource, setMonitorSource] = useState("");
  const [sources, setSources] = useState<Awaited<
    ReturnType<typeof loadModelLearningsBundle>
  >["sources"] | null>(null);
  const [accuracySummary, setAccuracySummary] = useState<AccuracySummaryDoc | null>(
    accuracySummaryProp,
  );
  const [signCurveDaily, setSignCurveDaily] = useState<SignCurveDailyDoc | null>(signCurveDailyProp);

  useEffect(() => {
    if (parentOwnsBundle) {
      setLoading(Boolean(bundleLoading));
      return;
    }
    if (viewProp != null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadModelLearningsBundle().then(({ sources: s, errors: e, monitorSource: ms }) => {
      if (cancelled) return;
      setSources(s);
      setAccuracySummary(s.accuracySummary);
      setSignCurveDaily(s.signCurveDaily);
      setErrors(e);
      setMonitorSource(ms);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, parentOwnsBundle, bundleLoading, viewProp]);

  /** Curva segno: fetch solo in modalità standalone (senza bundle dal parent). */
  useEffect(() => {
    if (parentOwnsBundle) return;
    if (signCurveDailyProp != null && accuracySummaryProp != null) return;
    let cancelled = false;
    void Promise.all([
      signCurveDailyProp != null
        ? Promise.resolve({ doc: signCurveDailyProp })
        : loadSignCurveDailyDoc(),
      accuracySummaryProp != null
        ? Promise.resolve({ doc: accuracySummaryProp })
        : loadAccuracySummaryDocument(),
    ]).then(([sc, acc]) => {
      if (cancelled) return;
      if (signCurveDailyProp == null) setSignCurveDaily(sc.doc);
      if (accuracySummaryProp == null) setAccuracySummary(acc.doc);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, parentOwnsBundle, signCurveDailyProp, accuracySummaryProp]);

  useEffect(() => {
    if (accuracySummaryProp != null) setAccuracySummary(accuracySummaryProp);
  }, [accuracySummaryProp]);

  useEffect(() => {
    if (signCurveDailyProp != null) setSignCurveDaily(signCurveDailyProp);
  }, [signCurveDailyProp]);

  const view = useMemo(
    () =>
      viewProp ??
      (sources
        ? buildModelLearningsView(sources, { lang, monitorSource })
        : null),
    [viewProp, sources, lang, monitorSource],
  );

  const signCurveView = useMemo(
    () =>
      buildSignAccuracyCurveView(
        accuracySummaryProp ?? accuracySummary,
        signCurveDailyProp ?? signCurveDaily,
      ),
    [accuracySummaryProp, accuracySummary, signCurveDailyProp, signCurveDaily],
  );
  const intrinsicForecast = useMemo(
    () => buildModelIntrinsicForecastSummary(signCurveView),
    [signCurveView],
  );

  if (loading) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center rounded-xl border border-dashed border-[rgb(var(--border))]/50">
        {t("decisionLab.loading.learnings")}
      </p>
    );
  }

  if (!view) {
    return (
      <p className="text-sm text-negative py-4 text-center rounded-xl border border-[rgb(var(--border))]/50">
        {it ? "Impossibile caricare lo stato del modello." : "Could not load model status."}
      </p>
    );
  }

  const { kpis } = view;
  const signPeak = kpis.signPeakHit;

  const weightedSignPct = intrinsicForecast?.sign.overallPct ?? null;

  const strongSignalsValue = signPeak
    ? fmtPct(signPeak.pct)
    : fmtPct(kpis.usefulHitPct);
  const strongSignalsExtra = (() => {
    if (signPeak) {
      return t("modelLab.qc.kpi.strongSignals.peakAtPreCd", {
        offset: formatSignPeakOffset(signPeak.offset),
      });
    }
    const peak = kpis.usefulHitPeak;
    if (!peak) return null;
    if (peak.kind === "horizon") {
      return t("modelLab.qc.kpi.strongSignals.peakAtHorizon", {
        pct: fmtPct(peak.hitPct),
        window: peak.windowLabel,
      });
    }
    return t("modelLab.qc.kpi.strongSignals.bestPending", {
      ticker: peak.ticker,
      pred: formatPred5Signed(peak.pred5Pct),
      offset: formatDaysToCdOffset(peak.daysToCd),
    });
  })();
  const strongSignalsValueClass = signPeak
    ? signHitToneClass(signPeak.pct, "daily_dod")
    : accToneClass(kpis.usefulHitPct);

  return (
    <div className="space-y-3 shrink-0">
      {errors.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-xs text-warn space-y-0.5">
          {errors.slice(0, 2).map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[rgb(var(--border))]/55 bg-gradient-to-br from-sky-50/40 via-white to-amber-50/30 p-3 space-y-2.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--accent))]">
            {t("modelLab.qc.anticipatory.title")}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug mt-0.5 max-w-prose">
            {t("modelLab.qc.anticipatory.lead")}
          </p>
        </div>
        <AnticipatoryStrongSignal
          label={
            signPeak
              ? t("modelLab.qc.kpi.strongSignals.peakTitle", {
                  offset: formatSignPeakOffset(signPeak.offset),
                })
              : t("modelLab.qc.kpi.strongSignals.title")
          }
          value={strongSignalsValue}
          valueClass={strongSignalsValueClass}
          valueExtra={strongSignalsExtra}
          sub={
            weightedSignPct != null
              ? it
                ? `Media pesata bin: ${weightedSignPct.toFixed(1)}% · ${t("modelLab.qc.kpi.sub.signalsClosedPending", {
                    closed: kpis.closedSignals,
                    pending: kpis.pendingSignals,
                  })}`
                : `Weighted bin mean: ${weightedSignPct.toFixed(1)}% · ${t("modelLab.qc.kpi.sub.signalsClosedPending", {
                    closed: kpis.closedSignals,
                    pending: kpis.pendingSignals,
                  })}`
              : t("modelLab.qc.kpi.sub.signalsClosedPending", {
                  closed: kpis.closedSignals,
                  pending: kpis.pendingSignals,
                })
          }
          hint={
            signPeak
              ? it
                ? "Picco = bin T con hit % massimo. Media pesata = stesso numero del blocco «Segno» in Home dashboard."
                : "Peak = T-bin with highest hit %. Weighted mean = same as Home dashboard Sign block."
              : t("modelLab.qc.kpi.strongSignals.hint")
          }
        />
        <SignAccuracyCurvePanel
          summaryDoc={accuracySummaryProp ?? accuracySummary}
          dailyDoc={signCurveDailyProp ?? signCurveDaily}
          compact
          hidePeakMetric
        />
      </div>

    </div>
  );
}
