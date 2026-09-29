/**
 * Open-book volume spike alerts — poll daily bars, fanfare + closable banner.
 */
import { fetchVolumeHistory } from "../api/supernova";
import { highImpactEisDayKey } from "./highImpactEisAlerts";
import {
  detectVolumeSpike,
  fmtVolumeCompact,
  VOLUME_SPIKE_LOOKBACK,
  VOLUME_SPIKE_MIN_RATIO,
} from "./volumeSpikeDetect";

export { fmtVolumeCompact, VOLUME_SPIKE_MIN_RATIO };

const ACK_KEY = "sn_volume_spike_ack_v1";
const POLL_MS = 5 * 60 * 1000;
const FETCH_DAYS = VOLUME_SPIKE_LOOKBACK + 5;

export type VolumeSpikeAlert = {
  id: string;
  ticker: string;
  spikeDate: string;
  spikeVolume: number;
  baselineVolume: number;
  ratio: number;
};

export function volumeSpikeAlertId(
  ticker: string,
  spikeDate: string,
  spikeVolume: number,
): string {
  return `${ticker.trim().toUpperCase()}|${spikeDate}|${Math.round(spikeVolume)}`;
}

export function loadVolumeSpikeAcks(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function ackVolumeSpikeAlert(id: string): void {
  try {
    const next = loadVolumeSpikeAcks();
    next.add(id);
    const list = [...next];
    const trimmed = list.length > 200 ? list.slice(list.length - 200) : list;
    localStorage.setItem(ACK_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

/** Fanfare — brass-like ascending fanfare via Web Audio API. */
export function playTrumpetFanfare(): void {
  try {
    type WindowWithAudio = Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const w = window as WindowWithAudio;
    const Ctx = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [
      { f: 392, t: 0, d: 0.12 },
      { f: 523.25, t: 0.1, d: 0.12 },
      { f: 659.25, t: 0.2, d: 0.14 },
      { f: 783.99, t: 0.32, d: 0.18 },
      { f: 1046.5, t: 0.48, d: 0.42 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(n.f, ctx.currentTime + n.t);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.t);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + n.t);
      osc.stop(ctx.currentTime + n.t + n.d + 0.05);
    }
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* audio unavailable */
  }
}

function isRecentSpikeDate(spikeDate: string, now: Date = new Date()): boolean {
  const today = highImpactEisDayKey(now);
  const yesterday = highImpactEisDayKey(new Date(now.getTime() - 86_400_000));
  return spikeDate === today || spikeDate === yesterday;
}

export async function scanTickerVolumeSpike(
  ticker: string,
  acked: Set<string> = loadVolumeSpikeAcks(),
  now: Date = new Date(),
): Promise<VolumeSpikeAlert | null> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;

  const doc = await fetchVolumeHistory(tk, FETCH_DAYS);
  const bars = (doc.bars ?? [])
    .filter((b) => b.date && b.volume != null && b.volume > 0)
    .map((b) => ({ date: b.date, volume: Number(b.volume) }));

  const hit = detectVolumeSpike(bars);
  if (!hit || !isRecentSpikeDate(hit.spikeDate, now)) return null;

  const id = volumeSpikeAlertId(tk, hit.spikeDate, hit.spikeVolume);
  if (acked.has(id)) return null;

  return {
    id,
    ticker: tk,
    spikeDate: hit.spikeDate,
    spikeVolume: hit.spikeVolume,
    baselineVolume: hit.baselineVolume,
    ratio: hit.ratio,
  };
}

/** Scan open-book tickers; strongest spike first. */
export async function collectVolumeSpikeAlerts(
  tickers: Iterable<string>,
  acked: Set<string> = loadVolumeSpikeAcks(),
  now: Date = new Date(),
): Promise<VolumeSpikeAlert[]> {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of tickers) {
    const tk = raw.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    list.push(tk);
  }
  if (!list.length) return [];

  const results = await Promise.all(
    list.map((tk) =>
      scanTickerVolumeSpike(tk, acked, now).catch(() => null),
    ),
  );

  return results
    .filter((x): x is VolumeSpikeAlert => x != null)
    .sort((a, b) => b.ratio - a.ratio);
}

export const VOLUME_SPIKE_POLL_MS = POLL_MS;
