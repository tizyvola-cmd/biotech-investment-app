/**
 * Rank / filter company slope summaries by peak event severity.
 */

import type { CompanySlopeSummary, UnifiedSlopeFeedRow } from "./slopeEventsFeed";
import {
  compareSlopeFeedRows,
  eventImpactAbs,
  slopeTypePriority,
} from "./slopeErrorRank";
import {
  computeSlopeEventSeverity,
  slopesFromFeedRow,
  type SlopeEventSeverity,
} from "./slopeEventSummary";
import type { SlopeSeverityFloor } from "./slopeSeverityPrefs";

export { eventImpactAbs } from "./slopeErrorRank";

export const SEVERITY_RANK: Record<SlopeEventSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function severityMeetsFloor(
  sev: SlopeEventSeverity,
  floor: SlopeSeverityFloor,
): boolean {
  return SEVERITY_RANK[sev] >= SEVERITY_RANK[floor];
}

function rowSeverity(row: UnifiedSlopeFeedRow): SlopeEventSeverity {
  const { slope5d, slope20d, delta } = slopesFromFeedRow(row);
  return computeSlopeEventSeverity(row.kind, slope5d, slope20d, delta);
}

/** Worst event: tipo (rev > contrarian > dec) poi |Δ|. */
export function pickCompanyDisplayRow(
  rows: UnifiedSlopeFeedRow[],
): UnifiedSlopeFeedRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => compareSlopeFeedRows(b, a))[0];
}

export type RankedCompanySlope = CompanySlopeSummary & {
  peakSeverity: SlopeEventSeverity;
  peakTypeRank: number;
  peakRank: number;
  impact: number;
  displayRow: UnifiedSlopeFeedRow | null;
};

export function rankCompanySummary(co: CompanySlopeSummary): RankedCompanySlope {
  const displayRow = pickCompanyDisplayRow(co.rows);
  let peakTypeRank = 0;
  let impact = 0;
  let peakSeverity: SlopeEventSeverity = "low";

  for (const row of co.rows) {
    const tp = slopeTypePriority(row.kind);
    const imp = eventImpactAbs(row);
    if (tp > peakTypeRank || (tp === peakTypeRank && imp > impact)) {
      peakTypeRank = tp;
      impact = imp;
      peakSeverity = rowSeverity(row);
    }
  }

  if (displayRow) {
    peakSeverity = rowSeverity(displayRow);
  }

  return {
    ...co,
    peakSeverity,
    peakTypeRank,
    peakRank: SEVERITY_RANK[peakSeverity],
    impact,
    displayRow,
  };
}

export function filterAndSortCompanies(
  companies: CompanySlopeSummary[],
  floor: SlopeSeverityFloor,
): { visible: RankedCompanySlope[]; hiddenCount: number; total: number } {
  const ranked = companies.map(rankCompanySummary);
  const visible = ranked.filter((c) => severityMeetsFloor(c.peakSeverity, floor));
  visible.sort((a, b) => {
    if (b.peakTypeRank !== a.peakTypeRank) return b.peakTypeRank - a.peakTypeRank;
    if (b.impact !== a.impact) return b.impact - a.impact;
    if (b.activeChartCount !== a.activeChartCount) return b.activeChartCount - a.activeChartCount;
    if (b.latestAt !== a.latestAt) return b.latestAt - a.latestAt;
    return a.ticker.localeCompare(b.ticker);
  });
  return {
    visible,
    hiddenCount: ranked.length - visible.length,
    total: ranked.length,
  };
}

export function sortFeedRowsBySeverity(rows: UnifiedSlopeFeedRow[]): UnifiedSlopeFeedRow[] {
  return [...rows].sort((a, b) => compareSlopeFeedRows(b, a));
}
