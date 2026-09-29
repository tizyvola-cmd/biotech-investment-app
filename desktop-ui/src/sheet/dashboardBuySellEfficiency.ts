/**
 * Home hero KPIs — last NYSE session trade efficiency:
 *  • BUY: open-book session P&L vs invested capital (% + $)
 *  • SELL: % of closes that avoided a further drop after exit
 *    (counterfactual vs last market close / spot)
 */
import { ADVICE_CALIB_SELL_MIN_DOWN_PCT } from "./investDecisionSimAdviceCalibration";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import {
  formatSessionDayKey,
  lastUsEquityCloseSessionKey,
} from "./marketSession";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  aggregateOpenPortfolioPnl,
  currentPriceFromRow,
  dailyChangePctFromRow,
  type PortfolioPnlTotals,
} from "./simulationPosition";
import type { SheetTable } from "../types";

export type DashboardBuyEfficiency = {
  sessionKey: string;
  sessionLabel: string;
  pnlEur: number;
  pnlPct: number | null;
  capitalEur: number;
  covered: number;
  total: number;
};

export type DashboardSellEfficiency = {
  sessionKey: string;
  sessionLabel: string;
  /** % of scored sells that avoided a significant post-exit drop. */
  efficiencyPct: number | null;
  savedCount: number;
  scoredCount: number;
  /** Σ capital × max(0, −postExitMove%) — dollars of loss avoided. */
  avoidedLossEur: number;
  pendingCount: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtSignedUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** YYYY-MM-DD in America/New_York for an ISO timestamp. */
export function nyseDayKeyFromIso(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
    return m?.[1] ?? null;
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(t));
  } catch {
    return null;
  }
}

export function buildDashboardBuyEfficiency(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang: "it" | "en";
  now?: Date;
}): DashboardBuyEfficiency {
  const sessionKey = lastUsEquityCloseSessionKey(args.now);
  const totals: PortfolioPnlTotals = aggregateOpenPortfolioPnl(
    args.simTable,
    args.inputs,
    args.history,
  );
  return {
    sessionKey,
    sessionLabel: formatSessionDayKey(sessionKey, args.lang),
    pnlEur: totals.pnlEurToday,
    pnlPct: totals.pnlPctToday,
    capitalEur: totals.capital,
    covered: totals.todayCovered,
    total: totals.todayTotal,
  };
}

/**
 * Exit USD/share when we still know entry buy, else null (use session % fallback).
 */
function exitUsdFromClosedEntry(entry: {
  buyPrice?: number;
  closedCapital?: number;
  closedValue?: number;
  closedPnlEur?: number;
}): number | null {
  const buy = entry.buyPrice;
  const cap = entry.closedCapital;
  const val = entry.closedValue;
  if (buy != null && buy > 0 && cap != null && cap > 0) {
    const shares = cap / buy;
    if (shares > 0 && val != null && Number.isFinite(val)) {
      return val / shares;
    }
    if (shares > 0 && entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)) {
      return (cap + entry.closedPnlEur) / shares;
    }
  }
  return null;
}

export function buildDashboardSellEfficiency(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  lang: "it" | "en";
  now?: Date;
  /** Min post-exit drop (negative %) to count as a “saved” sell. */
  minSavedDownPct?: number;
}): DashboardSellEfficiency {
  const sessionKey = lastUsEquityCloseSessionKey(args.now);
  const minDown = args.minSavedDownPct ?? ADVICE_CALIB_SELL_MIN_DOWN_PCT;
  const rowByKey = buildSimRowByKeyMap(args.simTable?.rows ?? []);
  const rowByTicker = new Map<string, Record<string, unknown>>();
  for (const r of args.simTable?.rows ?? []) {
    const tk = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (tk && !rowByTicker.has(tk)) rowByTicker.set(tk, r);
  }

  let savedCount = 0;
  let scoredCount = 0;
  let pendingCount = 0;
  let avoidedLossEur = 0;

  for (const [key, entry] of Object.entries(args.inputs)) {
    if (!entry?.ignoreSheet || !entry.soldAt) continue;
    const soldDay = nyseDayKeyFromIso(entry.soldAt);
    if (soldDay !== sessionKey) continue;

    const ticker = (key.split("|")[0] ?? "").trim().toUpperCase();
    const simRow = rowByKey.get(key) ?? (ticker ? rowByTicker.get(ticker) : null) ?? null;
    const capital =
      entry.closedCapital != null && entry.closedCapital > 0 ? entry.closedCapital : 0;

    const exitUsd = exitUsdFromClosedEntry(entry);
    const spot = simRow ? currentPriceFromRow(simRow) : null;
    let movePct: number | null = null;
    if (exitUsd != null && exitUsd > 0 && spot != null && spot > 0) {
      movePct = round1(((spot - exitUsd) / exitUsd) * 100);
    } else if (simRow) {
      // Fallback: last-session sheet move as counterfactual if still held.
      movePct = dailyChangePctFromRow(simRow);
    }

    if (movePct == null || !Number.isFinite(movePct)) {
      pendingCount++;
      continue;
    }
    scoredCount++;
    if (movePct <= minDown) {
      savedCount++;
      if (capital > 0) {
        avoidedLossEur += capital * Math.max(0, -movePct / 100);
      }
    }
  }

  return {
    sessionKey,
    sessionLabel: formatSessionDayKey(sessionKey, args.lang),
    efficiencyPct:
      scoredCount > 0 ? round1((savedCount / scoredCount) * 100) : null,
    savedCount,
    scoredCount,
    avoidedLossEur: roundEur(avoidedLossEur),
    pendingCount,
  };
}

export function dashboardBuyEfficiencyDisplay(
  kpi: DashboardBuyEfficiency,
  lang: "it" | "en",
): { value: string; sub: string; title: string; accent?: "up" | "down" | "warn" } {
  const pct =
    kpi.pnlPct != null && Number.isFinite(kpi.pnlPct) ? round1(kpi.pnlPct) : null;
  const value =
    pct != null ? `${pct >= 0 ? "+" : ""}${pct}%` : kpi.capitalEur > 0 ? "—" : "—";
  const subParts = [
    fmtSignedUsd(kpi.pnlEur),
    lang === "it"
      ? `su ${fmtSignedUsd(kpi.capitalEur).replace(/^[+-]/, "")} investiti`
      : `on ${fmtSignedUsd(kpi.capitalEur).replace(/^[+-]/, "")} invested`,
    kpi.sessionLabel,
    kpi.total > 0
      ? lang === "it"
        ? `${kpi.covered}/${kpi.total} titoli`
        : `${kpi.covered}/${kpi.total} names`
      : null,
  ].filter(Boolean);
  const title =
    lang === "it"
      ? `Efficienza BUY — guadagno (o perdita) dell'ultima sessione Nasdaq (${kpi.sessionLabel}) sul capitale investito in portafoglio aperto. Valore: ${fmtSignedUsd(kpi.pnlEur)}${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : ""}.`
      : `BUY efficiency — last Nasdaq session (${kpi.sessionLabel}) P&L on open invested capital. Value: ${fmtSignedUsd(kpi.pnlEur)}${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct}%)` : ""}.`;
  const accent =
    kpi.pnlEur > 0.5 || (pct != null && pct > 0.15)
      ? ("up" as const)
      : kpi.pnlEur < -0.5 || (pct != null && pct < -0.15)
        ? ("down" as const)
        : undefined;
  return { value, sub: subParts.join(" · "), title, accent };
}

export function dashboardSellEfficiencyDisplay(
  kpi: DashboardSellEfficiency,
  lang: "it" | "en",
): { value: string; sub: string; title: string; accent?: "up" | "down" | "warn" } {
  const value = kpi.efficiencyPct != null ? `${kpi.efficiencyPct}%` : "—";
  const subParts = [
    lang === "it"
      ? `perdite evitate ${fmtSignedUsd(kpi.avoidedLossEur)}`
      : `losses avoided ${fmtSignedUsd(kpi.avoidedLossEur)}`,
    kpi.scoredCount > 0
      ? lang === "it"
        ? `${kpi.savedCount}/${kpi.scoredCount} vendite utili`
        : `${kpi.savedCount}/${kpi.scoredCount} helpful sells`
      : lang === "it"
        ? "nessuna vendita in sessione"
        : "no sells this session",
    kpi.pendingCount > 0
      ? lang === "it"
        ? `${kpi.pendingCount} in attesa`
        : `${kpi.pendingCount} pending`
      : null,
    kpi.sessionLabel,
  ].filter(Boolean);
  const title =
    lang === "it"
      ? `Efficienza SELL — % di vendite nell'ultima sessione (${kpi.sessionLabel}) che hanno evitato un calo ulteriore (≥ ${Math.abs(ADVICE_CALIB_SELL_MIN_DOWN_PCT)}%) rispetto alla chiusura/spot. Perdite evitate stimate: ${fmtSignedUsd(kpi.avoidedLossEur)}.`
      : `SELL efficiency — % of sells on last session (${kpi.sessionLabel}) that avoided a further drop (≥ ${Math.abs(ADVICE_CALIB_SELL_MIN_DOWN_PCT)}%) vs close/spot. Estimated losses avoided: ${fmtSignedUsd(kpi.avoidedLossEur)}.`;
  const accent =
    kpi.efficiencyPct != null && kpi.efficiencyPct >= 60
      ? ("up" as const)
      : kpi.efficiencyPct != null && kpi.efficiencyPct < 40 && kpi.scoredCount > 0
        ? ("down" as const)
        : undefined;
  return { value, sub: subParts.join(" · "), title, accent };
}
