/** Composite score bar: red (-100) → yellow (0) → green (+100). */

import {
  compositeScoreBarGradient,
  compositeScoreMarkerPct,
} from "../sheet/scoringEngine";

export function CompositeScoreBar({
  score,
  className = "",
  showLabel = true,
}: {
  score: number;
  className?: string;
  showLabel?: boolean;
}) {
  const pct = compositeScoreMarkerPct(score);
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <div className="relative flex-1 h-2.5 rounded-full overflow-hidden min-w-[6rem]">
        <div
          className="absolute inset-0"
          style={{ background: compositeScoreBarGradient() }}
          aria-hidden
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-ink shadow-sm"
          style={{ left: `calc(${pct}% - 1px)` }}
          title={`Score ${score >= 0 ? "+" : ""}${score.toFixed(0)}`}
          aria-hidden
        />
      </div>
      {showLabel ? (
        <span className="text-[11px] font-bold tabular-nums shrink-0 w-10 text-right">
          {score >= 0 ? "+" : ""}
          {Math.round(score)}
        </span>
      ) : null}
    </div>
  );
}
