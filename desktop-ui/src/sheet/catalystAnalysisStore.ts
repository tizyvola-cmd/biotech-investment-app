/**
 * Catalyst Analysis Store — localStorage-backed store for monitored assets,
 * catalyst entries, consensus snapshots, risk flags, and outcome history.
 *
 * Design:
 *  - One MonitoredAsset per ticker — holds the list of catalysts and the
 *    latest consensus snapshot.
 *  - Append-only outcome history (CatalystOutcome[]) — never deleted, only
 *    enriched when a catalyst is marked "reported".
 *  - Risk flags are separate from the clinical catalyst proxy — different
 *    risk category (legal/reputational vs clinical).
 *  - Storage pattern identical to patternProposalStore.ts (safeGetItem /
 *    safeSetItem with in-memory fallback).
 *
 * Stored keys:
 *   supernova.catalystAnalysis.assets.v1   → MonitoredAsset[]
 *   supernova.catalystAnalysis.outcomes.v1 → CatalystOutcome[]
 */
import { deriveProxyFromConsensus, type ConsensusInput, type ProxyResult } from "./catalystProbabilityProxy";

// ── Types ─────────────────────────────────────────────────────────────────

export type CatalystStatus =
  | "upcoming"
  | "imminent"
  | "reported"
  | "stale";

export type CatalystEntry = {
  id: string;
  /** Short description, e.g. "VELA-TEEN primary endpoint readout". */
  description: string;
  /**
   * Estimated window — preserve source granularity.
   * e.g. "mid 2026" | "Q3 2026" | "2026-09-15"
   */
  estimatedWindow: string;
  /**
   * Granularity of the estimate — drives display and staleness logic.
   * "precise" = specific date; "quarter" = Q1/Q2...; "broad" = "mid 2026" etc.
   */
  windowGranularity: "precise" | "quarter" | "broad";
  status: CatalystStatus;
  /** ISO date of last source check (even if nothing changed). */
  lastCheckedAt: string | null;
  /** ISO date when status was last updated. */
  statusUpdatedAt: string;
  /** Free-form note on why status changed. */
  statusNote: string | null;
};

export type RiskFlag = {
  id: string;
  /**
   * Category — deliberately separate from clinical catalyst.
   * "legal" | "governance" | "reputational" | "financial" | "other"
   */
  category: "legal" | "governance" | "reputational" | "financial" | "other";
  description: string;
  /** ISO date when flag was added. */
  flaggedAt: string;
  source: string;
  /** True once the situation has resolved. */
  resolved: boolean;
  resolvedAt: string | null;
};

export type MonitoredAsset = {
  /** Normalized uppercase ticker. */
  ticker: string;
  name: string;
  /** ISO date when first added to monitoring. */
  addedAt: string;
  /** "portfolio" = currently in real portfolio; "watchlist" = manual addition. */
  source: "portfolio" | "watchlist";
  catalysts: CatalystEntry[];
  /** Latest consensus snapshot + derived proxy. null if not yet fetched. */
  consensusSnapshot: ConsensusInput | null;
  proxyResult: ProxyResult | null;
  riskFlags: RiskFlag[];
  /** ISO date of last automatic search attempt. */
  lastAutoSearchAt: string | null;
};

/**
 * Outcome record for a catalyst that has been reported.
 * Append-only — basis for future calibration of uncertainty tiers.
 */
export type CatalystOutcome = {
  id: string;
  ticker: string;
  catalystId: string;
  /** Short paraphrase of the reported outcome — NOT verbatim source text. */
  outcomeSummary: string;
  /** ISO date when the outcome was reported (or first observed). */
  reportedAt: string;
  /** Price change % in the days after the report (if available). */
  priceChangePct1d: number | null;
  priceChangePct5d: number | null;
  /**
   * The uncertainty tier that was active for this catalyst when it was
   * imminent — for future calibration.
   */
  uncertaintyTierAtImminent: ProxyResult["uncertaintyTier"] | null;
  addedAt: string;
};

// ── Storage keys + helpers ─────────────────────────────────────────────────

const ASSETS_KEY = "supernova.catalystAnalysis.assets.v1";
const OUTCOMES_KEY = "supernova.catalystAnalysis.outcomes.v1";

const __mem: Record<string, string> = {};

function safeGet(key: string): string | null {
  if (typeof window !== "undefined") {
    try { return window.localStorage.getItem(key); } catch { /* fall */ }
  }
  return Object.prototype.hasOwnProperty.call(__mem, key) ? __mem[key]! : null;
}

function safeSet(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(key, value); return; } catch { /* fall */ }
  }
  __mem[key] = value;
}

// ── Assets ─────────────────────────────────────────────────────────────────

function loadAssets(): MonitoredAsset[] {
  const raw = safeGet(ASSETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MonitoredAsset[]) : [];
  } catch { return []; }
}

function saveAssets(assets: MonitoredAsset[]): void {
  try { safeSet(ASSETS_KEY, JSON.stringify(assets)); } catch { /* no-op */ }
}

export function listMonitoredAssets(): MonitoredAsset[] {
  return loadAssets().slice().sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function getMonitoredAsset(ticker: string): MonitoredAsset | null {
  return loadAssets().find((a) => a.ticker === ticker.toUpperCase()) ?? null;
}

export function addMonitoredAsset(
  ticker: string,
  name: string,
  source: MonitoredAsset["source"],
): MonitoredAsset {
  const assets = loadAssets();
  const existing = assets.find((a) => a.ticker === ticker.toUpperCase());
  if (existing) return existing;
  const asset: MonitoredAsset = {
    ticker: ticker.toUpperCase(),
    name,
    addedAt: new Date().toISOString(),
    source,
    catalysts: [],
    consensusSnapshot: null,
    proxyResult: null,
    riskFlags: [],
    lastAutoSearchAt: null,
  };
  assets.push(asset);
  saveAssets(assets);
  return asset;
}

export function removeMonitoredAsset(ticker: string): void {
  const assets = loadAssets().filter((a) => a.ticker !== ticker.toUpperCase());
  saveAssets(assets);
}

function updateAsset(ticker: string, updater: (a: MonitoredAsset) => MonitoredAsset): MonitoredAsset | null {
  const assets = loadAssets();
  const idx = assets.findIndex((a) => a.ticker === ticker.toUpperCase());
  if (idx < 0) return null;
  assets[idx] = updater(assets[idx]!);
  saveAssets(assets);
  return assets[idx]!;
}

// ── Catalysts ──────────────────────────────────────────────────────────────

export function addCatalyst(
  ticker: string,
  entry: Omit<CatalystEntry, "id" | "statusUpdatedAt" | "lastCheckedAt">,
): CatalystEntry | null {
  const catalyst: CatalystEntry = {
    ...entry,
    id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    statusUpdatedAt: new Date().toISOString(),
    lastCheckedAt: null,
  };
  const asset = updateAsset(ticker, (a) => ({
    ...a,
    catalysts: [...a.catalysts, catalyst],
  }));
  return asset ? catalyst : null;
}

export function updateCatalystStatus(
  ticker: string,
  catalystId: string,
  status: CatalystStatus,
  note: string | null,
): CatalystEntry | null {
  let updated: CatalystEntry | null = null;
  updateAsset(ticker, (a) => {
    const catalysts = a.catalysts.map((c) => {
      if (c.id !== catalystId) return c;
      updated = {
        ...c,
        status,
        statusNote: note,
        statusUpdatedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
      };
      return updated;
    });
    return { ...a, catalysts };
  });
  return updated;
}

export function markCatalystChecked(ticker: string, catalystId: string): void {
  updateAsset(ticker, (a) => ({
    ...a,
    catalysts: a.catalysts.map((c) =>
      c.id === catalystId ? { ...c, lastCheckedAt: new Date().toISOString() } : c,
    ),
    lastAutoSearchAt: new Date().toISOString(),
  }));
}

// ── Consensus snapshot ─────────────────────────────────────────────────────

export function saveConsensusSnapshot(
  ticker: string,
  snapshot: ConsensusInput,
): ProxyResult | null {
  const proxy = deriveProxyFromConsensus(snapshot);
  updateAsset(ticker, (a) => ({
    ...a,
    consensusSnapshot: snapshot,
    proxyResult: proxy,
  }));
  return proxy;
}

// ── Risk flags ─────────────────────────────────────────────────────────────

export function addRiskFlag(
  ticker: string,
  flag: Omit<RiskFlag, "id" | "flaggedAt" | "resolved" | "resolvedAt">,
): RiskFlag | null {
  const riskFlag: RiskFlag = {
    ...flag,
    id: `rf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    flaggedAt: new Date().toISOString(),
    resolved: false,
    resolvedAt: null,
  };
  const asset = updateAsset(ticker, (a) => ({
    ...a,
    riskFlags: [...a.riskFlags, riskFlag],
  }));
  return asset ? riskFlag : null;
}

export function resolveRiskFlag(ticker: string, flagId: string): void {
  updateAsset(ticker, (a) => ({
    ...a,
    riskFlags: a.riskFlags.map((f) =>
      f.id === flagId ? { ...f, resolved: true, resolvedAt: new Date().toISOString() } : f,
    ),
  }));
}

// ── Outcomes ───────────────────────────────────────────────────────────────

function loadOutcomes(): CatalystOutcome[] {
  const raw = safeGet(OUTCOMES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CatalystOutcome[]) : [];
  } catch { return []; }
}

function saveOutcomes(outcomes: CatalystOutcome[]): void {
  try { safeSet(OUTCOMES_KEY, JSON.stringify(outcomes)); } catch { /* no-op */ }
}

export function recordCatalystOutcome(
  outcome: Omit<CatalystOutcome, "id" | "addedAt">,
): CatalystOutcome {
  const record: CatalystOutcome = {
    ...outcome,
    id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    addedAt: new Date().toISOString(),
  };
  const all = [...loadOutcomes(), record];
  saveOutcomes(all);
  updateCatalystStatus(outcome.ticker, outcome.catalystId, "reported", outcome.outcomeSummary);
  return record;
}

export function listOutcomesForTicker(ticker: string): CatalystOutcome[] {
  return loadOutcomes()
    .filter((o) => o.ticker === ticker.toUpperCase())
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

export function listAllOutcomes(): CatalystOutcome[] {
  return loadOutcomes().sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

// ── Staleness helpers ──────────────────────────────────────────────────────

/** Days without a source check before a catalyst is considered "stale". */
export const STALE_THRESHOLD_DAYS = 14;

/** Days before estimated window to flip status → "imminent". */
export const IMMINENT_THRESHOLD_WEEKS = 6;

export function isStale(catalyst: CatalystEntry, nowMs: number = Date.now()): boolean {
  if (!catalyst.lastCheckedAt) return true;
  const ageMs = nowMs - new Date(catalyst.lastCheckedAt).getTime();
  return ageMs > STALE_THRESHOLD_DAYS * 86_400_000;
}

/** Reset for tests. */
export function __resetCatalystStoreForTests(): void {
  safeSet(ASSETS_KEY, JSON.stringify([]));
  safeSet(OUTCOMES_KEY, JSON.stringify([]));
}
