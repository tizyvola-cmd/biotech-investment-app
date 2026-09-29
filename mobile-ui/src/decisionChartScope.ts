import type { DecisionChartTickerRow } from "./decisionChartLogic";

export type DecisionChartViewId = "portfolio" | "oppHot" | "oppWatch";

export type DecisionChartViews = Record<DecisionChartViewId, DecisionChartTickerRow[]>;

export type OppPnl24Filter = "all" | "gain24h" | "loss24h";

/** Shared with desktop Loss Analysis — same CD window (hot vs watch). */
export const SIM_CD_HORIZON_STORAGE_KEY = "supernova_sim_cd_horizon_scope_v1";

const SCOPE_KEY = "supernova.mobile.decision_chart_scope_v1";

function cdHorizonToViewId(scope: "hot" | "watch"): DecisionChartViewId {
  return scope === "watch" ? "oppWatch" : "oppHot";
}

function viewIdToCdHorizon(view: DecisionChartViewId): "hot" | "watch" | null {
  if (view === "oppHot") return "hot";
  if (view === "oppWatch") return "watch";
  return null;
}

export function loadDecisionChartScope(snapshotScope?: DecisionChartViewId | null): DecisionChartViewId {
  if (snapshotScope === "portfolio" || snapshotScope === "oppHot" || snapshotScope === "oppWatch") {
    return snapshotScope;
  }
  try {
    const cdRaw = localStorage.getItem(SIM_CD_HORIZON_STORAGE_KEY);
    if (cdRaw === "watch") return "oppWatch";
    if (cdRaw === "hot") return "oppHot";
    const raw = localStorage.getItem(SCOPE_KEY);
    if (raw === "portfolio" || raw === "oppHot" || raw === "oppWatch") return raw;
  } catch {
    /* private mode */
  }
  return "oppHot";
}

export function saveDecisionChartScope(scope: DecisionChartViewId): void {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
    const cd = viewIdToCdHorizon(scope);
    if (cd) localStorage.setItem(SIM_CD_HORIZON_STORAGE_KEY, cd);
  } catch {
    /* ignore */
  }
}

export function matchesOppPnl24Filter(row: DecisionChartTickerRow, filter: OppPnl24Filter): boolean {
  if (filter === "all") return true;
  const pct = row.pnlPct24h;
  if (pct == null || !Number.isFinite(pct)) return false;
  if (filter === "gain24h") return pct > 0;
  if (filter === "loss24h") return pct < 0;
  return true;
}

export function applyOppPnl24Filter(
  rows: DecisionChartTickerRow[],
  filter: OppPnl24Filter,
): DecisionChartTickerRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => matchesOppPnl24Filter(r, filter));
}

export function countOppPnl24(rows: DecisionChartTickerRow[], filter: "gain24h" | "loss24h"): number {
  return rows.filter((r) => matchesOppPnl24Filter(r, filter)).length;
}

export function emptyDecisionChartViews(): DecisionChartViews {
  return { portfolio: [], oppHot: [], oppWatch: [] };
}

export { legacyViewsFromRows } from "./decisionChartSnapshot";
