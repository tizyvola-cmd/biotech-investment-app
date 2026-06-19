import type { ChartPoint } from "./types";
import { parseNum } from "./simLogic";
import type { SdsCohortRow } from "./api";

const NORM = 15;
const LOW_VOL = 0.8;
const CALIB_MAX_GAP = 28;
const CALIB_ALIGNED = 8;
const CALIB_DRIFT = 18;
const CALIB_CONTRARIAN_MIN = 5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function readDeltaPricePct5d(row: Record<string, unknown>): number {
  const daily =
    parseNum(row["Var. Giorn. %"]) ??
    parseNum(row["Var. Giorn.%"]) ??
    parseNum(findCol(row, "var.", "giorn"));
  const var1m = parseNum(row["Var. 1M %"]) ?? parseNum(findCol(row, "var.", "1m"));

  if (var1m != null) return round2((var1m * 5) / 22);
  if (daily != null) return round2(daily * 5);

  const slope5 = parseNum(findCol(row, "slope≈5", "slope5", "slope_5"));
  if (slope5 != null) return round2(slope5 * 5);

  return 0;
}

function volRatioFromSdsRow(sds: SdsCohortRow | null | undefined): number {
  const vr = sds?.cluster_c?.volume_ratio;
  const fromComp =
    vr?.ratio_5d_vs_20d ??
    (vr?.avg_volume_5d != null &&
    vr?.avg_volume_20d != null &&
    vr.avg_volume_20d > 0
      ? vr.avg_volume_5d / vr.avg_volume_20d
      : null);
  if (fromComp != null && Number.isFinite(fromComp) && fromComp > 0) return round2(fromComp);
  return 1;
}

function computeMiiRaw(deltaPricePct: number, volRatio: number): { raw: number; lowVolumePenalty: boolean } {
  const vr = Math.max(0, volRatio);
  let lowVolumePenalty = false;
  let raw = deltaPricePct * Math.log(vr + 1) * Math.sqrt(vr);
  if (deltaPricePct > 0 && vr < LOW_VOL) {
    raw *= 0.55;
    lowVolumePenalty = true;
  }
  return { raw: round4(raw), lowVolumePenalty };
}

function slopeAngleFromMiiRaw(miiRaw: number): number {
  if (!Number.isFinite(miiRaw)) return 0;
  return round2((Math.atan(miiRaw / NORM) * 180) / Math.PI);
}

function slopeAngleFromDeltaAndVol(deltaPricePct: number, volRatio: number): number {
  const { raw } = computeMiiRaw(deltaPricePct, volRatio);
  return slopeAngleFromMiiRaw(raw);
}

function readPred5PpPerDay(row: Record<string, unknown>, chartPts?: ChartPoint[] | null): number | null {
  if (chartPts?.length) {
    const at0 = chartPts.find((p) => p.offset === 0);
    const at5 = chartPts.find((p) => p.offset === 5);
    const v0 = at0?.pct_foglio ?? at0?.pct_modello ?? at0?.pct_curva;
    const v5 = at5?.pct_foglio ?? at5?.pct_modello ?? at5?.pct_curva;
    if (v0 != null && v5 != null && Number.isFinite(v0) && Number.isFinite(v5)) {
      return round2((v5 - v0) / 5);
    }
  }
  const pred5 =
    parseNum(findCol(row, "pred+5", "pred 5", "Δ% pred+5")) ??
    parseNum(findCol(row, "pred", "+5"));
  if (pred5 != null) {
    const pp = Math.abs(pred5) <= 1.5 ? pred5 * 100 : pred5;
    return round2(pp / 5);
  }
  const slope5 = parseNum(findCol(row, "slope≈5", "slope5", "slope_5"));
  return slope5 != null ? round2(slope5) : null;
}

function calibPreScore(
  marketSlopeAngleDeg: number,
  modelSlope5dPpPerDay: number | null,
  volRatio: number,
): number | null {
  if (modelSlope5dPpPerDay == null || !Number.isFinite(modelSlope5dPpPerDay)) return null;
  const modelSlopeAngleDeg = slopeAngleFromDeltaAndVol(modelSlope5dPpPerDay * 5, volRatio);
  const slopeDeltaDeg = round2(marketSlopeAngleDeg - modelSlopeAngleDeg);
  const gapAbs = Math.abs(slopeDeltaDeg);
  const oppositeSign =
    Math.abs(marketSlopeAngleDeg) >= CALIB_CONTRARIAN_MIN &&
    Math.abs(modelSlopeAngleDeg) >= CALIB_CONTRARIAN_MIN &&
    Math.sign(marketSlopeAngleDeg) !== Math.sign(modelSlopeAngleDeg);
  let score = round2(Math.max(0, Math.min(100, 100 - (gapAbs / CALIB_MAX_GAP) * 100)));
  if (oppositeSign) score = Math.min(score, 25);
  if (gapAbs <= CALIB_ALIGNED) score = Math.max(score, 85);
  else if (gapAbs <= CALIB_DRIFT) score = Math.min(score, 70);
  return score;
}

export type MobileMigEstimate = {
  miiDeg: number;
  calibPreScore: number | null;
  modelDeg: number | null;
  volRatio: number;
  deltaPricePct5d: number;
};

/** Desktop-aligned MII ° + Calib pre from Simulation row, SDS volume ratio, optional chart. */
export function estimateMigForRow(
  row: Record<string, unknown>,
  sdsRow?: SdsCohortRow | null,
  chartPts?: ChartPoint[] | null,
): MobileMigEstimate | null {
  const ticker = String(row.Ticker ?? row.ticker ?? "").trim();
  if (!ticker) return null;

  const deltaPricePct5d = readDeltaPricePct5d(row);
  const volRatio = volRatioFromSdsRow(sdsRow);
  const { raw } = computeMiiRaw(deltaPricePct5d, volRatio);
  const miiDeg = slopeAngleFromMiiRaw(raw);
  const modelSlope5d = readPred5PpPerDay(row, chartPts);
  const calibPre = calibPreScore(miiDeg, modelSlope5d, volRatio);
  const modelDeg =
    modelSlope5d != null ? slopeAngleFromDeltaAndVol(modelSlope5d * 5, volRatio) : null;

  return {
    miiDeg,
    calibPreScore: calibPre,
    modelDeg,
    volRatio,
    deltaPricePct5d,
  };
}
