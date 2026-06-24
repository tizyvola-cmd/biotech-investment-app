/** Min interval before a dashboard panel should refresh again (24h). */
export const DASHBOARD_PANEL_DAILY_MS = 24 * 60 * 60 * 1000;

export function isDashboardPanelStale(iso: string | null | undefined): boolean {
  if (!iso?.trim()) return true;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms >= DASHBOARD_PANEL_DAILY_MS;
}

export function latestDashboardPanelIso(
  ...candidates: Array<string | null | undefined>
): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const iso of candidates) {
    if (!iso?.trim()) continue;
    const ms = new Date(iso).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!best || ms > best.ms) best = { iso: iso.trim(), ms };
  }
  return best?.iso ?? null;
}
