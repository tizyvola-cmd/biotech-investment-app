/** Full stock scoring panel — composite score, components, summary. */

import type { StockScoreResult } from "../sheet/scoringEngine";
import {
  COMPONENT_ORDER,
  SCORING_WEIGHTS,
  componentContributionClass,
  componentMax,
  formatComponentLabel,
} from "../sheet/scoringEngine";
import { CompositeScoreBar } from "./CompositeScoreBar";
import { StockScoreBadge, StockScoreOverrideBanner } from "./StockScoreBadge";

export function StockScorePanel({
  result,
  lang = "en",
}: {
  result: StockScoreResult;
  lang?: "it" | "en";
}) {
  const it = lang === "it";
  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold text-ink">{result.ticker}</p>
          <p className="text-[10px] text-ink-muted">
            {it ? "Confidenza" : "Confidence"}: {Math.round(result.confidence_score)}%
          </p>
        </div>
        <StockScoreBadge result={result} />
      </div>

      {result.override_flag ? (
        <StockScoreOverrideBanner flag={result.override_flag} />
      ) : null}

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
          {it ? "Score composito" : "Composite score"}
        </p>
        <CompositeScoreBar score={result.composite_score} />
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
          {it ? "Componenti" : "Components"}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
          {COMPONENT_ORDER.map((key) => {
            const v = result.component_scores[key];
            const mx = componentMax(key);
            const w = Math.round(SCORING_WEIGHTS[key] * 100);
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 text-[10px] border-b border-[rgb(var(--border))]/30 py-0.5"
              >
                <span className="text-ink-muted truncate" title={`${w}% weight · max ±${mx}`}>
                  {formatComponentLabel(key)}
                </span>
                <span className={`font-semibold tabular-nums shrink-0 ${componentContributionClass(v)}`}>
                  {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-ink/85 leading-snug border-t border-[rgb(var(--border))]/30 pt-2">
        {result.signal_summary}
      </p>
    </div>
  );
}
