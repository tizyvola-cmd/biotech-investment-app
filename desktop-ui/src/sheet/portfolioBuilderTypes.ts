// Shared types for the Portfolio Builder Lab — kept separate from the React view
// so they can be imported by the simulation engine without pulling React deps.

export type PortfolioStrategy = "conservative" | "balanced" | "aggressive";

export type PortfolioBuilderDeal = {
  ticker: string;
  company: string;
  raScore: number | null;
  sdsScore: number | null;
  phase: string;
  daysToCD: number;
  suggestedCapital: number;
  selectedCapital: number;
  selected: boolean;
  planProbPct: number;
  planReturnPct: number;
  currPriceUsd: number | null;
  inPortfolio: boolean;
  sector?: string;
};

export type PortfolioBuilderConfig = {
  strategy: PortfolioStrategy;
  maxWeightPerDeal: number;
  maxWeightPerSector: number;
  rebalanceTrigger: number;
  stopLossPct: number;
  takeProfitPct: number;
  diversificationTarget: {
    earlyStage: number;
    midStage: number;
    lateStage: number;
  };
};

export type SimulationEvent = {
  day: number;
  type: "buy" | "sell" | "rebalance" | "stop-loss" | "take-profit";
  ticker: string;
  priceBefore: number;
  priceAfter: number;
  pnlEur: number;
  reason: string;
};

export type SimulationDaySnapshot = {
  day: number;
  nPositions: number;
  totalPnlEur: number;
  dailyPnlEur: number;
  events: SimulationEvent[];
  portfolioValue: number;
};

export type PortfolioSimulationResult = {
  days: SimulationDaySnapshot[];
  finalPnlEur: number;
  maxDrawdownEur: number;
  winRate: number;
  avgHoldDays: number;
  sharpeRatio: number;
  profitFromRebalancing: number;
  lossSaved: number;
};

export const STRATEGY_PRESETS: Record<PortfolioStrategy, PortfolioBuilderConfig> = {
  conservative: {
    strategy: "conservative",
    maxWeightPerDeal: 25,
    maxWeightPerSector: 40,
    rebalanceTrigger: 15,
    stopLossPct: 20,
    takeProfitPct: 30,
    diversificationTarget: { earlyStage: 15, midStage: 70, lateStage: 15 },
  },
  balanced: {
    strategy: "balanced",
    maxWeightPerDeal: 20,
    maxWeightPerSector: 35,
    rebalanceTrigger: 12,
    stopLossPct: 18,
    takeProfitPct: 25,
    diversificationTarget: { earlyStage: 20, midStage: 60, lateStage: 20 },
  },
  aggressive: {
    strategy: "aggressive",
    maxWeightPerDeal: 15,
    maxWeightPerSector: 30,
    rebalanceTrigger: 10,
    stopLossPct: 15,
    takeProfitPct: 20,
    diversificationTarget: { earlyStage: 30, midStage: 50, lateStage: 20 },
  },
};
