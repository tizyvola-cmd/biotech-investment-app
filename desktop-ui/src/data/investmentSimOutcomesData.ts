import {
  rebuildInvestmentSimOutcomes,
  saveInvestSimInputsPersisted,
} from "../api/investSim";
import { api } from "../api/supernova";
import { applyTradeCalibDoc, type TradeCalibDoc } from "../sheet/investmentTradeCalib";
import { loadInvestSimInputs, type InvestSimInputs } from "../sheet/investSimStorage";
import { fetchProjectJson } from "./projectData";

const OUTCOMES_FILE = "investment_sim_outcomes.json";

export type SimOutcomeProtocol = {
  title?: string;
  position_rule?: string;
  outcome_rules?: string[];
  timing_buckets?: string[];
  metrics?: string[];
};

export type SimAffQuintile = {
  quintile: number;
  label: string;
  n: number;
  aff_min: number;
  aff_max: number;
  mean_pnl_eur: number | null;
  win_rate_pct: number | null;
};

export type SimSegment = {
  label: string;
  n_positions: number;
  win_rate_pct: number | null;
  total_pnl_eur: number | null;
  mean_pnl_eur: number | null;
  mean_pnl_pct: number | null;
  hit_pred_pct: number | null;
};

export type SimSegmentGroup = {
  id: string;
  title: string;
  segments: SimSegment[];
};

export type SimOutcomeRow = {
  row_key: string;
  ticker: string;
  completion_date: string;
  days_to_cd: number | null;
  cd_passed: boolean;
  timing_bucket: string;
  timing_label: string;
  capital_eur: number;
  buy_price_usd: number;
  pnl_eur: number | null;
  pnl_pct: number | null;
  outcome: string;
  outcome_label: string;
  is_win: boolean;
  affidabilita_pct: number | null;
  pred7_pp: number | null;
  pred_direction_hit: boolean | null;
  // ── Slope dalla libreria storica (popolato da Python) ─────────────────────
  // latest_*: snapshot più recente del ticker (qualsiasi CD/offset).
  //   Usato come "slope corrente" per il verdetto exit su posizioni aperte
  //   e per il scatter "slope vs P&L".
  // pre_cd_*: slope all'offset T-1 (preferito) della CD di QUESTA posizione.
  //   Disponibile solo se il histlib ha già snapshot pre-evento; tipicamente
  //   nullo per posizioni con CD futura.
  latest_slope_5d?: number | null;
  latest_slope_20d?: number | null;
  latest_run_up_30d?: number | null;
  latest_slope_asof?: string | null;
  latest_slope_source?: string | null;
  pre_cd_slope_5d?: number | null;
  pre_cd_slope_20d?: number | null;
  pre_cd_run_up_30d?: number | null;
  pre_cd_slope_offset?: string | null;
  // ── Decision log (snapshot reale entry/exit) ──────────────────────────────
  // Popolati da prediction.investment_decision_log: tracking event-driven
  // dello stato esatto al momento in cui hai aperto/chiuso la posizione.
  // Preferiti su pre_cd_*/latest_* perché legati alla decisione reale.
  entry_ts?: string | null;
  entry_slope_5d?: number | null;
  entry_slope_20d?: number | null;
  entry_run_up_30d?: number | null;
  entry_pred5_pp?: number | null;
  entry_pred7_pp?: number | null;
  entry_affidabilita_pct?: number | null;
  entry_r2_fit?: number | null;
  entry_buy_price_usd?: number | null;
  /** True se al primo run il log non esisteva: l'entry è "retroattivo" con i dati di oggi (proxy). */
  entry_was_existing?: boolean;
  exit_ts?: string | null;
  exit_current_price_usd?: number | null;
  exit_slope_5d?: number | null;
  exit_slope_20d?: number | null;
  exit_run_up_30d?: number | null;
  exit_pnl_pct_at_event?: number | null;
  exit_pnl_eur_at_event?: number | null;
  exit_reason?: string | null;
  holding_days?: number | null;
  buy_signal_suggested?: boolean;
  buy_signal_basis_slope_20d?: number | null;
  buy_signal_result?: "success" | "failure" | "flat" | "pending" | "not_applicable";
  sell_signal_suggested?: boolean;
  sell_signal_basis_slope_20d?: number | null;
  sell_signal_after_move_pct?: number | null;
  sell_signal_result?: "success" | "failure" | "flat" | "pending" | "not_applicable";
  decision_cycles_count?: number;
  decision_current_open?: boolean;
};

export type SimTradeCalibration = {
  calibration_reliable?: boolean;
  n_positions?: number;
  thresholds?: Record<
    string,
    { value: number; default: number; reliable?: boolean; win_rate_pct?: number | null; n?: number }
  >;
};

export type SimOutcomesDoc = {
  schema_version?: number;
  generated_at?: string;
  source?: string;
  protocol?: SimOutcomeProtocol;
  summary?: {
    n_positions?: number;
    n_closed?: number;
    n_open?: number;
    win_rate_pct?: number | null;
    win_rate_closed_pct?: number | null;
    total_capital_eur?: number | null;
    total_pnl_eur?: number | null;
    mean_pnl_eur?: number | null;
    hit_pred_direction_pct?: number | null;
  };
  aff_quintiles?: SimAffQuintile[];
  segment_groups?: SimSegmentGroup[];
  trade_calibration?: SimTradeCalibration;
  rows?: SimOutcomeRow[];
  error?: string;
};

export async function loadInvestmentSimOutcomes(opts?: {
  rebuild?: boolean;
  /** Sincronizza inputs UI su disco prima del rebuild (evita dati stale tipo vecchio ANIK). */
  syncInputs?: InvestSimInputs;
}): Promise<{
  doc: SimOutcomesDoc | null;
  source: string;
  error?: string;
}> {
  let rebuildWarning: string | undefined;
  if (opts?.rebuild) {
    try {
      const toSync = opts.syncInputs ?? loadInvestSimInputs();
      await saveInvestSimInputsPersisted(toSync);
      await rebuildInvestmentSimOutcomes();
    } catch (e) {
      rebuildWarning =
        e instanceof Error ? e.message : String(e);
    }
  }

  try {
    const res = await api<SimOutcomesDoc & { error?: string }>("/api/investment/sim-outcomes");
    if (Array.isArray(res.rows)) {
      if (res.trade_calibration?.thresholds) {
        applyTradeCalibDoc(res.trade_calibration as TradeCalibDoc);
      }
      return {
        doc: res,
        source: opts?.rebuild
          ? "rigenerato (invest_sim_inputs + snapshot Simulation)"
          : "API /api/investment/sim-outcomes",
        error: rebuildWarning
          ? `Rigenerazione non disponibile (${rebuildWarning}); dati dall'ultimo snapshot.`
          : undefined,
      };
    }
    if (res.error) {
      return { doc: null, source: "", error: res.error };
    }
  } catch {
    /* fallback file locale */
  }

  const { data, detail } = await fetchProjectJson<SimOutcomesDoc>(OUTCOMES_FILE);
  if (data && Array.isArray(data.rows)) {
    return {
      doc: data,
      source: `locale (${OUTCOMES_FILE})`,
      error: rebuildWarning
        ? `Rigenerazione non disponibile (${rebuildWarning}); dati dall'ultimo file locale.`
        : undefined,
    };
  }

  return {
    doc: null,
    source: "",
    error:
      rebuildWarning ||
      detail ||
      `File missing (${OUTCOMES_FILE}). Set capital in Investment, then Reload in Decision Lab.`,
  };
}

export function isSimOutcomeOpen(r: SimOutcomeRow): boolean {
  if (typeof r.decision_current_open === "boolean") return r.decision_current_open;
  if (!r.exit_ts) return true;
  return false;
}

/** One row per position key — keep latest exit when the log has duplicate closes. */
export function dedupeClosedSimOutcomeRows(rows: SimOutcomeRow[]): SimOutcomeRow[] {
  const closed = rows.filter((r) => !isSimOutcomeOpen(r));
  const byKey = new Map<string, SimOutcomeRow>();
  for (const r of closed) {
    const prev = byKey.get(r.row_key);
    if (!prev) {
      byKey.set(r.row_key, r);
      continue;
    }
    const aTs = Date.parse(r.exit_ts ?? "");
    const bTs = Date.parse(prev.exit_ts ?? "");
    const pick =
      Number.isFinite(aTs) && Number.isFinite(bTs)
        ? aTs > bTs
        : (r.pnl_pct ?? -1e9) > (prev.pnl_pct ?? -1e9);
    if (pick) byKey.set(r.row_key, r);
  }
  return [...byKey.values()];
}

export function closedSimOutcomeRowsFromDoc(doc: SimOutcomesDoc | null | undefined): SimOutcomeRow[] {
  return dedupeClosedSimOutcomeRows(doc?.rows ?? []);
}
