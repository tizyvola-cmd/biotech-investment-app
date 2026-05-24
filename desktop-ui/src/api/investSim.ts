import type { InvestSimInputs } from "../sheet/investSimStorage";
import { api } from "./supernova";

export type InvestSimPersistedPayload = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
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

/** Rigenera investment_sim_outcomes.json da invest_sim_inputs + snapshot Simulation. */
export async function rebuildInvestmentSimOutcomes(): Promise<void> {
  await api("/api/investment/sim-outcomes/rebuild", { method: "POST" });
}
