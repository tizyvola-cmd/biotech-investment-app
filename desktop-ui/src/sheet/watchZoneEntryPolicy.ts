/**
 * Fase 1 — Enter policy in CD watch zone (T−61…T−120).
 */
import {
  computeTimingPredictabilityPct,
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
  WATCH_ZONE_MIN_R2,
} from "./cdHorizons";

/** Feature flag — watch-zone Enter recommendations. */
export const WATCH_ZONE_ENTER_ENABLED = true;

export const WATCH_ENTRY_MIN_DAYS = SIM_HOT_ZONE_DAYS + 1;
export const WATCH_ENTRY_MAX_DAYS = SIM_MONITOR_HORIZON_DAYS;

export const WATCH_P_ENTRY_MIN = 58;
export const WATCH_P_ENTRY_WAIT_MIN = 42;
export const WATCH_FWD_ENTRY_MIN = 3;
export const WATCH_FWD_PROVISIONAL_MIN = 1.8;
export const WATCH_TIMING_PRED_MIN = 45;
/** Calibrated to retro polygon distribution (median ~46 vs score_v4 proxy ~67). */
export const WATCH_MATCH_MIN = 42;
export const WATCH_MATCH_STRONG_MIN = 52;
export const WATCH_DAILY_MOMENTUM_MIN = 1.2;
export const WATCH_DAILY_STRONG_MIN = 1.5;
/** Min drift to count as gainer (aligned with missed-opp audit). */
export const WATCH_GAINER_DAILY_MIN = 0.5;

export const WATCH_PRECAT_PROB_OVERRIDE_MIN = 58;
export const WATCH_PRECAT_MATCH_OVERRIDE_MIN = 52;

export type WatchEntryThresholds = {
  pEntryMin: number;
  pEntryWaitMin: number;
  fwdMin: number;
  timingPredMin: number;
  matchMin: number;
};

export type WatchEnterQualification = {
  qualified: boolean;
  reason?: string;
};

export function isWatchZoneEnterEnabled(): boolean {
  return WATCH_ZONE_ENTER_ENABLED;
}

export function inWatchEntryWindow(days: number | null | undefined): boolean {
  if (days == null || !Number.isFinite(days)) return false;
  return days >= WATCH_ENTRY_MIN_DAYS && days <= WATCH_ENTRY_MAX_DAYS;
}

/** Typical achievable timing at daysToCd (R²/aff ~0.52) — caps watch floor far from CD. */
function watchTimingAchievablePct(daysToCd: number): number {
  return computeTimingPredictabilityPct(daysToCd, 0.52, 0.52, 0.5);
}

export function resolveWatchTimingPredMin(opts?: {
  daysToCd?: number | null;
  targetProvisional?: boolean;
  matchPct?: number | null;
  dailyPct24h?: number | null;
}): number {
  const days = opts?.daysToCd ?? WATCH_ENTRY_MIN_DAYS;
  const achievable = watchTimingAchievablePct(days);
  let floor = Math.min(WATCH_TIMING_PRED_MIN, Math.max(20, achievable - 6));

  const strongMatch =
    opts?.matchPct != null && opts.matchPct >= WATCH_MATCH_STRONG_MIN;
  const strongDaily =
    opts?.dailyPct24h != null && opts.dailyPct24h >= WATCH_DAILY_STRONG_MIN;
  const provisional = opts?.targetProvisional === true;
  if (strongMatch && provisional && strongDaily) return Math.min(floor, 22);
  if (strongMatch && provisional) return Math.min(floor, 28);
  if (strongMatch && strongDaily) return Math.min(floor, 30);
  if (provisional && strongDaily) return Math.min(floor, 32);
  return floor;
}

export function resolveWatchEntryThresholds(
  daysToCd: number | null | undefined,
  opts?: {
    targetProvisional?: boolean;
    dailyPct24h?: number | null;
    matchPct?: number | null;
  },
): WatchEntryThresholds | null {
  if (!isWatchZoneEnterEnabled() || !inWatchEntryWindow(daysToCd)) return null;
  const days = daysToCd!;
  const extraDays = Math.max(0, days - SIM_HOT_ZONE_DAYS);
  const pBonus = Math.min(2, Math.floor(extraDays / 10) * 0.1);
  const provisional =
    opts?.targetProvisional === true ||
    (opts?.dailyPct24h != null && opts.dailyPct24h >= WATCH_DAILY_STRONG_MIN);
  const strongMatch =
    opts?.matchPct != null && opts.matchPct >= WATCH_MATCH_STRONG_MIN;
  const fwdMin =
    provisional || strongMatch ? WATCH_FWD_PROVISIONAL_MIN : WATCH_FWD_ENTRY_MIN;

  return {
    pEntryMin: WATCH_P_ENTRY_MIN + pBonus,
    pEntryWaitMin: WATCH_P_ENTRY_WAIT_MIN,
    fwdMin,
    timingPredMin: resolveWatchTimingPredMin({
      daysToCd: days,
      targetProvisional: provisional,
      matchPct: opts?.matchPct,
      dailyPct24h: opts?.dailyPct24h,
    }),
    matchMin: WATCH_MATCH_MIN,
  };
}

function parseR2(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  for (const k of Object.keys(row)) {
    if (k.startsWith("R²") || k.startsWith("R2")) {
      const v = row[k];
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function parseAffidPct(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  for (const k of Object.keys(row)) {
    if (!k.includes("Affidabilit")) continue;
    const n = typeof row[k] === "number" ? row[k] : Number(String(row[k] ?? "").replace(",", "."));
    if (!Number.isFinite(n)) continue;
    if (n > 1 && n <= 100) return n;
    if (n <= 1) return n * 100;
    return n;
  }
  return null;
}

export function qualifiesWatchZoneEnter(args: {
  daysToCd: number | null | undefined;
  probPct: number | null | undefined;
  forwardPct: number | null | undefined;
  dailyPct24h?: number | null;
  matchPct?: number | null;
  targetProvisional?: boolean;
  simRow?: Record<string, unknown> | null;
  sdsVeto?: boolean;
}): WatchEnterQualification {
  if (!isWatchZoneEnterEnabled() || !inWatchEntryWindow(args.daysToCd)) {
    return { qualified: false, reason: "outside_watch_window" };
  }
  if (args.sdsVeto) return { qualified: false, reason: "sds_veto" };

  const th = resolveWatchEntryThresholds(args.daysToCd, {
    targetProvisional: args.targetProvisional,
    dailyPct24h: args.dailyPct24h,
    matchPct: args.matchPct,
  });
  if (!th) return { qualified: false, reason: "no_thresholds" };

  const timingPred = computeTimingPredictabilityPct(
    args.daysToCd,
    parseR2(args.simRow ?? null),
    (() => {
      const a = parseAffidPct(args.simRow ?? null);
      return a != null ? a / 100 : null;
    })(),
    null,
  );
  const strongDaily =
    args.dailyPct24h != null && args.dailyPct24h >= WATCH_DAILY_STRONG_MIN;
  const strongMatch =
    args.matchPct != null && args.matchPct >= WATCH_MATCH_STRONG_MIN;
  const gainerDrift =
    args.dailyPct24h != null && args.dailyPct24h >= WATCH_GAINER_DAILY_MIN;
  const moderateMatch =
    args.matchPct != null && args.matchPct >= WATCH_MATCH_MIN;
  const bypassTiming =
    (args.probPct ?? 0) >= th.pEntryMin &&
    args.forwardPct != null &&
    args.forwardPct >= th.fwdMin &&
    ((strongMatch &&
      args.targetProvisional === true &&
      (strongDaily || (args.matchPct ?? 0) >= 58)) ||
      (moderateMatch && args.targetProvisional === true && gainerDrift) ||
      (moderateMatch && gainerDrift && (args.matchPct ?? 0) >= WATCH_MATCH_STRONG_MIN) ||
      (gainerDrift && moderateMatch));

  if (!bypassTiming && timingPred < th.timingPredMin) {
    return { qualified: false, reason: "low_timing_predictability" };
  }

  const r2 = parseR2(args.simRow ?? null);
  if (r2 != null && r2 < WATCH_ZONE_MIN_R2) {
    return { qualified: false, reason: "low_r2" };
  }

  if (args.forwardPct == null || args.forwardPct < th.fwdMin) {
    return { qualified: false, reason: "forward_below_min" };
  }
  if ((args.probPct ?? 0) < th.pEntryMin) {
    return { qualified: false, reason: "prob_below_min" };
  }

  if (!strongDaily && !strongMatch) {
    const matchFloor =
      args.targetProvisional === true
        ? Math.max(38, th.matchMin - 4)
        : th.matchMin;
    if (args.matchPct != null && args.matchPct < matchFloor) {
      return { qualified: false, reason: "match_below_min" };
    }
    if (args.dailyPct24h == null || args.dailyPct24h < WATCH_GAINER_DAILY_MIN) {
      return { qualified: false, reason: "daily_momentum_low" };
    }
  }

  return { qualified: true };
}

export function watchPrecatProbOverride(args: {
  daysToCd: number | null | undefined;
  probPct: number | null | undefined;
  matchPct: number | null | undefined;
  precatKind: string;
  targetProvisional?: boolean;
  dailyPct24h?: number | null;
}): boolean {
  if (!isWatchZoneEnterEnabled() || !inWatchEntryWindow(args.daysToCd)) return false;
  if (args.precatKind !== "too_early" && args.precatKind !== "avoid") return false;
  const hasMomentum =
    args.targetProvisional === true ||
    (args.dailyPct24h != null && args.dailyPct24h >= WATCH_DAILY_MOMENTUM_MIN);
  if (!hasMomentum) return false;
  return (
    (args.probPct ?? 0) >= WATCH_PRECAT_PROB_OVERRIDE_MIN &&
    (args.matchPct ?? 0) >= WATCH_PRECAT_MATCH_OVERRIDE_MIN
  );
}
