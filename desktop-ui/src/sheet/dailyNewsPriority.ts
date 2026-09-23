/**
 * Daily News Top block: all ★ (attention) tickers on the Catalyst desk.
 * Momentum↑ is used only to order names (bullish first), not to exclude.
 */
import { peekCatalystDeskColumnCache } from "./catalystDeskColumnCache";
import {
  formatPriceVolDivergence,
} from "./volumeVsPrevSession";
import {
  formatBiasCell,
  priceVolKindFromLabel,
} from "./catalystBiasDisplay";
import { listAttentionStars } from "./attentionStarStore";
import { listCatalystInterestTickers } from "./catalystInterestStore";
import { eventVolPairKey } from "../api/supernova";

function tickerFromEventVolKey(key: string): string {
  const i = key.indexOf("|");
  return (i >= 0 ? key.slice(0, i) : key).trim().toUpperCase();
}

/** Tickers with Bias/Momentum tone "up" from the desk hourly/morning cache. */
export function positiveMomentumTickersFromDeskCache(): string[] {
  const desk = peekCatalystDeskColumnCache();
  const hourly = desk?.hourly;
  if (!hourly) return [];
  const vols = hourly.vol ?? {};
  const eventVol = hourly.event_vol ?? {};
  const vs = hourly.vs_xbi ?? {};
  const accum = desk?.morning?.accumulation ?? {};

  const tickers = new Set<string>();
  for (const tk of Object.keys(vols)) {
    const t = tk.trim().toUpperCase();
    if (t) tickers.add(t);
  }
  for (const key of Object.keys(eventVol)) {
    const t = tickerFromEventVolKey(key);
    if (t) tickers.add(t);
  }
  for (const tk of Object.keys(vs)) {
    const t = tk.trim().toUpperCase();
    if (t) tickers.add(t);
  }

  const out: string[] = [];
  for (const tk of tickers) {
    const vol = vols[tk];
    // Prefer any event_vol row for this ticker (first match).
    let ev = null as (typeof eventVol)[string] | null;
    for (const [k, row] of Object.entries(eventVol)) {
      if (tickerFromEventVolKey(k) === tk) {
        ev = row;
        break;
      }
    }
    // If morning events exist, try pair key for nearest event date.
    if (!ev) {
      for (const e of desk?.morning?.events ?? []) {
        if ((e.ticker || "").trim().toUpperCase() !== tk) continue;
        const k = eventVolPairKey(tk, String(e.event_date || ""));
        if (eventVol[k]) {
          ev = eventVol[k]!;
          break;
        }
      }
    }
    const diverge = formatPriceVolDivergence(vol ?? null, false);
    const bias = formatBiasCell(
      {
        rr10: ev?.rr10 ?? null,
        priceVolKind: priceVolKindFromLabel(diverge.label),
        insiderNetBuy30d: accum[tk]?.insider_net_buy_30d ?? null,
        relativeMove: vs[tk]?.relative_move ?? null,
      },
      false,
    );
    if (bias.tone === "up") out.push(tk);
  }
  return out.sort();
}

export type DailyNewsPriorityMeta = {
  /** Tickers sent to /daily-news/top — every ★ name */
  tickers: string[];
  starred: string[];
  momentumUp: string[];
  /** ★ ∩ Momentum↑ (ordering hint only). */
  intersection: string[];
  /** True when Top includes ★ without requiring Momentum↑ (always true now). */
  usedStarOnlyFallback: boolean;
  /** Momentum cache warm but none of the ★ are bullish right now. */
  noMomentumOverlap: boolean;
};

/**
 * Priority set for Top News: every attention ★ ticker.
 * Bullish Momentum names are listed first; others still included.
 */
export function dailyNewsPriorityTickers(): DailyNewsPriorityMeta {
  const starred = [
    ...new Set([...listAttentionStars(), ...listCatalystInterestTickers()]),
  ].sort();
  const momentumUp = positiveMomentumTickersFromDeskCache();
  if (!starred.length) {
    return {
      tickers: [],
      starred,
      momentumUp,
      intersection: [],
      usedStarOnlyFallback: false,
      noMomentumOverlap: false,
    };
  }
  const mom = new Set(momentumUp);
  const intersection = starred.filter((t) => mom.has(t));
  const restStars = starred.filter((t) => !mom.has(t));
  // All ★ — bullish first — no 12-cap / no momentum gate.
  const tickers = [...intersection, ...restStars];
  return {
    tickers,
    starred,
    momentumUp,
    intersection,
    usedStarOnlyFallback: true,
    noMomentumOverlap: Boolean(momentumUp.length && !intersection.length),
  };
}
