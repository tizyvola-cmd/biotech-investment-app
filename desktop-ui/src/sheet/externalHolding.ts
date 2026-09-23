import { daysFromToday } from "./simulationPlanGain";
import { currentPriceFromRow, rowHasActivePortfolio } from "./simulationPosition";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";

export type ExternalHoldingDraft = {
  ticker: string;
  capitalEur: number;
  buyPriceUsd?: number | null;
  purchaseDate?: string | null;
};

export type ExternalHoldingFail =
  | "empty_ticker"
  | "bad_capital"
  | "not_in_universe"
  | "already_open"
  | "no_price"
  | "bad_date"
  | "persist";

export type ExternalHoldingReady = {
  ok: true;
  key: string;
  ticker: string;
  row: Record<string, unknown>;
  capitalEur: number;
  buyPrice: number;
  purchaseDate?: string;
  investedAt: string;
};

export type ExternalHoldingCheck = ExternalHoldingReady | { ok: false; reason: ExternalHoldingFail };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeHoldingTicker(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

/** Prefer the soonest future CD; else the most recent past CD. */
export function pickCanonicalSimRowForTicker(
  rows: Record<string, unknown>[],
  ticker: string,
): Record<string, unknown> | null {
  const tk = normalizeHoldingTicker(ticker);
  if (!tk || tk.includes("TOTALE")) return null;
  const matches = rows.filter((r) => {
    const rowTk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    return rowTk === tk && !rowTk.includes("TOTALE");
  });
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  const scored = matches.map((r) => {
    const cd = String(r["Completion Date"] ?? "");
    return { r, days: daysFromToday(cd) };
  });
  const future = scored.filter((s) => s.days != null && s.days >= 0);
  if (future.length) {
    future.sort((a, b) => (a.days ?? 9_999) - (b.days ?? 9_999));
    return future[0]!.r;
  }
  const past = scored.filter((s) => s.days != null && s.days < 0);
  if (past.length) {
    past.sort((a, b) => (b.days ?? -9_999) - (a.days ?? -9_999));
    return past[0]!.r;
  }
  return matches[0]!;
}

function investedAtFromPurchaseDate(date: string): string {
  return `${date}T12:00:00.000Z`;
}

/**
 * Validate a manual external holding against the Simulation universe.
 * Does not apply Soft BUY gates or experiment cash — the trade already happened elsewhere.
 */
export function prepareExternalHolding(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
  draft: ExternalHoldingDraft,
): ExternalHoldingCheck {
  const ticker = normalizeHoldingTicker(draft.ticker);
  if (!ticker) return { ok: false, reason: "empty_ticker" };

  const capitalEur = Math.round(draft.capitalEur);
  if (!Number.isFinite(capitalEur) || capitalEur < 1) {
    return { ok: false, reason: "bad_capital" };
  }

  const purchaseDate = draft.purchaseDate?.trim() || "";
  if (purchaseDate && !DATE_RE.test(purchaseDate)) {
    return { ok: false, reason: "bad_date" };
  }

  const row = pickCanonicalSimRowForTicker(rows, ticker);
  if (!row) return { ok: false, reason: "not_in_universe" };

  // Same definition as Pulse Open Positions — leftover ghost capital after a
  // company sell must not block a Dashboard re-add.
  if (rowHasActivePortfolio(row, inputs)) {
    return { ok: false, reason: "already_open" };
  }

  const spot = currentPriceFromRow(row);
  const typed = draft.buyPriceUsd;
  const buyPrice =
    typed != null && Number.isFinite(typed) && typed > 0 ? typed : (spot ?? 0);
  if (!(buyPrice > 0)) return { ok: false, reason: "no_price" };

  const cd = row["Completion Date"];
  const key = normalizedRowKey(ticker, cd);
  const investedAt = purchaseDate
    ? investedAtFromPurchaseDate(purchaseDate)
    : new Date().toISOString();

  return {
    ok: true,
    key,
    ticker,
    row,
    capitalEur,
    buyPrice,
    ...(purchaseDate ? { purchaseDate } : {}),
    investedAt,
  };
}

export { bookMarkToMarket } from "./bookMarkToMarket";
