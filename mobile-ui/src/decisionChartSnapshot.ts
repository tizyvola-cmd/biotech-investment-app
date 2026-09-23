import type { MobileDashboardSnapshot } from "./dashboardTypes";
import type { DecisionChartTickerRow, DecisionRec } from "./decisionChartLogic";
import type { DecisionChartViews } from "./decisionChartScope";
import { emptyDecisionChartViews } from "./decisionChartScope";

/** Prefer scoped views published by desktop / VPS refresh. */
export function resolveDecisionChartViews(
  snapshot: MobileDashboardSnapshot | null | undefined,
): DecisionChartViews {
  if (snapshot?.decisionChartViews) {
    const v = snapshot.decisionChartViews;
    return {
      portfolio: v.portfolio ?? [],
      oppHot: v.oppHot ?? [],
      oppWatch: v.oppWatch ?? [],
    };
  }
  if (snapshot?.decisionChartRows?.length) {
    return legacyViewsFromRows(snapshot.decisionChartRows);
  }
  return emptyDecisionChartViews();
}

/** Legacy flat rows: split portfolio vs off-portfolio (default opp → hot, desktop CD scope). */
export function legacyViewsFromRows(rows: DecisionChartTickerRow[]): DecisionChartViews {
  const portfolio: DecisionChartTickerRow[] = [];
  const oppHot: DecisionChartTickerRow[] = [];
  const oppWatch: DecisionChartTickerRow[] = [];
  for (const r of rows) {
    if (r.hasPortfolio) portfolio.push(r);
    else oppHot.push(r);
  }
  return { portfolio, oppHot, oppWatch };
}

export function allDecisionRowsFromViews(views: DecisionChartViews): DecisionChartTickerRow[] {
  const seen = new Set<string>();
  const out: DecisionChartTickerRow[] = [];
  for (const list of [views.portfolio, views.oppHot, views.oppWatch]) {
    for (const r of list) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      out.push(r);
    }
  }
  return out;
}

export function findDecisionRowInSnapshot(
  snapshot: MobileDashboardSnapshot | null | undefined,
  key: string,
): DecisionChartTickerRow | null {
  if (!snapshot || !key) return null;
  const views = resolveDecisionChartViews(snapshot);
  for (const list of [views.portfolio, views.oppHot, views.oppWatch]) {
    const hit = list.find((r) => r.key === key);
    if (hit) return hit;
  }
  return snapshot.decisionChartRows?.find((r) => r.key === key) ?? null;
}

export function decisionRecFromSnapshot(
  snapshot: MobileDashboardSnapshot | null | undefined,
  key: string,
): DecisionRec | null {
  return findDecisionRowInSnapshot(snapshot, key)?.rec ?? null;
}

export function snapshotHasDecisionChartData(snapshot: MobileDashboardSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  const views = snapshot.decisionChartViews;
  if (views) {
    return (
      (views.portfolio?.length ?? 0) +
        (views.oppHot?.length ?? 0) +
        (views.oppWatch?.length ?? 0) >
      0
    );
  }
  return (snapshot.decisionChartRows?.length ?? 0) > 0;
}
