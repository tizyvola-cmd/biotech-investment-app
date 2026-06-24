import type { StabilityVerdict } from "./slopeStability";

export type SlopeImpliedAction = "buy" | "sell" | "hold" | "review";

/** Azione operativa implicita nel verdetto slope (segnale intermedio, non arbitro). */
export function slopeVerdictImpliedAction(
  verdict: StabilityVerdict,
  curveRisingHold = false,
): SlopeImpliedAction | null {
  if (verdict === "none" && curveRisingHold) return "hold";
  if (verdict === "exit" || verdict === "avoid") return "sell";
  if (verdict === "watch") return "review";
  if (verdict === "entry") return "buy";
  if (verdict === "persistent") return "hold";
  return null;
}

export function slopeVerdictDisagreesWithFinalAction(
  verdict: StabilityVerdict,
  suggestedAction: string | null | undefined,
  curveRisingHold = false,
): boolean {
  if (!suggestedAction || suggestedAction === "none") return false;
  const implied = slopeVerdictImpliedAction(verdict, curveRisingHold);
  if (!implied || implied === suggestedAction) return false;
  if (implied === "sell" && (suggestedAction === "hold" || suggestedAction === "buy")) {
    return true;
  }
  if (implied === "buy" && suggestedAction === "sell") return true;
  if (implied === "review" && suggestedAction === "sell") return true;
  return false;
}

export function suggestedActionDisplayLabel(
  action: string | null | undefined,
  lang: "it" | "en",
  hasPosition = false,
): string {
  if (!action || action === "none") return "—";
  if (action === "buy" && hasPosition) {
    return lang === "it" ? "MANTIENI" : "HOLD";
  }
  switch (action) {
    case "buy":
      return "BUY";
    case "sell":
      return "SELL";
    case "hold":
      return "HOLD";
    case "review":
      return lang === "it" ? "REVIEW" : "REVIEW";
    default:
      return String(action).toUpperCase();
  }
}
