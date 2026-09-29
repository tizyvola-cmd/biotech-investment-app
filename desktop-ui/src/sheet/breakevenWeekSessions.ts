/**
 * Split breakeven chart points into 1-week sessions and summarize Soft BUY /
 * Soft SELL index logic inside each window.
 */
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  blendPositionsLogicColor,
  collectBuyIndexClearances,
  collectSellIndexClearances,
  historyWeightsForLogic,
  meanClearance,
  nearestHistoryForLogic,
  type BreakevenLogicPosition,
  type IndexClearanceRow,
} from "./breakevenRecLogicFill";
import {
  resolveSoftLogicEra,
  scoreableGateIds,
  softLogicEraEnd,
  type SoftLogicEra,
  type SoftLogicGateDef,
} from "./softLogicChronology";

export type BreakevenChartPoint = {
  ts: string;
  /** Category X key used by Recharts (day label). */
  day: string;
  value: number;
  /** Invested capital at this snapshot (portfolio open/closed book or ticker entry). */
  capital?: number | null;
};

/** Did Soft BUY/SELL pressure line up with the week's P&L move? */
export type WeekLogicGainAlign = "aligned" | "mismatch" | "flat";

export type BreakevenWeekSession = {
  id: string;
  weekLabel: string;
  x1: string;
  x2: string;
  startTs: string;
  endTs: string;
  startValue: number;
  endValue: number;
  delta: number;
  /**
   * Capital invested for % return (prefer first week snapshot with capital > 0,
   * else mid-week / mean of available points).
   */
  investedCapital: number | null;
  /** Week Δ as % of investedCapital (null when capital unknown / zero). */
  gainPctOnInvested: number | null;
  buyStrength: number;
  sellStrength: number;
  dominant: "buy" | "sell" | "mixed";
  /** Vertical band fill (dominant logic). */
  bandFill: string;
  buyFill: string;
  sellFill: string;
  buyIndices: IndexClearanceRow[];
  sellIndices: IndexClearanceRow[];
  /** Structural gates in force (Top2, rising, G2, …) — not scoreable retrospectively. */
  buyStructuralGates: SoftLogicGateDef[];
  sellStructuralGates: SoftLogicGateDef[];
  pointCount: number;
  /** BUY+gain or SELL+loss = aligned; opposite = mismatch. */
  logicGainAlign: WeekLogicGainAlign;
  /** Dominant logic vs previous week (null on first session). */
  logicChangedFrom: "buy" | "sell" | "mixed" | null;
  /** Declared Soft Soft product era in force that week. */
  era: SoftLogicEra;
  eraEnd: string | null;
  /** True when this week's era differs from the previous week. */
  eraChanged: boolean;
};

export function weekLogicGainAlign(
  dominant: "buy" | "sell" | "mixed",
  delta: number,
): WeekLogicGainAlign {
  if (!(Math.abs(delta) >= 1)) return "flat";
  if (dominant === "mixed") return "flat";
  if (dominant === "buy") return delta > 0 ? "aligned" : "mismatch";
  // Soft SELL pressure: loss = thesis held; gain = book still rose under sell pressure
  return delta < 0 ? "aligned" : "mismatch";
}

/** Monday-based ISO week key: YYYY-Www */
export function isoWeekId(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function formatWeekRange(startTs: string, endTs: string, lang: "it" | "en"): string {
  const a = new Date(startTs);
  const b = new Date(endTs);
  const loc = lang === "it" ? "it-IT" : "en-GB";
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return startTs.slice(0, 10);
  return `${a.toLocaleDateString(loc, opts)} – ${b.toLocaleDateString(loc, opts)}`;
}

function positionsAtTs(
  positions: BreakevenLogicPosition[],
  history: InvestSimHistoryPoint[],
  ts: string,
): { positions: BreakevenLogicPosition[]; weights: Map<string, number> | null } {
  const h = nearestHistoryForLogic(history, ts);
  const weights = historyWeightsForLogic(h, positions);
  const withHistPnl =
    h?.byTicker
      ? positions.map((pos) => {
          const snap = h.byTicker[pos.key] ?? h.byTicker[pos.ticker.trim().toUpperCase()];
          if (!snap || !Number.isFinite(snap.pnlPct)) return pos;
          return { ...pos, pnlPct: snap.pnlPct };
        })
      : positions;
  return { positions: withHistPnl, weights };
}

function dominantOf(buy: number, sell: number): "buy" | "sell" | "mixed" {
  if (buy < 0.12 && sell < 0.12) return "mixed";
  if (Math.abs(buy - sell) < 0.08) return "mixed";
  return buy > sell ? "buy" : "sell";
}

function bandFillFor(dominant: "buy" | "sell" | "mixed", buy: number, sell: number): string {
  if (dominant === "buy") {
    return `rgba(16, 185, 129, ${Math.max(0.08, Math.min(0.28, 0.08 + buy * 0.22)).toFixed(3)})`;
  }
  if (dominant === "sell") {
    return `rgba(244, 63, 94, ${Math.max(0.08, Math.min(0.28, 0.08 + sell * 0.22)).toFixed(3)})`;
  }
  return `rgba(148, 163, 184, ${Math.max(0.06, Math.min(0.18, 0.06 + ((buy + sell) / 2) * 0.14)).toFixed(3)})`;
}

/** Prefer start-of-week capital; fall back to mid / mean of positive capitals. */
export function weekInvestedCapital(pts: BreakevenChartPoint[]): number | null {
  for (const p of pts) {
    const c = p.capital;
    if (c != null && Number.isFinite(c) && c > 0) return Math.round(c * 100) / 100;
  }
  const positives = pts
    .map((p) => p.capital)
    .filter((c): c is number => c != null && Number.isFinite(c) && c > 0);
  if (!positives.length) return null;
  const mean = positives.reduce((a, b) => a + b, 0) / positives.length;
  return Math.round(mean * 100) / 100;
}

export function weekGainPctOnInvested(
  delta: number,
  invested: number | null,
): number | null {
  if (invested == null || !(invested > 0) || !Number.isFinite(delta)) return null;
  return Math.round((delta / invested) * 1000) / 10; // 1 decimal %
}

/**
 * Build one session per ISO calendar week present in the chart series.
 */
export function buildBreakevenWeekSessions(
  points: BreakevenChartPoint[],
  positions: BreakevenLogicPosition[],
  history: InvestSimHistoryPoint[],
  lang: "it" | "en" = "en",
): BreakevenWeekSession[] {
  if (points.length < 2) return [];

  type Bucket = { id: string; pts: BreakevenChartPoint[] };
  const buckets: Bucket[] = [];
  let cur: Bucket | null = null;
  for (const p of points) {
    const id = isoWeekId(p.ts);
    if (!id) continue;
    if (!cur || cur.id !== id) {
      cur = { id, pts: [p] };
      buckets.push(cur);
    } else {
      cur.pts.push(p);
    }
  }

  const sessions: BreakevenWeekSession[] = [];
  for (const b of buckets) {
    // Need ≥2 distinct X anchors — equal x1/x2 freezes Recharts ReferenceArea.
    if (b.pts.length < 2) continue;
    const first = b.pts[0]!;
    const last = b.pts[b.pts.length - 1]!;
    if (first.ts === last.ts) continue;
    const midTs = b.pts[Math.floor(b.pts.length / 2)]!.ts;
    // Mid-week era: ISO weeks can straddle a product cutover (e.g. Aug 3–5).
    const era = resolveSoftLogicEra(midTs);
    const eraAtStart = resolveSoftLogicEra(first.ts);
    const eraAtEnd = resolveSoftLogicEra(last.ts);
    const eraEnd = softLogicEraEnd(era);
    const buyActive = scoreableGateIds(era, "buy");
    const sellActive = scoreableGateIds(era, "sell");
    const sdsGate = era.buyGates.find((g) => g.id === "sds")?.gate;
    const pplanBuyGate = era.buyGates.find((g) => g.id === "pplan")?.gate;
    const { positions: posMid, weights } = positionsAtTs(positions, history, midTs);
    const buyIndices = collectBuyIndexClearances(posMid, weights, {
      activeIds: buyActive,
      sdsMin: sdsGate ?? undefined,
      pplanBuyMin: pplanBuyGate ?? undefined,
    });
    const sellIndices = collectSellIndexClearances(posMid, weights, {
      activeIds: sellActive,
    });
    const buyStructuralGates = era.buyGates.filter((g) => !g.scoreable);
    const sellStructuralGates = era.sellGates.filter((g) => !g.scoreable);
    const buyStrength = meanClearance(buyIndices);
    const sellStrength = meanClearance(sellIndices);
    const buyBlend = blendPositionsLogicColor(posMid, "buy", weights);
    const sellBlend = blendPositionsLogicColor(posMid, "sell", weights);
    const dominant = dominantOf(buyStrength, sellStrength);
    const delta = Math.round((last.value - first.value) * 100) / 100;
    const investedCapital = weekInvestedCapital(b.pts);
    const gainPctOnInvested = weekGainPctOnInvested(delta, investedCapital);

    const prev = sessions[sessions.length - 1] ?? null;
    sessions.push({
      id: b.id,
      weekLabel: formatWeekRange(first.ts, last.ts, lang),
      // Prefer ts — short-range charts use unique time labels as X keys; day
      // strings collide ("10 Aug, 15:00") and freeze Recharts ReferenceArea.
      x1: first.ts,
      x2: last.ts,
      startTs: first.ts,
      endTs: last.ts,
      startValue: first.value,
      endValue: last.value,
      delta,
      investedCapital,
      gainPctOnInvested,
      buyStrength,
      sellStrength,
      dominant,
      bandFill: bandFillFor(dominant, buyStrength, sellStrength),
      buyFill: buyBlend.css,
      sellFill: sellBlend.css,
      buyIndices,
      sellIndices,
      buyStructuralGates,
      sellStructuralGates,
      pointCount: b.pts.length,
      logicGainAlign: weekLogicGainAlign(dominant, delta),
      logicChangedFrom:
        prev && prev.dominant !== dominant ? prev.dominant : null,
      era,
      eraEnd,
      eraChanged: Boolean(
        (prev && prev.era.id !== era.id) || eraAtStart.id !== eraAtEnd.id,
      ),
    });
  }
  return sessions;
}
