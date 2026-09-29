import { useMemo } from "react";
import { ModelLearningNarrativeCard } from "./ModelLearningNarrativeCard";
import { ModelStretchPanel } from "./ModelStretchPanel";
import type { MonitorEntry } from "../sheet/accuracyMetrics";
import type { SheetTable } from "../types";
import { buildModelLearningsView, type ModelLearningsView } from "../sheet/modelLearningsTimeline";
import { useLang, useT } from "../shared/i18n";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { AdviceLearningTimelinePanel } from "./AdviceLearningTimelinePanel";
import { AdviceLearningsRecalculationBridge } from "./AdviceLearningsRecalculationBridge";
import { ModelSizeErrorPanel } from "./ModelSizeErrorPanel";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { HomePortfolioPnlHistoryChart } from "./HomePortfolioPnlHistoryChart";

export type QcTodayDashboardProps = {
  reloadToken?: number;
  /** true mentre il parent carica loadModelLearningsBundle (evita fetch duplicati). */
  bundleLoading?: boolean;
  simTable?: SheetTable | null;
  monitorEntries?: MonitorEntry[];
  monitorSource?: string;
  curveErrors?: string[];
  sources?: Parameters<typeof buildModelLearningsView>[0] | null;
  view?: ModelLearningsView | null;
  onOpenModelsEval?: () => void;
  /** Opens the dedicated "Missed" sub-view (Calibration plan, top blockers,
   *  error trend, missed gainers scatter). The MissedOpportunityPanel was
   *  previously mounted inline at the bottom of this dashboard; it now
   *  lives in its own tab reachable through this callback. */
  onOpenMissed?: () => void;
};

export function QcTodayDashboard({
  reloadToken = 0,
  bundleLoading = false,
  simTable = null,
  monitorEntries = [],
  monitorSource = "",
  curveErrors = [],
  sources = null,
  view: viewProp = null,
  onOpenModelsEval,
  onOpenMissed,
}: QcTodayDashboardProps) {
  const t = useT();
  const { lang } = useLang();
  const inputs = useInvestSimInputs(simTable, reloadToken);
  const { history: portfolioHistory } = useInvestSimPortfolioHistory(reloadToken);

  const view = useMemo(() => {
    if (viewProp) return viewProp;
    if (!sources) return null;
    return buildModelLearningsView(sources, { lang, monitorSource });
  }, [viewProp, sources, lang, monitorSource]);

  return (
    <div className="flex flex-col flex-1 gap-4 pr-1">
      <div className="shrink-0 min-w-0">
        <ViewErrorBoundary label="Open portfolio P&L">
          <HomePortfolioPnlHistoryChart
            history={portfolioHistory}
            inputs={inputs}
            simTable={simTable}
          />
        </ViewErrorBoundary>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-gradient-to-br from-white via-sky-50/50 to-amber-50/40 p-4 space-y-3 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-ink">{t("modelLab.qc.performance.title")}</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">{t("modelLab.qc.performance.lead")}</p>
          </div>
          {onOpenModelsEval || onOpenMissed ? (
            <div className="shrink-0 flex items-center gap-2">
              {onOpenModelsEval ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgb(var(--accent))]/35 bg-white/90 px-3 py-2 text-xs font-medium text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/8 transition"
                  onClick={onOpenModelsEval}
                >
                  {t("modelLab.performance.modelsEvalGroup")}
                </button>
              ) : null}
              {onOpenMissed ? (
                <button
                  type="button"
                  className="rounded-lg border border-[rgb(var(--accent))]/35 bg-white/90 px-3 py-2 text-xs font-medium text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/8 transition"
                  onClick={onOpenMissed}
                >
                  {t("modelLab.performance.openMissed")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <ModelLearningNarrativeCard
          reloadToken={reloadToken}
          bundleLoading={bundleLoading}
          monitorEntries={monitorEntries}
          view={view}
          accuracySummary={sources?.accuracySummary ?? null}
          signCurveDaily={sources?.signCurveDaily ?? null}
        />
      </div>

      {view ? (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 p-4 shrink-0">
          <ViewErrorBoundary label="Model stretch">
            <ModelStretchPanel view={view.modelStretch} />
          </ViewErrorBoundary>
        </div>
      ) : null}

      {view?.modelSizeError ? (
        <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 p-4 shrink-0">
          <ViewErrorBoundary label="Model size error">
            <ModelSizeErrorPanel view={view.modelSizeError} />
          </ViewErrorBoundary>
        </div>
      ) : null}

      {curveErrors.length > 0 ? (
        <div className="rounded-lg border border-warn/30 bg-warn/8 px-3 py-2 text-xs text-warn space-y-0.5 shrink-0 flex items-start gap-2">
          <span aria-hidden>⚠</span>
          <div>
            {curveErrors.slice(0, 2).map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        </div>
      ) : null}

      <ViewErrorBoundary label="Advice learning timeline">
        <AdviceLearningsRecalculationBridge simTable={simTable} lang={lang} />
        <AdviceLearningTimelinePanel lang={lang} />
      </ViewErrorBoundary>
    </div>
  );
}
