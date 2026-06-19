import type { RascoreSignalImpactView } from "../sheet/rascoreSignalImpactView";
import { useT } from "../shared/i18n";

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 10) / 10}%`;
}

export function RascoreReliabilityAnswers({ view }: { view: RascoreSignalImpactView }) {
  const t = useT();
  const rel = view.reliability;
  const cohort = view.cohort;

  const investAnswer =
    rel.investMinScore != null && rel.investGrow7dPct != null
      ? t("modelLab.qc.rascoreImpact.answer.investYes", {
          score: String(rel.investMinScore),
          pct: fmtPct(rel.investGrow7dPct),
        })
      : rel.bestBandLabel != null && rel.bestGrow7dPct != null
        ? t("modelLab.qc.rascoreImpact.answer.investWeak", {
            band: rel.bestBandLabel,
            pct: fmtPct(rel.bestGrow7dPct),
          })
        : t("modelLab.qc.rascoreImpact.answer.investNo");

  const timeAnswer = t("modelLab.qc.rascoreImpact.answer.timeWindow");

  const cohortAnswer =
    cohort.scoreMin != null && cohort.scoreMax != null
      ? t("modelLab.qc.rascoreImpact.answer.cohortRange", {
          min: String(cohort.scoreMin),
          max: String(cohort.scoreMax),
        })
      : "—";

  return (
    <div className="rounded-xl border border-[rgb(var(--panel-feed-border))]/55 bg-gradient-to-br from-white via-[rgb(var(--panel-mint-bg-soft))]/40 to-[rgb(var(--panel-feed-header-bg))]/50 px-3 py-2.5 space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
        {t("modelLab.qc.rascoreImpact.answer.title")}
      </p>
      <ol className="space-y-2 text-[11px] leading-relaxed text-ink list-none">
        <li className="flex gap-2">
          <span className="shrink-0 font-bold text-[rgb(var(--panel-feed-accent-strong))]">i)</span>
          <span>{investAnswer}</span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-bold text-[rgb(var(--panel-feed-accent-strong))]">ii)</span>
          <span>{timeAnswer}</span>
        </li>
      </ol>
      <p className="text-[10px] text-ink-muted border-t border-[rgb(var(--panel-feed-border))]/35 pt-2">
        {cohortAnswer}
        {cohort.missingHighRa ? (
          <span className="block mt-0.5 font-medium text-amber-800">
            {t("modelLab.qc.rascoreImpact.answer.noHighRa")}
          </span>
        ) : null}
      </p>
    </div>
  );
}
