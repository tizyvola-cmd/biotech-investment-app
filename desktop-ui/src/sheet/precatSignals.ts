/**
 * Pre-catalyst display flags — independent of deriveSuggestedAction.
 * Server SUPERNOVA_* overlays these when /api/status is available.
 */
export const PRECAT_SIGNAL_CONFIG = {
  calendar: true,
  volumeDelta: true,
  /** Google Trends — display only; SUPERNOVA_TRENDS=0 on the server disables live prints. */
  trends: true,
  trendsZscoreFlag: 2.0,
} as const;

export type PrecatSignalConfig = typeof PRECAT_SIGNAL_CONFIG;

let overlay: Partial<PrecatSignalConfig> | null = null;

export function applyPrecatSignalOverlay(partial: Partial<PrecatSignalConfig> | null): void {
  overlay = partial;
}

export function precatSignalEnabled(
  key: keyof PrecatSignalConfig,
): boolean {
  const o = overlay?.[key];
  if (typeof o === "boolean") return o;
  return Boolean(PRECAT_SIGNAL_CONFIG[key]);
}
