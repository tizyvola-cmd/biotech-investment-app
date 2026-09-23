/**
 * Detect sharp daily volume spikes vs recent baseline (Volume vs EIS chart).
 */

export type VolumeBar = { date: string; volume: number };

export type VolumeSpikeDetection = {
  spikeDate: string;
  spikeVolume: number;
  /** Median volume on prior lookback sessions (excludes spike day). */
  baselineVolume: number;
  ratio: number;
};

export const VOLUME_SPIKE_MIN_RATIO = 2.5;
export const VOLUME_SPIKE_LOOKBACK = 20;
export const VOLUME_SPIKE_MIN_BASELINE = 100_000;
export const VOLUME_SPIKE_MIN_ABSOLUTE = 500_000;

export function detectVolumeSpike(
  bars: VolumeBar[],
  opts?: {
    minRatio?: number;
    lookbackDays?: number;
    minBaseline?: number;
    minSpikeVolume?: number;
  },
): VolumeSpikeDetection | null {
  const minRatio = opts?.minRatio ?? VOLUME_SPIKE_MIN_RATIO;
  const lookback = opts?.lookbackDays ?? VOLUME_SPIKE_LOOKBACK;
  const minBaseline = opts?.minBaseline ?? VOLUME_SPIKE_MIN_BASELINE;
  const minSpike = opts?.minSpikeVolume ?? VOLUME_SPIKE_MIN_ABSOLUTE;

  const sorted = [...bars]
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.volume > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 6) return null;

  const spikeBar = sorted[sorted.length - 1]!;
  const history = sorted.slice(0, -1).slice(-lookback);
  if (history.length < 5) return null;

  const vols = history.map((b) => b.volume).sort((a, b) => a - b);
  const mid = Math.floor(vols.length / 2);
  const baseline =
    vols.length % 2 === 1 ? vols[mid]! : (vols[mid - 1]! + vols[mid]!) / 2;
  if (!Number.isFinite(baseline) || baseline < minBaseline) return null;

  const spikeVolume = spikeBar.volume;
  if (spikeVolume < minSpike) return null;

  const ratio = spikeVolume / baseline;
  if (ratio < minRatio) return null;

  return {
    spikeDate: spikeBar.date,
    spikeVolume,
    baselineVolume: baseline,
    ratio,
  };
}

export function fmtVolumeCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}
