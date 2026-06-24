/**
 * Picco forward sulla curva pred+ricalib. — uscita al plateau/discesa, non al CD.
 * Port semplificato di desktop forwardRiseSegmentPeak.
 */
import { completionDateToNowOffset, extractRecalibCurvePoints } from "./mobileRecalibCurve";
import { interpolateSeriesAtOffset, roundPredPct } from "./mobileChartCalendar";
import type { ChartPoint } from "./types";

export type CurvePeakPoint = { offset: number; best: number };

const DEFAULT_CAPITAL_EUR = 5000;

function bestPct(p: ChartPoint): number | null {
  const v = p.pct_foglio ?? p.pct_curva ?? p.pct_modello;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function denseCurvePoints(
  row: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null,
  fallbackSheet?: Array<{ offset: number; val: number }>,
): CurvePeakPoint[] {
  const byOff = new Map<number, number>();

  for (const p of chartPoints ?? []) {
    const y = bestPct(p);
    if (y != null) byOff.set(p.offset, roundPredPct(y));
  }

  const sheet = fallbackSheet ?? extractRecalibCurvePoints(row);
  for (const p of sheet) {
    if (!byOff.has(p.offset)) byOff.set(p.offset, roundPredPct(p.val));
  }

  return [...byOff.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, best]) => ({ offset, best }));
}

/**
 * Primo picco/plateau/discesa dopo «oggi» — non estende al CD se la curva scende prima.
 */
export function forwardRiseSegmentPeak(
  row: Record<string, unknown>,
  dense: CurvePeakPoint[],
  flatThrPpPerDay = 0.05,
): { days: number; returnPct: number } | null {
  if (dense.length < 2) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;

  const series = dense.map((p) => ({ offset: p.offset, y: p.best }));
  const atNow = interpolateSeriesAtOffset(series, nowOff);
  if (atNow == null) return null;

  const forward = dense
    .filter((p) => p.offset > nowOff && p.offset <= 0)
    .sort((a, b) => a.offset - b.offset);
  if (!forward.length) return null;

  const minRisePp = Math.max(flatThrPpPerDay * 3, 0.12);
  const plateauEps = Math.max(flatThrPpPerDay * 2, 0.08);

  let peakOff = nowOff;
  let peakY = atNow;
  let prevOff = nowOff;
  let prevY = atNow;
  let consecutiveFlat = 0;

  for (const p of forward) {
    const dOff = p.offset - prevOff;
    if (dOff <= 0) continue;
    const segSlope = (p.best - prevY) / dOff;

    if (p.best > peakY + 0.02) {
      peakY = p.best;
      peakOff = p.offset;
      consecutiveFlat = 0;
    } else if (segSlope <= flatThrPpPerDay) {
      consecutiveFlat += 1;
      if (
        consecutiveFlat >= 1 &&
        peakY - atNow >= minRisePp &&
        Math.abs(p.best - peakY) <= plateauEps
      ) {
        break;
      }
    } else if (segSlope < -flatThrPpPerDay && peakY - atNow >= minRisePp) {
      break;
    } else {
      consecutiveFlat = 0;
    }

    prevOff = p.offset;
    prevY = p.best;
  }

  const returnPct = Math.round((peakY - atNow) * 100) / 100;
  const days = Math.max(0, Math.round(peakOff - nowOff));
  if (returnPct <= 0.05) return null;
  return { days: Math.max(1, days), returnPct };
}

export type MobileGainIdea = {
  gainEur: number | null;
  returnPct: number | null;
  days: number | null;
  source: "curve_peak" | "plan_target" | "none";
};

export function computeMobileGainIdea(opts: {
  row: Record<string, unknown> | null | undefined;
  chartPoints?: ChartPoint[] | null;
  curvePoints?: Array<{ offset: number; val: number }>;
  capitalEur?: number;
  planReturnPct?: number | null;
  daysToTarget?: number | null;
  existingGainText?: string | null;
}): MobileGainIdea {
  const capital =
    opts.capitalEur != null && opts.capitalEur > 0 ? opts.capitalEur : DEFAULT_CAPITAL_EUR;

  if (opts.row) {
    const dense = denseCurvePoints(opts.row, opts.chartPoints, opts.curvePoints);
    const peak = forwardRiseSegmentPeak(opts.row, dense);
    if (peak && peak.returnPct > 0) {
      return {
        gainEur: Math.round((capital * peak.returnPct) / 100),
        returnPct: peak.returnPct,
        days: peak.days,
        source: "curve_peak",
      };
    }
  }

  const ret = opts.planReturnPct;
  const days = opts.daysToTarget;
  if (ret != null && ret > 0 && days != null && days > 0) {
    return {
      gainEur: Math.round((capital * ret) / 100),
      returnPct: ret,
      days,
      source: "plan_target",
    };
  }

  return { gainEur: null, returnPct: null, days: null, source: "none" };
}

export function formatMobileGainIdeaShort(idea: MobileGainIdea, lang: "it" | "en" = "it"): string | null {
  if (idea.gainEur == null || idea.days == null || idea.gainEur <= 0) return null;
  const eur = idea.gainEur >= 0 ? `+€${idea.gainEur}` : `€${idea.gainEur}`;
  return lang === "it" ? `${eur} in ${idea.days}g` : `${eur} in ${idea.days}d`;
}
