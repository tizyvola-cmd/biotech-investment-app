import type {
  EisExpectedMoveAnchor,
  EisExpectedMoveCalibrationDoc,
  EisExpectedMoveHorizonCurve,
  EisMagnitudeAnalysisDoc,
  EisRegressionStats,
} from "../data/signalCalibrationData";

export type EisObservedMovePoint = {
  eis: number;
  deltaPp: number;
  ticker?: string;
};

export type EisExpectedMoveCurveView = {
  calibration: EisExpectedMoveCalibrationDoc | null;
  t1: EisExpectedMoveHorizonCurve | null;
  t7: EisExpectedMoveHorizonCurve | null;
  chartRows: EisExpectedMoveChartRow[];
  anchorRows: EisExpectedMoveAnchorRow[];
  observedT1: EisObservedMovePoint[];
  observedT7: EisObservedMovePoint[];
};

export type EisExpectedMoveChartRow = {
  eis: number;
  expectedPpT1: number | null;
  expectedPpT7: number | null;
};

export type EisExpectedMoveAnchorRow = {
  eis: number;
  label: string;
  expectedPpT1: number | null;
  expectedPpT7: number | null;
};

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function expectedPpAtEis(slope: number, intercept: number, eis: number): number {
  return round3(intercept + slope * eis);
}

function percentile(vals: number[], p: number): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  const w = idx - lo;
  return s[lo] * (1 - w) + s[hi] * w;
}

function formatEisLabel(eis: number): string {
  if (Math.abs(eis) < 1e-9) return "0";
  if (Math.abs(eis - Math.round(eis)) < 0.05) {
    const n = Math.round(eis);
    return n >= 0 ? `+${n}` : `${n}`;
  }
  return eis >= 0 ? `+${eis.toFixed(1)}` : eis.toFixed(1);
}

function buildHorizonCurveFromRegression(
  reg: EisRegressionStats | null | undefined,
  eisScores: number[],
  horizonKey: "t1" | "t7",
  horizonLabel: string,
): EisExpectedMoveHorizonCurve | null {
  if (!reg || reg.slope == null || reg.intercept == null || (reg.n ?? 0) < 3) return null;
  const scores = eisScores.filter((x) => Number.isFinite(x));
  if (scores.length < 3) return null;

  const slope = reg.slope;
  const intercept = reg.intercept;
  const eisMin = round3(Math.min(...scores));
  const eisMax = round3(Math.max(...scores));
  const pad = Math.max(1, (eisMax - eisMin) * 0.05);
  const x0 = eisMin - pad;
  const x1 = eisMax + pad;
  const linePts = 48;
  const line = Array.from({ length: linePts }, (_, i) => {
    const eis = x0 + ((x1 - x0) * i) / (linePts - 1);
    return { eis: round3(eis), expected_pp: expectedPpAtEis(slope, intercept, eis) };
  });

  const anchorCandidates = [
    -20, -10, -5, -2, -1, 0, 1, 2, 5, 10, 20,
    percentile(scores, 0.25),
    percentile(scores, 0.5),
    percentile(scores, 0.75),
  ]
    .map((x) => round3(x))
    .filter((x) => x >= x0 && x <= x1);

  const anchors: EisExpectedMoveAnchor[] = [...new Set(anchorCandidates)]
    .sort((a, b) => a - b)
    .map((eis) => ({
      eis,
      expected_pp: expectedPpAtEis(slope, intercept, eis),
      label: formatEisLabel(eis),
    }));

  return {
    horizon_key: horizonKey,
    horizon_label: horizonLabel,
    slope_pp_per_eis: round3(slope),
    intercept_pp: round3(intercept),
    pearson_r: reg.r ?? null,
    n: reg.n ?? scores.length,
    eis_observed_min: eisMin,
    eis_observed_max: eisMax,
    eis_median: round3(percentile(scores, 0.5)),
    formula: `ΔP ≈ ${intercept >= 0 ? "+" : ""}${intercept.toFixed(2)} + ${slope.toFixed(2)} × EIS`,
    line,
    anchors,
  };
}

function eisScoresFromAnalysis(analysis: EisMagnitudeAnalysisDoc | null | undefined): number[] {
  const pts = [
    ...(analysis?.scatter?.delta_p_1d?.points ?? []),
    ...(analysis?.scatter?.delta_p_7d?.points ?? []),
  ];
  const fromScatter = pts.map((p) => p.x).filter((x): x is number => x != null && Number.isFinite(x));
  if (fromScatter.length >= 3) return fromScatter;
  return [];
}

export function resolveExpectedMoveCalibration(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
): EisExpectedMoveCalibrationDoc | null {
  const persisted = analysis?.expected_move_calibration;
  if (persisted?.horizons?.t1?.line?.length || persisted?.horizons?.t7?.line?.length) {
    return persisted;
  }

  const corr = analysis?.correlation;
  const scores = eisScoresFromAnalysis(analysis);
  const t1 = buildHorizonCurveFromRegression(
    corr?.regression_1d,
    scores,
    "t1",
    "T+1 (~24h)",
  );
  const t7 = buildHorizonCurveFromRegression(
    corr?.regression_7d,
    scores,
    "t7",
    "T+7 (~1 week)",
  );
  if (!t1 && !t7) return null;
  return {
    built_from: "cohort_ols",
    horizons: { t1: t1 ?? undefined, t7: t7 ?? undefined },
  };
}

function mapObservedPoints(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
  key: "delta_p_1d" | "delta_p_7d",
): EisObservedMovePoint[] {
  return (analysis?.scatter?.[key]?.points ?? [])
    .filter(
      (p): p is { x: number; y: number; ticker?: string } =>
        p.x != null && Number.isFinite(p.x) && p.y != null && Number.isFinite(p.y),
    )
    .map((p) => ({
      eis: p.x,
      deltaPp: p.y,
      ticker: p.ticker,
    }));
}

export function buildEisExpectedMoveCurveView(
  analysis: EisMagnitudeAnalysisDoc | null | undefined,
): EisExpectedMoveCurveView {
  const calibration = resolveExpectedMoveCalibration(analysis);
  const t1 = calibration?.horizons?.t1 ?? null;
  const t7 = calibration?.horizons?.t7 ?? null;

  const eisSet = new Set<number>();
  for (const pt of t1?.line ?? []) eisSet.add(pt.eis);
  for (const pt of t7?.line ?? []) eisSet.add(pt.eis);
  const eisValues = [...eisSet].sort((a, b) => a - b);

  const t1ByEis = new Map((t1?.line ?? []).map((p) => [p.eis, p.expected_pp]));
  const t7ByEis = new Map((t7?.line ?? []).map((p) => [p.eis, p.expected_pp]));

  const chartRows: EisExpectedMoveChartRow[] = eisValues.map((eis) => ({
    eis,
    expectedPpT1: t1ByEis.get(eis) ?? null,
    expectedPpT7: t7ByEis.get(eis) ?? null,
  }));

  const anchorEis = new Set<number>();
  for (const a of t1?.anchors ?? []) anchorEis.add(a.eis);
  for (const a of t7?.anchors ?? []) anchorEis.add(a.eis);
  const t1Anchors = new Map((t1?.anchors ?? []).map((a) => [a.eis, a]));
  const t7Anchors = new Map((t7?.anchors ?? []).map((a) => [a.eis, a]));

  const anchorRows: EisExpectedMoveAnchorRow[] = [...anchorEis]
    .sort((a, b) => a - b)
    .map((eis) => ({
      eis,
      label: t1Anchors.get(eis)?.label ?? t7Anchors.get(eis)?.label ?? formatEisLabel(eis),
      expectedPpT1: t1Anchors.get(eis)?.expected_pp ?? t1ByEis.get(eis) ?? null,
      expectedPpT7: t7Anchors.get(eis)?.expected_pp ?? t7ByEis.get(eis) ?? null,
    }));

  return {
    calibration,
    t1,
    t7,
    chartRows,
    anchorRows,
    observedT1: mapObservedPoints(analysis, "delta_p_1d"),
    observedT7: mapObservedPoints(analysis, "delta_p_7d"),
  };
}

/** Quick lookup: expected ΔP (pp) at a given EIS score. */
export function expectedMovePpAtEis(
  curve: EisExpectedMoveHorizonCurve | null | undefined,
  eis: number,
): number | null {
  if (!curve || curve.slope_pp_per_eis == null || curve.intercept_pp == null) return null;
  return expectedPpAtEis(curve.slope_pp_per_eis, curve.intercept_pp, eis);
}
