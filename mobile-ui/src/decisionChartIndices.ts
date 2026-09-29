/** Decision chart axis labels — shared by chart bars and guide sheet. */

export const DECISION_CHART_AXES = [
  { id: "pplan", label: "REC", color: "#2a78d6", invert: false, longLabel: false },
  { id: "sds", label: "SDS", color: "#1baf7a", invert: false, longLabel: false },
  { id: "eis", label: "EIS", color: "#eda100", invert: false, longLabel: false },
  { id: "riskV2", label: "LOSS", color: "#4a3aa7", invert: true, longLabel: false },
  { id: "regRisk", label: "Regulatory Risk", color: "#64748b", invert: true, longLabel: true },
  { id: "mcs", label: "MCS", color: "#1D9E75", invert: false, longLabel: false },
] as const;

export type DecisionChartAxisId = (typeof DECISION_CHART_AXES)[number]["id"];
