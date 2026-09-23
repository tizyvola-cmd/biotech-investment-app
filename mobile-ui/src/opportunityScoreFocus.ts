import type { DecisionChartAxisId } from "./decisionChartIndices";
import type { OpportunityDetailSection } from "./components/MobileOpportunityCard";

export type MobileOpportunityAccordion = "price" | "score" | "clinical" | "model";

/** Deep-dive target when user taps a score link on the decision chart. */
export type MobileOpportunityFocus = {
  accordion?: MobileOpportunityAccordion;
  sheet?: OpportunityDetailSection;
  /** Carousel slide id (`pred`, `gain`, `marketSlope`, `market`, …). */
  chartSlide?: string;
};

export function mobileFocusFromDecisionAxis(axisId: DecisionChartAxisId): MobileOpportunityFocus {
  switch (axisId) {
    case "pplan":
      return { accordion: "model" };
    case "sds":
      return { accordion: "model" };
    case "eis":
      return { accordion: "clinical", sheet: "eis" };
    case "riskV2":
      return { accordion: "model" };
    case "regRisk":
      return { accordion: "clinical", sheet: "eis" };
    case "mcs":
      return { accordion: "price" };
    default:
      return { accordion: "model" };
  }
}

export function mobileFocusAllCharts(): MobileOpportunityFocus {
  return { accordion: "model" };
}

export function applyMobileOpportunityFocus(
  focus: MobileOpportunityFocus,
  handlers: {
    setPriceOpen: (v: boolean) => void;
    setScoreOpen: (v: boolean) => void;
    setClinicalOpen: (v: boolean) => void;
    setModelOpen: (v: boolean) => void;
    openDetail: (section: OpportunityDetailSection, chartSlide?: string | null) => void;
  },
): void {
  if (focus.accordion === "price") handlers.setPriceOpen(true);
  if (focus.accordion === "score") handlers.setScoreOpen(true);
  if (focus.accordion === "clinical") handlers.setClinicalOpen(true);
  if (focus.accordion === "model") handlers.setModelOpen(true);

  // Only EIS opens a detail sheet — Curves fullscreen removed from mobile.
  if (focus.sheet === "eis") {
    handlers.openDetail("eis");
  }
}
