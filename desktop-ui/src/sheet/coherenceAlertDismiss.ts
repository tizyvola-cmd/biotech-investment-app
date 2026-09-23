/**
 * Persist "Close for now" for the coherence modal.
 * In-memory fallback when localStorage is blocked (private mode / Electron quirks)
 * so dismiss cannot silently fail and reopen on the next Top Opps tick.
 */

const STORAGE_KEY = "supernova_coherence_alert_ack_v2";
/** Legacy single-signature string. */
const STORAGE_KEY_LEGACY = "supernova_coherence_alert_ack";

/** Snooze same issue-id set even if ageHours / signature drift. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;

export type CoherenceAckPayload = {
  signature: string;
  issueIds: string[];
  at: number;
};

let memoryAck: CoherenceAckPayload | null = null;

/** Test-only: clear in-memory dismiss. */
export function resetCoherenceAlertAckForTests(): void {
  memoryAck = null;
}

function normIds(ids: string[] | undefined | null): string[] {
  return [...new Set((ids ?? []).map((x) => String(x).trim()).filter(Boolean))].sort();
}

function idsKey(ids: string[]): string {
  return normIds(ids).join(",");
}

function parseStored(raw: string | null): CoherenceAckPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CoherenceAckPayload;
    if (
      parsed &&
      typeof parsed.signature === "string" &&
      Array.isArray(parsed.issueIds) &&
      typeof parsed.at === "number"
    ) {
      return {
        signature: parsed.signature,
        issueIds: normIds(parsed.issueIds),
        at: parsed.at,
      };
    }
  } catch {
    /* legacy plain signature */
    if (raw.trim()) {
      return { signature: raw.trim(), issueIds: [], at: Date.now() };
    }
  }
  return null;
}

function loadAck(): CoherenceAckPayload | null {
  if (memoryAck) return memoryAck;
  try {
    const v2 = parseStored(localStorage.getItem(STORAGE_KEY));
    if (v2) {
      memoryAck = v2;
      return v2;
    }
    const legacy = localStorage.getItem(STORAGE_KEY_LEGACY);
    if (legacy?.trim()) {
      const p = parseStored(legacy);
      if (p) {
        memoryAck = p;
        return p;
      }
    }
  } catch {
    /* ignore */
  }
  return memoryAck;
}

export function ackCoherenceAlert(
  signature: string,
  issueIds?: string[] | null,
): void {
  if (!signature && !(issueIds && issueIds.length)) return;
  const payload: CoherenceAckPayload = {
    signature: signature || idsKey(issueIds ?? []),
    issueIds: normIds(issueIds),
    at: Date.now(),
  };
  memoryAck = payload;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(STORAGE_KEY_LEGACY, payload.signature);
  } catch {
    /* memoryAck still holds dismiss for this session */
  }
}

/**
 * True when this alert was dismissed (exact signature) or the same issue
 * family was snoozed within 24h.
 */
export function isCoherenceAlertAcked(
  signature: string,
  issueIds?: string[] | null,
): boolean {
  if (!signature && !(issueIds && issueIds.length)) return true;
  const ack = loadAck();
  if (!ack) return false;
  if (signature && ack.signature === signature) return true;
  const ids = normIds(issueIds);
  if (!ids.length) return false;
  // Current issues ⊆ previously dismissed — stay snoozed if the set shrinks
  // (e.g. storeAlignment flicker) so Close does not snap the modal back open.
  const acked = new Set(ack.issueIds);
  if (ids.every((id) => acked.has(id)) && Date.now() - ack.at < SNOOZE_MS) {
    return true;
  }
  return false;
}
