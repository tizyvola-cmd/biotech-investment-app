/**
 * Recommendation channel — HOLD / rescue analysis (UI-side).
 *
 * For a HOLD (a position that fell into loss) the system can't yet know the
 * outcome but the rescue score can *predict a rebound*. This module measures how
 * well the rescue score tracks the ACTUAL rebound, where a rebound is defined as
 * "PnL returns to >= 0 within REBOUND_HORIZON_DAYS".
 *
 * It correlates, per loss episode:
 *   (a) rebound hit-rate by rescue-score tier,
 *   (b) rescue score vs days-to-rebound,
 *   (c) rescue score vs rebound size (recovery from the trough).
 *
 * The rescue score and the daily PnL path both live in the UI sheet, so this is
 * computed here (not in the Python backend).
 */
import { LOSS_ENTRY_THRESHOLD_PCT, computeRescueScoreBreakdown } from "./lossRescueEngine";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

/** Rebound = PnL back to >= 0 within this many calendar days of the loss episode. */
export const REBOUND_HORIZON_DAYS = 60;

export type RescueReboundTier = {
  tier: "low" | "mid" | "high";
  /** Inclusive-exclusive score band, e.g. "0–40". */
  band: string;
  n: number;
  hitRatePct: number | null;
  medianDaysToRebound: number | null;
  meanReboundSizePct: number | null;
};

export type RescueReboundEpisode = {
  key: string;
  ticker: string;
  score: number;
  troughPct: number;
  rebounded: boolean;
  daysToRebound: number | null;
  reboundSizePct: number;
};

export type RescueReboundAnalysis = {
  available: boolean;
  n: number;
  reboundHorizonDays: number;
  hitRatePct: number | null;
  /** Pearson r between score and days-to-rebound (rebounded episodes only). */
  corrScoreDays: number | null;
  /** Pearson r between score and rebound size (all episodes). */
  corrScoreSize: number | null;
  tiers: RescueReboundTier[];
  episodes: RescueReboundEpisode[];
  note: string | null;
};

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}

function tierOf(score: number): "low" | "mid" | "high" {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

type SeriesPoint = { ts: string; pnlPct: number };

/** Ordered (ts asc) PnL% series for one row key from the portfolio history. */
function seriesForKey(key: string, history: InvestSimHistoryPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (snap && snap.pnlPct != null && Number.isFinite(snap.pnlPct)) {
      out.push({ ts: h.ts, pnlPct: snap.pnlPct });
    }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/**
 * Analyze the first loss episode of every position and grade the rescue score
 * against the actual rebound.
 *
 * @param eisScoreForKey optional resolver for the EIS window score component of
 *   the rescue score (defaults to null -> EIS contributes 0).
 */
export function analyzeRescueRebound(args: {
  history: InvestSimHistoryPoint[];
  inputs: Record<string, InvestSimInputEntry>;
  eisScoreForKey?: (ticker: string) => number | null;
  horizonDays?: number;
}): RescueReboundAnalysis {
  const horizon = args.horizonDays ?? REBOUND_HORIZON_DAYS;
  const episodes: RescueReboundEpisode[] = [];

  for (const [key, entry] of Object.entries(args.inputs)) {
    const series = seriesForKey(key, args.history);
    if (series.length < 2) continue;

    const lossIdx = series.findIndex((p) => p.pnlPct < LOSS_ENTRY_THRESHOLD_PCT);
    if (lossIdx < 0) continue;

    const lossTs = series[lossIdx]!.ts;
    const windowPts = series
      .slice(lossIdx)
      .filter((p) => dayDiff(lossTs, p.ts) <= horizon);
    if (!windowPts.length) continue;

    const troughPct = Math.min(...windowPts.map((p) => p.pnlPct));
    const peakPct = Math.max(...windowPts.map((p) => p.pnlPct));
    const reboundPt = windowPts.find((p) => p.pnlPct >= 0) ?? null;
    const rebounded = reboundPt != null;
    const daysToRebound = reboundPt ? dayDiff(lossTs, reboundPt.ts) : null;
    const reboundSizePct = Math.round((peakPct - troughPct) * 100) / 100;

    const ticker = key.split("|")[0] ?? key;
    const eisWindowScore = args.eisScoreForKey ? args.eisScoreForKey(ticker) : null;
    const { rescoreScore } = computeRescueScoreBreakdown({
      entryProbPct: entry.entryProbPct ?? null,
      lastMarkPct: troughPct,
      eisWindowScore,
    });

    episodes.push({
      key,
      ticker,
      score: rescoreScore,
      troughPct: Math.round(troughPct * 100) / 100,
      rebounded,
      daysToRebound,
      reboundSizePct,
    });
  }

  if (!episodes.length) {
    return {
      available: false,
      n: 0,
      reboundHorizonDays: horizon,
      hitRatePct: null,
      corrScoreDays: null,
      corrScoreSize: null,
      tiers: [],
      episodes: [],
      note: "nessuna posizione è entrata in perdita nello storico — si popola con i cicli",
    };
  }

  const hits = episodes.filter((e) => e.rebounded).length;
  const hitRatePct = round1((hits / episodes.length) * 100);

  const corrScoreDays = pearson(
    episodes
      .filter((e) => e.daysToRebound != null)
      .map((e) => [e.score, e.daysToRebound!] as [number, number]),
  );
  const corrScoreSize = pearson(
    episodes.map((e) => [e.score, e.reboundSizePct] as [number, number]),
  );

  const tierDefs: Array<{ tier: "low" | "mid" | "high"; band: string }> = [
    { tier: "low", band: "0–40" },
    { tier: "mid", band: "40–70" },
    { tier: "high", band: "70–100" },
  ];
  const tiers: RescueReboundTier[] = tierDefs.map(({ tier, band }) => {
    const rows = episodes.filter((e) => tierOf(e.score) === tier);
    const reboundedRows = rows.filter((e) => e.rebounded);
    return {
      tier,
      band,
      n: rows.length,
      hitRatePct: rows.length ? round1((reboundedRows.length / rows.length) * 100) : null,
      medianDaysToRebound: round1(
        median(reboundedRows.map((e) => e.daysToRebound!).filter((d) => d != null)),
      ),
      meanReboundSizePct: round1(mean(rows.map((e) => e.reboundSizePct))),
    };
  });

  return {
    available: true,
    n: episodes.length,
    reboundHorizonDays: horizon,
    hitRatePct,
    corrScoreDays,
    corrScoreSize,
    tiers,
    episodes,
    note: null,
  };
}
