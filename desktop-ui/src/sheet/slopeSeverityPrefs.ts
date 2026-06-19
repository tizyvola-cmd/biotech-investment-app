/** Minimum severity shown in Slope errors overview (persisted). */

export type SlopeSeverityFloor = "critical" | "high" | "medium" | "low";

export const DEFAULT_SLOPE_SEVERITY_FLOOR: SlopeSeverityFloor = "medium";

const STORAGE_KEY = "supernova_slope_severity_floor";

const VALID: SlopeSeverityFloor[] = ["critical", "high", "medium", "low"];

export function loadSlopeSeverityFloor(): SlopeSeverityFloor {
  if (typeof window === "undefined") return DEFAULT_SLOPE_SEVERITY_FLOOR;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && VALID.includes(raw as SlopeSeverityFloor)) {
      return raw as SlopeSeverityFloor;
    }
  } catch {
    /* private mode */
  }
  return DEFAULT_SLOPE_SEVERITY_FLOOR;
}

export function saveSlopeSeverityFloor(floor: SlopeSeverityFloor): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, floor);
}
