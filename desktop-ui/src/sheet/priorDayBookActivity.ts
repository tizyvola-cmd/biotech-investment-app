/**
 * Prior calendar-day portfolio buys / sells for the Home dismissible recap.
 * Sells also include closes from today. A name that was bought and then
 * sold in this window appears only under Sold (not both columns).
 *
 * Warrant + common (JSPRW / JSPR) are one company — display the common once.
 */
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import {
  positionPnlForOpenRow,
  warrantCommonTicker,
} from "./simulationPosition";

export type PriorDayBookSide = "buy" | "sell";

export type PriorDayBookActivityItem = {
  key: string;
  ticker: string;
  side: PriorDayBookSide;
  /** Realized P&L € on sells; open/closed MTM P&L since entry on buys. */
  pnlEur: number | null;
  /** € size of the position (invested capital) — not a gain. */
  capitalEur: number | null;
  atIso: string;
};

export type PriorDayBookActivity = {
  dayKey: string;
  /** Calendar day for "today" sells included in the Sold column. */
  todayKey: string;
  buys: PriorDayBookActivityItem[];
  sells: PriorDayBookActivityItem[];
};

export function calendarDayKeyFromDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function priorCalendarDayKey(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return calendarDayKeyFromDate(d);
}

function dayKeyFromIso(iso: string | undefined | null): string | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
    return m ? m[1]! : null;
  }
  return calendarDayKeyFromDate(new Date(t));
}

function tickerFromKey(key: string): string {
  const tk = key.split("|")[0]?.trim().toUpperCase() ?? "";
  return tk || key;
}

/** Jasper Therapeutics: JSPRW → JSPR (one company in the recap). */
export function priorDayCompanyTicker(ticker: string): string {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return tk;
  return warrantCommonTicker(tk) ?? tk;
}

function companyFromKey(key: string): string {
  return priorDayCompanyTicker(tickerFromKey(key));
}

function siblingKeysForCompany(
  inputs: InvestSimInputs,
  company: string,
): string[] {
  const out: string[] = [];
  for (const key of Object.keys(inputs)) {
    if (companyFromKey(key) === company) out.push(key);
  }
  return out;
}

/** True open date for the company — earliest among warrant/common sibling keys. */
function earliestCompanyInvestedAt(
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[] | null | undefined,
  company: string,
): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const key of siblingKeysForCompany(inputs, company)) {
    const e = inputs[key];
    if (!e) continue;
    const at =
      resolveInvestedAt(key, e, history ?? []) ?? e.investedAt ?? null;
    if (!at?.trim()) continue;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = at;
    }
  }
  return best;
}

/** Earliest history ts where the key appears (open mark). */
function firstHistoryTsForKey(
  history: InvestSimHistoryPoint[] | null | undefined,
  key: string,
): string | null {
  if (!history?.length) return null;
  for (const h of history) {
    if (h.byTicker?.[key] != null) return h.ts;
  }
  return null;
}

/** Earliest first-seen across warrant/common siblings. */
function earliestCompanyHistoryTs(
  history: InvestSimHistoryPoint[] | null | undefined,
  inputs: InvestSimInputs,
  company: string,
): string | null {
  let best: string | null = null;
  let bestMs = Infinity;
  for (const key of siblingKeysForCompany(inputs, company)) {
    const ts = firstHistoryTsForKey(history, key);
    if (!ts) continue;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = ts;
    }
  }
  return best;
}

/**
 * Keep one row per company: prefer real closed PnL over a flat alias twin
 * (JSPR €0 vs JSPRW +€120 → keep the warrant leg, label as JSPR).
 */
function preferCompanyActivityItem(
  a: PriorDayBookActivityItem,
  b: PriorDayBookActivityItem,
): PriorDayBookActivityItem {
  const company = priorDayCompanyTicker(a.ticker) || priorDayCompanyTicker(b.ticker);
  const aAbs =
    a.pnlEur != null && Number.isFinite(a.pnlEur) ? Math.abs(a.pnlEur) : -1;
  const bAbs =
    b.pnlEur != null && Number.isFinite(b.pnlEur) ? Math.abs(b.pnlEur) : -1;
  let winner = a;
  if (bAbs > aAbs) winner = b;
  else if (bAbs === aAbs) {
    const aW = warrantCommonTicker(tickerFromKey(a.key)) != null;
    const bW = warrantCommonTicker(tickerFromKey(b.key)) != null;
    if (bW && !aW) winner = b;
  }
  return { ...winner, ticker: company || winner.ticker };
}

function upsertCompanyItem(
  map: Map<string, PriorDayBookActivityItem>,
  item: PriorDayBookActivityItem,
): void {
  const company = priorDayCompanyTicker(item.ticker);
  const next = { ...item, ticker: company };
  const prev = map.get(company);
  map.set(company, prev ? preferCompanyActivityItem(prev, next) : next);
}

/** Latest open mark P&L for a key (fallback when sheet row missing). */
function latestHistoryPnlEur(
  history: InvestSimHistoryPoint[] | null | undefined,
  key: string,
): number | null {
  if (!history?.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const snap = history[i]?.byTicker?.[key];
    if (snap != null && Number.isFinite(snap.pnl)) {
      return Math.round(snap.pnl * 100) / 100;
    }
  }
  return null;
}

function openBuyPnlEur(
  key: string,
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[] | null,
  rowByKey: Map<string, Record<string, unknown>> | null,
): number | null {
  const row = rowByKey?.get(key);
  if (row) {
    const m = positionPnlForOpenRow(row, inputs, history);
    if (m.pnlEur != null && Number.isFinite(m.pnlEur)) return m.pnlEur;
  }
  return latestHistoryPnlEur(history, key);
}

function closedCapitalEur(e: {
  closedCapital?: number;
  capital: number;
}): number | null {
  if (e.closedCapital != null && e.closedCapital > 0) return e.closedCapital;
  if (e.capital > 0) return e.capital;
  return null;
}

function closedPnlEur(e: { closedPnlEur?: number }): number | null {
  if (e.closedPnlEur != null && Number.isFinite(e.closedPnlEur)) {
    return Math.round(e.closedPnlEur * 100) / 100;
  }
  return null;
}

export function buildPriorDayBookActivity(
  inputs: InvestSimInputs,
  dayKey: string = priorCalendarDayKey(),
  history: InvestSimHistoryPoint[] | null = null,
  simRows: Record<string, unknown>[] | null = null,
  now: Date = new Date(),
): PriorDayBookActivity {
  const todayKey = calendarDayKeyFromDate(now);
  /** Company ticker → one buy / one sell (warrant+common collapsed). */
  const buysByCompany = new Map<string, PriorDayBookActivityItem>();
  const sellsByCompany = new Map<string, PriorDayBookActivityItem>();
  const rowByKey = simRows?.length ? buildSimRowByKeyMap(simRows) : null;
  const companiesSeen = new Set<string>();

  for (const [key, e] of Object.entries(inputs)) {
    if (!e) continue;
    const company = companyFromKey(key);
    companiesSeen.add(company);

    if (e.ignoreSheet && e.soldAt) {
      const soldDay = dayKeyFromIso(e.soldAt);
      // Prior-day closes + today's closes (so a morning sell stays visible).
      if (soldDay === dayKey || soldDay === todayKey) {
        upsertCompanyItem(sellsByCompany, {
          key,
          ticker: company,
          side: "sell",
          pnlEur: closedPnlEur(e),
          capitalEur: closedCapitalEur(e),
          atIso: e.soldAt,
        });
      }
      continue;
    }
  }

  // Buys: open day = earliest investedAt among warrant/common siblings — so a
  // late JSPR alias stamp does not invent a "bought yesterday" when JSPRW
  // was opened earlier.
  for (const company of companiesSeen) {
    const investedAt = earliestCompanyInvestedAt(inputs, history, company);
    if (dayKeyFromIso(investedAt) !== dayKey) continue;

    // Prefer a still-open sibling; else a closed sibling from that open day.
    let pickKey: string | null = null;
    let pickOpen = false;
    for (const key of siblingKeysForCompany(inputs, company)) {
      const e = inputs[key];
      if (!e) continue;
      if (!e.ignoreSheet && e.capital > 0) {
        pickKey = key;
        pickOpen = true;
        break;
      }
      if (e.ignoreSheet && e.soldAt && !pickKey) pickKey = key;
    }
    if (!pickKey) continue;
    const e = inputs[pickKey]!;
    if (pickOpen) {
      upsertCompanyItem(buysByCompany, {
        key: pickKey,
        ticker: company,
        side: "buy",
        pnlEur: openBuyPnlEur(pickKey, inputs, history, rowByKey),
        capitalEur: e.capital,
        atIso: investedAt ?? "",
      });
    } else {
      upsertCompanyItem(buysByCompany, {
        key: pickKey,
        ticker: company,
        side: "buy",
        pnlEur: closedPnlEur(e) ?? openBuyPnlEur(pickKey, inputs, history, rowByKey),
        capitalEur: closedCapitalEur(e),
        atIso: investedAt ?? "",
      });
    }
  }

  // History-first appearance on that day (covers buys whose investedAt was backfilled/wrong).
  // Still company-scoped: first-seen of a late common alias must not count if
  // the warrant sibling was already in history earlier.
  if (history?.length) {
    const companiesFromHistory = new Set<string>();
    for (const h of history) {
      for (const key of Object.keys(h.byTicker ?? {})) {
        companiesFromHistory.add(companyFromKey(key));
      }
    }
    for (const company of companiesFromHistory) {
      if (buysByCompany.has(company)) continue;
      const firstTs = earliestCompanyHistoryTs(history, inputs, company);
      if (dayKeyFromIso(firstTs) !== dayKey) continue;
      let pickKey: string | null = null;
      let pickOpen = false;
      for (const key of siblingKeysForCompany(inputs, company)) {
        const e = inputs[key];
        if (!e) continue;
        if (!e.ignoreSheet && e.capital > 0) {
          pickKey = key;
          pickOpen = true;
          break;
        }
        if (e.ignoreSheet && e.soldAt && !pickKey) pickKey = key;
      }
      if (!pickKey) continue;
      const e = inputs[pickKey]!;
      if (pickOpen) {
        upsertCompanyItem(buysByCompany, {
          key: pickKey,
          ticker: company,
          side: "buy",
          pnlEur: openBuyPnlEur(pickKey, inputs, history, rowByKey),
          capitalEur: e.capital,
          atIso: firstTs ?? "",
        });
      } else {
        upsertCompanyItem(buysByCompany, {
          key: pickKey,
          ticker: company,
          side: "buy",
          pnlEur: closedPnlEur(e),
          capitalEur: closedCapitalEur(e),
          atIso: firstTs ?? "",
        });
      }
    }
  }

  // Round-trip in the window (bought yesterday, sold yesterday/today) → Sold only.
  for (const company of sellsByCompany.keys()) {
    buysByCompany.delete(company);
  }

  const buys = [...buysByCompany.values()].sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
  const sells = [...sellsByCompany.values()].sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
  return { dayKey, todayKey, buys, sells };
}

export function priorDayActivityHasRows(a: PriorDayBookActivity): boolean {
  return a.buys.length > 0 || a.sells.length > 0;
}

const DISMISS_KEY = "supernova_prior_day_book_activity_dismiss_v1";

export function isPriorDayActivityDismissed(dayKey: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === dayKey;
  } catch {
    return false;
  }
}

export function dismissPriorDayActivity(dayKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, dayKey);
  } catch {
    /* ignore */
  }
}
