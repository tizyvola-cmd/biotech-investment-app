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
};

export type DashboardListMode = "portfolio" | "topOpps";
