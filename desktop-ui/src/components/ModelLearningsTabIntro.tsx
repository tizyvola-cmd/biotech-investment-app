import { useT } from "../shared/i18n";

import { MODEL_TAB_INTRO_SECTION } from "./modelLabIntroStyles";

/** Spiegazione fissa in cima alla tab Model learnings — cosa fa e come impara il modello. */
export function ModelLearningsTabIntro() {
  const t = useT();

  const steps = [
    t("modelLab.learnings.overviewStep1"),
    t("modelLab.learnings.overviewStep2"),
    t("modelLab.learnings.overviewStep3"),
  ];

  return (
    <section className={MODEL_TAB_INTRO_SECTION}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0 select-none" role="img" aria-hidden>
          🧠
        </span>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">{t("modelLab.learnings.overviewTitle")}</h3>
          <p className="text-[13px] leading-snug text-ink/90">{t("modelLab.learnings.overviewLead")}</p>
        </div>
      </div>
      <ol className="space-y-1.5 text-[12px] leading-snug text-ink-muted list-decimal list-inside pl-1">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
