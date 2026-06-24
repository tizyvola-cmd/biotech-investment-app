/**
 * RA Score → Recommendation Engine attribution.
 *
 * For each RA Score v2 component, we declare:
 *  - the underlying signal source
 *  - whether that same signal is *already consumed* by deriveSuggestedAction
 *    (the recommendation engine) directly, indirectly, or not at all
 *
 * Goal: quantify how much of RA Score is novel information vs simply a
 * reshuffling of signals already used elsewhere.
 *
 * Source of truth checked against:
 *  - desktop-ui/src/sheet/entrySolidityComposite.ts (RA components)
 *  - desktop-ui/src/sheet/investDecisionSimLoop.ts (deriveSuggestedAction)
 *  - desktop-ui/src/lib/scoring/zoneWeights.ts (composite zone weights)
 */
import type { SolidityCompositeComponentId } from "./entrySolidityComposite";
import { SOLIDITY_COMPONENT_MAX } from "./entrySolidityComposite";

export type AttributionCategory =
  /** RA component reuses a signal that is a *hard gate / override* in deriveSuggestedAction. */
  | "duplicate_hard"
  /** RA component reuses a signal that affects the recommendation only as auxiliary weight. */
  | "duplicate_soft"
  /** RA component is a *new* signal — not consumed anywhere by deriveSuggestedAction. */
  | "novel"
  /** Weight 0 — component is effectively dead in v2. */
  | "dead";

export type AttributionEntry = {
  id: SolidityCompositeComponentId;
  label: string;
  weightPt: number;
  sourceSignal: string;
  sourceFile: string;
  consumedAs: string;
  consumedFile: string | null;
  category: AttributionCategory;
  rhoWithPrice: number | null;
  notes: string;
};

export const RA_COMPONENT_ATTRIBUTION: AttributionEntry[] = [
  {
    id: "mii",
    label: "MII (Market Indicator)",
    weightPt: SOLIDITY_COMPONENT_MAX.mii, // 20
    sourceSignal: "MIG snapshot · slopeAngleDeg + verdict",
    sourceFile: "sheet/entrySolidityMig.ts",
    consumedAs: "item.marketGate.regime_gate_fired → hard BUY block",
    consumedFile: "sheet/investDecisionSimLoop.ts:deriveSuggestedAction (via marketContextGate)",
    category: "duplicate_hard",
    rhoWithPrice: 0.44,
    notes:
      "Top predictor (ρ=+0.44★★★) ma identico segnale del market gate già attivo nel motore. RA ridistribuisce, non aggiunge.",
  },
  {
    id: "precat",
    label: "Pre-CD Signal",
    weightPt: SOLIDITY_COMPONENT_MAX.precat, // 15
    sourceSignal: "s.precatKind ∈ {enter, accumulate, hold, avoid, late, sell, too_early}",
    sourceFile: "sheet/precatCurve.ts",
    consumedAs:
      "item.precatKind → gate primario in BUY paths 1-6 (enter/accumulate richiesti)",
    consumedFile: "sheet/investDecisionSimLoop.ts:deriveSuggestedAction",
    category: "duplicate_hard",
    rhoWithPrice: 0.32,
    notes:
      "Secondo predittore (ρ=+0.32★★★). Esattamente lo stesso campo letto da deriveSuggestedAction nei buy paths. RA lo conta una seconda volta.",
  },
  {
    id: "momentum_accel",
    label: "Momentum Accel (Var. 24h)",
    weightPt: SOLIDITY_COMPONENT_MAX.momentum_accel, // 12
    sourceSignal: "s.pnlPct24h (variazione giornaliera 24h)",
    sourceFile: "data sheet · Var. Giorn. %",
    consumedAs:
      "item.pnlPct24h ≥ +0.5% → momentum override BUY (path 4)",
    consumedFile: "sheet/investDecisionSimLoop.ts:deriveSuggestedAction",
    category: "duplicate_hard",
    rhoWithPrice: null,
    notes:
      "Stesso campo identico (Var.Giorn. %) usato come momentum override BUY. RA lo riusa con scala diversa (0/0.5/1/2%).",
  },
  {
    id: "sds",
    label: "SDS Score",
    weightPt: SOLIDITY_COMPONENT_MAX.sds, // 12
    sourceSignal: "SdsRow.sds + SdsRow.veto",
    sourceFile: "api/supernova.ts → SDS cohort",
    consumedAs:
      "composite.zoneWeights.sds (peso 2-24 per zona CD) + veto SDS gate",
    consumedFile: "lib/scoring/compositeScore.ts + sheet/sdsTopOppGate.ts",
    category: "duplicate_soft",
    rhoWithPrice: null,
    notes:
      "SDS è già nel composite score (peso variabile per zona) e il veto è gate hard. RA lo riusa come peso fisso 12pt.",
  },
  {
    id: "roi_target",
    label: "Target ROI",
    weightPt: SOLIDITY_COMPONENT_MAX.roi_target, // 10
    sourceSignal: "resolvePrimaryReturnPct(s) — picco curva ROI",
    sourceFile: "sheet/canonicalRoi.ts",
    consumedAs:
      "buyIfGainExpected(item) → richiede planReturnPct > 0 per ogni BUY path",
    consumedFile: "sheet/investDecisionSimLoop.ts:deriveSuggestedAction",
    category: "duplicate_soft",
    rhoWithPrice: 0.13,
    notes:
      "Stesso campo (curve peak / planReturnPct) usato come gate 'expected gain > 0' nel motore. RA scala il punteggio.",
  },
  {
    id: "reliability",
    label: "Model Reliability",
    weightPt: SOLIDITY_COMPONENT_MAX.reliability, // 15
    sourceSignal: "pickReliabilityMetrics(s).score (0-100)",
    sourceFile: "sheet/entrySolidityReliability.ts",
    consumedAs: "— non consumato da deriveSuggestedAction —",
    consumedFile: null,
    category: "novel",
    rhoWithPrice: 0.06,
    notes:
      "Segnale 'nuovo' rispetto al motore, ma ρ=+0.06 (debolissimo). Aggiunge poco valore predittivo.",
  },
  {
    id: "align",
    label: "Direction Align",
    weightPt: SOLIDITY_COMPONENT_MAX.align, // 10
    sourceSignal: "alignSolidityPoints — direzione modello vs slope reale",
    sourceFile: "sheet/entrySolidityAlign.ts",
    consumedAs:
      "— non consumato da deriveSuggestedAction (slope guida solo curveRisingHold) —",
    consumedFile: null,
    category: "novel",
    rhoWithPrice: 0.1,
    notes:
      "Segnale 'nuovo'. ρ=+0.10 (debole). Lo slope è già usato nel composite (peso 11/9/7/18 per zona) ma in forma diversa.",
  },
  {
    id: "calib",
    label: "Calib pre↔MII",
    weightPt: SOLIDITY_COMPONENT_MAX.calib, // 6
    sourceSignal: "mig.calibPreScore + mig.gapPrePct",
    sourceFile: "sheet/entrySolidityMig.ts",
    consumedAs: "— non consumato da deriveSuggestedAction —",
    consumedFile: null,
    category: "novel",
    rhoWithPrice: null,
    notes:
      "Segnale 'nuovo' ma derivato da MII (correlato). Peso piccolo (6pt). Dati insufficienti per calibrazione.",
  },
  {
    id: "timing",
    label: "Entry Timing",
    weightPt: SOLIDITY_COMPONENT_MAX.timing, // 0
    sourceSignal: "entryTimingSolidityPoints(s.days)",
    sourceFile: "sheet/entrySolidityTiming.ts",
    consumedAs:
      "Indirettamente in composite.zoneWeights.timing (peso 6/4/2/0 per zona)",
    consumedFile: "lib/scoring/zoneWeights.ts",
    category: "dead",
    rhoWithPrice: 0.0,
    notes:
      "Eliminato in v2 (ρ=0.00 storico). Peso 0pt. Spazio recuperato per momentum_accel.",
  },
];

export type AttributionSummary = {
  totalPt: number;
  duplicateHardPt: number;
  duplicateSoftPt: number;
  novelPt: number;
  deadPt: number;
  duplicateHardPct: number;
  duplicateSoftPct: number;
  novelPct: number;
  deadPct: number;
  /** Pesata media ρ (correlazione con prezzo) per componenti con valore noto. */
  weightedAvgRho: number | null;
  /** Pesata media ρ solo dei componenti "novel". */
  novelWeightedRho: number | null;
};

export function summarizeRaAttribution(): AttributionSummary {
  let dupHard = 0;
  let dupSoft = 0;
  let novel = 0;
  let dead = 0;
  for (const e of RA_COMPONENT_ATTRIBUTION) {
    if (e.category === "duplicate_hard") dupHard += e.weightPt;
    else if (e.category === "duplicate_soft") dupSoft += e.weightPt;
    else if (e.category === "novel") novel += e.weightPt;
    else if (e.category === "dead") dead += e.weightPt;
  }
  const total = dupHard + dupSoft + novel + dead;
  // Weighted ρ (weight = component weightPt, only where rho is defined)
  let sumRho = 0;
  let sumW = 0;
  let novelSumRho = 0;
  let novelSumW = 0;
  for (const e of RA_COMPONENT_ATTRIBUTION) {
    if (e.rhoWithPrice != null && e.weightPt > 0) {
      sumRho += e.rhoWithPrice * e.weightPt;
      sumW += e.weightPt;
      if (e.category === "novel") {
        novelSumRho += e.rhoWithPrice * e.weightPt;
        novelSumW += e.weightPt;
      }
    }
  }
  return {
    totalPt: total,
    duplicateHardPt: dupHard,
    duplicateSoftPt: dupSoft,
    novelPt: novel,
    deadPt: dead,
    duplicateHardPct: total > 0 ? (dupHard / total) * 100 : 0,
    duplicateSoftPct: total > 0 ? (dupSoft / total) * 100 : 0,
    novelPct: total > 0 ? (novel / total) * 100 : 0,
    deadPct: total > 0 ? (dead / total) * 100 : 0,
    weightedAvgRho: sumW > 0 ? sumRho / sumW : null,
    novelWeightedRho: novelSumW > 0 ? novelSumRho / novelSumW : null,
  };
}

export const CATEGORY_COLOR: Record<AttributionCategory, string> = {
  duplicate_hard: "#dc2626", // red: hard duplicate of motore gates
  duplicate_soft: "#f59e0b", // amber: soft duplicate via composite weights
  novel: "#059669", // green: novel signal
  dead: "#94a3b8", // gray: dead weight
};

export const CATEGORY_LABEL_IT: Record<AttributionCategory, string> = {
  duplicate_hard: "Duplicato hard (gate/override motore)",
  duplicate_soft: "Duplicato soft (composite/gate indiretto)",
  novel: "Segnale nuovo (non usato dal motore)",
  dead: "Peso 0 (eliminato)",
};

export const CATEGORY_LABEL_EN: Record<AttributionCategory, string> = {
  duplicate_hard: "Hard duplicate (engine gate/override)",
  duplicate_soft: "Soft duplicate (composite weight/indirect)",
  novel: "Novel signal (not used by engine)",
  dead: "Zero weight (deprecated)",
};
