import type { ChartPoint } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import {
  recalibPredValuesAtCalendarOffsets,
  roundPredPct,
  assessmentChartOffsetsForNow,
  PREDICTION_CALENDAR_OFFSETS,
} from "./predictionCurveGrid";
import { calendarOffsetsForValueCount } from "./chartNodes";
import { SUPERNova_OFFSETS, supernovaOffsetLabel } from "./sdsHistoryCurve";

const OVERLAY_PALETTE = [
  "#6366f1",
  "#f97316",
  "#14b8a6",
  "#a855f7",
  "#0ea5e9",
  "#eab308",
  "#ec4899",
] as const;

export type SdsOverlayCurve = {
  ticker: string;
  color: string;
  /** % vs T−60 at each calendar knot */
  values: number[];
  /** Calendar offset per value (when grid extends before T−60). */
  offsets?: readonly number[];
  peakRoi: number;
  /** Calendar offset (days vs CD) where peakRoi occurs. */
  peakOffset: number;
  /** peak = rise from today · cd_outlook = expected % at CD vs today (often negative). */
  peakKind: "peak" | "cd_outlook" | "anchor";
};

/** SDS-calibrated μ blend sampled on the same calendar grid as the ticker overlay. */
export type SdsBlendOverlayCurve = {
  ticker: string;
  /** Tint derived from the parent ticker overlay color. */
  color: string;
  values: (number | null)[];
  offsets?: readonly number[];
};

/** Prediction + recalibration path (% vs T−60) sampled on SuperNova calendar knots. */
export function recalibCurveVsM60(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  extendedPostCd = false,
  nowOffset?: number | null,
): (number | null)[] | null {
  return recalibPredValuesAtCalendarOffsets(chartPoints, simRow, {
    extendedPostCd,
    nowOffset,
  });
}

export function peakRoiPct(values: number[], nowOffset?: number | null): number {
  const offsets = calendarOffsetsForValueCount(values.length);
  return peakRoiWithOffset(values, offsets, nowOffset).peakRoi;
}

/**
 * Peak on the forward path from «today» (vs T−60 at today).
 * Avoids misleading «peak 0% @ T−60» when the curve only declines after the anchor.
 */
export function peakRoiWithOffset(
  values: number[],
  offsets: readonly number[] = SUPERNova_OFFSETS,
  nowOffset?: number | null,
): { peakRoi: number; peakOffset: number; kind: "peak" | "cd_outlook" | "anchor" } {
  if (!values.length) {
    return { peakRoi: 0, peakOffset: offsets[0] ?? -60, kind: "anchor" };
  }

  const series = offsets.map((offset, i) => ({ offset, y: values[i] ?? 0 }));

  if (nowOffset != null && Number.isFinite(nowOffset) && nowOffset < 0) {
    const atNow = interpolateAtOffset(series, nowOffset);
    if (atNow != null) {
      const forward = series.filter((p) => p.offset >= nowOffset - 0.01);
      if (forward.length >= 2) {
        let maxRel = Number.NEGATIVE_INFINITY;
        let maxOff = nowOffset;
        let endRel = 0;
        let endOff = forward[forward.length - 1]?.offset ?? 0;
        for (const p of forward) {
          const rel = roundPredPct(p.y - atNow);
          if (rel > maxRel) {
            maxRel = rel;
            maxOff = p.offset;
          }
          endRel = rel;
          endOff = p.offset;
        }
        if (maxRel > 0.08) {
          return { peakRoi: maxRel, peakOffset: maxOff, kind: "peak" };
        }
        if (endRel < -0.08) {
          return { peakRoi: endRel, peakOffset: endOff, kind: "cd_outlook" };
        }
        return { peakRoi: Math.max(0, maxRel), peakOffset: maxOff, kind: "anchor" };
      }
    }
  }

  let max = Number.NEGATIVE_INFINITY;
  let idx = 0;
  values.forEach((v, i) => {
    if (v > max) {
      max = v;
      idx = i;
    }
  });
  const lastIdx = values.length - 1;
  const last = values[lastIdx] ?? 0;
  if (idx === 0 && max <= 0.01 && last < -0.08) {
    return {
      peakRoi: last,
      peakOffset: offsets[lastIdx] ?? offsets[0] ?? -60,
      kind: "cd_outlook",
    };
  }
  return {
    peakRoi: max,
    peakOffset: offsets[idx] ?? offsets[0] ?? -60,
    kind: max <= 0.01 && idx === 0 ? "anchor" : "peak",
  };
}

/** Avoid showing +0.0% when peak ROI is small but non-zero (e.g. 0.76 → 0.8, 0.07 → 0.07). */
export function formatEstRoiPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.0";
  const abs = Math.abs(value);
  const digits = abs < 0.05 ? 2 : abs < 10 ? 1 : 0;
  return value.toFixed(digits);
}

export function formatEstRoiSigned(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const body = formatEstRoiPct(value);
  if (body === "—") return body;
  const n = Number(body);
  if (n > 0) return `+${body}`;
  if (n < 0) return body;
  return body;
}

export function formatSdsPeakChipPct(value: number, kind: SdsOverlayCurve["peakKind"]): string {
  const body = formatEstRoiPct(Math.abs(value));
  if (kind === "cd_outlook") return body;
  return formatEstRoiSigned(value).replace(/^\+/, "");
}

/** Chip / legend label — distinguishes absolute level vs forward move from today. */
export function formatOverlayPeakLabel(
  peakRoi: number,
  peakOffset: number,
  kind: SdsOverlayCurve["peakKind"],
  lang: "it" | "en" = "it",
): string {
  const off = supernovaOffsetLabel(peakOffset);
  const pct = formatEstRoiSigned(peakRoi);
  if (kind === "cd_outlook") {
    return lang === "it"
      ? `Outlook CD ${pct} da oggi @ ${off}`
      : `CD outlook ${pct} from today @ ${off}`;
  }
  if (kind === "peak") {
    return lang === "it"
      ? `Rialzo max ${pct} da oggi @ ${off}`
      : `Max rise ${pct} from today @ ${off}`;
  }
  return lang === "it" ? `Neutro ${pct} @ ${off}` : `Neutral ${pct} @ ${off}`;
}

export function overlayColorForIndex(i: number): string {
  return OVERLAY_PALETTE[i % OVERLAY_PALETTE.length];
}

/** Violet tint for the SDS μ blend line paired with a ticker overlay. */
export function blendOverlayColor(parentColor: string): string {
  const map: Record<string, string> = {
    "#6366f1": "#a78bfa",
    "#f97316": "#fb923c",
    "#14b8a6": "#5eead4",
    "#a855f7": "#d8b4fe",
    "#0ea5e9": "#7dd3fc",
    "#eab308": "#fde047",
    "#ec4899": "#f9a8d4",
  };
  return map[parentColor] ?? "#a78bfa";
}

export function buildOverlayCurve(
  ticker: string,
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  colorIndex: number,
  options?: { extendedPostCd?: boolean },
): SdsOverlayCurve | null {
  const extended = options?.extendedPostCd ?? false;
  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  const offsets = extended
    ? assessmentChartOffsetsForNow(nowOff)
    : PREDICTION_CALENDAR_OFFSETS;
  const raw = recalibPredValuesAtCalendarOffsets(chartPoints, simRow, {
    extendedPostCd: extended,
    nowOffset: nowOff,
    offsets,
  });
  if (!raw) return null;
  const values = raw.map((v) => (v != null && Number.isFinite(v) ? v : 0));
  const { peakRoi, peakOffset, kind } = peakRoiWithOffset(values, offsets, nowOff);
  return {
    ticker: ticker.toUpperCase(),
    color: overlayColorForIndex(colorIndex),
    values,
    offsets,
    peakRoi,
    peakOffset,
    peakKind: kind,
  };
}
