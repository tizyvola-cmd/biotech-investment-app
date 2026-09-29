/**
 * Compact residual badge — disabled (deep-dive no longer shows "Why today moved").
 */
import type { ResidualMoveBreakdown } from "../sheet/residualMoveAttribution";

export function ResidualAttributionBadge(_props: {
  breakdown: ResidualMoveBreakdown | null | undefined;
  lang: "it" | "en";
  compact?: boolean;
  ticker?: string;
}) {
  return null;
}
