import {
  formatRecommendationGainIdeaShort,
  recommendationGainIdeaTooltip,
  type RecommendationGainIdea,
} from "../sheet/recommendationGainIdea";
import type { DealTemperature } from "../sheet/recommendationDealUrgency";
import { portfolioToneSignalClass } from "../sheet/portfolioGainLossStyle";

export function RecommendationGainIdeaCell({
  idea,
  lang,
  miiAngleDeg,
  variant = "table",
  dealIntensity = 0,
  dealTemperature = null,
}: {
  idea: RecommendationGainIdea | null | undefined;
  lang: "it" | "en";
  miiAngleDeg?: number | null;
  variant?: "table" | "compact" | "inline";
  /** 0–1 urgenza deal — colore più intenso se alto */
  dealIntensity?: number;
  dealTemperature?: DealTemperature | null;
}) {
  if (idea?.gainEur == null || idea.days == null) {
    const tip = recommendationGainIdeaTooltip(
      idea ?? {
        gainEur: null,
        returnPct: null,
        adjustedReturnPct: null,
        days: null,
        capitalEur: 0,
        miiScale: 1,
        provisional: false,
        source: "none",
        unavailableReason: null,
      },
      lang,
      miiAngleDeg,
    );
    if (variant === "inline") {
      return (
        <span className="text-ink-muted/70 text-[10px] cursor-help" title={tip}>
          {lang === "it" ? "n.d." : "n/a"}
        </span>
      );
    }
    return (
      <span className="text-ink-muted text-[10px] cursor-help underline decoration-dotted decoration-ink-muted/40" title={tip}>
        —
      </span>
    );
  }

  const tip = recommendationGainIdeaTooltip(idea, lang, miiAngleDeg);
  const label = formatRecommendationGainIdeaShort(idea, lang);
  const toneCls =
    dealIntensity > 0.35
      ? dealTemperature === "cold"
        ? dealIntensity > 0.7
          ? "text-sky-700 font-bold dark:text-sky-300"
          : "text-sky-600/90 font-semibold dark:text-sky-400"
        : dealIntensity > 0.7
          ? "text-red-700 font-bold"
          : "text-red-600/90 font-semibold"
      : portfolioToneSignalClass(
          idea.gainEur > 0 ? "gain" : idea.gainEur < 0 ? "loss" : "flat",
        );

  if (variant === "inline") {
    return (
      <span className={`text-[9px] tabular-nums font-semibold ${toneCls}`} title={tip}>
        {label}
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={`text-[10px] tabular-nums font-semibold leading-tight ${toneCls}`} title={tip}>
        {label}
      </span>
    );
  }

  return (
    <div className="text-[10px] leading-snug tabular-nums text-center" title={tip}>
      <div className={`font-semibold ${toneCls}`}>{label}</div>
      {idea.adjustedReturnPct != null ? (
        <div className="text-[9px] text-ink-muted/90 mt-0.5">
          {idea.adjustedReturnPct >= 0 ? "+" : ""}
          {idea.adjustedReturnPct.toFixed(1)}%
          {idea.provisional ? (lang === "it" ? " · prov." : " · prov.") : null}
        </div>
      ) : null}
    </div>
  );
}
