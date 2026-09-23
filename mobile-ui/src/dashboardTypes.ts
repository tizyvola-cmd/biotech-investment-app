import type { MobileManualEisRow } from "./manualFeedStore";

export type MobileDashboardUpcomingRow = {
  ticker: string;
  cd: string;
  days: number | null;
  pred7: number | null;
  companyName: string | null;
  nct: string | null;
  studyHref: string | null;
};

export type MobileDashboardRecRow = {
  key: string;
  ticker: string;
  action: string;
  probPct: number | null;
  reason: string | null;
  readingPct: number | null;
  readingCurrentTs?: string | null;
  planReturnPct: number | null;
  profile: "portfolio" | "opportunity";
  daysToCd: number | null;
  companyName?: string | null;
  currPriceUsd?: number | null;
  gainIdeaText?: string | null;
  scorePct?: number | null;
  isNew?: boolean;
  eisScore?: number | null;
  eisHint?: string | null;
  targetPriceUsd?: number | null;
  targetMode?: "rise" | "fall" | "flat" | null;
  daysToTarget?: number | null;
  curvePoints?: { offset: number; val: number }[];
  curveCharts?: MobileCurveChartsPayload | null;
};

export type MobileCurveChartsPayload = {
  polygon: {
    matchPct: number;
    verdictLabel: string;
    arcPositionLabel: string;
    segmentLabel: string;
    labels: string[];
    radarCurrent: number[];
    radarTarget: number[];
    axes: Array<{ label: string; currentText: string; targetText: string }>;
  } | null;
  predBlend: Array<{ offset: number; label: string; model: number | null; blend: number | null }> | null;
  predCaption: string | null;
  slopeTrajectory: Array<{
    offset: number;
    label: string;
    pred: number | null;
    actual: number | null;
  }> | null;
  todayOffset: number | null;
  slope5d: number | null;
  slope20d: number | null;
  dailyMovePct: number | null;
  gainPlan: Array<{
    day: number;
    planned: number | null;
    actual: number | null;
    historical: number | null;
  }> | null;
  gainPlanHypothetical: boolean;
  marketModel: {
    miiDeg: number | null;
    modelDeg: number | null;
    preModelDeg?: number | null;
    postModelDeg?: number | null;
    gapPct?: number | null;
  } | null;
};

export type MobileDashboardAiFeedRow = {
  id: string;
  ticker: string;
  eventDate: string;
  title: string;
  delta1d: number | null;
  eis: number | null;
  verified: boolean;
  /** Saved from manual feed box (desktop). */
  manual?: boolean;
};

export type MobilePortfolioCheckSnapshotRow = {
  key: string;
  ticker: string;
  ppi: number | null;
  probPct: number | null;
  gainIdeaText: string | null;
  planReturnPct?: number | null;
  daysToTarget?: number | null;
};

export type PortfolioCheckEnrich = {
  portfolioCheck?: MobilePortfolioCheckSnapshotRow[];
  recommendations?: MobileDashboardRecRow[];
};

export type MobileDashboardSnapshot = {
  version: number;
  updated_at: string | null;
  source?: string;
  hero?: {
    portfolioCount: number;
    opportunityCount: number;
    totalCapital: number;
    nextCdDaysPortfolio: number | null;
    nextCdDaysOpportunities: number | null;
    aiFeedRecentCount: number;
  };
  recommendations?: MobileDashboardRecRow[];
  upcoming?: {
    portfolio: MobileDashboardUpcomingRow[];
    topOpps: MobileDashboardUpcomingRow[];
  };
  aiFeed?: MobileDashboardAiFeedRow[];
  /** Precomputed portfolio 24h-check rows (desktop sync). */
  portfolioCheck?: MobilePortfolioCheckSnapshotRow[];
  /** Decision chart rows — computed on desktop / VPS refresh (option A). */
  decisionChartRows?: import("./decisionChartLogic").DecisionChartTickerRow[];
  /** Portfolio / hot / watch slices — same as desktop Loss Analysis views. */
  decisionChartViews?: {
    portfolio: import("./decisionChartLogic").DecisionChartTickerRow[];
    oppHot: import("./decisionChartLogic").DecisionChartTickerRow[];
    oppWatch: import("./decisionChartLogic").DecisionChartTickerRow[];
  };
  /** Default tab — published from desktop (matches Loss Analysis CD window). */
  decisionChartScope?: "portfolio" | "oppHot" | "oppWatch";
  /** Curve charts by row key (polynomial, slopes, polygon). */
  curveChartsByKey?: Record<string, MobileCurveChartsPayload>;
  /** Daily gain ★ per ticker (colored sequence — synced from desktop). */
  gainStarsByTicker?: Record<string, import("./gainStarDisplay").GainStarSnapshot[]>;
  /** Latest manual EIS per ticker (feed box / EIS investigation). */
  manualEisByTicker?: Record<string, MobileManualEisRow>;
  /** MedTech ticker universe for device icon + relaxed opp filters. */
  medtechTickers?: string[];
  /** Open-book allocation pie — published from desktop Pulse (same capital %). */
  allocation?: Array<{
    key: string;
    ticker: string;
    capitalEur: number;
    pct: number;
  }>;
  /**
   * Soft BUY / Soft SELL — same lists as desktop Home Recommendations.
   * When present (incl. empty), mobile must not invent Soft Soft locally.
   */
  softBuys?: Array<{
    key: string;
    ticker: string;
    capitalMult?: number;
    suggestedCapitalEur?: number;
    gateTier?: "weak" | "mid" | "strong";
  }>;
  softSells?: Array<{
    key: string;
    ticker: string;
    tag?: "G2" | "giveback" | "soft_g1" | "cont_exh" | "hard";
    capitalEur?: number | null;
    pnlEur?: number | null;
  }>;
  /** Live desktop open book — preferred over stale VPS sim-inputs. */
  investSimInputs?: import("./types").InvestSimInputs;
  investSimInputsUpdatedAt?: string;
  /**
   * Open positions from desktop Pulse (same P&L / P(cont) / Rec).
   * Prefer over recomputing from a stale VPS Simulation sheet.
   */
  openPositions?: Array<{
    key: string;
    ticker: string;
    capitalEur: number;
    pnlEur: number;
    pnlPct: number;
    pnlEur24h?: number | null;
    pnlPct24h?: number | null;
    currPriceUsd?: number | null;
    pCont?: number | null;
    contBand?: string | null;
    g10?: number | null;
    d1?: number | null;
    investedAt?: string | null;
    daysToCd?: number | null;
    deltaPnlEurSinceVisit?: number | null;
    /** Peak open MTM € — mobile red bell (20% of purchased + peak gains). */
    peakPnlEur?: number | null;
    recAction?: string | null;
  }>;
  /** Desktop Urgent G2 (or similar) auto-sell — show dismissible popup. */
  autoSold?: MobileAutoSoldEvent | null;
  /** Prior-day buys + yesterday/today sells from desktop Home. */
  priorDayBook?: MobilePriorDayBookSlice | null;
};

export type MobilePriorDayBookItem = {
  key: string;
  ticker: string;
  side: "buy" | "sell";
  pnlEur: number | null;
  capitalEur: number | null;
  atIso: string;
};

export type MobilePriorDayBookSlice = {
  dayKey: string;
  todayKey: string;
  buys: MobilePriorDayBookItem[];
  sells: MobilePriorDayBookItem[];
};

export type MobileAutoSoldItem = {
  key: string;
  ticker: string;
  dayPnlPct?: number | null;
  dayPnlEur?: number | null;
  reason?: string;
};

export type MobileAutoSoldEvent = {
  id: string;
  at: string;
  kind: string;
  items: MobileAutoSoldItem[];
  openCountAfter?: number | null;
};

export type DashboardListMode = "portfolio" | "topOpps";
