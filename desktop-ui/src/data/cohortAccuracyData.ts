import { fetchProjectJson } from "./projectData";

const COHORT_ACCURACY_FILE = "model_cohort_accuracy.json";

export type CohortAccuracySlice = {
  acc_pct?: number | null;
  n_evaluable?: number;
  hits?: number;
  misses?: number;
  n_total?: number;
  n_complete?: number;
  n_pending?: number;
  label_it?: string;
  label_en?: string;
  source?: string;
};

export type ModelCohortAccuracyDoc = {
  schema_version?: number;
  generated_at?: string;
  model_version?: string;
  definition?: {
    metric?: string;
    actual_horizon?: string;
    eligible?: string;
  };
  retro?: CohortAccuracySlice;
  simulation?: CohortAccuracySlice;
};

export async function loadModelCohortAccuracyDoc(): Promise<{
  doc: ModelCohortAccuracyDoc | null;
  error?: string;
}> {
  const { data } = await fetchProjectJson<ModelCohortAccuracyDoc>(COHORT_ACCURACY_FILE);
  if (data?.retro || data?.simulation) {
    return { doc: data };
  }
  return {
    doc: null,
    error: `File assente (${COHORT_ACCURACY_FILE}). Esegui un refresh orchestrator.`,
  };
}

function parsePct(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** KPI normalizzati per la UI Q&C (retro backtest vs Simulation forward). */
export function cohortAccuracyKpis(doc: ModelCohortAccuracyDoc | null | undefined) {
  const retro = doc?.retro;
  const sim = doc?.simulation;
  return {
    accRetro: parsePct(retro?.acc_pct),
    nRetroEval: parseIntSafe(retro?.n_evaluable),
    hitsRetro: parseIntSafe(retro?.hits),
    accSim: parsePct(sim?.acc_pct),
    nSimEval: parseIntSafe(sim?.n_evaluable),
    hitsSim: parseIntSafe(sim?.hits),
    nSimPending: parseIntSafe(sim?.n_pending) ?? 0,
    nSimTotal: parseIntSafe(sim?.n_total) ?? 0,
    nSimComplete: parseIntSafe(sim?.n_complete) ?? 0,
    generatedAt: doc?.generated_at ?? null,
  };
}

export type CohortAccuracyKpis = ReturnType<typeof cohortAccuracyKpis>;
