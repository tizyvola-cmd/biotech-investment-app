export const LS_SIM_STARTING_CAPITAL = "sn_mobile_sim_starting_capital";

export const DEFAULT_SIM_STARTING_CAPITAL_EUR = 5000;

/** Presets aligned with common Simulation budgets (desktop default 5000). */
export const SIM_STARTING_CAPITAL_PRESETS = [2000, 5000, 10_000, 25_000, 50_000, 100_000] as const;

export function normalizeSimStartingCapital(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SIM_STARTING_CAPITAL_EUR;
  return Math.round(n);
}

export function loadSimStartingCapital(): number {
  try {
    const raw = localStorage.getItem(LS_SIM_STARTING_CAPITAL);
    if (raw == null || raw === "") return DEFAULT_SIM_STARTING_CAPITAL_EUR;
    return normalizeSimStartingCapital(Number(raw));
  } catch {
    return DEFAULT_SIM_STARTING_CAPITAL_EUR;
  }
}

export function saveSimStartingCapital(value: number): void {
  try {
    localStorage.setItem(LS_SIM_STARTING_CAPITAL, String(normalizeSimStartingCapital(value)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function formatSimCapitalPreset(value: number): string {
  if (value >= 1000 && value % 1000 === 0) return `€${value / 1000}k`;
  return `€${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
