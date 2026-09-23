/**
 * Volume Character Classifier — Anticipatory vs Reactive vs Ambiguous.
 * Mirrors `volume_character.py`. Tag layer only; does not emit BUY/SELL.
 */

export const RVOL_HIGH = 3.0;
export const RVOL_EXTREME = 5.0;
export const RVOL_LOOKBACK = 20;
export const UDVR_WINDOW = 10;
export const UDVR_ACCUM = 1.5;
export const UDVR_DIST = 0.67;
export const CLV_ACCUM = 0.5;
export const CLV_DIST = -0.5;
export const REACTIVE_SESSION_RADIUS = 1;
export const ANTICIPATORY_PRIOR_SESSIONS = 2;

export const TAG_REACTIVE = "Reactive";
export const TAG_ANTICIPATORY_ACCUMULATION = "Anticipatory Accumulation";
export const TAG_ANTICIPATORY_DISTRIBUTION = "Anticipatory Distribution";
export const TAG_AMBIGUOUS = "Ambiguous";
export const TAG_QUIET_ACCUMULATION = "Quiet Accumulation";

export type VolumeCharacterTag =
  | typeof TAG_REACTIVE
  | typeof TAG_ANTICIPATORY_ACCUMULATION
  | typeof TAG_ANTICIPATORY_DISTRIBUTION
  | typeof TAG_AMBIGUOUS
  | typeof TAG_QUIET_ACCUMULATION;

export type OhlcvBar = {
  date: string;
  close: number;
  volume: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
};

export type VolumeCharacterResult = {
  date: string;
  tag: VolumeCharacterTag;
  rvol: number | null;
  highVol: boolean;
  extremeVol: boolean;
  clv: number | null;
  udvr: number | null;
  timing: "reactive" | "anticipatory" | "near_eis" | null;
  quietAccumulation: boolean;
  volume: number;
  close: number;
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeOhlcvBars(raw: Iterable<Partial<OhlcvBar>>): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (const row of raw) {
    const date = String(row.date ?? "").slice(0, 10);
    const close = num(row.close);
    const volume = num(row.volume);
    if (date.length < 10 || close == null || close <= 0 || volume == null || volume <= 0) continue;
    const bar: OhlcvBar = { date, close, volume };
    const o = num(row.open);
    const h = num(row.high);
    const lo = num(row.low);
    if (o != null && o > 0) bar.open = o;
    if (h != null && h > 0) bar.high = h;
    if (lo != null && lo > 0) bar.low = lo;
    out.push(bar);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function normalizeEisDates(raw: Iterable<string | null | undefined> | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw ?? []) {
    const d = String(item ?? "").trim().slice(0, 10);
    if (d.length < 10 || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  out.sort();
  return out;
}

export function median(values: number[]): number | null {
  const vals = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  if (vals.length % 2) return vals[mid]!;
  return (vals[mid - 1]! + vals[mid]!) / 2;
}

/** Volume_t / median(Volume_{t-lookback..t-1}) — no look-ahead. */
export function rvolAt(bars: OhlcvBar[], index: number, lookback = RVOL_LOOKBACK): number | null {
  if (index < 1 || index >= bars.length) return null;
  const start = Math.max(0, index - lookback);
  const prior: number[] = [];
  for (let i = start; i < index; i++) {
    const v = bars[i]!.volume;
    if (v > 0) prior.push(v);
  }
  if (prior.length < Math.max(5, Math.floor(lookback / 2))) return null;
  const base = median(prior);
  if (base == null || base <= 0) return null;
  const vol = bars[index]!.volume;
  if (!(vol > 0)) return null;
  return vol / base;
}

export function clvAt(bar: OhlcvBar): number | null {
  const high = num(bar.high);
  const low = num(bar.low);
  const close = num(bar.close);
  if (high == null || low == null || close == null) return null;
  const span = high - low;
  if (span <= 0) return 0;
  return ((close - low) - (high - close)) / span;
}

export function udvrEndingAt(bars: OhlcvBar[], index: number, window = UDVR_WINDOW): number | null {
  if (index < 1 || index >= bars.length) return null;
  const start = Math.max(1, index - window + 1);
  let up = 0;
  let down = 0;
  for (let i = start; i <= index; i++) {
    const c = bars[i]!.close;
    const p = bars[i - 1]!.close;
    const v = bars[i]!.volume;
    if (!(v > 0)) continue;
    if (c > p) up += v;
    else if (c < p) down += v;
  }
  if (down <= 0) return up <= 0 ? null : 99;
  return up / down;
}

function nearestBarIndex(barDates: string[], day: string): number | null {
  const exact = barDates.indexOf(day);
  if (exact >= 0) return exact;
  let before = -1;
  for (let i = 0; i < barDates.length; i++) {
    if (barDates[i]! <= day) before = i;
  }
  if (before >= 0) return before;
  for (let i = 0; i < barDates.length; i++) {
    if (barDates[i]! >= day) return i;
  }
  return null;
}

export function eisSessionIndices(bars: OhlcvBar[], eisDates: string[]): number[] {
  const dates = bars.map((b) => b.date);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const d of normalizeEisDates(eisDates)) {
    const idx = nearestBarIndex(dates, d);
    if (idx == null || seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

export function timingVsEis(
  peakIndex: number,
  eisIndices: number[],
  reactiveRadius = REACTIVE_SESSION_RADIUS,
  anticipatoryPrior = ANTICIPATORY_PRIOR_SESSIONS,
): "reactive" | "anticipatory" | "near_eis" {
  for (const ei of eisIndices) {
    if (Math.abs(ei - peakIndex) <= reactiveRadius) return "reactive";
  }
  for (const ei of eisIndices) {
    if (peakIndex - anticipatoryPrior <= ei && ei < peakIndex) return "near_eis";
  }
  return "anticipatory";
}

const QUIET_MA = 5;
const QUIET_LOOKBACK = 18;

export function quietAccumulation(
  bars: OhlcvBar[],
  eisIndices: number[],
  endIndex: number,
): boolean {
  if (endIndex < QUIET_LOOKBACK) return false;
  const start = endIndex - QUIET_LOOKBACK + 1;
  for (const ei of eisIndices) {
    if (ei >= start && ei <= endIndex) return false;
  }
  const mas: number[] = [];
  for (let i = start; i <= endIndex; i++) {
    const w0 = Math.max(0, i - QUIET_MA + 1);
    const chunk: number[] = [];
    for (let j = w0; j <= i; j++) {
      if (bars[j]!.volume > 0) chunk.push(bars[j]!.volume);
    }
    if (chunk.length < QUIET_MA) continue;
    mas.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
  }
  if (mas.length < 6) return false;
  const slope = (mas[mas.length - 1]! - mas[0]!) / Math.max(1, mas.length - 1);
  if (!(slope > 0)) return false;
  const mid = start + Math.floor((endIndex - start) / 2);
  const firstLows: number[] = [];
  const secondLows: number[] = [];
  for (let i = start; i <= mid; i++) {
    const lo = num(bars[i]!.low) ?? bars[i]!.close;
    if (lo > 0) firstLows.push(lo);
  }
  for (let i = mid + 1; i <= endIndex; i++) {
    const lo = num(bars[i]!.low) ?? bars[i]!.close;
    if (lo > 0) secondLows.push(lo);
  }
  if (!firstLows.length || !secondLows.length) return false;
  return Math.min(...secondLows) > Math.min(...firstLows);
}

function pack(
  bar: OhlcvBar,
  tag: VolumeCharacterTag,
  rvol: number | null,
  high: boolean,
  extreme: boolean,
  clv: number | null,
  udvr: number | null,
  timing: VolumeCharacterResult["timing"],
  quiet: boolean,
): VolumeCharacterResult {
  return {
    date: bar.date,
    tag,
    rvol: rvol == null ? null : Math.round(rvol * 1000) / 1000,
    highVol: high,
    extremeVol: extreme,
    clv: clv == null ? null : Math.round(clv * 10000) / 10000,
    udvr: udvr == null ? null : Math.round(udvr * 10000) / 10000,
    timing,
    quietAccumulation: quiet,
    volume: bar.volume,
    close: bar.close,
  };
}

export function classifyBarAt(
  rawBars: Iterable<Partial<OhlcvBar>>,
  index: number,
  eisDates: Iterable<string | null | undefined> | null | undefined = [],
  includeQuiet = true,
): VolumeCharacterResult | null {
  const bars = normalizeOhlcvBars(rawBars);
  if (index < 0 || index >= bars.length) return null;
  const eisIdx = eisSessionIndices(bars, normalizeEisDates(eisDates));
  const rvol = rvolAt(bars, index);
  const high = rvol != null && rvol >= RVOL_HIGH;
  const extreme = rvol != null && rvol >= RVOL_EXTREME;
  const clv = clvAt(bars[index]!);
  const udvr = udvrEndingAt(bars, index);
  const timing = high ? timingVsEis(index, eisIdx) : null;
  const quiet = includeQuiet && quietAccumulation(bars, eisIdx, index);

  if (high) {
    if (timing === "reactive") {
      return pack(bars[index]!, TAG_REACTIVE, rvol, high, extreme, clv, udvr, timing, quiet);
    }
    if (timing === "anticipatory") {
      if (clv != null && udvr != null && clv > CLV_ACCUM && udvr > UDVR_ACCUM) {
        return pack(bars[index]!, TAG_ANTICIPATORY_ACCUMULATION, rvol, high, extreme, clv, udvr, timing, quiet);
      }
      if (clv != null && udvr != null && clv < CLV_DIST && udvr < UDVR_DIST) {
        return pack(bars[index]!, TAG_ANTICIPATORY_DISTRIBUTION, rvol, high, extreme, clv, udvr, timing, quiet);
      }
      return pack(bars[index]!, TAG_AMBIGUOUS, rvol, high, extreme, clv, udvr, timing, quiet);
    }
    return pack(bars[index]!, TAG_AMBIGUOUS, rvol, high, extreme, clv, udvr, timing, quiet);
  }
  if (quiet) {
    return pack(bars[index]!, TAG_QUIET_ACCUMULATION, rvol, false, false, clv, udvr, null, true);
  }
  return null;
}

export function classifyPeakAnomaly(
  rawBars: Iterable<Partial<OhlcvBar>>,
  eisDates: Iterable<string | null | undefined> | null | undefined = [],
  lookbackSessions = 5,
  includeQuiet = true,
): VolumeCharacterResult | null {
  const bars = normalizeOhlcvBars(rawBars);
  if (bars.length < 2) return null;
  const start = Math.max(1, bars.length - lookbackSessions);
  let bestI: number | null = null;
  let bestR = -1;
  for (let i = start; i < bars.length; i++) {
    const r = rvolAt(bars, i);
    if (r == null) continue;
    if (r > bestR) {
      bestR = r;
      bestI = i;
    }
  }
  const idx = bestI ?? bars.length - 1;
  return classifyBarAt(bars, idx, eisDates, includeQuiet);
}

export function volumeCharacterLabel(tag: VolumeCharacterTag, it: boolean): string {
  /** Short chip for Evaluation / chart legend. */
  switch (tag) {
    case TAG_REACTIVE:
      return it ? "Dopo news" : "After news";
    case TAG_ANTICIPATORY_ACCUMULATION:
      return it ? "Compra prima" : "Buying early";
    case TAG_ANTICIPATORY_DISTRIBUTION:
      return it ? "Vendita prima" : "Selling early";
    case TAG_AMBIGUOUS:
      return it ? "Non chiaro" : "Unclear";
    case TAG_QUIET_ACCUMULATION:
      return it ? "Base lenta" : "Quiet base";
    default:
      return tag;
  }
}

/** One-line explanation for tooltips. */
export function volumeCharacterExplain(tag: VolumeCharacterTag, it: boolean): string {
  switch (tag) {
    case TAG_REACTIVE:
      return it
        ? "Spike di volume insieme a una news EIS già confermata — reazione, non anticipo"
        : "Volume spike with a confirmed EIS news — reaction, not anticipation";
    case TAG_ANTICIPATORY_ACCUMULATION:
      return it
        ? "Volume alto e chiusura vicino al massimo, senza news EIS recente — tipico accumulo pre-catalyst"
        : "High volume closing near the high, no recent EIS news — typical pre-catalyst buying";
    case TAG_ANTICIPATORY_DISTRIBUTION:
      return it
        ? "Volume alto e chiusura vicino al minimo, senza news EIS recente — tipica distribuzione / vendite"
        : "High volume closing near the low, no recent EIS news — typical distribution / selling";
    case TAG_AMBIGUOUS:
      return it
        ? "Volume anomalo ma direzione non chiara (barra e bias up/down non concordano)"
        : "Unusual volume but direction unclear (bar and up/down bias disagree)";
    case TAG_QUIET_ACCUMULATION:
      return it
        ? "Volume in crescita lenta e minimi più alti, senza news — base costruttiva"
        : "Slowly rising volume and higher lows, no news — constructive base";
    default:
      return tag;
  }
}

export function volumeCharacterTitle(
  result: VolumeCharacterResult,
  it: boolean,
): string {
  const parts = [
    volumeCharacterExplain(result.tag, it),
    result.rvol != null ? `RVOL ${result.rvol.toFixed(1)}×` : null,
    result.clv != null ? `CLV ${result.clv.toFixed(2)}` : null,
    result.udvr != null ? `UDVR ${result.udvr.toFixed(2)}` : null,
    result.date,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Chip colors — shared by chart legend and Evaluation VOL column. */
export const VOLUME_CHARACTER_COLOR: Record<VolumeCharacterTag, string> = {
  [TAG_REACTIVE]: "#64748b",
  [TAG_ANTICIPATORY_ACCUMULATION]: "#16a34a",
  [TAG_ANTICIPATORY_DISTRIBUTION]: "#dc2626",
  [TAG_AMBIGUOUS]: "#d97706",
  [TAG_QUIET_ACCUMULATION]: "#0d9488",
};
