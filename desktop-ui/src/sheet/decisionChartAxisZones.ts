import type { DecisionChartAxisId } from "./decisionChartIndices";
import type { DecisionChartTickerRow } from "./decisionChartLogic";

export type AxisZoneMarker = {
  pct: number;
  letter: "B" | "S";
  titleIt: string;
  titleEn: string;
};

/** Vertical B/S threshold markers on 0–100 score bars (aligned to decisionChartLogic). */
export function axisZoneMarkers(
  axisId: DecisionChartAxisId,
  row: DecisionChartTickerRow,
): AxisZoneMarker[] {
  const rescue = row.scores.isRescue;
  switch (axisId) {
    case "pplan":
      return [
        {
          pct: 65,
          letter: "B",
          titleIt: "Ingresso zona Buy — P(plan) ≥ 65",
          titleEn: "Buy zone entry — P(plan) ≥ 65",
        },
        ...(rescue
          ? ([
              {
                pct: 40,
                letter: "S",
                titleIt: "Ingresso zona Sell (rescue) — P(plan) < 40",
                titleEn: "Sell zone entry (rescue) — P(plan) < 40",
              },
            ] satisfies AxisZoneMarker[])
          : []),
      ];
    case "sds":
      return [
        {
          pct: 65,
          letter: "B",
          titleIt: "Ingresso zona Buy — SDS ≥ 65",
          titleEn: "Buy zone entry — SDS ≥ 65",
        },
        {
          pct: 50,
          letter: "S",
          titleIt: "Sotto fascia Hold — SDS < 50",
          titleEn: "Below Hold band — SDS < 50",
        },
      ];
    case "riskV2":
      return [
        {
          pct: 35,
          letter: "B",
          titleIt: "Rischio contenuto — Loss ≤ 35",
          titleEn: "Contained risk — Loss ≤ 35",
        },
        {
          pct: 66,
          letter: "S",
          titleIt: "Ingresso zona Sell — Loss ≥ 66",
          titleEn: "Sell zone entry — Loss ≥ 66",
        },
      ];
    case "regRisk":
      return [
        {
          pct: 70,
          letter: "S",
          titleIt: "Ingresso zona Sell — Reg. ≥ 70",
          titleEn: "Sell zone entry — Reg. ≥ 70",
        },
        ...(rescue
          ? ([
              {
                pct: 50,
                letter: "S",
                titleIt: "Reg. elevato in rescue — ≥ 50",
                titleEn: "Elevated Reg. in rescue — ≥ 50",
              },
            ] satisfies AxisZoneMarker[])
          : []),
      ];
    case "mcs":
      return rescue
        ? [
            {
              pct: 55,
              letter: "B",
              titleIt: "Contesto favorevole in rescue — MCS > 55",
              titleEn: "Favorable context in rescue — MCS > 55",
            },
          ]
        : [];
    case "eis":
      return [];
    default:
      return [];
  }
}
