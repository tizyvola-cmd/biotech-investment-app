/**
 * Ambito CD tabella Simulation: primario ≤2 mesi (hot) vs anticipate 4–2 mesi (watch).
 */
import { simulationRowSeriesKey } from "../data/simulationCharts";
import {
  isHotZone,
  isWatchZone,
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
  SIM_PEAK_ZONE_DAYS,
} from "./cdHorizons";
import { daysFromToday, resolveExpectedGainPlan } from "./simulationPlanGain";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import type { ChartPoint } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import {
  commonTickersOnSheet,
  rowHasActivePortfolio,
  shouldHideRedundantWarrantRow,
  type SimulationPosition,
} from "./simulationPosition";

export type SimCdHorizonScope = "hot" | "watch" | "all";

/** Mobile Decision chart view ids — keep in sync with mobile-ui/decisionChartScope.ts */
export type MobileDecisionChartViewId = "portfolio" | "oppHot" | "oppWatch";

export const SIM_CD_HORIZON_STORAGE_KEY = "supernova_sim_cd_horizon_scope_v1";

const STORAGE_KEY = SIM_CD_HORIZON_STORAGE_KEY;

export function cdHorizonToMobileDecisionView(scope: SimCdHorizonScope): MobileDecisionChartViewId {
  return scope === "watch" ? "oppWatch" : "oppHot";
}

export function mobileDecisionViewToCdHorizon(
  view: MobileDecisionChartViewId,
): SimCdHorizonScope | null {
  if (view === "oppHot") return "hot";
  if (view === "oppWatch") return "watch";
  return null;
}

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
  window.dispatchEvent(new CustomEvent("supernova-cd-horizon-changed", { detail: scope }));
}

/** Hype funnel / catalyst-day / manual sidecar — keep visible in Early even if CD is far or past. */
export function isDiscoverySidecarRow(
  row: Record<string, unknown> | undefined | null,
): boolean {
  if (!row) return false;
  return Boolean(
    row.hype_volume_funnel ||
      row.guidance_calendar_catalyst ||
      row._manual,
  );
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
  if (gainPlan?.daysToCd != null) return gainPlan.daysToCd;
  return daysFromToday(String(simRow["Completion Date"] ?? p.completionDate ?? ""));
}

export function positionMatchesCdHorizon(
  days: number | null,
  scope: SimCdHorizonScope,
  simRow?: Record<string, unknown> | null,
): boolean {
  if (scope === "hot") return isHotZone(days);
  if (scope === "all") {
    return isHotZone(days) || positionMatchesCdHorizon(days, "watch", simRow);
  }
  // Early / watch: classic 61–120d, far-CD hype, and catalyst/manual sidecars (past or unknown).
  if (days != null && Number.isFinite(days) && days > SIM_HOT_ZONE_DAYS) return true;
  return isDiscoverySidecarRow(simRow) && !isHotZone(days);
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
    return positionMatchesCdHorizon(days, scope, simRow);
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
    else if (positionMatchesCdHorizon(days, "watch", simRow)) watch += 1;
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

/** Righe Simulation fuori portafoglio per finestra CD (hot ≤2 mesi · watch 4–2 mesi · all ≤4 mesi). */
export function filterOffPortfolioByCdHorizonSimRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
  scope: SimCdHorizonScope,
): Record<string, unknown>[] {
  const matches =
    scope === "hot" ? isHotZone :
    scope === "watch" ? isWatchZone :
    (days: number | null | undefined) => isHotZone(days) || isWatchZone(days);
  const commons = commonTickersOnSheet(rows);
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (rowHasActivePortfolio(r, inputs)) continue;
    // Drop JSPRW when JSPR is already on the sheet (trade common only).
    if (shouldHideRedundantWarrantRow(r, commons, inputs)) continue;
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
  opts?: { watchIncludesBeyond?: boolean },
): { hot: number; watch: number; all: number } {
  let hot = 0;
  let watch = 0;
  const beyondAsWatch = Boolean(opts?.watchIncludesBeyond);
  for (const r of rows) {
    if (rowHasActivePortfolio(r, inputs)) continue;
    const cd = String(r["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;
    const days = daysFromToday(cd);
    if (isHotZone(days)) hot += 1;
    else if (
      beyondAsWatch
        ? (days != null && Number.isFinite(days) && days > SIM_HOT_ZONE_DAYS) ||
          isDiscoverySidecarRow(r)
        : isWatchZone(days)
    ) {
      watch += 1;
    }
  }
  return { hot, watch, all: hot + watch };
}

/** Righe Simulation fuori portafoglio con CD in zona hot (≤2 mesi). */
export function filterOffPortfolioHotZoneSimRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
): Record<string, unknown>[] {
  return filterOffPortfolioByCdHorizonSimRows(rows, inputs, "hot");
}

/**
 * Keep Simulation rows whose Completion Date is today…≤ {@link SIM_HOT_ZONE_DAYS}
 * (Wind / Catalyst desk membership). Past-CD and far CD are dropped.
 */
export function filterSimRowsToHotZoneCd(
  rows: Array<Record<string, unknown>> | null | undefined,
): Array<Record<string, unknown>> {
  if (!rows?.length) return [];
  const commons = commonTickersOnSheet(rows);
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    if (shouldHideRedundantWarrantRow(row, commons)) continue;
    const days = daysFromToday(String(row["Completion Date"] ?? row.CD ?? ""));
    if (days == null || !Number.isFinite(days) || days < 0 || days > SIM_HOT_ZONE_DAYS) {
      continue;
    }
    out.push(row);
  }
  return out;
}

/** Shallow SheetTable clone limited to hot-zone CD rows (display membership). */
export function filterSimTableToHotZoneCd<T extends { rows?: Array<Record<string, unknown>>; row_count?: number }>(
  table: T | null | undefined,
): T | null {
  if (!table?.rows) return table ?? null;
  const rows = filterSimRowsToHotZoneCd(table.rows);
  if (rows.length === table.rows.length) return table;
  return { ...table, rows, row_count: rows.length };
}

export { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS, SIM_PEAK_ZONE_DAYS };
