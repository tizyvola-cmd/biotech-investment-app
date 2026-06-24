import { loadLocalSheet } from "../data/localSheets";
import { fetchProjectJson } from "../data/projectData";
import type { CurveImpactCumulative } from "../data/signalCalibrationData";
import { isRemoteDataMode, resolveApiBase } from "../shared/remoteHost";

const TOKEN_KEY = "supernova_api_token";
/** Stesso key della mobile app — token condiviso se entrambe puntano al VPS. */
const MOBILE_TOKEN_KEY = "sn_api_token";

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
  }
  let signal = init?.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  if (!signal && typeof AbortController !== "undefined") {
    const ac = new AbortController();
    signal = ac.signal;
    timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  }
  const res = await fetch(apiUrl(path), { ...init, headers, signal }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
  if (!res.ok) {
    const text = await res.text();
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
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function fetchHealth() {
  return api<{ status: string; root: string }>("/api/health");
}

/** Lightweight monitor history for weekly trend KPIs (no full learnings bundle). */
export function fetchAccuracyMonitorHistory() {
  return api<{ entries?: unknown[]; path?: string; error?: string }>(
    "/api/models/accuracy-monitor",
  );
}

export function fetchStatus() {
  return api<import("../types").ApiStatus>("/api/status");
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

export type AiProviderId = "github" | "anthropic" | "openai";

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
  anthropic_prepaid_eur?: number | string;
  anthropic_org_id?: string;
  clear_anthropic?: boolean;
  clear_openai?: boolean;
  clear_github?: boolean;
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
  opts?: { force?: boolean; deep?: boolean },
) {
  const params = new URLSearchParams({
    portfolio_only: portfolioOnly ? "1" : "0",
  });
  if (opts?.force) params.set("force", "1");
  if (opts?.deep) params.set("deep", "1");
  return api<{
    started?: boolean;
    message?: string;
    portfolio_only?: boolean;
    force?: boolean;
    deep?: boolean;
  }>(`/api/clinical-pre-cd/refresh?${params}`, { method: "POST" });
}

export function fetchClinicalPreCdStatus() {
  return api<ClinicalPreCdStatus>("/api/clinical-pre-cd/status");
}

export function fetchClinicalFeedRefreshReport() {
  return api<{
    report: Record<string, unknown> | null;
    should_show: boolean;
  }>("/api/clinical-pre-cd/feed-refresh-report", undefined, { timeoutMs: 8_000 });
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
  );
}

const CLINICAL_PRE_CD_SNAPSHOT_FILE = "clinical_pre_cd_enrichment_snapshot.json";

export async function fetchClinicalPreCdSnapshot(): Promise<ClinicalPreCdSnapshot> {
  const { data: local } = await fetchProjectJson<ClinicalPreCdSnapshot>(
    CLINICAL_PRE_CD_SNAPSHOT_FILE,
  );
  if (local?.records?.length) {
    if (await probeApiReachable()) {
      try {
        return await api<ClinicalPreCdSnapshot>("/api/clinical-pre-cd/snapshot", undefined, {
          timeoutMs: 8_000,
        });
      } catch {
        return local;
      }
    }
    return local;
  }

  if (!(await probeApiReachable())) {
    if (local) return local;
    throw new Error(
      `Clinical pre-CD snapshot missing (data/${CLINICAL_PRE_CD_SNAPSHOT_FILE}) — API offline.`,
    );
  }

  return api<ClinicalPreCdSnapshot>("/api/clinical-pre-cd/snapshot", undefined, {
    timeoutMs: 8_000,
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
  time_frame?: string;
  values?: string[];
  p_value_hint?: string;
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

/** Unified timeline row: clinical (AI) or SEC 8-K */
export type ClinicalPublicationEvent = {
  event_date?: string | null;
  event_title?: string;
  /** Clinical / corporate summary (column «Summary dati») */
  summary?: string;
  /** Drug or program badge (column «Drug») */
  drug?: string | null;
  asset?: string;
  source_type?: string;
  /** sec_8k | press_release | cd_milestone | ctgov | congress | publication */
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
    sent_term?: number;
    weights?: { w1?: number; w2?: number; w3?: number; w4?: number };
  } | null;
  /** True se titolo/summary citano società o farmaco del pipeline */
  reference_verified?: boolean;
  /** sec_8k | ctgov | company | drug | company+drug */
  reference_match?: string | null;
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
    steps?: string[];
    eta_min?: string;
    message?: string;
    error?: string;
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

/** Cached health probe — evita ping ripetuti a /api/health per ogni foglio al boot. */
export async function probeApiReachable(timeoutMs = 1_500): Promise<boolean> {
  const now = Date.now();
  if (apiReachCache && now - apiReachCache.at < API_REACH_TTL_MS) {
    return apiReachCache.ok;
  }
  try {
    await api<{ status: string }>("/api/health", undefined, { timeoutMs });
    apiReachCache = { at: now, ok: true };
    return true;
  } catch {
    apiReachCache = { at: now, ok: false };
    return false;
  }
}

async function loadSheetWithFallback(kind: SheetKind) {
  let local: import("../types").SheetTable | null = null;
  try {
    local = await loadLocalSheet(kind);
  } catch {
    /* snapshot assente */
  }

  if (!(await probeApiReachable())) {
    if (local) return local;
    return loadLocalSheet(kind);
  }

  /** Excel via API è più aggiornato del JSON se il refresh ha appena scritto il workbook. */
  try {
    const t = await api<import("../types").SheetTable>(SHEET_API[kind], undefined, {
      timeoutMs: SHEET_API_TIMEOUT_MS,
    });
    if (Array.isArray(t.rows) && t.rows.length > 0 && !t.error) return t;
    if (t.error) throw new Error(t.error);
  } catch {
    /* API lenta / workbook bloccato → snapshot in data/ */
  }
  if (local) return local;
  return loadLocalSheet(kind);
}

/** Fogli: prima snapshot JSON in ``data/``, poi API Excel se mancanti. */
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

export function triggerLiveSignalsRefresh(cdHorizon = 90) {
  return api<{ started?: boolean; running?: boolean; message?: string; error?: string }>(
    `/api/refresh/live-signals?cd_horizon=${cdHorizon}`,
    { method: "POST" }
  );
}

export function fetchLiveSignalsStatus() {
  return api<LiveSignalsStatus>("/api/refresh/live-signals/status");
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

export type RecommendationWeek = {
  week: string;
  n: number;
  buy_n: number;
  buy_win_pct: number | null;
  buy_mean_pnl_pct: number | null;
};

export type TradingWeek = {
  week: string;
  n: number;
  win_pct: number | null;
  mean_pnl_pct: number | null;
  total_eur: number | null;
};

export type RecommendationAction = {
  action: string;
  n: number;
  win_pct: number | null;
  mean_pnl_pct: number | null;
  lift_vs_book_pp: number | null;
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
  prediction?: {
    available?: boolean;
    n_events?: number | null;
    n_sessions?: number | null;
    pre_cd_sign_hit_pct: number | null;
    pre_cd_price_accuracy_pct: number | null;
    benchmark_sign_hit_pct: number | null;
    benchmark_price_accuracy_pct: number | null;
    weekly_delta_pp: number | null;
    weekly_significant?: boolean;
    loops: ChannelLoopEffect[];
    weekly: PredictionWeek[];
    note?: string | null;
  };
  recommendation?: {
    available: boolean;
    n: number;
    book_win_pct: number | null;
    actions: RecommendationAction[];
    weekly: RecommendationWeek[];
    note?: string;
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

let learningLabOverviewInflight: Promise<LearningLabOverview> | null = null;

export function fetchLearningLabOverview(opts?: { force?: boolean }) {
  if (!opts?.force && learningLabOverviewInflight) return learningLabOverviewInflight;
  learningLabOverviewInflight = api<LearningLabOverview>(
    "/api/models/learning-lab/overview",
    undefined,
    { timeoutMs: 120_000 },
  ).finally(() => {
    learningLabOverviewInflight = null;
  });
  return learningLabOverviewInflight;
}

export function previewLearningCycle() {
  return api<LearningCyclePreview>("/api/models/learning-lab/preview", { method: "POST" }, { timeoutMs: 60_000 });
}

export function applyLearningCycle() {
  return api<LearningCyclePreview>(
    "/api/models/learning-lab/apply",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 60_000 },
  );
}

export function resetLearningLab(confirm: boolean) {
  return api<{ ok: boolean; dry_run: boolean }>(
    "/api/models/learning-lab/reset",
    { method: "POST", body: JSON.stringify({ confirm }) },
    { timeoutMs: 30_000 },
  );
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
