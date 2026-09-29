/**
 * Off-book Evaluation extras: High Vol rescue after CD (not generic 24h+week movers).
 *
 * Off Book list = CD > 60d ∪ Hype/catalyst sidecars outside the 2-month window
 * ∪ past-CD names with VOL vs prev ≥ 150%.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { resolvePriceVariationHorizons } from "./priceVariationHorizons";
import type { PortfolioLossAlert } from "./portfolioLossUrgent";
import { resolveContG10 } from "./continuationScore";
import { daysFromToday } from "./simulationPlanGain";
import { isHotZone, SIM_HOT_ZONE_DAYS } from "./cdHorizons";
import { isVolumeSurge } from "./volumeVsPrevSession";
import type { VolumeVsPrevSessionRow } from "../api/supernova";
import {
  commonTickersOnSheet,
  isRedundantWarrantOpportunityRow,
  isStalePhantomOpportunityRow,
  rowHasActivePortfolio,
} from "./simulationPosition";
import { isDiscoverySidecarRow } from "./simCdHorizonScope";

/**
 * Week delta: explicit sheet 7d first, else cont_g10 (~10 sessions — the same
 * number the scan table and the Wind 10d column show).
 *
 * The chart-derived 7d is only a last resort, and never preferred over
 * cont_g10: once a row's Completion Date is past, the historical price series
 * ends before "now", so both interpolation points clamp to the last node and
 * the delta comes out as exactly 0.
 */
export function resolveEvaluationWeekPct(
  row: Record<string, unknown>,
  chartPts?: ChartPoint[] | null,
): number | null {
  const sheetD7 = resolvePriceVariationHorizons(row, null).d7;
  if (sheetD7 != null) return sheetD7;
  const g10 = resolveContG10(row);
  if (g10 != null && Number.isFinite(g10)) return g10;
  return resolvePriceVariationHorizons(row, chartPts).d7;
}

/** Both horizons strictly green — 24h + week (7d or cont_g10 fallback). */
export function hasEvaluationMomentumInclude(
  row: Record<string, unknown>,
  chartPts?: ChartPoint[] | null,
): boolean {
  const d1 = resolvePriceVariationHorizons(row, chartPts).d1;
  const d7 = resolveEvaluationWeekPct(row, chartPts);
  return d1 != null && d1 > 0 && d7 != null && d7 > 0;
}

function rowToOpportunityAlert(
  row: Record<string, unknown>,
): PortfolioLossAlert | null {
  const ticker = String(row["Ticker"] ?? "").trim();
  const cd = String(row["Completion Date"] ?? "").trim();
  if (!ticker || ticker.includes("TOTALE") || !cd || cd === "—") return null;
  return {
    key: normalizedRowKey(ticker, cd),
    ticker,
    completionDate: cd,
    pnlEur: 0,
    pnlPct: 0,
    capital: DEFAULT_PLAN_CAPITAL_EUR,
    valueNow: 0,
    buyPrice: 0,
    seriesKey: simulationRowSeriesKey(row),
  };
}

function isEligibleOffBookRow(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  commons: Set<string>,
): boolean {
  if (rowHasActivePortfolio(row, inputs)) return false;
  if (isStalePhantomOpportunityRow(row)) return false;
  if (isRedundantWarrantOpportunityRow(row, commons)) return false;
  return true;
}

/** CD still ahead, but not in the 2-month hot window (watch 4–2 mo and beyond). */
export function isOffBookUpcomingCd(days: number | null | undefined): boolean {
  return days != null && Number.isFinite(days) && days > SIM_HOT_ZONE_DAYS;
}

/** Past CD + High Vol (VOL vs prev ≥ 150% or 5m T_double flag). */
export function isHighVolOffBookRescue(
  days: number | null | undefined,
  highVol: boolean,
): boolean {
  return Boolean(highVol) && days != null && Number.isFinite(days) && days < 0;
}

export function tickerHasHighVol(
  ticker: string,
  volumeVsPrev?: Record<string, VolumeVsPrevSessionRow> | null,
  accelFlagged?: ReadonlySet<string> | null,
): boolean {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return false;
  if (accelFlagged?.has(tk)) return true;
  return isVolumeSurge(volumeVsPrev?.[tk]?.pct_of_prev);
}

/** Off-portfolio Simulation tickers whose CD has already passed. */
export function collectPastCdOffBookTickers(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): string[] {
  if (!simTable?.rows?.length) return [];
  const commons = commonTickersOnSheet(simTable.rows);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of simTable.rows) {
    if (!isEligibleOffBookRow(row, inputs, commons)) continue;
    const days = daysFromToday(String(row["Completion Date"] ?? ""));
    if (days == null || days >= 0) continue;
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out;
}

/**
 * Off-portfolio names whose CD is more than 2 months out (not hot, not past),
 * plus Hype / catalyst / manual sidecars that are not in the 2-month window
 * (past CD included — they stay in pipeline for the hype hold).
 */
export function detectOffBookUpcomingCdAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const commons = commonTickersOnSheet(simTable.rows);
  const out: PortfolioLossAlert[] = [];
  for (const row of simTable.rows) {
    if (!isEligibleOffBookRow(row, inputs, commons)) continue;
    const days = daysFromToday(String(row["Completion Date"] ?? ""));
    const sidecarKeep = isDiscoverySidecarRow(row) && !isHotZone(days);
    if (!isOffBookUpcomingCd(days) && !sidecarKeep) continue;
    const alert = rowToOpportunityAlert(row);
    if (alert) out.push(alert);
  }
  return out;
}

/**
 * Past-CD off-book names rescued by High Vol — not hot-zone (those stay in Within 2 mo)
 * and not a generic green 24h+week print.
 */
export function detectHighVolOffBookRescueAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  highVolTickers: Iterable<string> | null | undefined,
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const vol = new Set(
    [...(highVolTickers ?? [])].map((t) => t.trim().toUpperCase()).filter(Boolean),
  );
  if (!vol.size) return [];
  const commons = commonTickersOnSheet(simTable.rows);
  const out: PortfolioLossAlert[] = [];
  for (const row of simTable.rows) {
    if (!isEligibleOffBookRow(row, inputs, commons)) continue;
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (!vol.has(tk)) continue;
    const days = daysFromToday(String(row["Completion Date"] ?? ""));
    if (!isHighVolOffBookRescue(days, true)) continue;
    const alert = rowToOpportunityAlert(row);
    if (alert) out.push(alert);
  }
  return out;
}

/** Kept for scan-table week% tests — not used to populate Off Book. */
export function detectMomentumOpportunityAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  pointsBySeriesKey?: Map<string, ChartPoint[]> | null,
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const commons = commonTickersOnSheet(simTable.rows);
  const out: PortfolioLossAlert[] = [];
  for (const row of simTable.rows) {
    if (!isEligibleOffBookRow(row, inputs, commons)) continue;
    const sk = simulationRowSeriesKey(row);
    const chartPts = sk && pointsBySeriesKey ? pointsBySeriesKey.get(sk) ?? null : null;
    if (!hasEvaluationMomentumInclude(row, chartPts)) continue;
    const alert = rowToOpportunityAlert(row);
    if (alert) out.push(alert);
  }
  return out;
}

export function mergeOpportunityAlertsByKey(
  primary: PortfolioLossAlert[],
  extra: PortfolioLossAlert[],
): PortfolioLossAlert[] {
  const seen = new Set(primary.map((a) => a.key));
  const merged = [...primary];
  for (const a of extra) {
    if (seen.has(a.key)) continue;
    seen.add(a.key);
    merged.push(a);
  }
  return merged;
}
