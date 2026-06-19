/**
 * Perché Target ROI / Days to peak mancano in Loss Analysis.
 */
import { isWatchZone, resolveCdZone, SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";

export type TargetPeakGapReason =
  | "available"
  | "watch_provisional"
  | "past_cd"
  | "beyond_monitor"
  | "beyond_hot"
  | "no_chart"
  | "no_rise"
  | "unknown_cd";

export function resolveTargetRoiGapReason(args: {
  daysToCd: number | null;
  planReturnPct: number | null;
  chartPointsLoaded: boolean;
  targetProvisional?: boolean;
}): TargetPeakGapReason {
  if (args.planReturnPct != null && args.planReturnPct > 0) {
    if (args.targetProvisional && isWatchZone(args.daysToCd)) return "watch_provisional";
    return "available";
  }
  return resolveTimingOrCurveGapReason(args.daysToCd, args.chartPointsLoaded);
}

export function resolvePeakDaysGapReason(args: {
  daysToCd: number | null;
  daysToCurvePeak: number | null;
  chartPointsLoaded: boolean;
  targetProvisional?: boolean;
}): TargetPeakGapReason {
  if (args.daysToCurvePeak != null) {
    if (args.targetProvisional && isWatchZone(args.daysToCd)) return "watch_provisional";
    return "available";
  }
  return resolveTimingOrCurveGapReason(args.daysToCd, args.chartPointsLoaded);
}

function resolveTimingOrCurveGapReason(
  daysToCd: number | null,
  chartPointsLoaded: boolean,
): TargetPeakGapReason {
  const zone = resolveCdZone(daysToCd);
  if (zone === "past") return "past_cd";
  if (zone === "beyond") return "beyond_monitor";
  if (zone === "watch") return "beyond_hot";
  if (zone === "unknown") return "unknown_cd";
  if (!chartPointsLoaded) return "no_chart";
  return "no_rise";
}

export { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS };
