import type {
  InvestSimInputs,
  InvestSimPersistedPayload,
  InvestSimHistoryPayload,
  InvestSimHistoryPoint,
  ChartBundle,
  SheetTable,
} from "./types";
import type { MobileCurveChartsPayload, MobileDashboardSnapshot } from "./dashboardTypes";
import type { MarketContextSnapshotDoc } from "./mobileMarketContext";
import { t } from "./i18n";
import { getMobileLang } from "./langStorage";
import { getDefaultApiBase } from "./remoteHost";
import { normalizeTesterEmail, testerIdFromEmail } from "./testerSession";

const LS_API = "sn_api_base";
const LS_TOKEN = "sn_api_token";
const LS_SETUP_DONE = "sn_short_setup_done";

/** True when PWA is served same-origin (VPS /mobile/ or v3 root). */
export function isSameOriginMobileHost(): boolean {
  if (typeof window === "undefined") return false;
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  if (base === "/mobile" || base.endsWith("/mobile")) return true;
  return window.location.pathname.startsWith("/mobile");
}

function isPrivateLanHost(hostname: string): boolean {
  if (hostname.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  const m = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Vite dev (:5174) con proxy /api → VPS — localhost o telefono sulla stessa Wi‑Fi. */
function isDevProxyHost(): boolean {
  if (typeof window === "undefined" || !import.meta.env.DEV) return false;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return port === "5174" && isPrivateLanHost(h);
}

/** Rimuove trailing slash e path /mobile (URL PWA ≠ root API). */
export function normalizeApiBase(raw: string): string {
  let v = raw.trim().replace(/\/$/, "");
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.pathname === "/mobile" || u.pathname.startsWith("/mobile/")) {
      u.pathname = "";
      v = u.toString().replace(/\/$/, "");
    }
  } catch {
    /* URL relativo o malformato — lascia com'è */
  }
  return v;
}

function isPrivateLanApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isPrivateLanHost(u.hostname) && (u.port === "8765" || u.port === "");
  } catch {
    return false;
  }
}

export function getApiBase(): string {
  if (isSameOriginMobileHost()) return "";
  const fromLs = localStorage.getItem(LS_API)?.trim();
  const lsNorm = fromLs != null && fromLs !== undefined ? normalizeApiBase(fromLs) : "";
  // Dev: proxy Vite — oppure API LAN esplicita (telefono → :8765 diretto, più affidabile del proxy).
  if (isDevProxyHost()) {
    if (lsNorm && isPrivateLanApiUrl(lsNorm)) return lsNorm;
    return "";
  }
  if (fromLs !== null && fromLs !== undefined) return lsNorm;
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) return normalizeApiBase(env);
  return "";
}

/** Prefill schermata connessione (dev = proxy locale; prod = VPS). */
export function getSetupDefaultApiBase(): string {
  if (isSameOriginMobileHost()) return "";
  if (isDevProxyHost()) return "";
  const fromLs = localStorage.getItem(LS_API)?.trim();
  if (fromLs) return normalizeApiBase(fromLs);
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) return normalizeApiBase(env);
  if (import.meta.env.DEV) return "";
  return getDefaultApiBase();
}

export function setApiBase(url: string) {
  const v = normalizeApiBase(url);
  if (v) localStorage.setItem(LS_API, v);
  else localStorage.removeItem(LS_API);
}

export function markSetupDone() {
  localStorage.setItem(LS_SETUP_DONE, "1");
}

export function getApiToken(): string {
  return (
    localStorage.getItem(LS_TOKEN)?.trim() ??
    localStorage.getItem("supernova_api_token")?.trim() ??
    ""
  );
}

export function setApiToken(token: string) {
  const v = token.trim();
  if (v) {
    localStorage.setItem(LS_TOKEN, v);
    localStorage.setItem("supernova_api_token", v);
  } else {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem("supernova_api_token");
  }
}

export function isSetupDone(): boolean {
  return localStorage.getItem(LS_SETUP_DONE) === "1";
}

export function formatApiError(status: number, text: string): string {
  const lang = getMobileLang();
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "object" && d !== null) {
      const o = d as { message_it?: string; message?: string; cause?: string };
      if (lang === "it" && o.message_it) return `${status}: ${o.message_it}`;
      if (o.message) return `${status}: ${o.message}`;
    }
    if (typeof d === "string" && d.trim()) {
      if (status === 404 && /not found/i.test(d)) {
        return `${status}: ${t("error.endpointNotFound", lang)}`;
      }
      return `${status}: ${d}`;
    }
  } catch {
    /* ignore */
  }
  const short = text.slice(0, 280).trim() || t("error.serverGeneric", lang);
  if (status === 404) {
    return `${status}: ${t("error.endpointNotFound", lang)}`;
  }
  if (status === 409) {
    return `${status}: ${t("error.excelLocked", lang)}`;
  }
  if (status === 503) {
    return `${status}: ${t("error.workbookMissing", lang)}`;
  }
  if (status === 500 && /internal server error/i.test(short)) {
    return `${status}: ${t("error.apiDown", lang)}`;
  }
  return `${status}: ${short}`;
}

export type ApiOptions = {
  timeoutMs?: number;
};

export async function api<T>(path: string, init?: RequestInit, opts?: ApiOptions): Promise<T> {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;
  const token = getApiToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers["X-SuperNova-Token"] = token;
  try {
    const { getTesterSessionToken, TESTER_SESSION_HEADER } = await import("./testerSession");
    const sess = getTesterSessionToken();
    if (sess) headers[TESTER_SESSION_HEADER] = sess;
  } catch {
    /* ignore */
  }

  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      signal: ac.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) — ${t("error.apiSlow", getMobileLang())}`);
    }
    throw new Error(formatNetworkError(e, base || undefined));
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, text));
  }
  return res.json() as Promise<T>;
}

export function formatNetworkError(e: unknown, apiBase?: string): string {
  const lang = getMobileLang();
  const raw = e instanceof Error ? e.message : String(e);
  const isFetchFail =
    /failed to fetch|networkerror|network error|load failed|connessione/i.test(raw);
  if (!isFetchFail) return raw;

  if (import.meta.env.DEV && isDevProxyHost()) {
    return t("error.apiOfflineDev", lang);
  }
  if (apiBase) {
    return t("error.apiOfflineRemote", lang, { host: apiBase.replace(/^https?:\/\//, "") });
  }
  return t("error.apiOfflineDev", lang);
}

export async function checkHealth(opts?: ApiOptions) {
  return api<{ status: string }>("/api/health", undefined, { timeoutMs: opts?.timeoutMs ?? 25_000 });
}

export async function fetchMobileHostConfig() {
  return api<{
    mode: string;
    api_token_required: boolean;
    same_origin_pwa: boolean;
    same_origin_api?: boolean;
    mobile_web_path?: string | null;
  }>("/api/mobile-host/config");
}

export async function fetchSimulationSheet(): Promise<SheetTable> {
  return api<SheetTable>("/api/sheets/simulation", undefined, { timeoutMs: 120_000 });
}

export type DesktopManifest = {
  updated_at?: string | null;
  workbook_mtime?: string | null;
};

/** Manifest server — cambia dopo ogni refresh orario/giornaliero sul VPS. */
export async function fetchDesktopManifest(): Promise<DesktopManifest | null> {
  try {
    return await api<DesktopManifest>("/api/desktop/manifest", undefined, { timeoutMs: 15_000 });
  } catch {
    return null;
  }
}

let chartsBundleCache: ChartBundle | null = null;
let chartsInflight: Promise<ChartBundle | null> | null = null;

export type SdsCohortRow = {
  ticker: string;
  sds: number;
  days_to_cd?: number | null;
  cluster_scores?: Partial<Record<string, number | null>>;
  cluster_a?: { total?: number | null };
  cluster_b?: {
    short_interest?: { squeeze_setup?: boolean; structural_bearish?: boolean };
    analyst_upgrades?: { downgrades_60d?: number; tier1_coverage?: boolean };
    institutional_delta?: { premium_fund_present?: boolean };
  };
  cluster_c?: {
    bollinger_squeeze?: { bb_percentile?: number | null };
    obv_accumulation?: { pattern?: string | null };
    volume_ratio?: {
      ratio_5d_vs_20d?: number | null;
      avg_volume_5d?: number | null;
      avg_volume_20d?: number | null;
    };
  };
  cluster_d?: {
    cash_runway?: { runway_months?: number | null };
    runway_months?: number | null;
  };
};

export type SdsCohortPayload = {
  rows?: SdsCohortRow[];
};

let sdsCohortCache: SdsCohortRow[] | null = null;
let sdsInflight: Promise<SdsCohortRow[]> | null = null;

async function loadSdsCohortRows(): Promise<SdsCohortRow[]> {
  if (sdsCohortCache?.length) return sdsCohortCache;
  if (sdsInflight) return sdsInflight;
  sdsInflight = api<SdsCohortPayload>("/api/sds/cohort", undefined, { timeoutMs: 45_000 })
    .then((doc) => {
      const rows = (doc.rows ?? []).filter(
        (r) => r.ticker && typeof r.sds === "number" && Number.isFinite(r.sds),
      );
      if (rows.length > 0) sdsCohortCache = rows;
      return rows;
    })
    .catch(() => [] as SdsCohortRow[])
    .finally(() => {
      sdsInflight = null;
    });
  return sdsInflight;
}

export async function fetchSdsRowByTicker(): Promise<Map<string, SdsCohortRow>> {
  const rows = await loadSdsCohortRows();
  const map = new Map<string, SdsCohortRow>();
  for (const row of rows) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) map.set(tk, row);
  }
  return map;
}

/** Cached SDS scores by ticker (same source as desktop polygon). */
export async function fetchSdsByTicker(): Promise<Map<string, number>> {
  const rows = await loadSdsCohortRows();
  const map = new Map<string, number>();
  for (const row of rows) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) map.set(tk, row.sds);
  }
  return map;
}

export async function fetchSimulationChartsBundle(): Promise<ChartBundle | null> {
  if (chartsBundleCache?.series && Object.keys(chartsBundleCache.series).length > 0) {
    return chartsBundleCache;
  }
  if (chartsInflight) return chartsInflight;
  chartsInflight = api<ChartBundle>("/api/charts/simulation", undefined, { timeoutMs: 120_000 })
    .then((bundle) => {
      if (bundle?.series && Object.keys(bundle.series).length > 0) {
        chartsBundleCache = bundle;
        return bundle;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      chartsInflight = null;
    });
  return chartsInflight;
}

export async function fetchSimInputs(testerId?: string | null): Promise<InvestSimPersistedPayload> {
  const path = testerId
    ? `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/sim-inputs`
    : "/api/investment/sim-inputs";
  try {
    const doc = await api<InvestSimPersistedPayload & { tester_id?: string }>(path);
    return { version: doc.version ?? 1, updated_at: doc.updated_at ?? null, inputs: doc.inputs ?? {} };
  } catch {
    return { version: 1, updated_at: null, inputs: {} };
  }
}

/**
 * Companion book = desktop shared `/api/investment/sim-inputs`.
 * Tester sandbox is used only when the shared book has no open capital.
 */
function openCapForCompanion(inputs: InvestSimInputs | null | undefined): number {
  let s = 0;
  for (const e of Object.values(inputs ?? {})) {
    if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) s += e.capital ?? 0;
  }
  return s;
}

export async function fetchCompanionSimInputs(
  testerId?: string | null,
): Promise<InvestSimPersistedPayload & { source: "shared" | "tester" | "empty" }> {
  // Same email as desktop remote → always the per-tester book (starts empty).
  if (testerId) {
    const tester = await fetchSimInputs(testerId);
    const testerCap = openCapForCompanion(tester.inputs);
    return {
      ...tester,
      source: testerCap > 0 ? "tester" : "empty",
    };
  }
  const shared = await fetchSimInputs(null);
  const sharedCap = openCapForCompanion(shared.inputs);
  if (sharedCap > 0) return { ...shared, source: "shared" };
  return { ...shared, source: "empty" };
}

export async function saveSimInputs(inputs: InvestSimInputs, testerId?: string | null): Promise<void> {
  if (testerId) {
    await api(`/api/tester-feedback/testers/${encodeURIComponent(testerId)}/sim-inputs`, {
      method: "PUT",
      body: JSON.stringify({ inputs, source: "mobile" }),
    });
    return;
  }
  await api("/api/investment/sim-inputs", {
    method: "PUT",
    body: JSON.stringify({ inputs }),
  });
}

let simHistoryCache: InvestSimHistoryPoint[] | null = null;
let simHistoryInflight: Promise<InvestSimHistoryPoint[]> | null = null;

export function invalidateSimHistoryCache(): void {
  simHistoryCache = null;
}

export async function fetchSimHistory(): Promise<InvestSimHistoryPoint[]> {
  if (simHistoryCache) return simHistoryCache;
  if (simHistoryInflight) return simHistoryInflight;
  simHistoryInflight = api<InvestSimHistoryPayload>("/api/investment/sim-history", undefined, {
    timeoutMs: 30_000,
  })
    .then((doc) => {
      const points = Array.isArray(doc.points) ? doc.points : [];
      simHistoryCache = points;
      return points;
    })
    .catch(() => [] as InvestSimHistoryPoint[])
    .finally(() => {
      simHistoryInflight = null;
    });
  return simHistoryInflight;
}

export type RegulatoryRiskSource = {
  headline: string;
  filing_date?: string;
  source?: string;
  type?: string;
};

export type RegulatoryRiskSignalBucket = {
  detected: boolean;
  hits: string[];
  sources: RegulatoryRiskSource[];
};

export type RegulatoryRiskSignal = {
  ticker?: string;
  score: number;
  crl?: RegulatoryRiskSignalBucket;
  pdufa?: RegulatoryRiskSignalBucket;
  cmc?: RegulatoryRiskSignalBucket;
  approved?: RegulatoryRiskSignalBucket;
  positive?: RegulatoryRiskSignalBucket;
  /** Legacy mobile shape */
  positive_legacy?: { detected: boolean };
  no_signals?: boolean;
  clinical_phase?: string | null;
};

export type RegulatoryRiskSnapshot = {
  updated_at: string | null;
  ticker_count?: number;
  tickers: Record<string, RegulatoryRiskSignal>;
};

export async function fetchRegulatoryRiskSnapshot(): Promise<RegulatoryRiskSnapshot | null> {
  try {
    return await api<RegulatoryRiskSnapshot>("/api/regulatory-risk/snapshot", undefined, {
      timeoutMs: 30_000,
    });
  } catch {
    return null;
  }
}

export async function fetchMarketContextMcsSnapshot(): Promise<MarketContextSnapshotDoc | null> {
  try {
    return await api<MarketContextSnapshotDoc>("/api/market/context/mcs", undefined, {
      timeoutMs: 30_000,
    });
  } catch {
    return null;
  }
}

export async function fetchMobileDashboardSnapshot(): Promise<MobileDashboardSnapshot> {
  try {
    const result = await fetchMobileDashboardSnapshotWithEtag();
    return result.body ?? { version: 1, updated_at: null, source: "error" };
  } catch {
    return { version: 1, updated_at: null, source: "error" };
  }
}

const LS_SNAP_ETAG = "sn_mobile_dash_etag";
const LS_SNAP_BODY = "sn_mobile_dash_body";

/** GET snapshot with If-None-Match — 304 reuses last body (saves multi-MB transfers). */
export async function fetchMobileDashboardSnapshotWithEtag(): Promise<{
  body: MobileDashboardSnapshot | null;
  notModified: boolean;
  etag: string | null;
}> {
  const base = getApiBase();
  const url = base ? `${base}/api/mobile/dashboard-snapshot` : "/api/mobile/dashboard-snapshot";
  const token = getApiToken();
  const headers: Record<string, string> = {};
  if (token) headers["X-SuperNova-Token"] = token;
  try {
    const { getTesterSessionToken, TESTER_SESSION_HEADER } = await import("./testerSession");
    const sess = getTesterSessionToken();
    if (sess) headers[TESTER_SESSION_HEADER] = sess;
  } catch {
    /* ignore */
  }
  const prevEtag = localStorage.getItem(LS_SNAP_ETAG)?.trim() || "";
  if (prevEtag) headers["If-None-Match"] = prevEtag;

  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: ac.signal });
  } finally {
    window.clearTimeout(timer);
  }

  const etag = res.headers.get("ETag");
  if (res.status === 304) {
    const raw = localStorage.getItem(LS_SNAP_BODY);
    if (raw) {
      try {
        const body = JSON.parse(raw) as MobileDashboardSnapshot;
        return { body, notModified: true, etag: etag || prevEtag || null };
      } catch {
        /* fall through to empty */
      }
    }
    return { body: null, notModified: true, etag: etag || prevEtag || null };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(formatApiError(res.status, text));
  }
  const body = (await res.json()) as MobileDashboardSnapshot;
  if (etag) localStorage.setItem(LS_SNAP_ETAG, etag);
  try {
    localStorage.setItem(LS_SNAP_BODY, JSON.stringify(body));
  } catch {
    /* quota — ignore */
  }
  return { body, notModified: false, etag };
}

/** Rebuild snapshot on VPS using same TS builder as desktop (decision chart + recs). */
export async function refreshMobileDashboardSnapshot(): Promise<void> {
  await api("/api/mobile/dashboard-snapshot/refresh", { method: "POST" });
}

/** Lazy curve charts for one opportunity row (kept out of the poll snapshot). */
export async function fetchMobileCurveChartsForKey(
  key: string,
): Promise<MobileCurveChartsPayload | null> {
  const k = key.trim();
  if (!k) return null;
  try {
    const q = encodeURIComponent(k);
    const res = await api<{
      ok?: boolean;
      curveCharts?: MobileCurveChartsPayload | null;
    }>(`/api/mobile/curve-charts?key=${q}`, undefined, { timeoutMs: 45_000 });
    return res.curveCharts ?? null;
  } catch {
    return null;
  }
}

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
};

export type ClinicalPublicationEvent = {
  event_date?: string | null;
  event_title?: string;
  summary?: string;
  drug?: string | null;
  asset?: string;
  source_type?: string;
  event_type?: string;
  link?: string | null;
  link_label?: string;
  sentiment?: number;
  impact_note?: string;
  price?: {
    p_t0?: number | null;
    p_t1?: number | null;
    p_t3?: number | null;
    delta_p_1d?: number | null;
    delta_p_3d?: number | null;
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
  } | null;
  reference_verified?: boolean;
  reference_match?: string | null;
  indicators?: ClinicalStudyIndicator[];
};

/** @deprecated use ClinicalPublicationEvent */
export type ClinicalPreCdEvent = ClinicalPublicationEvent;

export type ClinicalPreCdRecord = {
  ticker?: string;
  company?: string;
  nct_id?: string;
  sponsor_match?: string;
  clinical_events?: ClinicalPublicationEvent[];
  timeline_events?: ClinicalPublicationEvent[];
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
  };
  publication_context?: {
    pubmed_queries?: string[];
    pubmed_hit_count?: number;
    drug_tokens_searched?: string[];
  };
};

export async function fetchClinicalPreCdSnapshot(): Promise<{ records?: ClinicalPreCdRecord[] }> {
  return api<{ records?: ClinicalPreCdRecord[] }>("/api/clinical-pre-cd/snapshot", undefined, {
    timeoutMs: 120_000,
  });
}

/** Avvia pipeline refresh sul server (stessi profili del desktop). */
export type RefreshStatus = {
  running?: boolean;
  state?: string;
  ok?: string;
  message?: string;
  updated_at?: string;
  profile?: string;
  exit_code?: number;
};

export async function runRefreshProfile(profile: "daily" | "sunday"): Promise<Record<string, string>> {
  const res = await api<Record<string, string>>(
    `/api/refresh/run?profile=${encodeURIComponent(profile)}`,
    { method: "POST" },
    { timeoutMs: 20_000 },
  );
  if (res.error) throw new Error(res.error);
  return res;
}

export async function fetchRefreshStatus(): Promise<RefreshStatus> {
  return api<RefreshStatus>("/api/refresh/status", undefined, { timeoutMs: 15_000 });
}

/** @deprecated Use runRefreshProfile("daily") — ricarica dati già sul server. */
export async function triggerServerRefresh(): Promise<void> {
  await runRefreshProfile("daily");
}

export type TesterAccess = {
  tester_id: string;
  registered: boolean;
  display_name?: string;
  email?: string;
  status: string;
  allowed: boolean;
  created_at?: string;
  last_seen_at?: string;
  event_count?: number;
  session_ping_count?: number;
};

export async function registerMobileTester(body: {
  email: string;
  display_name?: string;
  invite_code?: string;
}) {
  const email = normalizeTesterEmail(body.email);
  const res = await api<{ ok: boolean; tester: Record<string, unknown> }>(
    "/api/tester-feedback/testers/register",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        tester_id: testerIdFromEmail(email),
        display_name: body.display_name,
        invite_code: body.invite_code,
        source: "mobile",
      }),
    },
    { timeoutMs: 20_000 },
  );
  return res;
}

export async function fetchTesterAccess(testerId: string): Promise<TesterAccess> {
  return api<TesterAccess>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/access`,
    undefined,
    { timeoutMs: 15_000 },
  );
}

export async function createTesterSession(testerId: string, email: string) {
  return api<{ ok: boolean; tester: Record<string, unknown> }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/session`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
    { timeoutMs: 15_000 },
  );
}

export async function fetchTesterFeedbackConfig(): Promise<{ invite_required?: boolean }> {
  return api<{ invite_required?: boolean }>("/api/tester-feedback/config", undefined, {
    timeoutMs: 10_000,
  });
}

export async function postTesterFeedbackEvent(body: {
  tester_id: string;
  module: string;
  kind: string;
  ticker?: string;
  source?: string;
  display_name?: string;
  payload?: Record<string, unknown>;
}) {
  return api<{ ok: boolean }>("/api/tester-feedback/events", {
    method: "POST",
    body: JSON.stringify(body),
  }, { timeoutMs: 15_000 });
}
