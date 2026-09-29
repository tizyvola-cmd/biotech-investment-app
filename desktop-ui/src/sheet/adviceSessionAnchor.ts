let cachedSessionDayKey = "";
let cachedSessionDayIso = "";

/** Stable noon UTC for the current calendar day — live advice without `at`. */
export function liveAdviceSessionAnchor(): string {
  const key = new Date().toISOString().slice(0, 10);
  if (cachedSessionDayKey === key) return cachedSessionDayIso;
  cachedSessionDayKey = key;
  cachedSessionDayIso = `${key}T12:00:00.000Z`;
  return cachedSessionDayIso;
}
