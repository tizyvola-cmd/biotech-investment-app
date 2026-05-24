export type FinancialNodeTemplateId = "ticker-grid" | "sector-hub" | "cap-tiers";

export type FinancialNodeTemplateMeta = {
  id: FinancialNodeTemplateId;
  label: string;
  tagline: string;
  description: string;
  /** Suggerimento sul numero di ticker visibili */
  idealCount: string;
};

export const FINANCIAL_NODE_TEMPLATES: FinancialNodeTemplateMeta[] = [
  {
    id: "ticker-grid",
    label: "Griglia ticker",
    tagline: "Una card per società",
    description:
      "Ogni titolo è un nodo card in griglia regolare. Ideale per confrontare pochi ticker o dopo un filtro stretto.",
    idealCount: "fino a ~80 ticker",
  },
  {
    id: "sector-hub",
    label: "Hub settore",
    tagline: "Settore → titoli",
    description:
      "Nodi hub per settore GICS con collegamenti verso i ticker del gruppo. Vista ad albero per esplorare l’universo per settore.",
    idealCount: "tutti i settori presenti",
  },
  {
    id: "cap-tiers",
    label: "Fasce market cap",
    tagline: "Dimensione → titoli",
    description:
      "Fasce Mega / Large / Mid / Small / Micro collegate ai ticker per capitalizzazione. Utile per screening per size.",
    idealCount: "raggruppamento automatico",
  },
];

export const DEFAULT_FINANCIAL_TEMPLATE: FinancialNodeTemplateId = "sector-hub";
