/**
 * Metrica unica «Successo consigli» — gerarchia esplicita tra live, paper e Simulation chiusa.
 */
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";
import { ADVICE_CALIB_MIN_SCORED_FOR_RATE } from "./investDecisionSimAdviceCalibration";
import type { ClosedSuccessMetrics } from "./portfolioSuccessBridge";

export const UNIFIED_ADVICE_CLOSED_MIN_N = 8;

export type UnifiedAdvicePrimarySource =
  | "live_reliability"
  | "paper_precision"
  | "closed_sim"
  | "none";

export type UnifiedAdviceSuccess = {
  headlinePct: number | null;
  primarySource: UnifiedAdvicePrimarySource;
  live: {
    pct: number | null;
    good: number;
    bad: number;
    pending: number;
    scored: number;
  };
  paper: {
    pct: number | null;
    good: number;
    bad: number;
    scored: number;
  };
  closed: {
    pct: number | null;
    wins: number;
    losses: number;
    n: number;
    lowSample: boolean;
    countsTowardHeadline: boolean;
  };
};

export function buildUnifiedAdviceSuccess(args: {
  live: AdviceCalibrationSummary;
  paperPrecisionPct?: number | null;
  paperGood?: number;
  paperBad?: number;
  closed?: ClosedSuccessMetrics | null;
}): UnifiedAdviceSuccess {
  const paperGood = args.paperGood ?? 0;
  const paperBad = args.paperBad ?? 0;
  const paperScored = paperGood + paperBad;
  const paperPct =
    args.paperPrecisionPct != null && Number.isFinite(args.paperPrecisionPct)
      ? args.paperPrecisionPct
      : paperScored > 0
        ? Math.round((paperGood / paperScored) * 1000) / 10
        : null;

  const closed = args.closed;
  const closedLowSample = closed?.lowSample ?? (closed?.sampleSize ?? 0) < UNIFIED_ADVICE_CLOSED_MIN_N;
  const closedCounts = Boolean(closed && !closedLowSample && closed.winRatePct != null);

  let primarySource: UnifiedAdvicePrimarySource = "none";
  let headlinePct: number | null = null;

  if (
    args.live.overallSuccessRatePct != null &&
    args.live.scoredCount >= ADVICE_CALIB_MIN_SCORED_FOR_RATE
  ) {
    primarySource = "live_reliability";
    headlinePct = args.live.overallSuccessRatePct;
  } else if (paperPct != null && paperScored > 0) {
    primarySource = "paper_precision";
    headlinePct = paperPct;
  } else if (closedCounts) {
    primarySource = "closed_sim";
    headlinePct = closed!.winRatePct;
  }

  return {
    headlinePct,
    primarySource,
    live: {
      pct: args.live.overallSuccessRatePct,
      good: args.live.goodCount,
      bad: args.live.badCount,
      pending: args.live.pendingCount,
      scored: args.live.scoredCount,
    },
    paper: {
      pct: paperPct,
      good: paperGood,
      bad: paperBad,
      scored: paperScored,
    },
    closed: {
      pct: closed?.winRatePct ?? null,
      wins: closed?.winCount ?? 0,
      losses: closed?.lossCount ?? 0,
      n: closed?.sampleSize ?? 0,
      lowSample: closedLowSample,
      countsTowardHeadline: closedCounts,
    },
  };
}

function primarySourceLabel(source: UnifiedAdvicePrimarySource, lang: "it" | "en"): string {
  if (source === "live_reliability") {
    return lang === "it" ? "Affidabilità live (24h · P(plan))" : "Live reliability (24h · P(plan))";
  }
  if (source === "paper_precision") {
    return lang === "it" ? "Score paper sim (tick)" : "Paper sim score (ticks)";
  }
  if (source === "closed_sim") {
    return lang === "it" ? "Simulation chiusure (round-trip)" : "Closed Simulation (round-trip)";
  }
  return lang === "it" ? "Dati insufficienti" : "Insufficient data";
}

export function unifiedAdviceSuccessSub(
  unified: UnifiedAdviceSuccess,
  lang: "it" | "en",
): string {
  const parts: string[] = [];
  if (unified.live.scored > 0) {
    parts.push(
      lang === "it"
        ? `live ${unified.live.good}✓ ${unified.live.bad}✗${unified.live.pending > 0 ? ` · ${unified.live.pending} att.` : ""}`
        : `live ${unified.live.good}✓ ${unified.live.bad}✗${unified.live.pending > 0 ? ` · ${unified.live.pending} pend.` : ""}`,
    );
  }
  if (unified.paper.scored > 0 && unified.paper.pct != null) {
    parts.push(
      lang === "it"
        ? `paper ${unified.paper.pct}% (${unified.paper.good}✓/${unified.paper.bad}✗ tick)`
        : `paper ${unified.paper.pct}% (${unified.paper.good}✓/${unified.paper.bad}✗ ticks)`,
    );
  }
  if (unified.closed.n > 0 && unified.closed.pct != null) {
    if (unified.closed.lowSample) {
      parts.push(
        lang === "it"
          ? `sim chiusi ${unified.closed.pct}% (n=${unified.closed.n}, non pesato)`
          : `closed sim ${unified.closed.pct}% (n=${unified.closed.n}, not weighted)`,
      );
    } else {
      parts.push(
        lang === "it"
          ? `sim chiusi ${unified.closed.pct}% (n=${unified.closed.n})`
          : `closed sim ${unified.closed.pct}% (n=${unified.closed.n})`,
      );
    }
  }
  if (!parts.length) {
    return lang === "it" ? "Nessun esito valutato ancora" : "No scored outcomes yet";
  }
  return parts.join(" · ");
}

export function unifiedAdviceSuccessTooltip(
  unified: UnifiedAdviceSuccess,
  lang: "it" | "en",
): string {
  const headline =
    unified.headlinePct != null
      ? `${unified.headlinePct}% — ${primarySourceLabel(unified.primarySource, lang)}`
      : primarySourceLabel("none", lang);

  if (lang === "it") {
    return [
      `Successo consigli (unificato): ${headline}.`,
      "Priorità: (1) direzione live vs Var.24h + grafico P(plan); (2) tick paper sim; (3) Simulation chiusa solo con ≥8 round-trip.",
      unified.closed.lowSample && unified.closed.n > 0
        ? `Attenzione: solo ${unified.closed.n} chiusure — il ${unified.closed.pct}% sim non sostituisce live/paper.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `Unified advice success: ${headline}.`,
    "Priority: (1) live direction vs 24h + P(plan) chart; (2) paper sim ticks; (3) closed Simulation only with ≥8 round-trips.",
    unified.closed.lowSample && unified.closed.n > 0
      ? `Note: only ${unified.closed.n} closes — ${unified.closed.pct}% sim does not override live/paper.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
