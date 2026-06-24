export type IndexId =
  | "pplan"
  | "top2"
  | "precat"
  | "slope"
  | "timing"
  | "conf"
  | "sds"
  | "eis";

export type ZoneWeights = Record<IndexId, number>;

export type ScoringZone = "hot" | "watch" | "early" | "loss";

/**
 * Pesi esperti per fascia CD (v1.0 — expert-driven).
 * Somma = 100 per hot/watch/early.
 * Loss: somma < 100 — normalizzare sul totale attivo in computeCompositeScore.
 */
export const ZONE_WEIGHTS: Record<ScoringZone, ZoneWeights> = {
  hot: {
    pplan: 32,
    top2: 24,
    precat: 18,
    slope: 11,
    timing: 6,
    conf: 5,
    sds: 2,
    eis: 2,
  },
  watch: {
    pplan: 26,
    top2: 16,
    precat: 14,
    slope: 9,
    timing: 4,
    conf: 10,
    sds: 11,
    eis: 10,
  },
  early: {
    pplan: 14,
    top2: 8,
    precat: 7,
    slope: 7,
    timing: 2,
    conf: 22,
    sds: 24,
    eis: 16,
  },
  loss: {
    pplan: 0,
    top2: 8,
    precat: 4,
    slope: 18,
    timing: 0,
    conf: 12,
    sds: 8,
    eis: 8,
  },
};

/** Perdita operativa portafoglio (allineato al brief). */
export const COMPOSITE_LOSS_PNL_PCT = -2;

/**
 * Determina la zona in base ai giorni al CD e alla posizione.
 */
export function getScoringZone(
  daysToCd: number | null,
  hasPosition: boolean,
  isInLoss: boolean,
): ScoringZone {
  if (hasPosition && isInLoss) return "loss";
  if (daysToCd === null || daysToCd > 120) return "early";
  if (daysToCd > 60) return "watch";
  return "hot";
}
