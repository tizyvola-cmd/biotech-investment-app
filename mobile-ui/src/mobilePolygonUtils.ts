import type { MobileCurveChartsPayload } from "./dashboardTypes";
import type { MobileMigEstimate } from "./mobileMiiEstimate";
import { parseNum, parseRaScoreFromRow } from "./simLogic";

const AXIS_LABELS = ["RA score", "SDS", "MII °", "Calib pre", "Slope 20g"] as const;

function parseThreshold(targetText: string): number {
  const m = String(targetText ?? "").match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function axisPct(value: number | null, min: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (min <= 0) return value >= 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((value / min) * 100)));
}

function fmtAxisValue(value: number, axisIndex: number): string {
  const dec = axisIndex === 2 || axisIndex === 4 ? 2 : 0;
  const units = ["/100", "/100", "°", "/100", " pp/g"];
  const unit = units[axisIndex] ?? "";
  if (axisIndex === 4) return `${value.toFixed(dec)} pp/g`;
  return `${value.toFixed(dec)}${unit}`;
}

export function countFilledPolygonAxes(
  polygon: MobileCurveChartsPayload["polygon"] | null | undefined,
): number {
  if (!polygon?.axes?.length) return 0;
  return polygon.axes.filter((a) => a.currentText && a.currentText !== "—").length;
}

export function polygonQualityScore(
  polygon: MobileCurveChartsPayload["polygon"] | null | undefined,
  source: "snapshot" | "local" = "local",
): number {
  if (!polygon?.radarCurrent?.length) return -1;
  const filled = countFilledPolygonAxes(polygon);
  const match = polygon.matchPct ?? 0;
  let score = filled * 1000 + match;
  if (source === "snapshot") score += 100;
  if (source === "local" && filled < 3) score -= 800;
  return score;
}

/** Prefer desktop snapshot values axis-by-axis (RA as-of CD anchor, SDS, MII, …). */
export function mergePolygonWithSnapshot(
  primary: NonNullable<MobileCurveChartsPayload["polygon"]>,
  snapshot: MobileCurveChartsPayload["polygon"] | null | undefined,
): NonNullable<MobileCurveChartsPayload["polygon"]> {
  if (!snapshot?.axes?.length) return primary;

  const labels = primary.labels?.length ? primary.labels : snapshot.labels;
  const n = labels.length;
  const radarTarget =
    primary.radarTarget?.length === n
      ? primary.radarTarget
      : snapshot.radarTarget?.length === n
        ? snapshot.radarTarget
        : labels.map(() => 100);

  const axes = labels.map((label, i) => {
    const snapAx = snapshot.axes?.[i];
    const primAx = primary.axes?.[i];
    const snapHas = snapAx?.currentText && snapAx.currentText !== "—";
    if (snapHas && snapAx) {
      return {
        label,
        currentText: snapAx.currentText,
        targetText: snapAx.targetText ?? primAx?.targetText ?? `${radarTarget[i]}/100`,
      };
    }
    return {
      label,
      currentText: primAx?.currentText ?? "—",
      targetText: primAx?.targetText ?? snapAx?.targetText ?? `${radarTarget[i]}/100`,
    };
  });

  const radarCurrent = axes.map((ax, i) => {
    if (!ax.currentText || ax.currentText === "—") return 0;
    const fromSnap = snapshot.radarCurrent[i];
    const fromPrim = primary.radarCurrent[i];
    const snapHad = snapshot.axes?.[i]?.currentText && snapshot.axes[i].currentText !== "—";
    const v = snapHad ? fromSnap : fromPrim;
    return v != null && Number.isFinite(v) ? v : 0;
  });

  const matchPct = recalcPolygonMatch({ ...primary, axes, radarCurrent });
  const verdict =
    matchPct >= 85 ? "Strong" : matchPct >= 65 ? "Watch" : matchPct >= 45 ? "Weak" : "Blocked";

  return {
    ...primary,
    labels,
    radarTarget,
    radarCurrent,
    matchPct,
    verdictLabel: verdict,
    arcPositionLabel: snapshot.arcPositionLabel || primary.arcPositionLabel,
    segmentLabel: snapshot.segmentLabel || primary.segmentLabel,
    axes,
  };
}

export function recalcPolygonMatch(polygon: NonNullable<MobileCurveChartsPayload["polygon"]>): number {
  const filled = (polygon.axes ?? []).map((ax, i) => {
    if (!ax.currentText || ax.currentText === "—") return null;
    const v = polygon.radarCurrent[i];
    return v != null && Number.isFinite(v) ? v : null;
  }).filter((v): v is number => v != null);
  if (!filled.length) return 0;
  return Math.round(filled.reduce((s, v) => s + v, 0) / filled.length);
}

export function inferSlopesFromPredGrid(row: Record<string, unknown>): {
  slope5d: number | null;
  slope20d: number | null;
} {
  const pts: { d: number; pct: number }[] = [];
  for (const [key, val] of Object.entries(row)) {
    const k = key.replace(/\s+/g, " ");
    if (!/pred/i.test(k)) continue;
    const m = k.match(/([−+-]?\d+)\s*$/);
    if (!m) continue;
    const d = Number(m[1].replace("−", "-").replace("+", ""));
    if (!Number.isFinite(d)) continue;
    const num = parseNum(val);
    if (num == null) continue;
    const pct = Math.abs(num) <= 1.5 ? num * 100 : num;
    pts.push({ d, pct });
  }
  if (pts.length < 2) return { slope5d: null, slope20d: null };
  pts.sort((a, b) => a.d - b.d);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const slopeBetween = (d1: number, d2: number): number | null => {
    const p1 = pts.find((p) => p.d === d1);
    const p2 = pts.find((p) => p.d === d2);
    if (!p1 || !p2 || d2 === d1) return null;
    return round2((p2.pct - p1.pct) / (d2 - d1));
  };
  return {
    slope5d: slopeBetween(-7, -3) ?? slopeBetween(-10, -5) ?? slopeBetween(-5, -3),
    slope20d: slopeBetween(-30, -10) ?? slopeBetween(-30, -7) ?? slopeBetween(-10, -3),
  };
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function rawValuesFromRow(
  row: Record<string, unknown>,
  marketModel?: MobileCurveChartsPayload["marketModel"],
  sdsScore?: number | null,
  mig?: MobileMigEstimate | null,
): {
  ra: number | null;
  sds: number | null;
  mii: number | null;
  calib: number | null;
  slope20: number | null;
} {
  const inferred = inferSlopesFromPredGrid(row);
  return {
    ra: parseRaScoreFromRow(row),
    sds:
      sdsScore ??
      parseNum(findCol(row, "sds score", "sds tot", "supernova distance", "distance score", "sds ")) ??
      parseNum(findCol(row, "sds")),
    mii:
      mig?.miiDeg ??
      marketModel?.miiDeg ??
      parseNum(findCol(row, "mii °", "mii angle", "angolo mii", "angolo mii mercato", "market interest", "mii")) ??
      parseNum(findCol(row, "slope angle", "inclinometro")),
    calib:
      mig?.calibPreScore ??
      parseNum(findCol(row, "calib pre", "calib pre≈mii", "calibrazione pre", "calib pre score", "solidità calib")) ??
      parseNum(findCol(row, "calibrazione", "calib")),
    slope20:
      parseNum(findCol(row, "slope≈20", "slope_20", "slope20", "pendenza 20", "slope 20")) ??
      inferred.slope20d,
  };
}

/** Fill missing polygon axes from row / chart payload; use null radar points for missing data. */
export function enrichPolygonFromContext(
  polygon: NonNullable<MobileCurveChartsPayload["polygon"]>,
  ctx: {
    row?: Record<string, unknown> | null;
    marketModel?: MobileCurveChartsPayload["marketModel"] | null;
    slope20d?: number | null;
    sdsScore?: number | null;
    mig?: MobileMigEstimate | null;
  },
): NonNullable<MobileCurveChartsPayload["polygon"]> {
  const row = ctx.row ?? null;
  const extras = row
    ? rawValuesFromRow(row, ctx.marketModel ?? undefined, ctx.sdsScore, ctx.mig)
    : null;
  const slope20Extra = ctx.slope20d ?? extras?.slope20 ?? null;

  const labelToRaw: Record<string, number | null | undefined> = {
    "RA score": extras?.ra,
    SDS: extras?.sds,
    "MII °": extras?.mii ?? ctx.marketModel?.miiDeg,
    "Calib pre": extras?.calib,
    "Slope 20g": slope20Extra,
  };

  const labels = polygon.labels?.length ? polygon.labels : [...AXIS_LABELS];
  const radarTarget = polygon.radarTarget?.length
    ? polygon.radarTarget
    : labels.map(() => 100);

  const axes = labels.map((label, i) => {
    const prev = polygon.axes?.[i];
    const targetText = prev?.targetText ?? `${parseThreshold(String(radarTarget[i] ?? 100))}/100`;
    const min = parseThreshold(targetText);

    if (prev?.currentText && prev.currentText !== "—") {
      const pct = polygon.radarCurrent[i];
      return {
        label,
        currentText: prev.currentText,
        targetText,
        _pct: pct != null && Number.isFinite(pct) ? pct : null,
      };
    }

    const fill = labelToRaw[label];
    if (fill == null || !Number.isFinite(fill)) {
      return { label, currentText: "—", targetText, _pct: null };
    }
    return {
      label,
      currentText: fmtAxisValue(fill, i),
      targetText,
      _pct: axisPct(fill, min),
    };
  });

  const radarCurrent = axes.map((a) => a._pct ?? 0);
  const matchPct = recalcPolygonMatch({ ...polygon, radarCurrent });
  const verdict =
    matchPct >= 85 ? "Strong" : matchPct >= 65 ? "Watch" : matchPct >= 45 ? "Weak" : "Blocked";

  return {
    ...polygon,
    labels,
    radarCurrent,
    radarTarget,
    matchPct,
    verdictLabel: verdict,
    axes: axes.map(({ label, currentText, targetText }) => ({ label, currentText, targetText })),
  };
}

export function radarSeriesForChart(
  polygon: NonNullable<MobileCurveChartsPayload["polygon"]>,
): (number | null)[] {
  return (polygon.axes ?? []).map((ax, i) => {
    if (!ax.currentText || ax.currentText === "—") return null;
    const v = polygon.radarCurrent[i];
    return v != null && Number.isFinite(v) ? v : null;
  });
}
