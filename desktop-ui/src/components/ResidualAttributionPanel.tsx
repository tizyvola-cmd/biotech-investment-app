/**
 * Former "Why today moved" attribution strip — removed from deep-dive UI
 * (replaced by the compact KPI ribbon). Detail modal stays available for
 * any future investigation tooling.
 */
import type { ResidualMoveBreakdown } from "../sheet/residualMoveAttribution";

export function ResidualAttributionPanel(_props: {
  breakdown: ResidualMoveBreakdown | null | undefined;
  ticker: string;
  lang: "it" | "en";
}) {
  return null;
}
