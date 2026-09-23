/**
 * Per-event market EIS horizons — reaction at 12h / 24h / 36h after publish.
 * Never summed across events; display only on the event card.
 */
import type { ClinicalPublicationEvent } from "../api/supernova";
import { computeEis, type EisBreakdown } from "./eventImpactScore";

export const EIS_MARKET_HORIZON_HOURS = [12, 24, 36] as const;
export type EisMarketHorizonHours = (typeof EIS_MARKET_HORIZON_HOURS)[number];

export type EisMarketHorizonReading = {
  hours: EisMarketHorizonHours;
  /** Price Δ% from publish → +Nh. */
  deltaPct: number | null;
  /** Market EIS from that Δ% (same formula as computeEis d1 leg). */
  score: number | null;
  pending: boolean;
};

export type EisMarketHorizons = {
  h12: EisMarketHorizonReading;
  h24: EisMarketHorizonReading;
  h36: EisMarketHorizonReading;
};

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function reading(
  hours: EisMarketHorizonHours,
  deltaPct: number | null,
  score: number | null,
): EisMarketHorizonReading {
  const d = finite(deltaPct);
  const s = finite(score);
  return {
    hours,
    deltaPct: d,
    score: s,
    pending: d == null && s == null,
  };
}

function scoreFromDelta(
  deltaPct: number | null,
  sentiment: number | null | undefined,
): number | null {
  if (deltaPct == null) return null;
  const bd: EisBreakdown = computeEis(deltaPct, null, null, sentiment ?? 0);
  return Number.isFinite(bd.score) ? bd.score : null;
}

/**
 * Read 12/24/36h market EIS from a clinical / 8-K event payload.
 * Prefers explicit `eis.horizons` / `price.delta_p_*h`; falls back to computing
 * score from stored Δ% when score is missing.
 */
export function resolveEventMarketEisHorizons(
  ev: Pick<ClinicalPublicationEvent, "price" | "eis" | "sentiment"> & {
    eis?: ClinicalPublicationEvent["eis"] & {
      horizons?: {
        h12?: { score?: number | null; delta_pct?: number | null } | null;
        h24?: { score?: number | null; delta_pct?: number | null } | null;
        h36?: { score?: number | null; delta_pct?: number | null } | null;
      } | null;
    } | null;
    price?: ClinicalPublicationEvent["price"] & {
      delta_p_12h?: number | null;
      delta_p_24h?: number | null;
      delta_p_36h?: number | null;
    };
  },
): EisMarketHorizons {
  const eisObj = ev.eis && typeof ev.eis === "object" ? ev.eis : null;
  const hz =
    eisObj && "horizons" in eisObj && eisObj.horizons && typeof eisObj.horizons === "object"
      ? (eisObj.horizons as {
          h12?: { score?: number | null; delta_pct?: number | null } | null;
          h24?: { score?: number | null; delta_pct?: number | null } | null;
          h36?: { score?: number | null; delta_pct?: number | null } | null;
        })
      : null;
  const price = ev.price && typeof ev.price === "object" ? ev.price : null;
  const sent = finite(ev.sentiment) ?? finite(eisObj?.sentiment);

  const pack = (hours: EisMarketHorizonHours, key: "h12" | "h24" | "h36", priceKey: "delta_p_12h" | "delta_p_24h" | "delta_p_36h") => {
    const slot = hz?.[key];
    let delta = finite(slot?.delta_pct);
    if (delta == null && price) {
      delta = finite((price as Record<string, unknown>)[priceKey]);
    }
    // Interim: daily T+1 ≈ 24h when hourly not yet enriched.
    if (delta == null && hours === 24 && price) {
      delta = finite(price.delta_p_1d);
    }
    let score = finite(slot?.score);
    if (score == null) score = scoreFromDelta(delta, sent);
    return reading(hours, delta, score);
  };

  return {
    h12: pack(12, "h12", "delta_p_12h"),
    h24: pack(24, "h24", "delta_p_24h"),
    h36: pack(36, "h36", "delta_p_36h"),
  };
}

export function formatEisHorizonScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}
