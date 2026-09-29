import { useEffect, useState } from "react";
import { fetchEisCohortWeeklyHistory, type EisCohortWeeklyHistoryDoc } from "../api/supernova";
import { loadEisSuperScoreOverview } from "../api/eisSuperScore";
import type { EisSuperScoreOverview } from "../sheet/eisSuperScoreLearningView";
import { useT } from "../shared/i18n";
import { EisCohortWeeklyTrendChart } from "./EisCohortWeeklyTrendChart";
import { EisReadoutPnlRecap } from "./EisReadoutPnlRecap";
import { EisSuperScoreLearningSection } from "./EisSuperScoreLearningSection";

export function EisEvolutionSection({ reloadToken = 0 }: { reloadToken?: number }) {
  const t = useT();
  const [weeklyHistory, setWeeklyHistory] = useState<EisCohortWeeklyHistoryDoc | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);
  const [superOverview, setSuperOverview] = useState<EisSuperScoreOverview | null>(null);
  const [superLoading, setSuperLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setWeeklyLoading(true);
    void fetchEisCohortWeeklyHistory()
      .then((doc) => {
        if (!cancelled) setWeeklyHistory(doc);
      })
      .catch(() => {
        if (!cancelled) setWeeklyHistory(null);
      })
      .finally(() => {
        if (!cancelled) setWeeklyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    setSuperLoading(true);
    void loadEisSuperScoreOverview()
      .then((doc) => {
        if (!cancelled) setSuperOverview(doc);
      })
      .catch(() => {
        if (!cancelled) setSuperOverview(null);
      })
      .finally(() => {
        if (!cancelled) setSuperLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return (
    <div className="rounded-xl border border-[rgb(var(--accent))]/25 bg-gradient-to-br from-white via-violet-50/30 to-emerald-50/25 p-4 space-y-5">
      <div>
        <h3 className="text-base font-semibold text-ink">{t("modelLab.qc.eisEvolution.title")}</h3>
        <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">{t("modelLab.qc.eisEvolution.lead")}</p>
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/90 p-3">
        <EisCohortWeeklyTrendChart history={weeklyHistory} loading={weeklyLoading} />
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/90 p-3">
        {superLoading ? (
          <p className="text-[11px] text-ink-muted py-2">{t("modelLab.qc.eisImpact.loading")}</p>
        ) : (
          <EisSuperScoreLearningSection overview={superOverview} />
        )}
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-white/90 p-3">
        <EisReadoutPnlRecap />
      </div>
    </div>
  );
}
