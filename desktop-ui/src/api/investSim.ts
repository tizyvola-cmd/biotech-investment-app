import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import { api } from "./supernova";

export type InvestSimPersistedPayload = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
};

export type InvestSimHistoryPersistedPayload = {
  version: number;
  updated_at: string | null;
  points: InvestSimHistoryPoint[];
};

export async function fetchInvestSimInputsPersisted(): Promise<InvestSimPersistedPayload | null> {
  try {
    return await api<InvestSimPersistedPayload>("/api/investment/sim-inputs");
  } catch {
    return null;
  }
}

export async function saveInvestSimInputsPersisted(
  inputs: InvestSimInputs
): Promise<void> {
  await api("/api/investment/sim-inputs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputs }),
  });
}

export async function fetchInvestSimHistoryPersisted(): Promise<InvestSimHistoryPersistedPayload | null> {
  try {
    return await api<InvestSimHistoryPersistedPayload>("/api/investment/sim-history");
  } catch {
    return null;
  }
}

export async function saveInvestSimHistoryPersisted(
  points: InvestSimHistoryPoint[],
): Promise<void> {
  await api("/api/investment/sim-history", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
}

/** Rigenera investment_sim_outcomes.json da invest_sim_inputs + snapshot Simulation. */
export async function rebuildInvestmentSimOutcomes(): Promise<void> {
  await api("/api/investment/sim-outcomes/rebuild", { method: "POST" });
}
