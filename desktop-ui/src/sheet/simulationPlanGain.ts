/**
 * Gain atteso in tab P&L Simulation — allineato a Decision Lab / Top Opps.
 * ROI→CD = Δ curva modello (oggi → CD), come la sparkline.
 * ROI al target = Δ curva oggi → fine tratto in salita (plateau / slope flat o negativo).
 */
import type { ChartPoint } from "../types";
import { buildSlopeAwareTargetStop } from "./dynamicTargetStop";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import { buildPrecatEntry, computePrecatCurve, extractCurveInputs } from "./precatCurve";
import { computeSlopeStability, stabilityVerdict } from "./slopeStability";
import {
  forwardBestCurveDeltaToCd,
  forwardRiseSegmentPeak,
  curveDeltaFromEntryToCd,
  extractSparklinePoints,
} from "./simulationSparkline";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { forwardPred5PpFromRecalibCurve } from "./predictionCurveDailyRecalib";
import { isWatchZone } from "./cdHorizons";
import { dailyChangePctFromRow } from "./simulationPosition";
import {
  computeWatchTargetConfidenceMultiplier,
  resolveWatchProvisionalTarget,
} from "./watchZoneProvisionalTarget";
import { resolveSupernovaForwardPeak } from "./supernovaTargetRoi";

export type ExpectedGainSource =
  | "slope_target"
  | "precat"
  | "curve_model"
  | "pred_horizon"
  | "none";

export type ExpectedGainPlan = {
  /** Rendimento atteso verso Completion Date (oggi → CD). */
  expectedReturnPct: number | null;
  expectedGainEur: number | null;
  daysToCd: number | null;
  source: ExpectedGainSource;
  /** Take-profit dinamico (tratto in salita) — distinto dal ROI→CD. */
  targetReturnPct: number | null;
  targetGainEur: number | null;
  daysToTarget: number | null;
  /** Midpoint banda target % (rise mode). */
  targetMidPct: number | null;
  targetHighPct: number | null;
  precatKind: string | null;
  /** Watch zone target — si affina entrando in hot zone (≤60d). */
  targetProvisional?: boolean;
  targetConfidencePct?: number | null;
};

export type ResolveExpectedGainPlanOptions = {
  chartPoints?: ChartPoint[] | null;
  /**
   * Orizzonte in giorni verso il CD per pendenza × giorni (default: giorni rimanenti da oggi).
   * Per «Plan at entry» usare la durata totale ingresso → CD.
   */
  horizonDays?: number | null;
  /** Δ curva: solo residuo (oggi→CD) o intero piano (ingresso→CD). */
  curveSpan?: "forward" | "entry_to_cd";
  /** Giorni trascorsi dall'ingresso — richiesto per `curveSpan: entry_to_cd`. */
  holdDaysElapsed?: number | null;
};

function parseCompletionDate(s: string): Date | null {
  const raw = String(s ?? "").trim();
  if (!raw || raw === "—") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const iso = new Date(raw);
  return Number.isFinite(iso.getTime()) ? iso : null;
}

export function daysFromToday(completionDate: string): number | null {
  const d = parseCompletionDate(completionDate);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function findCol(row: Record<string, unknown>, ...parts: string[]): string | null {
  for (const k of Object.keys(row)) {
    const flat = k.replace(/\n/g, " ");
    if (parts.every((p) => flat.toLowerCase().includes(p.toLowerCase()))) return k;
  }
  return null;
}

function numv(row: Record<string, unknown>, col: string | null): number | null {
  if (!col) return null;
  const v = row[col];
  if (v == null || v === "" || v === "—") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toPredPp(v: number | null, raw: unknown): number | null {
  if (v == null) return null;
  const hasPct = typeof raw === "string" && raw.includes("%");
  return Math.abs(v) <= 1.5 && !hasPct ? v * 100 : v;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type RiseTargetMetrics = {
  targetReturnPct: number | null;
  daysToTarget: number | null;
  targetMidPct: number | null;
  targetHighPct: number | null;
  targetProvisional?: boolean;
  targetConfidencePct?: number | null;
};

/** Target = picco del tratto in salita sulla curva bundle; fallback pendenza se assente bundle. */
function resolveRiseTargetMetrics(
  dynamic: NonNullable<ReturnType<typeof buildSlopeAwareTargetStop>> | null,
  _cdReturnPct: number | null,
  daysRemaining: number | null,
  effSlopeModel: number | null,
  flatThr: number,
  row: Record<string, unknown>,
  chartPoints?: ChartPoint[] | null,
): RiseTargetMetrics {
  const targetHighPct = dynamic?.targetHighPct ?? null;
  const targetMidPct =
    dynamic != null
      ? round1((dynamic.targetLowPct + dynamic.targetHighPct) / 2)
      : null;

  const peak = forwardRiseSegmentPeak(row, chartPoints, flatThr);
  if (peak && peak.returnPct > 0) {
    const inWatch = isWatchZone(daysRemaining);
    const confMult =
      inWatch && daysRemaining != null
        ? computeWatchTargetConfidenceMultiplier(daysRemaining, row)
        : 1;
    const targetReturnPct = round1(peak.returnPct * confMult);
    return {
      targetReturnPct,
      daysToTarget: peak.days,
      targetMidPct: targetReturnPct,
      targetHighPct: targetHighPct ?? targetReturnPct,
      targetProvisional: inWatch,
      targetConfidencePct: inWatch ? Math.round(confMult * 100) : null,
    };
  }

  const snPeak = resolveSupernovaForwardPeak(row, chartPoints, {
    extendedPostCd: true,
    vsToday: true,
  });
  if (snPeak && snPeak.peakKind === "peak" && snPeak.returnPct > 0.08) {
    const inWatch = isWatchZone(daysRemaining);
    const confMult =
      inWatch && daysRemaining != null
        ? computeWatchTargetConfidenceMultiplier(daysRemaining, row)
        : 1;
    const targetReturnPct = round1(snPeak.returnPct * confMult);
    const daysToTarget = snPeak.daysToTarget ?? null;
    if (daysToTarget == null || daysToTarget <= 0) {
      return { targetReturnPct: null, daysToTarget: null, targetMidPct, targetHighPct };
    }
    return {
      targetReturnPct,
      daysToTarget,
      targetMidPct: targetReturnPct,
      targetHighPct: targetHighPct ?? targetReturnPct,
      targetProvisional: inWatch,
      targetConfidencePct: inWatch ? Math.round(confMult * 100) : null,
    };
  }

  if (isWatchZone(daysRemaining)) {
    const dailyPct24h = dailyChangePctFromRow(row);
    const prov = resolveWatchProvisionalTarget(row, chartPoints, daysRemaining, {
      dailyPct24h,
    });
    if (prov && prov.targetReturnPct > 0) {
      return {
        targetReturnPct: prov.targetReturnPct,
        daysToTarget: prov.daysToTarget,
        targetMidPct: prov.targetReturnPct,
        targetHighPct: targetHighPct ?? prov.targetReturnPct,
        targetProvisional: true,
        targetConfidencePct: prov.confidencePct,
      };
    }
  }

  if (dynamic?.mode !== "rise" || dynamic.targetHighPct <= 0) {
    return { targetReturnPct: null, daysToTarget: null, targetMidPct, targetHighPct };
  }

  const targetReturnPct = round1(
    Math.max(targetMidPct ?? dynamic.targetLowPct, dynamic.targetLowPct, dynamic.targetHighPct * 0.85),
  );
  if (targetReturnPct <= 0) {
    return { targetReturnPct: null, daysToTarget: null, targetMidPct, targetHighPct };
  }

  const maxDays =
    daysRemaining != null && daysRemaining > 1 ? daysRemaining - 1 : daysRemaining;
  let daysToTarget: number | null = null;
  if (
    effSlopeModel != null &&
    Number.isFinite(effSlopeModel) &&
    effSlopeModel > flatThr &&
    maxDays != null &&
    maxDays > 0
  ) {
    daysToTarget = Math.max(1, Math.min(maxDays, Math.round(targetReturnPct / effSlopeModel)));
  }

  return { targetReturnPct, daysToTarget, targetMidPct, targetHighPct };
}

/** Pred +5 assoluta sul modello (solo fallback senza pendenza). */
export function readPred5Pp(row: Record<string, unknown>): number | null {
  const c4 = findCol(row, "Pred", "+4");
  const c7 = findCol(row, "Pred", "+7");
  const pred4 = toPredPp(numv(row, c4), row[c4 ?? ""]);
  const pred7 = toPredPp(numv(row, c7), row[c7 ?? ""]);
  if (pred4 != null && pred7 != null) return pred4 + (pred7 - pred4) * (1 / 3);
  if (pred7 != null) return pred7;
  if (pred4 != null) return pred4;
  const cEmp = findCol(row, "Pred empirica") ?? findCol(row, "Pred");
  return toPredPp(numv(row, cEmp), row[cEmp ?? ""]);
}

/**
 * Pred +5 attesa **da oggi** sulla curva modello (pre-CD aware).
 *
 * Usa Δ curva (offset oggi → offset oggi+5) da Pred −60…+7, non l'ancora
 * assoluta T+5 post-CD (Pred +4/+7), che schiaccia quasi tutti i ticker pre-CD
 * verso ~0 o negativo.
 *
 * Allineato a Performance / pre-CD path e a Segnali (forward da posizione attuale).
 */
function normalizePred5LivePp(raw: number): number {
  if (Math.abs(raw) < 1 && Math.abs(raw) > 0.0001) return raw * 100;
  return raw;
}

function roundPredPp(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ReadPred5RelativeOptions = {
  chartPoints?: ChartPoint[] | null;
};

/** Δ curva (pp) tra offset «oggi» e «oggi+5» — estrapola oltre T−60 se CD è lontano. */
function forwardCurveDeltaPp(
  series: { offset: number; y: number }[],
  nowOff: number,
): number | null {
  if (series.length < 2) return null;
  const atNow = interpolateAtOffset(series, nowOff, { extrapolate: true });
  const atFwd = interpolateAtOffset(series, nowOff + 5, { extrapolate: true });
  if (atNow == null || atFwd == null) return null;
  return roundPredPp(atFwd - atNow);
}

export function readPred5RelativePp(
  row: Record<string, unknown>,
  options?: ReadPred5RelativeOptions,
): number | null {
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  const fbPts = extractSparklinePoints(row);
  const series =
    fbPts.length >= 1 ? fbPts.map((p) => ({ offset: p.offset, y: p.val })) : [];

  // 0) Curva ricalibrata bundle (se disponibile).
  if (options?.chartPoints?.length && nowOff != null && Number.isFinite(nowOff) && nowOff < 5) {
    const fromRecalib = forwardPred5PpFromRecalibCurve(row, options.chartPoints);
    if (fromRecalib != null && Math.abs(fromRecalib) >= 0.02) {
      return fromRecalib;
    }
  }

  // 1) Primary: Δ curva modello da offset «oggi» → oggi+5 (pre-CD, con estrapolazione).
  if (nowOff != null && Number.isFinite(nowOff) && series.length >= 2) {
    const delta = forwardCurveDeltaPp(series, nowOff);
    if (delta != null && Math.abs(delta) >= 0.02) {
      return delta;
    }
    if (nowOff < 5) {
      const pred5Abs = readPred5Pp(row);
      const atNow = interpolateAtOffset(series, nowOff, { extrapolate: true });
      if (pred5Abs != null && atNow != null) {
        const rel = roundPredPp(pred5Abs - atNow);
        if (Math.abs(rel) >= 0.02) return rel;
      }
    }
  }

  // 2) Fallback: pred5_live (forward cohort) — solo se la curva non basta.
  const liveCol = findCol(row, "pred5", "live");
  const liveRaw = numv(row, liveCol);
  if (liveRaw != null && Number.isFinite(liveRaw)) {
    const livePp = normalizePred5LivePp(liveRaw);
    if (Math.abs(livePp) >= 0.02) {
      return roundPredPp(livePp);
    }
  }

  // 3) Pendenza osservata × 5g (quando la griglia Pred non copre «oggi»).
  const { slope5d } = extractCurveInputs(row);
  if (slope5d != null && Math.abs(slope5d) >= 0.02) {
    return roundPredPp(slope5d * 5);
  }

  // 4) Last resort: Pred +4/+7 relativo a «oggi» sulla curva.
  const pred5Abs = readPred5Pp(row);
  if (pred5Abs == null) return null;
  if (nowOff != null && series.length >= 1) {
    const atNow = interpolateAtOffset(series, nowOff, { extrapolate: true });
    if (atNow != null) {
      return roundPredPp(pred5Abs - atNow);
    }
  }
  return roundPredPp(pred5Abs);
}

export function readPred7Pp(row: Record<string, unknown>): number | null {
  const c7 = findCol(row, "Pred", "+7");
  return toPredPp(numv(row, c7), row[c7 ?? ""]);
}

/**
 * Gain atteso verso CD — Δ curva modello (bundle) o pendenza × giorni.
 * Non usa mai Pred+7 scalato se la traiettoria verso CD è ≤ 0.
 */
export function resolveExpectedGainPlan(
  row: Record<string, unknown> | undefined,
  capital: number,
  options?: ResolveExpectedGainPlanOptions,
): ExpectedGainPlan {
  const empty: ExpectedGainPlan = {
    expectedReturnPct: null,
    expectedGainEur: null,
    daysToCd: null,
    source: "none",
    targetReturnPct: null,
    targetGainEur: null,
    daysToTarget: null,
    targetMidPct: null,
    targetHighPct: null,
    precatKind: null,
  };
  if (!row) return empty;

  const cd = String(row["Completion Date"] ?? "");
  const daysRemaining = daysFromToday(cd);
  const days = options?.horizonDays ?? daysRemaining;
  const { slope5d, slope20d, slope45d, runUp30d } = extractCurveInputs(row);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d)
      ? slope20d
      : slope5d ?? null;
  const verdict = stabilityVerdict(stab, effSlope);
  const precat = buildPrecatEntry(slope5d, slope20d, runUp30d, days);
  const curve = days != null && days > 0 ? computePrecatCurve(slope20d, slope5d, runUp30d, days) : null;
  const flatThr = tradeCalibThreshold("dynamic_slope_flat_pp_per_day");
  const effSlopeModel = curve?.effSlope ?? effSlope;

  const dynamic = buildSlopeAwareTargetStop({
    slope5d,
    slope20d,
    slope45d,
    runUp30d,
    days,
    isLong: true,
    stabilityVerdict: verdict,
    rotationFlag: stab.rotationFlag,
  });

  const curveDelta =
    options?.curveSpan === "entry_to_cd"
      ? curveDeltaFromEntryToCd(row, options?.chartPoints, options?.holdDaysElapsed)
      : forwardBestCurveDeltaToCd(row, options?.chartPoints);
  const slopeReturnPct =
    precat.expectedReturnPct ??
    (days != null && days > 0 && effSlopeModel != null
      ? round1(effSlopeModel * days)
      : null);

  /** Rendimento canonico verso CD: curva bundle > pendenza × giorni. */
  const modelReturnPct: number | null =
    curveDelta != null ? curveDelta : slopeReturnPct;

  let pct: number | null = null;
  let source: ExpectedGainSource = "none";

  if (modelReturnPct != null && modelReturnPct <= 0) {
    pct = modelReturnPct;
    source = curveDelta != null ? "curve_model" : "precat";
  } else if (modelReturnPct != null && modelReturnPct > 0) {
    pct = modelReturnPct;
    source = curveDelta != null ? "curve_model" : "precat";
  } else {
    const clearlyFalling =
      effSlopeModel != null && Number.isFinite(effSlopeModel) && effSlopeModel < -flatThr;
    if (clearlyFalling && days != null && days > 0) {
      pct = round1(effSlopeModel! * days);
      source = "precat";
    } else if (
      !clearlyFalling &&
      effSlopeModel != null &&
      Math.abs(effSlopeModel) < flatThr
    ) {
      const pred5Curve = forwardPred5PpFromRecalibCurve(row, options?.chartPoints);
      const pred7 = readPred7Pp(row);
      const pred5 = pred5Curve ?? readPred5Pp(row);
      if (days != null && days > 7 && pred7 != null && pred7 > 0) {
        pct = round1(pred7 * Math.min(days / 7, 3));
        source = pred5Curve != null ? "curve_model" : "pred_horizon";
      } else if (pred5 != null && pred5 > 0 && (days == null || days <= 7)) {
        pct = round1(pred5);
        source = pred5Curve != null ? "curve_model" : "pred_horizon";
      } else if (pred5 != null && pred5 <= 0) {
        pct = round1(pred5);
        source = "curve_model";
      }
    }
  }

  const gainEur =
    pct != null && capital > 0 && Number.isFinite(capital)
      ? Math.round((capital * pct) / 100 * 100) / 100
      : null;

  let targetReturnPct: number | null = null;
  let daysToTarget: number | null = null;
  let targetMid: number | null = null;
  let targetHigh: number | null = null;

  const rise = resolveRiseTargetMetrics(
    dynamic,
    pct,
    daysRemaining,
    effSlopeModel,
    flatThr,
    row,
    options?.chartPoints,
  );
  if (rise.targetReturnPct != null && rise.targetReturnPct > 0) {
    targetReturnPct = rise.targetReturnPct;
    daysToTarget = rise.daysToTarget;
    targetMid = rise.targetMidPct;
    targetHigh = rise.targetHighPct;
  }

  const targetGainEur =
    targetReturnPct != null && capital > 0 && Number.isFinite(capital)
      ? Math.round((capital * targetReturnPct) / 100 * 100) / 100
      : null;

  return {
    expectedReturnPct: pct,
    expectedGainEur: gainEur,
    daysToCd: daysRemaining,
    source,
    targetReturnPct,
    targetGainEur,
    daysToTarget,
    targetMidPct: targetMid,
    targetHighPct: targetHigh,
    precatKind: precat.kind,
    targetProvisional: rise.targetProvisional ?? false,
    targetConfidencePct: rise.targetConfidencePct ?? null,
  };
}

/** Gain atteso sull'intero piano ingresso → CD (tab P&L «Plan at entry»). */
export function resolveEntryGainPlan(
  row: Record<string, unknown> | undefined,
  capital: number,
  holdDays: number | null,
  holdDaysElapsed: number | null,
  options?: Pick<ResolveExpectedGainPlanOptions, "chartPoints">,
): ExpectedGainPlan {
  const horizon =
    holdDays ??
    (() => {
      if (!row) return null;
      const rem = daysFromToday(String(row["Completion Date"] ?? ""));
      if (rem == null) return null;
      const el =
        holdDaysElapsed != null && Number.isFinite(holdDaysElapsed) ? holdDaysElapsed : 0;
      return rem + el;
    })();
  return resolveExpectedGainPlan(row, capital, {
    chartPoints: options?.chartPoints,
    horizonDays: horizon,
    curveSpan: horizon != null ? "entry_to_cd" : "forward",
    holdDaysElapsed,
  });
}

export function sortRowsByExpectedGain<
  T extends { expectedGainPct?: number | null; targetGainPct?: number | null },
>(rows: T[]): T[] {
  const rank = (r: T) => r.targetGainPct ?? r.expectedGainPct ?? Number.NEGATIVE_INFINITY;
  return [...rows].sort((a, b) => rank(b) - rank(a));
}
