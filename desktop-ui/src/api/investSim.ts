import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import { getActiveInvestTesterId, getTesterSessionToken, TESTER_SESSION_HEADER } from "../sheet/testerSession";
import { resolveMobileSyncApiBase } from "../shared/remoteHost";
import { api, getStoredToken } from "./supernova";

export type InvestSimPersistedPayload = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
};

export type InvestSimHistoryPersistedPayload = {
  version: number;
  updated_at: string | null;
  points: InvestSimHistoryPoint[];
};

/** Shared Pulse lab book, or per-email tester book for remote clients. */
export function investSimInputsApiPath(testerId?: string | null): string {
  const tid = (testerId ?? getActiveInvestTesterId())?.trim() || "";
  if (tid) {
    return `/api/tester-feedback/testers/${encodeURIComponent(tid)}/sim-inputs`;
  }
  return "/api/investment/sim-inputs";
}

/**
 * Per-email tester books must hit the VPS (same host as mobile), even when
 * Electron uses localhost :8765 for sheets. Otherwise Andrea’s desktop saves
 * locally and his phone never sees the book.
 */
async function testerBookApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const base = resolveMobileSyncApiBase().replace(/\/$/, "");
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  const admin = getStoredToken();
  if (admin) headers.set("X-SuperNova-Token", admin);
  const sess = getTesterSessionToken();
  if (sess) headers.set(TESTER_SESSION_HEADER, sess);
  if (["POST", "PUT", "PATCH"].includes(method)) {
    const body = init?.body;
    if (
      body != null &&
      typeof body === "string" &&
      body.length > 0 &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

export async function fetchInvestSimInputsPersisted(): Promise<InvestSimPersistedPayload | null> {
  if (investSimInputsInFlight) return investSimInputsInFlight;
  if (
    investSimInputsCached &&
    Date.now() - investSimInputsCached.at < INVEST_SIM_INPUTS_CACHE_TTL_MS
  ) {
    return investSimInputsCached.payload;
  }
  const tid = getActiveInvestTesterId();
  const path = investSimInputsApiPath(tid);
  const promise = (async () => {
    try {
      if (tid) {
        return await testerBookApi<InvestSimPersistedPayload>(path);
      }
      return await api<InvestSimPersistedPayload>(path);
    } catch {
      return null;
    }
  })()
    .then((payload) => {
      investSimInputsCached = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      investSimInputsInFlight = null;
    });
  investSimInputsInFlight = promise;
  return promise;
}

export async function saveInvestSimInputsPersisted(
  inputs: InvestSimInputs
): Promise<void> {
  const tid = getActiveInvestTesterId();
  const path = investSimInputsApiPath(tid);
  const body = JSON.stringify({
    inputs,
    ...(tid ? { source: "desktop" } : {}),
  });
  if (tid) {
    await testerBookApi(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });
    invalidateInvestSimInputsCache();
    return;
  }
  await api(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  invalidateInvestSimInputsCache();
}

/** In-flight coalescer + short TTL cache for sim-inputs GET storm on mount. */
let investSimInputsInFlight: Promise<InvestSimPersistedPayload | null> | null =
  null;
let investSimInputsCached: {
  at: number;
  payload: InvestSimPersistedPayload | null;
} | null = null;
const INVEST_SIM_INPUTS_CACHE_TTL_MS = 8_000;

export function invalidateInvestSimInputsCache(): void {
  investSimInputsInFlight = null;
  investSimInputsCached = null;
}

let rebuildOutcomesTimer: ReturnType<typeof setTimeout> | null = null;
let rebuildOutcomesInFlight: Promise<void> | null = null;

/** Debounced rebuild — avoids 3× POST /sim-outcomes/rebuild after rapid PUTs. */
export function scheduleRebuildInvestmentSimOutcomes(delayMs = 2_500): void {
  if (rebuildOutcomesTimer) clearTimeout(rebuildOutcomesTimer);
  rebuildOutcomesTimer = setTimeout(() => {
    rebuildOutcomesTimer = null;
    void rebuildInvestmentSimOutcomes();
  }, delayMs);
}

/** Rigenera investment_sim_outcomes.json da invest_sim_inputs + snapshot Simulation. */
export async function rebuildInvestmentSimOutcomes(): Promise<void> {
  if (getActiveInvestTesterId()) return;
  if (rebuildOutcomesInFlight) return rebuildOutcomesInFlight;
  rebuildOutcomesInFlight = api("/api/investment/sim-outcomes/rebuild", {
    method: "POST",
  })
    .then(() => {})
    .finally(() => {
      rebuildOutcomesInFlight = null;
    });
  return rebuildOutcomesInFlight;
}

/**
 * In-flight coalescer for `/api/investment/sim-history`.
 *
 * On Dashboard mount both `hydrateInvestSimInputs` and the Loss-Analysis
 * bridge kick off a history fetch. The endpoint takes ~14 s on this backend,
 * so without dedupe we pay 2× the latency. Rebuild flows (PUT) bump the
 * in-memory cache invalidation timestamp via `invalidateInvestSimHistoryCache`.
 */
let investSimHistoryInFlight: Promise<InvestSimHistoryPersistedPayload | null> | null =
  null;
let investSimHistoryCached: {
  at: number;
  payload: InvestSimHistoryPersistedPayload | null;
} | null = null;
const INVEST_SIM_HISTORY_CACHE_TTL_MS = 30_000;

export function invalidateInvestSimHistoryCache(): void {
  investSimHistoryInFlight = null;
  investSimHistoryCached = null;
}

export async function fetchInvestSimHistoryPersisted(): Promise<InvestSimHistoryPersistedPayload | null> {
  // Per-tester remote accounts start empty — skip shared history hydrate.
  if (getActiveInvestTesterId()) {
    return { version: 1, updated_at: null, points: [] };
  }
  if (investSimHistoryInFlight) return investSimHistoryInFlight;
  if (
    investSimHistoryCached &&
    Date.now() - investSimHistoryCached.at < INVEST_SIM_HISTORY_CACHE_TTL_MS
  ) {
    return investSimHistoryCached.payload;
  }
  const promise = (async () => {
    try {
      return await api<InvestSimHistoryPersistedPayload>(
        "/api/investment/sim-history",
      );
    } catch {
      return null;
    }
  })()
    .then((payload) => {
      investSimHistoryCached = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      investSimHistoryInFlight = null;
    });
  investSimHistoryInFlight = promise;
  return promise;
}

export async function saveInvestSimHistoryPersisted(
  points: InvestSimHistoryPoint[],
): Promise<void> {
  if (getActiveInvestTesterId()) return;
  await api("/api/investment/sim-history", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points }),
  });
  invalidateInvestSimHistoryCache();
}
