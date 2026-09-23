import type {
  CatalystCyclePhase,
  CatalystCyclePrimary,
  CatalystTickerCycleAlert,
} from "../api/catalystPatterns";
import type { PriceLinePoint } from "./priceVariationSeries";
import { detectVolumeSpike, type VolumeBar } from "./volumeSpikeDetect";
import { computePricePeakTier, type PricePeakHorizonId } from "./priceHorizonPeakTier";

/** Chart overlay includes API phases + Rise (geometry only). */
export type ChartOverlayPhase = CatalystCyclePhase | "rise";

export type PriceChartCycleRow = PriceLinePoint & {
  cycleMarker: ChartOverlayPhase | null;
  cycleMarkerConfirmed?: boolean;
  /** 1–4 when marker is Buy (exhaustion_exit) at multi-horizon peak. */
  buyPeakTier?: number;
  buyPeakHorizons?: PricePeakHorizonId[];
  /** Volume catalyst spike on the same bar as Buy. */
  catalystOnBuyBar?: boolean;
};

export const CHART_OVERLAY_PHASES: ChartOverlayPhase[] = [
  "pre_volume_watch",
  "dump_entry",
  "rise",
  "exhaustion_exit",
];

/** @deprecated use CHART_OVERLAY_PHASES */
export const ALL_CYCLE_PHASES = CHART_OVERLAY_PHASES.filter(
  (p): p is CatalystCyclePhase => p !== "rise",
);

function argMinIndex(series: PriceLinePoint[], from = 0, to = series.length): number {
  if (!series.length) return 0;
  let idx = Math.max(0, from);
  const end = Math.min(series.length, to);
  for (let i = idx + 1; i < end; i++) {
    if (series[i]!.tickerPrice < series[idx]!.tickerPrice) idx = i;
  }
  return idx;
}

function argMaxIndex(series: PriceLinePoint[], from = 0, to = series.length): number {
  if (!series.length) return 0;
  let idx = Math.max(0, from);
  const end = Math.min(series.length, to);
  for (let i = idx + 1; i < end; i++) {
    if (series[i]!.tickerPrice >= series[idx]!.tickerPrice) idx = i;
  }
  return idx;
}

function findRiseIndex(series: PriceLinePoint[], minIdx: number, maxIdx: number): number | null {
  if (maxIdx <= minIdx + 1) return null;
  const minP = series[minIdx]!.tickerPrice;
  const maxP = series[maxIdx]!.tickerPrice;
  if (maxP <= minP) return null;
  const threshold = minP + 0.5 * (maxP - minP);
  for (let i = minIdx + 1; i < maxIdx; i++) {
    if (series[i]!.tickerPrice >= threshold) return i;
  }
  return minIdx + Math.max(1, Math.floor((maxIdx - minIdx) / 2));
}

function volumeSpikeIndex(
  series: PriceLinePoint[],
  volumeBars: VolumeBar[],
): number | null {
  if (!volumeBars.length || series.length < 2) return null;
  const hit = detectVolumeSpike(volumeBars);
  if (!hit) return null;
  const idx = series.findIndex((p) => p.key.slice(0, 10) === hit.spikeDate);
  if (idx >= 0) return idx;
  return series.length - 1;
}

export type AttachCycleMarkersOpts = {
  volumeBars?: VolumeBar[];
  dailyCloses?: { date: string; close: number }[];
  livePrice?: number | null;
  asOfDate?: string | null;
};

/** Catalyst (volume) · Drop (trough) · Rise (mid recovery) · At High / exhaustion_exit (multi-horizon peak).
 *
 * Same-bar rules (one Map entry per index — last writer wins):
 * - Catalyst then overwritten by Drop if catalystIdx === minIdx (NO dual marker; Catalyst suppressed).
 * - At High overwrites any prior phase on lastIdx; Catalyst coincident with At High → catalystOnBuyBar tip only.
 */
export function attachCycleMarkersToPriceSeries(
  series: PriceLinePoint[],
  alert: CatalystTickerCycleAlert | null | undefined,
  primary: CatalystCyclePrimary | null | undefined,
  opts: AttachCycleMarkersOpts = {},
): PriceChartCycleRow[] {
  const empty = series.map((p) => ({
    ...p,
    cycleMarker: null as ChartOverlayPhase | null,
    cycleMarkerConfirmed: false,
    buyPeakTier: undefined,
    buyPeakHorizons: undefined,
  }));
  if (series.length < 2) return empty;

  const apiPhases = new Set<CatalystCyclePhase>();
  if (primary) apiPhases.add(primary.phase);
  for (const m of alert?.matches ?? []) apiPhases.add(m.phase);

  const peak = computePricePeakTier({
    dailyBars: opts.dailyCloses ?? [],
    livePrice: opts.livePrice ?? series[series.length - 1]!.tickerPrice,
    asOfDate: opts.asOfDate ?? series[series.length - 1]!.key.slice(0, 10),
  });

  const n = series.length;
  const minIdx = argMinIndex(series);
  const maxIdx = argMaxIndex(series, Math.max(0, Math.floor(n * 0.2)), n);
  const lastIdx = n - 1;
  const buyIdx = peak.tier >= 1 ? lastIdx : -1;
  const catalystIdx = volumeSpikeIndex(series, opts.volumeBars ?? []);
  const riseIdx = findRiseIndex(series, minIdx, maxIdx >= 0 ? maxIdx : lastIdx);

  const markerByIndex = new Map<number, ChartOverlayPhase>();

  if (catalystIdx != null && catalystIdx !== buyIdx) {
    markerByIndex.set(catalystIdx, "pre_volume_watch");
  }

  markerByIndex.set(minIdx, "dump_entry");

  if (riseIdx != null && riseIdx !== minIdx && riseIdx !== buyIdx && riseIdx !== catalystIdx) {
    if (!markerByIndex.has(riseIdx)) markerByIndex.set(riseIdx, "rise");
  }

  if (buyIdx >= 0) {
    markerByIndex.set(buyIdx, "exhaustion_exit");
  } else if (catalystIdx != null) {
    markerByIndex.set(catalystIdx, "pre_volume_watch");
  }

  const catalystOnBuyBar = catalystIdx != null && catalystIdx === buyIdx;

  return series.map((p, i) => {
    const phase = markerByIndex.get(i) ?? null;
    const isBuy = i === buyIdx && peak.tier >= 1;
    const confirmed =
      phase != null &&
      phase !== "rise" &&
      apiPhases.has(phase as CatalystCyclePhase);
    return {
      ...p,
      cycleMarker: phase,
      cycleMarkerConfirmed: confirmed,
      buyPeakTier: isBuy ? peak.tier : undefined,
      buyPeakHorizons: isBuy ? peak.matched : undefined,
      catalystOnBuyBar: isBuy && catalystOnBuyBar,
    };
  });
}

export function cycleMarkerHasAny(rows: PriceChartCycleRow[]): boolean {
  return rows.some((r) => r.cycleMarker != null);
}
