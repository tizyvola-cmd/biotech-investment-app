/**
 * Multi-curve ROI blend (client) — mirrors desktop sdsRoiBlend.ts.
 */
import type { ChartPoint } from "./types";
import { completionDateToNowOffset } from "./mobileRecalibCurve";
import {
  assessmentChartOffsetsForNow,
  calendarOffsetsForValueCount,
  interpolateSeriesAtOffset,
  SUPERNova_HISTORY_MEAN,
  SUPERNova_OFFSETS,
} from "./mobileChartCalendar";
import { recalibPredValuesAtCalendarOffsets } from "./mobileRecalibPath";

export const SDS_ROI_PROFILES = [
  "cluster1",
  "cluster0",
  "post_rialzo",
  "post_ribasso",
  "post_neutro",
] as const;

export type SdsRoiProfileId = (typeof SDS_ROI_PROFILES)[number];

export const ROI_STANDARD_OFFSETS = [-10, -5, 4] as const;

export type SdsCurveRoiHorizonKey = "pre_10" | "pre_5" | "post_4";

export type SdsCurveRoiHorizon = {
  pct_vs_m60: number;
  delta_from_now?: number | null;
};

export type SdsCurveRoiBlend = {
  fit_pct?: Partial<Record<SdsRoiProfileId, number | null>>;
  rmse_pp?: Partial<Record<SdsRoiProfileId, number | null>>;
  best_profile?: SdsRoiProfileId | null;
  best_fit_pct?: number | null;
  weights?: Partial<Record<SdsRoiProfileId | "_live", number>>;
  cluster_bonuses?: Partial<Record<SdsRoiProfileId, number>>;
  horizons?: Partial<Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon>>;
  horizons_curve?: Partial<Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon>>;
  horizons_pred?: Partial<Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon>>;
  now_offset?: number | null;
};

export type SdsRoiClusterContext = {
  sds?: number | null;
  days_to_cd?: number | null;
  cluster_scores?: Partial<Record<string, number | null>>;
  cluster_a?: { total?: number | null };
  cluster_b?: {
    short_interest?: { squeeze_setup?: boolean; structural_bearish?: boolean };
    analyst_upgrades?: { downgrades_60d?: number; tier1_coverage?: boolean };
    institutional_delta?: { premium_fund_present?: boolean };
  };
  cluster_c?: {
    bollinger_squeeze?: { bb_percentile?: number | null };
    obv_accumulation?: { pattern?: string | null };
  };
  cluster_d?: {
    cash_runway?: { runway_months?: number | null };
    runway_months?: number | null;
  };
};

export type MacroGroupId =
  | "globale"
  | "cluster0"
  | "cluster1"
  | "post_rialzo"
  | "post_ribasso"
  | "post_neutro";

export type GuideCurvePoint = {
  offset: number;
  xLabel: string;
  meanPct: number | null;
  n: number;
};

function rmsePpVsRef(obs: (number | null)[], ref: (number | null)[] | undefined, minPts = 3): number | null {
  if (!ref?.length) return null;
  const sq: number[] = [];
  for (let i = 0; i < SUPERNova_OFFSETS.length; i++) {
    const ov = obs[i];
    const rv = ref[i];
    if (ov == null || !Number.isFinite(ov) || rv == null || !Number.isFinite(rv)) continue;
    const d = ov - rv;
    sq.push(d * d);
  }
  if (sq.length < minPts) return null;
  return Math.round(Math.sqrt(sq.reduce((a, b) => a + b, 0) / sq.length) * 1000) / 1000;
}

function fitPctFromRmse(rmse: number | null): number | null {
  if (rmse == null || !Number.isFinite(rmse)) return null;
  return Math.round(Math.max(0, Math.min(100, 100 - rmse)) * 10) / 10;
}

function softmaxWeights(scores: Record<string, number>, tau = 12): Record<string, number> {
  const keys = Object.keys(scores);
  if (!keys.length) return {};
  const mx = Math.max(...keys.map((k) => scores[k]!));
  const exps = keys.map((k) => Math.exp((scores[k]! - mx) / tau));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = Math.round((exps[i]! / sum) * 10000) / 10000;
  });
  return out;
}

function interpCurve(values: (number | null)[], target: number): number | null {
  const offsets = calendarOffsetsForValueCount(values.length);
  const pts: { offset: number; y: number }[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const y = values[i];
    if (y != null && Number.isFinite(y)) pts.push({ offset: offsets[i]!, y });
  }
  return interpolateSeriesAtOffset(pts, target);
}

function blendAtOffset(
  offset: number,
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  weights: Partial<Record<string, number>>,
  obs: (number | null)[],
): number | null {
  const liveW = weights._live ?? 0;
  let acc = 0;
  let wSum = 0;
  for (const pid of SDS_ROI_PROFILES) {
    const w = weights[pid] ?? 0;
    if (w <= 0) continue;
    const ref = refs[pid];
    if (!ref) continue;
    const v = interpCurve(ref, offset);
    if (v == null) continue;
    acc += w * v;
    wSum += w;
  }
  if (liveW > 0) {
    const lv = interpCurve(obs, offset);
    if (lv != null) {
      acc += liveW * lv;
      wSum += liveW;
    }
  }
  if (wSum <= 0) return null;
  return acc / wSum;
}

function scenarioWeights(
  fitPct: Partial<Record<SdsRoiProfileId, number | null>>,
  sds: number | null | undefined,
  obsN: number,
  clusterBonuses: Partial<Record<SdsRoiProfileId, number>> = {},
): Partial<Record<SdsRoiProfileId | "_live", number>> {
  const scores: Record<string, number> = {};
  for (const pid of SDS_ROI_PROFILES) {
    const fp = fitPct[pid];
    if (fp != null && Number.isFinite(fp)) scores[pid] = fp;
  }
  if (sds != null && Number.isFinite(sds)) {
    if (sds >= 75 && scores.cluster1 != null) scores.cluster1 += 12;
    else if (sds >= 55 && scores.cluster1 != null) scores.cluster1 += 5;
    if (sds < 55) {
      if (scores.post_neutro != null) scores.post_neutro += 8;
      if (scores.cluster0 != null) scores.cluster0 += 8;
    }
  }
  for (const pid of SDS_ROI_PROFILES) {
    const bonus = clusterBonuses[pid];
    if (bonus != null && scores[pid] != null) scores[pid] += bonus;
  }
  if (!Object.keys(scores).length) return {};
  let weights = softmaxWeights(scores);
  if (obsN >= 4) {
    const liveW = Math.min(0.45, 0.08 * obsN);
    const scale = 1 - liveW;
    weights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.round(v * scale * 10000) / 10000]));
    weights._live = Math.round(liveW * 10000) / 10000;
  }
  return weights as Partial<Record<SdsRoiProfileId | "_live", number>>;
}

export function clusterScenarioBonuses(ctx: SdsRoiClusterContext): Partial<Record<SdsRoiProfileId, number>> {
  const bonuses: Partial<Record<SdsRoiProfileId, number>> = {};
  const bump = (profile: SdsRoiProfileId, amount: number) => {
    bonuses[profile] = (bonuses[profile] ?? 0) + amount;
  };

  const cs = ctx.cluster_scores ?? {};
  let ca = cs.catalyst_quality;
  if (ca == null) ca = ctx.cluster_a?.total ?? null;
  if (ca != null && Number.isFinite(ca)) {
    if (ca >= 24) {
      bump("cluster1", 4);
      bump("post_rialzo", 8);
    } else if (ca >= 18) bump("post_rialzo", 5);
    else if (ca < 10) bump("post_neutro", 4);
  }

  const si = ctx.cluster_b?.short_interest;
  if (si?.squeeze_setup) {
    bump("post_rialzo", 8);
    bump("cluster1", 5);
  }
  if (si?.structural_bearish) bump("post_ribasso", 10);

  const au = ctx.cluster_b?.analyst_upgrades;
  if ((au?.downgrades_60d ?? 0) >= 2) bump("post_ribasso", 6);
  if (au?.tier1_coverage) bump("post_rialzo", 4);
  if (ctx.cluster_b?.institutional_delta?.premium_fund_present) {
    bump("cluster1", 4);
    bump("post_rialzo", 3);
  }
  const bScore = cs.institutional_signal;
  if (bScore != null && bScore >= 15) bump("post_rialzo", 3);
  else if (bScore != null && bScore < 8) bump("post_ribasso", 3);

  const bbPct = ctx.cluster_c?.bollinger_squeeze?.bb_percentile;
  if (bbPct != null && bbPct <= 15) bump("cluster1", 6);
  const pattern = String(ctx.cluster_c?.obv_accumulation?.pattern ?? "").toLowerCase();
  if (pattern.includes("accumulation")) bump("cluster1", 4);
  if (pattern.includes("distribution") || pattern.includes("bearish")) bump("post_ribasso", 5);
  const cScore = cs.price_structure;
  if (cScore != null && cScore >= 14) bump("cluster1", 3);

  let months = ctx.cluster_d?.cash_runway?.runway_months ?? ctx.cluster_d?.runway_months ?? null;
  if (months != null && Number.isFinite(months)) {
    if (months >= 18) bump("cluster1", 2);
    else if (months < 12) {
      bump("post_neutro", 4);
      bump("post_ribasso", 3);
    }
  }

  const days = ctx.days_to_cd;
  if (days != null && Number.isFinite(days)) {
    if (days >= 14 && days <= 60) bump("cluster1", 5);
    else if (days < 14) bump("post_neutro", 6);
    else if (days > 60) {
      bump("post_neutro", 4);
      bump("cluster0", 3);
    }
  }

  return bonuses;
}

function normalizedRoiHorizons(
  obs: (number | null)[],
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  weights: Partial<Record<string, number>>,
  nowOff: number | null | undefined,
): SdsCurveRoiBlend["horizons"] {
  const keyByOff: Record<number, SdsCurveRoiHorizonKey> = { [-10]: "pre_10", [-5]: "pre_5", 4: "post_4" };
  const horizons: NonNullable<SdsCurveRoiBlend["horizons"]> = {};
  const yNow = nowOff != null && Number.isFinite(nowOff) ? blendAtOffset(nowOff, refs, weights, obs) : null;
  for (const off of ROI_STANDARD_OFFSETS) {
    const level = blendAtOffset(off, refs, weights, obs);
    if (level == null) continue;
    const entry: SdsCurveRoiHorizon = { pct_vs_m60: Math.round(level * 100) / 100 };
    if (yNow != null) entry.delta_from_now = Math.round((level - yNow) * 100) / 100;
    else if (nowOff != null && nowOff === off) entry.delta_from_now = 0;
    horizons[keyByOff[off]] = entry;
  }
  return horizons;
}

export function guideCurvesToRefMap(
  curves: Partial<Record<MacroGroupId, GuideCurvePoint[]>>,
): Partial<Record<SdsRoiProfileId, (number | null)[]>> {
  const out: Partial<Record<SdsRoiProfileId, (number | null)[]>> = {
    cluster1: [...SUPERNova_HISTORY_MEAN],
  };
  const map: Partial<Record<MacroGroupId, SdsRoiProfileId>> = {
    cluster0: "cluster0",
    cluster1: "cluster1",
    post_rialzo: "post_rialzo",
    post_ribasso: "post_ribasso",
    post_neutro: "post_neutro",
  };
  for (const [gid, pid] of Object.entries(map) as [MacroGroupId, SdsRoiProfileId][]) {
    const pts = curves[gid];
    if (!pts?.length) continue;
    const byOff = new Map(pts.map((p) => [p.offset, p.meanPct]));
    const vals = SUPERNova_OFFSETS.map((off) => {
      const v = byOff.get(off);
      return v != null && Number.isFinite(v) ? v : null;
    });
    if (vals.filter((v) => v != null).length >= 3) out[pid] = vals;
  }
  return out;
}

export function computeClientCurveRoiBlend(
  obsValues: (number | null)[] | null,
  simRow: Record<string, unknown>,
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  ctx: SdsRoiClusterContext,
): SdsCurveRoiBlend | null {
  if (!obsValues || obsValues.length < 2) return null;
  const obs = obsValues;
  const obsN = obs.filter((v) => v != null && Number.isFinite(v)).length;
  if (obsN < 2) return null;

  const fit_pct: Partial<Record<SdsRoiProfileId, number | null>> = {};
  const rmse_pp: Partial<Record<SdsRoiProfileId, number | null>> = {};
  for (const pid of SDS_ROI_PROFILES) {
    const rmse = rmsePpVsRef(obs, refs[pid]);
    rmse_pp[pid] = rmse;
    fit_pct[pid] = fitPctFromRmse(rmse);
  }

  const valid = SDS_ROI_PROFILES.filter((p) => fit_pct[p] != null);
  let best_profile: SdsRoiProfileId | null = null;
  let best_fit_pct: number | null = null;
  if (valid.length) {
    best_profile = valid.reduce((a, b) => ((fit_pct[a] ?? 0) >= (fit_pct[b] ?? 0) ? a : b));
    best_fit_pct = fit_pct[best_profile] ?? null;
  }

  const cluster_bonuses = clusterScenarioBonuses(ctx);
  const weights = scenarioWeights(fit_pct, ctx.sds, obsN, cluster_bonuses);
  const now_offset = completionDateToNowOffset(simRow["Completion Date"]);
  const horizons =
    now_offset != null && Number.isFinite(now_offset)
      ? normalizedRoiHorizons(obs, refs, weights, now_offset)
      : normalizedRoiHorizons(obs, refs, weights, null);

  const keyByOff: Record<number, SdsCurveRoiHorizonKey> = { [-10]: "pre_10", [-5]: "pre_5", 4: "post_4" };
  const horizons_pred: NonNullable<SdsCurveRoiBlend["horizons"]> = {};
  for (const off of ROI_STANDARD_OFFSETS) {
    const level = interpCurve(obs, off);
    if (level == null) continue;
    horizons_pred[keyByOff[off]] = { pct_vs_m60: Math.round(level * 100) / 100 };
  }

  return {
    fit_pct,
    rmse_pp,
    best_profile,
    best_fit_pct,
    weights,
    cluster_bonuses,
    horizons,
    horizons_pred: Object.keys(horizons_pred).length ? horizons_pred : undefined,
    now_offset,
  };
}

export function sampleBlendCurveValues(
  blend: SdsCurveRoiBlend | null,
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  obsValues: (number | null)[] | null,
  offsets?: readonly number[],
): (number | null)[] | null {
  if (!blend?.weights || !obsValues?.length) return null;
  const obs = obsValues;
  const grid = offsets ?? calendarOffsetsForValueCount(obs.length);
  const vals = grid.map((off) => {
    const v = blendAtOffset(off, refs, blend.weights!, obs);
    return v != null && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  });
  if (vals.filter((v) => v != null).length < 2) return null;
  return vals;
}

export function blendCurveFromSimChart(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  ctx: SdsRoiClusterContext,
  options?: { extendedPostCd?: boolean; nowOffset?: number | null; offsets?: readonly number[] },
): (number | null)[] | null {
  const extended = options?.extendedPostCd ?? false;
  const nowOff = options?.nowOffset ?? completionDateToNowOffset(simRow["Completion Date"]);
  const gridOffsets =
    options?.offsets ??
    (extended ? assessmentChartOffsetsForNow(nowOff) : undefined);
  const obs = recalibPredValuesAtCalendarOffsets(chartPoints, simRow, {
    extendedPostCd: extended,
    nowOffset: nowOff,
    offsets: gridOffsets,
  });
  if (!obs) return null;
  const blend = computeClientCurveRoiBlend(obs, simRow, refs, ctx);
  return sampleBlendCurveValues(
    blend,
    refs,
    obs,
    gridOffsets ?? calendarOffsetsForValueCount(obs.length),
  );
}
