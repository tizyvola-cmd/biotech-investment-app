/**
 * Desk entry boot — health poller skips fail flips while Catalyst Days is booting
 * so queued /api/health behind calendar/sim does not mark the API offline.
 */
let busyUntilMs = 0;

export function markDeskBootBusy(ms = 30_000): void {
  busyUntilMs = Math.max(busyUntilMs, Date.now() + Math.max(0, ms));
}

export function clearDeskBootBusy(): void {
  busyUntilMs = 0;
}

export function isDeskBootBusy(): boolean {
  return Date.now() < busyUntilMs;
}
