/** Campi normalizzati da una riga del foglio Financial (API / Excel). */
export type FinancialRowNorm = {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  currentPrice: number | null;
  beta: number | null;
  liquidita: string;
  dailyChangePct: number | null;
  variation3m: number | null;
  raw: Record<string, unknown>;
};

export function normFinancialRow(row: Record<string, unknown>): FinancialRowNorm | null {
  const symbol = String(row.symbol ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!symbol) return null;

  return {
    symbol,
    companyName: String(row.companyName ?? row.name ?? "").trim(),
    sector: String(row.sector ?? "").trim() || "Non classificato",
    industry: String(row.industry ?? "").trim(),
    marketCap: toNum(row.marketCap),
    currentPrice: toNum(row.currentPrice ?? row.last_close),
    beta: toNum(row.beta),
    liquidita: String(row.liquidita_fy ?? "").trim(),
    dailyChangePct: toNum(row["dailyChange_%"]),
    variation3m: toNum(row["variation_3m_%_variations"]),
    raw: row,
  };
}

export function normFinancialRows(rows: Record<string, unknown>[]): FinancialRowNorm[] {
  const out: FinancialRowNorm[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const n = normFinancialRow(r);
    if (!n || seen.has(n.symbol)) continue;
    seen.add(n.symbol);
    out.push(n);
  }
  return out;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || v === "—" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatMarketCap(n: number | null): string {
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatPct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export type CapTierId = "mega" | "large" | "mid" | "small" | "micro" | "unknown";

export function capTierFromMarketCap(mc: number | null): CapTierId {
  if (mc === null || mc <= 0) return "unknown";
  if (mc >= 200e9) return "mega";
  if (mc >= 10e9) return "large";
  if (mc >= 2e9) return "mid";
  if (mc >= 300e6) return "small";
  return "micro";
}

export const CAP_TIER_LABELS: Record<CapTierId, string> = {
  mega: "Mega cap (≥200B)",
  large: "Large cap (10B–200B)",
  mid: "Mid cap (2B–10B)",
  small: "Small cap (300M–2B)",
  micro: "Micro cap (<300M)",
  unknown: "Cap. n/d",
};
