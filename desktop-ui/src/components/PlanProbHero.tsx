import type { LossAnalysisProfile, LossExitDecision } from "../sheet/portfolioLossAnalysis";
import {
  decisionRecLabel,
  decisionRecTextClass,
  resolveHeroDecisionRec,
  type DecisionRec,
} from "../sheet/decisionChartLogic";
import { exitDecisionTextClass } from "../sheet/exitDecisionUi";
import { useLang, useT, type TranslationKey } from "../shared/i18n";

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
  if (suggestedAction === "review") return "sim.lossAnalysis.probAction.review";
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

function probTipKey(inLoss: boolean, hasPosition: boolean): TranslationKey {
  return hasPosition && inLoss
    ? "sim.lossAnalysis.recoveryProbTip"
    : "sim.lossAnalysis.entryProbTip";
}

export function PlanProbHero({
  probPct,
  entryProbPct,
  recoveryProbPct,
  decision,
  inLoss,
  hasPosition = true,
  profile = "portfolio",
  summary,
  variant = "hero",
  suggestedAction,
  exitDecision,
  decisionRec,
  buyGated = false,
}: {
  probPct: number | null;
  /** Entry P(plan) / affidabilità — shown as primary % under the action label. */
  entryProbPct?: number | null;
  /** P(recupero) — secondary line when in loss. */
  recoveryProbPct?: number | null;
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
  /** Raccomandazione decision chart (Buy/Hold/Review/Sell) — allineata al grafico sopra. */
  decisionRec?: DecisionRec | null;
  /**
   * Opportunity Register Buy is blocked (sim-loop gate). Demotes a chart Buy
   * label to Hold so the hero never contradicts the "Buy gated" badge (NRXP).
   */
  buyGated?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const primaryPct = entryProbPct ?? probPct;
  if (primaryPct == null) return null;

  const showRecoverySecondary =
    inLoss &&
    hasPosition &&
    recoveryProbPct != null &&
    Number.isFinite(recoveryProbPct) &&
    Math.round(recoveryProbPct) !== Math.round(primaryPct);

  const heroRec = resolveHeroDecisionRec(decisionRec, { buyGated });

  const displayDecision =
    suggestedAction === "buy" || suggestedAction === "sell" || suggestedAction === "hold"
      ? suggestedAction === "sell"
        ? "exit"
        : suggestedAction === "hold" || suggestedAction === "buy"
          ? "hold"
          : decision
      : decision;
  const color =
    heroRec != null
      ? decisionRecTextClass(heroRec)
      : recoveryProbHeroClass(displayDecision);
  /** Soft BUY + Register gated → keep Soft BUY wording (not Hold). */
  const action =
    heroRec != null
      ? buyGated && heroRec === "buy"
        ? "Soft BUY"
        : decisionRecLabel(heroRec, it)
      : t(probActionLabelKey(displayDecision, profile, hasPosition, inLoss, suggestedAction));
  const primaryLabel = `${action} ${primaryPct.toFixed(0)}%`;
  const recoveryLabel =
    showRecoverySecondary && recoveryProbPct != null
      ? t("sim.lossAnalysis.recoveryProb", { pct: recoveryProbPct.toFixed(0) })
      : null;
  const tipBase = summary ?? t(probTipKey(inLoss, hasPosition));
  const tip =
    buyGated && decisionRec === "buy"
      ? it
        ? `${tipBase}\nSoft BUY attivo — Register Buy ancora bloccato dal gate sim-loop (vedi badge).`
        : `${tipBase}\nSoft BUY active — Register Buy still blocked by sim-loop gate (see badge).`
      : tipBase;

  const showExitSignalSecondary =
    exitDecision === "exit" &&
    suggestedAction != null &&
    suggestedAction !== "sell" &&
    (suggestedAction === "hold" || suggestedAction === "review" || suggestedAction === "buy");

  if (variant === "table") {
    return (
      <div className="text-center min-w-[68px] leading-tight" title={tip}>
        <p className={`text-[13px] font-bold tabular-nums ${color}`}>{primaryLabel}</p>
        {recoveryLabel ? (
          <p className="text-[9px] font-semibold tabular-nums text-ink-muted">{recoveryLabel}</p>
        ) : null}
      </div>
    );
  }

  if (variant === "compact") {
    const recShort =
      showRecoverySecondary && recoveryProbPct != null
        ? it
          ? `P(rec.) ${recoveryProbPct.toFixed(0)}%`
          : `P(rec.) ${recoveryProbPct.toFixed(0)}%`
        : null;
    return (
      <div className="text-right flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0" title={tip}>
        <p className={`text-lg font-bold tabular-nums leading-none ${color}`}>{primaryLabel}</p>
        {recShort ? (
          <p className="text-[11px] font-semibold tabular-nums leading-none text-ink-muted">
            {recShort}
          </p>
        ) : recoveryLabel ? (
          <p className={`text-[10px] font-semibold tabular-nums leading-none ${color} opacity-90`}>
            {recoveryLabel}
          </p>
        ) : null}
        {showExitSignalSecondary ? (
          <p className="text-[8px] text-ink-muted/80 uppercase tracking-wide w-full text-right">
            {t("sim.lossAnalysis.probExitSignalSecondary")}: EXIT
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${variant === "hero" ? "text-right" : ""}`} title={tip}>
      <p className={`text-[26px] font-bold tabular-nums leading-none tracking-tight ${color}`}>
        {primaryLabel}
      </p>
      {recoveryLabel ? (
        <p className={`text-[13px] font-semibold tabular-nums leading-tight mt-1 ${color} opacity-90`}>
          {recoveryLabel}
        </p>
      ) : null}
      {showExitSignalSecondary ? (
        <p className="text-[9px] text-ink-muted/85 mt-1 uppercase tracking-wide">
          {t("sim.lossAnalysis.probExitSignalSecondary")}: EXIT
        </p>
      ) : null}
    </div>
  );
}
