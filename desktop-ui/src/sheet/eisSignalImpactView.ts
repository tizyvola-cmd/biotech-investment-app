import type {
  CurveImpactCumulative,
  EisMagnitudeAnalysisDoc,
  EisRegressionStats,
  EisScatterBundle,
  EisScatterPoint,
  EisTemporalRegressionRow,
  EisTemporalSignSplitRow,
  EisTemporalWindowRow,
} from "../data/signalCalibrationData";
import { buildEisExpectedMoveCurveView, type EisExpectedMoveCurveView } from "./eisExpectedMoveCurve";

export type EisSlopeChartRow = {
  window: string;
  daysMin: number;
  daysMax: number;
  daysMid: number;
  slope1d: number | null;
  slope7d: number | null;
  r1d: number | null;
  r7d: number | null;
  n1d: number;
  n7d: number;
  isPeak: boolean;
};

export type EisSignSplitChartRow = {
  window: string;
  daysMid: number;
  negAvg1d: number | null;
  posAvg1d: number | null;
  negAvg7d: number | null;
  posAvg7d: number | null;
  nNeg1d: number;
  nPos1d: number;
  nNeg7d: number;
  nPos7d: number;
  isPeak: boolean;
};

export type EisMagnitudeView = {
  analysis: EisMagnitudeAnalysisDoc | null;
  hasData: boolean;
  hasPriceData: boolean;
  hasWeekPriceData: boolean;
  slopeChartRows: EisSlopeChartRow[];
  signSplitChartRows: EisSignSplitChartRow[];
  scatter1d: EisScatterBundle | null;
  scatter7d: EisScatterBundle | null;
  peakWindow: EisMagnitudeAnalysisDoc["peak_window"];
  chartsFromSnapshot: boolean;
  chartsNeedLiveApi: boolean;
  scatterIsSynthesized: boolean;
  scatterEventPoints1d: number;
  expectedMoveCurve: EisExpectedMoveCurveView;
};

function asAnalysis(raw: unknown): EisMagnitudeAnalysisDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as EisMagnitudeAnalysisDoc;
  if (doc.error) return doc;
  if ((doc.n_events_scored ?? 0) <= 0) return null;
  return doc;
}

function scatterHasChartData(bundle: EisScatterBundle | null | undefined): boolean {
  if (!bundle) return false;
  return (bundle.points?.length ?? 0) > 0 || (bundle.regression?.line?.length ?? 0) > 0;
}

function scatterPointCount(doc: EisMagnitudeAnalysisDoc | null | undefined): number {
  return (
    (doc?.scatter?.delta_p_1d?.points?.length ?? 0) +
    (doc?.scatter?.delta_p_7d?.points?.length ?? 0)
  );
}

/** Median-split synthesis stores ≤4 anchor points while n_with_price is much larger. */
export function isSynthesizedEisScatter(doc: EisMagnitudeAnalysisDoc | null | undefined): boolean {
  if (!doc) return false;
  const pts = scatterPointCount(doc);
  const n1 = doc.n_with_price_1d ?? doc.correlation?.n_1d ?? 0;
  const n7 = doc.n_with_price_7d ?? doc.correlation?.n_7d ?? 0;
  const cohortN = Math.max(n1, n7);
  if (pts <= 0) return false;
  if (pts <= 4 && cohortN > pts + 5) return true;
  const tickers = new Set(
    [...(doc.scatter?.delta_p_1d?.points ?? []), ...(doc.scatter?.delta_p_7d?.points ?? [])].map(
      (p) => p.ticker,
    ),
  );
  return tickers.has("low EIS") || tickers.has("high EIS") || tickers.has("median");
}

function arrayLen(doc: EisMagnitudeAnalysisDoc | null | undefined, key: "temporal_regression" | "temporal_sign_split"): number {
  return doc?.[key]?.length ?? 0;
}

/** Prefer the source with richer chart payloads (scatter points, temporal rows). */
export function mergeEisMagnitudeAnalysis(
  bundled: EisMagnitudeAnalysisDoc | null | undefined,
  live: EisMagnitudeAnalysisDoc | null | undefined,
): EisMagnitudeAnalysisDoc | null {
  if (!live && !bundled) return null;
  if (!live) return bundled ?? null;
  if (!bundled) return live;

  const merged: EisMagnitudeAnalysisDoc = { ...bundled, ...live };

  const bundledPts = scatterPointCount(bundled);
  const livePts = scatterPointCount(live);
  const bundledSynth = isSynthesizedEisScatter(bundled);
  const liveSynth = isSynthesizedEisScatter(live);

  const pickScatterFrom = (() => {
    if (livePts > bundledPts && !liveSynth) return live;
    if (bundledPts > livePts && !bundledSynth) return bundled;
    if (livePts > 0 && !liveSynth) return live;
    if (bundledPts > 0 && !bundledSynth) return bundled;
    if (scatterHasChartData(live.scatter?.delta_p_1d) || scatterHasChartData(live.scatter?.delta_p_7d)) {
      return live;
    }
    if (scatterHasChartData(bundled.scatter?.delta_p_1d) || scatterHasChartData(bundled.scatter?.delta_p_7d)) {
      return bundled;
    }
    return null;
  })();

  if (pickScatterFrom?.scatter) {
    merged.scatter = { ...bundled.scatter, ...live.scatter, ...pickScatterFrom.scatter };
  }

  const pickTemporal = arrayLen(live, "temporal_regression") >= arrayLen(bundled, "temporal_regression") ? live : bundled;
  if ((pickTemporal.temporal_regression?.length ?? 0) > 0) {
    merged.temporal_regression = pickTemporal.temporal_regression;
  }

  const pickSign = arrayLen(live, "temporal_sign_split") >= arrayLen(bundled, "temporal_sign_split") ? live : bundled;
  if ((pickSign.temporal_sign_split?.length ?? 0) > 0) {
    merged.temporal_sign_split = pickSign.temporal_sign_split;
  }

  const pickCalibration = (live.expected_move_calibration?.horizons?.t1?.line?.length ?? 0)
    >= (bundled.expected_move_calibration?.horizons?.t1?.line?.length ?? 0)
    ? live
    : bundled;
  if (pickCalibration.expected_move_calibration) {
    merged.expected_move_calibration = pickCalibration.expected_move_calibration;
  }

  const liveCorr = live.correlation;
  const bundledCorr = bundled.correlation;
  if (liveCorr || bundledCorr) {
    merged.correlation = { ...bundledCorr, ...liveCorr };
    if ((liveCorr?.regression_1d?.line?.length ?? 0) > 0 || liveCorr?.regression_1d?.slope != null) {
      merged.correlation!.regression_1d = liveCorr!.regression_1d ?? bundledCorr?.regression_1d;
    } else if (bundledCorr?.regression_1d?.line?.length || bundledCorr?.regression_1d?.slope != null) {
      merged.correlation!.regression_1d = bundledCorr.regression_1d;
    }
    if ((liveCorr?.regression_7d?.line?.length ?? 0) > 0 || liveCorr?.regression_7d?.slope != null) {
      merged.correlation!.regression_7d = liveCorr!.regression_7d ?? bundledCorr?.regression_7d;
    } else if (bundledCorr?.regression_7d?.line?.length || bundledCorr?.regression_7d?.slope != null) {
      merged.correlation!.regression_7d = bundledCorr.regression_7d;
    }
  }

  return merged;
}

function linearRegressionFromPoints(
  points: { x: number; y: number }[],
): EisRegressionStats {
  const n = points.length;
  if (n < 3) return { n, slope: null, intercept: null, r: null, line: [] };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  if (sxx < 1e-12) {
    return { n, slope: null, intercept: null, r: null, line: [] };
  }

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const denX = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const denY = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  const r =
    denX > 1e-12 && denY > 1e-12
      ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (denX * denY)
      : null;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const pad = xMax > xMin ? (xMax - xMin) * 0.05 : 0.5;
  const x0 = xMin - pad;
  const x1 = xMax + pad;

  return {
    n,
    slope: Math.round(slope * 10000) / 10000,
    intercept: Math.round(intercept * 10000) / 10000,
    r: r != null ? Math.round(r * 10000) / 10000 : null,
    line: [
      { x: Math.round(x0 * 10000) / 10000, y: Math.round((intercept + slope * x0) * 1000) / 1000 },
      { x: Math.round(x1 * 10000) / 10000, y: Math.round((intercept + slope * x1) * 1000) / 1000 },
    ],
  };
}

function completeRegressionLine(reg: EisRegressionStats): EisRegressionStats {
  if ((reg.line?.length ?? 0) >= 2) return reg;
  if (reg.slope == null || reg.intercept == null) return reg;
  const x0 = -0.8;
  const x1 = 0.8;
  return {
    ...reg,
    line: [
      { x: x0, y: Math.round((reg.intercept + reg.slope * x0) * 1000) / 1000 },
      { x: x1, y: Math.round((reg.intercept + reg.slope * x1) * 1000) / 1000 },
    ],
  };
}

function regressionFromCorrelation(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
  key: "delta_p_1d" | "delta_p_7d",
): EisRegressionStats | null {
  const corr = analysis?.correlation;
  if (!corr) return null;
  const reg = key === "delta_p_1d" ? corr.regression_1d : corr.regression_7d;
  const n =
    key === "delta_p_1d"
      ? corr.n_1d ?? analysis?.n_with_price_1d
      : corr.n_7d ?? analysis?.n_with_price_7d;
  if (!reg || !(reg.n ?? n ?? 0)) return null;
  if (reg.slope == null && reg.intercept == null && !(reg.line?.length ?? 0)) return null;

  const completed = completeRegressionLine({ ...reg, n: reg.n ?? n });
  if ((completed.line?.length ?? 0) > 0 || completed.slope != null) {
    return completed;
  }
  return null;
}

/** Rebuild scatter + OLS from median split (stable when snapshot lacks scatter payload). */
export function synthesizeScatterFromSplit(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
  key: "delta_p_1d" | "delta_p_7d",
): EisScatterBundle | null {
  if (!analysis?.split) return null;
  if (key === "delta_p_7d" && !(analysis.n_with_price_7d ?? analysis.correlation?.n_7d ?? 0)) {
    return null;
  }
  if (key === "delta_p_1d" && !(analysis.n_with_price_1d ?? analysis.correlation?.n_1d ?? 0)) {
    return null;
  }

  const lowAvg = analysis.split.low_eis?.avg_move_pp;
  const highAvg = analysis.split.high_eis?.avg_move_pp;
  const thr = analysis.split.threshold;
  if (lowAvg == null || highAvg == null || thr == null) return null;

  const pearson =
    key === "delta_p_1d"
      ? analysis.correlation?.pearson_eis_vs_delta_p_1d
      : analysis.correlation?.pearson_eis_vs_delta_p_7d;
  const n =
    key === "delta_p_1d"
      ? (analysis.correlation?.n_1d ?? analysis.n_with_price_1d ?? 0)
      : (analysis.correlation?.n_7d ?? analysis.n_with_price_7d ?? 0);
  if (n < 3) return null;

  const xLow = thr - 0.35;
  const xHigh = thr + 0.35;
  const slope = (highAvg - lowAvg) / (xHigh - xLow);
  const intercept = (lowAvg + highAvg) / 2 - slope * thr;
  const pad = 0.45;
  const x0 = Math.min(xLow, thr) - pad;
  const x1 = Math.max(xHigh, thr) + pad;
  const line = [
    { x: Math.round(x0 * 1000) / 1000, y: Math.round((intercept + slope * x0) * 1000) / 1000 },
    { x: Math.round(x1 * 1000) / 1000, y: Math.round((intercept + slope * x1) * 1000) / 1000 },
  ];
  const points: EisScatterPoint[] = [
    { x: Math.round(xLow * 1000) / 1000, y: lowAvg, ticker: "low EIS", window: "cohort" },
    {
      x: Math.round(thr * 1000) / 1000,
      y: Math.round(((lowAvg + highAvg) / 2) * 1000) / 1000,
      ticker: "median",
      window: "cohort",
    },
    { x: Math.round(xHigh * 1000) / 1000, y: highAvg, ticker: "high EIS", window: "cohort" },
  ];

  return {
    points,
    regression: {
      n,
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 10000) / 10000,
      r: pearson ?? null,
      line,
    },
    n_total: n,
  };
}

/** Scatter + OLS line — API scatter, correlation regression, or stable split synthesis. */
export function resolveEisScatterBundle(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
  key: "delta_p_1d" | "delta_p_7d",
): { bundle: EisScatterBundle | null; synthesized: boolean } {
  const direct = analysis?.scatter?.[key];
  if (scatterHasChartData(direct)) {
    return { bundle: direct ?? null, synthesized: false };
  }

  const reg = regressionFromCorrelation(analysis, key);
  if (reg && (reg.line?.length ?? 0) > 0) {
    return {
      bundle: {
        points: direct?.points ?? [],
        regression: reg,
        n_total: direct?.n_total ?? reg.n,
      },
      synthesized: false,
    };
  }

  const synth = synthesizeScatterFromSplit(analysis, key);
  if (synth) return { bundle: synth, synthesized: true };

  return { bundle: direct ?? null, synthesized: false };
}

function windowDaysBounds(
  row: { days_min?: number; days_max?: number | null; window?: string },
  fallbackIndex: number,
): { daysMin: number; daysMax: number; daysMid: number } {
  const defaults = [
    { daysMin: 0, daysMax: 30 },
    { daysMin: 31, daysMax: 60 },
    { daysMin: 61, daysMax: 90 },
    { daysMin: 91, daysMax: 180 },
    { daysMin: 181, daysMax: 270 },
  ];
  const fb = defaults[fallbackIndex] ?? defaults[defaults.length - 1];
  const daysMin = row.days_min ?? fb.daysMin;
  const rawMax = row.days_max;
  const daysMax = rawMax == null || rawMax >= 9999 ? fb.daysMax : rawMax;
  const daysMid = Math.round((daysMin + daysMax) / 2);
  return { daysMin, daysMax, daysMid };
}

function peakWindowKey(peak: EisMagnitudeAnalysisDoc["peak_window"]): string | null {
  if (!peak?.window) return null;
  return peak.window;
}

function slopeRowsFromTemporalRegression(
  rows: EisTemporalRegressionRow[],
  peakWindow: string | null,
): EisSlopeChartRow[] {
  return rows.map((row, i) => {
    const { daysMin, daysMax, daysMid } = windowDaysBounds(row, i);
    return {
      window: row.window ?? "—",
      daysMin,
      daysMax,
      daysMid,
      slope1d: row.regression_1d?.slope ?? null,
      slope7d: row.regression_7d?.slope ?? null,
      r1d: row.regression_1d?.r ?? null,
      r7d: row.regression_7d?.r ?? null,
      n1d: row.n_with_price_1d ?? row.regression_1d?.n ?? 0,
      n7d: row.n_with_price_7d ?? row.regression_7d?.n ?? 0,
      isPeak: peakWindow != null && row.window === peakWindow,
    };
  });
}

function slopeRowsFromTemporalRadius(
  rows: EisTemporalWindowRow[],
  peakWindow: string | null,
): EisSlopeChartRow[] {
  return rows.map((row, i) => {
    const { daysMin, daysMax, daysMid } = windowDaysBounds(row, i);
    const lift = row.high_minus_low_avg_pp;
    const xSpan = 0.7;
    const slope1d =
      lift != null && Number.isFinite(lift) ? Math.round((lift / xSpan) * 10000) / 10000 : null;
    return {
      window: row.window ?? "—",
      daysMin,
      daysMax,
      daysMid,
      slope1d,
      slope7d: null,
      r1d: row.pearson_eis_vs_d3 ?? null,
      r7d: null,
      n1d: row.n_with_price ?? 0,
      n7d: 0,
      isPeak: peakWindow != null && row.window === peakWindow,
    };
  });
}

function slopeRowsFromScatterPoints(
  scatter1d: EisScatterBundle | null,
  scatter7d: EisScatterBundle | null,
  windows: string[],
  peakWindow: string | null,
): EisSlopeChartRow[] {
  const groupByWindow = (pts: EisScatterPoint[] | undefined) => {
    const map = new Map<string, { x: number; y: number }[]>();
    for (const p of pts ?? []) {
      if (p.x == null || p.y == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const w = p.window ?? "—";
      const list = map.get(w) ?? [];
      list.push({ x: p.x, y: p.y });
      map.set(w, list);
    }
    return map;
  };

  const g1 = groupByWindow(scatter1d?.points);
  const g7 = groupByWindow(scatter7d?.points);
  const allWindows = windows.length ? windows : [...new Set([...g1.keys(), ...g7.keys()])];

  return allWindows.map((window, i) => {
    const reg1 = linearRegressionFromPoints(g1.get(window) ?? []);
    const reg7 = linearRegressionFromPoints(g7.get(window) ?? []);
    const bounds = windowDaysBounds({ window }, i);
    return {
      window,
      ...bounds,
      slope1d: reg1.slope ?? null,
      slope7d: reg7.slope ?? null,
      r1d: reg1.r ?? null,
      r7d: reg7.r ?? null,
      n1d: reg1.n ?? 0,
      n7d: reg7.n ?? 0,
      isPeak: peakWindow != null && window === peakWindow,
    };
  });
}

function signSplitRowsFromTemporal(
  rows: EisTemporalSignSplitRow[],
  peakWindow: string | null,
): EisSignSplitChartRow[] {
  return rows.map((row, i) => {
    const { daysMid } = windowDaysBounds(row, i);
    return {
      window: row.window ?? "—",
      daysMid,
      negAvg1d: row.negative_eis_1d?.avg_move_pp ?? null,
      posAvg1d: row.positive_eis_1d?.avg_move_pp ?? null,
      negAvg7d: row.negative_eis_7d?.avg_move_pp ?? null,
      posAvg7d: row.positive_eis_7d?.avg_move_pp ?? null,
      nNeg1d: row.negative_eis_1d?.n_with_price ?? 0,
      nPos1d: row.positive_eis_1d?.n_with_price ?? 0,
      nNeg7d: row.negative_eis_7d?.n_with_price ?? 0,
      nPos7d: row.positive_eis_7d?.n_with_price ?? 0,
      isPeak: peakWindow != null && row.window === peakWindow,
    };
  });
}

function signSplitRowsFromScatter(
  scatter1d: EisScatterBundle | null,
  scatter7d: EisScatterBundle | null,
  windows: string[],
  peakWindow: string | null,
): EisSignSplitChartRow[] {
  const bucket = (pts: EisScatterPoint[] | undefined, sign: "neg" | "pos") => {
    const map = new Map<string, number[]>();
    for (const p of pts ?? []) {
      if (p.x == null || p.y == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (sign === "neg" && p.x >= 0) continue;
      if (sign === "pos" && p.x <= 0) continue;
      const w = p.window ?? "—";
      const list = map.get(w) ?? [];
      list.push(p.y);
      map.set(w, list);
    }
    return map;
  };

  const avg = (vals: number[] | undefined) =>
    vals?.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

  const neg1 = bucket(scatter1d?.points, "neg");
  const pos1 = bucket(scatter1d?.points, "pos");
  const neg7 = bucket(scatter7d?.points, "neg");
  const pos7 = bucket(scatter7d?.points, "pos");
  const allWindows = windows.length ? windows : [...new Set([...neg1.keys(), ...pos1.keys()])];

  return allWindows.map((window, i) => {
    const nNeg1 = neg1.get(window) ?? [];
    const nPos1 = pos1.get(window) ?? [];
    const nNeg7 = neg7.get(window) ?? [];
    const nPos7 = pos7.get(window) ?? [];
    const { daysMid } = windowDaysBounds({ window }, i);
    return {
      window,
      daysMid,
      negAvg1d: avg(nNeg1),
      posAvg1d: avg(nPos1),
      negAvg7d: avg(nNeg7),
      posAvg7d: avg(nPos7),
      nNeg1d: nNeg1.length,
      nPos1d: nPos1.length,
      nNeg7d: nNeg7.length,
      nPos7d: nPos7.length,
      isPeak: peakWindow != null && window === peakWindow,
    };
  });
}

export function buildEisMagnitudeView(
  impact: CurveImpactCumulative | null | undefined,
  liveAnalysis?: EisMagnitudeAnalysisDoc | null,
): EisMagnitudeView {
  const bundled = asAnalysis(impact?.eis_magnitude_analysis);
  const analysis = liveAnalysis ? mergeEisMagnitudeAnalysis(bundled, liveAnalysis) : bundled;

  const scatter1dRes = resolveEisScatterBundle(analysis, "delta_p_1d");
  const scatter7dRes = resolveEisScatterBundle(analysis, "delta_p_7d");
  const scatter1d = scatter1dRes.bundle;
  const scatter7d = scatter7dRes.bundle;
  const chartsFromSnapshot = scatter1dRes.synthesized || scatter7dRes.synthesized;

  const windowLabels = (analysis?.temporal_radius ?? analysis?.temporal_regression ?? []).map(
    (r) => r.window ?? "—",
  );
  const peakKey = peakWindowKey(analysis?.peak_window ?? null);

  let slopeChartRows = slopeRowsFromTemporalRegression(analysis?.temporal_regression ?? [], peakKey);
  if (!slopeChartRows.some((r) => r.n1d > 0 || r.n7d > 0)) {
    const fromScatter = slopeRowsFromScatterPoints(scatter1d, scatter7d, windowLabels, peakKey);
    if (fromScatter.some((r) => r.n1d > 0 || r.n7d > 0)) {
      slopeChartRows = fromScatter;
    } else if ((analysis?.temporal_radius?.length ?? 0) > 0) {
      slopeChartRows = slopeRowsFromTemporalRadius(analysis!.temporal_radius!, peakKey);
    }
  }

  let signSplitChartRows = signSplitRowsFromTemporal(analysis?.temporal_sign_split ?? [], peakKey);
  if (!signSplitChartRows.some((r) => r.nNeg1d > 0 || r.nPos1d > 0)) {
    const fromScatter = signSplitRowsFromScatter(scatter1d, scatter7d, windowLabels, peakKey);
    if (fromScatter.some((r) => r.nNeg1d > 0 || r.nPos1d > 0)) {
      signSplitChartRows = fromScatter;
    }
  }

  const hasData = (analysis?.n_events_scored ?? 0) > 0;
  const hasPriceData =
    (analysis?.n_with_price_1d ?? 0) > 0 ||
    (analysis?.n_with_price_3d ?? 0) > 0 ||
    (analysis?.correlation?.n_1d ?? 0) > 0 ||
    (analysis?.correlation?.n_3d ?? 0) > 0 ||
    slopeChartRows.some((r) => r.n1d > 0);
  const hasWeekPriceData =
    (analysis?.n_with_price_7d ?? 0) > 0 ||
    (analysis?.correlation?.n_7d ?? 0) > 0 ||
    slopeChartRows.some((r) => r.n7d > 0);

  const chartsNeedLiveApi =
    hasPriceData &&
    !scatterHasChartData(scatter1d) &&
    !scatterHasChartData(scatter7d) &&
    slopeChartRows.every((r) => r.n1d === 0 && r.n7d === 0);

  return {
    analysis,
    hasData,
    hasPriceData,
    hasWeekPriceData,
    slopeChartRows,
    signSplitChartRows,
    scatter1d,
    scatter7d,
    peakWindow: analysis?.peak_window ?? null,
    chartsFromSnapshot,
    chartsNeedLiveApi,
    scatterIsSynthesized: scatter1dRes.synthesized || scatter7dRes.synthesized,
    scatterEventPoints1d: scatter1d?.points?.length ?? 0,
    expectedMoveCurve: buildEisExpectedMoveCurveView(analysis),
  };
}

/** @deprecated legacy with/without EIS cohort view — kept for type compat. */
export type EisWeeklyHistoryRow = {
  week_key: string;
  recorded_at?: string;
  with_eis_n?: number;
  without_eis_n?: number;
  with_eis_price_accuracy_pct?: number | null;
  without_eis_price_accuracy_pct?: number | null;
  with_eis_sign_hit_pct?: number | null;
  without_eis_sign_hit_pct?: number | null;
};

export function buildEisSignalImpactView(
  impact: CurveImpactCumulative | null | undefined,
  _options?: { weeklyHistory?: EisWeeklyHistoryRow[] | null; locale?: string },
) {
  return buildEisMagnitudeView(impact);
}

export type { EisMagnitudeAnalysisDoc, EisTemporalWindowRow } from "../data/signalCalibrationData";
