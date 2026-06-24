/**
 * Recommendation channel — SELL directional follow-through (UI-side, stop-loss).
 *
 * "Is a SELL signal followed by a price reduction?" For most SELL reasons this is
 * forward-only (after selling we no longer track the stock). But the STOP-LOSS
 * reason is gradable on history: the sim held positions even past the -15% stop
 * (that's how the rescue → rebound is measured), so the daily PnL path *after* the
 * stop trigger exists. We can therefore check whether, once the stop fired, the
 * price kept dropping (selling was right) or recovered (selling was premature).
 *
 * Mirror of `recommendationRescue.ts`: same daily PnL series, opposite question.
 */
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

/** Stop-loss trigger, matching the backend rule ("-15% from entry"). */
export const STOP_LOSS_THRESHOLD_PCT = -15;

export type SellDirectionalEpisode = {
  key: string;
  ticker: string;
  pnlAtStopPct: number;
  postStopTroughPct: number;
  /** Price went lower after the stop fired -> selling avoided further loss. */
  droppedFurther: boolean;
};

export type SellDirectionalAnalysis = {
  available: boolean;
  reason: "stop_loss";
  /** Episodes with post-stop data (gradable). */
  n: number;
  /** Stop fired only at the last mark -> not yet gradable. */
  pendingN: number;
  /** P(price drop | SELL stop-loss). */
  downHitPct: number | null;
  episodes: SellDirectionalEpisode[];
  note: string | null;
};

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

function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}

/**
 * For every position that hit the stop-loss in the history, grade whether the
 * price kept falling afterwards (the SELL would have been correct).
 */
export function analyzeSellDirectional(args: {
  history: InvestSimHistoryPoint[];
  inputs: Record<string, InvestSimInputEntry>;
}): SellDirectionalAnalysis {
  const episodes: SellDirectionalEpisode[] = [];
  let pendingN = 0;

  for (const key of Object.keys(args.inputs)) {
    const series = seriesForKey(key, args.history);
    if (series.length < 2) continue;

    const stopIdx = series.findIndex((p) => p.pnlPct <= STOP_LOSS_THRESHOLD_PCT);
    if (stopIdx < 0) continue; // no stop-loss SELL signal in this position

    const pnlAtStop = series[stopIdx]!.pnlPct;
    const post = series.slice(stopIdx + 1);
    if (!post.length) {
      pendingN += 1; // stop fired at the last available mark -> cannot grade yet
      continue;
    }

    const postStopTrough = Math.min(...post.map((p) => p.pnlPct));
    const droppedFurther = postStopTrough < pnlAtStop;

    episodes.push({
      key,
      ticker: key.split("|")[0] ?? key,
      pnlAtStopPct: Math.round(pnlAtStop * 100) / 100,
      postStopTroughPct: Math.round(postStopTrough * 100) / 100,
      droppedFurther,
    });
  }

  if (!episodes.length) {
    return {
      available: false,
      reason: "stop_loss",
      n: 0,
      pendingN,
      downHitPct: null,
      episodes: [],
      note: "nessuno stop-loss valutabile nello storico — si popola con i cicli",
    };
  }

  const hits = episodes.filter((e) => e.droppedFurther).length;
  return {
    available: true,
    reason: "stop_loss",
    n: episodes.length,
    pendingN,
    downHitPct: round1((hits / episodes.length) * 100),
    episodes,
    note: null,
  };
}
