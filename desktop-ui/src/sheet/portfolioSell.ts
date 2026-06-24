import type { SheetTable } from "../types";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "./investSimKeys";
import {
  appendHistoryPoint,
  closedSimEntry,
  getInvestSimInputsSnapshot,
  loadInvestSimHistory,
  persistInvestSimHistoryNow,
  persistInvestSimInputsNow,
  type ClosedSimExitSnapshot,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "./investSimStorage";
import {
  buildPositions,
  computeSimulationPosition,
  rowHasActivePortfolio,
  type SimulationPosition,
} from "./simulationPosition";

export type PortfolioSellFailure =
  | "no_row"
  | "not_in_portfolio"
  | "no_capital"
  | "cancelled";

export type PortfolioSellResult =
  | { ok: true; inputs: InvestSimInputs; key: string }
  | { ok: false; reason: PortfolioSellFailure };

function portfolioSnapshotFromPositions(positions: SimulationPosition[]) {
  const withCapital = positions.filter((p) => p.capital > 0);
  const priced = withCapital.filter((p) => p.buyPrice > 0 && !p.pnlUnavailable);
  const cap = withCapital.reduce((a, p) => a + p.capital, 0);
  const val = priced.reduce((a, p) => a + p.valueNow, 0);
  const capPriced = priced.reduce((a, p) => a + p.capital, 0);
  const pnl = val - capPriced;
  const pct = capPriced > 0 ? (pnl / capPriced) * 100 : 0;
  const byTicker: InvestSimHistoryPoint["byTicker"] = {};
  for (const p of priced) {
    byTicker[p.key] = {
      value: p.valueNow,
      pnl: p.pnlEur,
      pnlPct: p.pnlPct,
    };
  }
  return { cap, val, pnl, pct, n: withCapital.length, byTicker };
}

export function buildPortfolioSellConfirmMessage(pos: SimulationPosition): string {
  const pnlSign = pos.pnlEur >= 0 ? "+" : "";
  const pnlLine =
    pos.pnlUnavailable || pos.buyPrice <= 0
      ? "P&L: not computed (enter buy price if missing)"
      : `Final P&L: ${pnlSign}€${pos.pnlEur.toFixed(2)} (${pnlSign}${pos.pnlPct.toFixed(2)}%)`;
  return (
    `Sell ${pos.ticker} at current price $${pos.currPrice?.toFixed(2) ?? "—"}?\n\n` +
    `Capital invested: €${pos.capital.toFixed(2)}\n` +
    `Current value: €${pos.valueNow.toFixed(2)}\n` +
    `${pnlLine}\n\n` +
    `The position will be closed and removed from your portfolio.`
  );
}

export function applyPortfolioSellPatch(
  inputs: InvestSimInputs,
  key: string,
  simRows?: Record<string, unknown>[] | null,
  exit?: ClosedSimExitSnapshot,
): InvestSimInputs {
  const soldAt = new Date().toISOString();
  const prev = inputs[key];
  const next: InvestSimInputs = {
    ...inputs,
    [key]: closedSimEntry(prev?.investedAt, prev?.purchaseDate, soldAt, exit),
  };
  return simRows?.length ? reconcileInvestSimInputs(next, simRows) : next;
}

/** Registra uscita ticker venduto nello storico (merge stesso giorno — non perde il closed P&L). */
function recordSoldPositionExit(
  simTable: SheetTable | null,
  inputsAfterSell: InvestSimInputs,
  soldKey: string,
  exit: ClosedSimExitSnapshot & { pnlPct: number },
): void {
  if (!simTable?.rows?.length) return;
  const hist = loadInvestSimHistory();
  const positions = buildPositions(simTable, inputsAfterSell, hist);
  const snap = portfolioSnapshotFromPositions(positions);
  const byTicker: InvestSimHistoryPoint["byTicker"] = {
    ...snap.byTicker,
    [soldKey]: {
      value: exit.closedValue ?? 0,
      pnl: exit.closedPnlEur ?? 0,
      pnlPct: exit.pnlPct,
    },
  };
  const next = appendHistoryPoint(
    hist,
    {
      capital: snap.cap,
      value: snap.val,
      pnl: snap.pnl,
      pnlPct: snap.pct,
      byTicker,
    },
    { force: true },
  );
  persistInvestSimHistoryNow(next);
}

export function executePortfolioSell(opts: {
  key: string;
  simRow?: Record<string, unknown> | null;
  simTable?: SheetTable | null;
  inputs?: InvestSimInputs;
  confirm?: boolean;
  recordHistory?: boolean;
}): PortfolioSellResult {
  const simRows = opts.simTable?.rows ?? [];
  const rowByKey = buildSimRowByKeyMap(simRows);
  const row = opts.simRow ?? rowByKey.get(opts.key) ?? null;
  if (!row) return { ok: false, reason: "no_row" };

  const inputs = opts.inputs ?? getInvestSimInputsSnapshot();
  if (!rowHasActivePortfolio(row, inputs)) {
    return { ok: false, reason: "not_in_portfolio" };
  }

  const pos = computeSimulationPosition(row, inputs);
  if (!pos || pos.capital <= 0) {
    return { ok: false, reason: "no_capital" };
  }

  if (opts.confirm !== false) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm(buildPortfolioSellConfirmMessage(pos))) {
        return { ok: false, reason: "cancelled" };
      }
    }
  }

  const exit: ClosedSimExitSnapshot & { pnlPct: number } = {
    closedCapital: pos.capital,
    closedValue: pos.pnlUnavailable ? undefined : pos.valueNow,
    closedPnlEur: pos.pnlUnavailable ? undefined : pos.pnlEur,
    pnlPct: pos.pnlUnavailable ? 0 : pos.pnlPct,
  };

  const next = applyPortfolioSellPatch(inputs, opts.key, simRows, exit);
  persistInvestSimInputsNow(next);

  if (opts.recordHistory !== false) {
    recordSoldPositionExit(opts.simTable ?? null, next, opts.key, exit);
  }

  return { ok: true, inputs: next, key: opts.key };
}
