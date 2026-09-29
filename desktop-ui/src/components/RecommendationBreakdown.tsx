import type { RecommendationBreakdownModel } from "../sheet/recommendationContributions";
import type { DecisionChartTickerRow } from "../sheet/decisionChartLogic";
import type { LossAnalysisScoreSection } from "../sheet/investSimKeys";
import { DecisionSpectrum } from "./DecisionSpectrum";
import { DecisionScoreBars } from "./DecisionScoreBars";

export type RecommendationBreakdownProps = RecommendationBreakdownModel & {
  it?: boolean;
  row: DecisionChartTickerRow;
  onScrollToCard?: (rowKey: string, section?: LossAnalysisScoreSection) => void;
};

function SwingFactor({
  model,
  it,
}: {
  model: RecommendationBreakdownModel;
  it: boolean;
}) {
  const sf = model.swingFactor;
  if (!sf) return null;

  const dirLabel =
    sf.direction === "buy"
      ? it
        ? "verso Buy"
        : "toward Buy"
      : it
        ? "verso Sell"
        : "toward Sell";

  return (
    <div className="recommendation-swing rounded-md border border-amber-400/35 bg-amber-500/8 dark:bg-amber-500/10 px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        {it ? "Fattore swing" : "Swing factor"}
      </p>
      <p className="text-[11px] font-semibold text-ink mt-0.5">
        <span className="text-amber-700 dark:text-amber-400">{sf.label}</span>
        <span className="text-ink-muted font-normal"> · {dirLabel}</span>
        <span className="tabular-nums ml-1 text-ink">
          {sf.direction === "buy" ? "+" : "−"}
          {sf.distance} pt
        </span>
      </p>
      <p className="text-[10px] text-ink-muted mt-0.5 leading-snug">
        {it ? sf.detailIt : sf.detailEn}
      </p>
    </div>
  );
}

export function RecommendationBreakdown({
  it = false,
  row,
  onScrollToCard,
  ...model
}: RecommendationBreakdownProps) {
  const subtitle = it ? model.headlineIt : model.headlineEn;
  const trigger = it ? model.triggerIt : model.triggerEn;
  return (
    <div className="recommendation-breakdown mx-4 mb-2 rounded-lg border border-[rgb(var(--border))]/45 bg-white/70 dark:bg-black/15 px-3 py-2.5 space-y-3 font-variant-numeric tabular-nums">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">
          {it ? "Logica raccomandazione" : "Recommendation logic"}
        </p>
      </div>
      <DecisionSpectrum
        score={model.compositeScore}
        sellThreshold={model.sellThreshold}
        buyThreshold={model.buyThreshold}
        call={model.call}
        subtitle={subtitle}
        it={it}
      />
      <p className="text-[10px] text-ink-muted leading-snug -mt-1">{trigger}</p>
      <DecisionScoreBars row={row} it={it} onScrollToCard={onScrollToCard} />
      <SwingFactor model={model} it={it} />
    </div>
  );
}
