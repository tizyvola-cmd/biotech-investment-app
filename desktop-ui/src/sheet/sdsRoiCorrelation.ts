/**
 * SDS ↔ ROI correlation estimate (client) — mirrors prediction/sds_roi_correlation.py.
 */
import { fetchProjectJson } from "../data/projectData";
import type { SdsCurveRoiHorizon, SdsCurveRoiHorizonKey, SdsRoiProfileId } from "./sdsRoiBlend";

export type ProfileAnchor = {
  n?: number;
  median_sds?: number | null;
  median_roi_pct_vs_m60?: Partial<Record<SdsCurveRoiHorizonKey, number | null>>;
  source?: string;
};

export type SdsRoiCorrelationDoc = {
  generated_at?: string;
  anchor_low?: string;
  anchor_high?: string;
  sds_watch_floor?: number;
  sds_supernova_floor?: number;
  profile_anchors?: Partial<Record<string, ProfileAnchor>>;
  profiles?: Partial<
    Record<
      SdsRoiProfileId | string,
      {
        n?: number;
        quintile_edges?: number[];
        bins?: {
          bin?: number;
          sds_min?: number;
          sds_max?: number;
          n?: number;
          median_roi_pct_vs_m60?: Partial<Record<SdsCurveRoiHorizonKey, number | null>>;
        }[];
        correlation?: Partial<
          Record<
            SdsCurveRoiHorizonKey,
            { r?: number | null; slope_pp_per_sds?: number | null; intercept_pp?: number | null; n?: number }
          >
        >;
      }
    >
  >;
  pooled_post_cd?: SdsRoiCorrelationDoc["profiles"] extends infer P ? P extends Record<string, infer V> ? V : never : never;
  pooled_extended?: SdsRoiCorrelationDoc["profiles"] extends infer P ? P extends Record<string, infer V> ? V : never : never;
};

const CORR_FILE = "sds_roi_correlation.json";
const HORIZON_KEYS: SdsCurveRoiHorizonKey[] = ["pre_10", "pre_5", "post_4"];
const CALIBRATION_PROFILES = new Set([
  "cluster1",
  "cluster0",
  "post_rialzo",
  "post_ribasso",
  "post_neutro",
]);
const POST_CD_PROFILES = new Set(["post_rialzo", "post_ribasso", "post_neutro"]);
const ANCHOR_LOW = "post_neutro";
const ANCHOR_HIGH = "cluster1";
const SDS_WATCH_FLOOR = 30;
const SDS_SUPERNOVA_FLOOR = 75;

let cachedDoc: SdsRoiCorrelationDoc | null | undefined;

export async function loadSdsRoiCorrelation(): Promise<SdsRoiCorrelationDoc | null> {
  if (cachedDoc !== undefined) return cachedDoc;
  const { data } = await fetchProjectJson<SdsRoiCorrelationDoc>(CORR_FILE);
  cachedDoc = data ?? null;
  return cachedDoc;
}

function binIndex(sds: number, edges: number[]): number {
  if (!edges.length) return 0;
  for (let i = 0; i < edges.length - 1; i++) {
    if (sds <= edges[i + 1]) return i;
  }
  return edges.length - 2;
}

function sdsSupernovaWeight(sds: number, doc: SdsRoiCorrelationDoc): number {
  const lo = doc.sds_watch_floor ?? SDS_WATCH_FLOOR;
  const hi = doc.sds_supernova_floor ?? SDS_SUPERNOVA_FLOOR;
  if (sds <= lo) return 0;
  if (sds >= hi) return 1;
  return (sds - lo) / (hi - lo);
}

function lerp(a: number | null | undefined, b: number | null | undefined, t: number): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a + t * (b - a)) * 100) / 100;
}

function estimateFromAnchors(
  sds: number,
  doc: SdsRoiCorrelationDoc,
  profile?: SdsRoiProfileId | null,
): Partial<
  Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon & { source?: string; weight_supernova?: number }>
> | null {
  const anchors = doc.profile_anchors ?? {};
  const lowKey = doc.anchor_low ?? ANCHOR_LOW;
  const highKey = doc.anchor_high ?? ANCHOR_HIGH;
  const low = anchors[lowKey]?.median_roi_pct_vs_m60 ?? {};
  const high = anchors[highKey]?.median_roi_pct_vs_m60 ?? {};
  if (!Object.keys(low).length && !Object.keys(high).length) return null;

  const w = sdsSupernovaWeight(sds, doc);
  const profMed =
    profile && CALIBRATION_PROFILES.has(profile) ? anchors[profile]?.median_roi_pct_vs_m60 : undefined;

  const horizons: Partial<
    Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon & { source?: string; weight_supernova?: number }>
  > = {};

  for (const hk of HORIZON_KEYS) {
    let est = lerp(low[hk], high[hk], w);
    if (est == null) continue;
    if (profile && POST_CD_PROFILES.has(profile) && profMed?.[hk] != null && Number.isFinite(profMed[hk]!)) {
      est = Math.round((0.55 * est + 0.45 * profMed[hk]!) * 100) / 100;
    }
    horizons[hk] = {
      pct_vs_m60: est,
      source: "anchor_blend",
      weight_supernova: Math.round(w * 1000) / 1000,
    };
  }

  return Object.keys(horizons).length ? horizons : null;
}

export function estimateRoiFromSdsCorrelation(
  sds: number | null | undefined,
  doc: SdsRoiCorrelationDoc | null | undefined,
  profile?: SdsRoiProfileId | null,
): {
  horizons: Partial<Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon & { source?: string; bin?: number; r?: number | null; weight_supernova?: number }>>;
  profile_used: string;
  sds_input: number;
} | null {
  if (sds == null || !Number.isFinite(sds) || !doc) return null;

  const anchorHorizons = estimateFromAnchors(sds, doc, profile);
  if (anchorHorizons) {
    return {
      horizons: anchorHorizons,
      profile_used: profile && CALIBRATION_PROFILES.has(profile) ? profile : "anchor_neutro_cluster1",
      sds_input: Math.round(sds * 10) / 10,
    };
  }

  let block =
    profile && CALIBRATION_PROFILES.has(profile) ? doc.profiles?.[profile] : undefined;
  if (!block?.bins?.length) block = doc.pooled_extended ?? doc.pooled_post_cd;
  if (!block) return null;

  const bins = block.bins ?? [];
  const edges = block.quintile_edges ?? [];
  const corr = block.correlation ?? {};
  const horizons: Partial<
    Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon & { source?: string; bin?: number; r?: number | null }>
  > = {};

  const maxEdge = edges.length ? edges[edges.length - 1] : sds;
  if (bins.length && edges.length && sds <= maxEdge) {
    const bi = Math.min(Math.max(binIndex(sds, edges), 0), bins.length - 1);
    const med = bins[bi]?.median_roi_pct_vs_m60 ?? {};
    for (const hk of HORIZON_KEYS) {
      const v = med[hk];
      if (v != null && Number.isFinite(v)) {
        horizons[hk] = { pct_vs_m60: v, source: "quintile_median", bin: bins[bi]?.bin };
      }
    }
  }

  for (const hk of HORIZON_KEYS) {
    if (horizons[hk]) continue;
    const reg = corr[hk];
    if (reg?.slope_pp_per_sds != null && reg?.intercept_pp != null) {
      horizons[hk] = {
        pct_vs_m60: Math.round((reg.slope_pp_per_sds * sds + reg.intercept_pp) * 100) / 100,
        source: "linear_regression",
        r: reg.r ?? null,
      };
    }
  }

  if (!Object.keys(horizons).length) return null;

  return {
    horizons,
    profile_used: profile && CALIBRATION_PROFILES.has(profile) ? profile : "pooled_extended",
    sds_input: Math.round(sds * 10) / 10,
  };
}

export type SdsCorrelationEstimate = {
  horizons?: Partial<
    Record<SdsCurveRoiHorizonKey, SdsCurveRoiHorizon & { source?: string; bin?: number; r?: number | null; weight_supernova?: number }>
  >;
  profile_used?: string;
  sds_input?: number;
};

export function formatCorrelationTooltip(
  est: SdsCorrelationEstimate | null | undefined,
  label: string,
  hk: SdsCurveRoiHorizonKey,
): string | undefined {
  const h = est?.horizons?.[hk];
  if (!h) return undefined;
  if (h.source === "anchor_blend") {
    const w = h.weight_supernova != null ? ` w=${(h.weight_supernova * 100).toFixed(0)}%→SN` : "";
    return `${label} stimato SDS↔ROI: ${h.pct_vs_m60}% vs T−60 (neutro→cl.1${w})`;
  }
  const src = h.source === "quintile_median" ? `bin Q${h.bin ?? "?"}` : `r=${h.r ?? "?"}`;
  return `${label} stimato SDS↔ROI: ${h.pct_vs_m60}% vs T−60 (${src}, profilo ${est?.profile_used})`;
}
