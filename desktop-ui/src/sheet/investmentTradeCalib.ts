/**
 * Soglie buy/sell tarate dai trade Simulation (Fase B).
 * Fonte: data/investment_trade_calib.json via API.
 */
import { api } from "../api/supernova";
import { fetchProjectJson } from "../data/projectData";

const CALIB_FILE = "investment_trade_calib.json";

export type TradeCalibThreshold = {
  value: number;
  default: number;
  reliable?: boolean;
  n?: number;
  win_rate_pct?: number | null;
  note?: string;
};

export type TradeCalibDoc = {
  schema_version?: number;
  generated_at?: string;
  calibration_reliable?: boolean;
  n_positions?: number;
  n_buy_cases?: number;
  n_sell_cases?: number;
  thresholds?: Record<string, TradeCalibThreshold>;
  note?: string;
  error?: string;
};

/** Default allineati a prediction/investment_trade_calib.DEFAULTS */
export const TRADE_CALIB_DEFAULTS = {
  buy_slope20d_min_pp_per_day: 0.1,
  sell_slope20d_max_pp_per_day: -0.3,
  slope_significant_pp_per_day: 0.3,
  slope_flat_pp_per_day: 0.1,
  pred_significant_pp: 0.5,
  score_forte_min: 50,
  score_watch_min: 35,
  score_monitor_min: 22,
  affid_min_pct_for_quality: 40,
  expected_hit_min_pct: 70,
  dynamic_slope_flat_pp_per_day: 0.05,
} as const;

let cachedDoc: TradeCalibDoc | null = null;

function thresholdValue(doc: TradeCalibDoc | null, key: keyof typeof TRADE_CALIB_DEFAULTS): number {
  const th = doc?.thresholds?.[key];
  if (th != null && Number.isFinite(th.value)) return th.value;
  return TRADE_CALIB_DEFAULTS[key];
}

export function applyTradeCalibDoc(doc: TradeCalibDoc | null): void {
  cachedDoc = doc;
}

export function getTradeCalibDoc(): TradeCalibDoc | null {
  return cachedDoc;
}

export function tradeCalibThreshold(key: keyof typeof TRADE_CALIB_DEFAULTS): number {
  return thresholdValue(cachedDoc, key);
}

export function tradeCalibSummary(): string | null {
  const d = cachedDoc;
  if (!d?.thresholds) return null;
  const buy = d.thresholds.buy_slope20d_min_pp_per_day;
  const sell = d.thresholds.sell_slope20d_max_pp_per_day;
  if (!d.calibration_reliable && !buy?.reliable && !sell?.reliable) {
    return null;
  }
  const n = d.n_positions ?? 0;
  const b = buy?.value ?? TRADE_CALIB_DEFAULTS.buy_slope20d_min_pp_per_day;
  const s = sell?.value ?? TRADE_CALIB_DEFAULTS.sell_slope20d_max_pp_per_day;
  return `Trade-calib · ${n} pos. · BUY slope≥${b} · SELL slope≤${s}`;
}

export async function loadInvestmentTradeCalib(): Promise<{
  doc: TradeCalibDoc | null;
  source: string;
}> {
  try {
    const res = await api<TradeCalibDoc>("/api/investment/trade-calib");
    if (res.thresholds) {
      applyTradeCalibDoc(res);
      return { doc: res, source: "API /api/investment/trade-calib" };
    }
  } catch {
    /* fallback file */
  }
  const { data } = await fetchProjectJson<TradeCalibDoc>(CALIB_FILE);
  if (data?.thresholds) {
    applyTradeCalibDoc(data);
    return { doc: data, source: `locale (${CALIB_FILE})` };
  }
  applyTradeCalibDoc(null);
  return { doc: null, source: "" };
}
