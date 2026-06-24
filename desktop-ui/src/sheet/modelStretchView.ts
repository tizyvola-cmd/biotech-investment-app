import type { ModelCalibrationStateDoc } from "../data/modelLearningsData";
import type { SignCurveDailyDoc } from "../data/signCurveDailyData";
import type { CurveImpactCumulative } from "../data/signalCalibrationData";
import { buildSignAccuracyCurveView } from "./signAccuracyCurve";

export type ModelStretchVerdict = "improved" | "worse" | "neutral" | "unknown";

export type ModelStretchHistoryPoint = {
  label: string;
  calFactor: number;
  ts: string | null;
};

export type RecalibScheduleKind = "completed" | "current" | "next" | "planned";

export type RecalibScheduleItem = {
  dateIso: string;
  label: string;
  kind: RecalibScheduleKind;
  calFactor: number | null;
  stretchPctFromNeutral: number | null;
  daysFromNow: number | null;
};

/** Matches backend default ``CALIB_REFRESH_DAYS`` (prediction/config.py). */
export const DEFAULT_CALIB_REFRESH_DAYS = 30;

export type ModelStretchOutcomePoint = {
  offset: number;
  label: string;
  beforePrice: number | null;
  afterPrice: number | null;
  beforeSign: number | null;
  afterSign: number | null;
};

export type ModelStretchView = {
  stretchFactor: number | null;
  stretchDelta: number | null;
  stretchPctFromNeutral: number | null;
  priceAccBefore: number | null;
  priceAccAfter: number | null;
  priceAccDeltaPp: number | null;
  signHitBefore: number | null;
  signHitAfter: number | null;
  signHitDeltaPp: number | null;
  verdict: ModelStretchVerdict;
  history: ModelStretchHistoryPoint[];
  recalibSchedule: RecalibScheduleItem[];
  calibRefreshDays: number;
  outcomePoints: ModelStretchOutcomePoint[];
  hasOutcomeChart: boolean;
};

function parseCalFactorV4(cf: Record<string, number | null> | undefined): number | null {
  if (!cf) return null;
  const v = cf.v4_options ?? cf["v4_options"];
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function dayLabel(iso: string | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysFromToday(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function stretchPctFromFactor(cf: number): number {
  return Math.round((cf - 1) * 1000) / 10;
}

export function buildRecalibSchedule(
  calibState: ModelCalibrationStateDoc | null | undefined,
  history: ModelStretchHistoryPoint[],
  refreshDays = DEFAULT_CALIB_REFRESH_DAYS,
  plannedCount = 2,
): RecalibScheduleItem[] {
  const items: RecalibScheduleItem[] = [];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const isLast = i === history.length - 1;
    items.push({
      dateIso: h.label,
      label: h.label,
      kind: isLast ? "current" : "completed",
      calFactor: h.calFactor,
      stretchPctFromNeutral: stretchPctFromFactor(h.calFactor),
      daysFromNow: daysFromToday(h.label),
    });
  }

  const anchorIso =
    calibState?.current?.timestamp?.slice(0, 10) ??
    history[history.length - 1]?.label ??
    null;
  if (!anchorIso) return items;

  let nextIso = addDaysIso(anchorIso, refreshDays);
  const todayIso = new Date().toISOString().slice(0, 10);
  while (nextIso <= todayIso) {
    nextIso = addDaysIso(nextIso, refreshDays);
  }

  items.push({
    dateIso: nextIso,
    label: nextIso,
    kind: "next",
    calFactor: null,
    stretchPctFromNeutral: null,
    daysFromNow: daysFromToday(nextIso),
  });

  for (let i = 1; i <= plannedCount; i++) {
    const plannedIso = addDaysIso(nextIso, refreshDays * i);
    items.push({
      dateIso: plannedIso,
      label: plannedIso,
      kind: "planned",
      calFactor: null,
      stretchPctFromNeutral: null,
      daysFromNow: daysFromToday(plannedIso),
    });
  }

  return items;
}

function resolveVerdict(priceDelta: number | null, signDelta: number | null): ModelStretchVerdict {
  if (priceDelta == null && signDelta == null) return "unknown";
  const sum = (priceDelta ?? 0) + (signDelta ?? 0);
  if (sum >= 1) return "improved";
  if (sum <= -1) return "worse";
  return "neutral";
}

function buildHistory(calibState: ModelCalibrationStateDoc | null | undefined): ModelStretchHistoryPoint[] {
  if (!calibState) return [];
  const out: ModelStretchHistoryPoint[] = [];
  for (const h of calibState.history ?? []) {
    const cf = parseCalFactorV4(h.cal_factor);
    if (cf == null) continue;
    out.push({ label: dayLabel(h.timestamp), calFactor: cf, ts: h.timestamp ?? null });
  }
  const curCf = parseCalFactorV4(calibState.current?.cal_factor);
  if (curCf != null) {
    const curTs = calibState.current?.timestamp ?? null;
    const curLabel = dayLabel(curTs ?? undefined);
    const last = out[out.length - 1];
    if (!last || last.calFactor !== curCf) {
      out.push({ label: curLabel, calFactor: curCf, ts: curTs });
    }
  }
  return out;
}

function fromSignCurve(
  signCurveDaily: SignCurveDailyDoc | null | undefined,
  summaryDoc: Parameters<typeof buildSignAccuracyCurveView>[0],
): Pick<
  ModelStretchView,
  | "priceAccBefore"
  | "priceAccAfter"
  | "priceAccDeltaPp"
  | "signHitBefore"
  | "signHitAfter"
  | "signHitDeltaPp"
  | "outcomePoints"
  | "hasOutcomeChart"
> {
  const view = buildSignAccuracyCurveView(summaryDoc, signCurveDaily);
  const retro = signCurveDaily?.cohorts?.retro;
  const sim = signCurveDaily?.cohorts?.simulation;

  const priceAccBefore = retro?.overall_price_accuracy_pct ?? null;
  const priceAccAfter = sim?.overall_price_accuracy_pct ?? null;
  const signHitBefore = retro?.overall_sign_hit_pct ?? retro?.overall_sign_hit_pre_cd_pct ?? null;
  const signHitAfter = sim?.overall_sign_hit_pct ?? sim?.overall_sign_hit_pre_cd_pct ?? null;

  const priceAccDeltaPp =
    priceAccBefore != null && priceAccAfter != null ? priceAccAfter - priceAccBefore : null;
  const signHitDeltaPp =
    signHitBefore != null && signHitAfter != null ? signHitAfter - signHitBefore : null;

  const outcomePoints: ModelStretchOutcomePoint[] = view.points.map((p) => ({
    offset: p.offset,
    label: p.label,
    beforePrice: p.retroPricePct,
    afterPrice: p.simPricePct,
    beforeSign: p.retroSignPct,
    afterSign: p.simSignPct,
  }));

  const hasOutcomeChart = outcomePoints.some(
    (p) =>
      p.beforePrice != null ||
      p.afterPrice != null ||
      p.beforeSign != null ||
      p.afterSign != null,
  );

  return {
    priceAccBefore,
    priceAccAfter,
    priceAccDeltaPp,
    signHitBefore,
    signHitAfter,
    signHitDeltaPp,
    outcomePoints,
    hasOutcomeChart,
  };
}

function fromCurveImpact(impact: CurveImpactCumulative | null | undefined): Partial<
  Pick<
    ModelStretchView,
    | "priceAccBefore"
    | "priceAccAfter"
    | "priceAccDeltaPp"
    | "signHitBefore"
    | "signHitAfter"
    | "signHitDeltaPp"
  >
> {
  const summary = impact?.summary;
  if (!summary) return {};
  const maeBefore = summary.mae_base_pp;
  const maeAfter = summary.mae_daily_pp ?? summary.mae_recalib_pp;
  const hitBefore = summary.hit_base_pct;
  const hitAfter = summary.hit_daily_pct ?? summary.hit_recalib_pct;

  // Proxy price accuracy from inverse MAE gap (lower MAE = better fit)
  const priceBefore =
    maeBefore != null ? Math.max(0, Math.min(100, 100 - maeBefore)) : null;
  const priceAfter = maeAfter != null ? Math.max(0, Math.min(100, 100 - maeAfter)) : null;

  return {
    priceAccBefore: priceBefore,
    priceAccAfter: priceAfter,
    priceAccDeltaPp:
      priceBefore != null && priceAfter != null ? priceAfter - priceBefore : null,
    signHitBefore: hitBefore ?? null,
    signHitAfter: hitAfter ?? null,
    signHitDeltaPp:
      hitBefore != null && hitAfter != null ? hitAfter - hitBefore : null,
  };
}

export function buildModelStretchView(
  calibState: ModelCalibrationStateDoc | null | undefined,
  signCurveDaily: SignCurveDailyDoc | null | undefined,
  summaryDoc: Parameters<typeof buildSignAccuracyCurveView>[0],
  curveImpact?: CurveImpactCumulative | null | undefined,
): ModelStretchView {
  const history = buildHistory(calibState);
  const recalibSchedule = buildRecalibSchedule(calibState, history);
  const currentCf =
    parseCalFactorV4(calibState?.current?.cal_factor) ??
    (history.length ? history[history.length - 1].calFactor : null);
  const prevCf = history.length >= 2 ? history[history.length - 2].calFactor : null;
  const stretchDelta =
    currentCf != null && prevCf != null ? currentCf - prevCf : null;
  const stretchPctFromNeutral =
    currentCf != null ? Math.round((currentCf - 1) * 1000) / 10 : null;

  const fromSign = fromSignCurve(signCurveDaily, summaryDoc);
  const fallback = fromCurveImpact(curveImpact);

  const priceAccBefore = fromSign.priceAccBefore ?? fallback.priceAccBefore ?? null;
  const priceAccAfter = fromSign.priceAccAfter ?? fallback.priceAccAfter ?? null;
  const signHitBefore = fromSign.signHitBefore ?? fallback.signHitBefore ?? null;
  const signHitAfter = fromSign.signHitAfter ?? fallback.signHitAfter ?? null;
  const priceAccDeltaPp =
    priceAccBefore != null && priceAccAfter != null
      ? priceAccAfter - priceAccBefore
      : (fallback.priceAccDeltaPp ?? null);
  const signHitDeltaPp =
    signHitBefore != null && signHitAfter != null
      ? signHitAfter - signHitBefore
      : (fallback.signHitDeltaPp ?? null);

  return {
    stretchFactor: currentCf,
    stretchDelta,
    stretchPctFromNeutral,
    priceAccBefore,
    priceAccAfter,
    priceAccDeltaPp,
    signHitBefore,
    signHitAfter,
    signHitDeltaPp,
    verdict: resolveVerdict(priceAccDeltaPp, signHitDeltaPp),
    history,
    recalibSchedule,
    calibRefreshDays: DEFAULT_CALIB_REFRESH_DAYS,
    outcomePoints: fromSign.outcomePoints,
    hasOutcomeChart: fromSign.hasOutcomeChart,
  };
}

export function stretchVerdictTone(verdict: ModelStretchVerdict): string {
  if (verdict === "improved") return "text-positive";
  if (verdict === "worse") return "text-negative";
  if (verdict === "neutral") return "text-warn";
  return "text-ink-muted";
}
