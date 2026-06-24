import { useMemo } from "react";
import {
  buildExperimentPiggyBank,
  type ExperimentPiggyBank,
} from "../sheet/investDecisionSimExperiment";
import type { PaperPosition, TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import {
  sanitizeLiveExperimentPiggy,
  type SanitizedLivePiggy,
} from "../sheet/decisionSimPnlResolve";

export function useLiveExperimentPiggy(
  paperPortfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  cumulativePaperPnlEur: number,
  closedTradeCount: number,
): SanitizedLivePiggy & { raw: ExperimentPiggyBank } {
  return useMemo(() => {
    const raw = buildExperimentPiggyBank(
      paperPortfolio,
      evaluations,
      cumulativePaperPnlEur,
      closedTradeCount,
    );
    const sanitized = sanitizeLiveExperimentPiggy(raw, cumulativePaperPnlEur);
    return { ...sanitized, raw };
  }, [paperPortfolio, evaluations, cumulativePaperPnlEur, closedTradeCount]);
}
