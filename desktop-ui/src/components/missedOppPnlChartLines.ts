import type { TranslationKey } from "../shared/i18n";
import type { MissedOppPnlLineDef } from "./MissedOppPnlLineChart";

/** Serie grafici P&L 24h — sim loop paper al posto del grezzo 100% rec. */
export function buildMissedOppPnlLineDefs(
  t: (key: TranslationKey) => string,
): MissedOppPnlLineDef[] {
  return [
    {
      dataKey: "allGainers",
      name: t("modelLab.missedOpp.lineAllGainers"),
      stroke: "#22c55e",
    },
    {
      dataKey: "simLoop",
      name: t("modelLab.missedOpp.lineSimLoop"),
      stroke: "#6366f1",
      strokeDasharray: "4 3",
      strokeWidth: 2,
    },
    {
      dataKey: "fairRecommendations",
      name: t("modelLab.missedOpp.lineFairRecommendations"),
      stroke: "#0d9488",
      strokeWidth: 2.5,
    },
    {
      dataKey: "actual",
      name: t("modelLab.missedOpp.lineActual"),
      stroke: "#f59e0b",
    },
  ];
}
