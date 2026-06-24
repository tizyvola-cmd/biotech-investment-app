import type { EvolutionTrend } from "./modelEvolution";
import type { RascoreEvolutionTrend } from "./rascoreCalibrationHistory";
import { learningTrendVisual, type LearningTrendVisual } from "./learningTrendVisual";

/** Adatta trend ρ RA al badge visivo condiviso con Model Learnings. */
export function rascoreCalibrationTrendVisual(trend: RascoreEvolutionTrend, it: boolean): LearningTrendVisual {
  const mapped: EvolutionTrend = {
    label: trend.label,
    accSlope: trend.rhoSlope,
    description: it ? trend.descriptionIt : trend.descriptionEn,
  };
  const base = learningTrendVisual(mapped);
  if (trend.label === "improving") {
    return {
      ...base,
      explainIt: trend.descriptionIt,
      explainEn: trend.descriptionEn,
      shortIt: "ρ in salita",
      shortEn: "ρ rising",
    };
  }
  if (trend.label === "degrading") {
    return {
      ...base,
      explainIt: trend.descriptionIt,
      explainEn: trend.descriptionEn,
      shortIt: "ρ in calo",
      shortEn: "ρ falling",
    };
  }
  if (trend.label === "stable") {
    return {
      ...base,
      explainIt: trend.descriptionIt,
      explainEn: trend.descriptionEn,
      shortIt: "ρ stabile",
      shortEn: "ρ stable",
    };
  }
  return {
    ...base,
    explainIt: trend.descriptionIt,
    explainEn: trend.descriptionEn,
    shortIt: "ρ in attesa",
    shortEn: "ρ pending",
  };
}
