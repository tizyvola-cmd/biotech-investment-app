/**
 * Union closed round-trips from investment_sim_outcomes + real portfolio sells.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type {
  InvestSimHistoryPoint,
  InvestSimInputEntry,
  InvestSimInputs,
} from "./investSimStorage";

export type ClosedDealCorrelationSource = "simloop" | "portfolio";

export type MergedClosedDealRow = SimOutcomeRow & {
  correlationSource: ClosedDealCorrelationSource;
};

function isClosedOutcome(r: SimOutcomeRow): boolean {
  if (typeof r.decision_current_open === "boolean") return !r.decision_current_open;
  if (r.exit_ts) return true;
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function pickNewerClosed(a: SimOutcomeRow, b: SimOutcomeRow): SimOutcomeRow {
  const aTs = Date.parse(a.exit_ts ?? "");
  const bTs = Date.parse(b.exit_ts ?? "");
  if (Number.isFinite(aTs) && Number.isFinite(bTs)) return aTs >= bTs ? a : b;
  return (a.pnl_pct ?? -1e9) >= (b.pnl_pct ?? -1e9) ? a : b;
}

function sourceFromOutcomeRow(r: SimOutcomeRow): ClosedDealCorrelationSource {
  const u = String(r.universe ?? "").toLowerCase();
  if (u === "portfolio" || u === "real") return "portfolio";
  return "simloop";
}

function pnlFromPortfolioSell(
  key: string,
  entry: InvestSimInputEntry,
  history: InvestSimHistoryPoint[],
): { pnlPct: number; pnlEur: number | null; capitalEur: number } | null {
  let capitalEur =
    entry.closedCapital != null && entry.closedCapital > 0 ? entry.closedCapital : 0;
  let pnlPct: number | null = null;
  let pnlEur: number | null =
    entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)
      ? entry.closedPnlEur
      : null;

  if (capitalEur > 0 && entry.closedValue != null && Number.isFinite(entry.closedValue)) {
    pnlPct = ((entry.closedValue - capitalEur) / capitalEur) * 100;
    if (pnlEur == null) pnlEur = entry.closedValue - capitalEur;
  } else if (pnlEur != null && capitalEur > 0) {
    pnlPct = (pnlEur / capitalEur) * 100;
  } else {
    const snaps = history
      .filter((h) => h.byTicker?.[key] != null)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    const beforeSale = entry.soldAt ? snaps.filter((h) => h.ts <= entry.soldAt!) : snaps;
    const snap = (beforeSale[0] ?? snaps[0])?.byTicker?.[key];
    if (snap?.pnlPct != null && Number.isFinite(snap.pnlPct)) {
      pnlPct = snap.pnlPct;
      pnlEur = snap.pnl ?? null;
      if (capitalEur <= 0 && snap.value != null && snap.pnl != null) {
        const entryVal = snap.value - snap.pnl;
        if (entryVal > 0) capitalEur = entryVal;
      }
    }
  }

  if (pnlPct == null || !Number.isFinite(pnlPct)) return null;
  return { pnlPct, pnlEur, capitalEur: capitalEur > 0 ? capitalEur : 0 };
}

function portfolioSellToOutcomeRow(
  rowKey: string,
  entry: InvestSimInputEntry,
  history: InvestSimHistoryPoint[],
): MergedClosedDealRow | null {
  const pnl = pnlFromPortfolioSell(rowKey, entry, history);
  if (!pnl) return null;

  const parts = rowKey.split("|");
  const ticker = (parts[0] ?? rowKey).trim().toUpperCase();
  const completionDate = parts[1] ?? "";

  const aff = entry.entryProbPct ?? null;

  return {
    row_key: rowKey,
    ticker,
    completion_date: completionDate,
    days_to_cd: null,
    cd_passed: false,
    timing_bucket: "",
    timing_label: "",
    capital_eur: pnl.capitalEur,
    buy_price_usd: entry.buyPrice ?? 0,
    pnl_eur: pnl.pnlEur,
    pnl_pct: pnl.pnlPct,
    outcome: pnl.pnlPct >= 0 ? "win" : "loss",
    outcome_label: "",
    is_win: pnl.pnlPct >= 0,
    affidabilita_pct: aff,
    pred7_pp: null,
    pred_direction_hit: null,
    entry_ts: entry.investedAt ?? null,
    entry_affidabilita_pct: aff,
    exit_ts: entry.soldAt ?? null,
    exit_pnl_pct_at_event: pnl.pnlPct,
    exit_pnl_eur_at_event: pnl.pnlEur,
    decision_current_open: false,
    universe: "portfolio",
    correlationSource: "portfolio",
  };
}

/**
 * Closed deals for correlation: sim-loop outcomes + portfolio sells missing from outcomes.
 * Dedupes by row_key; outcomes win over synthetic portfolio rows when both exist.
 */
export function mergePortfolioAndSimLoopClosedDeals(args: {
  simOutcomeRows: SimOutcomeRow[];
  investInputs?: InvestSimInputs | null;
  investHistory?: InvestSimHistoryPoint[] | null;
}): MergedClosedDealRow[] {
  const byKey = new Map<string, MergedClosedDealRow>();

  for (const r of args.simOutcomeRows.filter(isClosedOutcome)) {
    const key = r.row_key ?? `${r.ticker}|${r.completion_date ?? ""}`;
    const tagged: MergedClosedDealRow = {
      ...r,
      correlationSource: sourceFromOutcomeRow(r),
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, tagged);
      continue;
    }
    const picked = pickNewerClosed(prev, r);
    byKey.set(key, {
      ...picked,
      correlationSource: sourceFromOutcomeRow(picked),
    });
  }

  const history = args.investHistory ?? [];
  for (const [key, entry] of Object.entries(args.investInputs ?? {})) {
    if (!entry?.soldAt) continue;
    if (entry.universe === "simloop") continue;
    if (byKey.has(key)) continue;
    const row = portfolioSellToOutcomeRow(key, entry, history);
    if (row) byKey.set(key, row);
  }

  return [...byKey.values()];
}
