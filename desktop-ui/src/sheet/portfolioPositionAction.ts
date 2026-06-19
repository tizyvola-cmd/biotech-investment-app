/**
 * Azione unificata per posizioni in portafoglio — colore + icona + Top 2 SELL.
 *
 * | Azione | Colore | Icona chip | Significato |
 * |--------|--------|------------|-------------|
 * | gain   | verde  | 🐷 / 👑🐷  | P&L positivo |
 * | flat   | grigio | —          | P&L ~0 |
 * | hold   | giallo | ⏳         | In perdita ma curva ↑ verso target — attendi |
 * | sell   | rosso  | 🐔         | In perdita + pendenza ↓ — vendita raccomandata |
 */
import type { ChartPoint } from "../types";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import {
  declineInputFromSignalLike,
  isCurveRisingForHold,
  isSustainedDeclineSell,
} from "./portfolioDeclineSell";
import {
  portfolioPnlTone,
  resolvePortfolioTableOutlook,
  type PortfolioTableOutlook,
} from "./portfolioGainLossStyle";
import type { StabilityVerdict } from "./slopeStability";

export type PortfolioPositionAction = "gain" | "flat" | "hold" | "sell";

export type PortfolioPositionActionInput = {
  pnlEur?: number | null;
  pnlPct?: number | null;
  planReturnPct?: number | null;
  planCdReturnPct?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  slope45d?: number | null;
  pred5?: number | null;
  stabilityVerdict?: StabilityVerdict;
  slopeRotationFlag?: 0 | 1;
  simRow?: Record<string, unknown> | null;
  chartPoints?: ChartPoint[] | null;
  inPortfolio?: boolean;
};

export function portfolioChipToneFromAction(
  action: PortfolioPositionAction,
): "gain" | "loss" | "flat" | "warn" {
  if (action === "hold") return "warn";
  if (action === "sell") return "loss";
  if (action === "gain") return "gain";
  return "flat";
}

export function portfolioTableOutlookFromAction(
  action: PortfolioPositionAction,
): PortfolioTableOutlook {
  if (action === "hold") return "warn";
  if (action === "sell") return "loss";
  if (action === "gain") return "gain";
  return "flat";
}

/** Stessa logica di Top 2 SELL (verdict yes = sell, wait = hold). */
export function resolvePortfolioPositionAction(
  params: PortfolioPositionActionInput,
): PortfolioPositionAction {
  const pnlTone = portfolioPnlTone(params.pnlEur, params.pnlPct);
  if (pnlTone === "gain") return "gain";
  if (pnlTone === "flat") return "flat";

  const declineCtx = declineInputFromSignalLike({
    planReturnPct: params.planReturnPct ?? null,
    planCdReturnPct: params.planCdReturnPct ?? null,
    pred5: params.pred5 ?? null,
    slope5d: params.slope5d ?? null,
    slope20d: params.slope20d ?? null,
    slope45d: params.slope45d ?? null,
    stabilityVerdict: params.stabilityVerdict,
    slopeRotationFlag: params.slopeRotationFlag,
    simRow: params.simRow ?? undefined,
  });

  if (isCurveRisingForHold(declineCtx)) return "hold";

  const outlook = resolvePortfolioTableOutlook({
    inPortfolio: params.inPortfolio !== false,
    pnlEur: params.pnlEur,
    pnlPct: params.pnlPct,
    planReturnPct: params.planReturnPct ?? null,
    slope5d: declineCtx.slope5d,
    slope20d: declineCtx.slope20d,
    simRow: params.simRow ?? undefined,
    chartPoints: params.chartPoints ?? undefined,
  });

  if (outlook === "warn") return "hold";
  if (isSustainedDeclineSell(declineCtx)) return "sell";
  if (outlook === "loss") return "sell";

  const plan = params.planReturnPct;
  if (plan != null && plan > 0) return "hold";
  return "sell";
}

export function resolvePortfolioPositionActionForRow(
  row: Record<string, unknown> | null | undefined,
  pnl: { pnlEur?: number | null; pnlPct?: number | null },
  chartPoints?: ChartPoint[] | null,
  capitalEur = 5000,
): PortfolioPositionAction {
  if (!row) {
    const tone = portfolioPnlTone(pnl.pnlEur, pnl.pnlPct);
    if (tone === "gain") return "gain";
    if (tone === "flat") return "flat";
    return "sell";
  }

  const plan = resolveExpectedGainPlan(row, capitalEur, { chartPoints });
  const planReturnPct = plan.targetReturnPct ?? plan.expectedReturnPct ?? null;

  return resolvePortfolioPositionAction({
    pnlEur: pnl.pnlEur,
    pnlPct: pnl.pnlPct,
    planReturnPct: planReturnPct ?? null,
    planCdReturnPct: plan.expectedReturnPct ?? null,
    simRow: row,
    chartPoints,
    inPortfolio: true,
  });
}
