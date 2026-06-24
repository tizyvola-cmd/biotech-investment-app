import { api } from "../api/supernova";
import { desktopDataDirHint, fetchProjectJson } from "./projectData";

const SUMMARY_FILE = "accuracy_v4_v5_summary.json";
const MONITOR_FILE = "model_accuracy_monitor_history.json";
const DIR_CALIB_FILE = "accuracy_directional_calibration.json";

export type DirectionalCalibDoc = {
  generated_at?: string;
  schema_version?: number;
  total_records_json?: number;
  records_with_actual?: number;
  records_aff_gt0?: number;
  // Legacy / Raw (tutti i record con affid > 0)
  hit_global?: number | null;
  hit_stabile?: number | null;
  hit_directional?: number | null;
  n_stabile?: number;
  n_directional?: number;
  pct_stabile?: number | null;
  // Nuovi KPI stratificati (schema v2):
  // - useful: affid >= filtro.affid_min, |actual| >= filtro.abs_act_min  (esclude rumore)
  // - strong: idem con filtro magnitudine actual più alto
  useful_hit_pct?: number | null;
  useful_n_directional?: number;
  useful_global_hit_pct?: number | null;
  strong_hit_pct?: number | null;
  strong_n_directional?: number;
  strong_global_hit_pct?: number | null;
  useful_filter?: { affid_min: number; abs_act_min: number };
  strong_filter?: { affid_min: number; abs_act_min: number };
  // Diagnostica rumore data-quality
  noise_zone_n?: number;
  noise_zone_hit_pct?: number | null;
  noise_floor_pct?: number;
  // Coppie matched per orizzonte (T+1 / T+3 / T+5)
  per_horizon?: Record<
    string,
    {
      raw:    { n: number; hits: number; wrong: number; hit_pct: number | null; skipped_no_actual?: number };
      useful: { n: number; hits: number; wrong: number; hit_pct: number | null; skipped_no_actual?: number };
    }
  >;
  by_direction?: Record<string, { n: number; hits: number; wrong?: number; hit_pct: number | null }>;
  calibration_by_aff?: Record<
    string,
    { n_total: number; hit_pct: number | null; n_directional: number; hit_pct_directional: number | null }
  >;
};

export async function loadDirectionalCalibDoc(): Promise<{
  doc: DirectionalCalibDoc | null;
  error?: string;
}> {
  const { data } = await fetchProjectJson<DirectionalCalibDoc>(DIR_CALIB_FILE);
  if (data && (data.hit_global != null || data.useful_hit_pct != null || data.hit_directional != null)) {
    return { doc: data };
  }
  return { doc: null, error: `File assente (${DIR_CALIB_FILE}). Esegui scripts/_build_directional_calibration.py.` };
}

export type AccuracySummaryDoc = {
  history?: unknown[];
  latest?: Record<string, unknown>;
};

export type AccuracyMonitorDoc = {
  schema_version?: number;
  entries?: unknown[];
  error?: string;
};

export async function loadAccuracySummaryDocument(): Promise<{
  doc: AccuracySummaryDoc | null;
  source: string;
  error?: string;
}> {
  const { data, detail } = await fetchProjectJson<AccuracySummaryDoc>(SUMMARY_FILE);
  if (data && (Array.isArray(data.history) || data.latest)) {
    return { doc: data, source: `locale (${SUMMARY_FILE})` };
  }

  try {
    const res = await api<{ summary?: AccuracySummaryDoc | null; error?: string }>(
      "/api/sheets/accuracy/v4-v5-summary"
    );
    if (res.summary && (Array.isArray(res.summary.history) || res.summary.latest)) {
      return { doc: res.summary, source: "API /api/sheets/accuracy/v4-v5-summary" };
    }
    if (res.error) {
      return { doc: null, source: "", error: res.error };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      doc: null,
      source: "",
      error: `${msg} — esegui refresh Accuracy o API :8765. Cartella: ${desktopDataDirHint()}`,
    };
  }

  return {
    doc: null,
    source: "",
    error:
      detail ||
      `File assente (${SUMMARY_FILE}). Serve almeno un refresh Accuracy con metriche v4/v5.`,
  };
}

export type AccuracyMonitorRunResult = {
  ok: boolean;
  error?: string;
  trigger?: string;
  n_restricted?: number;
  n_eligible?: number;
  entries_before?: number;
  entries_after?: number;
  snapshot?: Record<string, unknown>;
  sheet_written?: boolean;
  sheet_error?: string;
  enrich_warning?: string;
};

/** Accoda uno snapshot al monitor (test manuale dalla UI). */
export async function runAccuracyMonitorSnapshot(options?: {
  trigger?: string;
  writeSheet?: boolean;
}): Promise<AccuracyMonitorRunResult> {
  return api<AccuracyMonitorRunResult>("/api/models/accuracy-monitor/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trigger: options?.trigger ?? "manual_ui",
      write_sheet: options?.writeSheet ?? true,
    }),
  });
}

export async function loadAccuracyMonitorDocument(options?: {
  /** Dopo un run manuale: legge dall'API (evita cache locale stale). */
  preferApi?: boolean;
}): Promise<{
  doc: AccuracyMonitorDoc | null;
  source: string;
  error?: string;
}> {
  const loadFromApi = async (): Promise<{
    doc: AccuracyMonitorDoc | null;
    source: string;
    error?: string;
  } | null> => {
    try {
      const res = await api<AccuracyMonitorDoc & { error?: string }>(
        `/api/models/accuracy-monitor?_t=${Date.now()}`
      );
      if (Array.isArray(res.entries)) {
        return { doc: res, source: "API /api/models/accuracy-monitor" };
      }
      if (res.error) {
        return { doc: null, source: "", error: res.error };
      }
    } catch {
      /* fallback sotto */
    }
    return null;
  };

  if (options?.preferApi) {
    const fromApi = await loadFromApi();
    if (fromApi?.doc) return fromApi;
  }

  const { data, detail } = await fetchProjectJson<AccuracyMonitorDoc>(
    `${MONITOR_FILE}?_t=${Date.now()}`
  );
  if (data && Array.isArray(data.entries)) {
    return { doc: data, source: `locale (${MONITOR_FILE})` };
  }

  const fromApi = await loadFromApi();
  if (fromApi) {
    if (fromApi.doc) return fromApi;
    if (fromApi.error) return fromApi;
  }

  return {
    doc: null,
    source: "",
    error:
      (detail
        ? `${detail} — snapshot monitor assente. Cartella: ${desktopDataDirHint()}`
        : undefined) ||
      `File assente (${MONITOR_FILE}). Esegui orchestrator con snapshot monitor o scripts/accuracy_monitor_snapshot.py.`,
  };
}

// ── KPI Signal Analysis ───────────────────────────────────────────────────────

export type KpiSignalRecord = {
  ticker: string;
  cd_date: string;
  is_past: boolean;
  n_inds: number;
  shift_old_pp: number;
  shift_new_pp: number;
  delta_pp: number;
  n_pvalue: number;
  n_maturity: number;
  n_soc: number;
  n_kpitype: number;
  is_rich: boolean;
};

export type KpiSignalAnalysis = {
  generated_at?: string;
  n_enriched: number;
  n_past_cd: number;
  n_future_cd: number;
  n_rich_records: number;
  mean_shift_old_pp: number;
  mean_shift_new_pp: number;
  mean_delta_pp: number;
  n_improved: number;
  n_unchanged: number;
  n_worsened: number;
  total_inds: number;
  n_pvalue: number;
  n_maturity: number;
  n_soc: number;
  n_kpitype: number;
  coverage_pct: number;
  records: KpiSignalRecord[];
};

export async function loadKpiSignalAnalysis(): Promise<KpiSignalAnalysis | null> {
  try {
    const res = await api<KpiSignalAnalysis>("/api/models/kpi-signal-analysis");
    if (res && res.n_enriched != null) return res;
  } catch {
    // fall through
  }
  return null;
}
