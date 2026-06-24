/** Due ultime letture prezzo per ticker — Δ% = attuale vs penultima misurazione. */

const STORAGE_KEY = "biotech_sim_price_read_v3";
const LEGACY_V2_KEY = "biotech_sim_price_read_v2";
const LEGACY_SESSION_KEY = "biotech_sim_price_read_v1";

export type PriceReadingSnapshot = {
  priceUsd: number;
  ts: string;
  simTableVersion?: string | null;
  /** Ricostruito da Var. Giorn. % quando non c'è ancora un 2° refresh locale. */
  synthetic?: boolean;
};

export type SimTablePriceRow = {
  key: string;
  priceUsd: number;
  /** Var. Giorn. % dal foglio — penultimo prezzo ≈ current / (1 + daily/100). */
  dailyPct?: number | null;
};

export type PriceReadingPair = {
  current: PriceReadingSnapshot;
  previous: PriceReadingSnapshot | null;
};

function readStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function migrateLegacySessionCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    readStorage()?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* ignore */
  }
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
  migrateLegacySessionCache();
  try {
    const store = readStorage();
    const rawV3 = store?.getItem(STORAGE_KEY);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as Record<string, PriceReadingPair>;
      return parsed && typeof parsed === "object" ? parsed : {};
    }
    const rawV2 = store?.getItem(LEGACY_V2_KEY);
    if (rawV2) {
      const legacy = JSON.parse(rawV2) as Record<string, PriceReadingSnapshot & { kind?: string }>;
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
    /* quota / private mode */
  }
}

export type PriceReadingDelta = {
  pct: number | null;
  priorTs: string | null;
  /** Timestamp dell'ultima misurazione registrata (o live se assente). */
  currentTs: string | null;
};

/** Fallback portafoglio / P&L — currentTs opzionale. */
export type ReadingDeltaFallback = {
  pct: number | null;
  priorTs: string | null;
  currentTs?: string | null;
};

/** Penultimo prezzo implicito da Var. Giorn. % (vs chiusura precedente). */
export function priorPriceFromDailyMove(
  currentPriceUsd: number,
  dailyPct: number | null | undefined,
): number | null {
  if (
    dailyPct == null ||
    !Number.isFinite(dailyPct) ||
    !Number.isFinite(currentPriceUsd) ||
    currentPriceUsd <= 0
  ) {
    return null;
  }
  const prior = currentPriceUsd / (1 + dailyPct / 100);
  if (!Number.isFinite(prior) || prior <= 0) return null;
  return Math.round(prior * 10000) / 10000;
}

function syntheticPreviousSnapshot(
  currentPriceUsd: number,
  dailyPct: number | null | undefined,
  ts: string,
  simTableVersion?: string | null,
): PriceReadingSnapshot | null {
  const priorPrice = priorPriceFromDailyMove(currentPriceUsd, dailyPct);
  if (priorPrice == null) return null;
  return {
    priceUsd: priorPrice,
    ts,
    simTableVersion: simTableVersion ?? null,
    synthetic: true,
  };
}

/** Δ% live vs penultima lettura registrata. */
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

/**
 * Registra una nuova misurazione: sposta current → previous quando cambia prezzo
 * o arriva un refresh tabella (versionChanged).
 */
export function recordPriceReadingUpdates(
  rows: Array<SimTablePriceRow | { key: string; priceUsd: number | null | undefined }>,
  opts?: {
    simTableVersion?: string | null;
    versionChanged?: boolean;
    /** Nuovo giorno di calendario — roll anche se prezzo invariato. */
    dayRoll?: boolean;
  },
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

    if (priceChanged) {
      cache[key] = { current: snap, previous: entry.current };
      continue;
    }

    /** Refresh tabella senza variazione prezzo — aggiorna solo metadata, non sposta previous. */
    if (opts?.dayRoll) {
      cache[key] = { current: snap, previous: entry.current };
    } else {
      cache[key] = {
        ...entry,
        current: {
          ...entry.current,
          ts: snap.ts,
          simTableVersion: snap.simTableVersion,
        },
      };
    }
  }

  savePriceReadingCache(cache);
}

/** Primo avvio / nuove righe — se c'è Var. Giorn. % crea anche penultima sintetica. */
export function seedPriceReadingCacheIfMissing(
  rows: Array<SimTablePriceRow | { key: string; priceUsd: number | null | undefined; dailyPct?: number | null }>,
  simTableVersion?: string | null,
): number {
  const cache = loadPriceReadingCache();
  const ts = new Date().toISOString();
  let added = 0;
  for (const row of rows) {
    const { key, priceUsd } = row;
    const dailyPct = "dailyPct" in row ? row.dailyPct : undefined;
    if (!key.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    if (cache[key]) continue;
    cache[key] = {
      current: { priceUsd, ts, simTableVersion: simTableVersion ?? null },
      previous: syntheticPreviousSnapshot(priceUsd, dailyPct, ts, simTableVersion),
    };
    added++;
  }
  if (added > 0) savePriceReadingCache(cache);
  return added;
}

/** Entry già in cache senza penultima → penultima da Var. Giorn. % (fix “—” al primo avvio). */
export function backfillSyntheticPricePrevious(
  rows: Array<SimTablePriceRow | { key: string; priceUsd: number | null | undefined; dailyPct?: number | null }>,
  simTableVersion?: string | null,
): number {
  const cache = loadPriceReadingCache();
  const ts = new Date().toISOString();
  let updated = 0;
  for (const row of rows) {
    const { key, priceUsd } = row;
    const dailyPct = "dailyPct" in row ? row.dailyPct : undefined;
    if (!key.trim() || priceUsd == null || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    const entry = cache[key];
    if (!entry || entry.previous) continue;
    const synthetic = syntheticPreviousSnapshot(priceUsd, dailyPct, ts, simTableVersion);
    if (!synthetic) continue;
    cache[key] = { ...entry, previous: synthetic };
    updated++;
  }
  if (updated > 0) savePriceReadingCache(cache);
  return updated;
}

/** Seed + backfill + snapshot su refresh prezzi. */
export function syncPriceReadingCache(
  rows: Array<SimTablePriceRow | { key: string; priceUsd: number | null | undefined; dailyPct?: number | null }>,
  opts?: { simTableVersion?: string | null; versionChanged?: boolean },
): void {
  const dayRoll = cacheNeedsDayRoll(rows);
  const versionChanged = opts?.versionChanged === true || dayRoll;
  if (versionChanged) {
    recordPriceReadingUpdates(rows, { ...opts, versionChanged: true, dayRoll });
  } else {
    seedPriceReadingCacheIfMissing(rows, opts?.simTableVersion);
    backfillSyntheticPricePrevious(rows, opts?.simTableVersion);
  }
}

/** @deprecated usa recordPriceReadingUpdates */
export function snapshotPriceReadingCache(
  rows: Array<{ key: string; priceUsd: number | null | undefined }>,
  simTableVersion?: string | null,
): void {
  recordPriceReadingUpdates(rows, { simTableVersion, versionChanged: true });
}

export type ReadingDelta = PriceReadingDelta & {
  /** last_read = Δ vs penultima misurazione locale */
  source?: "last_read" | "market_close" | "portfolio_history";
};

export type ReadingDeltaOptions = {
  simTableVersion?: string | null;
  /** Var. Giorn. % — solo fallback Simulation se non c'è penultima lettura. */
  marketDayClosePct?: number | null;
  /** @deprecated usa marketDayClosePct */
  dailyPctFallback?: number | null;
};

function marketClosePct(opts?: ReadingDeltaOptions): number | null {
  const v = opts?.marketDayClosePct ?? opts?.dailyPctFallback;
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/** True se il timestamp ISO cade in un giorno di calendario precedente a oggi (locale). */
export function isPriorCalendarDay(ts: string | null | undefined): boolean {
  if (!ts) return false;
  const prior = new Date(ts);
  if (Number.isNaN(prior.getTime())) return false;
  const now = new Date();
  return (
    prior.getFullYear() !== now.getFullYear() ||
    prior.getMonth() !== now.getMonth() ||
    prior.getDate() !== now.getDate()
  );
}

function cacheNeedsDayRoll(rows: Array<{ key: string }>): boolean {
  const cache = loadPriceReadingCache();
  for (const { key } of rows) {
    const entry = cache[key];
    if (entry?.current?.ts && isPriorCalendarDay(entry.current.ts)) return true;
  }
  return false;
}

/** Δ vs penultima lettura; fallback portfolio / chiusura giornaliera solo se assente. */
export function resolveReadingDelta(
  rowKey: string,
  priceUsd: number | null | undefined,
  portfolioFallback?: ReadingDeltaFallback,
  opts?: ReadingDeltaOptions,
): ReadingDelta {
  const fromPrice = computePriceReadingDelta(rowKey, priceUsd);
  const daily = marketClosePct(opts);

  if (
    fromPrice.priorTs != null &&
    fromPrice.pct != null &&
    Number.isFinite(fromPrice.pct)
  ) {
    /** Δ cache 0% ma foglio ha Var. Giorn. % → mostra movimento giornaliero. */
    if (fromPrice.pct === 0 && daily != null && daily !== 0) {
      const entry = loadPriceReadingCache()[rowKey];
      const staleSamePriceRoll =
        entry?.previous != null && entry.previous.priceUsd === entry.current.priceUsd;
      if (staleSamePriceRoll || isPriorCalendarDay(fromPrice.priorTs)) {
        return {
          pct: daily,
          priorTs: fromPrice.priorTs,
          currentTs: fromPrice.currentTs,
          source: "market_close",
        };
      }
    }
    return { ...fromPrice, source: "last_read" };
  }

  if (
    portfolioFallback?.pct != null &&
    Number.isFinite(portfolioFallback.pct) &&
    portfolioFallback.priorTs
  ) {
    return {
      pct: portfolioFallback.pct,
      priorTs: portfolioFallback.priorTs,
      currentTs: portfolioFallback.currentTs ?? fromPrice.currentTs,
      source: "portfolio_history",
    };
  }

  if (daily != null) {
    return { pct: daily, priorTs: null, currentTs: fromPrice.currentTs, source: "market_close" };
  }

  return { ...fromPrice, source: undefined };
}
