/**
 * Score explanations — hover-only chip tips (no static SCORE LEGEND box).
 * Same pattern as DeepDiveKpiRibbon Cell tooltips.
 */
import type { ReactNode } from "react";

export function eisScoreLegendCopy(it: boolean): {
  clin: string;
  fin: string;
  corp: string;
  acc: string;
  eis: string;
} {
  return {
    clin: it
      ? "Clin — score Clinical della singola news o articolo scientifico (termometro / tassonomia). Σ Clin in alto somma le news e le pubblicazioni. Autori affiliati alla società: peso ×1.5. Non misura il movimento di prezzo."
      : "Clin — Clinical score of each news item or scientific paper (thermometer / taxonomy). Σ Clin above sums news and publications. Company-affiliated authors: ×1.5 weight. It does not measure the price move.",
    fin: it
      ? "Fin — score Financial della news (termometro / tassonomia): rilevanza finanziaria. Σ Fin somma le news. Non è EIS di mercato."
      : "Fin — Financial score of the news (thermometer / taxonomy): financial materiality. Σ Fin sums the news. Not market EIS.",
    corp: it
      ? "Corp — score Corporate della news (termometro / tassonomia). Σ Corp somma le news."
      : "Corp — Corporate score of the news (thermometer / taxonomy). Σ Corp sums the news.",
    acc: it
      ? "Acc — score Market Access della news (termometro / tassonomia). Σ Acc somma le news."
      : "Acc — Market Access score of the news (thermometer / taxonomy). Σ Acc sums the news.",
    eis: it
      ? "EIS 12h / 24h / 36h — Event Impact Score di mercato: reazione del prezzo a 12, 24 e 36 ore dalla pubblicazione. Solo per evento (non si somma). «—» = finestra non ancora chiusa o dato assente."
      : "EIS 12h / 24h / 36h — market Event Impact Score: price reaction at 12, 24 and 36 hours after the news is published. Per event only (never summed). “—” = window still open or no reading yet.",
  };
}

/** Wrap a score chip — tip appears only while the cursor is on the chip. */
export function ScoreChipTip({
  tip,
  children,
  className = "",
  align = "right",
}: {
  tip: string;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <span className={`group/scoretip relative inline-flex max-w-full ${className}`.trim()}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 top-full mt-1.5 hidden w-[min(20rem,72vw)] rounded-xl border border-white/[0.12] bg-[#121729] px-3 py-2.5 text-left text-[11px] leading-snug text-[#C5CDDC] shadow-2xl group-hover/scoretip:block ${
          align === "left" ? "left-0" : "right-0"
        }`}
      >
        {tip}
      </span>
    </span>
  );
}
