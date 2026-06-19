/**
 * topOppsStore — tier di raccomandazione pubblicati da Decision Lab
 * (Active Signals) e consumati da Dashboard / Simulation.
 *
 * Tier:
 * - hotKeys     — Zona hot Top opportunità (≤60 gg al CD, filtri completi)
 * - watchKeys   — Zona watch opportunità anticipate (61–120 gg)
 * - top2BuyKeys — Top 2 BUY (miglior ROI/giorno tra hot, fuori portafoglio)
 *
 * Persistenza: localStorage + CustomEvent in-page.
 */

const STORAGE_KEY = "supernova_top_opps_active";
const EVENT_NAME = "supernova:top-opps-changed";

export type TopOppsPublisher = "decision-lab" | "dashboard-strict" | "dashboard-preview";

export type PublishRecommendations = {
  hotKeys: string[];
  watchKeys: string[];
  top2BuyKeys: string[];
};

export type SetTopOppsOptions = {
  publishedBy?: TopOppsPublisher;
  /** Ripubblica anche se le chiavi non cambiano — aggiorna `updatedAt` (coherence store age). */
  forceTimestamp?: boolean;
};

export type TopOppsSnapshot = {
  /** Hot zone — Top opportunities (Decision Lab). */
  hotKeys: string[];
  /** Watch zone — Early opportunities. */
  watchKeys: string[];
  /** Top 2 BUY slot keys (subset hot, off-portfolio). */
  top2BuyKeys: string[];
  /** @deprecated Legacy union — equals hotKeys for backward compat. */
  keys: string[];
  keySet: Set<string>;
  hotKeySet: Set<string>;
  watchKeySet: Set<string>;
  top2BuyKeySet: Set<string>;
  updatedAt: number;
  publishedBy: TopOppsPublisher | null;
};

function uniqKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter((k) => typeof k === "string" && k.length > 0)));
}

function emptySnapshot(): TopOppsSnapshot {
  return {
    hotKeys: [],
    watchKeys: [],
    top2BuyKeys: [],
    keys: [],
    keySet: new Set(),
    hotKeySet: new Set(),
    watchKeySet: new Set(),
    top2BuyKeySet: new Set(),
    updatedAt: 0,
    publishedBy: null,
  };
}

function buildSnapshot(
  input: PublishRecommendations,
  publishedBy: TopOppsPublisher | null = null,
): TopOppsSnapshot {
  const hotKeys = uniqKeys(input.hotKeys);
  const watchKeys = uniqKeys(input.watchKeys);
  const top2BuyKeys = uniqKeys(input.top2BuyKeys);
  return {
    hotKeys,
    watchKeys,
    top2BuyKeys,
    keys: hotKeys,
    keySet: new Set(hotKeys),
    hotKeySet: new Set(hotKeys),
    watchKeySet: new Set(watchKeys),
    top2BuyKeySet: new Set(top2BuyKeys),
    updatedAt: Date.now(),
    publishedBy,
  };
}

function normalizeLegacy(parsed: Partial<TopOppsSnapshot>): PublishRecommendations {
  const hotKeys = Array.isArray(parsed.hotKeys)
    ? parsed.hotKeys.filter((k): k is string => typeof k === "string")
    : Array.isArray(parsed.keys)
      ? parsed.keys.filter((k): k is string => typeof k === "string")
      : [];
  const watchKeys = Array.isArray(parsed.watchKeys)
    ? parsed.watchKeys.filter((k): k is string => typeof k === "string")
    : [];
  const top2BuyKeys = Array.isArray(parsed.top2BuyKeys)
    ? parsed.top2BuyKeys.filter((k): k is string => typeof k === "string")
    : [];
  return { hotKeys, watchKeys, top2BuyKeys };
}

function readFromStorage(): TopOppsSnapshot {
  if (typeof window === "undefined") return emptySnapshot();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySnapshot();
    const parsed = JSON.parse(raw) as Partial<TopOppsSnapshot>;
    const snap = buildSnapshot(normalizeLegacy(parsed));
    snap.updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : snap.updatedAt;
    const pb = parsed.publishedBy;
    snap.publishedBy =
      pb === "decision-lab" || pb === "dashboard-strict" || pb === "dashboard-preview"
        ? pb
        : null;
    return snap;
  } catch {
    return emptySnapshot();
  }
}

function snapshotsEqual(a: TopOppsSnapshot, b: TopOppsSnapshot): boolean {
  const sameArr = (x: string[], y: string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    sameArr(a.hotKeys, b.hotKeys) &&
    sameArr(a.watchKeys, b.watchKeys) &&
    sameArr(a.top2BuyKeys, b.top2BuyKeys)
  );
}

let _current: TopOppsSnapshot = readFromStorage();

export function getActiveTopOpps(): TopOppsSnapshot {
  return _current;
}

/** Decision Lab non viene sovrascritto dal preview Dashboard per 6h. */
export const DECISION_LAB_TOP_OPPS_TTL_MS = 6 * 60 * 60 * 1000;

export function shouldSkipDashboardTopOppsPublish(
  snap: TopOppsSnapshot = _current,
): boolean {
  if (snap.publishedBy !== "decision-lab") return false;
  if (!snap.updatedAt) return false;
  return Date.now() - snap.updatedAt < DECISION_LAB_TOP_OPPS_TTL_MS;
}

export function setActiveTopOpps(
  input: PublishRecommendations,
  opts?: SetTopOppsOptions,
): void {
  if (typeof window === "undefined") return;
  const snap = buildSnapshot(input, opts?.publishedBy ?? null);
  if (
    !opts?.forceTimestamp &&
    snapshotsEqual(snap, _current) &&
    snap.publishedBy === _current.publishedBy
  ) {
    return;
  }

  _current = snap;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hotKeys: snap.hotKeys,
        watchKeys: snap.watchKeys,
        top2BuyKeys: snap.top2BuyKeys,
        updatedAt: snap.updatedAt,
        publishedBy: snap.publishedBy,
      }),
    );
  } catch {
    /* quota */
  }
  try {
    window.dispatchEvent(new CustomEvent<TopOppsSnapshot>(EVENT_NAME, { detail: snap }));
  } catch {
    /* no window */
  }
}

export function subscribeTopOpps(
  cb: (snap: TopOppsSnapshot) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent<TopOppsSnapshot>).detail;
    if (detail && Array.isArray(detail.hotKeys)) {
      cb(detail);
    } else {
      cb(_current);
    }
  };
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY) return;
    _current = readFromStorage();
    cb(_current);
  };
  window.addEventListener(EVENT_NAME, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
