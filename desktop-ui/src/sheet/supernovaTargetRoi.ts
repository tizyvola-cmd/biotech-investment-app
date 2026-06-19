import type { ChartPoint } from "../types";
import { transformOverlayVsToday } from "./assessmentChartHarmony";
import { completionDateToNowOffset } from "./chartNowOffset";
import { buildOverlayCurve, type SdsOverlayCurve } from "./sdsCompareOverlay";

export type SupernovaTargetRoi = {
  returnPct: number;
  daysToTarget: number | null;
  peakOffset: number;
  peakKind: SdsOverlayCurve["peakKind"];
};

export type SupernovaForwardPeakOptions = {
  ticker?: string;
  /** Include T+30/60/90 extrapolation — same as 24h assessment Supernova chart. */
  extendedPostCd?: boolean;
  /** Rebase peak to % vs today (matches assessment overlay). Default true. */
  vsToday?: boolean;
};

/**
 * Forward peak on the recalibrated prediction curve — same path as the Supernova overlay
 * (peakRoiWithOffset on calendar knots, optionally extended post-CD).
 */
export function resolveSupernovaForwardPeak(
  simRow: Record<string, unknown> | null | undefined,
  chartPoints: ChartPoint[] | null | undefined,
  options?: SupernovaForwardPeakOptions,
): SupernovaTargetRoi | null {
  if (!simRow || !chartPoints?.length) return null;

  const ticker = String(
    options?.ticker ?? simRow.Ticker ?? simRow.ticker ?? "",
  ).trim();
  if (!ticker) return null;

  const extended = options?.extendedPostCd ?? true;
  const vsToday = options?.vsToday ?? true;

  let overlay = buildOverlayCurve(ticker, chartPoints, simRow, 0, { extendedPostCd: extended });
  if (!overlay || !Number.isFinite(overlay.peakRoi)) return null;

  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (vsToday && nowOff != null && Number.isFinite(nowOff)) {
    overlay = transformOverlayVsToday(overlay, nowOff);
  }

  let daysToTarget: number | null = null;
  if (nowOff != null && Number.isFinite(nowOff)) {
    const d = Math.round(overlay.peakOffset - nowOff);
    daysToTarget = d > 0 ? d : null;
  }

  return {
    returnPct: overlay.peakRoi,
    daysToTarget,
    peakOffset: overlay.peakOffset,
    peakKind: overlay.peakKind,
  };
}

/** Peak ROI on recalibrated prediction curve (standard SuperNova knots, pre-CD only). */
export function resolveSupernovaTargetRoi(
  ticker: string,
  simRow: Record<string, unknown> | null | undefined,
  chartPoints: ChartPoint[] | null | undefined,
): SupernovaTargetRoi | null {
  return resolveSupernovaForwardPeak(simRow, chartPoints, {
    ticker,
    extendedPostCd: false,
    vsToday: true,
  });
}

/** Assessment cards — peak aligned with extended Supernova chart overlay. */
export function resolveAssessmentSupernovaPeak(
  simRow: Record<string, unknown> | null | undefined,
  chartPoints: ChartPoint[] | null | undefined,
): { returnPct: number; days: number | null } | null {
  const peak = resolveSupernovaForwardPeak(simRow, chartPoints, {
    extendedPostCd: true,
    vsToday: true,
  });
  if (!peak || !Number.isFinite(peak.returnPct)) return null;
  if (peak.peakKind === "cd_outlook") return null;
  if (peak.returnPct <= 0.05) return null;
  return { returnPct: peak.returnPct, days: peak.daysToTarget };
}
