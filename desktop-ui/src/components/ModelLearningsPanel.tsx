import { useEffect, useMemo, useState } from "react";
import { loadModelLearningsBundle } from "../data/modelLearningsData";
import { buildModelLearningsView } from "../sheet/modelLearningsTimeline";
import { resolveLearningsTrendDisplay } from "../sheet/learningTrendVisual";
import { ModelLearningNarrativeCard } from "./ModelLearningNarrativeCard";
import { ModelLearningsTabIntro } from "./ModelLearningsTabIntro";
import { LearningTrendChart } from "./LearningTrendChart";
import {
  CurveEngineDiagnostics,
  type CurveEngineDiagnosticsProps,
} from "./CurveEnginePanel";
import { useLang, useT } from "../shared/i18n";

export type ModelLearningsPanelProps = {
  reloadToken?: number;
  /** Curve-engine diagnostics embedded below the learning loop (no duplicate narrative). */
  curveDiagnostics?: Omit<CurveEngineDiagnosticsProps, "trendVisual"> | null;
  curveErrors?: string[];
  curveLoading?: boolean;
};

export function ModelLearningsPanel({
  reloadToken = 0,
  curveDiagnostics = null,
  curveErrors = [],
  curveLoading = false,
}: ModelLearningsPanelProps) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [monitorSource, setMonitorSource] = useState("");
  const [sources, setSources] = useState<Awaited<
    ReturnType<typeof loadModelLearningsBundle>
  >["sources"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadModelLearningsBundle().then(({ sources: s, errors: e, monitorSource: ms }) => {
      if (cancelled) return;
      setSources(s);
      setErrors(e);
      setMonitorSource(ms);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const view = useMemo(
    () =>
      sources
        ? buildModelLearningsView(sources, { lang, monitorSource })
        : null,
    [sources, lang, monitorSource],
  );

  const trendVisual = useMemo(
    () =>
      view
        ? resolveLearningsTrendDisplay(view.trend, {
            deltaPpLastMonitor: view.kpis.deltaPpLastMonitor,
            pendingSignals: view.kpis.pendingSignals,
            closedSignals: view.kpis.closedSignals,
          })
        : null,
    [view],
  );

  if (loading || curveLoading) {
    return (
      <div className="space-y-4">
        <ModelLearningsTabIntro />
        <p className="text-sm text-ink-muted py-6 text-center">{t("decisionLab.loading.learnings")}</p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="space-y-4">
        <ModelLearningsTabIntro />
        <p className="text-sm text-negative py-6 text-center">
          {it ? "Impossibile caricare i learnings." : "Could not load learnings."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ModelLearningsTabIntro />

      {(errors.length > 0 || curveErrors.length > 0) && (
        <div className="rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-xs text-warn space-y-0.5">
          {[...errors, ...curveErrors].slice(0, 3).map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted pt-1">
        {t("modelLab.learnings.todayHeading")}
      </h3>

      <ModelLearningNarrativeCard
        reloadToken={reloadToken}
        monitorEntries={curveDiagnostics?.monitorEntries}
        view={view}
        accuracySummary={sources?.accuracySummary ?? null}
        signCurveDaily={sources?.signCurveDaily ?? null}
      />

      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white p-4 space-y-2">
        <h3 className="text-sm font-semibold">{t("decisionLab.learnings.heading")}</h3>
        <LearningTrendChart rows={view.chartRows} visual={trendVisual!} it={it} />
      </div>

      {curveDiagnostics ? (
        <CurveEngineDiagnostics {...curveDiagnostics} trendVisual={trendVisual!} />
      ) : null}
    </div>
  );
}
