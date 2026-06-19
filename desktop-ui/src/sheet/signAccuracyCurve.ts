/**
 * Curva segno + scarto prezzo T−60…T+7 per coorte storica vs Simulation.
 */
import type { AccuracySummaryDoc } from "../data/accuracyModelData";
import type { SignCurveDailyDoc, SignCurveCohort, SignCurveOffsetPoint } from "../data/signCurveDailyData";
import {
  ACCURACY_OFFSETS,
  buildTemporalRowsFromSummary,
  horizonLabel,
  type HorizonAgg,
} from "./accuracyMetrics";

export type SignCurvePoint = {
  offset: number;
  label: string;
  retroSignPct: number | null;
  simSignPct: number | null;
  retroPricePct: number | null;
  simPricePct: number | null;
  retroN: number;
  simN: number;
  zone: "pre_cd" | "post_cd";
};

export type SignAccuracyCurveView = {
  points: SignCurvePoint[];
  xOffsets: number[];
  retro: CohortSummary | null;
  simulation: CohortSummary | null;
  runIso: string | null;
  preCdHitPct: number | null;
  metric: "daily_dod" | "node_cumulative" | null;
};

export type CohortSummary = {
  labelIt: string;
  labelEn: string;
  nEvents: number | null;
  nSessions: number | null;
  overallSignPct: number | null;
  overallSignPreCdPct: number | null;
  overallPricePct: number | null;
};

export type SignPeakHit = {
  pct: number;
  offset: number;
  label: string;
  cohort: "retro" | "simulation";
};

/** Highest day-over-day sign hit % across retro + Simulation bins. */
export function peakSignHitFromPoints(points: SignCurvePoint[]): SignPeakHit | null {
  let best: SignPeakHit | null = null;
  for (const p of points) {
    const candidates: Array<{ pct: number | null; cohort: "retro" | "simulation" }> = [
      { pct: p.retroSignPct, cohort: "retro" },
      { pct: p.simSignPct, cohort: "simulation" },
    ];
    for (const { pct, cohort } of candidates) {
      if (pct == null || !Number.isFinite(pct)) continue;
      if (!best || pct > best.pct) {
        best = { pct, offset: p.offset, label: p.label, cohort };
      }
    }
  }
  return best;
}

export function formatSignPeakOffset(offset: number): string {
  if (offset > 0) return `+${offset}`;
  return String(offset);
}

export function signChartYDomain(_points: SignCurvePoint[], _key: "sign" | "price"): {
  domain: [number, number];
  ticks: number[];
} {
  return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] };
}

function mapCohort(c: SignCurveCohort | null | undefined): CohortSummary | null {
  if (!c) return null;
  return {
    labelIt: c.label_it ?? "Corte storica",
    labelEn: c.label_en ?? "Historical cohort",
    nEvents: c.n_events ?? null,
    nSessions: c.n_sessions ?? null,
    overallSignPct: c.overall_sign_hit_pct ?? null,
    overallSignPreCdPct: c.overall_sign_hit_pre_cd_pct ?? null,
    overallPricePct: c.overall_price_accuracy_pct ?? c.overall_price_err_pct ?? null,
  };
}

function fromDailyDoc(doc: SignCurveDailyDoc | null | undefined): SignAccuracyCurveView | null {
  if (!doc) return null;
  const retroBins = doc.cohorts?.retro?.by_offset ?? [];
  const simBins = doc.cohorts?.simulation?.by_offset ?? [];

  if (retroBins.length === 0 && simBins.length === 0) {
    const legacy = doc.by_time_bin?.length ? doc.by_time_bin : doc.by_week_bin ?? [];
    if (legacy.length === 0) return null;
  }

  const xSet = new Set<number>(doc.x_offsets ?? []);
  for (const b of [...retroBins, ...simBins]) {
    if (b.offset != null) xSet.add(b.offset);
  }
  const xOffsets = [...xSet].sort((a, b) => a - b);

  const retroMap = new Map<number, SignCurveOffsetPoint>();
  for (const b of retroBins) {
    if (b.offset != null) retroMap.set(b.offset, b);
  }
  const simMap = new Map<number, SignCurveOffsetPoint>();
  for (const b of simBins) {
    if (b.offset != null) simMap.set(b.offset, b);
  }

  const points: SignCurvePoint[] = xOffsets.map((off) => {
    const r = retroMap.get(off);
    const s = simMap.get(off);
    return {
      offset: off,
      label: r?.label ?? s?.label ?? String(off),
      retroSignPct: r?.sign_hit_pct ?? null,
      simSignPct: s?.sign_hit_pct ?? null,
      retroPricePct: r?.price_accuracy_pct ?? r?.price_err_pct ?? null,
      simPricePct: s?.price_accuracy_pct ?? s?.price_err_pct ?? null,
      retroN: r?.n ?? 0,
      simN: s?.n ?? 0,
      zone: off < 0 ? "pre_cd" : "post_cd",
    };
  });

  const retro = mapCohort(doc.cohorts?.retro ?? null);
  const simulation = mapCohort(doc.cohorts?.simulation ?? null);

  return {
    points,
    xOffsets,
    retro,
    simulation,
    runIso: doc.generated_at ?? null,
    preCdHitPct:
      retro?.overallSignPreCdPct ??
      doc.overall?.hit_pct_pre_cd ??
      doc.overall?.hit_pct ??
      null,
    metric: "daily_dod",
  };
}

function weightedHit(horizons: HorizonAgg[], offsets: readonly number[]): number | null {
  let hits = 0;
  let n = 0;
  for (const off of offsets) {
    const h = horizons.find((x) => x.offset === off);
    if (!h || h.hitPct == null || h.n <= 0) continue;
    hits += (h.hitPct / 100) * h.n;
    n += h.n;
  }
  if (n <= 0) return null;
  return Math.round((hits / n) * 1000) / 10;
}

function fromSummaryDoc(doc: AccuracySummaryDoc | null | undefined): SignAccuracyCurveView {
  const empty: SignAccuracyCurveView = {
    points: [],
    xOffsets: [],
    retro: null,
    simulation: null,
    runIso: null,
    preCdHitPct: null,
    metric: null,
  };
  if (!doc) return empty;

  const rows = buildTemporalRowsFromSummary(doc, true);
  const v4Row = rows.find((r) => r.model === "v4") ?? null;
  if (!v4Row) return empty;

  const preOffsets = ACCURACY_OFFSETS.filter((o) => o < 0);
  const points: SignCurvePoint[] = ACCURACY_OFFSETS.filter((o) => o <= 7).map((off) => {
    const h = v4Row.horizons.find((x) => x.offset === off);
    return {
      offset: off,
      label: horizonLabel(off),
      retroSignPct: h?.hitPct ?? null,
      simSignPct: null,
      retroPricePct: null,
      simPricePct: null,
      retroN: h?.n ?? 0,
      simN: 0,
      zone: off < 0 ? "pre_cd" : "post_cd",
    };
  });

  return {
    points,
    xOffsets: points.map((p) => p.offset),
    retro: {
      labelIt: "Legacy nodi",
      labelEn: "Legacy nodes",
      nEvents: v4Row.nRows,
      nSessions: null,
      overallSignPct: weightedHit(v4Row.horizons, preOffsets),
      overallSignPreCdPct: weightedHit(v4Row.horizons, preOffsets),
      overallPricePct: null,
    },
    simulation: null,
    runIso: v4Row.runIso,
    preCdHitPct: weightedHit(v4Row.horizons, preOffsets),
    metric: "node_cumulative",
  };
}

export function buildSignAccuracyCurveView(
  summaryDoc: AccuracySummaryDoc | null | undefined,
  dailyDoc?: SignCurveDailyDoc | null,
): SignAccuracyCurveView {
  const daily = fromDailyDoc(dailyDoc);
  if (daily && daily.points.length > 0) return daily;
  return fromSummaryDoc(summaryDoc);
}

export type ResolvedSignHit = {
  hitPct: number | null;
  n: number;
  offset: number | null;
  cohort: "simulation" | "retro" | null;
  source: string;
};

function hitFromPoint(
  p: SignCurvePoint,
  cohort: "simulation" | "retro",
): { hitPct: number | null; n: number } {
  if (cohort === "simulation") {
    return { hitPct: p.simSignPct, n: p.simN ?? 0 };
  }
  return { hitPct: p.retroSignPct, n: p.retroN ?? 0 };
}

/** Interpola / cerca hit% al offset calendario (es. −60 = 60g al CD). */
function lookupHitAtOffset(
  points: SignCurvePoint[],
  targetOffset: number,
  cohort: "simulation" | "retro",
): { hitPct: number | null; n: number } {
  const pre = points
    .filter((p) => p.offset < 0)
    .sort((a, b) => a.offset - b.offset);
  if (!pre.length) return { hitPct: null, n: 0 };

  const exact = pre.find((p) => p.offset === targetOffset);
  if (exact) {
    const h = hitFromPoint(exact, cohort);
    if (h.hitPct != null) return h;
  }

  let lo: SignCurvePoint | null = null;
  let hi: SignCurvePoint | null = null;
  for (const p of pre) {
    if (p.offset <= targetOffset) lo = p;
    if (p.offset >= targetOffset) {
      hi = p;
      break;
    }
  }
  if (lo && hi && lo.offset !== hi.offset) {
    const loH = hitFromPoint(lo, cohort);
    const hiH = hitFromPoint(hi, cohort);
    if (loH.hitPct != null && hiH.hitPct != null) {
      const t = (targetOffset - lo.offset) / (hi.offset - lo.offset);
      return {
        hitPct: Math.round((loH.hitPct + t * (hiH.hitPct - loH.hitPct)) * 10) / 10,
        n: loH.n + hiH.n,
      };
    }
  }
  const near = lo ?? hi;
  if (near) return hitFromPoint(near, cohort);
  return { hitPct: null, n: 0 };
}

/** Media pesata hit% pre-CD (Simulation preferita) — utile oltre T−60. */
function aggregatePreCdHit(
  points: SignCurvePoint[],
  cohort: "simulation" | "retro",
): { hitPct: number | null; n: number } {
  let hits = 0;
  let n = 0;
  for (const p of points) {
    if (p.offset >= 0) continue;
    const h = hitFromPoint(p, cohort);
    if (h.hitPct == null || h.n <= 0) continue;
    hits += h.hitPct * h.n;
    n += h.n;
  }
  if (n <= 0) return { hitPct: null, n: 0 };
  return { hitPct: Math.round((hits / n) * 10) / 10, n };
}

/**
 * Hit% direzionale (day-over-day) al offset CD corrente.
 * Preferisce coorte **Simulation** (titoli del foglio Simulation), poi retro.
 */
export function resolveSignHitForDaysToCd(
  daysToCd: number | null | undefined,
  view: SignAccuracyCurveView | null | undefined,
): ResolvedSignHit {
  const empty: ResolvedSignHit = {
    hitPct: null,
    n: 0,
    offset: null,
    cohort: null,
    source: "none",
  };
  if (daysToCd == null || !Number.isFinite(daysToCd) || daysToCd <= 0 || !view?.points?.length) {
    return empty;
  }

  const calOffset = -Math.round(daysToCd);

  for (const cohort of ["simulation", "retro"] as const) {
    const at = lookupHitAtOffset(view.points, calOffset, cohort);
    if (at.hitPct != null) {
      return {
        hitPct: at.hitPct,
        n: at.n,
        offset: calOffset,
        cohort,
        source: `offset ${calOffset}`,
      };
    }
  }

  if (calOffset < -60) {
    const simAgg = aggregatePreCdHit(view.points, "simulation");
    if (simAgg.hitPct != null) {
      return {
        hitPct: simAgg.hitPct,
        n: simAgg.n,
        offset: calOffset,
        cohort: "simulation",
        source: "sim pre-CD aggregate",
      };
    }
    const retroAgg = aggregatePreCdHit(view.points, "retro");
    if (retroAgg.hitPct != null) {
      return {
        hitPct: retroAgg.hitPct,
        n: retroAgg.n,
        offset: calOffset,
        cohort: "retro",
        source: "retro pre-CD aggregate",
      };
    }
  }

  const simOverall = view.simulation?.overallSignPreCdPct ?? view.simulation?.overallSignPct;
  if (simOverall != null) {
    return {
      hitPct: simOverall,
      n: view.simulation?.nSessions ?? 0,
      offset: calOffset,
      cohort: "simulation",
      source: "sim overall pre-CD",
    };
  }
  const retroOverall = view.retro?.overallSignPreCdPct ?? view.retro?.overallSignPct;
  if (retroOverall != null) {
    return {
      hitPct: retroOverall,
      n: view.retro?.nSessions ?? 0,
      offset: calOffset,
      cohort: "retro",
      source: "retro overall pre-CD",
    };
  }

  return empty;
}

export type ResolvedPriceAccuracy = {
  priceAccPct: number | null;
  n: number;
  offset: number | null;
  cohort: "simulation" | "retro" | null;
  source: string;
};

function priceFromPoint(
  p: SignCurvePoint,
  cohort: "simulation" | "retro",
): { priceAccPct: number | null; n: number } {
  if (cohort === "simulation") {
    return { priceAccPct: p.simPricePct, n: p.simN ?? 0 };
  }
  return { priceAccPct: p.retroPricePct, n: p.retroN ?? 0 };
}

function lookupPriceAtOffset(
  points: SignCurvePoint[],
  targetOffset: number,
  cohort: "simulation" | "retro",
): { priceAccPct: number | null; n: number } {
  const pre = points
    .filter((p) => p.offset < 0)
    .sort((a, b) => a.offset - b.offset);
  if (!pre.length) return { priceAccPct: null, n: 0 };

  const exact = pre.find((p) => p.offset === targetOffset);
  if (exact) {
    const h = priceFromPoint(exact, cohort);
    if (h.priceAccPct != null) return h;
  }

  let lo: SignCurvePoint | null = null;
  let hi: SignCurvePoint | null = null;
  for (const p of pre) {
    if (p.offset <= targetOffset) lo = p;
    if (p.offset >= targetOffset) {
      hi = p;
      break;
    }
  }
  if (lo && hi && lo.offset !== hi.offset) {
    const loH = priceFromPoint(lo, cohort);
    const hiH = priceFromPoint(hi, cohort);
    if (loH.priceAccPct != null && hiH.priceAccPct != null) {
      const t = (targetOffset - lo.offset) / (hi.offset - lo.offset);
      return {
        priceAccPct: Math.round((loH.priceAccPct + t * (hiH.priceAccPct - loH.priceAccPct)) * 10) / 10,
        n: loH.n + hiH.n,
      };
    }
  }
  const near = lo ?? hi;
  if (near) return priceFromPoint(near, cohort);
  return { priceAccPct: null, n: 0 };
}

function aggregatePreCdPrice(
  points: SignCurvePoint[],
  cohort: "simulation" | "retro",
): { priceAccPct: number | null; n: number } {
  let acc = 0;
  let n = 0;
  for (const p of points) {
    if (p.offset >= 0) continue;
    const h = priceFromPoint(p, cohort);
    if (h.priceAccPct == null || h.n <= 0) continue;
    acc += h.priceAccPct * h.n;
    n += h.n;
  }
  if (n <= 0) return { priceAccPct: null, n: 0 };
  return { priceAccPct: Math.round((acc / n) * 10) / 10, n };
}

/**
 * Price accuracy % (0–100, più alto = modello più vicino al reale) al offset CD corrente.
 * Preferisce coorte **Simulation**, poi retro.
 */
export function resolvePriceAccuracyForDaysToCd(
  daysToCd: number | null | undefined,
  view: SignAccuracyCurveView | null | undefined,
): ResolvedPriceAccuracy {
  const empty: ResolvedPriceAccuracy = {
    priceAccPct: null,
    n: 0,
    offset: null,
    cohort: null,
    source: "none",
  };
  if (daysToCd == null || !Number.isFinite(daysToCd) || daysToCd <= 0 || !view?.points?.length) {
    return empty;
  }

  const calOffset = -Math.round(daysToCd);

  for (const cohort of ["simulation", "retro"] as const) {
    const at = lookupPriceAtOffset(view.points, calOffset, cohort);
    if (at.priceAccPct != null) {
      return {
        priceAccPct: at.priceAccPct,
        n: at.n,
        offset: calOffset,
        cohort,
        source: `offset ${calOffset}`,
      };
    }
  }

  if (calOffset < -60) {
    const simAgg = aggregatePreCdPrice(view.points, "simulation");
    if (simAgg.priceAccPct != null) {
      return {
        priceAccPct: simAgg.priceAccPct,
        n: simAgg.n,
        offset: calOffset,
        cohort: "simulation",
        source: "sim pre-CD aggregate",
      };
    }
    const retroAgg = aggregatePreCdPrice(view.points, "retro");
    if (retroAgg.priceAccPct != null) {
      return {
        priceAccPct: retroAgg.priceAccPct,
        n: retroAgg.n,
        offset: calOffset,
        cohort: "retro",
        source: "retro pre-CD aggregate",
      };
    }
  }

  const simOverall = view.simulation?.overallPricePct;
  if (simOverall != null) {
    return {
      priceAccPct: simOverall,
      n: view.simulation?.nSessions ?? 0,
      offset: calOffset,
      cohort: "simulation",
      source: "sim overall",
    };
  }
  const retroOverall = view.retro?.overallPricePct;
  if (retroOverall != null) {
    return {
      priceAccPct: retroOverall,
      n: view.retro?.nSessions ?? 0,
      offset: calOffset,
      cohort: "retro",
      source: "retro overall",
    };
  }

  return empty;
}

export function signHitToneClass(
  pct: number | null | undefined,
  metric: SignAccuracyCurveView["metric"] = null,
): string {
  if (pct == null || !Number.isFinite(pct)) return "text-ink";
  if (metric === "daily_dod") {
    if (pct >= 55) return "text-positive";
    if (pct >= 48) return "text-warn";
    return "text-negative";
  }
  if (pct >= 58) return "text-positive";
  if (pct >= 52) return "text-warn";
  return "text-negative";
}
