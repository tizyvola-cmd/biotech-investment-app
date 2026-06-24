const STORAGE_KEY = "supernova_coherence_alert_ack";

export function isCoherenceAlertAcked(signature: string): boolean {
  if (!signature) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === signature;
  } catch {
    return false;
  }
}

export function ackCoherenceAlert(signature: string): void {
  if (!signature) return;
  try {
    localStorage.setItem(STORAGE_KEY, signature);
  } catch {
    /* ignore */
  }
}
