import type { InvestSimInputs } from "./investSimStorage";

export type ExperimentId = "portfolio" | "simloop" | "synth";

export type ExperimentCash = {
  startingCapital: number;
  openCapital: number;
  realizedPnl: number;
  /** startingCapital + realizedPnl − openCapital */
  availableCash: number;
  /**
   * Open capital attributed to the starting budget first:
   * `min(open, starting)`.
   */
  budgetLocked: number;
  /** Open capital beyond the starting budget (funded by gains). */
  gainsLocked: number;
  /** Starting capital not yet locked in open positions. */
  budgetFree: number;
  /**
   * Positive realized gains not yet locked in open positions.
   * Negative closed P&L does not create a gains pool.
   */
  gainsFree: number;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function entryBelongsTo(universe: string | undefined, experiment: ExperimentId): boolean {
  if (experiment === "portfolio") return universe === "real";
  if (experiment === "simloop") return universe === "simloop" || !universe;
  return universe === "synth";
}

/**
 * Computes the cash state for one experiment independently.
 * Pure function — no side effects, safe to call in useMemo.
 *
 * Convention for universe membership:
 *   portfolio → universe === "real"
 *   simloop   → universe === "simloop" OR undefined (legacy entries)
 *   synth     → universe === "synth"
 *
 * Funding policy (display + draw planning):
 *   open positions consume starting budget first, then gains.
 */
export function computeExperimentCash(
  inputs: InvestSimInputs,
  experiment: ExperimentId,
  startingCapital: number,
): ExperimentCash {
  let openCapital = 0;
  let realizedPnl = 0;

  for (const entry of Object.values(inputs)) {
    if (!entry) continue;
    if (!entryBelongsTo(entry.universe, experiment)) continue;

    if (entry.ignoreSheet) {
      if (entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)) {
        realizedPnl += entry.closedPnlEur;
      }
    } else if (entry.capital > 0) {
      openCapital += entry.capital;
    }
  }

  const start = Math.max(0, roundEur(startingCapital));
  const open = roundEur(openCapital);
  const pnl = roundEur(realizedPnl);
  const budgetLocked = roundEur(Math.min(open, start));
  const gainsLocked = roundEur(Math.max(0, open - start));
  const budgetFree = roundEur(Math.max(0, start - budgetLocked));
  const gainsPool = roundEur(Math.max(0, pnl));
  const gainsFree = roundEur(Math.max(0, gainsPool - gainsLocked));
  return {
    startingCapital: start,
    openCapital: open,
    realizedPnl: pnl,
    availableCash: roundEur(start + pnl - open),
    budgetLocked,
    gainsLocked,
    budgetFree,
    gainsFree,
  };
}

export type CapitalDrawPlan = {
  delta: number;
  fromBudget: number;
  fromGains: number;
  needsGainsConfirm: boolean;
  /** false when delta exceeds budgetFree + gainsFree */
  affordable: boolean;
  budgetFree: number;
  gainsFree: number;
};

/**
 * Plan how a capital increase is funded: budget first, then gains.
 * Callers MUST confirm when `needsGainsConfirm` is true.
 */
export function planCapitalDraw(cash: ExperimentCash, delta: number): CapitalDrawPlan {
  const d = Math.max(0, roundEur(delta));
  const fromBudget = roundEur(Math.min(d, Math.max(0, cash.budgetFree)));
  const fromGains = roundEur(Math.max(0, d - fromBudget));
  const pool = roundEur(Math.max(0, cash.budgetFree) + Math.max(0, cash.gainsFree));
  return {
    delta: d,
    fromBudget,
    fromGains,
    needsGainsConfirm: fromGains > 0.01,
    affordable: d <= pool + 0.01,
    budgetFree: cash.budgetFree,
    gainsFree: cash.gainsFree,
  };
}

/** User-facing copy for gains-confirm / insufficient-cash gates. */
export function capitalDrawGateMessage(
  plan: CapitalDrawPlan,
  opts: {
    it: boolean;
    experimentLabel: string;
  },
): { kind: "insufficient" | "confirm_gains"; text: string } {
  const { it, experimentLabel } = opts;
  if (!plan.affordable) {
    return {
      kind: "insufficient",
      text: it
        ? `Cassa insufficiente (${experimentLabel}): servono ${Math.round(plan.delta).toLocaleString("it-IT")} $ — budget libero ${Math.round(plan.budgetFree).toLocaleString("it-IT")} $ + guadagni ${Math.round(plan.gainsFree).toLocaleString("it-IT")} $. Aumenta il capitale iniziale o riduci l'investimento.`
        : `Insufficient cash (${experimentLabel}): need $${Math.round(plan.delta).toLocaleString("en-US")} — budget free $${Math.round(plan.budgetFree).toLocaleString("en-US")} + gains $${Math.round(plan.gainsFree).toLocaleString("en-US")}. Raise starting capital or reduce the investment.`,
    };
  }
  return {
    kind: "confirm_gains",
    text: it
      ? `Budget ${experimentLabel} esaurito (libero ${Math.round(plan.budgetFree).toLocaleString("it-IT")} $). Per investire ${Math.round(plan.delta).toLocaleString("it-IT")} $ servono ${Math.round(plan.fromGains).toLocaleString("it-IT")} $ dai guadagni chiusi (disponibili ${Math.round(plan.gainsFree).toLocaleString("it-IT")} $).\n\nConfermi di usare i guadagni?`
      : `${experimentLabel} budget exhausted (free $${Math.round(plan.budgetFree).toLocaleString("en-US")}). Investing $${Math.round(plan.delta).toLocaleString("en-US")} needs $${Math.round(plan.fromGains).toLocaleString("en-US")} from closed gains (available $${Math.round(plan.gainsFree).toLocaleString("en-US")}).\n\nConfirm using gains?`,
  };
}

/**
 * Gate a capital increase. Returns false if blocked or user cancels gains confirm.
 * Uses `window.alert` / `window.confirm` when available.
 */
export function gateCapitalDraw(
  cash: ExperimentCash,
  delta: number,
  opts: { it: boolean; experimentLabel: string },
): CapitalDrawPlan | null {
  const plan = planCapitalDraw(cash, delta);
  if (plan.delta <= 0) return plan;
  if (!plan.affordable) {
    const msg = capitalDrawGateMessage(plan, opts);
    if (typeof window !== "undefined") window.alert(msg.text);
    return null;
  }
  if (plan.needsGainsConfirm) {
    const msg = capitalDrawGateMessage(plan, opts);
    if (typeof window !== "undefined") {
      const ok = window.confirm(msg.text);
      if (!ok) return null;
    }
  }
  return plan;
}

export function experimentLabel(id: ExperimentId, it: boolean): string {
  if (id === "portfolio") return "Portfolio";
  if (id === "simloop") return "Sim Loop";
  return it ? "Synth" : "Synth";
}

export type CapitalDrilldownRow = {
  key: string;
  ticker: string;
  capital: number;
  pctOfOpen: number;
  buyPrice: number | null;
};

/** Per-position breakdown of open capital for one experiment. */
export function buildCapitalDrilldown(
  inputs: InvestSimInputs,
  experiment: ExperimentId,
): CapitalDrilldownRow[] {
  const rows: CapitalDrilldownRow[] = [];
  let totalOpen = 0;

  for (const [key, entry] of Object.entries(inputs)) {
    if (!entry || entry.ignoreSheet || !(entry.capital > 0)) continue;
    if (!entryBelongsTo(entry.universe, experiment)) continue;
    const ticker = (key.split("|")[0] ?? key).trim().toUpperCase();
    rows.push({
      key,
      ticker,
      capital: entry.capital,
      pctOfOpen: 0,
      buyPrice: entry.buyPrice > 0 ? entry.buyPrice : null,
    });
    totalOpen += entry.capital;
  }

  for (const r of rows) {
    r.pctOfOpen = totalOpen > 0 ? Math.round((r.capital / totalOpen) * 1000) / 10 : 0;
  }

  return rows.sort((a, b) => b.capital - a.capital);
}
