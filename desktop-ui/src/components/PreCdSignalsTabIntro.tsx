import type { PreCdSignalsScope } from "../sheet/preCdSignalsScope";
import { useT } from "../shared/i18n";

import { MODEL_TAB_INTRO_SECTION } from "./modelLabIntroStyles";

/** Spiegazione in cima alla tab Pre-CD signals — varia per finestra temporale. */
export function PreCdSignalsTabIntro({ scope }: { scope: PreCdSignalsScope }) {
  const t = useT();
  const suffix = scope === "nearCd" ? "Near" : "Runup";

  const steps = [
    t(`preCd.overviewStep1${suffix}` as "preCd.overviewStep1Runup"),
    t("preCd.overviewStep2"),
    t("preCd.overviewStep3"),
  ];

  return (
    <section className={MODEL_TAB_INTRO_SECTION}>
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0 select-none" role="img" aria-hidden>
          {scope === "nearCd" ? "🎯" : "📡"}
        </span>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-semibold text-ink">
            {t(`preCd.overviewTitle${suffix}` as "preCd.overviewTitleRunup")}
          </h3>
          <p className="text-[13px] leading-snug text-ink/90">
            {t(`preCd.overviewLead${suffix}` as "preCd.overviewLeadRunup")}
          </p>
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
