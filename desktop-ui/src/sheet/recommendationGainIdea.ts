/**
 * Stima guadagno atteso da raccomandazione — curva pred+ricalibrazione + aggiustamento MII.
 * Si ricalcola ad ogni refresh (curva e MII aggiornati).
 */
import type { ChartPoint } from "../types";
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  expectedGainEurFromPct,
  formatGainEurSigned,
  formatSignedPct,
} from "./expectedRoiDisplay";
import {
  forwardPred5PpFromRecalibCurve,
  plannedGainEurFromRecalibCurve,
} from "./predictionCurveDailyRecalib";
import { forwardRiseSegmentPeak } from "./simulationSparkline";
import { completionDateToNowOffset } from "./chartNowOffset";

export type RecommendationGainIdeaSource = "curve_peak" | "plan_target" | "pred5";

export type GainIdeaUnavailableReason =
  | "missing_sim_row"
  | "missing_chart_series"
  | "cd_passed"
  | "flat_curve"
  | "no_positive_target";

export type RecommendationGainIdea = {
  gainEur: number | null;
  returnPct: number | null;
  adjustedReturnPct: number | null;
  days: number | null;
  capitalEur: number;
  miiScale: number;
  provisional: boolean;
  source: RecommendationGainIdeaSource | "none";
  unavailableReason: GainIdeaUnavailableReason | null;
};

/** Scala guadagno atteso in base all'angolo MII (allineato a recoveryProbability factorMii). */
export function miiGainScale(angle: number | null | undefined): number {
  if (angle == null || !Number.isFinite(angle)) return 0.85;
  if (angle >= 5) return 1.08;
  if (angle >= 3) return 1;
  if (angle >= 0) return 0.92;
  if (angle >= -5) return 0.82;
  return Math.max(0.55, 0.82 + angle / 22);
}

function emptyGainIdea(
  capital: number,
  miiScale: number,
  provisional: boolean,
  unavailableReason: GainIdeaUnavailableReason,
): RecommendationGainIdea {
  return {
    gainEur: null,
    returnPct: null,
    adjustedReturnPct: null,
    days: null,
    capitalEur: capital,
    miiScale,
    provisional,
    source: "none",
    unavailableReason,
  };
}

function diagnoseGainIdeaUnavailable(args: {
  simRow: Record<string, unknown> | null | undefined;
  chartPoints: ChartPoint[] | null | undefined;
  planReturnPct?: number | null;
  daysToTarget?: number | null;
}): GainIdeaUnavailableReason {
  if (!args.simRow) {
    return "missing_sim_row";
  }
  if (!args.chartPoints?.length) {
    return "missing_chart_series";
  }
  const nowOff = completionDateToNowOffset(args.simRow["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) {
    return "cd_passed";
  }
  const peak = forwardRiseSegmentPeak(args.simRow, args.chartPoints);
  if (!peak || peak.returnPct <= 0.05) {
    const pred5 = forwardPred5PpFromRecalibCurve(args.simRow, args.chartPoints);
    if (pred5 == null || pred5 <= 0) {
      return "flat_curve";
    }
  }
  if (
    args.planReturnPct == null ||
    args.planReturnPct <= 0 ||
    args.daysToTarget == null ||
    args.daysToTarget <= 0
  ) {
    return "no_positive_target";
  }
  return "flat_curve";
}

export function gainIdeaUnavailableMessage(
  reason: GainIdeaUnavailableReason | null | undefined,
  lang: "it" | "en",
): string {
  const messages: Record<GainIdeaUnavailableReason, { it: string; en: string }> = {
    missing_sim_row: {
      it: "Stima non disponibile — riga simulazione assente per questo ticker.",
      en: "Estimate unavailable — no simulation row for this ticker.",
    },
    missing_chart_series: {
      it: "Stima non disponibile — curva pred+ricalibrazione non caricata per questo ticker.",
      en: "Estimate unavailable — pred+recalibration curve not loaded for this ticker.",
    },
    cd_passed: {
      it: "Stima non disponibile — CD già passata, nessun orizzonte forward.",
      en: "Estimate unavailable — completion date passed, no forward horizon.",
    },
    flat_curve: {
      it: "Stima non disponibile — curva piatta o in discesa verso la CD (nessun picco positivo).",
      en: "Estimate unavailable — flat or declining curve toward CD (no positive peak).",
    },
    no_positive_target: {
      it: "Stima non disponibile — target piano e Pred +5g non indicano un guadagno positivo.",
      en: "Estimate unavailable — plan target and Pred +5d show no positive gain.",
    },
  };
  if (reason && messages[reason]) {
    return messages[reason][lang];
  }
  return lang === "it"
    ? "Stima non disponibile — servono curva pred+ricalibrazione e orizzonte positivo."
    : "Estimate unavailable — need pred+recalibration curve and a positive horizon.";
}

export function computeRecommendationGainIdea(args: {
  simRow: Record<string, unknown> | null | undefined;
  chartPoints: ChartPoint[] | null | undefined;
  capitalEur?: number;
  miiAngleDeg?: number | null;
  planReturnPct?: number | null;
  daysToTarget?: number | null;
  daysToCurvePeak?: number | null;
  curvePeakReturnPct?: number | null;
  suggestedAction?: string;
  holdDaysElapsed?: number | null;
  targetProvisional?: boolean;
}): RecommendationGainIdea {
  const capital =
    args.capitalEur != null && args.capitalEur > 0 ? args.capitalEur : DEFAULT_PLAN_CAPITAL_EUR;
  const miiScale = miiGainScale(args.miiAngleDeg);
  const holdDays = args.holdDaysElapsed ?? 0;

  let days: number | null = null;
  let returnPct: number | null = null;
  let source: RecommendationGainIdeaSource | "none" = "none";
  let provisional = Boolean(args.targetProvisional);

  if (args.simRow && args.chartPoints?.length) {
    const peak = forwardRiseSegmentPeak(args.simRow, args.chartPoints);
    if (peak && peak.returnPct > 0) {
      days = peak.days;
      returnPct = peak.returnPct;
      source = "curve_peak";
    }
  }

  if (returnPct == null && args.curvePeakReturnPct != null && args.daysToCurvePeak != null) {
    if (args.curvePeakReturnPct > 0 && args.daysToCurvePeak > 0) {
      returnPct = args.curvePeakReturnPct;
      days = args.daysToCurvePeak;
      source = "curve_peak";
    }
  }

  if (returnPct == null && args.planReturnPct != null && args.daysToTarget != null) {
    if (args.planReturnPct > 0 && args.daysToTarget > 0) {
      returnPct = args.planReturnPct;
      days = args.daysToTarget;
      source = "plan_target";
    }
  }

  if (returnPct == null && args.simRow && args.chartPoints?.length) {
    const pred5 = forwardPred5PpFromRecalibCurve(args.simRow, args.chartPoints);
    if (pred5 != null && pred5 > 0) {
      returnPct = pred5;
      days = 5;
      source = "pred5";
    }
  }

  const action = args.suggestedAction?.trim().toLowerCase();
  if (action === "sell" && returnPct != null && returnPct > 0) {
    returnPct = Math.round(returnPct * 0.35 * 10) / 10;
  }

  if (returnPct == null || days == null || days <= 0 || returnPct <= 0) {
    return emptyGainIdea(
      capital,
      miiScale,
      provisional,
      diagnoseGainIdeaUnavailable(args),
    );
  }

  let rawGainEur =
    args.simRow && args.chartPoints?.length
      ? plannedGainEurFromRecalibCurve(args.simRow, args.chartPoints, capital, holdDays, days)
      : null;
  if (rawGainEur == null || !Number.isFinite(rawGainEur)) {
    rawGainEur = expectedGainEurFromPct(returnPct, capital);
  }

  const adjustedReturnPct = Math.round(returnPct * miiScale * 10) / 10;
  const gainEur =
    rawGainEur != null
      ? Math.round(rawGainEur * miiScale * 100) / 100
      : expectedGainEurFromPct(adjustedReturnPct, capital);

  if (gainEur == null || gainEur <= 0) {
    return emptyGainIdea(capital, miiScale, provisional, "no_positive_target");
  }

  return {
    gainEur,
    returnPct,
    adjustedReturnPct,
    days,
    capitalEur: capital,
    miiScale,
    provisional,
    source,
    unavailableReason: null,
  };
}

export function recommendationGainIdeaTooltip(
  idea: RecommendationGainIdea,
  lang: "it" | "en",
  miiAngleDeg?: number | null,
): string {
  if (idea.gainEur == null || idea.days == null) {
    return gainIdeaUnavailableMessage(idea.unavailableReason, lang);
  }
  const mii =
    miiAngleDeg != null && Number.isFinite(miiAngleDeg)
      ? `MII ${miiAngleDeg >= 0 ? "+" : ""}${miiAngleDeg.toFixed(1)}° · ×${idea.miiScale.toFixed(2)}`
      : `MII ×${idea.miiScale.toFixed(2)}`;
  const src =
    idea.source === "curve_peak"
      ? lang === "it"
        ? "Picco curva pred+ricalib."
        : "Pred+recalib curve peak"
      : idea.source === "pred5"
        ? lang === "it"
          ? "Pred +5g ricalibrata"
          : "Recalib Pred +5d"
        : lang === "it"
          ? "Target piano"
          : "Plan target";
  if (lang === "it") {
    return `${src} · ${formatSignedPct(idea.returnPct)} → ${formatSignedPct(idea.adjustedReturnPct)} (${mii}) · ${formatGainEurSigned(idea.gainEur)} su €${idea.capitalEur.toLocaleString("it-IT")} in ~${idea.days}g${idea.provisional ? " · provvisorio watch zone" : ""}.`;
  }
  return `${src} · ${formatSignedPct(idea.returnPct)} → ${formatSignedPct(idea.adjustedReturnPct)} (${mii}) · ${formatGainEurSigned(idea.gainEur)} on €${idea.capitalEur.toLocaleString("en-US")} in ~${idea.days}d${idea.provisional ? " · provisional watch zone" : ""}.`;
}

export function formatRecommendationGainIdeaShort(
  idea: RecommendationGainIdea,
  lang: "it" | "en",
): string {
  if (idea.gainEur == null || idea.days == null) return "—";
  const eur = formatGainEurSigned(idea.gainEur);
  return lang === "it" ? `${eur} in ${idea.days}g` : `${eur} in ${idea.days}d`;
}
