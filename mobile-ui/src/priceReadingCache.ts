/** Δ prezzo vs penultima misurazione — stessa cache v3 del desktop. */

const STORAGE_KEY = "biotech_sim_price_read_v3";
const LEGACY_MOBILE_KEY = "biotech_mobile_price_read_v1";
const LEGACY_V2_KEY = "biotech_sim_price_read_v2";

export type PriceReadingSnapshot = {
  priceUsd: number;
  ts: string;
  simTableVersion?: string | null;
};

export type PriceReadingPair = {
  current: PriceReadingSnapshot;
  previous: PriceReadingSnapshot | null;
};

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function migrateV2ToV3(raw: Record<string, PriceReadingSnapshot>): Record<string, PriceReadingPair> {
  const out: Record<string, PriceReadingPair> = {};
  for (const [key, snap] of Object.entries(raw)) {
    if (!snap || snap.priceUsd <= 0) continue;
    out[key] = {
      current: {
        priceUsd: snap.priceUsd,
        ts: snap.ts,
        simTableVersion: snap.simTableVersion ?? null,
      },
      previous: null,
    };
  }
  return out;
}

export function loadPriceReadingCache(): Record<string, PriceReadingPair> {
  try {
    const store = readStorage();
    const rawV3 = store?.getItem(STORAGE_KEY);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as Record<string, PriceReadingPair>;
      return parsed && typeof parsed === "object" ? parsed : {};
    }
    for (const legacyKey of [LEGACY_V2_KEY, LEGACY_MOBILE_KEY]) {
      const raw = store?.getItem(legacyKey);
      if (!raw) continue;
      const legacy = JSON.parse(raw) as Record<string, PriceReadingSnapshot & { kind?: string }>;
      const migrated = migrateV2ToV3(legacy);
      if (Object.keys(migrated).length > 0) {
        store?.setItem(STORAGE_KEY, JSON.stringify(migrated));
      }
      return migrated;
    }
    return {};
  } catch {
    return {};
  }
}

export function savePriceReadingCache(cache: Record<string, PriceReadingPair>): void {
  try {
    readStorage()?.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* quota */
  }
}

export type PriceReadingDelta = {
  pct: number | null;
  priorTs: string | null;
  currentTs: string | null;
};

export function computePriceReadingDelta(
  rowKey: string,
  priceUsd: number | null | undefined,
): PriceReadingDelta {
  if (!rowKey.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { pct: null, priorTs: null, currentTs: null };
  }
  const entry = loadPriceReadingCache()[rowKey];
  if (!entry?.previous || entry.previous.priceUsd <= 0) {
    return { pct: null, priorTs: null, currentTs: entry?.current?.ts ?? null };
  }
  const pct =
    Math.round(((priceUsd - entry.previous.priceUsd) / entry.previous.priceUsd) * 10000) / 100;
  return {
    pct,
    priorTs: entry.previous.ts,
    currentTs: entry.current.ts,
  };
}

export function recordPriceReadingUpdates(
  rows: Array<{ key: string; priceUsd: number | null | undefined }>,
  opts?: { simTableVersion?: string | null; versionChanged?: boolean },
): void {
  const cache = loadPriceReadingCache();
  const ts = new Date().toISOString();
  const versionChanged = opts?.versionChanged === true;
  for (const { key, priceUsd } of rows) {
    if (!key.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const snap: PriceReadingSnapshot = {
      priceUsd,
      ts,
      simTableVersion: opts?.simTableVersion ?? null,
    };
    const entry = cache[key];
    if (!entry) {
      cache[key] = { current: snap, previous: null };
      continue;
    }
    const priceChanged = entry.current.priceUsd !== priceUsd;
    if (!versionChanged && !priceChanged) continue;
    cache[key] = { current: snap, previous: entry.current };
  }
  savePriceReadingCache(cache);
}

export function seedPriceReadingCacheIfMissing(
  rows: Array<{ key: string; priceUsd: number | null | undefined; dailyPct?: number | null }>,
  simTableVersion?: string | null,
): number {
  const cache = loadPriceReadingCache();
  const ts = new Date().toISOString();
  let added = 0;
  for (const { key, priceUsd, dailyPct } of rows) {
    if (!key.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    if (cache[key]) continue;
    const priorPrice = priorPriceFromDailyMove(priceUsd, dailyPct);
    cache[key] = {
      current: { priceUsd, ts, simTableVersion: simTableVersion ?? null },
      previous:
        priorPrice != null
          ? {
              priceUsd: priorPrice,
              ts,
              simTableVersion: simTableVersion ?? null,
              synthetic: true,
            }
          : null,
    };
    added++;
  }
  if (added > 0) savePriceReadingCache(cache);
  return added;
}

function priorPriceFromDailyMove(currentPriceUsd: number, dailyPct: number | null | undefined): number | null {
  if (dailyPct == null || !Number.isFinite(dailyPct) || currentPriceUsd <= 0) return null;
  const prior = currentPriceUsd / (1 + dailyPct / 100);
  if (!Number.isFinite(prior) || prior <= 0) return null;
  return Math.round(prior * 10000) / 10000;
}

export function backfillSyntheticPricePrevious(
  rows: Array<{ key: string; priceUsd: number | null | undefined; dailyPct?: number | null }>,
  simTableVersion?: string | null,
): number {
  const cache = loadPriceReadingCache();
  const ts = new Date().toISOString();
  let updated = 0;
  for (const { key, priceUsd, dailyPct } of rows) {
    if (!key.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const entry = cache[key];
    if (!entry || entry.previous) continue;
    const priorPrice = priorPriceFromDailyMove(priceUsd, dailyPct);
    if (priorPrice == null) continue;
    cache[key] = {
      ...entry,
      previous: {
        priceUsd: priorPrice,
        ts,
        simTableVersion: simTableVersion ?? null,
        synthetic: true,
      },
    };
    updated++;
  }
  if (updated > 0) savePriceReadingCache(cache);
  return updated;
}

export type ReadingDelta = PriceReadingDelta & {
  source?: "last_read" | "market_close";
};

export function resolveReadingDelta(
  rowKey: string,
  priceUsd: number | null | undefined,
  opts?: {
    simTableVersion?: string | null;
    marketDayClosePct?: number | null;
  },
): ReadingDelta {
  const fromPrice = computePriceReadingDelta(rowKey, priceUsd);

  if (
    fromPrice.priorTs != null &&
    fromPrice.pct != null &&
    Number.isFinite(fromPrice.pct)
  ) {
    return { ...fromPrice, source: "last_read" };
  }

  const daily = opts?.marketDayClosePct;
  if (daily != null && Number.isFinite(daily)) {
    return {
      pct: Math.round(daily * 100) / 100,
      priorTs: null,
      currentTs: fromPrice.currentTs,
      source: "market_close",
    };
  }

  return { ...fromPrice, source: undefined };
}
