export type FinancialNodeTemplateId = "ticker-grid" | "sector-hub" | "cap-tiers";

export type FinancialNodeTemplateMeta = {
  id: FinancialNodeTemplateId;
  label: string;
  tagline: string;
  description: string;
  /** Hint about the expected number of visible tickers. */
  idealCount: string;
};

export const FINANCIAL_NODE_TEMPLATES: FinancialNodeTemplateMeta[] = [
  {
    id: "ticker-grid",
    label: "Ticker grid",
    tagline: "One card per company",
    description:
      "Each stock is a card node in a regular grid. Ideal to compare a few tickers or after a tight filter.",
    idealCount: "up to ~80 tickers",
  },
  {
    id: "sector-hub",
    label: "Sector hub",
    tagline: "Sector → stocks",
    description:
      "GICS sector hub nodes linking to the tickers in the group. Tree view to explore the universe by sector.",
    idealCount: "all sectors present",
  },
  {
    id: "cap-tiers",
    label: "Market-cap tiers",
    tagline: "Size → stocks",
    description:
      "Mega / Large / Mid / Small / Micro tiers linked to the tickers by market cap. Useful for size screening.",
    idealCount: "automatic grouping",
  },
];

export const DEFAULT_FINANCIAL_TEMPLATE: FinancialNodeTemplateId = "sector-hub";
