import { loadLocalSheet } from "../data/localSheets";
import { applySimulationSidecarRows } from "../sheet/mergeManualSimEntries";
import { fetchProjectJson, invalidateProjectJsonCache } from "../data/projectData";
import type { CurveImpactCumulative } from "../data/signalCalibrationData";
import { isPhase0PerfEnabled, logPhase0Perf } from "../shared/phase0Perf";
import { isRemoteDataMode, resolveApiBase } from "../shared/remoteHost";
import { sanitizeIntradayTickers } from "../sheet/simulationPosition";
import {
  peekVolumeVsPrevCache,
  rememberVolumeVsPrevRows,
} from "../sheet/volumeVsPrevSession";
import { rememberSearchInterestPayload } from "../sheet/searchInterestStore";
import { getTesterSessionToken, TESTER_SESSION_HEADER } from "../sheet/testerSession";

const TOKEN_KEY = "supernova_api_token";
/** Stesso key della mobile app — token condiviso se entrambe puntano al VPS. */
const MOBILE_TOKEN_KEY = "sn_api_token";

/**
 * In-flight + short TTL coalescer for hot GET endpoints.
 * Alessandro's entry storm (Sep 2026): 9× parallel reloadSimulation / second
 * re-hit guidance+fda+catalyst calendars + hype + manual with no sharing.
 */
function coalesceGet<T>(
  slot: { inflight: Promise<T> | null; cached: { at: number; value: T } | null },
  ttlMs: number,
  run: () => Promise<T>,
): Promise<T> {
  if (slot.cached && Date.now() - slot.cached.at < ttlMs) {
    return Promise.resolve(slot.cached.value);
  }
  if (slot.inflight) return slot.inflight;
  const p = run()
    .then((value) => {
      slot.cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      slot.inflight = null;
    });
  slot.inflight = p;
  return p;
}

const CAL_SNAP_TTL_MS = 60_000;
const guidanceSnapSlot: {
  inflight: Promise<GuidanceCalendarSnapshot> | null;
  cached: { at: number; value: GuidanceCalendarSnapshot } | null;
} = { inflight: null, cached: null };
const catalystSnapSlot: {
  inflight: Promise<CatalystCalendarSnapshot> | null;
  cached: { at: number; value: CatalystCalendarSnapshot } | null;
} = { inflight: null, cached: null };
const fdaSnapSlot: {
  inflight: Promise<FdaAdcomCalendarSnapshot> | null;
  cached: { at: number; value: FdaAdcomCalendarSnapshot } | null;
} = { inflight: null, cached: null };
const hypeFunnelSlot: {
  inflight: Promise<{
    status?: { running?: boolean; last?: { accepted?: number } | null };
    entries?: Array<Record<string, unknown>>;
  }> | null;
  cached: {
    at: number;
    value: {
      status?: { running?: boolean; last?: { accepted?: number } | null };
      entries?: Array<Record<string, unknown>>;
    };
  } | null;
} = { inflight: null, cached: null };
const manualSimSlot: {
  inflight: Promise<Array<Record<string, unknown>>> | null;
  cached: { at: number; value: Array<Record<string, unknown>> } | null;
} = { inflight: null, cached: null };
const clinicalPreCdSlot: {
  inflight: Promise<ClinicalPreCdSnapshot> | null;
  cached: { at: number; value: ClinicalPreCdSnapshot } | null;
} = { inflight: null, cached: null };
const deskCacheSlot: {
  inflight: Promise<CatalystDeskCachePayload> | null;
  cached: { at: number; value: CatalystDeskCachePayload } | null;
} = { inflight: null, cached: null };
const DESK_CACHE_TTL_MS = 30_000;
const pendingHypothesesSlot: {
  inflight: Promise<PendingHypothesesPayload> | null;
  cached: { at: number; value: PendingHypothesesPayload } | null;
} = { inflight: null, cached: null };

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveApiBase();
  if (base) return `${base}${path}`;
  return path;
}

/** Rimuove prefisso env e virgolette se l'utente incolla l'intera riga .env. */
export function normalizeApiToken(raw: string): string {
  let v = raw.trim();
  if (!v) return "";
  const m = v.match(/^SUPERNOVA_API_TOKEN\s*=\s*(.+)$/i);
  if (m) v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getStoredToken(): string {
  const fromBrowser =
    localStorage.getItem(TOKEN_KEY)?.trim() ||
    localStorage.getItem(MOBILE_TOKEN_KEY)?.trim() ||
    "";
  if (fromBrowser) return normalizeApiToken(fromBrowser);
  return normalizeApiToken(import.meta.env.VITE_SUPERNOVA_API_TOKEN?.trim() || "");
}

export function setStoredToken(token: string): void {
  const v = normalizeApiToken(token);
  if (v) {
    localStorage.setItem(TOKEN_KEY, v);
    localStorage.setItem(MOBILE_TOKEN_KEY, v);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MOBILE_TOKEN_KEY);
  }
}

export function hasStoredApiToken(): boolean {
  return getStoredToken().length > 0;
}

export type ApiOptions = {
  /** Request timeout (ms). Default 120s for generic API; copilot chat uses 90s. */
  timeoutMs?: number;
};

export async function api<T>(
  path: string,
  init?: RequestInit,
  opts?: ApiOptions,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  // Approved tester device session — required for Deep Dive /api/desk/* on VPS
  // when the user does not have the owner SUPERNOVA_API_TOKEN.
  const testerSess = getTesterSessionToken();
  if (testerSess && !headers.has(TESTER_SESSION_HEADER)) {
    headers.set(TESTER_SESSION_HEADER, testerSess);
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = getStoredToken();
    if (token) headers.set("X-SuperNova-Token", token);
    const body = init?.body;
    if (
      body != null &&
      typeof body === "string" &&
      body.length > 0 &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }
  } else if (method === "GET") {
    // Protected admin GETs (sim-inputs, AI secrets, …) need the owner token.
    const token = getStoredToken();
    if (token) headers.set("X-SuperNova-Token", token);
  }
  let signal = init?.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  if (!signal && typeof AbortController !== "undefined") {
    const ac = new AbortController();
    signal = ac.signal;
    timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  }
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, signal });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const clientMs = performance.now() - t0;
  const handlerMsRaw = res.headers.get("x-response-time-ms");
  const handlerMs = handlerMsRaw != null ? Number(handlerMsRaw) : null;
  const queueGapMs =
    handlerMs != null && Number.isFinite(handlerMs)
      ? Math.max(0, clientMs - handlerMs)
      : null;
  if (isPhase0PerfEnabled()) {
    logPhase0Perf(
      "api",
      `${method} ${path}`,
      clientMs,
      undefined,
      handlerMs != null && Number.isFinite(handlerMs)
        ? `status=${res.status} handler=${handlerMs.toFixed(0)}ms gap=${queueGapMs?.toFixed(0) ?? "?"}ms`
        : `status=${res.status}`,
    );
  }
  if (!res.ok) {
    const text = await res.text();
    if (isPhase0PerfEnabled()) {
      logPhase0Perf("api", `${method} ${path}`, clientMs, text.length, `status=${res.status}`);
    }
    let msg = `${res.status}: ${text.slice(0, 240)}`;
    try {
      const body = JSON.parse(text) as { detail?: unknown };
      const d = body.detail;
      if (typeof d === "object" && d !== null && "message_it" in d) {
        const it = (d as { message_it?: string; path?: string }).message_it;
        const p = (d as { path?: string }).path;
        msg = p ? `${it} (${p})` : String(it);
      } else if (typeof d === "string") {
        msg = d;
      }
    } catch {
      /* keep default msg */
    }
    // Improve the canonical "500: <empty>" case so the user has at least one
    // actionable hint (probably the API process crashed or no longer listens).
    if (res.status === 500 && !text.trim()) {
      msg =
        "API error 500 (no body). The Python server probably crashed: " +
        "close the app and relaunch Avvia_Biotech_Desktop.bat or " +
        "Avvia_SuperNova_Electron.bat.";
    } else if (res.status === 0 || res.status === 502 || res.status === 503) {
      msg =
        `${res.status}: API server not reachable on ${apiUrl("/api/health")} — ` +
        "open System → API status to verify the connection.";
    } else if (res.status === 524 || /<!doctype|<html[\s>]/i.test(text)) {
      msg =
        "The server took too long to answer. The section is still being prepared — reopen it in a minute.";
    }
    throw new Error(msg);
  }
  const text = await res.text();
  if (isPhase0PerfEnabled()) {
    logPhase0Perf("api", `${method} ${path}`, clientMs, text.length);
  }
  return JSON.parse(text) as T;
}

/**
 * Coalesced /api/health probe (Jul 2026 perf).
 *
 * Prior to Jul 13 2026 this was a bare `api()` call. It is invoked from
 * `refreshApi()` at boot AND from the 10 s health-poller in App.tsx, so both
 * callers routinely fired their own `/api/health` in the same tick. Under
 * Chromium's HTTP/1.1 6-connection-per-host cap, those requests queued
 * behind slow endpoints (e.g. `learning-lab/overview` = 15 s), and each
 * `/api/health` was measured at 6+ seconds even though the server responds
 * in <5 ms. The stalling was client-side, not server-side.
 *
 * The coalescer + 5 s cache mirrors `probeApiReachable` — most callers just
 * want to know "is the backend alive" and are happy sharing an answer that
 * was true a couple of seconds ago.
 */
let healthInFlight: Promise<{ status: string; root: string }> | null = null;
let healthCached: { at: number; value: { status: string; root: string } } | null = null;
const HEALTH_CACHE_TTL_MS = 5_000;
/**
 * VPS health can sit behind other HTTP/1.1 slots for several seconds.
 * 12 s was too tight under load (health itself is <5 ms; client queue often
 * 6–15 s) and caused false "API offline" flaps. Align closer to mobile (25 s).
 */
const HEALTH_PROBE_TIMEOUT_MS = 25_000;

export function fetchHealth(): Promise<{ status: string; root: string }> {
  if (healthCached && Date.now() - healthCached.at < HEALTH_CACHE_TTL_MS) {
    return Promise.resolve(healthCached.value);
  }
  if (healthInFlight) {
    return healthInFlight;
  }
  const p = api<{ status: string; root: string }>("/api/health", undefined, {
    timeoutMs: HEALTH_PROBE_TIMEOUT_MS,
  })
    .then((v) => {
      healthCached = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      healthInFlight = null;
    });
  healthInFlight = p;
  return p;
}

/** Lightweight monitor history for weekly trend KPIs (no full learnings bundle). */
export function fetchAccuracyMonitorHistory() {
  return api<{ entries?: unknown[]; path?: string; error?: string }>(
    "/api/models/accuracy-monitor",
  );
}

/**
 * Coalesced /api/status probe (Jul 2026 perf).
 *
 * Called at boot by BOTH `refreshApi()` (App.tsx:593) and by the `apiOk===true`
 * effect (App.tsx:1445). Without dedup those fire in the same tick, adding
 * two 3 s requests to the boot-storm competing for HTTP slots. Response is
 * small (600 B) and near-static — cache for 10 s.
 */
let statusInFlight: Promise<import("../types").ApiStatus> | null = null;
let statusCached: { at: number; value: import("../types").ApiStatus } | null = null;
const STATUS_CACHE_TTL_MS = 10_000;

export function fetchStatus(): Promise<import("../types").ApiStatus> {
  if (statusCached && Date.now() - statusCached.at < STATUS_CACHE_TTL_MS) {
    return Promise.resolve(statusCached.value);
  }
  if (statusInFlight) return statusInFlight;
  const p = api<import("../types").ApiStatus>("/api/status")
    .then((v) => {
      statusCached = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      statusInFlight = null;
    });
  statusInFlight = p;
  return p;
}

/** Force a fresh /api/status on next call (use after actions that mutate server state). */
export function invalidateStatusCache(): void {
  statusInFlight = null;
  statusCached = null;
}

/** POST leggero — ok se X-SuperNova-Token è accettato dal server (endpoint già sul VPS). */
export function verifyApiToken() {
  return saveAiSecrets({});
}

export function fetchOrchestratorLog(tail = 3000) {
  return api<{ log: string }>(`/api/orchestrator/log?tail=${tail}`);
}

export function runOrchestrator(profile: "quick" | "skip_fetch" | "full" = "quick") {
  return api<Record<string, string>>(`/api/orchestrator/run?profile=${profile}`, {
    method: "POST",
  });
}

/** Refresh — profilo ``daily`` | ``simulation`` | ``accuracy`` | ``sec_k8`` | ``sunday`` | ``dry_run``. */
export function runDailyRefresh(
  profile: "daily" | "simulation" | "accuracy" | "sec_k8" | "sunday" | "dry_run" | "accuracy_only" | "dry_run" = "daily"
) {
  return api<Record<string, string>>(`/api/refresh/run?profile=${profile}`, {
    method: "POST",
  });
}

export function fetchRefreshStatus() {
  return api<{
    running?: boolean;
    state?: string;
    ok?: string;
    message?: string;
    updated_at?: string;
    profile?: string;
    exit_code?: number;
    snapshots_exported?: string;
    orchestrator_summary?: import("./refresh").OrchestratorRunSummary;
  }>("/api/refresh/status");
}

export function fetchRefreshLog(tail = 4000) {
  return api<{ log: string }>(`/api/refresh/log?tail=${tail}`);
}

// ── New Bio IPO refresh ─────────────────────────────────────────────────────

export type NewBioIpoAdded = {
  symbol: string;
  name?: string | null;
  ipo_date?: string | null;
  exchange?: string | null;
  price?: number | string | null;
  shares?: number | string | null;
  industry?: string | null;
  sector?: string | null;
  market_cap?: number | null;
  current_price?: number | null;
  website?: string | null;
  country?: string | null;
};

export type NewBioIpoSummary = {
  started_at?: string;
  finished_at?: string;
  elapsed_sec?: number;
  window_from?: string;
  window_to?: string;
  finnhub_total?: number;
  added_count?: number;
  added?: NewBioIpoAdded[];
  skipped_existing_count?: number;
  skipped_non_biotech_count?: number;
  skipped_no_symbol_count?: number;
  skipped_existing_sample?: string[];
  skipped_non_biotech_sample?: string[];
  yfinance_update?: {
    ran?: boolean;
    fetched?: number;
    error?: string;
    fetched_symbols?: string[];
    new_from_this_run?: number;
    backfilled_from_previous_runs?: number;
    skipped_reason?: string;
  };
  source?: string;
};

/** Avvia il refresh New Bio IPO in background sul server. */
export function runNewBioIpoRefresh() {
  return api<{ started?: string; running?: string; message?: string; error?: string }>(
    "/api/refresh/new-bio-ipo",
    { method: "POST" }
  );
}

/** Stato + ultimo summary del refresh New Bio IPO. */
export function fetchNewBioIpoStatus() {
  return api<{
    running?: boolean;
    summary?: NewBioIpoSummary | null;
    error?: string | null;
  }>("/api/refresh/new-bio-ipo/status");
}

/**
 * Rigenera gli snapshot JSON in ``data/`` letti dalla UI desktop.
 * Da chiamare dopo un refresh server-side (refresh_fast.py) per portare a video
 * Simulation/Accuracy/Clinical/SecK8/Financial aggiornati.
 */
export function exportDesktopSnapshots(opts?: { essential?: boolean }) {
  const q = opts?.essential ? "?essential=1" : "";
  return api<{
    updated_at?: string;
    sheets?: Record<string, { rows?: number; path?: string; error?: string }>;
    error?: string;
  }>(`/api/desktop/export-snapshots${q}`, { method: "POST" });
}

export function mergeYfIntoFinancialSnapshot() {
  return api<{ added?: string[]; total?: number; error?: string }>(
    "/api/desktop/merge-yf-financial",
    { method: "POST" }
  );
}

// ── Catalyst Feed ────────────────────────────────────────────────────────────

export type CatalystExtracted = {
  catalyst_type?: "efficacy" | "safety" | "regulatory" | "deal" | "financial" | "other";
  headline?: string | null;
  trial_name?: string | null;
  phase?: string | null;
  endpoint_met?: boolean | null;
  key_metric?: string | null;
  next_milestone?: string | null;
  confidence?: number | null;
};

export type CatalystEvent = {
  ticker: string;
  company: string;
  cik?: string;
  filing_date: string;
  cd_date?: string | null;
  days_before_cd?: number | null;
  cd_window_match?: boolean;
  accession?: string;
  form_type?: string;
  items_raw?: string;
  items_label?: string;
  edgar_browse_url?: string;
  filing_doc_url?: string;
  delta_d1?: number | null;
  delta_d2?: number | null;
  delta_d3?: number | null;
  extracted: CatalystExtracted;
};

export type CatalystFeedSnapshot = {
  updated_at?: string | null;
  count?: number;
  events?: CatalystEvent[];
};

export type CatalystFeedStatus = {
  running?: boolean;
  message?: string;
  processed?: number;
  total?: number;
  ai_ok?: number;
  error?: string | null;
  finished_at?: string | null;
  ai_provider?: AiProviderInfo;
};

export function runCatalystFeedRefresh() {
  return api<{ started?: boolean; message?: string }>("/api/catalyst-feed/refresh", {
    method: "POST",
  });
}

export function fetchCatalystFeedStatus() {
  return api<CatalystFeedStatus>("/api/catalyst-feed/status");
}

export function fetchCatalystFeedSnapshot() {
  return api<CatalystFeedSnapshot>("/api/catalyst-feed/snapshot");
}

// ── Guidance Calendar ────────────────────────────────────────────────────────

export type GuidanceCalendarEvent = {
  ticker: string;
  company: string;
  event_type?: "cd" | "readout" | "submission" | "approval" | "pdufa" | "partnership" | "preclinical" | "initiation" | "fda_vote" | "fda_safety" | "other";
  asset_name?: string | null;
  trial_phase?: string | null;
  indication?: string | null;
  timing_quote?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  source_type?: string | null;
  source_date?: string | null;
  confidence?: number | null;
  sim_cd_date?: string | null;
  /** How the event was derived: "llm_extract" | "explicit_pdufa" | "priority_review_estimate" | "standard_review_estimate" | "external_calendar" */
  estimation_method?: string | null;
  /** Drugs@FDA / quote: approved | tentative_approval | crl | pending */
  fda_outcome?: "approved" | "tentative_approval" | "crl" | "pending" | null;
  link?: string | null;
  /** Phase 1 — Discovery / ClinicalTrials.gov / FDA (comma-joined in UI). */
  identification_sources?: string[] | null;
  identification_sources_label?: string | null;
  /** Phase 1 — Breakthrough / Fast Track / Orphan / … */
  regulatory_designations?: string[] | null;
  regulatory_designations_label?: string | null;
  /** Main inflection (PDUFA / AdCom / high-|score| readout) — ochre bold in Calendar. */
  main_inflection?: boolean | null;
  inflection_importance?: number | null;
  inflection_label?: string | null;
};

export type GuidanceCalendarSnapshot = {
  updated_at?: string | null;
  count?: number;
  tickers_scanned?: number;
  events?: GuidanceCalendarEvent[];
};

export type GuidanceCalendarStatus = {
  running?: boolean;
  message?: string;
  processed?: number;
  total?: number;
  error?: string | null;
  finished_at?: string | null;
  ai_provider?: AiProviderInfo;
  /** ISO week of last successful weekly server refresh (e.g. 2026-W38). */
  last_weekly_week?: string | null;
  last_weekly_at?: string | null;
};

export function runGuidanceCalendarRefresh(force = false) {
  return api<{ started?: boolean; message?: string }>("/api/guidance-calendar/refresh", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export function fetchGuidanceCalendarStatus() {
  return api<GuidanceCalendarStatus>("/api/guidance-calendar/status");
}

export function fetchGuidanceCalendarSnapshot() {
  return coalesceGet(guidanceSnapSlot, CAL_SNAP_TTL_MS, () =>
    api<GuidanceCalendarSnapshot>("/api/guidance-calendar/snapshot", undefined, {
      timeoutMs: 12_000,
    }),
  );
}

/** SEC forward calendar entry (Part 2) — PDUFA / AdCom / Readout / Conference. */
export type CatalystCalendarEntry = {
  id?: string;
  ticker: string;
  event_type: "PDUFA" | "AdCom" | "Readout" | "Conference" | "Partnership" | string;
  date_precision: "exact_date" | "quarter_window" | "half_year_window" | string;
  date_value?: string | null;
  window_label?: string | null;
  /** Counterparty of a Partnership entry (license / collaboration deal). */
  partner?: string | null;
  source_filing_url?: string | null;
  source_form?: string | null;
  source_item?: string | null;
  extracted_at?: string | null;
  filing_date?: string | null;
  accession?: string | null;
  raw_snippet?: string | null;
  confidence?: "high" | "medium" | "low" | string;
  /** Main inflection point (ochre bold in Calendar). */
  main_inflection?: boolean | null;
  inflection_importance?: number | null;
  inflection_label?: string | null;
};

export type CatalystCalendarSnapshot = {
  updated_at?: string | null;
  count?: number;
  history_count?: number;
  entries?: CatalystCalendarEntry[];
  schema?: Record<string, unknown>;
  meta?: {
    max_8k_scan?: number;
    lookback_days?: number;
    discovery_tickers?: string[];
    scanned_tickers?: string[];
    roster_count?: number;
    event_types?: string[];
    [key: string]: unknown;
  };
};

export type CatalystCalendarStatus = {
  running?: boolean;
  message?: string;
  processed?: number;
  total?: number;
  error?: string | null;
  finished_at?: string | null;
};

export function runCatalystCalendarRefresh(opts?: {
  includeBiotech?: boolean;
  biotechGapOnly?: boolean;
}) {
  const body: Record<string, boolean> = {};
  if (opts?.includeBiotech) body.include_biotech = true;
  if (opts?.biotechGapOnly) body.biotech_gap_only = true;
  return api<{
    started?: boolean;
    message?: string;
    include_biotech?: boolean;
    biotech_gap_only?: boolean;
  }>("/api/catalyst-calendar/refresh", {
    method: "POST",
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });
}

export function fetchCatalystCalendarStatus() {
  return api<CatalystCalendarStatus>("/api/catalyst-calendar/status");
}

export function fetchCatalystCalendarSnapshot() {
  return coalesceGet(catalystSnapSlot, CAL_SNAP_TTL_MS, () =>
    api<CatalystCalendarSnapshot>("/api/catalyst-calendar/snapshot", undefined, {
      timeoutMs: 12_000,
    }),
  );
}

export type CalendarIdentityIndex = {
  updated_at?: string | null;
  biotech_reference_count?: number;
  ticker_count?: number;
  by_ticker?: Record<
    string,
    {
      ticker?: string;
      identification_sources?: string[];
      regulatory_designations?: string[];
      in_biotech_reference?: boolean;
    }
  >;
};

export function fetchCalendarIdentityIndex() {
  return api<CalendarIdentityIndex>("/api/calendar/identity-index");
}

export type DiscoveryCandidate = {
  ticker?: string | null;
  cik: string;
  company_name?: string | null;
  sic_code?: string | null;
  matched_keywords?: string[];
  signal_tier?: "A" | "B" | string;
  first_seen_at?: string | null;
  source_filing_url?: string | null;
  raw_snippet?: string | null;
  status?: "new" | "reviewed_added" | "reviewed_rejected" | string;
  adsh?: string | null;
  file_date?: string | null;
};

export type UniverseDiscoverySnapshot = {
  updated_at?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  count?: number;
  candidates?: DiscoveryCandidate[];
  meta?: {
    raw_hits?: number;
    sic_filtered_hits?: number;
    skipped_watchlist?: number;
    skipped_reviewed?: number;
    auto_queued_to_calendar?: number;
    auto_queued_tickers?: string[];
    sics_param_effective?: boolean | null;
    watchlist_tickers?: number;
    errors?: string[];
  };
  schema?: Record<string, unknown>;
};

export type UniverseDiscoveryStatus = {
  running?: boolean;
  message?: string;
  processed?: number;
  total?: number;
  error?: string | null;
  finished_at?: string | null;
  sics_param_effective?: boolean | null;
};

export function runUniverseDiscoveryRefresh() {
  return api<{ started?: boolean; message?: string }>("/api/universe-discovery/refresh", {
    method: "POST",
  });
}

export function fetchUniverseDiscoveryStatus() {
  return api<UniverseDiscoveryStatus>("/api/universe-discovery/status");
}

export function fetchUniverseDiscoverySnapshot() {
  return api<UniverseDiscoverySnapshot>("/api/universe-discovery/snapshot");
}

export function reviewUniverseDiscoveryCandidate(
  cik: string,
  status: "new" | "reviewed_added" | "reviewed_rejected",
  opts?: { startCalendar?: boolean },
) {
  return api<{
    ok?: boolean;
    error?: string;
    cik?: string;
    status?: string;
    queued_for_calendar?: boolean;
    calendar_refresh_started?: boolean;
    ticker?: string | null;
  }>("/api/universe-discovery/review", {
    method: "POST",
    body: JSON.stringify({
      cik,
      status,
      start_calendar: opts?.startCalendar !== false,
    }),
  });
}

export type FdaAdcomBriefingCard = {
  status?: string;
  score?: number | null;
  stance?: string | null;
  title?: string;
  summaryEn?: string;
  summaryIt?: string;
  resultsEn?: string[];
  resultsIt?: string[];
  statisticsEn?: string[];
  statisticsIt?: string[];
  conclusionsEn?: string[];
  conclusionsIt?: string[];
  bulletsEn?: string[];
  bulletsIt?: string[];
  materialsUrl?: string;
  pdfUrl?: string;
  matchOk?: boolean;
  matchHint?: string;
  source?: string;
  updated_at?: string;
};

export type FdaAdcomCalendarRow = {
  id: string;
  date: string;
  ticker: string;
  company: string;
  product: string;
  eventEn: string;
  eventIt: string;
  committee: string;
  kind: "vote" | "safety_review" | string;
  href: string;
  briefingPdfHint?: string;
  briefing?: FdaAdcomBriefingCard | null;
};

export type FdaAdcomCalendarSnapshot = {
  updated_at?: string | null;
  refreshed_for_month?: string | null;
  horizon_start?: string | null;
  horizon_end?: string | null;
  horizon_months?: number;
  source?: string | null;
  source_url?: string | null;
  count?: number;
  rows?: FdaAdcomCalendarRow[];
  error?: string | null;
};

export type FdaAdcomCalendarStatus = {
  running?: boolean;
  message?: string;
  error?: string | null;
  finished_at?: string | null;
};

export function fetchFdaAdcomCalendarSnapshot() {
  return coalesceGet(fdaSnapSlot, CAL_SNAP_TTL_MS, () =>
    api<FdaAdcomCalendarSnapshot>("/api/fda-adcom-calendar/snapshot", undefined, {
      timeoutMs: 12_000,
    }),
  );
}

export function fetchFdaAdcomCalendarStatus() {
  return api<FdaAdcomCalendarStatus>("/api/fda-adcom-calendar/status");
}

export function runFdaAdcomCalendarRefresh(force = false) {
  return api<{ started?: boolean; message?: string }>("/api/fda-adcom-calendar/refresh", {
    method: "POST",
    body: JSON.stringify({ force }),
  });
}

export function runFdaAdcomBriefingRefresh(force = false) {
  return api<{ started?: boolean; message?: string }>(
    "/api/fda-adcom-calendar/briefings/refresh",
    {
      method: "POST",
      body: JSON.stringify({ force }),
    },
  );
}

// ── Batch Quotes ─────────────────────────────────────────────────────────────

export type TickerQuote = {
  price: number | null;
  previousClose: number | null;
  dailyChangePct: number | null;
  volume: number | null;
  avgVolume: number | null;
  beta: number | null;
  marketCap: number | null;
};

export function fetchBatchQuotes(tickers: string[]) {
  return api<{ quotes: Record<string, TickerQuote> }>("/api/quotes/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
}

// ── Regulatory Risk Snapshot ──────────────────────────────────────────────────

export type RegulatoryRiskSignal = {
  ticker: string;
  crl:      { detected: boolean; hits: string[]; sources: { headline: string; filing_date?: string; source: string }[] };
  pdufa:    { detected: boolean; hits: string[]; sources: { headline: string; filing_date?: string; source: string }[] };
  cmc:      { detected: boolean; hits: string[]; sources: { headline: string; filing_date?: string; source: string }[] };
  approved: { detected: boolean; hits: string[]; sources: { headline: string; filing_date?: string; source: string }[] };
  positive: { detected: boolean; hits: string[]; sources: { headline: string; filing_date?: string; source: string }[] };
  score: number;
  /** True when ticker was scanned but no filing risk/favorable keywords were found. */
  no_signals?: boolean;
};

export type RegulatoryRiskSnapshot = {
  updated_at: string | null;
  ticker_count?: number;
  signal_count?: number;
  tickers: Record<string, RegulatoryRiskSignal>;
};

/**
 * In-flight coalescer for `/api/regulatory-risk/snapshot`.
 *
 * Called concurrently on Dashboard / Evaluation Lab mount by MainDashboardView,
 * DashboardPulseTable, PortfolioLossAnalysisView and ModelComparisonPanel.
 * The endpoint currently responds in ~10 s on this backend, so without dedupe
 * we pay 4× the latency for identical payloads (see PERF logs on 2026-07-13).
 */
let regulatoryRiskInFlight: Promise<RegulatoryRiskSnapshot> | null = null;
let regulatoryRiskCached: { at: number; snap: RegulatoryRiskSnapshot } | null = null;
const REGULATORY_RISK_CACHE_TTL_MS = 60_000;

export function fetchRegulatoryRiskSnapshot(): Promise<RegulatoryRiskSnapshot> {
  if (regulatoryRiskInFlight) return regulatoryRiskInFlight;
  if (
    regulatoryRiskCached &&
    Date.now() - regulatoryRiskCached.at < REGULATORY_RISK_CACHE_TTL_MS
  ) {
    return Promise.resolve(regulatoryRiskCached.snap);
  }
  const p = api<RegulatoryRiskSnapshot>("/api/regulatory-risk/snapshot")
    .then((snap) => {
      regulatoryRiskCached = { at: Date.now(), snap };
      return snap;
    })
    .finally(() => {
      regulatoryRiskInFlight = null;
    });
  regulatoryRiskInFlight = p;
  return p;
}

export function invalidateRegulatoryRiskCache(): void {
  regulatoryRiskInFlight = null;
  regulatoryRiskCached = null;
}

export function refreshRegulatoryRiskSnapshot() {
  return api<RegulatoryRiskSnapshot>("/api/regulatory-risk/refresh", { method: "POST" });
}

export type AiProviderId = "github" | "anthropic" | "openai" | "gemini";

export type AiUsageSummary = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type AnthropicBalanceInfo = {
  remaining_eur?: number | null;
  remaining_usd?: number | null;
  prepaid_eur?: number | null;
  spent_eur?: number | null;
  spent_usd?: number | null;
  source?: "live" | "estimated" | "unset" | string;
  prepaid_set_at?: string | null;
  org_id_set?: boolean;
  live_error?: string | null;
  updated_at?: string | null;
};

export type AiProviderInfo = {
  /** Provider scelto (override runtime o env). */
  provider?: AiProviderId | string | null;
  active?: string | null;
  label?: string;
  session?: string | null;
  forced?: string | null;
  configured?: string[];
  available?: boolean;
  allow_fallback?: boolean;
  errors?: Record<string, string>;
  hint_it?: string;
  hint_en?: string;
  last_success?: boolean;
  github_rate_limited?: boolean;
  github_cooldown_s?: number;
  usage_30d?: Partial<Record<string, AiUsageSummary>>;
  anthropic_console_url?: string;
  anthropic_balance?: AnthropicBalanceInfo | null;
  secrets?: AiSecretsStatus;
  probe_ok?: boolean;
  ok?: boolean;
  error?: string;
};

export function fetchAiProviderInfo() {
  return api<AiProviderInfo>("/api/ai/provider");
}

/** Alias per feed clinico (STEP 3). */
export const fetchAiProvider = fetchAiProviderInfo;

export function probeAiProvider() {
  return api<AiProviderInfo & { probe_ok?: boolean }>("/api/ai/provider/probe", {
    method: "POST",
  });
}

export function setAiProvider(provider: AiProviderId) {
  return api<AiProviderInfo>("/api/ai/provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
}

/** @deprecated use setAiProvider */
export function selectAiProvider(provider: AiProviderId) {
  return api<AiProviderInfo>("/api/ai/provider/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
}

export type AiSecretProviderStatus = {
  set: boolean;
  masked: string;
  source: "ui" | "env" | null;
};

export type AiSecretsStatus = {
  providers: Partial<Record<AiProviderId, AiSecretProviderStatus>>;
  storage_hint?: string;
  anthropic_console_url?: string;
  anthropic_prepaid_eur?: number | null;
  anthropic_prepaid_set_at?: string | null;
  anthropic_org_id?: string | null;
  provider?: AiProviderInfo;
  ok?: boolean;
};

export function fetchAiSecretsStatus() {
  return api<AiSecretsStatus>("/api/ai/secrets");
}

export function saveAiSecrets(body: {
  anthropic_api_key?: string;
  openai_api_key?: string;
  github_token?: string;
  gemini_api_key?: string;
  anthropic_prepaid_eur?: number | string;
  anthropic_org_id?: string;
  clear_anthropic?: boolean;
  clear_openai?: boolean;
  clear_github?: boolean;
  clear_gemini?: boolean;
  clear_anthropic_prepaid?: boolean;
}) {
  return api<AiSecretsStatus>("/api/ai/secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runClinicalPreCdRefresh(
  portfolioOnly = true,
  opts?: { force?: boolean; deep?: boolean; tickers?: string[] },
) {
  const params = new URLSearchParams({
    portfolio_only: portfolioOnly ? "1" : "0",
  });
  if (opts?.force) params.set("force", "1");
  if (opts?.deep) params.set("deep", "1");
  if (opts?.tickers?.length) {
    params.set("tickers", opts.tickers.join(","));
  }
  return api<{
    started?: boolean;
    message?: string;
    portfolio_only?: boolean;
    force?: boolean;
    deep?: boolean;
  }>(`/api/clinical-pre-cd/refresh?${params}`, { method: "POST" });
}

export type HypeVolumeFunnelScanResult = {
  started?: boolean;
  message?: string;
  tickers?: string[];
  done?: boolean;
  accepted?: number;
  surged?: number;
};

export function runHypeVolumeFunnelScan(tickers?: string[]) {
  const params = new URLSearchParams();
  if (tickers?.length) params.set("tickers", tickers.join(","));
  const q = params.toString();
  return api<HypeVolumeFunnelScanResult>(
    `/api/hype-volume-funnel/scan${q ? `?${q}` : ""}`,
    { method: "POST" },
    { timeoutMs: 15_000 },
  );
}

export function fetchHypeVolumeFunnelStatus() {
  return coalesceGet(hypeFunnelSlot, CAL_SNAP_TTL_MS, () =>
    api<{
      status?: { running?: boolean; last?: { accepted?: number } | null };
      entries?: Array<Record<string, unknown>>;
    }>("/api/hype-volume-funnel"),
  );
}

/** Manual sidecar rows (CPIX / GPCR / CMPX) — not stored in the raw sim snapshot. */
export async function fetchManualSimEntries(): Promise<Array<Record<string, unknown>>> {
  return coalesceGet(manualSimSlot, CAL_SNAP_TTL_MS, async () => {
    try {
      const remote = await api<{ entries?: Array<Record<string, unknown>> }>(
        "/api/simulation/manual-entries",
      ).catch(() => null);
      if (Array.isArray(remote?.entries)) return remote.entries;
      const { data } = await fetchProjectJson<{
        entries?: Array<Record<string, unknown>>;
      }>("manual_sim_entries.json");
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch {
      return [];
    }
  });
}

export async function fetchYfCache(ticker: string): Promise<{
  companyName?: string | null;
  sector?: string | null;
  industry?: string | null;
  marketCap?: number | null;
} | null> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  let base: {
    companyName?: string | null;
    sector?: string | null;
    industry?: string | null;
    marketCap?: number | null;
  } | null = null;
  try {
    const { data } = await fetchProjectJson<{
      companyName?: string | null;
      sector?: string | null;
      industry?: string | null;
      marketCap?: number | null;
    }>(`yf_cache/${tk}.json`);
    base = data ?? null;
  } catch {
    base = null;
  }
  // VPS web does not serve data/yf_cache/*.json — fill marketCap from quotes snapshot.
  const hasMcap =
    typeof base?.marketCap === "number" &&
    Number.isFinite(base.marketCap) &&
    base.marketCap > 0;
  if (hasMcap) return base;
  try {
    const batch = await fetchBatchQuotes([tk]);
    const q = batch?.quotes?.[tk];
    const mcap =
      typeof q?.marketCap === "number" && Number.isFinite(q.marketCap) && q.marketCap > 0
        ? q.marketCap
        : null;
    if (mcap == null && !base) return null;
    return {
      companyName: base?.companyName ?? null,
      sector: base?.sector ?? null,
      industry: base?.industry ?? null,
      marketCap: mcap ?? base?.marketCap ?? null,
    };
  } catch {
    return base;
  }
}

export type ManualSimEntryPayload = {
  ticker: string;
  company?: string;
  nct_id?: string;
  cd_iso?: string;
  cd_date?: string;
  drug?: string;
  phase?: string;
  indication?: string;
  note?: string;
};

/** Calendar free-text insert → manual_sim_entries + guidance CD (Catalyst / Eval Lab). */
export function postManualSimEntry(payload: ManualSimEntryPayload) {
  return api<{
    ok?: boolean;
    error?: string;
    replaced?: boolean;
    entry?: Record<string, unknown>;
    count?: number;
    calendar_injected?: boolean;
  }>("/api/simulation/manual-entries", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((res) => {
    invalidateProjectJsonCache("manual_sim_entries.json");
    invalidateProjectJsonCache("guidance_calendar_snapshot.json");
    return res;
  });
}

export type CatalystInterestEntry = {
  ticker: string;
  company?: string;
  cik10?: string | null;
  cd_iso?: string | null;
  nct_id?: string | null;
  phase?: string | null;
  note?: string | null;
  source?: string;
  added_at?: string;
  updated_at?: string;
};

export type CatalystInterestDiscovery = {
  ok?: boolean;
  ticker?: string;
  company?: string;
  cik10?: string | null;
  candidate?: {
    cd_date?: string;
    nct_id?: string;
    phase?: string;
    title?: string;
    source?: string;
    event_type?: string;
  } | null;
  days_until?: number | null;
  source?: string | null;
  error?: string | null;
};

export type CatalystInterestSnapshot = {
  updated_at?: string | null;
  entries?: CatalystInterestEntry[];
  count?: number;
};

export function fetchCatalystInterest(): Promise<CatalystInterestSnapshot> {
  return api<CatalystInterestSnapshot>("/api/catalyst-interest");
}

export function enrollCatalystInterest(payload: {
  ticker: string;
  company?: string;
  cd_iso?: string;
  cd_date?: string;
  nct_id?: string;
  note?: string;
  open_pipeline?: boolean;
  discover?: boolean;
}) {
  return api<{
    ok?: boolean;
    error?: string;
    replaced?: boolean;
    entry?: CatalystInterestEntry;
    roster_added?: boolean;
    manual_sim_added?: boolean;
    in_catalyst_table?: boolean;
    cik10?: string | null;
    cd_iso?: string | null;
    discovery?: CatalystInterestDiscovery | null;
    pipeline?: Record<string, boolean>;
    count?: number;
  }>(
    "/api/catalyst-interest",
    {
      method: "POST",
      headers: (() => {
        const h: Record<string, string> = {};
        const sess = getTesterSessionToken();
        if (sess) h["X-SuperNova-Tester-Session"] = sess;
        return h;
      })(),
      body: JSON.stringify(payload),
    },
    { timeoutMs: 90_000 },
  ).then((res) => {
    invalidateProjectJsonCache("manual_sim_entries.json");
    invalidateProjectJsonCache("guidance_calendar_snapshot.json");
    invalidateProjectJsonCache("simulation_sheet_snapshot.json");
    return res;
  });
}

export function removeCatalystInterest(ticker: string) {
  return api<{ ok?: boolean; removed?: number; count?: number }>(
    `/api/catalyst-interest/${encodeURIComponent(ticker.trim().toUpperCase())}`,
    { method: "DELETE" },
  );
}

/** Guidance-calendar + FDA AdCom + SEC forward + Discovery near-catalyst rows — sidecar file union live Calendar. */
export async function fetchCatalystSimEntries(): Promise<Array<Record<string, unknown>>> {
  const { fdaRowsFromSnapshot, mergeCalendarSources } = await import(
    "../sheet/calendarCatalystEvents"
  );
  const { calendarEventsToCatalystSimEntries, unionCatalystSimEntries } = await import(
    "../sheet/calendarCatalystSimEntries"
  );
  const [file, discoveryFile, guidance, fda, sec] = await Promise.all([
    fetchProjectJson<{ entries?: Array<Record<string, unknown>> }>("catalyst_sim_entries.json")
      .then(({ data }) => (Array.isArray(data?.entries) ? data.entries : []))
      .catch(() => [] as Array<Record<string, unknown>>),
    fetchProjectJson<{ entries?: Array<Record<string, unknown>> }>(
      "discovery_catalyst_sim_entries.json",
    )
      .then(({ data }) => (Array.isArray(data?.entries) ? data.entries : []))
      .catch(() => [] as Array<Record<string, unknown>>),
    fetchGuidanceCalendarSnapshot().catch(() => null),
    fetchFdaAdcomCalendarSnapshot().catch(() => null),
    fetchCatalystCalendarSnapshot().catch(() => null),
  ]);
  const calendar = calendarEventsToCatalystSimEntries(
    mergeCalendarSources(guidance?.events, fdaRowsFromSnapshot(fda), sec?.entries),
  );
  return unionCatalystSimEntries(calendar, [...file, ...discoveryFile]);
}

export function fetchClinicalPreCdStatus() {
  return api<ClinicalPreCdStatus>("/api/clinical-pre-cd/status");
}

/**
 * In-flight coalescer + 60 s response cache for the feed-refresh report (Jul 2026 perf).
 *
 * Called at boot by BOTH `checkClinicalFeedRefreshPopup` (portfolio-alerts flow) and
 * `checkClinicalFeedStaleWarning` (stale-EIS-pipeline flow) — same tick, same URL.
 * Endpoint returns a small JSON but on a saturated backend still costs 2-3 s.
 */
type ClinicalFeedRefreshReportDoc = {
  report: Record<string, unknown> | null;
  should_show: boolean;
};
let clinicalFeedRefreshInFlight: Promise<ClinicalFeedRefreshReportDoc> | null = null;
let clinicalFeedRefreshCached:
  | { at: number; value: ClinicalFeedRefreshReportDoc }
  | null = null;
const CLINICAL_FEED_REFRESH_CACHE_TTL_MS = 60_000;

export function fetchClinicalFeedRefreshReport(): Promise<ClinicalFeedRefreshReportDoc> {
  if (
    clinicalFeedRefreshCached &&
    Date.now() - clinicalFeedRefreshCached.at < CLINICAL_FEED_REFRESH_CACHE_TTL_MS
  ) {
    return Promise.resolve(clinicalFeedRefreshCached.value);
  }
  if (clinicalFeedRefreshInFlight) return clinicalFeedRefreshInFlight;
  const p = api<ClinicalFeedRefreshReportDoc>(
    "/api/clinical-pre-cd/feed-refresh-report",
    undefined,
    { timeoutMs: 8_000 },
  )
    .then((v) => {
      clinicalFeedRefreshCached = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      clinicalFeedRefreshInFlight = null;
    });
  clinicalFeedRefreshInFlight = p;
  return p;
}

/** Drop the cache after an ack (server state changed → next fetch may return should_show=false). */
export function invalidateClinicalFeedRefreshCache(): void {
  clinicalFeedRefreshInFlight = null;
  clinicalFeedRefreshCached = null;
}

export type EisCohortWeeklyHistoryDoc = {
  schema_version?: number;
  updated_at?: string;
  weeks?: Array<{
    week_key: string;
    recorded_at?: string;
    with_eis_n?: number;
    without_eis_n?: number;
    with_eis_price_accuracy_pct?: number | null;
    without_eis_price_accuracy_pct?: number | null;
    with_eis_sign_hit_pct?: number | null;
    without_eis_sign_hit_pct?: number | null;
    delta_price_accuracy_pp?: number | null;
    delta_sign_hit_pp?: number | null;
  }>;
};

export function fetchEisMagnitudeAnalysis() {
  return api<NonNullable<CurveImpactCumulative["eis_magnitude_analysis"]>>(
    "/api/models/eis-magnitude-analysis",
    undefined,
    { timeoutMs: 60_000 },
  );
}

export function fetchEisCohortComparison() {
  return api<{
    eis_cohort_comparison?: CurveImpactCumulative["eis_cohort_comparison"];
    eis_magnitude_analysis?: CurveImpactCumulative["eis_magnitude_analysis"];
    n_simulation_events?: number;
    n_with_eis_data?: number;
    built_at?: string;
    weekly_history?: EisCohortWeeklyHistoryDoc;
  }>("/api/models/eis-cohort-comparison", undefined, { timeoutMs: 120_000 });
}

export function fetchEisCohortWeeklyHistory() {
  return api<EisCohortWeeklyHistoryDoc>(
    "/api/models/eis-cohort-weekly-history",
    undefined,
    { timeoutMs: 12_000 },
  );
}

export function ackClinicalFeedRefreshReport(reportId: string) {
  return api<{ ok: boolean; report_id?: string }>(
    "/api/clinical-pre-cd/feed-refresh-report/ack",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: reportId }),
    },
    { timeoutMs: 8_000 },
  ).then((v) => {
    invalidateClinicalFeedRefreshCache();
    return v;
  });
}

const CLINICAL_PRE_CD_SNAPSHOT_FILE = "clinical_pre_cd_enrichment_snapshot.json";

function clinicalSnapshotTs(snap: ClinicalPreCdSnapshot | null | undefined): number {
  const raw = snap?.updated_at?.trim();
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function clinicalSnapshotHasRows(snap: ClinicalPreCdSnapshot | null | undefined): boolean {
  return Array.isArray(snap?.records) && snap!.records.length > 0;
}

async function persistClinicalPreCdSnapshotLocally(
  snap: ClinicalPreCdSnapshot,
): Promise<void> {
  try {
    const bridge = typeof window !== "undefined" ? window.supernova : undefined;
    if (bridge?.writeProjectDataFile) {
      await bridge.writeProjectDataFile(CLINICAL_PRE_CD_SNAPSHOT_FILE, snap);
      invalidateProjectJsonCache(CLINICAL_PRE_CD_SNAPSHOT_FILE);
    }
  } catch {
    /* Electron bridge optional */
  }
}

/**
 * Load clinical pre-CD enrichment snapshot.
 * Prefer the fresher of local project-data vs API — never stick to a stale local
 * file after a successful VPS/API enrich (that made refresh look broken).
 */
export async function fetchClinicalPreCdSnapshot(opts?: {
  /** After enrich / manual Snapshot: always hit the API when reachable. */
  preferApi?: boolean;
}): Promise<ClinicalPreCdSnapshot> {
  if (opts?.preferApi) {
    clinicalPreCdSlot.cached = null;
    invalidateProjectJsonCache(CLINICAL_PRE_CD_SNAPSHOT_FILE);
  } else if (
    clinicalPreCdSlot.cached &&
    Date.now() - clinicalPreCdSlot.cached.at < CAL_SNAP_TTL_MS
  ) {
    return clinicalPreCdSlot.cached.value;
  }
  if (clinicalPreCdSlot.inflight && !opts?.preferApi) {
    return clinicalPreCdSlot.inflight;
  }

  const run = (async (): Promise<ClinicalPreCdSnapshot> => {
    const { data: local } = await fetchProjectJson<ClinicalPreCdSnapshot>(
      CLINICAL_PRE_CD_SNAPSHOT_FILE,
    );
    const localOk = clinicalSnapshotHasRows(local);
    const apiUp = await probeApiReachable();

    if (apiUp) {
      try {
        const remote = await api<ClinicalPreCdSnapshot>("/api/clinical-pre-cd/snapshot", undefined, {
          timeoutMs: 8_000,
        });
        const remoteOk = clinicalSnapshotHasRows(remote);
        const localTs = clinicalSnapshotTs(local);
        const remoteTs = clinicalSnapshotTs(remote);
        const takeRemote =
          remoteOk &&
          (opts?.preferApi ||
            !localOk ||
            remoteTs > localTs ||
            (remoteTs === localTs &&
              (remote.records?.length ?? 0) >= (local?.records?.length ?? 0)));
        if (takeRemote) {
          void persistClinicalPreCdSnapshotLocally(remote);
          return remote;
        }
      } catch {
        /* fall through to local */
      }
    }

    if (localOk && local) return local;
    if (local) return local;

    throw new Error(
      apiUp
        ? `Clinical pre-CD snapshot empty (data/${CLINICAL_PRE_CD_SNAPSHOT_FILE}).`
        : `Clinical pre-CD snapshot missing (data/${CLINICAL_PRE_CD_SNAPSHOT_FILE}) — API offline.`,
    );
  })();

  if (!opts?.preferApi) {
    clinicalPreCdSlot.inflight = run
      .then((value) => {
        clinicalPreCdSlot.cached = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        clinicalPreCdSlot.inflight = null;
      });
    return clinicalPreCdSlot.inflight;
  }
  return run.then((value) => {
    clinicalPreCdSlot.cached = { at: Date.now(), value };
    return value;
  });
}

export type CopilotChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CopilotChatResponse = {
  ok?: boolean;
  reply?: string | null;
  error?: string;
  hint?: string;
  user_message?: string;
  sources?: string[];
  live_research?: {
    ok?: boolean;
    ticker?: string | null;
    company?: string | null;
    pubmed?: { pmid?: string; title?: string; url?: string }[];
    ctgov?: { nct_id?: string; title?: string; url?: string }[];
    network_disabled?: boolean;
  };
  provider?: { active?: string; label?: string; last_success?: boolean };
  github_cooldown_s?: number;
};

export function sendCatalystCopilotChat(
  body: {
    message: string;
    history?: CopilotChatMessage[];
    ticker?: string;
    tickers?: string[];
    /** Rows currently visible in Catalyst Feed (full summaries + KPI). */
    page_records?: ClinicalPreCdRecord[];
    lang?: string;
    use_live_research?: boolean;
  },
  init?: RequestInit,
) {
  return api<CopilotChatResponse>(
    "/api/catalyst-feed/copilot/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...init,
    },
    { timeoutMs: 90_000 },
  );
}

// ── Clinical Trial AI Summaries ──────────────────────────────────────────────

export type ClinicalOutcomeMeasure = {
  type?: string;
  title?: string;
  description?: string;
  time_frame?: string;
  values?: string[];
  p_value_hint?: string;
};

export type SocCompareFlag = "beat" | "match" | "miss" | "unknown";

/** Disease-level standard of care (extracted at enrich — not a certified guideline). */
export type DiseaseSocContext = {
  disease?: string | null;
  /** Approximate US prevalence / incidence (published range). */
  usa_prevalence?: string | null;
  /** Approximate 5-year relative survival when published for this disease/stage. */
  five_year_survival?: string | null;
  soc_name?: string | null;
  soc_is_none?: boolean;
  soc_efficacy_benchmark?: string | null;
  life_expectancy?: string | null;
  symptoms?: string | null;
  source_note?: string | null;
};

export type StudyClinicalProfile = {
  vs_standard_of_care?: string | null;
  soc_comparison_note?: string | null;
  disease_soc?: DiseaseSocContext | null;
  /** Lead product / asset name for this trial (company drug, not SoC). */
  product_name?: string | null;
  /** Modality / platform (mAb, ADC, small molecule, gene therapy…). */
  product_technology?: string | null;
  /** Mechanism of action in plain language. */
  mechanism_of_action?: string | null;
  /** FDA designation string when extracted (Breakthrough Therapy, Orphan, …). */
  fda_designation?: string | null;
  study_success?: string | null;
  primary_endpoint_label?: string | null;
  primary_endpoint_value?: string | null;
  primary_endpoint_met?: boolean | null;
  secondary_endpoints_summary?: string | null;
  blinding?: string | null;
  /** Human-readable design line (double-blind · placebo-controlled…). */
  study_design?: string | null;
  n_treatment_arm?: number | null;
  n_control_arm?: number | null;
  patients_enrolled?: number | null;
  patients_target?: number | null;
  inclusion_criteria_summary?: string | null;
  serious_ae_rate_pct?: number | null;
  grade3_ae_rate_pct?: number | null;
  discontinuation_rate_pct?: number | null;
  deaths_on_study?: number | null;
  safety_summary?: string | null;
  hr_pfs?: number | null;
  hr_os?: number | null;
  p_value?: string | null;
  confidence_interval?: string | null;
  data_maturity?: string | null;
};

export type ClinicalAiSummary = {
  outcome?: "positive" | "negative" | "mixed" | "pending" | "insufficient_data";
  executive_summary?: string;
  /** Detailed chronological narrative of published clinical data in the 6m window */
  published_data_summary?: string;
  primary_endpoint?: string | null;
  key_metrics?: string | null;
  safety_profile?: string | null;
  patient_population?: string | null;
  key_publications?: string[];
  programs_mentioned?: string[];
  data_gaps?: string | null;
  investment_note?: string | null;
  data_quality?: "high" | "medium" | "low";
  clinical_events?: ClinicalPublicationEvent[];
  study_clinical_profile?: StudyClinicalProfile;
};

/** Quantifiable clinical KPI extracted from company IR / congress / publications */
export type ClinicalStudyIndicator = {
  label?: string;
  value?: string;
  numeric_value?: number | null;
  unit?: string | null;
  direction?: "up" | "down" | "flat" | "unknown";
  endpoint_met?: boolean | null;
  n_patients?: number | null;
  study_phase?: string | null;
  source?: string | null;
  /** Original article / registry URL, DOI, PMID, or NCT id when extracted. */
  link?: string | null;
  trend_note?: string | null;
  indicator_date?: string | null;
  kpi_type?: "efficacy" | "safety" | "enrollment" | "biomarker" | "regulatory" | "other" | null;
  confidence_interval?: string | null;
  p_value?: string | null;
  p_value_numeric?: number | null;
  hazard_ratio?: number | null;
  comparator_value_numeric?: number | null;
  effect_size_delta_pp?: number | null;
  confidence_interval_low?: number | null;
  confidence_interval_high?: number | null;
  data_maturity?: "interim" | "primary" | "final" | "not_reported" | null;
  vs_soc?: string | null;
  vs_prior_update?: string | null;
  publication_venue?: string | null;
  /** Named SoC / BSC / "no treatment" for this endpoint when extracted. */
  soc_name?: string | null;
  soc_benchmark?: string | null;
  soc_flag?: SocCompareFlag | null;
  soc_is_none?: boolean | null;
};

/** Unified timeline row: clinical (AI) or SEC 8-K */
export type ClinicalPublicationEvent = {
  event_date?: string | null;
  event_title?: string;
  /** Clinical / corporate summary (column «Summary dati») */
  summary?: string;
  /** Drug or program badge (column «Drug») */
  drug?: string | null;
  asset?: string | null;
  /**
   * Event-level NCT when known (CT.gov row, title/link extract).
   * Must not be silently inherited from the parent study record.
   */
  nct_id?: string | null;
  source_type?: string;
  /** sec_8k | press_release | cd_milestone | ctgov | congress | publication | fda_briefing */
  event_type?: string;
  link?: string | null;
  link_label?: string;
  sentiment?: number;
  impact_note?: string;
  /** PubMed / journal paper: full abstract when known. */
  abstract?: string | null;
  /** Intro / Results / Discussion cards (≤50w) or «pdf not available». */
  section_summaries?: Array<{ heading?: string; summary?: string }> | null;
  /** Investor lens: Clin / Corp / Fin / Access + stock-price implication. */
  investor_insight?: string | null;
  /** True when ≥1 author is affiliated with the company. */
  company_affiliated?: boolean | null;
  is_paper?: boolean | null;
  /** Taxonomy intrinsic scores (Daily News migrate / press). */
  clinical_score?: number | null;
  financial_score?: number | null;
  corporate_score?: number | null;
  market_access_score?: number | null;
  eis_score?: number | null;
  /** FDA AdCom migrate identity. */
  fda_adcom_id?: string | null;
  fda_stance?: "positive" | "negative" | "mixed" | string | null;
  fda_score?: number | null;
  /** Market EIS windows still to fill after publish. */
  eis_horizons_pending?: string[] | null;
  taxonomy_dimensions?: Record<string, unknown> | null;
  /** SEC 8-K item codes e.g. "2.02, 7.01" */
  items_raw?: string | null;
  price?: {
    p_t0?: number | null;
    p_t1?: number | null;
    p_t3?: number | null;
    delta_p_1d?: number | null;
    delta_p_3d?: number | null;
    /** Market reaction vs publish (hourly enrichment). */
    delta_p_12h?: number | null;
    delta_p_24h?: number | null;
    delta_p_36h?: number | null;
  };
  eis?: {
    score?: number;
    delta_p_1d?: number | null;
    delta_p_3d?: number | null;
    vol_ratio?: number;
    vol_term?: number;
    sentiment?: number;
    kpi_score?: number | null;
    eis_intrinsic?: number | null;
    sent_term?: number;
    weights?: { w1?: number; w2?: number; w3?: number; w4?: number };
    /** Per-event market EIS at 12h / 24h / 36h after publish — never ticker-summed. */
    horizons?: {
      h12?: { score?: number | null; delta_pct?: number | null } | null;
      h24?: { score?: number | null; delta_pct?: number | null } | null;
      h36?: { score?: number | null; delta_pct?: number | null } | null;
    } | null;
  } | null;
  /** ISO publish timestamp when known (for 12/24/36h EIS windows). */
  published_at?: string | null;
  /** True se titolo/summary citano società o farmaco del pipeline */
  reference_verified?: boolean;
  /** sec_8k | ctgov | company | drug | company+drug */
  reference_match?: string | null;
  /**
   * `anticipated` = ipotesi non confermata (nessuna fonte reale): non riceve EIS
   * finché il verificatore non trova abstract/articolo. Vedi
   * `prediction/eis_feed_quality.py`.
   */
  confirmation_status?: "confirmed" | "anticipated" | string;
  /** Motivo del gate lato backend, es. `unverified_hypothesis`. */
  eis_gated?: string | null;
  /** Finestra in cui l'evento ipotizzato dovrebbe verificarsi. */
  expected_window_start?: string | null;
  expected_window_end?: string | null;
  /** KPI misurabili per quella data (ORR, enrollment, AE, …) */
  indicators?: ClinicalStudyIndicator[];
};

/** @deprecated use ClinicalPublicationEvent */
export type ClinicalTimelineEvent = ClinicalPublicationEvent;

export type ClinicalPreCdRecord = {
  ticker?: string;
  company?: string;
  nct_id?: string;
  /** Exact | Partial | No match — from clinical simulation snapshot. */
  sponsor_match?: string;
  cd_date?: string;
  window_start?: string;
  window_end?: string;
  last_ctgov_update?: string | null;
  update_in_pre_cd_window?: boolean;
  clinical_events?: ClinicalPublicationEvent[];
  /** @deprecated */
  timeline_events?: ClinicalPublicationEvent[];
  /** Rollup KPI quantificabili su tutta la finestra pre-CD */
  clinical_indicators?: ClinicalStudyIndicator[];
  meta?: {
    brief_title?: string;
    phase?: string;
    overall_status?: string;
    conditions?: string;
    interventions?: string;
    enrollment?: number | null;
    lead_sponsor?: string;
    collaborators?: string;
    study_type?: string | null;
    allocation?: string | null;
    intervention_model?: string | null;
    primary_purpose?: string | null;
    masking?: string | null;
    /** Preformatted design string from CT.gov (double-blind · placebo…). */
    study_design?: string | null;
    inclusion_criteria?: string | null;
    start_date?: string | null;
    primary_completion_date?: string | null;
    completion_date?: string | null;
  };
  outcome_measures?: ClinicalOutcomeMeasure[];
  ae_summary?: string[];
  citations?: string[];
  pubmed_pmids?: string[];
  pubmed_abstracts?: string[];
  sources?: { type?: string; label?: string; ref?: string }[];
  ai?: ClinicalAiSummary;
  structured?: {
    endpoint_summary?: { type?: string; title?: string; values?: string[]; reached?: boolean }[];
    endpoint_reached?: number;
    endpoint_failed?: number;
    treated_patients?: number | null;
    safety_issues?: string[];
    plot_points?: { label?: string; value?: number }[];
  };
  stock_reaction?: {
    pub_date?: string | null;
    d1?: number | null;
    d2?: number | null;
    d3?: number | null;
  };
  ai_ok?: boolean;
  has_ctgov_results?: boolean;
  publication_context?: {
    pubmed_queries?: string[];
    pubmed_hit_count?: number;
    drug_tokens_searched?: string[];
  };
  /** Lacune dati enrichment (passate a Intelligence). */
  data_gaps?: string | null;
  study_phase?: string;
  completion_date?: string;
  error?: string;
};

export type ClinicalPreCdSnapshot = {
  updated_at?: string | null;
  months_before_cd?: number;
  count?: number;
  ai_ok_count?: number;
  records?: ClinicalPreCdRecord[];
  ai_provider?: AiProviderInfo;
};

export type PendingHypothesisItem = {
  id?: string;
  ticker?: string;
  company?: string;
  drug?: string;
  title?: string;
  venue?: string;
  source_type?: string;
  expected_window_start?: string | null;
  expected_window_end?: string | null;
  hypothesis_date?: string | null;
  status?: string;
  link?: string | null;
};

export type PendingHypothesesPayload = {
  items?: PendingHypothesisItem[];
};

export function fetchPendingHypotheses(status = "") {
  const q = status.trim()
    ? `?status=${encodeURIComponent(status.trim().toLowerCase())}`
    : "";
  // Desk boot hits this in parallel with 3 calendars — share one flight + short TTL.
  if (!status.trim()) {
    return coalesceGet(pendingHypothesesSlot, CAL_SNAP_TTL_MS, () =>
      api<PendingHypothesesPayload>(`/api/clinical-pre-cd/pending-hypotheses`, undefined, {
        timeoutMs: 12_000,
      }).catch(() => ({ items: [] })),
    );
  }
  return api<PendingHypothesesPayload>(`/api/clinical-pre-cd/pending-hypotheses${q}`, undefined, {
    timeoutMs: 12_000,
  }).catch(() => ({ items: [] }));
}

export type ClinicalPreCdStatus = CatalystFeedStatus;

export type ClinicalStudySummary = {
  nct_id: string;
  ticker?: string;
  company?: string;
  generated_at?: string;
  has_results?: boolean;
  cached?: boolean;
  error?: string;
  meta?: {
    brief_title?: string;
    phase?: string;
    overall_status?: string;
    enrollment?: number | null;
    lead_sponsor?: string;
    conditions?: string;
    interventions?: string;
  };
  outcome_measures?: ClinicalOutcomeMeasure[];
  ae_summary?: string[];
  citations?: string[];
  pubmed_pmids?: string[];
  ai?: ClinicalAiSummary;
};

/** Generate (or return cached) AI summary for a ClinicalTrials.gov study.
 *  This call may take 10–25 seconds — show a loading indicator. */
export function generateClinicalStudySummary(
  nct_id: string,
  ticker = "",
  company = ""
) {
  const params = new URLSearchParams({ nct_id, ticker, company });
  return api<ClinicalStudySummary>(`/api/clinical/study-summary?${params}`, {
    method: "POST",
  });
}

/** Return cached summary without triggering generation. */
export function fetchClinicalStudySummary(nct_id: string) {
  return api<ClinicalStudySummary>(`/api/clinical/study-summary/${encodeURIComponent(nct_id)}`);
}

export type ProductBriefingLookupResult = {
  ok: boolean;
  cached?: boolean;
  provider?: string;
  updated_at?: string;
  error?: string;
  hint?: string;
  detail?: string;
  briefing?: {
    modality?: string | null;
    mechanism_of_action?: string | null;
    therapeutic_target?: string | null;
    product_technology?: string | null;
    indication?: string | null;
    usa_prevalence?: string | null;
    standard_of_care?: string | null;
    phase_3_and_4_products?: string | null;
  };
};

/** Gemini (or fallback AI) — modality / MoA / target for Product modal gaps. */
export function lookupDeskProductBriefing(body: {
  ticker: string;
  product_name: string;
  company?: string | null;
  nct_id?: string | null;
  interventions?: string | null;
  conditions?: string | null;
  force?: boolean;
}) {
  return api<ProductBriefingLookupResult>("/api/desk/product-briefing/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type PipelineOverviewProduct = {
  name?: string | null;
  modality?: string | null;
  mechanism_of_action?: string | null;
  indication?: string | null;
  /** Broad franchise bucket (Oncology, Respiratory, …). */
  therapeutic_area?: string | null;
  usa_prevalence?: string | null;
  phase?: string | null;
  /** approved = on market; development = clinical pipeline */
  lifecycle?: "approved" | "development" | string | null;
  /** US LOE / patent cliff estimate (approved products). */
  patent_cliff?: string | null;
};

export type PipelineOverviewLookupResult = {
  ok: boolean;
  cached?: boolean;
  provider?: string;
  updated_at?: string;
  error?: string;
  hint?: string;
  detail?: string;
  products?: PipelineOverviewProduct[];
};

/** Gemini — company pipeline cards (modality / MoA / indication / US prevalence / phase). */
export function lookupDeskPipelineOverview(body: {
  ticker: string;
  company?: string | null;
  products?: string[];
  nct_id?: string | null;
  conditions?: string | null;
  indication?: string | null;
  force?: boolean;
}) {
  return api<PipelineOverviewLookupResult>("/api/desk/pipeline-overview/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type UsProductRevenueRow = {
  name?: string | null;
  indication?: string | null;
  /** Broad franchise bucket (Oncology, Cardiovascular, …). */
  therapeutic_area?: string | null;
  /** MoA and/or protein target (combined when both known). */
  moa_target?: string | null;
  modality?: string | null;
  usa_prevalence?: string | null;
  /** First FDA / US approval calendar year (e.g. "2018"). */
  us_approval_year?: string | null;
  patent_cliff?: string | null;
  line_of_therapy?: string | null;
  us_revenue_q_usd_m?: number | null;
  us_revenue_q_label?: string | null;
  us_revenue_h_usd_m?: number | null;
  us_revenue_h_label?: string | null;
  us_revenue_y_usd_m?: number | null;
  us_revenue_y_label?: string | null;
  /** Sort / legacy: prefer quarter, else half, else year. */
  us_revenue_usd_m?: number | null;
  us_revenue_label?: string | null;
  notes?: string | null;
};

export type UsProductRevenueLookupResult = {
  ok: boolean;
  cached?: boolean;
  provider?: string;
  updated_at?: string;
  error?: string;
  hint?: string;
  detail?: string;
  period?: string | null;
  period_half?: string | null;
  period_year?: string | null;
  period_type?: string | null;
  market?: string | null;
  products?: UsProductRevenueRow[];
};

/** Gemini — latest US product revenues (quarter or half), ranked high→low. */
export function lookupDeskUsProductRevenue(body: {
  ticker: string;
  company?: string | null;
  force?: boolean;
}) {
  return api<UsProductRevenueLookupResult>("/api/desk/us-product-revenue/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { timeoutMs: 240_000 });
}

export type ProductCorePatent = {
  patent_number?: string | null;
  title?: string | null;
  filing_date?: string | null;
  expiry_date?: string | null;
  years_remaining?: number | null;
  url?: string | null;
};

export type ProductCompetitiveSignal = {
  clearance_type?: string | null;
  product_code?: string | null;
  clearance_id?: string | null;
  decision_date?: string | null;
  applicant?: string | null;
  device_name?: string | null;
  notes?: string | null;
  source?: string | null;
};

export type ProductPatentCard = {
  product_kind?: "drug" | "device" | string | null;
  brand_name?: string | null;
  generic_name?: string | null;
  aliases?: string[];
  patent_number?: string | null;
  filing_date?: string | null;
  expiry_date?: string | null;
  years_remaining?: number | null;
  method?:
    | "published_loe"
    | "20y_from_filing"
    | "unknown"
    | "device_ip"
    | "google_patents_family"
    | "google_patents_anticipated"
    | string
    | null;
  notes?: string | null;
  sources?: string[];
  core_patents?: ProductCorePatent[];
  competitive_signal?: ProductCompetitiveSignal | null;
};

export type ProductPatentLookupResult = {
  ok: boolean;
  cached?: boolean;
  provider?: string;
  updated_at?: string;
  error?: string;
  hint?: string;
  detail?: string;
  web_hits?: string[];
  patent?: ProductPatentCard;
};

/** Gemini + web snippets — patent filing / LOE estimate for the CD product. */
export type ProductStudyResultRow = {
  endpoint?: string | null;
  type?: string | null;
  time_frame?: string | null;
  result?: string | null;
  statistic?: string | null;
  p_value?: string | null;
  positive?: boolean;
  description?: string | null;
};

export type ProductStudyCard = {
  nct_id?: string | null;
  title?: string | null;
  phase?: string | null;
  status?: string | null;
  enrollment?: number | null;
  design?: string | null;
  conditions?: string | null;
  interventions?: string | null;
  sponsor?: string | null;
  completion_date?: string | null;
  has_results?: boolean;
  ctgov_url?: string | null;
  results_table?: ProductStudyResultRow[];
};

export type ProductStudyPaperRef = {
  citation?: string | null;
  pmid?: string | null;
  doi?: string | null;
  url?: string | null;
};

export type ProductStudyPaper = {
  pmid?: string | null;
  title?: string | null;
  journal?: string | null;
  year?: string | null;
  url?: string | null;
  doi?: string | null;
  doi_url?: string | null;
  pmc?: string | null;
  pmc_url?: string | null;
  affiliations?: string[];
  /** Full PubMed abstract (always preferred on the card). */
  abstract?: string | null;
  introduction?: string | null;
  results?: string | null;
  /** ≤50w discussion (or «pdf not available»). */
  discussion?: string | null;
  /** @deprecated alias of discussion */
  conclusion?: string | null;
  /** Investor lens: Clin / Corp / Fin / Market Access + stock-price implication. */
  investor_insight?: string | null;
  /** True when ≥1 author affiliation matches the company. */
  company_affiliated?: boolean;
  /** Taxonomy clinical score (Σ Clin); ×1.5 when company_affiliated. */
  clinical_score?: number | null;
  financial_score?: number | null;
  corporate_score?: number | null;
  market_access_score?: number | null;
  taxonomy_audit?: string | null;
  full_text_available?: boolean;
  structured_abstract?: boolean;
  references?: ProductStudyPaperRef[];
};

export type ProductStudyDossier = {
  product_name?: string;
  company?: string | null;
  ticker?: string;
  studies?: ProductStudyCard[];
  papers?: ProductStudyPaper[];
  ctgov_hits?: number;
  pubmed_query?: string;
};

export type ProductStudyDossierResult = {
  ok: boolean;
  cached?: boolean;
  updated_at?: string;
  error?: string;
  dossier?: ProductStudyDossier;
};

/** CT.gov studies for one drug + PubMed papers (drug in title/abstract; affiliation optional ★). */
export function lookupDeskProductStudyDossier(body: {
  ticker: string;
  product_name: string;
  company?: string | null;
  nct_id?: string | null;
  aliases?: string[];
  force?: boolean;
}) {
  return api<ProductStudyDossierResult>("/api/desk/product-study-dossier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type CompetitionPeer = {
  product?: string | null;
  company?: string | null;
  ticker?: string | null;
  market_cap?: string | null;
  market_cap_usd?: number | null;
  phase?: string | null;
  mechanism_of_action?: string | null;
  modality?: string | null;
  value_proposition?: string | null;
  nct_id?: string | null;
  status?: string | null;
};

export type CompetitionLandscape = {
  indication?: string | null;
  standard_of_care?: string | null;
  summary?: string | null;
  competitors?: CompetitionPeer[];
};

export type CompetitionLandscapeResult = {
  ok: boolean;
  cached?: boolean;
  provider?: string;
  updated_at?: string;
  error?: string;
  hint?: string;
  detail?: string;
  /** Seconds to wait before retrying after a provider quota error. */
  retry_after_s?: number;
  web_hits?: string[];
  landscape?: CompetitionLandscape;
};

/** Gemini + web snippets — clinical-stage peers targeting the same disease. */
export function lookupDeskCompetitionLandscape(body: {
  ticker: string;
  product_name?: string | null;
  company?: string | null;
  indication?: string | null;
  nct_id?: string | null;
  force?: boolean;
  /** Tab reads the landscape prepared earlier. Never starts Gemini. */
  cache_only?: boolean;
}) {
  return api<CompetitionLandscapeResult>("/api/desk/competition-landscape/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { timeoutMs: body.cache_only ? 20_000 : 90_000 });
}

/** Gemini + web snippets — patent filing / LOE (drugs) or device IP + FDA clearance. */
export function lookupDeskProductPatent(body: {
  ticker: string;
  product_name: string;
  company?: string | null;
  nct_id?: string | null;
  product_kind?: "drug" | "device" | string | null;
  force?: boolean;
}) {
  return api<ProductPatentLookupResult>("/api/desk/product-patent/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { timeoutMs: 240_000 });
}

export type Ticker8kSession = {
  item?: string | null;
  item_title?: string | null;
  title?: string | null;
  summary?: string | null;
};

export type Ticker8kDossierFiling = {
  filing_date?: string | null;
  event_date?: string | null;
  form?: string | null;
  title?: string | null;
  link?: string | null;
  items_raw?: string | null;
  sessions?: Ticker8kSession[];
  financial_score?: number | null;
  clinical_score?: number | null;
  corporate_score?: number | null;
  market_access_score?: number | null;
  eis_score?: number | null;
  news_kind?: string | null;
  /** gemini | sec_8k_items | … — how the paragraph summary was produced */
  digest_method?: string | null;
  /** ai_8k | heuristic_8k | …(+heuristic_fill) */
  classification_method?: string | null;
  bundle_chars_primary?: number | null;
  bundle_chars_exhibit?: number | null;
  exhibit_names?: string[];
  exhibit_fetch_mode?: string | null;
};

export type Ticker8kDossier = {
  ticker?: string;
  lookback_days?: number;
  filings?: Ticker8kDossierFiling[];
  count?: number;
  refresh?: string;
  next_refresh?: string;
};

export type Ticker8kDossierResult = {
  ok: boolean;
  cached?: boolean;
  updated_at?: string;
  next_refresh?: string;
  error?: string;
  hint?: string;
  dossier?: Ticker8kDossier;
};

/** EDGAR 8-K last 2 months — per-Item ~65-word summaries + Fin/Clin/Corp scores. */
export function lookupDeskTicker8kDossier(body: { ticker: string; force?: boolean }) {
  return api<Ticker8kDossierResult>("/api/desk/ticker-8k-dossier", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, { timeoutMs: 180_000 });
}

/** Protocol metadata from CT.gov (no AI) — populates study banners when OpenFDA row is missing. */
export type ClinicalStudyProtocolMeta = {
  nct_id: string;
  error?: string;
  brief_title?: string;
  official_title?: string;
  phase?: string;
  overall_status?: string;
  conditions?: string;
  interventions?: string;
  intervention_type?: string;
  lead_sponsor?: string;
  collaborators?: string;
  study_type?: string;
  start_date?: string;
  last_update_posted_date?: string;
  nct_relation_type?: string;
  source?: string;
  masking?: string;
  allocation?: string;
  intervention_model?: string;
  primary_purpose?: string;
  study_design?: string;
  inclusion_criteria?: string;
  enrollment?: number | null;
  arm_count?: number | null;
  primary_completion_date?: string;
  completion_date?: string;
};

export async function fetchClinicalStudyMeta(nct_id: string, company = "") {
  const nct = String(nct_id ?? "").trim().toUpperCase();
  if (!nct.startsWith("NCT")) {
    return { nct_id: nct, error: "invalid_nct" } as ClinicalStudyProtocolMeta;
  }

  const { fetchCtgovProtocolMetaDirect, inferNctRelationForCompany } =
    await import("../sheet/ctgovStudyMeta");
  const direct = await fetchCtgovProtocolMetaDirect(nct);
  const companyTrim = company.trim();

  const attachRelation = (
    meta: ClinicalStudyProtocolMeta,
    relation?: string,
  ): ClinicalStudyProtocolMeta => {
    const rel =
      (relation ?? meta.nct_relation_type ?? "").trim() ||
      (companyTrim
        ? inferNctRelationForCompany(
            companyTrim,
            meta.lead_sponsor ?? "",
            meta.collaborators ?? "",
          )
        : "");
    return rel ? { ...meta, nct_relation_type: rel } : meta;
  };

  if (!direct.error && (direct.brief_title || direct.lead_sponsor)) {
    if (!companyTrim) return direct;
    const q = `?company=${encodeURIComponent(companyTrim)}`;
    try {
      const apiMeta = await api<ClinicalStudyProtocolMeta>(
        `/api/clinical/study-meta/${encodeURIComponent(nct)}${q}`,
      );
      if (apiMeta.nct_relation_type?.trim()) {
        return attachRelation(direct, apiMeta.nct_relation_type);
      }
    } catch {
      /* API offline — infer below */
    }
    return attachRelation(direct);
  }

  const q = companyTrim ? `?company=${encodeURIComponent(companyTrim)}` : "";
  try {
    const meta = await api<ClinicalStudyProtocolMeta>(
      `/api/clinical/study-meta/${encodeURIComponent(nct)}${q}`,
    );
    if (!meta.error && (meta.brief_title || meta.official_title || meta.lead_sponsor)) {
      return attachRelation(meta);
    }
  } catch {
    /* API offline */
  }

  return direct.error ? direct : { nct_id: nct, error: "not_found" };
}

/**
 * Lancia il post-pipeline Decision Lab in background:
 *   1. scripts/_build_directional_calibration.py (KPI direzionali Raw/Useful/Strong)
 *   2. scripts/investment_decision_cohort.py     (cohort storica del Decision Lab)
 * ETA tipica: 5–8 min. Da chiamare dopo refresh fast + export snapshot.
 */
export function runPostRefreshPipeline() {
  return api<{
    started?: boolean;
    running?: boolean;
    skipped?: boolean;
    steps?: string[];
    eta_min?: string;
    message?: string;
    error?: string;
    updated_at?: string;
  }>("/api/investment/post-refresh-pipeline", { method: "POST" });
}

export function fetchPostRefreshPipelineStatus() {
  return api<{
    running?: boolean;
    state?: "starting" | "running" | "ok" | "error" | string;
    message?: string;
    updated_at?: string;
  }>("/api/investment/post-refresh-pipeline/status");
}

export function fetchPostRefreshPipelineLog(tail = 4000) {
  return api<{ log: string }>(
    `/api/investment/post-refresh-pipeline/log?tail=${tail}`
  );
}

type SheetKind = "simulation" | "clinical" | "secK8" | "accuracy" | "financial";

const SHEET_API: Record<SheetKind, string> = {
  simulation: "/api/sheets/simulation",
  clinical: "/api/sheets/clinical-simulation",
  secK8: "/api/sheets/sec-k8-simulation",
  accuracy: "/api/sheets/accuracy",
  financial: "/api/sheets/financial",
};

const SHEET_API_TIMEOUT_MS = 18_000;
const API_REACH_TTL_MS = 5_000;

let apiReachCache: { at: number; ok: boolean } | null = null;
let apiReachInFlight: Promise<boolean> | null = null;

/**
 * Cached + coalesced health probe.
 *
 * Called before every sheet / snapshot fetch in this module (loadSheetWithFallback,
 * fetchClinicalPreCdSnapshot, six other endpoints). On tab mount 15-25 consumers
 * probe within a single tick; without coalescing every one of them fires its own
 * `/api/health` while the cache slot is still empty, so we observed 7+ pending
 * health calls each taking 700 ms – 13 s (see Model quality mount, Jul 2026).
 *
 * The 5 s TTL still applies once the first probe resolves — but *while* the
 * first probe is in flight, every other caller now shares the same promise
 * instead of racing to fill an empty cache.
 *
 * Also fixed: the cache timestamp is now stamped AFTER the fetch settles
 * (was: stamped with a pre-await `Date.now()`, so a 13 s health call would
 * already be "3× TTL stale" the moment it landed in the cache).
 */
export async function probeApiReachable(timeoutMs = HEALTH_PROBE_TIMEOUT_MS): Promise<boolean> {
  const ttlMs = apiReachCache?.ok ? API_REACH_TTL_MS : 1_000;
  if (apiReachCache && Date.now() - apiReachCache.at < ttlMs) {
    return apiReachCache.ok;
  }
  if (apiReachInFlight) {
    return apiReachInFlight;
  }
  const p = (async () => {
    try {
      // Share fetchHealth() so the 1.5s badge probe cannot abort a parallel
      // health call and cache a false "offline" while the API is only slow.
      if (timeoutMs >= HEALTH_PROBE_TIMEOUT_MS) {
        await fetchHealth();
      } else {
        await api<{ status: string }>("/api/health", undefined, { timeoutMs });
      }
      apiReachCache = { at: Date.now(), ok: true };
      return true;
    } catch {
      apiReachCache = { at: Date.now(), ok: false };
      return false;
    } finally {
      apiReachInFlight = null;
    }
  })();
  apiReachInFlight = p;
  return p;
}

async function loadSheetWithFallback(kind: SheetKind) {
  let local: import("../types").SheetTable | null = null;
  try {
    local = await loadLocalSheet(kind);
  } catch {
    /* snapshot assente */
  }

  let hypeEntries: Array<Record<string, unknown>> | undefined;
  let catalystEntries: Array<Record<string, unknown>> | undefined;
  let manualEntries: Array<Record<string, unknown>> | undefined;
  if (kind === "simulation") {
    try {
      const [hype, catalyst, manual] = await Promise.all([
        fetchHypeVolumeFunnelStatus().catch(() => null),
        fetchCatalystSimEntries(),
        fetchManualSimEntries(),
      ]);
      if (Array.isArray(hype?.entries)) hypeEntries = hype.entries;
      if (catalyst.length) catalystEntries = catalyst;
      if (manual.length) manualEntries = manual;
    } catch {
      /* sidecar optional */
    }
  }

  /**
   * Simulation sidecar (hype / catalyst / manual) is merged on the API snapshot path.
   * Also re-apply on local preview: raw ``simulation_sheet_snapshot.json``
   * hides CPIX/GPCR/CMPX and would flash them out of Pulse OPEN POSITIONS.
   */
  const withSidecars = (t: import("../types").SheetTable) =>
    kind === "simulation"
      ? (applySimulationSidecarRows(t, { hypeEntries, catalystEntries, manualEntries }) ?? t)
      : t;

  if (kind === "simulation" && (await probeApiReachable())) {
    try {
      const t = await api<import("../types").SheetTable>(
        `${SHEET_API.simulation}?source=snapshot`,
        undefined,
        { timeoutMs: SHEET_API_TIMEOUT_MS },
      );
      if (Array.isArray(t.rows) && t.rows.length > 0 && !t.error) {
        return withSidecars(t);
      }
    } catch {
      /* fall through to local snapshot */
    }
  }

  /** Snapshot-first: JSON in ``data/`` è già caricato; Excel API può bloccare 20s+. */
  if (
    local != null &&
    Array.isArray(local.rows) &&
    local.rows.length > 0 &&
    !local.error
  ) {
    return withSidecars(local);
  }

  if (!(await probeApiReachable())) {
    if (local) return withSidecars(local);
    const fallback = await loadLocalSheet(kind);
    return withSidecars(fallback);
  }

  /** Excel via API — solo se snapshot assente o vuoto. */
  try {
    const t = await api<import("../types").SheetTable>(SHEET_API[kind], undefined, {
      timeoutMs: SHEET_API_TIMEOUT_MS,
    });
    if (Array.isArray(t.rows) && t.rows.length > 0 && !t.error) {
      return withSidecars(t);
    }
    if (t.error) throw new Error(t.error);
  } catch {
    /* API lenta / workbook bloccato → snapshot in data/ */
  }
  if (local) return withSidecars(local);
  return withSidecars(await loadLocalSheet(kind));
}

/** Fogli: snapshot JSON in ``data/`` se presente; API Excel solo se snapshot assente/vuoto. */
export function fetchSimulationSheet() {
  return loadSheetWithFallback("simulation");
}

export function fetchClinicalSimulationSheet() {
  return loadSheetWithFallback("clinical");
}

export function fetchSecK8SimulationSheet() {
  return loadSheetWithFallback("secK8");
}

export function fetchAccuracySheet() {
  return loadSheetWithFallback("accuracy");
}

export function fetchFinancialSheet() {
  return loadSheetWithFallback("financial");
}

export function fetchFinancialSheetPaginated(page: number = 1, pageSize: number = 50) {
  return api<import("../types").SheetTable>(
    `/api/sheets/financial?page=${page}&page_size=${pageSize}`,
    undefined,
    { timeoutMs: SHEET_API_TIMEOUT_MS }
  );
}

export function fetchChartsSimulation() {
  return api<import("../types").ChartBundle>("/api/charts/simulation");
}

export function fetchChartsRistretta() {
  return api<import("../types").ChartBundle>("/api/charts/ristretta");
}

// ── Live signals (refresh rapido ~20s) ─────────────────────────────────────

export type LiveSignalsStatus = {
  running: boolean;
  ok?: boolean;
  tickers?: number;
  elapsed_s?: number;
  error?: string;
  updated_at?: string;
  message?: string;
};

export function triggerLiveSignalsRefresh(
  cdHorizon = 90,
  opts?: { forcePrices?: boolean },
) {
  const force = opts?.forcePrices ? "&force_prices=true" : "";
  return api<{ started?: boolean; running?: boolean; message?: string; error?: string }>(
    `/api/refresh/live-signals?cd_horizon=${cdHorizon}${force}`,
    { method: "POST" },
  );
}

export function fetchLiveSignalsStatus() {
  return api<LiveSignalsStatus>("/api/refresh/live-signals/status");
}

/** Poll until live-signals job is idle (or timeout). */
export async function waitForLiveSignalsIdle(opts?: {
  timeoutMs?: number;
  pollMs?: number;
}): Promise<LiveSignalsStatus> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const pollMs = opts?.pollMs ?? 1_500;
  const t0 = Date.now();
  let last: LiveSignalsStatus = { running: true };
  while (Date.now() - t0 <= timeoutMs) {
    last = await fetchLiveSignalsStatus();
    if (!last.running) return last;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return last;
}

// ── Composite stock scoring engine ───────────────────────────────────────────

export type StockScoreApiResult = import("../sheet/scoringEngine").StockScoreResult;

export function fetchStockScore(ticker: string, fetchShort = false) {
  const q = fetchShort ? "?fetch_short=true" : "";
  return api<StockScoreApiResult>(`/api/scoring/${encodeURIComponent(ticker)}${q}`);
}

export function computeStockScore(payload: Record<string, unknown>) {
  return api<StockScoreApiResult>("/api/scoring/compute", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Supernova Distance Score (SDS) ───────────────────────────────────────────

export type SdsClusterScores = {
  catalyst_quality?: number;
  institutional_signal?: number;
  price_structure?: number;
  fundamentals?: number;
  timing?: number;
};

export type SdsInvestmentDecision = {
  action?: string;
  label?: string;
  position_size?: string;
  rationale?: string;
  exit_target?: string;
  stop_loss?: string;
  sds_score?: number;
  sds_zone?: string;
  pred_reliability_pct?: number | null;
  pred_reliable?: boolean | null;
  pred_stars?: number | null;
  pred_peak_pct?: number | null;
  pred_effective?: number | null;
};

export type SdsRow = {
  ticker: string;
  sds: number;
  zone_label: string;
  zone_color: string;
  zone_action: string;
  veto?: string | null;
  recommendation?: string | null;
  cluster_scores?: SdsClusterScores;
  component_raw?: Record<string, number | null>;
  missing_data_pct?: number;
  missing_data?: Record<string, string>;
  coverage_fields?: {
    price?: boolean;
    volume?: boolean;
    xbi?: boolean;
    days_to_cd?: boolean;
    phase?: boolean;
    cash_runway?: boolean;
    short_interest?: boolean;
  };
  investment?: SdsInvestmentDecision;
  days_to_cd?: number | null;
  days_to_cover?: number | null;
  phase?: string | null;
  short_interest_pct?: number | null;
  analyst_upgrade_score?: number | null;
  indication?: string | null;
  approved_drugs_count?: number | null;
  first_in_class?: boolean | null;
  unmet_need_score?: number | null;
  market_size_score?: number | null;
  tam_billions?: number | null;
  peak_sales_billions?: number | null;
  pipeline_value_estimate?: number | null;
  mechanism_class?: string | null;
  cluster_a?: SdsClusterADetail;
  cluster_b?: SdsClusterBDetail;
  cluster_c?: SdsClusterCDetail;
  cluster_d?: SdsClusterDDetail;
  cluster_e?: SdsClusterEDetail;
  /** Multi-curve fit + blended ROI horizons (from sds_roi_blend). */
  curve_roi?: {
    fit_pct?: Partial<Record<string, number | null>>;
    best_profile?: string | null;
    best_fit_pct?: number | null;
    horizons?: Partial<
      Record<"pre_10" | "pre_5" | "post_4", { pct_vs_m60?: number | null; delta_from_now?: number | null }>
    >;
    weights?: Partial<Record<string, number>>;
    cluster_bonuses?: Partial<Record<string, number>>;
    now_offset?: number | null;
  };
  /** Rescue cause attribution diagnostics (Phase 1 — does NOT affect rescue score). */
  cause_attribution?: SdsCauseAttribution | null;
};

export type SdsCauseAttributionVolume = {
  score?: number | null;
  volume_zscore?: number | null;
  avg_volume_20d?: number | null;
  std_volume_20d?: number | null;
  volume_today?: number | null;
  status?: string;
};

export type SdsCauseAttributionAlignment = {
  score?: number | null;
  ticker_return_pct?: number | null;
  xbi_return_pct?: number | null;
  return_gap_pct?: number | null;
  status?: string;
};

export type SdsCauseAttributionRegulatoryEvent = {
  score?: number | null;
  flags?: string[];
  status?: string;
};

export type SdsCauseAttributionCashRunway = {
  score?: number | null;
  cash_runway_months?: number | null;
  status?: string;
};

export type SdsCauseAttributionNewsSentiment = {
  score?: number | null;
  status?: string;
};

export type SdsCauseAttribution = {
  volume_anomaly?: SdsCauseAttributionVolume;
  external_alignment?: SdsCauseAttributionAlignment;
  regulatory_event?: SdsCauseAttributionRegulatoryEvent;
  cash_runway_risk?: SdsCauseAttributionCashRunway;
  news_sentiment?: SdsCauseAttributionNewsSentiment;
  internal_cause_flag?: boolean;
  external_cause_flag?: boolean;
};

export type SdsClusterBComponentDetail = {
  score?: number | null;
  max?: number;
  short_pct?: number | null;
  days_to_cover?: number | null;
  squeeze_setup?: boolean;
  structural_bearish?: boolean;
  status?: string;
  upgrades_60d?: number;
  downgrades_60d?: number;
  tier1_coverage?: boolean;
  latest?: Record<string, unknown> | null;
  all_grades_60d?: Record<string, unknown>[];
  delta_pct?: number | null;
  premium_fund_present?: boolean;
  premium_funds?: string[];
  staleness_days?: number | null;
  latest_quarter?: string | null;
  data_age_warning?: boolean;
};

export type SdsClusterBDetail = {
  total?: number;
  raw_total?: number;
  raw_max?: number;
  weight_used?: number;
  slope20?: number;
  momentum_positive?: boolean;
  short_interest?: SdsClusterBComponentDetail;
  analyst_upgrades?: SdsClusterBComponentDetail;
  institutional_delta?: SdsClusterBComponentDetail;
};

export type SdsClusterCComponentDetail = {
  score?: number | null;
  max?: number;
  bb_width_today?: number | null;
  bb_percentile?: number | null;
  interpretation?: string;
  obv_slope?: number | null;
  price_slope_pct_day?: number | null;
  pattern?: string;
  rs_90d?: number | null;
  rs_20d?: number | null;
  ticker_return_90d?: number | null;
  xbi_return_90d?: number | null;
  rs_combined?: number | null;
  ratio_5d_vs_20d?: number | null;
  ratio_today_vs_20d?: number | null;
  avg_volume_5d?: number | null;
  avg_volume_20d?: number | null;
  status?: string;
  flag?: string;
};

export type SdsClusterCDetail = {
  total?: number;
  raw_total?: number;
  raw_max?: number;
  bollinger_squeeze?: SdsClusterCComponentDetail;
  obv_accumulation?: SdsClusterCComponentDetail;
  xbi_relative_strength?: SdsClusterCComponentDetail;
  volume_ratio?: SdsClusterCComponentDetail;
};

export type SdsClusterDComponentDetail = {
  score?: number | null;
  max?: number;
  runway_months?: number | null;
  total_cash_mm?: number | null;
  monthly_burn_mm?: number | null;
  veto_triggered?: boolean;
  warning?: boolean;
  status?: string;
  ratio?: number | null;
  market_cap_bn?: number | null;
  pipeline_npv_estimate_bn?: number | null;
  prob_approval_used?: number | null;
  tam_estimate_bn?: number | null;
  peak_sales_bn?: number | null;
  market_share_assumption?: number;
  revenue_multiple?: number;
  interpretation?: string;
  rules_fired?: string[];
  potential_acquirers?: string[];
  acquirable?: boolean;
};

export type SdsClusterDDetail = {
  total?: number;
  raw_total?: number;
  raw_max?: number;
  cash_veto?: boolean;
  cash_runway?: SdsClusterDComponentDetail;
  mc_pipeline_ratio?: SdsClusterDComponentDetail;
  ma_attractiveness?: SdsClusterDComponentDetail;
};

export type SdsClusterEComponentDetail = {
  score?: number | null;
  max?: number;
  days_to_cd?: number | null;
  cd_date?: string | null;
  flag?: string;
  label?: string;
  status?: string;
  score_base?: number | null;
  quality_modifier?: number | null;
  catalyst_count?: number;
  catalyst_types?: string[];
  events_detected?: number;
};

export type SdsClusterEFlags = {
  binary_event_lock?: boolean;
  optimal_window?: boolean;
  late_entry?: boolean;
  post_event?: boolean;
};

export type SdsClusterEDetail = {
  total?: number;
  raw_total?: number;
  raw_max?: number;
  catalyst_window?: SdsClusterEComponentDetail;
  sequential_catalysts?: SdsClusterEComponentDetail;
  flags?: SdsClusterEFlags;
};

export type SdsClusterAComponentDetail = {
  score?: number | null;
  max?: number;
  phase_detected?: string | null;
  base?: number | null;
  bonuses?: string[];
  flags?: string[];
  endpoint_type?: string | null;
  keyword_matched?: string | null;
  source?: string | null;
  approved_drugs_count?: number | null;
  first_in_class?: boolean | null;
  confidence?: string | null;
  bonus?: number | null;
  tam_estimate_bn?: number | null;
};

export type SdsClusterADetail = {
  total?: number;
  raw_total?: number;
  raw_max?: number;
  phase_credibility?: SdsClusterAComponentDetail;
  endpoint_credibility?: SdsClusterAComponentDetail;
  unmet_need?: SdsClusterAComponentDetail;
  market_size?: SdsClusterAComponentDetail;
};

export type SdsCohortPayload = {
  generated_at?: string;
  n?: number;
  market_regime?: string;
  fmp_enabled?: boolean;
  fmp_fetched?: boolean;
  cluster_a_fetched?: boolean;
  /** full = FMP recompute · light = daily C+E · sync = new tickers only */
  refresh_mode?: "full" | "light" | "sync";
  last_fmp_refresh_at?: string;
  cohort_max_days_to_cd?: number;
  cohort_post_cd_days?: number;
  rows?: SdsRow[];
  top_candidates?: SdsRow[];
};

const SDS_SNAPSHOT_FILE = "sds_snapshot.json";
const SDS_SNAPSHOT_GOOD_FILE = "sds_snapshot.last_good.json";
const SDS_COHORT_TIMEOUT_MS = 12_000;
const SDS_REFRESH_TIMEOUT_MS = 90_000;
const SDS_REFRESH_FMP_TIMEOUT_MS = 240_000;

/** Timing-only recompute (no FMP): max SDS ~10–15, cluster B/C ≈ 0. */
export function isDegradedSdsSnapshot(doc: SdsCohortPayload | null | undefined): boolean {
  const rows = doc?.rows;
  if (!rows?.length) return true;
  const maxSds = Math.max(...rows.map((r) => r.sds ?? 0));
  const top = rows.reduce((a, b) => ((a.sds ?? 0) >= (b.sds ?? 0) ? a : b));
  const topInst = top.cluster_scores?.institutional_signal ?? 0;
  const topPrice = top.cluster_scores?.price_structure ?? 0;
  return maxSds < 25 && topInst < 1 && topPrice < 1;
}

async function readSdsSnapshotFile(relativePath: string): Promise<SdsCohortPayload | null> {
  const rel = relativePath.replace(/^\/+/, "");
  // SDS snapshots: always try local Electron IPC first (even in remote API mode).
  if (typeof window !== "undefined" && window.supernova?.readProjectDataFile) {
    try {
      const ipc = await window.supernova.readProjectDataFile(rel);
      if (ipc.ok && ipc.data && typeof ipc.data === "object") {
        const doc = ipc.data as SdsCohortPayload;
        if (doc.rows?.length) return doc;
      }
    } catch {
      /* fall through */
    }
  }
  if (isRemoteDataMode()) {
    const { data } = await fetchProjectJson<SdsCohortPayload>(relativePath);
    if (data?.rows?.length) return data;
    return null;
  }
  const { data } = await fetchProjectJson<SdsCohortPayload>(relativePath);
  if (data?.rows?.length) return data;
  return null;
}

export async function readLocalSdsSnapshot(): Promise<SdsCohortPayload | null> {
  // Prefer last_good — main snapshot may hold a timing-only recompute.
  for (const file of [SDS_SNAPSHOT_GOOD_FILE, SDS_SNAPSHOT_FILE]) {
    const doc = await readSdsSnapshotFile(file);
    if (doc?.rows?.length && !isDegradedSdsSnapshot(doc)) return doc;
  }
  // Last resort: return any snapshot with rows (timing-only / degraded — better than empty tab).
  for (const file of [SDS_SNAPSHOT_GOOD_FILE, SDS_SNAPSHOT_FILE]) {
    const doc = await readSdsSnapshotFile(file);
    if (doc?.rows?.length) return doc;
  }
  return null;
}

export async function loadSdsCohort(refresh = false, fetchFmp = false): Promise<SdsCohortPayload> {
  if (!refresh) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    if (await probeApiReachable()) {
      try {
        const doc = await api<SdsCohortPayload>("/api/sds/cohort", undefined, {
          timeoutMs: SDS_COHORT_TIMEOUT_MS,
        });
        if (doc?.rows?.length) {
          if (!isDegradedSdsSnapshot(doc)) return doc;
          const fallback = await readLocalSdsSnapshot();
          if (fallback?.rows?.length && !isDegradedSdsSnapshot(fallback)) return fallback;
          return doc;
        }
        const fallback = await readLocalSdsSnapshot();
        if (fallback?.rows?.length) return fallback;
      } catch {
        /* fall through */
      }
    }
    throw new Error(
      `SDS snapshot missing (data/${SDS_SNAPSHOT_FILE}) — use Recalculate SDS with FMP.`,
    );
  }

  const q = new URLSearchParams();
  q.set("refresh", "true");
  if (fetchFmp) {
    q.set("fetch_fmp", "true");
    q.set("fetch_short", "true");
  }
  const qs = q.toString();
  const path = `/api/sds/cohort${qs ? `?${qs}` : ""}`;

  if (!(await probeApiReachable())) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    throw new Error(`SDS snapshot missing (data/${SDS_SNAPSHOT_FILE}) — API offline.`);
  }

  try {
    const doc = await api<SdsCohortPayload>(path, undefined, {
      timeoutMs: refresh || fetchFmp ? SDS_REFRESH_FMP_TIMEOUT_MS : SDS_COHORT_TIMEOUT_MS,
    });
    if (isDegradedSdsSnapshot(doc)) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) return local;
    }
    return doc;
  } catch (err) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    throw err;
  }
}

export async function refreshSdsCohort(opts?: { fetchFmp?: boolean; fetchClusterA?: boolean }): Promise<SdsCohortPayload> {
  const q = new URLSearchParams();
  if (opts?.fetchFmp) {
    q.set("fetch_fmp", "true");
    q.set("fetch_short", "true");
  }
  if (opts?.fetchClusterA !== false) {
    q.set("fetch_cluster_a", "true");
  }
  const qs = q.toString();
  const path = `/api/sds/refresh${qs ? `?${qs}` : ""}`;
  const timeoutMs = opts?.fetchFmp ? SDS_REFRESH_FMP_TIMEOUT_MS : SDS_REFRESH_TIMEOUT_MS;
  if (!(await probeApiReachable())) {
    throw new Error("API offline — cannot recalculate SDS.");
  }
  try {
    const doc = await api<SdsCohortPayload>(path, { method: "POST" }, { timeoutMs });
    if (isDegradedSdsSnapshot(doc)) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) return local;
    }
    return doc;
  } catch (err) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    throw err;
  }
}

/** Light refresh — Cluster C+E from fresh prices/live; A/B/D from on-disk cache. */
export async function refreshSdsCohortLight(): Promise<SdsCohortPayload> {
  if (!(await probeApiReachable())) {
    throw new Error("API offline — cannot run SDS light refresh.");
  }
  try {
    const doc = await api<SdsCohortPayload>(
      "/api/sds/refresh-light",
      { method: "POST" },
      { timeoutMs: SDS_REFRESH_TIMEOUT_MS },
    );
    if (isDegradedSdsSnapshot(doc)) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) return local;
    }
    return doc;
  } catch (err) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    throw err;
  }
}

/** Fast sync when Simulation adds/removes tickers in the SDS cohort window. */
export async function syncSdsFromSimulation(): Promise<SdsCohortPayload> {
  if (!(await probeApiReachable())) {
    throw new Error("API offline — cannot sync SDS from Simulation.");
  }
  try {
    const doc = await api<SdsCohortPayload>(
      "/api/sds/sync-simulation",
      { method: "POST" },
      { timeoutMs: SDS_REFRESH_TIMEOUT_MS },
    );
    if (isDegradedSdsSnapshot(doc)) {
      const local = await readLocalSdsSnapshot();
      if (local?.rows?.length) return local;
    }
    return doc;
  } catch (err) {
    const local = await readLocalSdsSnapshot();
    if (local?.rows?.length) return local;
    throw err;
  }
}

/** Restore SDS from data/sds_snapshot.last_good.json via API. */
export async function restoreSdsFromBackup(): Promise<SdsCohortPayload> {
  const local = await readLocalSdsSnapshot();
  if (local?.rows?.length && !isDegradedSdsSnapshot(local)) return local;
  if (!(await probeApiReachable())) {
    throw new Error("API offline — cannot restore SDS backup.");
  }
  const doc = await api<SdsCohortPayload>(
    "/api/sds/restore-backup",
    { method: "POST" },
    { timeoutMs: SDS_COHORT_TIMEOUT_MS },
  );
  return doc;
}

export function loadSdsTicker(ticker: string, fetchFmp = false) {
  const q = fetchFmp ? "?fetch_fmp=true&fetch_short=true" : "";
  return api<SdsRow>(`/api/sds/${encodeURIComponent(ticker)}${q}`);
}

// ─── Learning Lab ───────────────────────────────────────────────────────────

export type LearningEffectivenessRow = {
  mechanism: string;
  label: string;
  mae_before: number | null;
  mae_after: number | null;
  mae_delta_pp: number | null;
  abs_lift_pp?: number | null;
  dir_before: number | null;
  dir_after: number | null;
  dir_delta_pp: number | null;
  verdict: string;
  n: number;
  min_n: number;
};

export type ChannelLoopEffect = {
  loop: string;
  label: string;
  factor?: number | null;
  abs_bias_after_pp?: number | null;
  d_bias_pp?: number | null;
  mae_after_pp?: number | null;
  d_mae_pp?: number | null;
  d_dir_hit_pp?: number | null;
  is_lever?: boolean;
  verdict: string;
  note?: string;
};

export type PredictionWeek = {
  week: string;
  n: number;
  sign_hit_pct: number | null;
  price_accuracy_pct: number | null;
};

export type PredictionReliabilityNode = {
  offset: number;
  label: string;
  sign_hit_pct: number | null;
  n: number;
  reliable?: boolean;
  stars?: number | null;
};

export type ReliabilityWindow = {
  peak_pct: number;
  peak_offset: number;
  threshold_pct: number;
  gap_pp: number;
  lo_offset: number;
  hi_offset: number;
  offsets: number[];
};

export type ReliabilityBand = {
  key: string;
  label_it: string;
  label_en: string;
  lo_offset: number;
  hi_offset: number;
  mean_pct: number | null;
  n: number;
  n_nodes: number;
  /** ``canonical`` = CD−2m→−10d efficiency window; others are diagnostic. */
  role?: "canonical" | "diagnostic";
};

export type ChannelEvaluationFrame = {
  window_key: string;
  lo_days_to_cd: number;
  hi_days_to_cd: number;
  label_it: string;
  label_en: string;
  n_total?: number;
  n_in_window?: number;
  n_out_of_window?: number;
  n_unknown_timing?: number;
  note_it?: string;
  note_en?: string;
  layers?: Record<
    string,
    { key: string; channel: string; label_it: string; label_en: string }
  >;
};

export type RecommendationWeek = {
  week: string;
  n: number;
  buy_n: number;
  buy_up_hit_pct: number | null;
  buy_graded_n: number;
};

export type TradingWeek = {
  week: string;
  n: number;
  win_pct: number | null;
  mean_pnl_pct: number | null;
  total_eur: number | null;
};

export type RecommendationSellReason = {
  reason: string;
  n: number;
  graded_n: number;
  down_hit_pct: number | null;
};

export type TradingRegimeBucket = {
  regime: string;
  n: number;
  win_pct: number | null;
  mean_pnl_pct: number | null;
  total_eur: number | null;
  lift_vs_book_pp: number | null;
};

export type ChannelImpact = {
  generated_at?: string;
  error?: string;
  evaluation?: ChannelEvaluationFrame;
  prediction?: {
    available?: boolean;
    n_events?: number | null;
    n_sessions?: number | null;
    pre_cd_sign_hit_pct: number | null;
    /** Sign-hit on canonical CD−2m→−10d band (efficiency headline). */
    eval_window_sign_hit_pct?: number | null;
    eval_window_n?: number | null;
    pre_cd_price_accuracy_pct: number | null;
    benchmark_sign_hit_pct: number | null;
    benchmark_price_accuracy_pct: number | null;
    best_node?: PredictionReliabilityNode | null;
    worst_node?: PredictionReliabilityNode | null;
    reliability_by_cd?: PredictionReliabilityNode[];
    reliability_window?: ReliabilityWindow | null;
    reliability_bands?: ReliabilityBand[] | null;
    weekly_delta_pp: number | null;
    weekly_significant?: boolean;
    loops: ChannelLoopEffect[];
    weekly: PredictionWeek[];
    note?: string | null;
  };
  recommendation?: {
    available: boolean;
    buy: {
      n: number;
      graded_n: number;
      up_hit_pct: number | null;
    };
    sell: {
      n: number;
      graded_n: number;
      pending_n: number;
      down_hit_pct: number | null;
      by_reason: RecommendationSellReason[];
    };
    hold: {
      n: number;
      rescue_available: boolean;
      note?: string;
    };
    weekly: RecommendationWeek[];
    note?: string | null;
  };
  trading?: {
    n: number;
    win_pct: number | null;
    mean_pnl_pct: number | null;
    median_pnl_pct: number | null;
    total_eur: number | null;
    weekly: TradingWeek[];
    regimes?: TradingRegimeBucket[];
    regime_available?: boolean;
    regime_n?: number;
  };
  weekly_history?: Record<string, unknown>[];
};

export type LearningLabOverview = {
  generated_at: string;
  use_mock?: boolean;
  data_available?: boolean;
  cluster_data_missing?: boolean;
  regime_data_missing?: boolean;
  health: "active" | "partial" | "stalled";
  global_cal_factor: number;
  active_clusters: number;
  total_clusters: number;
  current_regime: string;
  current_regime_multiplier: number;
  total_outcomes: number;
  mae_trend_pp_per_week: number | null;
  live_pool?: {
    n_outcomes?: number;
    mae_with_all?: number | null;
    mae_baseline?: number | null;
    dir_with_all?: number | null;
  } | null;
  demo_history?: boolean;
  learning_cycle: string;
  cluster_doc: Record<string, unknown>;
  regime_doc: Record<string, unknown>;
  history: { weeks?: Record<string, unknown>[]; cluster_cf_history_synthetic?: boolean; regime_history_synthetic?: boolean };
  learning_log: { entries?: { message: string; date?: string; kind?: string }[] };
  effectiveness: LearningEffectivenessRow[];
  pipeline: { id: string; status: string; last_updated?: string | null }[];
  eis_super_score?: Record<string, unknown>;
  cd_pattern_polygon?: Record<string, unknown>;
  validation_feedback?: {
    summary?: Record<string, unknown> | null;
    history?: { run_at?: string; summary?: Record<string, unknown> }[];
  };
  signal_calibration?: {
    generated_at?: string;
    useful_hit_pct?: number | null;
    useful_n?: number | null;
    weekly_actionable?: { week_key?: string; hit_pct?: number | null; n?: number | null }[];
  };
  curve_impact?: {
    built_at?: string;
    n_events?: number;
    summary?: Record<string, number | null | undefined>;
    enrichment_summary?: Record<string, number | null | undefined>;
  };
  expected_move?: ExpectedMoveCalibration;
  channel_impact?: ChannelImpact;
};

export type ExpectedMoveBucket = {
  bucket: number;
  label: string;
  n: number;
  pred_max?: number | null;
  median_move_pp: number;
  mean_move_pp: number;
  prob_gt_10pp: number;
  straddle_candidate: boolean;
};

export type ExpectedMoveCalibration = {
  status?: string;
  updated_at?: string;
  n_samples?: number;
  overall_corr?: number | null;
  large_move_pp?: number;
  straddle_min_bucket?: number;
  buckets?: ExpectedMoveBucket[];
};

export type LearningCyclePreview = {
  ok: boolean;
  dry_run: boolean;
  diff: {
    cluster_changes: Record<string, unknown>[];
    regime_changes: Record<string, unknown>[];
    eis_super_changes?: Record<string, unknown>[];
    polygon_changes?: Record<string, unknown>[];
  };
  effectiveness: LearningEffectivenessRow[];
};

/**
 * In-flight coalescer + response cache for /api/models/learning-lab/overview (Jul 2026 perf).
 *
 * The endpoint takes 15 s server-side (build_overview_payload). Consumers:
 *   - `useCdPatternPolygonOverview` hook (fires at boot for tickers using CD pattern)
 *   - `LearningLabView` component (fires when Models > Learning tab opens)
 * Prior to Jul 13 2026 the in-flight coalescer collapsed same-tick calls, but
 * once the promise settled every subsequent call refetched — so re-opening the
 * Models tab was another 15 s round-trip. Adding a 5-minute response cache
 * matches the manifest refresh cadence and eliminates the redundant round-trip.
 */
let learningLabOverviewInflight: Promise<LearningLabOverview> | null = null;
let learningLabOverviewCached: { at: number; value: LearningLabOverview } | null = null;
const LEARNING_LAB_OVERVIEW_CACHE_TTL_MS = 5 * 60_000;

export function fetchLearningLabOverview(opts?: { force?: boolean }) {
  if (!opts?.force) {
    if (
      learningLabOverviewCached &&
      Date.now() - learningLabOverviewCached.at < LEARNING_LAB_OVERVIEW_CACHE_TTL_MS
    ) {
      return Promise.resolve(learningLabOverviewCached.value);
    }
    if (learningLabOverviewInflight) return learningLabOverviewInflight;
  }
  const url = opts?.force
    ? "/api/models/learning-lab/overview?force=1"
    : "/api/models/learning-lab/overview";
  const p = api<LearningLabOverview>(url, undefined, { timeoutMs: 120_000 })
    .then((v) => {
      learningLabOverviewCached = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      learningLabOverviewInflight = null;
    });
  if (!opts?.force) learningLabOverviewInflight = p;
  return p;
}

/** Drop the cached overview (e.g. after apply/reset of the learning cycle). */
export function invalidateLearningLabOverviewCache(): void {
  learningLabOverviewInflight = null;
  learningLabOverviewCached = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resilience Score snapshot
//
// Served by /api/tickers/resilience-snapshot from a pre-computed JSON on disk
// (see prediction/resilience_score.py). Contract mirrors ResilienceScorePayload
// on the Python side and TickerResilienceEntry in resilienceScoreData.ts.
//
// Snapshot is refreshed by the desktop-snapshots pipeline (excel_sheet_reader.py)
// alongside learning_lab_overview_snapshot. A single request returns ALL
// tickers, so we cache the whole document for 5 minutes and coalesce
// in-flight requests to avoid the HTTP/1.1 connection saturation issue.
// ─────────────────────────────────────────────────────────────────────────────

export type ResilienceComponentDoc = {
  score: number;
  max: number;
  status: "ok" | "insufficient_history" | "no_data" | string;
  [key: string]: unknown;
};

export type ResilienceEntryDoc = {
  ticker: string;
  as_of: string | null;
  resilience_score: number;
  max_score: number;
  status: "ok" | "insufficient_history" | string;
  components: {
    historical_recovery: ResilienceComponentDoc;
    asymmetric_beta: ResilienceComponentDoc;
    upside_capacity: ResilienceComponentDoc;
  };
};

export type ResilienceSnapshotDoc = {
  generated_at: string | null;
  ticker_count: number;
  skipped_count: number;
  skipped: string[];
  entries: Record<string, ResilienceEntryDoc>;
  status?: "snapshot_missing" | string;
};

let resilienceSnapshotInflight: Promise<ResilienceSnapshotDoc> | null = null;
let resilienceSnapshotCached: { at: number; value: ResilienceSnapshotDoc } | null = null;
const RESILIENCE_SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;

export function fetchResilienceSnapshot(opts?: { force?: boolean }): Promise<ResilienceSnapshotDoc> {
  if (!opts?.force) {
    if (
      resilienceSnapshotCached &&
      Date.now() - resilienceSnapshotCached.at < RESILIENCE_SNAPSHOT_CACHE_TTL_MS
    ) {
      return Promise.resolve(resilienceSnapshotCached.value);
    }
    if (resilienceSnapshotInflight) return resilienceSnapshotInflight;
  }
  const p = api<ResilienceSnapshotDoc>("/api/tickers/resilience-snapshot", undefined, {
    timeoutMs: 30_000,
  })
    .then((v) => {
      resilienceSnapshotCached = { at: Date.now(), value: v };
      return v;
    })
    .finally(() => {
      resilienceSnapshotInflight = null;
    });
  if (!opts?.force) resilienceSnapshotInflight = p;
  return p;
}

export function invalidateResilienceSnapshotCache(): void {
  resilienceSnapshotInflight = null;
  resilienceSnapshotCached = null;
}

export function previewLearningCycle() {
  return api<LearningCyclePreview>("/api/models/learning-lab/preview", { method: "POST" }, { timeoutMs: 60_000 });
}

export function applyLearningCycle() {
  return api<LearningCyclePreview>(
    "/api/models/learning-lab/apply",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 60_000 },
  ).then((v) => {
    invalidateLearningLabOverviewCache();
    return v;
  });
}

export function resetLearningLab(confirm: boolean) {
  return api<{ ok: boolean; dry_run: boolean }>(
    "/api/models/learning-lab/reset",
    { method: "POST", body: JSON.stringify({ confirm }) },
    { timeoutMs: 30_000 },
  ).then((v) => {
    if (confirm) invalidateLearningLabOverviewCache();
    return v;
  });
}

export function exportLearningLabReport() {
  return api<Record<string, unknown>>("/api/models/learning-lab/export", undefined, { timeoutMs: 30_000 });
}

export type FeedbackLoopCalChange = {
  ticker: string;
  old_cal: number;
  new_cal: number;
  reason: string;
};

export type FeedbackLoopSummary = {
  portfolio_avg_mae?: number | null;
  portfolio_direction_acc?: number | null;
  underperformers?: string[];
  strong_performers?: string[];
  bias_flags?: string[];
  direction_suspended?: string[];
  cal_factor_changes?: FeedbackLoopCalChange[];
  n_tickers?: number;
  updated_at?: string;
};

export type FeedbackLoopResult = {
  ok: boolean;
  dry_run: boolean;
  run_at?: string;
  summary?: FeedbackLoopSummary;
  cal_factor_changes?: FeedbackLoopCalChange[];
  error?: string;
};

export function previewFeedbackLoop() {
  return api<FeedbackLoopResult>("/api/models/feedback-loop/preview", { method: "POST" }, { timeoutMs: 120_000 });
}

export function applyFeedbackLoop() {
  return api<FeedbackLoopResult>(
    "/api/models/feedback-loop/apply",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 120_000 },
  );
}

export type SignalCalibrationRebuildResult = {
  ok: boolean;
  closed?: number;
  log_rows?: number;
  closed_rows?: number;
  pending_outcomes?: number;
  useful_hit_pct?: number | null;
  useful_n?: number | null;
  weekly_actionable?: { week_key?: string; hit_pct?: number | null; n?: number | null }[];
  generated_at?: string;
  cohorts?: Record<string, { hit_pct?: number | null; n?: number | null }>;
  error?: string;
};

export function fetchSignalCalibration() {
  return api<Record<string, unknown>>("/api/models/signal-calibration", undefined, { timeoutMs: 30_000 });
}

export function rebuildSignalCalibration() {
  return api<SignalCalibrationRebuildResult>(
    "/api/models/signal-calibration/rebuild",
    { method: "POST" },
    { timeoutMs: 180_000 },
  );
}

export type Intraday1hPoint = { t: string; price: number };

export type Intraday1hSessionBlock = {
  session_date: string | null;
  series: Record<string, Intraday1hPoint[]>;
  /** Previous regular close by ticker — same baseline as Yahoo Var. Giorn. %. */
  prev_close?: Record<string, number | null | undefined>;
};

export type Intraday1hPayload = {
  updated_at: string | null;
  interval?: string;
  source?: string;
  error?: string;
  as_of?: string | null;
  /** Session before live (Soft BUY ↑≥2d yesterday). */
  prior?: Intraday1hSessionBlock;
  /** Current session truncated to now, or settled last complete day pre-open. */
  live?: Intraday1hSessionBlock;
  /** Backward-compatible: live if present else prior. */
  series: Record<string, Intraday1hPoint[]>;
};

export type VolumeHistoryBar = {
  date: string;
  volume: number | null;
  close?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
};

export type VolumeHistoryPayload = {
  ticker: string;
  bars: VolumeHistoryBar[];
  updated_at: string | null;
  error?: string | null;
};

export type VolumeVsPrevSessionRow = {
  date: string;
  volume: number;
  prev_date: string;
  prev_volume: number;
  /** Latest session volume as % of the previous Nasdaq session (100 = same). */
  pct_of_prev: number;
  /** Last bar vs previous session ≥150%. */
  surge_24h?: boolean;
  /** Any of the last 7 session pairs ≥150%. */
  surge_7d?: boolean;
  max_pct_7d?: number | null;
  last_close?: number;
  prev_close?: number;
  /** Close from the previous hourly desk pack (server). */
  prev_hour_close?: number;
  /** % change vs previous hourly pack last_close (Δ visit / last call). */
  hour_chg_pct?: number | null;
  /** +vol on up close, −vol on down close (price_sign_proxy). Not Lee-Ready. */
  volume_delta_signed?: number;
  volume_delta_method?: "price_sign_proxy" | "tick_rule";
  obv_divergence_flag?: boolean;
  /** Desk provenance (asof / source / session_day) for grey «ven» carry badge. */
  _desk?: {
    asof?: string;
    source?: string;
    session_day?: string;
    fields?: Record<string, { asof?: string; source?: string; session_day?: string }>;
  };
};

export type VolumeVsPrevSessionPayload = {
  updated_at: string | null;
  rows: Record<string, VolumeVsPrevSessionRow>;
  error?: string | null;
};

export type VolumeAccelRow = {
  ticker: string;
  timestamp: string;
  rvol: number | null;
  beta: number;
  doubling_time_minutes: number | null;
  r_squared: number;
  confirmed: boolean;
  price_move_pct: number;
  score: number;
  flagged: boolean;
};

export type VolumeAccelPayload = {
  updated_at: string | null;
  rows: Record<string, VolumeAccelRow>;
  error?: string | null;
};

/** Batch: 5m RVOL log-slope (T_double) — Soft BUY High Vol. Max 20 tickers. */
export function fetchVolumeAcceleration(
  tickers: string[],
  opts?: { force?: boolean },
): Promise<VolumeAccelPayload> {
  const clean = sanitizeIntradayTickers(tickers, 20);
  const q = clean.join(",");
  if (!q) return Promise.resolve({ updated_at: null, rows: {} });
  const force = opts?.force ? "&force=true" : "";
  return api<VolumeAccelPayload>(
    `/api/market/volume-acceleration?tickers=${encodeURIComponent(q)}${force}`,
    undefined,
    { timeoutMs: 90_000 },
  );
}

const volumeVsPrevInflight = new Map<string, Promise<VolumeVsPrevSessionPayload>>();

/** Batch: session volume as % of last market close — KPI snapshot Vol % column. */
export function fetchVolumeVsPrevSession(
  tickers: string[],
  opts?: { force?: boolean },
): Promise<VolumeVsPrevSessionPayload> {
  const clean = sanitizeIntradayTickers(tickers, 80);
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });
  const peeked = peekVolumeVsPrevCache(clean);
  const stale = opts?.force ? [...clean] : peeked.stale;
  if (!stale.length) {
    return Promise.resolve({ updated_at: null, rows: peeked.rows });
  }

  const inflightKey = `${opts?.force ? "f:" : ""}${stale.join(",")}`;
  let pending = volumeVsPrevInflight.get(inflightKey);
  if (!pending) {
    const q = stale.join(",");
    const force = opts?.force ? "&force=true" : "";
    pending = api<VolumeVsPrevSessionPayload>(
      `/api/market/volume-vs-prev-session?tickers=${encodeURIComponent(q)}${force}`,
      undefined,
      { timeoutMs: 60_000 },
    ).finally(() => {
      volumeVsPrevInflight.delete(inflightKey);
    });
    volumeVsPrevInflight.set(inflightKey, pending);
  }

  return pending.then(
    (payload) => {
      rememberVolumeVsPrevRows(payload.rows ?? {});
      return {
        ...payload,
        rows: { ...peeked.rows, ...(payload.rows ?? {}) },
      };
    },
    (err: unknown) => {
      if (Object.keys(peeked.rows).length) {
        return { updated_at: null, rows: peeked.rows, error: "fetch_failed" };
      }
      throw err;
    },
  );
}

/** Daily Yahoo OHLCV bars for volume / EIS charts (open/high/low when available). */
export function fetchVolumeHistory(ticker: string, days = 35): Promise<VolumeHistoryPayload> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) {
    return Promise.resolve({ ticker: "", bars: [], updated_at: null, error: "missing_ticker" });
  }
  const d = Math.max(1, Math.min(400, Math.round(days)));
  return api<VolumeHistoryPayload>(
    `/api/market/volume-history?ticker=${encodeURIComponent(tk)}&days=${d}`,
    undefined,
    { timeoutMs: 60_000 },
  );
}

/** Hourly Yahoo curves — prior Nasdaq day + live session to now. */
export function fetchIntraday1h(
  tickers: string[],
  opts?: { force?: boolean },
): Promise<Intraday1hPayload> {
  const clean = sanitizeIntradayTickers(tickers, 80);
  const q = clean.join(",");
  if (!q) {
    return Promise.resolve({ updated_at: null, series: {} });
  }
  const force = opts?.force ? "&force=true" : "";
  return api<Intraday1hPayload>(
    `/api/market/intraday-1h?tickers=${encodeURIComponent(q)}${force}`,
    undefined,
    { timeoutMs: 90_000 },
  );
}

/** One Google Trends query for a ticker (symbol, company name, or product). */
export type SearchInterestLeg = {
  kind: "ticker" | "company" | "product" | string;
  term: string;
  interest_score?: number | null;
  prev_interest_score?: number | null;
  interest_delta_pct?: number | null;
  zscore_vs_baseline?: number | null;
  search_spike?: boolean;
};

/** Google Trends search-interest — display only, not a BUY/SELL gate. */
export type SearchInterestRow = {
  ticker: string;
  query_term?: string;
  query_kind?: "molecule" | "indication" | "ticker" | "company" | "product" | string;
  date?: string;
  interest_score?: number | null;
  prev_interest_score?: number | null;
  interest_delta_pct?: number | null;
  delta_basis?: "weekend_vs_last_nasdaq" | "previous_print" | string;
  nasdaq_session_date?: string | null;
  rolling_baseline_20d?: number | null;
  zscore_vs_baseline?: number | null;
  zscore_delta?: number | null;
  search_spike?: boolean;
  stale?: boolean;
  legs?: SearchInterestLeg[];
  /** Secondary ~24h window (`now 1-d`) — display only; baseline remains today 3-m. */
  interest_1d_score?: number | null;
  interest_1d_prev?: number | null;
  interest_1d_delta_pct?: number | null;
  interest_1d_samples?: number | null;
  interest_1d_timeframe?: string | null;
};

export type SearchInterestPayload = {
  updated_at: string | null;
  enabled?: boolean;
  method?: string | null;
  rows: Record<string, SearchInterestRow>;
  error?: string | null;
  warming?: boolean;
  session?: "closed" | "open" | string;
  nasdaq_session_date?: string | null;
};

export type SearchInterestLeader = {
  ticker: string;
  interest_score?: number | null;
  prev_interest_score?: number | null;
  interest_delta_pct?: number | null;
  zscore_vs_baseline?: number | null;
  zscore_delta?: number | null;
  search_spike?: boolean;
  stale?: boolean;
};

export type SearchInterestLeadersPayload = SearchInterestPayload & {
  leaders: SearchInterestLeader[];
  universe_size?: number;
};

export function fetchSearchInterest(tickers: string[]): Promise<SearchInterestPayload> {
  const clean = sanitizeIntradayTickers(tickers, 16);
  if (!clean.length) {
    return Promise.resolve({ updated_at: null, enabled: false, rows: {} });
  }
  return api<SearchInterestPayload>(
    `/api/market/search-interest?tickers=${encodeURIComponent(clean.join(","))}`,
    undefined,
    { timeoutMs: 60_000 },
  )
    .then((payload) => {
      rememberSearchInterestPayload(payload);
      return payload;
    })
    .catch(() => ({
      // Soft-fail one chunk: keep desk live and let sibling chunks / retries fill gaps.
      updated_at: null,
      enabled: true,
      rows: {},
      warming: true,
    }));
}

export type SmartMoneyEventDto = {
  kind: string;
  label: string;
  date?: string | null;
  detail?: string | null;
  rank?: number;
  href?: string | null;
  href_label?: string | null;
};

export type SmartMoneyTickerRow = {
  ticker: string;
  event?: SmartMoneyEventDto | null;
  traces?: SmartMoneyEventDto[];
  form4?: {
    cluster?: boolean;
    lead_role?: string | null;
    event_date?: string | null;
    buy_count?: number;
    status?: string | null;
  };
};

export type SmartMoneyPayload = {
  updated_at: string | null;
  rows: Record<string, SmartMoneyTickerRow>;
};

export type EventVolIndexRow = {
  ticker: string;
  event_date?: string;
  asof?: string;
  expiry_ev?: string | null;
  expiry_bg?: string | null;
  iv_ev?: number | null;
  iv_bg?: number | null;
  ivr?: number | null;
  spread?: number | null;
  d_spread?: number | null;
  ivr_slope?: number | null;
  ivr_slope_5d?: number | null;
  ivr_accelerating?: boolean | null;
  em_straddle?: number | null;
  em_event?: number | null;
  em_slope?: number | null;
  em_slope_5d?: number | null;
  em_accelerating?: boolean | null;
  ivr_series?: number[];
  em_series?: number[];
  rr10?: number | null;
  skew_cboe?: number | null;
  skew_ratio?: number | null;
  rr_slope?: number | null;
  pcr_vol?: number | null;
  pcr_oi?: number | null;
  pcr_vol_slope?: number | null;
  stale?: boolean;
  /** no_options | not_loaded — distinguishes empty Expect/Skew dashes. */
  empty_reason?: "no_options" | "not_loaded" | string | null;
  /** Desk provenance (asof / source / session_day). */
  _desk?: {
    asof?: string;
    source?: string;
    session_day?: string;
    fields?: Record<string, { asof?: string; source?: string; session_day?: string }>;
  };
};

export type EventVolIndexPayload = {
  updated_at: string | null;
  rows: Record<string, EventVolIndexRow>;
  error?: string | null;
  method?: string | null;
};

export function eventVolPairKey(ticker: string, eventDate: string): string {
  return `${ticker.trim().toUpperCase()}|${eventDate.slice(0, 10)}`;
}

export type CatalystShortInterestRow = {
  ticker: string;
  days_to_cover?: number | null;
  si_shares?: number | null;
  si_shares_prior?: number | null;
  si_delta_pct?: number | null;
  adv_20d?: number | null;
  borrow_fee?: number | null;
  borrow_fee_delta_5d?: number | null;
  utilization?: number | null;
  price_return_5d?: number | null;
  squeeze_risk?: boolean | null;
  si_asof?: string | null;
  source?: string | null;
  borrow_feed?: boolean;
  stale_note?: string | null;
  error?: string | null;
};

export type CatalystShortInterestPayload = {
  updated_at: string | null;
  rows: Record<string, CatalystShortInterestRow>;
  error?: string | null;
  note?: string | null;
};

export function fetchCatalystShortInterest(
  tickers: string[],
): Promise<CatalystShortInterestPayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    80,
  );
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });
  return api<CatalystShortInterestPayload>(
    `/api/market/catalyst-short-interest?tickers=${encodeURIComponent(clean.join(","))}`,
    undefined,
    { timeoutMs: 60_000 },
  ).catch(() => ({ updated_at: null, rows: {} }));
}

export type CatalystAccumulationRow = {
  ticker: string;
  insider_net_buy_30d?: number | null;
  buy_value_30d?: number | null;
  sell_value_30d?: number | null;
  buy_count_30d?: number;
  sell_count_30d?: number;
  cluster_buy?: boolean;
  skipped_10b5_1?: number;
  lead_role?: string | null;
  lead_name?: string | null;
  lead_date?: string | null;
  lead_link?: string | null;
  filing_13d?: boolean;
  form_13d?: string | null;
  date_13d?: string | null;
  who_13d?: string | null;
  pct_13d?: number | null;
  link_13d?: string | null;
  silent_kind?: string | null;
  silent_label?: string | null;
  silent_date?: string | null;
  silent_who?: string | null;
  silent_href?: string | null;
  silent_pct?: number | null;
  governance_flag?: boolean;
  gov_date?: string | null;
  gov_label?: string | null;
  gov_href?: string | null;
  officer_departure?: boolean;
  source?: string | null;
  status?: string | null;
  error?: string | null;
};

export type CatalystAccumulationPayload = {
  updated_at: string | null;
  rows: Record<string, CatalystAccumulationRow>;
  error?: string | null;
  note?: string | null;
};

export function fetchCatalystAccumulation(
  tickers: string[],
): Promise<CatalystAccumulationPayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });
  // Backend accepts up to 64; chunk to keep request URLs / timeouts sane.
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += 32) {
    chunks.push(clean.slice(i, i + 32));
  }
  return Promise.all(
    chunks.map((chunk) =>
      api<CatalystAccumulationPayload>(
        `/api/market/catalyst-accumulation?tickers=${encodeURIComponent(chunk.join(","))}`,
        undefined,
        { timeoutMs: 90_000 },
      ).catch(() => ({ updated_at: null, rows: {} as Record<string, CatalystAccumulationRow> })),
    ),
  ).then((parts) => {
    const rows: Record<string, CatalystAccumulationRow> = {};
    let updated_at: string | null = null;
    for (const part of parts) {
      if (part.updated_at) updated_at = part.updated_at;
      Object.assign(rows, part.rows ?? {});
    }
    return { updated_at, rows };
  });
}

export type CatalystDeskCachePayload = {
  updated_at?: string | null;
  horizon_days?: number;
  morning_updated_at?: string | null;
  hourly_updated_at?: string | null;
  morning?: {
    updated_at?: string | null;
    rome_date?: string | null;
    events?: Array<Record<string, unknown>>;
    tickers?: string[];
    accumulation?: Record<string, CatalystAccumulationRow>;
    trends?: Record<string, SearchInterestRow>;
    fda_brief?: Record<string, Record<string, unknown>>;
  } | null;
  hourly?: {
    updated_at?: string | null;
    rome_date?: string | null;
    vol?: Record<string, VolumeVsPrevSessionRow>;
    event_vol?: Record<string, EventVolIndexRow>;
    short_interest?: Record<string, CatalystShortInterestRow>;
    vs_xbi?: Record<string, CatalystVsXbiRow>;
    pre_mkt?: Record<string, PreMktConvictionRow>;
    /** @deprecated Trends is on morning cache. */
    trends?: Record<string, SearchInterestRow>;
  } | null;
};

/** Morning + hourly Catalyst Decision column cache (display only). */
export function fetchCatalystDeskCache(): Promise<CatalystDeskCachePayload> {
  return coalesceGet(deskCacheSlot, DESK_CACHE_TTL_MS, () =>
    api<CatalystDeskCachePayload>("/api/market/catalyst-desk-cache", undefined, {
      timeoutMs: 12_000,
    }).catch(() => ({
      updated_at: null,
      morning: null,
      hourly: null,
    })),
  );
}

/** Bust GET coalesce so the next paint sees the POST result. */
export function invalidateCatalystDeskCacheSlot(): void {
  deskCacheSlot.cached = null;
  deskCacheSlot.inflight = null;
}

/**
 * Server-owned hourly pack refresh (RTH full / off-hours hole-fill).
 * Clients stay read-only for Yahoo desk columns — Refresh and boot hole-fill
 * go through this POST only.
 */
export async function refreshCatalystDeskCache(opts?: {
  force?: boolean;
}): Promise<CatalystDeskCachePayload> {
  invalidateCatalystDeskCacheSlot();
  const q = opts?.force ? "?force=true" : "";
  const payload = await api<CatalystDeskCachePayload>(
    `/api/market/catalyst-desk-cache/refresh${q}`,
    { method: "POST" },
    { timeoutMs: 180_000 },
  );
  deskCacheSlot.cached = { at: Date.now(), value: payload };
  return payload;
}

export type DailyNewsTaxonomyDim = {
  score?: number | null;
  event_id?: string | null;
  event_type?: string | null;
  evidence?: string | null;
  modifiers_applied?: Array<{
    id?: string;
    category?: string;
    modifier?: string;
    multiplier?: number;
  }>;
  base_weight?: number | null;
  multiplier_product?: number | null;
  review_flag?: boolean;
  unclassified?: boolean;
  classification_method?: string | null;
  /** Excel catalyst benchmark importance (−1…+1), type+outcome. */
  thermometer_importance?: number | null;
  benchmark_label?: string | null;
  benchmark_id?: string | null;
};

export type DailyNewsHighlight = {
  id?: string;
  ticker?: string;
  company?: string;
  title?: string;
  summary?: string;
  link?: string;
  /** Google News RSS wrapper — backend unwrap only, never open in the browser. */
  gnews_link?: string;
  resolved_link?: string;
  event_date?: string | null;
  /** Article / press / PDF publication date (YYYY-MM-DD). */
  published_at?: string | null;
  /** Lead product / candidate when known from digest (e.g. NEO100). */
  product?: string | null;
  /** FDA designations mined from article (Orphan, Fast Track, …). */
  fda_designations?: string[] | null;
  eis_score?: number | null;
  eis?: { score?: number | null; sentiment?: number | null } | null;
  clinical_score?: number | null;
  financial_score?: number | null;
  corporate_score?: number | null;
  market_access_score?: number | null;
  market_access_notes?: string;
  taxonomy_dimensions?: Partial<
    Record<"clinical" | "financial" | "corporate" | "market_access", DailyNewsTaxonomyDim>
  > | null;
  taxonomy_review_flags?: Array<{
    dimension?: string | null;
    note?: string;
    evidence?: string | null;
    review_reason?: string;
  }> | null;
  taxonomy_audit?: string | null;
  taxonomy_method?: string | null;
  taxonomy_version?: number | null;
  story_cluster?: string | null;
  article_fp?: string | null;
  status?: "staged" | "migrated" | string;
  hour_bucket?: string | null;
  found_at?: string | null;
  /** Top News: press | sec_8k */
  source_kind?: "press" | "sec_8k" | string;
  source_label?: string;
  section?: "top" | string;
  digest_method?: "ai" | "extractive" | string;
  accession?: string;
  /** Brief taxonomy: ma | clinical | financial | other */
  news_kind?: "ma" | "clinical" | "financial" | "other" | string | null;
  phase?: string | null;
  migrated_to_eis?: boolean;
  dismissed?: boolean;
  /** Server-warmed investor brief (seed client cache on desk load). */
  cached_brief?: DailyNewsBrief | null;
};

export type DailyNewsUserAnalysis = {
  id?: string;
  source_kind?: "text" | "url" | "pdf" | string;
  source_ref?: string;
  source_label?: string;
  /** Short card digest (~10 words). */
  summary_10w?: string;
  /** Longer factual summary for the detail brief. */
  summary_long?: string;
  /** Type-aware investor digest (same quality as Daily News brief). */
  detail_summary?: string;
  news_kind?: "ma" | "clinical" | "financial" | "other" | string;
  indication?: string | null;
  key_results?: DailyNewsBriefKeyResult[];
  key_points?: string[];
  dates?: DailyNewsBriefDate[];
  digest_v?: number;
  /** Original pasted/fetched text kept for rich briefs. */
  source_excerpt?: string;
  /** Journal paper: cleaned abstract. */
  abstract?: string | null;
  /** Journal paper: short per-chapter blurbs. */
  section_summaries?: DailyNewsBriefSection[];
  is_paper?: boolean;
  ticker?: string | null;
  product?: string | null;
  /** FDA designations mined from pasted / fetched article. */
  fda_designations?: string[] | null;
  study?: string | null;
  phase?: string | null;
  results_note?: string | null;
  clinical_score?: number | null;
  financial_score?: number | null;
  corporate_score?: number | null;
  eis_score?: number | null;
  market_access_score?: number | null;
  market_access_notes?: string;
  taxonomy_dimensions?: DailyNewsHighlight["taxonomy_dimensions"];
  taxonomy_review_flags?: DailyNewsHighlight["taxonomy_review_flags"];
  taxonomy_audit?: string | null;
  taxonomy_method?: string | null;
  taxonomy_version?: number | null;
  digest_method?: "ai" | "extractive" | string;
  found_at?: string | null;
  /** Publication / press / PDF date (YYYY-MM-DD). */
  published_at?: string | null;
  event_date?: string | null;
  dismissed?: boolean;
  migrated_to_eis?: boolean;
  status?: string | null;
};

export type DailyNewsPayload = {
  updated_at?: string | null;
  rome_date?: string | null;
  last_search_at?: string | null;
  last_search_hour?: number | null;
  hour_bucket?: string | null;
  count?: number;
  migrated_count?: number;
  highlights?: DailyNewsHighlight[];
  items?: DailyNewsHighlight[];
  /** All ★ attention tickers — press + digested 8-K (each scored + linked). */
  top_news?: DailyNewsHighlight[];
  top_news_updated_at?: string | null;
  top_news_tickers?: string[];
  /** Pasted text / URL / PDF digests (clinical, financial, EIS, market access). */
  user_analyses?: DailyNewsUserAnalysis[];
  eis_abs_min?: number;
  last_migrate_at?: string | null;
  staged_count?: number;
  migrated?: number;
  calendar_dates?: number;
  skipped_no_record?: number;
  dismissed?: number;
  ok?: boolean;
  new_count?: number;
  analysis?: DailyNewsUserAnalysis;
};

/** Catalyst Daily News box (09:00 + hourly; migrate → company EIS). */
export function fetchDailyNews(): Promise<DailyNewsPayload> {
  return api<DailyNewsPayload>("/api/market/daily-news", undefined, {
    timeoutMs: 60_000,
  }).catch(() => ({
    updated_at: null,
    highlights: [],
    items: [],
    top_news: [],
    user_analyses: [],
    count: 0,
  }));
}

/** Catalyst Days removed after outcome Mig → Deep Dive. */
export function fetchCatalystOutcomesResolved(): Promise<{
  ok?: boolean;
  keys?: string[];
  count?: number;
}> {
  return api<{ ok?: boolean; keys?: string[]; count?: number }>(
    "/api/market/catalyst-outcomes/resolved",
  ).catch(() => ({ ok: false, keys: [], count: 0 }));
}

export function refreshDailyNews(
  force = false,
  priorityTickers?: string[],
): Promise<DailyNewsPayload> {
  const q = force ? "?force=true" : "";
  return api<DailyNewsPayload>(
    `/api/market/daily-news/refresh${q}`,
    {
      method: "POST",
      body: JSON.stringify({
        force,
        priority_tickers: (priorityTickers ?? []).map((t) => t.trim().toUpperCase()).filter(Boolean),
      }),
    },
    { timeoutMs: 120_000 },
  ).catch(() => fetchDailyNews());
}

/** Top News for all ★ tickers (press + 8-K digests). */
export function fetchDailyNewsTop(
  tickers: string[],
  opts?: { force?: boolean },
): Promise<DailyNewsPayload> {
  const clean = [
    ...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean)),
  ].slice(0, 80);
  if (!clean.length) {
    return Promise.resolve({
      top_news: [],
      top_news_tickers: [],
      highlights: [],
      count: 0,
    });
  }
  return api<DailyNewsPayload>(
    "/api/market/daily-news/top",
    {
      method: "POST",
      body: JSON.stringify({ tickers: clean, force: Boolean(opts?.force) }),
    },
    { timeoutMs: 180_000 },
  ).catch(() => ({
    // Do not send highlights: [] — loadTop would wipe staged news via ?? merge.
    top_news: [],
    top_news_tickers: clean,
    count: 0,
  }));
}

/** Digest pasted text, URL, or PDF → ~10-word summary + 4 scores. */
export async function analyzeDailyNewsSource(input: {
  text?: string;
  url?: string;
  pdf?: File | null;
}): Promise<DailyNewsPayload> {
  const hasPdf = Boolean(input.pdf);
  if (hasPdf && input.pdf) {
    const file = input.pdf;
    // Prefer JSON + base64: more reliable than multipart (python-multipart
    // must be installed; Electron/CORS sometimes surfaces multipart as Failed to fetch).
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const pdf_base64 = btoa(binary);
    try {
      return await api<DailyNewsPayload>(
        "/api/market/daily-news/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            text: input.text?.trim() || undefined,
            url: input.url?.trim() || undefined,
            pdf_base64,
            pdf_name: file.name || "upload.pdf",
          }),
        },
        { timeoutMs: 180_000 },
      );
    } catch (err) {
      // Fallback multipart if base64 path fails (e.g. very large payload limits)
      const fd = new FormData();
      if (input.text?.trim()) fd.set("text", input.text.trim());
      if (input.url?.trim()) fd.set("url", input.url.trim());
      fd.set("pdf", file, file.name || "upload.pdf");
      try {
        return await api<DailyNewsPayload>(
          "/api/market/daily-news/analyze",
          { method: "POST", body: fd },
          { timeoutMs: 180_000 },
        );
      } catch {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }
  return api<DailyNewsPayload>(
    "/api/market/daily-news/analyze",
    {
      method: "POST",
      body: JSON.stringify({
        text: input.text?.trim() || undefined,
        url: input.url?.trim() || undefined,
      }),
    },
    { timeoutMs: 180_000 },
  );
}

/** Manual: Daily News → company EIS on Deep Dive cards. Optional id = single row. */
export function migrateDailyNewsToEis(opts?: {
  id?: string;
  ids?: string[];
}): Promise<DailyNewsPayload> {
  const body: { id?: string; ids?: string[] } = {};
  const id = String(opts?.id || "").trim();
  if (id) body.id = id;
  if (opts?.ids?.length) body.ids = opts.ids.map(String);
  return api<DailyNewsPayload>(
    "/api/market/daily-news/migrate",
    { method: "POST", body: JSON.stringify(body) },
    { timeoutMs: 120_000 },
  );
}

/** Click-through detail brief for a Daily News headline (not Soft BUY/SELL). */
export type DailyNewsBriefDate = {
  date?: string;
  what_happens?: string;
};

export type DailyNewsBriefKeyResult = {
  label?: string;
  detail?: string;
};

export type DailyNewsBriefSection = {
  heading?: string;
  summary?: string;
};

/** Per-Item block from SEC 8-K structural brief (cover excluded). */
export type DailyNewsBriefItemSummary = {
  item?: string;
  title?: string;
  summary?: string;
};

export type DailyNewsBriefCoverMetadata = {
  registrant?: string | null;
  cik?: string | null;
  filing_date?: string | null;
  event_date?: string | null;
  file_number?: string | null;
};

export type DailyNewsDigestAnswer = {
  id?: string;
  question_en?: string;
  question_it?: string;
  search?: string;
  present?: boolean;
  answer?: unknown;
};

export type DailyNewsBrief = {
  title?: string;
  headline?: string | null;
  ticker?: string | null;
  source_url?: string;
  detail_summary?: string;
  /** ma | clinical | financial | other */
  news_kind?: string | null;
  abstract?: string | null;
  section_summaries?: DailyNewsBriefSection[];
  is_paper?: boolean;
  /** PubMed / journal publication day (YYYY-MM-DD) when known from eutils. */
  pub_date?: string | null;
  indication?: string | null;
  dates?: DailyNewsBriefDate[];
  results?: string | null;
  key_results?: DailyNewsBriefKeyResult[];
  /** SEC 8-K Item blocks (preferred over key_results for filings). */
  item_summaries?: DailyNewsBriefItemSummary[];
  cover_metadata?: DailyNewsBriefCoverMetadata | null;
  product?: string | null;
  study?: string | null;
  phase?: string | null;
  key_points?: string[];
  /** 3–4 sentence bullish/bearish stock-price read (Gemini). */
  investor_insight?: string | null;
  digest_method?: string;
  fetch_error?: string | null;
  /** Structured Q&A answers from the digest framework. */
  digest_answers?: DailyNewsDigestAnswer[];
  has_summary?: boolean;
  has_bullet_summary?: boolean;
  /** EDGAR 8-K taxonomy path — hide PAGE CHECK Q&A. */
  skip_page_check?: boolean;
  taxonomy_method?: string | null;
  taxonomy_dimensions?: Record<string, unknown> | null;
  taxonomy_classification?: Record<string, unknown> | null;
  clinical_score?: number | null;
  financial_score?: number | null;
  corporate_score?: number | null;
  market_access_score?: number | null;
  eis_score?: number | null;
  /** FDA AdCom package polarity from briefing digest. */
  fda_stance?: "positive" | "negative" | "mixed" | string | null;
  fda_score?: number | null;
  /** Who the issuer is / what they develop (FDA packages). */
  company_summary?: string | null;
  /** Product MoA / target / indications / stage inset. */
  product_inset?: {
    name?: string | null;
    moa?: string | null;
    target?: string | null;
    indications?: string | null;
    stage?: string | null;
  } | null;
  /** Numbered FDA panel digest Q&A (one answer per question). */
  panel_qa?: Array<{
    id?: string;
    question?: string;
    answer?: string;
  }> | null;
  /** Partnership / M&A Fin-axis terms: paid, for what, objectives, milestones. */
  deal_terms?: {
    deal_type?: string | null;
    paid?: string | null;
    for_what?: string | null;
    objectives?: string | null;
    milestones?: string | null;
    summary?: string | null;
  } | null;
  items_detected?: string[];
};

export type DailyNewsBriefPayload = {
  ok?: boolean;
  error?: string;
  brief?: DailyNewsBrief;
  source_url?: string;
};

export function briefDailyNewsItem(input: {
  title?: string;
  url?: string;
  summary?: string;
  ticker?: string;
  id?: string;
}): Promise<DailyNewsBriefPayload> {
  return api<DailyNewsBriefPayload>(
    "/api/market/daily-news/brief",
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title?.trim() || undefined,
        url: input.url?.trim() || undefined,
        summary: input.summary?.trim() || undefined,
        ticker: input.ticker?.trim() || undefined,
        id: input.id?.trim() || undefined,
      }),
    },
    { timeoutMs: 60_000 },
  );
}

/** Close a Daily News row without Migrate → EIS. */
export function dismissDailyNewsItem(id: string): Promise<DailyNewsPayload> {
  return api<DailyNewsPayload>(
    "/api/market/daily-news/dismiss",
    { method: "POST", body: JSON.stringify({ id }) },
    { timeoutMs: 30_000 },
  );
}

/** Top KPI Designation — Discovery identity + FDA-site search by product name. */
export type FdaDesignationRow = {
  ticker?: string;
  product?: string | null;
  designations?: string[];
  discovery_designations?: string[];
  fda_designations?: string[];
  sources?: Array<{ label?: string; title?: string; url?: string; via?: string }>;
  status?: string;
};

export type FdaDesignationsPayload = {
  updated_at?: string | null;
  count?: number;
  by_ticker?: Record<string, FdaDesignationRow>;
};

export function fetchFdaDesignationsBatch(
  items: Array<{ ticker: string; product?: string | null }>,
  opts?: { force?: boolean },
): Promise<FdaDesignationsPayload> {
  const clean = items
    .map((it) => ({
      ticker: String(it.ticker || "")
        .trim()
        .toUpperCase(),
      product: (it.product || "").trim() || undefined,
    }))
    .filter((it) => it.ticker)
    .slice(0, 40);
  if (!clean.length) return Promise.resolve({ updated_at: null, count: 0, by_ticker: {} });
  return api<FdaDesignationsPayload>(
    "/api/market/fda-designations",
    {
      method: "POST",
      body: JSON.stringify({ items: clean, force: Boolean(opts?.force) }),
    },
    { timeoutMs: 90_000 },
  ).catch(() => ({ updated_at: null, count: 0, by_ticker: {} }));
}

export type CatalystVsXbiRow = {
  ticker: string;
  horizon_days?: number;
  stock_return?: number | null;
  xbi_return?: number | null;
  relative_move?: number | null;
  beta?: number | null;
  method?: string | null;
  status?: string | null;
  error?: string | null;
};

export type CatalystVsXbiPayload = {
  updated_at: string | null;
  rows: Record<string, CatalystVsXbiRow>;
  error?: string | null;
  note?: string | null;
  sector?: string | null;
};

export function fetchCatalystVsXbi(tickers: string[]): Promise<CatalystVsXbiPayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    80,
  );
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });
  return api<CatalystVsXbiPayload>(
    `/api/market/catalyst-vs-xbi?tickers=${encodeURIComponent(clean.join(","))}`,
    undefined,
    { timeoutMs: 60_000 },
  ).catch(() => ({ updated_at: null, rows: {} }));
}

/** Pre-Open Imbalance — Databento NOII / NYSE Pillar. Context only, not Soft BUY/SELL. */
export type PreOpenImbalanceRow = {
  ticker: string;
  in_window?: boolean;
  venue?: string | null;
  dataset?: string | null;
  imbalance_ratio?: number | null;
  indicative_move_pct?: number | null;
  direction?: "Buy" | "Sell" | string | null;
  imbalance_accelerating?: boolean | null;
  imbalance_shares?: number | null;
  paired_shares?: number | null;
  indicative_match_price?: number | null;
  prior_close?: number | null;
  asof_et?: string | null;
  snapshot_count?: number;
  status?: string | null;
  error?: string | null;
};

export type PreOpenImbalancePayload = {
  updated_at: string | null;
  asof_et?: string | null;
  rows: Record<string, PreOpenImbalanceRow>;
  continuous_refresh?: boolean;
  databento_configured?: boolean;
  error?: string | null;
  note?: string | null;
};

/**
 * On-demand snapshot only. Does not enable continuous desk polling.
 * Pass listingByTicker so Nasdaq vs NYSE are routed correctly (never assume Nasdaq).
 */
export function fetchPreOpenImbalance(
  tickers: string[],
  opts?: {
    listingByTicker?: Record<string, string>;
    forceLive?: boolean;
  },
): Promise<PreOpenImbalancePayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    32,
  );
  if (!clean.length) {
    return Promise.resolve({
      updated_at: null,
      rows: {},
      continuous_refresh: false,
      databento_configured: false,
    });
  }
  const listings = Object.entries(opts?.listingByTicker ?? {})
    .map(([tk, venue]) => `${tk.trim().toUpperCase()}:${String(venue).trim()}`)
    .filter((p) => p.includes(":") && !p.endsWith(":"))
    .join(",");
  const q = new URLSearchParams({ tickers: clean.join(",") });
  if (listings) q.set("listings", listings);
  if (opts?.forceLive) q.set("force_live", "true");
  return api<PreOpenImbalancePayload>(
    `/api/market/catalyst-pre-open-imbalance?${q.toString()}`,
    undefined,
    { timeoutMs: 15_000 },
  ).catch(() => ({
    updated_at: null,
    rows: {},
    continuous_refresh: false,
    note: "pre-open imbalance unavailable",
  }));
}

/** Pre-Mkt Conviction — FREE proxy (Yahoo prepost). NOT official Pre-Open / NOII. */
export type PreMktConvictionRow = {
  ticker: string;
  index_kind?: string;
  is_proxy?: boolean;
  source?: string | null;
  pre_mkt_price_change_pct?: number | null;
  pre_mkt_vol_ratio?: number | null;
  conviction?: "together_up" | "together_down" | "diverge" | string | null;
  conviction_confirmed?: boolean | null;
  pre_mkt_last?: number | null;
  prior_close?: number | null;
  pre_mkt_volume?: number | null;
  pre_mkt_volume_avg_20d?: number | null;
  search_buzz_delta_pct?: number | null;
  asof_et?: string | null;
  session_date?: string | null;
  volume_source?: string | null;
  status?: string | null;
  error?: string | null;
};

export type PreMktConvictionPayload = {
  updated_at: string | null;
  asof_et?: string | null;
  rows: Record<string, PreMktConvictionRow>;
  index_kind?: string;
  is_proxy?: boolean;
  source?: string | null;
  paid_dependency?: boolean;
  error?: string | null;
  note?: string | null;
};

/**
 * On-demand Pre-Mkt Conviction snapshot (Yahoo free-tier prepost).
 * Pass searchBuzzByTicker (G-Trends Δ%) for optional ConvictionConfirmed.
 */
export function fetchPreMktConviction(
  tickers: string[],
  opts?: { searchBuzzByTicker?: Record<string, number | null | undefined> },
): Promise<PreMktConvictionPayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    80,
  );
  if (!clean.length) {
    return Promise.resolve({
      updated_at: null,
      rows: {},
      is_proxy: true,
      paid_dependency: false,
    });
  }
  const buzz = Object.entries(opts?.searchBuzzByTicker ?? {})
    .map(([tk, v]) =>
      v != null && Number.isFinite(v) ? `${tk.trim().toUpperCase()}:${v}` : "",
    )
    .filter(Boolean)
    .join(",");
  const q = new URLSearchParams({ tickers: clean.join(",") });
  if (buzz) q.set("search_buzz", buzz);
  return api<PreMktConvictionPayload>(
    `/api/market/catalyst-pre-mkt-conviction?${q.toString()}`,
    undefined,
    { timeoutMs: 45_000 },
  ).catch(() => ({
    updated_at: null,
    rows: {},
    is_proxy: true,
    paid_dependency: false,
    note: "pre-mkt conviction unavailable",
  }));
}

export type CatalystUoaRow = {
  ticker: string;
  uoa_flag?: boolean | null;
  side?: "call" | "put" | string | null;
  strike?: number | null;
  vol_ratio?: number | null;
  volume?: number | null;
  premium?: number | null;
  sweep_flag?: boolean | null;
  status?: string | null;
  note?: string | null;
  history_days?: number | null;
  history_needed?: number | null;
  error?: string | null;
};

export type CatalystUoaPayload = {
  updated_at: string | null;
  rows: Record<string, CatalystUoaRow>;
  error?: string | null;
  note?: string | null;
};

export function fetchCatalystUoa(tickers: string[]): Promise<CatalystUoaPayload> {
  const clean = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(
    0,
    24,
  );
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });
  return api<CatalystUoaPayload>(
    `/api/market/catalyst-uoa?tickers=${encodeURIComponent(clean.join(","))}`,
    undefined,
    { timeoutMs: 60_000 },
  ).catch(() => ({ updated_at: null, rows: {} }));
}

export function fetchEventVolIndex(
  pairs: Array<{ ticker: string; eventDate: string }>,
): Promise<EventVolIndexPayload> {
  const clean = pairs
    .map((p) => ({
      ticker: p.ticker.trim().toUpperCase(),
      eventDate: p.eventDate.slice(0, 10),
    }))
    .filter((p) => p.ticker && /^\d{4}-\d{2}-\d{2}$/.test(p.eventDate));
  if (!clean.length) return Promise.resolve({ updated_at: null, rows: {} });

  // Cap at 80 (backend _MAX_PAIRS); chunk so the query string stays sane.
  const capped = clean.slice(0, 80);
  const qChunks: string[][] = [];
  for (let i = 0; i < capped.length; i += 40) {
    qChunks.push(
      capped.slice(i, i + 40).map((p) => `${p.ticker}:${p.eventDate}`),
    );
  }

  return Promise.all(
    qChunks.map((parts) =>
      api<EventVolIndexPayload>(
        `/api/market/event-vol-index?pairs=${encodeURIComponent(parts.join(","))}`,
        undefined,
        { timeoutMs: 90_000 },
      ).catch(() => ({ updated_at: null, rows: {} as Record<string, EventVolIndexRow> })),
    ),
  ).then((parts) => {
    const rows: Record<string, EventVolIndexRow> = {};
    let updated_at: string | null = null;
    for (const part of parts) {
      if (part.updated_at) updated_at = part.updated_at;
      Object.assign(rows, part.rows ?? {});
    }
    return { updated_at, rows };
  });
}

export function fetchSmartMoney(tickers: string[]): Promise<SmartMoneyPayload> {
  const clean = sanitizeIntradayTickers(tickers, 16);
  if (!clean.length) {
    return Promise.resolve({ updated_at: null, rows: {} });
  }
  return api<SmartMoneyPayload>(
    `/api/market/smart-money?tickers=${encodeURIComponent(clean.join(","))}`,
    undefined,
    { timeoutMs: 30_000 },
  ).catch(() => ({ updated_at: null, rows: {} }));
}

export function fetchSearchInterestLeaders(
  limit = 10,
): Promise<SearchInterestLeadersPayload> {
  const n = Math.max(1, Math.min(40, Math.round(limit)));
  return api<SearchInterestLeadersPayload>(
    `/api/market/search-interest-leaders?limit=${n}`,
    undefined,
    { timeoutMs: 20_000 },
  )
    .then((payload) => {
      rememberSearchInterestPayload(payload);
      return payload;
    })
    .catch(() => ({
      updated_at: null,
      enabled: false,
      rows: {},
      leaders: [],
      error: "unavailable",
    }));
}
