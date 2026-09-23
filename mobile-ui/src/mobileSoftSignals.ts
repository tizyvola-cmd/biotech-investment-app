/**
 * Soft BUY / Soft SELL for mobile — same thresholds as desktop softSignalGrades.
 * Used when the VPS snapshot has no Soft BUY/SELL (or to overlay deep Soft SELL).
 */
import { daysFromCompletionDate } from "./opportunityLogic";
import {
  computeSimulationPosition,
  parseNum,
  pred5FromRow,
  rowHasActivePortfolio,
  normalizedRowKey,
} from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";
import type { MobileDashboardRecRow } from "./dashboardTypes";

/** Mirror desktop softSignalGrades.ts */
export const SOFT_BUY_G1_SDS_MIN = 20;
export const SOFT_BUY_G1_PPLAN_MIN = 50;
export const SOFT_SELL_G1_PNL_PCT = -2.5;
export const SOFT_SELL_G1_DEEP_PNL_PCT = -12;
export const SOFT_SELL_G1_ORPHAN_PNL_PCT = -6;
export const SOFT_SELL_G1_PPLAN_MAX = 50;
/** Mirror desktop: mild G1 waits 3 weekday sessions (buy day = 0). */
export const SOFT_SELL_G1_MIN_HOLD_SESSIONS = 3;

function weekdaySessionsElapsed(
  investedAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!investedAt?.trim()) return null;
  const invMs = Date.parse(investedAt);
  if (!Number.isFinite(invMs)) return null;
  const start = new Date(invMs);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (endDay < startDay) return 0;
  let elapsed = 0;
  for (let t = startDay + 86_400_000; t <= endDay; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) elapsed += 1;
  }
  return elapsed;
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function isWarrantTicker(ticker: string): boolean {
  const t = ticker.toUpperCase();
  return /W$|WS$|WT$|WW$/.test(t) || t.includes(".W");
}

function pplanFromRow(row: Record<string, unknown>): number | null {
  const explicit = parseNum(
    findCol(row, "recovery", "p(rec", "prob rec", "p(plan", "p plan"),
  );
  if (explicit != null) {
    return explicit <= 1.5 ? Math.round(explicit * 100) : Math.round(explicit);
  }
  return null;
}

function sdsFromRow(
  row: Record<string, unknown>,
  ticker: string,
  sdsByTicker?: Map<string, number> | null,
): number | null {
  const fromMap = sdsByTicker?.get(ticker.trim().toUpperCase());
  if (fromMap != null && Number.isFinite(fromMap)) return fromMap;
  return (
    parseNum(findCol(row, "sds score", "sds tot", "supernova distance", "sds")) ??
    null
  );
}

function contBoostSell(row: Record<string, unknown>): boolean {
  const g10 =
    parseNum(row["cont_g10"]) ??
    parseNum(findCol(row, "var. 10d", "var. 10g", "10d %"));
  const edge = parseNum(row["cont_sell_edge"]);
  const band = String(row["cont_band"] ?? "").toLowerCase();
  if (band === "declining") return true;
  if (g10 != null && g10 < 0) return true;
  if (g10 != null && g10 >= 0 && g10 < 5) return true; // weak / not-run
  if (edge != null && edge > 0) return true;
  return false;
}

function softSellHit(
  pnlPct: number,
  pplan: number | null,
  row: Record<string, unknown>,
  investedAt?: string | null,
): { hit: boolean; reason: string } {
  if (pnlPct > SOFT_SELL_G1_PNL_PCT) return { hit: false, reason: "" };
  if (pnlPct <= SOFT_SELL_G1_DEEP_PNL_PCT) {
    return { hit: true, reason: `pnl≤${SOFT_SELL_G1_DEEP_PNL_PCT}% (deep)` };
  }
  const planWeak = pplan != null && pplan < SOFT_SELL_G1_PPLAN_MAX;
  const orphan =
    pplan == null && pnlPct <= SOFT_SELL_G1_ORPHAN_PNL_PCT;
  const cont = contBoostSell(row);
  if (!planWeak && !orphan && !cont) return { hit: false, reason: "" };
  const elapsed = weekdaySessionsElapsed(investedAt);
  if (elapsed != null && elapsed < SOFT_SELL_G1_MIN_HOLD_SESSIONS) {
    return { hit: false, reason: "" };
  }
  const bits = [`pnl≤${SOFT_SELL_G1_PNL_PCT}%`];
  if (planWeak) bits.push(`pplan<${SOFT_SELL_G1_PPLAN_MAX}`);
  if (orphan) bits.push("pplan missing");
  if (cont) bits.push("10d/edge cut");
  return { hit: true, reason: bits.join(" · ") };
}

function softBuyHit(
  row: Record<string, unknown>,
  ticker: string,
  sdsByTicker?: Map<string, number> | null,
): { hit: boolean; reason: string; pplan: number | null; sds: number | null } {
  if (isWarrantTicker(ticker)) {
    return { hit: false, reason: "", pplan: null, sds: null };
  }
  const sds = sdsFromRow(row, ticker, sdsByTicker);
  const pplan = pplanFromRow(row);
  const hit =
    sds != null &&
    pplan != null &&
    sds >= SOFT_BUY_G1_SDS_MIN &&
    pplan >= SOFT_BUY_G1_PPLAN_MIN;
  return {
    hit,
    reason: hit
      ? `Soft BUY G1 · SDS ${Math.round(sds!)} · P(plan) ${Math.round(pplan!)}%`
      : "",
    pplan,
    sds,
  };
}

/**
 * Soft BUY (off-book) + Soft SELL (open book) rows for Dashboard chips.
 */
export function buildMobileSoftRecommendations(opts: {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  lang?: "it" | "en";
  sdsByTicker?: Map<string, number> | null;
}): MobileDashboardRecRow[] {
  const lang = opts.lang ?? "en";
  const out: MobileDashboardRecRow[] = [];

  for (const row of opts.sheet?.rows ?? []) {
    const ticker = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const key = normalizedRowKey(ticker, row["Completion Date"]);
    const inBook = rowHasActivePortfolio(row, opts.inputs);
    const pos = computeSimulationPosition(row, opts.inputs);
    const days = daysFromCompletionDate(String(row["Completion Date"] ?? ""));
    const d1 =
      parseNum(row["Var. Giorn. %"]) ??
      parseNum(row["Var. Giorn.%"]) ??
      parseNum(findCol(row, "var. giorn"));

    if (inBook && pos && pos.capital > 0 && !pos.pnlUnavailable) {
      const pplan = pplanFromRow(row);
      const investedAt = opts.inputs[key]?.investedAt ?? null;
      const sell = softSellHit(pos.pnlPct, pplan, row, investedAt);
      if (sell.hit) {
        out.push({
          key,
          ticker,
          action: "SELL",
          probPct: pplan,
          reason: sell.reason,
          readingPct: d1,
          planReturnPct: null,
          profile: "portfolio",
          daysToCd: days,
          companyName:
            String(row.Nome ?? row.Company ?? row.Società ?? "").trim() || null,
          scorePct: pplan,
          isNew: false,
        });
      }
      continue;
    }

    if (!inBook) {
      const buy = softBuyHit(row, ticker, opts.sdsByTicker);
      if (buy.hit) {
        const pred5 = pred5FromRow(row);
        out.push({
          key,
          ticker,
          action: "BUY",
          probPct: buy.pplan,
          reason: buy.reason,
          readingPct: d1,
          planReturnPct: pred5,
          profile: "opportunity",
          daysToCd: days,
          companyName:
            String(row.Nome ?? row.Company ?? row.Società ?? "").trim() || null,
          scorePct: buy.pplan,
          isNew: false,
        });
      }
    }
  }

  return out.sort((a, b) => {
    const ra = a.action === "SELL" ? 0 : 1;
    const rb = b.action === "SELL" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.ticker.localeCompare(b.ticker);
  });
}

/** Keep Soft BUY/SELL from server; fill gaps from live Soft Soft engine. */
export function mergeSoftRecommendations(
  serverRecs: MobileDashboardRecRow[] | null | undefined,
  softRecs: MobileDashboardRecRow[],
): MobileDashboardRecRow[] {
  const fromServer = (serverRecs ?? []).filter((r) => {
    const a = r.action.trim().toUpperCase();
    return a === "BUY" || a === "COMPRA" || a === "SELL" || a === "VENDI";
  });
  const byKey = new Map<string, MobileDashboardRecRow>();
  for (const r of fromServer) byKey.set(r.key, r);
  for (const r of softRecs) {
    if (!byKey.has(r.key)) byKey.set(r.key, r);
  }
  return [...byKey.values()].sort((a, b) => {
    const ra = a.action.toUpperCase().includes("SELL") || a.action === "VENDI" ? 0 : 1;
    const rb = b.action.toUpperCase().includes("SELL") || b.action === "VENDI" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function sumOpenCapital(inputs: InvestSimInputs): number {
  let s = 0;
  for (const v of Object.values(inputs)) {
    if (v?.capital != null && Number.isFinite(v.capital) && v.capital > 0) {
      s += v.capital;
    }
  }
  return s;
}
