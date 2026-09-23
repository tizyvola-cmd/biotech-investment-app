import { useT } from "../shared/i18n";
import { MODEL_TAB_INTRO_SECTION } from "./modelLabIntroStyles";

/** Spiegazione in cima alla tab Validation — allineata a Model learnings / Pre-CD. */
export function ModelValidationTabIntro() {
  const t = useT();

  const steps = [
    t("modelLab.validation.overviewStep1"),
    t("modelLab.validation.overviewStep2"),
    t("modelLab.validation.overviewStep3"),
    t("modelLab.validation.overviewStep4"),
  ];

  return (
    <section className={MODEL_TAB_INTRO_SECTION}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0 select-none" role="img" aria-hidden>
          📐
        </span>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">{t("modelLab.validation.overviewTitle")}</h3>
          <p className="text-[13px] leading-snug text-ink/90">{t("modelLab.validation.overviewLead")}</p>
        </div>
      </div>
      <ol className="space-y-1.5 text-[12px] leading-snug text-ink-muted list-decimal list-inside pl-1">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <details className="text-[11px] text-ink-muted border-t border-[rgb(var(--border))]/35 pt-2">
        <summary className="cursor-pointer hover:text-ink select-none">
          {t("modelLab.validation.glossaryToggle")}
        </summary>
        <ul className="mt-1.5 space-y-1 pl-1">
          <li>{t("modelLab.validation.metricMae")}</li>
          <li>{t("modelLab.validation.metricBaseline")}</li>
          <li>{t("modelLab.validation.metricLookback")}</li>
          <li>{t("modelLab.validation.metricFeedbackLoop")}</li>
        </ul>
      </details>
    </section>
  );
}
