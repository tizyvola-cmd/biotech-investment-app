/**
 * Phase 0 profiling — read-only telemetry, opt-in via localStorage.
 *
 * Enable in DevTools console:
 *   localStorage.setItem('SUPERNOVA_PERF', '1'); location.reload();
 * Disable:
 *   localStorage.removeItem('SUPERNOVA_PERF');
 */

const PERF_KEY = "SUPERNOVA_PERF";

export function isPhase0PerfEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(PERF_KEY) === "1";
  } catch {
    return false;
  }
}

export function logPhase0Perf(
  channel: "api" | "project-data" | "ipc",
  label: string,
  ms: number,
  bytes?: number,
  extra?: string,
): void {
  if (!isPhase0PerfEnabled()) return;
  const size =
    bytes != null
      ? bytes >= 1_048_576
        ? `${(bytes / 1_048_576).toFixed(2)}MB`
        : `${(bytes / 1024).toFixed(1)}KB`
      : "—";
  const suffix = extra ? ` ${extra}` : "";
  console.info(`[PERF:${channel}] ${label} ${ms.toFixed(1)}ms ${size}${suffix}`);
}
