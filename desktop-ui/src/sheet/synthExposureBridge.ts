/**
 * Synth exposure bridge — traduce gap synth vs capitale reale in trim / review / sell,
 * rispettando recovery guards (P(recovery), curva ↑, Top2 wait).
 *
 * Soglie (diverse dagli esempi €50 / 80% / 45–55):
 * - dust già allineato: €80
 * - capitale minimo significativo: €500
 * - gap trim → REVIEW: 70%
 * - gap sell candidato: 85%
 * - quota synth quasi zero: 2.5%
 * - P(recovery) sell synth-only: ≤40% (hold guard resta 55%)
 */
import type { TickerSimEvaluation } from "./investDecisionSimLoop";
import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import { portfolioExitRecoveryGuardsActive } from "./portfolioDeclineSell";
import { resolvePortfolioSynthTargetEur } from "./synthCapitalSyncLog";

type SuggestedActionKind = TickerSimEvaluation["suggestedAction"];

/** Capitale già allineato al target synth — nessun bridge. */
export const SYNTH_BRIDGE_DUST_CAPITAL_EUR = 80;

/** Capitale minimo per attivare il bridge (sotto = rumore operativo). */
export const SYNTH_BRIDGE_MIN_CAPITAL_EUR = 500;

/** Quota synth sotto la quale il target è trattato come quasi zero. */
export const SYNTH_BRIDGE_NEAR_ZERO_SHARE = 0.025;

/** (actual − target) / actual — soglia REVIEW trim in Actions. */
export const SYNTH_BRIDGE_GAP_TRIM_MIN = 0.7;

/** Gap elevato — candidato a SELL se anche exit/prob lo consentono. */
export const SYNTH_BRIDGE_GAP_SELL_MIN = 0.85;

/** Sotto questa P(recovery) il gap synth può confermare SELL (non synth-only cieco). */
export const SYNTH_BRIDGE_P_RECOVERY_SELL_MAX = 40;

export type SynthExposureKind = "none" | "trim_review" | "trim_sell" | "sell_confirm";

export function isSynthExposureUrgentAlert(row: {
  hasPosition?: boolean;
  inPaperPortfolio?: boolean;
  profile?: string;
  synthExposureKind?: SynthExposureKind;
}): boolean {
  if (!row.hasPosition || row.inPaperPortfolio || row.profile !== "portfolio") return false;
  return (
    row.synthExposureKind === "trim_review" ||
    row.synthExposureKind === "trim_sell" ||
    row.synthExposureKind === "sell_confirm"
  );
}

export type SynthExposureVerdict = {
  kind: SynthExposureKind;
  actualCapitalEur: number;
  synthTargetEur: number;
  synthShare: number | null;
  exposureGapRatio: number | null;
  blockedByRecoveryGuard: boolean;
};

export type SynthExposureBridgeInput = {
  rowKey: string;
  hasPosition: boolean;
  inPaperPortfolio: boolean;
  actualCapitalEur: number;
  totalPnlPct: number | null | undefined;
  baseSuggestedAction: SuggestedActionKind;
  item: PortfolioLossAnalysisItem | null | undefined;
  synthAlloc: SimLoopSynthAllocation | null | undefined;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Stessi recovery guards di deriveSuggestedAction / shouldHoldPortfolioExit. */
export function portfolioRecoveryGuardsActive(
  item: PortfolioLossAnalysisItem | null | undefined,
): boolean {
  if (!item?.hasPosition) return false;
  return portfolioExitRecoveryGuardsActive(item);
}

export function evaluateSynthExposureVerdict(
  input: SynthExposureBridgeInput,
): SynthExposureVerdict {
  const empty: SynthExposureVerdict = {
    kind: "none",
    actualCapitalEur: 0,
    synthTargetEur: 0,
    synthShare: null,
    exposureGapRatio: null,
    blockedByRecoveryGuard: false,
  };

  if (!input.hasPosition || input.inPaperPortfolio) return empty;
  const actual = roundEur(Math.max(0, input.actualCapitalEur));
  if (actual < SYNTH_BRIDGE_MIN_CAPITAL_EUR) return empty;

  const topCap = input.synthAlloc?.totalCapitalEur ?? 0;
  if (topCap <= 0) return empty;

  const synthTarget = resolvePortfolioSynthTargetEur(
    input.synthAlloc ?? null,
    input.rowKey,
    topCap,
    actual,
    input.totalPnlPct,
  );
  if (synthTarget == null) return empty;

  const target = roundEur(Math.max(0, synthTarget));
  const rawShare = input.synthAlloc?.portfolioDisplayShareByRowKey[input.rowKey];
  const displayShare =
    rawShare != null && Number.isFinite(rawShare) ? rawShare : null;
  if (actual <= SYNTH_BRIDGE_DUST_CAPITAL_EUR && target <= SYNTH_BRIDGE_DUST_CAPITAL_EUR) {
    return empty;
  }

  const alignedTol = Math.max(25, actual * 0.04);
  if (actual - target <= alignedTol) return empty;

  const gapRatio = (actual - target) / actual;
  if (!Number.isFinite(gapRatio) || gapRatio < SYNTH_BRIDGE_GAP_TRIM_MIN) return empty;

  const blocked = portfolioRecoveryGuardsActive(input.item);

  return {
    kind: "trim_review",
    actualCapitalEur: actual,
    synthTargetEur: target,
    synthShare: displayShare,
    exposureGapRatio: gapRatio,
    blockedByRecoveryGuard: blocked,
  };
}

export function applySynthExposureBridge(
  baseAction: SuggestedActionKind,
  input: SynthExposureBridgeInput,
): {
  suggestedAction: SuggestedActionKind;
  verdict: SynthExposureVerdict;
  rationaleIt: string | null;
  rationaleEn: string | null;
} {
  const verdict = evaluateSynthExposureVerdict(input);
  if (verdict.kind === "none") {
    return {
      suggestedAction: baseAction,
      verdict,
      rationaleIt: null,
      rationaleEn: null,
    };
  }

  const targetLabel = `€${verdict.synthTargetEur.toLocaleString("it-IT")}`;
  const targetLabelEn = `€${verdict.synthTargetEur.toLocaleString("en-US")}`;
  const rationaleIt = `Synth: riduci esposizione verso ${targetLabel} (capitale attuale €${verdict.actualCapitalEur.toLocaleString("it-IT")})`;
  const rationaleEn = `Synth: reduce exposure toward ${targetLabelEn} (current capital €${verdict.actualCapitalEur.toLocaleString("en-US")})`;

  if (verdict.blockedByRecoveryGuard) {
    return {
      suggestedAction: baseAction,
      verdict: { ...verdict, kind: "none" },
      rationaleIt: null,
      rationaleEn: null,
    };
  }

  if (baseAction === "sell") {
    return {
      suggestedAction: "sell",
      verdict: { ...verdict, kind: "sell_confirm" },
      rationaleIt,
      rationaleEn,
    };
  }

  const prob = input.item?.recoveryProbabilityPct;
  const exitLean =
    input.item?.exitDecision === "exit" || baseAction === "review";
  const lowRecovery = prob != null && prob <= SYNTH_BRIDGE_P_RECOVERY_SELL_MAX;
  const hugeGap =
    verdict.exposureGapRatio != null &&
    verdict.exposureGapRatio >= SYNTH_BRIDGE_GAP_SELL_MIN;

  if (hugeGap && lowRecovery && exitLean) {
    return {
      suggestedAction: "sell",
      verdict: { ...verdict, kind: "trim_sell" },
      rationaleIt: `${rationaleIt} · P(recovery) ${Math.round(prob!)}%`,
      rationaleEn: `${rationaleEn} · P(recovery) ${Math.round(prob!)}%`,
    };
  }

  if (baseAction === "buy") {
    return {
      suggestedAction: baseAction,
      verdict: { ...verdict, kind: "none" },
      rationaleIt: null,
      rationaleEn: null,
    };
  }

  return {
    suggestedAction: "review",
    verdict: { ...verdict, kind: "trim_review" },
    rationaleIt,
    rationaleEn,
  };
}

export function synthExposureRationale(
  verdict: SynthExposureVerdict,
  lang: "it" | "en",
  rationaleIt: string | null,
  rationaleEn: string | null,
): string | null {
  if (verdict.kind === "none") return null;
  return lang === "it" ? rationaleIt : rationaleEn;
}
