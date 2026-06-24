import { supernovaOffsetLabel } from "./sdsHistoryCurve";

/** Calendar anchors on the CD timeline (days vs Completion Date). */
export const CD_PATTERN_ANCHORS = [-60, -30, -10, -7, -3, 4] as const;

export type CdPatternWindowId = "w1" | "w2" | "w3" | "w4" | "w5";

export type CdPatternWindow = {
  id: CdPatternWindowId;
  /** Inclusive start offset (e.g. −60). */
  startOffset: number;
  /** Exclusive end, except w5 includes +4. */
  endOffset: number;
  label: string;
  arcLabel: string;
  raMin: number;
  sdsMin: number;
  slope20Min: number;
  miiAngleMin: number;
  calibMin: number;
};

/** Fixed invest thresholds per pre-CD arc (target polygon = 100 on each axis). */
export const CD_PATTERN_WINDOWS: readonly CdPatternWindow[] = [
  {
    id: "w1",
    startOffset: -60,
    endOffset: -30,
    label: "T−60 → T−30",
    arcLabel: "Watch · preparazione",
    raMin: 40,
    sdsMin: 45,
    slope20Min: 0,
    miiAngleMin: 0,
    calibMin: 40,
  },
  {
    id: "w2",
    startOffset: -30,
    endOffset: -10,
    label: "T−30 → T−10",
    arcLabel: "Pre-hot · avvicinamento",
    raMin: 48,
    sdsMin: 50,
    slope20Min: 0,
    miiAngleMin: 3,
    calibMin: 50,
  },
  {
    id: "w3",
    startOffset: -10,
    endOffset: -7,
    label: "T−10 → T−7",
    arcLabel: "Hot · ingresso primario",
    raMin: 52,
    sdsMin: 55,
    slope20Min: 0.05,
    miiAngleMin: 5,
    calibMin: 55,
  },
  {
    id: "w4",
    startOffset: -7,
    endOffset: -3,
    label: "T−7 → T−3",
    arcLabel: "Hot stretta",
    raMin: 55,
    sdsMin: 60,
    slope20Min: 0.1,
    miiAngleMin: 8,
    calibMin: 60,
  },
  {
    id: "w5",
    startOffset: -3,
    endOffset: 4,
    label: "T−3 → T+4",
    arcLabel: "Imminente · readout",
    raMin: 55,
    sdsMin: 65,
    slope20Min: 0.1,
    miiAngleMin: 10,
    calibMin: 65,
  },
] as const;

export const CD_PATTERN_RADAR_TARGET = [100, 100, 100, 100, 100] as const;

export type CdPatternRadarAxisId = "ra" | "sds" | "mii" | "calib" | "slope";

export const CD_PATTERN_RADAR_AXIS_ORDER: readonly CdPatternRadarAxisId[] = [
  "ra",
  "sds",
  "mii",
  "calib",
  "slope",
] as const;

/** EIS feed impact moderation by days-before-CD at event (aligned with EIS temporal buckets). */
export const EIS_CD_DISTANCE_FACTORS: readonly { lo: number; hi: number; label: string; factor: number }[] = [
  { lo: 0, hi: 30, label: "0–30d pre-CD", factor: 1.0 },
  { lo: 31, hi: 60, label: "31–60d pre-CD", factor: 0.85 },
  { lo: 61, hi: 90, label: "61–90d pre-CD", factor: 0.7 },
  { lo: 91, hi: 180, label: "91–180d pre-CD", factor: 0.55 },
  { lo: 181, hi: 9999, label: "180d+ pre-CD", factor: 0.4 },
];

export function eisCdDistanceFactor(daysBeforeCd: number | null): { label: string; factor: number } {
  if (daysBeforeCd == null || !Number.isFinite(daysBeforeCd) || daysBeforeCd < 0) {
    return { label: "post-CD / n.d.", factor: 0.5 };
  }
  const d = Math.round(daysBeforeCd);
  for (const row of EIS_CD_DISTANCE_FACTORS) {
    if (d >= row.lo && d <= row.hi) return { label: row.label, factor: row.factor };
  }
  return { label: "180d+ pre-CD", factor: 0.4 };
}

export function resolveCdPatternWindow(nowOffset: number | null, daysToCd?: number | null): CdPatternWindow | null {
  let off = nowOffset;
  if (off == null && daysToCd != null && Number.isFinite(daysToCd)) {
    off = daysToCd > 0 ? -daysToCd : daysToCd;
  }
  if (off == null || !Number.isFinite(off)) return null;

  for (const w of CD_PATTERN_WINDOWS) {
    if (w.id === "w5") {
      if (off >= w.startOffset && off <= w.endOffset) return w;
      continue;
    }
    if (off >= w.startOffset && off < w.endOffset) return w;
  }
  if (off < CD_PATTERN_WINDOWS[0]!.startOffset) return CD_PATTERN_WINDOWS[0]!;
  return null;
}

export function windowAnchorLabel(offset: number): string {
  return supernovaOffsetLabel(offset);
}
