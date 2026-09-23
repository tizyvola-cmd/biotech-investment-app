import type { PortfolioDailyPnlLedger } from "./simulationPosition";
import type { InvestSimInputs } from "./investSimStorage";
import { sumClosedPnlEur } from "./investSimKeys";

const BASELINE_KEY = "supernova_closed_piggy_bank_baseline";
export const CLOSED_PIGGY_BANK_CHANGED_EVENT = "supernova:closed-piggy-bank-changed";

export type ClosedPiggyBankBaseline = {
  /** P&L cumulato al momento del reset — il display = raw − baseline. */
  baselineEur: number;
  resetAt: string;
};

export type ClosedPiggyBankSummary = {
  rawPnlEur: number;
  capitalEur: number;
  positionCount: number;
  tickers: string[];
};

export type ClosedPiggyBankDisplay = ClosedPiggyBankSummary & {
  /** Hero figure — always all-time realized closed P&L (not offset by Reset). */
  pnlEur: number;
  /** raw − baseline when a Reset is active; else same as pnlEur. */
  sinceResetPnlEur: number;
  pnlPct: number;
  baselineEur: number;
  fillPct: number;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** P&L realizzato delle opportunità chiuse — somma righe archived del ledger. */
export function summarizeClosedPiggyBankFromLedger(
  ledger: PortfolioDailyPnlLedger | null | undefined,
  inputs?: InvestSimInputs | null,
): ClosedPiggyBankSummary {
  if (!ledger?.rows?.length) {
    const fromInputs = inputs ? sumClosedPnlEur(inputs) : 0;
    return {
      rawPnlEur: roundEur(fromInputs),
      capitalEur: 0,
      positionCount: 0,
      tickers: [],
    };
  }
  const closed = ledger.rows.filter((r) => r.archived);
  const ledgerPnl = roundEur(closed.reduce((sum, r) => sum + r.totalEur, 0));
  // Floor with inputs.closedPnlEur — ledger can drop closed rows when the same
  // ticker is reopened on another CD (openKeys.has(key) skip).
  const inputsPnl = inputs ? roundEur(sumClosedPnlEur(inputs)) : 0;
  const rawPnlEur = Math.abs(inputsPnl) > Math.abs(ledgerPnl) ? inputsPnl : ledgerPnl;
  return {
    rawPnlEur,
    capitalEur: roundEur(closed.reduce((sum, r) => sum + r.capital, 0)),
    positionCount: Math.max(
      closed.length,
      inputs
        ? Object.values(inputs).filter(
            (e) => e?.ignoreSheet && e.closedPnlEur != null && Number.isFinite(e.closedPnlEur),
          ).length
        : 0,
    ),
    tickers: closed.map((r) => r.ticker),
  };
}

export function loadClosedPiggyBankBaseline(): ClosedPiggyBankBaseline | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClosedPiggyBankBaseline;
    if (parsed == null || !Number.isFinite(parsed.baselineEur)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistClosedPiggyBankBaseline(baseline: ClosedPiggyBankBaseline): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
  window.dispatchEvent(new CustomEvent(CLOSED_PIGGY_BANK_CHANGED_EVENT));
}

/** Azzera il contatore visualizzato — memorizza il cumulato attuale come baseline. */
export function resetClosedPiggyBankBaseline(rawPnlEur: number): ClosedPiggyBankBaseline {
  const baseline: ClosedPiggyBankBaseline = {
    baselineEur: roundEur(rawPnlEur),
    resetAt: new Date().toISOString(),
  };
  persistClosedPiggyBankBaseline(baseline);
  return baseline;
}

/** Livello birra 0–100: solo gain riempie; perdite = bicchiere vuoto. */
export function closedPiggyBankFillPct(pnlEur: number, capitalEur: number): number {
  if (pnlEur <= 0 || !Number.isFinite(pnlEur)) return 0;
  const target = Math.max(400, capitalEur * 0.2, pnlEur);
  return Math.min(100, Math.round((pnlEur / target) * 1000) / 10);
}

export function computeClosedPiggyBankDisplay(
  summary: ClosedPiggyBankSummary,
  baseline: ClosedPiggyBankBaseline | null,
): ClosedPiggyBankDisplay {
  const baselineEur = baseline?.baselineEur ?? 0;
  const rawPnlEur = roundEur(summary.rawPnlEur);
  // Hero always shows all-time closed gains — Reset only tracks a secondary counter.
  const pnlEur = rawPnlEur;
  const sinceResetPnlEur = roundEur(rawPnlEur - baselineEur);
  const pnlPct =
    summary.capitalEur > 0 ? Math.round((pnlEur / summary.capitalEur) * 10000) / 100 : 0;
  return {
    ...summary,
    rawPnlEur,
    baselineEur,
    pnlEur,
    sinceResetPnlEur,
    pnlPct,
    fillPct: closedPiggyBankFillPct(pnlEur, summary.capitalEur),
  };
}

export function closedPiggyHasBaseline(display: ClosedPiggyBankDisplay): boolean {
  return Math.abs(display.baselineEur) > 0.005;
}

/** Copy for reset confirm — sinceReset = counter that will zero; raw = all-time ledger. */
export function closedPiggyResetConfirmVars(display: ClosedPiggyBankDisplay): {
  display: string;
  raw: string;
  hasBaseline: boolean;
} {
  return {
    display: display.sinceResetPnlEur.toFixed(2),
    raw: display.rawPnlEur.toFixed(2),
    hasBaseline: closedPiggyHasBaseline(display),
  };
}

/** Clear Reset baseline so since-reset matches all-time. */
export function clearClosedPiggyBankBaseline(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(BASELINE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(CLOSED_PIGGY_BANK_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}
