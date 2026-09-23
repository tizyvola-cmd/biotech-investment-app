/** Recommendation badge + override banner for Supernova stock scoring. */

import type { ScoringOverrideFlag, StockScoreResult } from "../sheet/scoringEngine";
import { OVERRIDE_FLAG_COLORS, RECOMMENDATION_COLORS } from "../sheet/scoringEngine";

export function StockScoreBadge({
  result,
  compact = false,
}: {
  result: Pick<StockScoreResult, "recommendation" | "color">;
  compact?: boolean;
}) {
  const c = result.color ?? RECOMMENDATION_COLORS[result.recommendation];
  return (
    <span
      className={`inline-flex items-center font-bold uppercase tracking-wide rounded-full border ${
        compact ? "text-[9px] px-2 py-0.5" : "text-[10px] px-2.5 py-1"
      } ${c.tailwind_bg} ${c.tailwind_text}`}
      style={{ borderColor: `${c.hex}40` }}
    >
      {result.recommendation}
    </span>
  );
}

export function StockScoreOverrideBanner({
  flag,
  className = "",
}: {
  flag: ScoringOverrideFlag;
  className?: string;
}) {
  if (!flag) return null;
  const meta = OVERRIDE_FLAG_COLORS[flag];
  const note =
    flag === "PRE-CATALYST LOCK"
      ? "Pre-event binary risk — recommendation suspended"
      : flag === "POST-EVENT DISLOCATION"
        ? "Potential overreaction — manual review suggested"
        : "Dilution/bankruptcy risk imminent";
  return (
    <div
      className={`rounded-md border px-2.5 py-1.5 text-[10px] font-semibold ${meta.tailwind_bg} ${meta.tailwind_text} ${className}`}
      style={{ borderColor: `${meta.hex}40` }}
    >
      {flag} · {note}
    </div>
  );
}
