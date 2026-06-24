/**
 * Avvio automatico refresh domenica full al primo avvio dell'app il sabato mattina.
 * Una sola esecuzione per giorno di calendario (chiave YYYY-MM-DD).
 */

const STORAGE_KEY = "supernova_sunday_full_saturday_done";

/** Sabato = 6 (locale). Mattina = 06:00–13:59. */
export function isSaturdayMorning(now = new Date()): boolean {
  if (now.getDay() !== 6) return false;
  const h = now.getHours();
  return h >= 6 && h < 14;
}

function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function saturdayAutostartAlreadyDone(now = new Date()): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === todayKey(now);
  } catch {
    return false;
  }
}

/** True se oggi è sabato mattina e non abbiamo ancora lanciato il full questa mattina. */
export function shouldAutoStartSundayFull(now = new Date()): boolean {
  if (!isSaturdayMorning(now)) return false;
  return !saturdayAutostartAlreadyDone(now);
}

export function markSaturdayAutostartDone(now = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, todayKey(now));
  } catch {
    /* quota */
  }
}
