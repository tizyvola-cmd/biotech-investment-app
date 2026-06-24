import type { LossAnalysisProfile, LossExitDecision } from "../sheet/portfolioLossAnalysis";
import { exitDecisionTextClass } from "../sheet/exitDecisionUi";
import { useT, type TranslationKey } from "../shared/i18n";

function recoveryProbHeroClass(decision: LossExitDecision): string {
  return exitDecisionTextClass(decision);
}

function probActionLabelKey(
  decision: LossExitDecision,
  profile: LossAnalysisProfile,
  hasPosition: boolean,
  inLoss: boolean,
  suggestedAction?: "buy" | "sell" | "hold" | "review" | "none",
): TranslationKey {
  if (suggestedAction === "buy") {
    return hasPosition
      ? "sim.lossAnalysis.probAction.hold"
      : "recommendationAlert.probAction.buy";
  }
  if (suggestedAction === "sell") return "sim.lossAnalysis.probAction.exit";
  if (suggestedAction === "hold") return "sim.lossAnalysis.probAction.hold";
  if (profile === "opportunities" || !hasPosition) {
    if (decision === "hold") return "sim.lossAnalysis.probAction.enterNow";
    if (decision === "exit") return "sim.lossAnalysis.probAction.skipEntry";
    return "sim.lossAnalysis.probAction.waitEntry";
  }
  if (decision === "hold") return "sim.lossAnalysis.probAction.hold";
  if (decision === "exit") return "sim.lossAnalysis.probAction.exit";
  return inLoss
    ? "sim.lossAnalysis.probAction.review"
    : "sim.lossAnalysis.probAction.waitEntry";
}

function probLabelKey(inLoss: boolean, hasPosition: boolean): TranslationKey {
  return hasPosition && inLoss
    ? "sim.lossAnalysis.recoveryProb"
    : "sim.lossAnalysis.entryProb";
}

function probTipKey(inLoss: boolean, hasPosition: boolean): TranslationKey {
  return hasPosition && inLoss
    ? "sim.lossAnalysis.recoveryProbTip"
    : "sim.lossAnalysis.entryProbTip";
}

export function PlanProbHero({
  probPct,
  decision,
  inLoss,
  hasPosition = true,
  profile = "portfolio",
  summary,
  variant = "hero",
  suggestedAction,
  exitDecision,
}: {
  probPct: number | null;
  decision: LossExitDecision;
  inLoss: boolean;
  hasPosition?: boolean;
  profile?: LossAnalysisProfile;
  summary?: string | null;
  variant?: "hero" | "compact" | "table";
  /** Azione sim loop — sovrascrive label/color se presente. */
  suggestedAction?: "buy" | "sell" | "hold" | "review" | "none";
  /** Segnale exit layer quando diverge da suggestedAction (brief P1-B). */
  exitDecision?: LossExitDecision;
}) {
  const t = useT();
  if (probPct == null) return null;

  const showExitSignalSecondary =
    exitDecision === "exit" &&
    suggestedAction != null &&
    suggestedAction !== "sell" &&
    (suggestedAction === "hold" || suggestedAction === "review" || suggestedAction === "buy");

  const displayDecision =
    suggestedAction === "buy" || suggestedAction === "sell" || suggestedAction === "hold"
      ? suggestedAction === "sell"
        ? "exit"
        : suggestedAction === "hold" || suggestedAction === "buy"
          ? "hold"
          : decision
      : decision;
  const color = recoveryProbHeroClass(displayDecision);
  const action = t(
    probActionLabelKey(displayDecision, profile, hasPosition, inLoss, suggestedAction),
  );
  const label = t(probLabelKey(inLoss, hasPosition), { pct: probPct.toFixed(0) });
  const tip = summary ?? t(probTipKey(inLoss, hasPosition));

  if (variant === "table") {
    return (
      <div className="text-center min-w-[68px] leading-tight" title={tip}>
        <p className={`text-[8px] font-bold uppercase tracking-wide ${color}`}>{action}</p>
        <p className={`text-[13px] font-bold tabular-nums ${color}`}>{probPct.toFixed(0)}%</p>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="text-right" title={tip}>
        <p className={`text-[9px] font-bold uppercase tracking-wide leading-tight mb-0.5 ${color}`}>
          {action}
        </p>
        <p className={`text-lg font-bold tabular-nums leading-none ${color}`}>{label}</p>
        {showExitSignalSecondary ? (
          <p className="text-[8px] text-ink-muted/80 mt-0.5 uppercase tracking-wide">
            {t("sim.lossAnalysis.probExitSignalSecondary")}: EXIT
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${variant === "hero" ? "text-right" : ""}`} title={tip}>
      <p className={`text-[10px] font-bold uppercase tracking-wide leading-tight mb-1 ${color}`}>
        {action}
      </p>
      <p className={`text-[26px] font-bold tabular-nums leading-none tracking-tight ${color}`}>
        {label}
      </p>
      {showExitSignalSecondary ? (
        <p className="text-[9px] text-ink-muted/85 mt-1 uppercase tracking-wide">
          {t("sim.lossAnalysis.probExitSignalSecondary")}: EXIT
        </p>
      ) : null}
    </div>
  );
}
