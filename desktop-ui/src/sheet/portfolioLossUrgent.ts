/**
 * Avvisi urgenti vendita — posizioni in portafoglio con P&L negativo.
 */
import type { SheetTable } from "../types";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  buildPositions,
  currentPriceFromRow,
  isLivePriceDeadFromRow,
  positionPnlForOpenRow,
  resolveInvestSimEntryForRow,
  rowHasActivePortfolio,
  resolvePortfolioHistory,
} from "./simulationPosition";
import { isDiscoverySidecarRow } from "./simCdHorizonScope";
import { portfolioPnlTone } from "./portfolioGainLossStyle";

/**
 * Hype / Guidance Calendar / manual sidecars belong in Off Book or Reg
 * Opportunities. They enter Portfolio Top KPI only after a real book buy
 * (capital + investedAt) — sheet leftover numbers must not invent a holding.
 */
export function sidecarCountsAsPortfolioHolding(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
): boolean {
  if (!isDiscoverySidecarRow(row)) return true;
  const entry = resolveInvestSimEntryForRow(row, inputs);
  return (
    !entry.ignoreSheet &&
    entry.capital > 0 &&
    Boolean(String(entry.investedAt ?? "").trim())
  );
}

/** Last history mark for an open book key — used when live quote is dead. */
function lastHistoryMarkForKey(
  hist: InvestSimHistoryPoint[],
  key: string,
  capital: number,
): { valueNow: number; pnlEur: number; pnlPct: number } | null {
  if (!(capital > 0) || !key) return null;
  for (let i = hist.length - 1; i >= 0; i--) {
    const snap = hist[i]?.byTicker?.[key];
    if (!snap || !(snap.value > 0)) continue;
    const pnlEur =
      snap.pnl != null && Number.isFinite(snap.pnl)
        ? Math.round(snap.pnl * 100) / 100
        : Math.round((snap.value - capital) * 100) / 100;
    const pnlPct = Math.round((pnlEur / capital) * 10000) / 100;
    return {
      valueNow: Math.round(snap.value * 100) / 100,
      pnlEur,
      pnlPct,
    };
  }
  return null;
}

const DISMISS_KEY = "supernova_portfolio_loss_urgent_dismiss_v1";
const BATCH_ACK_KEY = "supernova_portfolio_loss_modal_batch_v1";
const AUTO_SHOWN_SESSION_KEY = "supernova_portfolio_loss_modal_auto_shown_v1";
const RE_ALERT_PP_WORSE = 2;

type LossModalBatchAck = {
  refreshToken: string;
  keySig: string;
};

/** Stable batch id — ticker keys only (P&L drift must not invalidate ack). */
export function lossAlertKeySig(alerts: PortfolioLossAlert[]): string {
  return alerts
    .map((a) => a.key)
    .sort()
    .join("|");
}

function readLossModalBatchAck(): LossModalBatchAck | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BATCH_ACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LossModalBatchAck;
    if (!parsed?.refreshToken || !parsed?.keySig) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isLossModalBatchAcked(refreshToken: string, keySig: string): boolean {
  if (!refreshToken || !keySig) return false;
  const ack = readLossModalBatchAck();
  if (!ack) return false;
  return ack.refreshToken === refreshToken && ack.keySig === keySig;
}

export function ackLossModalBatch(refreshToken: string, keySig: string): void {
  if (typeof window === "undefined" || !refreshToken || !keySig) return;
  sessionStorage.setItem(BATCH_ACK_KEY, JSON.stringify({ refreshToken, keySig }));
}

/** Auto carousel already shown (or dismissed) this app session — no repeat popups on refresh. */
export function isLossModalAutoShownThisSession(): boolean {
  if (typeof window === "undefined") return true;
  return sessionStorage.getItem(AUTO_SHOWN_SESSION_KEY) === "1";
}

export function markLossModalAutoShownThisSession(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AUTO_SHOWN_SESSION_KEY, "1");
}

export type PortfolioLossAlert = {
  key: string;
  ticker: string;
  completionDate: string;
  pnlEur: number;
  pnlPct: number;
  capital: number;
  valueNow: number;
  buyPrice: number;
  seriesKey: string | null;
  /**
   * Live feed marked the quote dead/stale (typical for expired/illiquid warrants
   * like JSPRW). Row must stay in Evaluation — P&L may be history/cost fallback.
   */
  livePriceDead?: boolean;
};

type DismissEntry = {
  key: string;
  pnlPct: number;
  dismissedAt: string;
};

function loadDismissMap(): Map<string, DismissEntry> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw) as DismissEntry[];
    if (!Array.isArray(arr)) return new Map();
    return new Map(arr.filter((e) => e?.key).map((e) => [e.key, e]));
  } catch {
    return new Map();
  }
}

function saveDismissMap(m: Map<string, DismissEntry>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...m.values()]));
}

export function dismissPortfolioLossAlert(key: string, pnlPct: number): void {
  const m = loadDismissMap();
  m.set(key, { key, pnlPct, dismissedAt: new Date().toISOString() });
  saveDismissMap(m);
}

/** Persist dismiss for every ticker shown in a modal batch (survives reload). */
export function dismissPortfolioLossAlerts(
  alerts: ReadonlyArray<Pick<PortfolioLossAlert, "key" | "pnlPct">>,
): void {
  if (!alerts.length) return;
  const m = loadDismissMap();
  const dismissedAt = new Date().toISOString();
  for (const a of alerts) {
    m.set(a.key, { key: a.key, pnlPct: a.pnlPct, dismissedAt });
  }
  saveDismissMap(m);
}

export function isPortfolioLossAlertDismissed(key: string, currentPnlPct: number): boolean {
  const entry = loadDismissMap().get(key);
  if (!entry) return false;
  if (currentPnlPct < entry.pnlPct - RE_ALERT_PP_WORSE) return false;
  return true;
}

/** Posizioni aperte con P&L negativo — stesso motore del tab P&L (breakdown giornaliero). */
export function detectPortfolioLossAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const hist = resolvePortfolioHistory(history);
  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const positions = buildPositions(simTable, inputs, hist);
  const out: PortfolioLossAlert[] = [];

  for (const p of positions) {
    if (p.capital <= 0 || p.buyPrice <= 0) continue;
    const row = rowByKey.get(p.key);
    if (!row || !rowHasActivePortfolio(row, inputs)) continue;
    if (!sidecarCountsAsPortfolioHolding(row, inputs)) continue;

    const metrics = positionPnlForOpenRow(row, inputs, hist);
    const pnlEur = metrics.pnlEur;
    const pnlPct = metrics.pnlPct;
    if (pnlEur == null || pnlPct == null) continue;
    if (portfolioPnlTone(pnlEur, pnlPct) !== "loss") continue;

    out.push({
      key: p.key,
      ticker: p.ticker,
      completionDate: p.completionDate,
      pnlEur,
      pnlPct,
      capital: p.capital,
      valueNow: p.valueNow,
      buyPrice: p.buyPrice,
      seriesKey: simulationRowSeriesKey(row),
    });
  }

  return out.sort((a, b) => a.pnlPct - b.pnlPct);
}

/** Tutte le posizioni aperte in portafoglio (per tab 24h assessment). */
export function detectPortfolioPositionAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const hist = resolvePortfolioHistory(history);
  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const positions = buildPositions(simTable, inputs, hist);
  const out: PortfolioLossAlert[] = [];

  for (const p of positions) {
    if (p.capital <= 0) continue;
    const row = rowByKey.get(p.key);
    if (!row || !rowHasActivePortfolio(row, inputs)) continue;
    if (!sidecarCountsAsPortfolioHolding(row, inputs)) continue;

    const rawBuy = inputs[p.key]?.buyPrice ?? 0;
    const buyPrice = p.buyPrice > 0 ? p.buyPrice : rawBuy > 0 ? rawBuy : 0;
    if (buyPrice <= 0) continue;

    const metrics = positionPnlForOpenRow(row, inputs, hist);
    let pnlEur = metrics.pnlEur;
    let pnlPct = metrics.pnlPct;
    let valueNow = p.valueNow > 0 ? p.valueNow : 0;
    const livePx = currentPriceFromRow(row);
    const livePriceDead =
      isLivePriceDeadFromRow(row) || !(livePx != null && livePx > 0);
    // Fallback MTM so restored opens (sparse history / transient pnlUnavailable)
    // still enter the recommendation engine instead of showing "—" in Pulse.
    if ((pnlEur == null || pnlPct == null) && p.currPrice != null && p.currPrice > 0) {
      valueNow = Math.round((p.capital / buyPrice) * p.currPrice * 100) / 100;
      pnlEur = Math.round((valueNow - p.capital) * 100) / 100;
      pnlPct = Math.round(((p.currPrice - buyPrice) / buyPrice) * 10000) / 100;
    }
    // Dead/stale warrants (JSPRW…): live refresh nulls price — keep the open
    // book visible in Evaluation with history mark, else flat at cost.
    if (pnlEur == null || pnlPct == null) {
      const fromHist = lastHistoryMarkForKey(hist, p.key, p.capital);
      if (fromHist) {
        valueNow = fromHist.valueNow;
        pnlEur = fromHist.pnlEur;
        pnlPct = fromHist.pnlPct;
      } else if (buyPrice > 0 && p.capital > 0) {
        valueNow = p.capital;
        pnlEur = 0;
        pnlPct = 0;
      } else {
        continue;
      }
    }

    out.push({
      key: p.key,
      ticker: p.ticker,
      completionDate: p.completionDate,
      pnlEur,
      pnlPct,
      capital: p.capital,
      valueNow: valueNow > 0 ? valueNow : p.valueNow,
      buyPrice,
      seriesKey: simulationRowSeriesKey(row),
      livePriceDead: livePriceDead || undefined,
    });
  }

  return out.sort((a, b) => {
    const aLoss = portfolioPnlTone(a.pnlEur, a.pnlPct) === "loss";
    const bLoss = portfolioPnlTone(b.pnlEur, b.pnlPct) === "loss";
    if (aLoss !== bLoss) return aLoss ? -1 : 1;
    return a.pnlPct - b.pnlPct;
  });
}

export function pendingPortfolioLossAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioLossAlert[] {
  return detectPortfolioLossAlerts(simTable, inputs, history).filter(
    (a) => !isPortfolioLossAlertDismissed(a.key, a.pnlPct),
  );
}
