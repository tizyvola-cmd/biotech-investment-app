import type { DecisionScoreInput } from "./decisionChartLogic";
import { aggregateRiskScore } from "./mobileDecisionChartBuild";

/** Suggested % of portfolio capital for a BUY pick (risk-adjusted). */
export function suggestedInvestPctForBuy(scores: DecisionScoreInput): number {
  const base = 12;
  const risk = aggregateRiskScore(scores);
  let pct = base;
  if (scores.pplan != null) pct += Math.max(0, scores.pplan - 60) * 0.1;
  if (scores.sds != null) pct += Math.max(0, scores.sds - 55) * 0.06;
  if (risk != null) pct -= Math.max(0, risk - 35) * 0.14;
  if (scores.regRisk != null && scores.regRisk > 55) pct -= (scores.regRisk - 55) * 0.1;
  return Math.round(Math.max(4, Math.min(22, pct)));
}

export function suggestedInvestEur(totalCapital: number, pct: number): number {
  if (totalCapital <= 0) return 0;
  return Math.round((totalCapital * pct) / 100);
}
