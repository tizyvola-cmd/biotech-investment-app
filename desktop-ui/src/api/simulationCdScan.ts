import { api } from "./supernova";

export type SimulationCdScanStatus = {
  running?: boolean;
  state?: string;
  step?: string;
  message?: string;
  ok?: boolean;
  error?: string | null;
  elapsed_sec?: number;
  rows_before?: number;
  rows_after?: number;
  started_at?: string;
  finished_at?: string;
  exit_code?: number;
};

export function runSimulationCdScan() {
  return api<{ started?: string; error?: string; hint?: string }>(
    "/api/simulation/cd-scan/run",
    { method: "POST" },
  );
}

export function fetchSimulationCdScanStatus() {
  return api<SimulationCdScanStatus>("/api/simulation/cd-scan/status");
}

/** Poll until the server-side CD scan finishes (or times out). */
export async function waitForSimulationCdScan(
  onProgress?: (status: SimulationCdScanStatus) => void,
  pollMs = 2000,
  maxWaitMs = 45 * 60 * 1000,
  joinedExisting = false,
): Promise<SimulationCdScanStatus> {
  const t0 = Date.now();
  let sawRunning = joinedExisting;

  if (!joinedExisting) {
    const spinUpDeadline = t0 + 30_000;
    while (Date.now() < spinUpDeadline) {
      const st = await fetchSimulationCdScanStatus();
      onProgress?.(st);
      if (st.running || st.state === "running") {
        sawRunning = true;
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }
    if (!sawRunning) {
      throw new Error("Scan CD Simulation non avviato (timeout avvio)");
    }
  }

  for (;;) {
    const st = await fetchSimulationCdScanStatus();
    onProgress?.(st);
    if (st.running) {
      sawRunning = true;
    } else if (sawRunning) {
      if (st.state === "error" || st.ok === false) {
        throw new Error(st.error || st.message || "Scan CD Simulation fallito");
      }
      return st;
    }
    if (Date.now() - t0 >= maxWaitMs) {
      throw new Error("Timeout scan CD Simulation (>45 min)");
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }
}
