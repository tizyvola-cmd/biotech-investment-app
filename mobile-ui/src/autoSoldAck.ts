/** Local ack so an auto-sell popup is shown once per event id. */

const ACK_KEY = "sn_mobile_auto_sold_ack_v1";

export function loadAutoSoldAckId(): string | null {
  try {
    return localStorage.getItem(ACK_KEY);
  } catch {
    return null;
  }
}

export function ackAutoSoldEvent(id: string): void {
  try {
    localStorage.setItem(ACK_KEY, id);
  } catch {
    /* ignore quota */
  }
}

export function shouldShowAutoSold(
  event: { id?: string; items?: unknown[] } | null | undefined,
): boolean {
  if (!event?.id || !Array.isArray(event.items) || event.items.length === 0) return false;
  return loadAutoSoldAckId() !== event.id;
}
