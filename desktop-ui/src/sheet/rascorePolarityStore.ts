/**
 * Persistenza polarità indici RA (calibrazione → score live Simulation).
 */
import type {
  EntrySolidityComposite,
  SolidityCompositeComponentId,
} from "./entrySolidityComposite";
import { entrySolidityTierFromTotal } from "./entrySolidityComposite";
import {
  computePolarizedRaTotal,
  polarizedComponentPoints,
  type RaComponentPolarity,
} from "./rascoreComponentPolarity";
import {
  buildRaTemporalCorrelation,
  type RaTemporalCorrelationBuildArgs,
} from "./rascoreTemporalCorrelation";

const STORAGE_KEY = "supernova_ra_component_polarities_v1";

export type StoredRaPolarities = {
  version: 1;
  updatedAt: string;
  pairCount: number;
  polarities: RaComponentPolarity[];
};

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function loadStoredRaPolarities(): StoredRaPolarities | null {
  try {
    const raw = readStorage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRaPolarities;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.polarities)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Polarità affidabili (n≥4) da applicare al RA live. */
export function loadLiveRaPolarities(): RaComponentPolarity[] {
  const stored = loadStoredRaPolarities();
  if (!stored) return [];
  return stored.polarities.filter((p) => p.reliable);
}

export function saveRaComponentPolarities(
  polarities: RaComponentPolarity[],
  pairCount: number,
): void {
  if (!polarities.some((p) => p.reliable)) return;
  const payload: StoredRaPolarities = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pairCount,
    polarities,
  };
  try {
    readStorage()?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

/** Ricalcola ρ da Simulation + salva in localStorage. */
export function refreshRaPolarityStore(
  buildArgs: RaTemporalCorrelationBuildArgs,
): RaComponentPolarity[] {
  const result = buildRaTemporalCorrelation({
    signals: [],
    buildArgs,
    scoreMode: "full",
  });
  if (result.componentPolarities.some((p) => p.reliable)) {
    saveRaComponentPolarities(result.componentPolarities, result.totalObservations);
  }
  return result.componentPolarities;
}

/** RA polarizzato live: Σρ+ − Σρ− (indici ρ<0 sottratti, non sommati grezzi). */
export function applyPriceAlignedComposite(
  composite: EntrySolidityComposite,
  polarities: readonly RaComponentPolarity[],
): EntrySolidityComposite {
  const reliable = polarities.filter((p) => p.reliable);
  if (!reliable.length) return composite;

  const invertById = new Map(reliable.map((p) => [p.id, p.invertForPrice]));

  const components = composite.components.map((c) => {
    const invert = invertById.get(c.id) ?? false;
    if (!invert) return c;
    const signed = polarizedComponentPoints(c.points, true);
    return {
      ...c,
      points: signed,
      detail: `${c.detail} · ρ<0 → −${Math.abs(signed).toFixed(1)} pt`,
    };
  });

  const rawById = Object.fromEntries(
    composite.components.map((c) => [c.id, c.points]),
  ) as Record<SolidityCompositeComponentId, number>;
  const { total: polarizedTotal } = computePolarizedRaTotal(rawById, reliable, "full");
  const total = Math.round(Math.min(100, Math.max(0, polarizedTotal)) * 10) / 10;

  return {
    total,
    tier: entrySolidityTierFromTotal(total),
    components,
  };
}
