import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

/** Same % scale as Simulation sheet / P&L tab (fraction 0.15 → 15%, fix Excel ×100 bugs). */
export function normalizeSimPnlPct(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (Math.abs(raw) <= 1.5) return raw * 100;
  if (Math.abs(raw) > 150 && Math.abs(raw) < 50_000) return raw / 100;
  if (Math.abs(raw) >= 50_000) return null;
  return raw;
}

export function realizedPnlEurFromOutcome(r: SimOutcomeRow): number | null {
  const eur = r.exit_pnl_eur_at_event ?? r.pnl_eur;
  if (eur == null || !Number.isFinite(eur)) return null;
  if (Math.abs(eur) >= 5_000_000) return null;
  return eur;
}

/** Realized P&L % for closed positions (charts + KPIs). */
export function realizedPnlPctFromOutcome(r: SimOutcomeRow): number | null {
  const direct = normalizeSimPnlPct(r.exit_pnl_pct_at_event ?? r.pnl_pct);
  if (direct != null && Math.abs(direct) <= 150) return direct;
  const cap = r.capital_eur;
  const eur = realizedPnlEurFromOutcome(r);
  if (cap > 0 && eur != null) {
    return Math.round((eur / cap) * 10000) / 100;
  }
  return direct != null && Math.abs(direct) <= 150 ? direct : null;
}
