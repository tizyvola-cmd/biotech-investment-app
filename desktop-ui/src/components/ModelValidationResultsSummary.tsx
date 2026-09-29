import { buildValidationResultsSummary } from "../sheet/modelValidationResultsSummary";
import type { EvalComparison, EvaluationResults } from "../data/evaluationModelData";
import { useT } from "../shared/i18n";
import { MODEL_TAB_INTRO_SECTION } from "./modelLabIntroStyles";

const TONE_HEADLINE: Record<string, string> = {
  good: "text-[rgb(var(--signal-up))]",
  warn: "text-[rgb(var(--warn))]",
  bad: "text-[rgb(var(--signal-down))]",
  neutral: "text-ink",
};

/** Esito T-5 in linguaggio semplice — stesso layout delle altre tab Model analysis. */
export function ModelValidationResultsSummary({
  data,
  comparison,
}: {
  data: EvaluationResults | null;
  comparison: EvalComparison | null;
}) {
  const t = useT();
  const summary = buildValidationResultsSummary(data, comparison);
  if (!summary) return null;

  const icon =
    summary.tone === "good" ? "✓" : summary.tone === "bad" ? "!" : "◉";

  return (
    <section className={MODEL_TAB_INTRO_SECTION}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0 select-none" role="img" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">{t("modelLab.validation.resultsTitle")}</h3>
          <p
            className={`text-[13px] font-medium leading-snug ${TONE_HEADLINE[summary.tone] ?? TONE_HEADLINE.neutral}`}
          >
            {t(summary.headlineKey, summary.headlineVars)}
          </p>
          {summary.bullets.length > 0 ? (
            <ul className="space-y-1 text-[12px] leading-snug text-ink-muted">
              {summary.bullets.map((b) => (
                <li key={b.key}>{t(b.key, b.vars)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
