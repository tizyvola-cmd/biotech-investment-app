/**
 * Piggy Bank chip badge — idiosyncratic ticker move vs flat biotech market (XBI).
 * Shown when |XBI 1d| is below threshold and |ticker Var.24h| is material.
 */

import {
  getCachedMarketContextSnapshot,
  xbiClosesFromSnapshot,
  type MarketContextSnapshotDoc,
} from "./marketContextScore";

/** |XBI 1d %| below this → treat market as "flat / fermo". */
export const PIGGY_XBI_FLAT_ABS_PCT = 0.75;
/** |ticker Var.24h %| above this → material move worth a badge. */
export const PIGGY_TICKER_IDIO_ABS_PCT = 1.5;

export type PiggyMoveChannel = "idiosyncratic" | "market";

export type PiggyIdiosyncraticBadge = {
  channel: PiggyMoveChannel;
  /** Short chip label */
  labelEn: string;
  labelIt: string;
  titleEn: string;
  titleIt: string;
  xbiDayPct: number;
  tickerDayPct: number;
};

/** Last session XBI return % from market_context_snapshot closes. */
export function xbiDayReturnPctFromSnapshot(
  doc: MarketContextSnapshotDoc | null | undefined = getCachedMarketContextSnapshot(),
): number | null {
  const closes = xbiClosesFromSnapshot(doc);
  if (closes.length < 2) return null;
  const prev = closes[closes.length - 2]!;
  const last = closes[closes.length - 1]!;
  if (!(prev > 0) || !Number.isFinite(prev) || !Number.isFinite(last)) return null;
  return Math.round(((last - prev) / prev) * 1000) / 10;
}

/**
 * Classify a piggy chip move. Returns null when no badge should show
 * (missing data, or ticker move too small).
 */
export function classifyPiggyMoveChannel(
  tickerDayPct: number | null | undefined,
  xbiDayPct: number | null | undefined,
  opts?: {
    xbiFlatAbsPct?: number;
    tickerIdioAbsPct?: number;
  },
): PiggyMoveChannel | null {
  const t =
    tickerDayPct != null && Number.isFinite(tickerDayPct) ? tickerDayPct : null;
  const x = xbiDayPct != null && Number.isFinite(xbiDayPct) ? xbiDayPct : null;
  if (t == null || x == null) return null;

  const xFlat = opts?.xbiFlatAbsPct ?? PIGGY_XBI_FLAT_ABS_PCT;
  const tMin = opts?.tickerIdioAbsPct ?? PIGGY_TICKER_IDIO_ABS_PCT;
  if (Math.abs(t) < tMin) return null;

  // Market flat → any material ticker move is idiosyncratic.
  if (Math.abs(x) < xFlat) return "idiosyncratic";

  const sameSign = t === 0 || x === 0 ? false : Math.sign(t) === Math.sign(x);
  // Market moving: ticker with market and not wildly oversized → market channel.
  if (sameSign && Math.abs(t) <= Math.abs(x) * 2.2) return "market";
  // Opposite to XBI, or much larger than XBI → idiosyncratic.
  return "idiosyncratic";
}

export function resolvePiggyIdiosyncraticBadge(
  tickerDayPct: number | null | undefined,
  xbiDayPct: number | null | undefined = xbiDayReturnPctFromSnapshot(),
): PiggyIdiosyncraticBadge | null {
  const channel = classifyPiggyMoveChannel(tickerDayPct, xbiDayPct);
  if (!channel || tickerDayPct == null || xbiDayPct == null) return null;

  const tStr = `${tickerDayPct >= 0 ? "+" : ""}${tickerDayPct.toFixed(1)}%`;
  const xStr = `${xbiDayPct >= 0 ? "+" : ""}${xbiDayPct.toFixed(1)}%`;

  if (channel === "idiosyncratic") {
    return {
      channel,
      labelEn: "idio",
      labelIt: "idio",
      titleEn: `Idiosyncratic move ${tStr} while XBI ${xStr} (market flat/weak link) — not broad biotech beta.`,
      titleIt: `Move idiosincratico ${tStr} con XBI ${xStr} (mercato fermo/poco legato) — non beta biotech.`,
      xbiDayPct,
      tickerDayPct,
    };
  }

  return {
    channel,
    labelEn: "mkt",
    labelIt: "mkt",
    titleEn: `Market-aligned move ${tStr} with XBI ${xStr}.`,
    titleIt: `Move allineato al mercato ${tStr} con XBI ${xStr}.`,
    xbiDayPct,
    tickerDayPct,
  };
}

/** Prefer showing only the useful case on dense chips: idio when market flat. */
export function resolvePiggyChipMoveBadge(
  tickerDayPct: number | null | undefined,
  xbiDayPct: number | null | undefined = xbiDayReturnPctFromSnapshot(),
): PiggyIdiosyncraticBadge | null {
  const badge = resolvePiggyIdiosyncraticBadge(tickerDayPct, xbiDayPct);
  if (!badge) return null;
  // Dense Piggy chips: only flag idiosyncratic when XBI is flat (user request).
  if (badge.channel === "idiosyncratic" && Math.abs(badge.xbiDayPct) < PIGGY_XBI_FLAT_ABS_PCT) {
    return badge;
  }
  return null;
}
