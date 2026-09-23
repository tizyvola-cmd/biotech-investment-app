import type { DecisionScoreInput } from "./decisionChartLogic";

export function buildOpportunityAlertMessage(
  scores: Pick<DecisionScoreInput, "pplan" | "regRisk" | "mcs">,
  pnlPct: number | null,
  isRescue: boolean,
  it = false,
): string | null {
  const mcsLow = scores.mcs != null && scores.mcs < 35;
  const regHigh = scores.regRisk != null && scores.regRisk >= 50;
  const pplanLow = scores.pplan != null && scores.pplan < 40;
  const pnlNeg = pnlPct != null && pnlPct < 0;

  if (isRescue && regHigh && mcsLow) {
    const mcsTxt = scores.mcs != null ? ` (${Math.round(scores.mcs)})` : "";
    return it
      ? `CRL attivo · MCS basso${mcsTxt} — causa interna probabile`
      : `Active CRL · low MCS${mcsTxt} — likely internal cause`;
  }
  if (mcsLow && pnlNeg) {
    return it
      ? "Contesto di mercato avverso — verifica causa calo"
      : "Adverse market context — verify drop cause";
  }
  if (pplanLow) {
    return it ? "P(plan) basso — segnale di uscita" : "Low P(plan) — exit signal";
  }
  if (isRescue && regHigh) {
    return it ? "CRL attivo — verifica rischio regolatorio" : "Active CRL — check regulatory risk";
  }
  return null;
}

export function buildRescueNote(isRescue: boolean, regHigh: boolean, it = false): string | null {
  if (!isRescue) return null;
  if (regHigh) return it ? "Rescue space · CRL attivo" : "Rescue space · active CRL";
  return it ? "Rescue space" : "Rescue space";
}
