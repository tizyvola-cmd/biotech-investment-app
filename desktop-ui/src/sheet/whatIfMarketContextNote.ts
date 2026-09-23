/**
 * Interpretive bridge: MCS / Breadth → 24h what-if panel copy.
 * Does NOT change thresholds, Soft BUY, or MCS weights — display/context only.
 */
import {
  buildMarketContextDecisionCtx,
  mcsBandWeatherIcon,
  type MarketContextSnapshotDoc,
  type McsBand,
} from "./marketContextScore";

/** Breadth score below this → low-participation session (0–100 scale). */
export const WHATIF_LOW_BREADTH_MAX = 25;

export type WhatIfMarketContextReadout = {
  mcs: number | null;
  breadth: number | null;
  mcsBand: McsBand;
  mcsAvailable: boolean;
  lowBreadth: boolean;
  weatherIcon: string;
  /** Snapshot file time (independent of sheet Var. Giorn. and Yahoo curves). */
  updatedAt: string | null;
};

export function readWhatIfMarketContext(
  doc: MarketContextSnapshotDoc | null | undefined,
): WhatIfMarketContextReadout {
  const ctx = buildMarketContextDecisionCtx(doc);
  const latest = doc?.latest ?? doc?.history?.[doc.history.length - 1] ?? null;
  const breadthRaw = latest?.components?.breadth?.score;
  const breadth =
    breadthRaw != null && Number.isFinite(breadthRaw) ? Number(breadthRaw) : null;
  const lowBreadth = breadth != null && breadth <= WHATIF_LOW_BREADTH_MAX;
  const updatedAt =
    (typeof doc?.updated_at === "string" && doc.updated_at.trim()
      ? doc.updated_at.trim()
      : null) ??
    (typeof doc?.last_successful_update === "string" && doc.last_successful_update.trim()
      ? doc.last_successful_update.trim()
      : null);
  return {
    mcs: ctx.mcs,
    breadth,
    mcsBand: ctx.mcsBand,
    mcsAvailable: ctx.mcsAvailable,
    lowBreadth,
    weatherIcon: mcsBandWeatherIcon(ctx.mcsBand),
    updatedAt,
  };
}

/** Banner when Breadth is structurally low — explains thin upside without blaming filters. */
export function whatIfLowBreadthBannerText(
  readout: WhatIfMarketContextReadout,
  it: boolean,
  opts?: { greenCount?: number | null; universeWith24h?: number | null },
): string | null {
  if (!readout.lowBreadth || readout.breadth == null) return null;
  const b = Math.round(readout.breadth);
  const mcsPart =
    readout.mcs != null && Number.isFinite(readout.mcs)
      ? ` · MCS ${Math.round(readout.mcs)}`
      : "";
  const green = opts?.greenCount;
  const univ = opts?.universeWith24h;
  const tape =
    green != null && univ != null && univ > 0
      ? it
        ? ` · tape ${green}/${univ} verdi`
        : ` · tape ${green}/${univ} green`
      : "";
  return it
    ? `Sessione low-breadth (Breadth ${b}/100${mcsPart}${tape}) — poche opportunità genuine attese oggi; Missed Upside basso è normale, non un fallimento del filtro.`
    : `Low-breadth session (Breadth ${b}/100${mcsPart}${tape}) — few genuine opportunities expected today; low Missed Upside is normal, not a filter failure.`;
}
