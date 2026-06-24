import type { SdsCohortRow } from "./api";
import type { MobileCurveChartsPayload } from "./dashboardTypes";
import {
  assessmentChartOffsetsForNow,
  curveValuesVsToday,
  supernovaOffsetLabel,
  transformBlendVsToday,
} from "./mobileChartCalendar";
import { recalibPredValuesAtCalendarOffsets } from "./mobileRecalibPath";
import {
  blendCurveFromSimChart,
  guideCurvesToRefMap,
  type GuideCurvePoint,
  type MacroGroupId,
  type SdsRoiClusterContext,
  type SdsRoiProfileId,
} from "./mobileSdsRoiBlend";
import type { ChartBundle, ChartPoint } from "./types";

function normalizeRefLabel(label: string): string {
  return label.trim().toLowerCase().replace(/^μ\s+/, "").replace(/\s+/g, " ");
}

function macroGroupFromRefLabel(label: string, sid: string): MacroGroupId | undefined {
  const norm = normalizeRefLabel(label);
  const sidNorm = normalizeRefLabel(sid.replace(/^ref:/, ""));

  if (norm.includes("globale") || norm.includes("primaria") || sidNorm.includes("primary")) {
    return "globale";
  }
  if (norm.includes("post-cd") && norm.includes("rialzo")) return "post_rialzo";
  if (norm.includes("post-cd") && norm.includes("ribasso")) return "post_ribasso";
  if (norm.includes("post-cd") && norm.includes("neutro")) return "post_neutro";
  if (norm.includes("supernova") || norm.includes("cl.1") || norm.includes("cluster 1")) {
    return "cluster1";
  }
  if (norm.includes("cluster 0") || norm.includes("cluster0")) return "cluster0";
  return undefined;
}

function seriesToGuidePoints(
  points: ChartPoint[] | undefined,
  offsets: readonly number[],
): GuideCurvePoint[] {
  return offsets.map((off) => {
    const pt = (points ?? []).find((p) => p.offset === off);
    const v = pt?.pct_curva ?? pt?.pct_reale ?? pt?.pct_modello ?? pt?.pct_foglio ?? null;
    return {
      offset: off,
      xLabel: off > 0 ? `+${off}` : String(off),
      meanPct: v != null && v === v ? Number(v) : null,
      n: v != null ? 1 : 0,
    };
  });
}

export function refCurvesFromChartBundle(bundle: ChartBundle | null): {
  refs: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
  source: string;
} {
  if (!bundle?.series) return { refs: guideCurvesToRefMap({}), source: "" };
  const out: Partial<Record<MacroGroupId, GuideCurvePoint[]>> = {};
  let n = 0;
  const offsets = [-60, -30, -10, -7, -5, -3, 4, 7] as const;

  for (const [sid, meta] of Object.entries(bundle.series)) {
    const kind = (meta as { kind?: string }).kind;
    if (kind !== "control") continue;
    const label = (meta as { label?: string }).label || sid.replace(/^ref:/, "");
    const gid = macroGroupFromRefLabel(label, sid);
    if (!gid || gid === "globale") continue;
    const points = seriesToGuidePoints(meta.points, offsets);
    if (points.some((p) => p.meanPct != null)) {
      out[gid] = points;
      n += 1;
    }
  }

  return {
    refs: guideCurvesToRefMap(out),
    source: n > 0 ? `simulation_charts (${n} μ)` : "",
  };
}

function sdsBlendContext(sdsRow: SdsCohortRow | null, daysToCd: number | null): SdsRoiClusterContext {
  if (!sdsRow) return { days_to_cd: daysToCd };
  const row = sdsRow as SdsCohortRow & SdsRoiClusterContext;
  return {
    sds: sdsRow.sds,
    days_to_cd: row.days_to_cd ?? daysToCd,
    cluster_scores: row.cluster_scores,
    cluster_a: row.cluster_a,
    cluster_b: row.cluster_b,
    cluster_c: row.cluster_c,
    cluster_d: row.cluster_d,
  };
}

export function predBlendQuality(
  pb: MobileCurveChartsPayload["predBlend"],
): number {
  if (!pb?.length) return 0;
  const modelPts = pb.filter((p) => p.model != null).length;
  const blendPts = pb.filter((p) => p.blend != null).length;
  return modelPts + blendPts * 3;
}

export function buildMobilePredBlend(opts: {
  row: Record<string, unknown>;
  chartPts: ChartPoint[];
  nowOff: number | null;
  daysToCd: number | null;
  sdsRow: SdsCohortRow | null;
  refCurves: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
  lang?: "it" | "en";
}): {
  predBlend: MobileCurveChartsPayload["predBlend"];
  predCaption: string | null;
} {
  const { row, chartPts, nowOff, daysToCd, sdsRow, refCurves } = opts;
  const it = opts.lang !== "en";

  if (!chartPts.length) return { predBlend: null, predCaption: null };

  const offsets = assessmentChartOffsetsForNow(nowOff);
  const rawModel = recalibPredValuesAtCalendarOffsets(chartPts, row, {
    extendedPostCd: true,
    nowOffset: nowOff,
    offsets,
  });
  if (!rawModel) return { predBlend: null, predCaption: null };

  const modelValues =
    nowOff != null
      ? curveValuesVsToday(rawModel, nowOff, offsets)
      : rawModel.map((v) => (v != null && Number.isFinite(v) ? v : 0));

  let blendValues: (number | null)[] | null = null;
  if (Object.keys(refCurves).length > 0) {
    const rawBlend = blendCurveFromSimChart(chartPts, row, refCurves, sdsBlendContext(sdsRow, daysToCd), {
      extendedPostCd: true,
      nowOffset: nowOff,
      offsets,
    });
    blendValues = rawBlend && nowOff != null ? transformBlendVsToday(rawBlend, nowOff) : rawBlend;
  }

  const predBlend = offsets.map((offset, i) => ({
    offset,
    label: supernovaOffsetLabel(offset),
    model: modelValues[i] ?? null,
    blend: blendValues?.[i] ?? null,
  }));

  const todayLabel = nowOff != null ? supernovaOffsetLabel(nowOff) : "";
  const hasBlend = blendValues?.some((v) => v != null);
  const predCaption = hasBlend
    ? `${it ? "Modello + blend SDS" : "Model + SDS blend"} · ${todayLabel}`
    : `${it ? "Modello + ricalib." : "Model + recalib."} · ${todayLabel}`;

  return { predBlend, predCaption };
}
