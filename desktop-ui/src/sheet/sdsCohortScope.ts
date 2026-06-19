/**
 * SDS Supernova cohort scope — aligned with Simulation monitor horizon (4 months).
 * See ``SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS`` / ``SIM_MONITOR_HORIZON_DAYS``.
 */
import { SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";
import { daysFromToday } from "./simulationPlanGain";
import { looksLikeTicker } from "./simulationTickers";

/** Max calendar days before CD (inclusive). Default 120 ≈ 4 months. */
export const SDS_COHORT_MAX_DAYS_TO_CD = SIM_MONITOR_HORIZON_DAYS;

/** Keep rows briefly after CD (post-CD watch), same as live signals. */
export const SDS_COHORT_POST_CD_DAYS = 7;

export function daysToCdFromSimRow(row: Record<string, unknown>): number | null {
  const cd = String(row["Completion Date"] ?? row.CD ?? "").trim();
  if (!cd || cd === "—") return null;
  return daysFromToday(cd);
}

export function isRowInSdsCohortScope(row: Record<string, unknown>, ticker?: string): boolean {
  const tk = (ticker ?? String(row.Ticker ?? row.ticker ?? "")).trim().toUpperCase();
  if (!looksLikeTicker(tk)) return false;
  const days = daysToCdFromSimRow(row);
  if (days == null || !Number.isFinite(days)) return false;
  if (days < -SDS_COHORT_POST_CD_DAYS) return false;
  if (days > SDS_COHORT_MAX_DAYS_TO_CD) return false;
  return true;
}

export function simulationTickersInSdsScope(
  rows: Record<string, unknown>[] | undefined | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (!isRowInSdsCohortScope(row, tk) || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out.sort();
}
