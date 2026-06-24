const STORAGE_KEY = "biotech.mig.minSlopeAngleDeg";

export function loadMigMinSlopeAngleDeg(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 20;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(40, Math.max(10, n)) : 20;
  } catch {
    return 20;
  }
}

export function saveMigMinSlopeAngleDeg(deg: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(deg)));
  } catch {
    /* ignore */
  }
}

const POSITIVE_SLOPE_KEY = "biotech.mig.positiveSlopeOnly";

export function loadMigPositiveSlopeOnly(): boolean {
  try {
    return localStorage.getItem(POSITIVE_SLOPE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMigPositiveSlopeOnly(on: boolean): void {
  try {
    localStorage.setItem(POSITIVE_SLOPE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const CD_UNDER_60_KEY = "biotech.mig.cdUnder60Only";

export function loadMigCdUnder60Only(): boolean {
  try {
    return localStorage.getItem(CD_UNDER_60_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMigCdUnder60Only(on: boolean): void {
  try {
    localStorage.setItem(CD_UNDER_60_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
