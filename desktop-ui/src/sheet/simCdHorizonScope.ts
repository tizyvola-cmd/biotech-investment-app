/**
 * Ambito CD tabella Simulation: primario ≤2 mesi (hot) vs anticipate 4–2 mesi (watch).
 */
import { simulationRowSeriesKey } from "../data/simulationCharts";
import {
  isHotZone,
  isWatchZone,
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
} from "./cdHorizons";
import { daysFromToday, resolveExpectedGainPlan } from "./simulationPlanGain";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import type { ChartPoint } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { rowHasActivePortfolio, type SimulationPosition } from "./simulationPosition";

export type SimCdHorizonScope = "hot" | "watch";

const STORAGE_KEY = "supernova_sim_cd_horizon_scope_v1";

export function loadSimCdHorizonScope(): SimCdHorizonScope {
  if (typeof window === "undefined") return "hot";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "watch" || raw === "hot") return raw;
  } catch {
    /* private mode */
  }
  return "hot";
}

export function saveSimCdHorizonScope(scope: SimCdHorizonScope): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, scope);
}

export function daysToCdForPosition(
  p: SimulationPosition,
  simRow: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
  chartPts: ChartPoint[] | null,
): number | null {
  if (!simRow) return null;
  const inp = inputs[p.key];
  const planCap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
  const gainPlan = resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts });
  return gainPlan?.daysToCd ?? null;
}

export function positionMatchesCdHorizon(
  days: number | null,
  scope: SimCdHorizonScope,
): boolean {
  if (scope === "hot") return isHotZone(days);
  return isWatchZone(days);
}

export function filterPositionsByCdHorizon(
  positions: SimulationPosition[],
  scope: SimCdHorizonScope,
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): SimulationPosition[] {
  return positions.filter((p) => {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const days = daysToCdForPosition(p, simRow, inputs, chartPts);
    return positionMatchesCdHorizon(days, scope);
  });
}

export function countPositionsByCdHorizon(
  positions: SimulationPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): { hot: number; watch: number } {
  let hot = 0;
  let watch = 0;
  for (const p of positions) {
    const simRow = simRowByKey.get(p.key);
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    const days = daysToCdForPosition(p, simRow, inputs, chartPts);
    if (isHotZone(days)) hot += 1;
    else if (isWatchZone(days)) watch += 1;
  }
  return { hot, watch };
}

function sortSimRowsByDaysToCd(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const da = daysFromToday(String(a["Completion Date"] ?? "")) ?? 9999;
    const db = daysFromToday(String(b["Completion Date"] ?? "")) ?? 9999;
    return da - db;
  });
}

/** Righe Simulation fuori portafoglio per finestra CD (hot ≤2 mesi · watch 4–2 mesi). */
export function filterOffPortfolioByCdHorizonSimRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
  scope: SimCdHorizonScope,
): Record<string, unknown>[] {
  const matches = scope === "hot" ? isHotZone : isWatchZone;
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (rowHasActivePortfolio(r, inputs)) continue;
    const cd = String(r["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;
    if (!matches(daysFromToday(cd))) continue;
    out.push(r);
  }
  return sortSimRowsByDaysToCd(out);
}

export function countOffPortfolioByCdHorizon(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
): { hot: number; watch: number } {
  let hot = 0;
  let watch = 0;
  for (const r of rows) {
    if (rowHasActivePortfolio(r, inputs)) continue;
    const cd = String(r["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;
    const days = daysFromToday(cd);
    if (isHotZone(days)) hot += 1;
    else if (isWatchZone(days)) watch += 1;
  }
  return { hot, watch };
}

/** Righe Simulation fuori portafoglio con CD in zona hot (≤2 mesi). */
export function filterOffPortfolioHotZoneSimRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
): Record<string, unknown>[] {
  return filterOffPortfolioByCdHorizonSimRows(rows, inputs, "hot");
}

export { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS };
