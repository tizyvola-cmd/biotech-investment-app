/**
 * Risk score v2 — production blend (Phase A kept as secondary diagnostic).
 *
 * Components: plan (inverse entry P(plan)), timing (DTC + slope), liquidity (ext/vol/illiquid),
 * regulatory (imminence axis 1 or documented placeholders).
 *
 * Weights 40/25/25/10 are provisional — recalibrate when each component has n > 50.
 */
import { LOSS_THRESHOLD_PCT } from "./lossAuditAnalysis";

export const RISK_V2_WEIGHTS = {
  plan: 0.4,
  timing: 0.25,
  liquidity: 0.25,
  regulatory: 0.1,
} as const;

export type RiskScoreV2ComponentKey = keyof typeof RISK_V2_WEIGHTS;

export type RiskScoreV2Input = {
  /** Entry P(plan) % (0–100). */
  entryPplanPct?: number | null;
  /** Days to catalyst at entry. */
  daysToCd?: number | null;
  /** Entry slope 5d (pp/day). */
  slope5d?: number | null;
  /** Ext. alignment score 0–100 (high = sector-aligned). */
  externalAlignmentScore?: number | null;
  /** Vol. anomaly score 0–100. */
  volumeAnomalyScore?: number | null;
  /** ADV 20d shares — for turnover when float cap available. */
  avgVolume20d?: number | null;
  /** Float market cap USD — rarely available; turnover uses when present. */
  floatMarketCapUsd?: number | null;
  /** Market cap USD — coarse illiquidity proxy when float missing. */
  marketCapUsd?: number | null;
  /** Regulatory imminence axis-1 score 0–100 when computed. */
  regulatoryImminenceScore?: number | null;
  /** Placeholder: binary regulatory/CD event within ~30d → impute 80. */
  regulatoryEventWithin30d?: boolean | null;
  /** cause_attribution regulatory_event.score fallback. */
  regulatoryEventScore?: number | null;
};

export type RiskScoreV2Breakdown = {
  score: number | null;
  plan: number | null;
  timing: number | null;
  liquidity: number | null;
  regulatory: number | null;
  timingDtc: number | null;
  timingSlope: number | null;
  liquidityInternal: number | null;
  liquidityVolume: number | null;
  liquidityIlliquid: number | null;
  componentsUsed: RiskScoreV2ComponentKey[];
  weightsUsed: Partial<Record<RiskScoreV2ComponentKey, number>>;
  regulatorySource: "imminence" | "cause_attr" | "within_30d_proxy" | "none";
};

function clamp0100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Component 1 — inverse entry P(plan). Null when P(plan) missing (no 50 placeholder). */
export function riskPlanComponent(entryPplanPct: number | null | undefined): number | null {
  if (entryPplanPct == null || !Number.isFinite(entryPplanPct)) return null;
  return clamp0100(100 - entryPplanPct);
}

/** DTC 0–100: <10d → 100, >60d → 0, linear between. */
export function dtcToRiskScore(daysToCd: number): number {
  if (!Number.isFinite(daysToCd)) return 50;
  if (daysToCd <= 10) return 100;
  if (daysToCd >= 60) return 0;
  return clamp0100(100 - ((daysToCd - 10) / 50) * 100);
}

/** Slope risk: negative → 100, positive → 0, missing → 50 (only sub-field exception). */
export function slopeToRiskScore(slope5d: number | null | undefined): number {
  if (slope5d == null || !Number.isFinite(slope5d)) return 50;
  if (slope5d < 0) return 100;
  if (slope5d > 0) return 0;
  return 50;
}

/**
 * Component 2 — timing. Null when DTC not calculable (unknown timing ≠ low timing).
 */
export function riskTimingComponent(args: {
  daysToCd?: number | null;
  slope5d?: number | null;
}): { timing: number | null; dtc: number | null; slope: number } {
  if (args.daysToCd == null || !Number.isFinite(args.daysToCd)) {
    return { timing: null, dtc: null, slope: slopeToRiskScore(args.slope5d) };
  }
  const dtc = dtcToRiskScore(args.daysToCd);
  const slope = slopeToRiskScore(args.slope5d);
  return {
    timing: clamp0100(0.6 * dtc + 0.4 * slope),
    dtc,
    slope,
  };
}

/** Turnover ratio → illiquidity 0–100 (biotech small-cap starting thresholds). */
export function turnoverToIlliquidityScore(turnoverRatio: number): number {
  if (!Number.isFinite(turnoverRatio) || turnoverRatio <= 0) return 100;
  if (turnoverRatio <= 0.005) return 100;
  if (turnoverRatio >= 0.03) return 0;
  return clamp0100(100 - ((turnoverRatio - 0.005) / 0.025) * 100);
}

/**
 * Coarse market-cap proxy — replace with ADV/float turnover when available.
 * < $100M → 100, $100M–$500M → 50, > $500M → 0.
 */
export function marketCapToIlliquidityProxy(marketCapUsd: number): number {
  if (!Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return 50;
  if (marketCapUsd < 100_000_000) return 100;
  if (marketCapUsd <= 500_000_000) return 50;
  return 0;
}

export function riskIlliquiditySubscore(args: {
  avgVolume20d?: number | null;
  floatMarketCapUsd?: number | null;
  marketCapUsd?: number | null;
}): number | null {
  const adv = args.avgVolume20d;
  const floatCap = args.floatMarketCapUsd;
  if (
    adv != null &&
    Number.isFinite(adv) &&
    adv > 0 &&
    floatCap != null &&
    Number.isFinite(floatCap) &&
    floatCap > 0
  ) {
    const turnover = adv / floatCap;
    return turnoverToIlliquidityScore(turnover);
  }
  const mcap = args.marketCapUsd;
  if (mcap != null && Number.isFinite(mcap) && mcap > 0) {
    return marketCapToIlliquidityProxy(mcap);
  }
  return null;
}

/** Component 3 — market / liquidity. Null when no ext/vol/illiquid signal at all. */
export function riskLiquidityComponent(args: {
  externalAlignmentScore?: number | null;
  volumeAnomalyScore?: number | null;
  avgVolume20d?: number | null;
  floatMarketCapUsd?: number | null;
  marketCapUsd?: number | null;
}): {
  liquidity: number | null;
  internal: number | null;
  volume: number | null;
  illiquid: number | null;
} {
  const internal =
    args.externalAlignmentScore != null && Number.isFinite(args.externalAlignmentScore)
      ? clamp0100(100 - args.externalAlignmentScore)
      : null;
  const volume =
    args.volumeAnomalyScore != null && Number.isFinite(args.volumeAnomalyScore)
      ? clamp0100(args.volumeAnomalyScore)
      : null;
  const illiquid = riskIlliquiditySubscore(args);

  const parts: { v: number; w: number }[] = [];
  if (internal != null) parts.push({ v: internal, w: 0.4 });
  if (volume != null) parts.push({ v: volume, w: 0.3 });
  if (illiquid != null) parts.push({ v: illiquid, w: 0.3 });

  if (parts.length === 0) {
    return { liquidity: null, internal, volume, illiquid };
  }

  if (illiquid == null && parts.length >= 1) {
    const wSum = parts.reduce((s, p) => s + p.w, 0);
    const internalOnly = internal != null;
    const volumeOnly = volume != null;
    if (internalOnly && volumeOnly) {
      return {
        liquidity: clamp0100(0.57 * internal! + 0.43 * volume!),
        internal,
        volume,
        illiquid,
      };
    }
    return {
      liquidity: clamp0100(parts.reduce((s, p) => s + p.v * (p.w / wSum), 0)),
      internal,
      volume,
      illiquid,
    };
  }

  const wSum = parts.reduce((s, p) => s + p.w, 0);
  return {
    liquidity: clamp0100(parts.reduce((s, p) => s + p.v * (p.w / wSum), 0)),
    internal,
    volume,
    illiquid,
  };
}

/** Component 4 — regulatory imminence (axis 1) with documented fallbacks. */
export function riskRegulatoryComponent(args: {
  regulatoryImminenceScore?: number | null;
  regulatoryEventWithin30d?: boolean | null;
  regulatoryEventScore?: number | null;
}): { regulatory: number | null; source: RiskScoreV2Breakdown["regulatorySource"] } {
  if (
    args.regulatoryImminenceScore != null &&
    Number.isFinite(args.regulatoryImminenceScore)
  ) {
    return {
      regulatory: clamp0100(args.regulatoryImminenceScore),
      source: "imminence",
    };
  }
  if (
    args.regulatoryEventScore != null &&
    Number.isFinite(args.regulatoryEventScore) &&
    args.regulatoryEventScore > 0
  ) {
    return {
      regulatory: clamp0100(args.regulatoryEventScore),
      source: "cause_attr",
    };
  }
  if (args.regulatoryEventWithin30d === true) {
    return { regulatory: 80, source: "within_30d_proxy" };
  }
  if (args.regulatoryEventWithin30d === false) {
    return { regulatory: 0, source: "within_30d_proxy" };
  }
  return { regulatory: null, source: "none" };
}

function blendRiskV2Components(
  parts: { key: RiskScoreV2ComponentKey; value: number | null }[],
): Pick<RiskScoreV2Breakdown, "score" | "componentsUsed" | "weightsUsed"> {
  const active = parts.filter(
    (p): p is { key: RiskScoreV2ComponentKey; value: number } =>
      p.value != null && Number.isFinite(p.value),
  );
  if (active.length === 0) {
    return { score: null, componentsUsed: [], weightsUsed: {} };
  }
  const rawWeightSum = active.reduce((s, p) => s + RISK_V2_WEIGHTS[p.key], 0);
  const weightsUsed: Partial<Record<RiskScoreV2ComponentKey, number>> = {};
  let score = 0;
  for (const p of active) {
    const w = RISK_V2_WEIGHTS[p.key] / rawWeightSum;
    weightsUsed[p.key] = w;
    score += p.value * w;
  }
  return {
    score: clamp0100(score),
    componentsUsed: active.map((p) => p.key),
    weightsUsed,
  };
}

/** Full Risk v2 breakdown for one deal (shadow mode). */
export function computeRiskScoreV2(input: RiskScoreV2Input): RiskScoreV2Breakdown {
  const plan = riskPlanComponent(input.entryPplanPct);
  const { timing, dtc, slope } = riskTimingComponent({
    daysToCd: input.daysToCd,
    slope5d: input.slope5d,
  });
  const { liquidity, internal, volume, illiquid } = riskLiquidityComponent({
    externalAlignmentScore: input.externalAlignmentScore,
    volumeAnomalyScore: input.volumeAnomalyScore,
    avgVolume20d: input.avgVolume20d,
    floatMarketCapUsd: input.floatMarketCapUsd,
    marketCapUsd: input.marketCapUsd,
  });
  const { regulatory, source } = riskRegulatoryComponent({
    regulatoryImminenceScore: input.regulatoryImminenceScore,
    regulatoryEventWithin30d: input.regulatoryEventWithin30d,
    regulatoryEventScore: input.regulatoryEventScore,
  });

  const blended = blendRiskV2Components([
    { key: "plan", value: plan },
    { key: "timing", value: timing },
    { key: "liquidity", value: liquidity },
    { key: "regulatory", value: regulatory },
  ]);

  return {
    ...blended,
    plan,
    timing,
    liquidity,
    regulatory,
    timingDtc: dtc,
    timingSlope: slope,
    liquidityInternal: internal,
    liquidityVolume: volume,
    liquidityIlliquid: illiquid,
    regulatorySource: source,
  };
}

/** Binary loss for dual-axis validation (Phase A native target). */
export function closedDealLossBinary(pnlPct: number): boolean {
  return Number.isFinite(pnlPct) && pnlPct < LOSS_THRESHOLD_PCT;
}

/** Build RiskScoreV2Input from SDS row + entry fields. */
export function riskScoreV2InputFromSources(args: {
  entryPplanPct?: number | null;
  daysToCd?: number | null;
  slope5d?: number | null;
  sdsRow?: import("../api/supernova").SdsRow | null;
  regulatoryImminenceScore?: number | null;
}): RiskScoreV2Input {
  const ca = args.sdsRow?.cause_attribution;
  const mcapBn = args.sdsRow?.cluster_d?.mc_pipeline_ratio?.market_cap_bn;
  const marketCapUsd =
    mcapBn != null && Number.isFinite(mcapBn) && mcapBn > 0 ? mcapBn * 1e9 : null;
  const dtc = args.daysToCd ?? args.sdsRow?.days_to_cd ?? null;
  const regulatoryWithin30 =
    dtc != null && Number.isFinite(dtc) ? dtc <= 30 : null;

  return {
    entryPplanPct: args.entryPplanPct,
    daysToCd: dtc,
    slope5d: args.slope5d,
    externalAlignmentScore: ca?.external_alignment?.score ?? null,
    volumeAnomalyScore: ca?.volume_anomaly?.score ?? null,
    avgVolume20d: ca?.volume_anomaly?.avg_volume_20d ?? null,
    floatMarketCapUsd: null,
    marketCapUsd,
    regulatoryImminenceScore: args.regulatoryImminenceScore,
    regulatoryEventWithin30d: regulatoryWithin30,
    regulatoryEventScore: ca?.regulatory_event?.score ?? null,
  };
}

/** Deals in P(plan) 50–70% band — sensitivity to bucket weight fix (Phase 4). */
export function listPplan5070RiskV2Deals(
  deals: { ticker: string; entryPplanPct: number | null; riskV2: number | null }[],
): typeof deals {
  return deals.filter(
    (d) =>
      d.entryPplanPct != null &&
      d.entryPplanPct >= 50 &&
      d.entryPplanPct < 70,
  );
}

/**
 * Estimate Δ risk_plan if bucket mid shifted (diagnostic only).
 * `correctedPplanPct` = what P(plan) would be after bucket weight fix.
 */
export function riskPlanDeltaFromPplanCorrection(
  entryPplanPct: number,
  correctedPplanPct: number,
): number {
  const before = riskPlanComponent(entryPplanPct) ?? 0;
  const after = riskPlanComponent(correctedPplanPct) ?? 0;
  return after - before;
}
