import type { ChartPoint } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import {
  primaryDaysFromGainPlan,
  primaryReturnPctFromGainPlan,
  roiPerDayPrimaryFromGainPlan,
} from "./canonicalRoi";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import type { SimulationPosition } from "./simulationPosition";

export type SimTableSortId =
  | "default"
  | "roiDesc"
  | "roiAsc"
  | "daysAsc"
  | "daysDesc"
  | "roiPerDayDesc";

export const DEFAULT_SIM_TABLE_SORT: SimTableSortId = "default";

const STORAGE_KEY = "supernova_sim_table_sort";

export function loadSimTableSort(): SimTableSortId {
  if (typeof window === "undefined") return DEFAULT_SIM_TABLE_SORT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "roiDesc") return "roiDesc";
  } catch {
    /* private mode */
  }
  return DEFAULT_SIM_TABLE_SORT;
}

/** Pick stocks: toggle highest ROI first vs sheet default order. */
export function toggleRoiDescSort(current: SimTableSortId): SimTableSortId {
  return current === "roiDesc" ? "default" : "roiDesc";
}

export function saveSimTableSort(sort: SimTableSortId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, sort);
}

export type SimSortMetrics = {
  roiPct: number | null;
  days: number | null;
  roiPerDay: number;
};

export function simSortMetricsForPosition(
  p: SimulationPosition,
  simRow: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
  chartPts: ChartPoint[] | null,
): SimSortMetrics {
  const inp = inputs[p.key];
  const planCap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
  const gainPlan = simRow ? resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts }) : null;
  const roiPct = gainPlan ? primaryReturnPctFromGainPlan(gainPlan) : null;
  const days = gainPlan ? primaryDaysFromGainPlan(gainPlan) : null;
  return {
    roiPct,
    days,
    roiPerDay: gainPlan ? roiPerDayPrimaryFromGainPlan(gainPlan) : 0,
  };
}

function cmpTicker(a: SimulationPosition, b: SimulationPosition): number {
  return a.ticker.localeCompare(b.ticker);
}

export function sortSimPositionsBySortId(
  positions: SimulationPosition[],
  sortId: SimTableSortId,
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  simulationRowSeriesKey: (row: Record<string, unknown>) => string | null,
): SimulationPosition[] {
  if (sortId === "default" || !positions.length) return positions;

  const scored = positions.map((p) => {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    return { p, ...simSortMetricsForPosition(p, simRow, inputs, chartPts) };
  });

  scored.sort((a, b) => {
    switch (sortId) {
      case "roiDesc":
        return (
          (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity) ||
          (a.days ?? Infinity) - (b.days ?? Infinity) ||
          cmpTicker(a.p, b.p)
        );
      case "roiAsc":
        return (
          (a.roiPct ?? Infinity) - (b.roiPct ?? Infinity) ||
          (a.days ?? Infinity) - (b.days ?? Infinity) ||
          cmpTicker(a.p, b.p)
        );
      case "daysAsc":
        return (
          (a.days ?? Infinity) - (b.days ?? Infinity) ||
          (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity) ||
          cmpTicker(a.p, b.p)
        );
      case "daysDesc":
        return (
          (b.days ?? -Infinity) - (a.days ?? -Infinity) ||
          (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity) ||
          cmpTicker(a.p, b.p)
        );
      case "roiPerDayDesc":
        return b.roiPerDay - a.roiPerDay || cmpTicker(a.p, b.p);
      default:
        return 0;
    }
  });

  return scored.map((s) => s.p);
}

/** Cycle ROI column header: default → desc → asc → default */
export function cycleRoiColumnSort(current: SimTableSortId): SimTableSortId {
  if (current === "roiDesc") return "roiAsc";
  if (current === "roiAsc") return "default";
  return "roiDesc";
}

/** Cycle days sort: default → asc → desc → default */
export function cycleDaysColumnSort(current: SimTableSortId): SimTableSortId {
  if (current === "daysAsc") return "daysDesc";
  if (current === "daysDesc") return "default";
  return "daysAsc";
}

export function sortIndicator(sortId: SimTableSortId, col: "roi" | "days"): string {
  if (col === "roi") {
    if (sortId === "roiDesc") return " ↓";
    if (sortId === "roiAsc") return " ↑";
  }
  if (col === "days") {
    if (sortId === "daysAsc") return " ↑";
    if (sortId === "daysDesc") return " ↓";
  }
  return "";
}
