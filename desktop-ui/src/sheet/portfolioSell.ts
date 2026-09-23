import type { TranslationKey } from "../shared/i18n";
import type { SheetTable } from "../types";
import {
  buildSimRowByKeyMap,
  mergeInvestSimInputs,
  normalizeCompletionDateForKey,
  reconcileInvestSimInputs,
} from "./investSimKeys";
import {
  appendHistoryPoint,
  closedSimEntry,
  loadInvestSimHistory,
  persistInvestSimHistoryNow,
  persistInvestSimInputsNow,
  reloadInvestSimInputsSnapshotFromStorage,
  saveInvestSimInputs,
  sanitizeInvestSimEntry,
  sanitizeInvestSimInputs,
  type ClosedSimExitSnapshot,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "./investSimStorage";
import {
  buildPositions,
  computeSimulationPosition,
  resolveInvestSimEntryForRow,
  rowHasActivePortfolio,
  warrantCommonTicker,
  type SimulationPosition,
} from "./simulationPosition";

export type PortfolioSellFailure =
  | "no_row"
  | "not_in_portfolio"
  | "no_capital"
  | "cancelled";

export type PortfolioSellResult =
  | { ok: true; inputs: InvestSimInputs; key: string; diskPersisted: boolean }
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

function rowAliasKeys(inputs: InvestSimInputs, row: Record<string, unknown>): string[] {
  const ticker = String(row.Ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker) return [];
  const cdNorm = normalizeCompletionDateForKey(row["Completion Date"]);
  const keys = new Set<string>();
  for (const [k, entry] of Object.entries(inputs)) {
    if (!entry) continue;
    const parts = k.split("|");
    if (parts[0]?.trim().toUpperCase() !== ticker) continue;
    if (normalizeCompletionDateForKey(parts.slice(1).join("|")) !== cdNorm) continue;
    keys.add(k);
  }
  return [...keys];
}

function companyTickerForSell(ticker: string): string {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return tk;
  return warrantCommonTicker(tk) ?? tk;
}

/** All book keys for the company (every CD + warrant/common siblings). */
function companyBookKeys(inputs: InvestSimInputs, ticker: string): string[] {
  const company = companyTickerForSell(ticker);
  if (!company) return [];
  const keys: string[] = [];
  for (const k of Object.keys(inputs)) {
    const tk = k.split("|")[0]?.trim().toUpperCase() ?? "";
    if (!tk) continue;
    if (companyTickerForSell(tk) === company) keys.push(k);
  }
  return keys;
}

export function applyPortfolioSellPatch(
  inputs: InvestSimInputs,
  key: string,
  simRows?: Record<string, unknown>[] | null,
  exit?: ClosedSimExitSnapshot,
): InvestSimInputs {
  const soldAt = new Date().toISOString();
  const rowByKey = simRows?.length ? buildSimRowByKeyMap(simRows) : null;
  const row = rowByKey?.get(key) ?? null;
  const prev = row
    ? resolveInvestSimEntryForRow(row, inputs)
    : inputs[key] ?? { buyPrice: 0, capital: 0 };
  const ticker =
    (row ? String(row.Ticker ?? "").trim().toUpperCase() : "") ||
    key.split("|")[0]?.trim().toUpperCase() ||
    "";
  const primaryKeys = new Set<string>([key]);
  if (row) {
    for (const aliasKey of rowAliasKeys(inputs, row)) primaryKeys.add(aliasKey);
  }
  const keysToClose = new Set<string>(primaryKeys);
  if (ticker) {
    for (const k of companyBookKeys(inputs, ticker)) keysToClose.add(k);
  }

  const next: InvestSimInputs = { ...inputs };
  for (const closeKey of keysToClose) {
    const aliasPrev = inputs[closeKey] ?? (primaryKeys.has(closeKey) ? prev : undefined);
    // Keep prior realized deals on other CD keys (piggy bank); only force-close opens.
    if (
      aliasPrev?.ignoreSheet &&
      aliasPrev.soldAt &&
      aliasPrev.closedPnlEur != null &&
      Number.isFinite(aliasPrev.closedPnlEur) &&
      !primaryKeys.has(closeKey)
    ) {
      next[closeKey] = sanitizeInvestSimEntry({
        ...aliasPrev,
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
      });
      continue;
    }
    next[closeKey] = closedSimEntry(
      aliasPrev?.investedAt ?? prev?.investedAt,
      aliasPrev?.purchaseDate ?? prev?.purchaseDate,
      soldAt,
      primaryKeys.has(closeKey) ? exit : undefined,
    );
  }
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
  return executePortfolioSellSync(opts);
}

/** Same as executePortfolioSell but awaits disk persist (server / Electron). */
export async function executePortfolioSellAsync(opts: {
  key: string;
  simRow?: Record<string, unknown> | null;
  simTable?: SheetTable | null;
  inputs?: InvestSimInputs;
  confirm?: boolean;
  recordHistory?: boolean;
}): Promise<PortfolioSellResult> {
  const result = executePortfolioSellSync(opts);
  if (!result.ok) return result;
  const diskPersisted = await persistInvestSimInputsNow(result.inputs);
  if (opts.recordHistory !== false) {
    /* history already written in sync path when ok */
  }
  return { ...result, diskPersisted };
}

function executePortfolioSellSync(opts: {
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

  const inputsBeforeConfirm = mergeInvestSimInputs(
    reloadInvestSimInputsSnapshotFromStorage(),
    opts.inputs ?? {},
  );
  if (!rowHasActivePortfolio(row, inputsBeforeConfirm)) {
    return { ok: false, reason: "not_in_portfolio" };
  }

  const pos = computeSimulationPosition(row, inputsBeforeConfirm);
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

  // Merge fresh snapshot with caller hint so React-only edits are not lost.
  const inputs = mergeInvestSimInputs(
    reloadInvestSimInputsSnapshotFromStorage(),
    opts.inputs ?? {},
  );
  if (!rowHasActivePortfolio(row, inputs)) {
    return { ok: false, reason: "not_in_portfolio" };
  }

  const exit: ClosedSimExitSnapshot & { pnlPct: number } = {
    closedCapital: pos.capital,
    closedValue: pos.pnlUnavailable ? undefined : pos.valueNow,
    closedPnlEur: pos.pnlUnavailable ? undefined : pos.pnlEur,
    pnlPct: pos.pnlUnavailable ? 0 : pos.pnlPct,
  };

  const next = applyPortfolioSellPatch(inputs, opts.key, simRows, exit);
  saveInvestSimInputs(sanitizeInvestSimInputs(next));

  if (opts.recordHistory !== false) {
    recordSoldPositionExit(opts.simTable ?? null, next, opts.key, exit);
  }

  return { ok: true, inputs: next, key: opts.key, diskPersisted: false };
}

/** User-visible feedback after Sell (failures + disk persist warning). */
export function notifyPortfolioSellResult(
  result: PortfolioSellResult | void,
  t: (key: TranslationKey) => string,
): boolean {
  if (!result) return false;
  if (!result.ok) {
    if (result.reason === "cancelled") return false;
    const msg =
      result.reason === "no_row"
        ? t("sim.pnl.sellFailed.noRow")
        : result.reason === "not_in_portfolio"
          ? t("sim.pnl.sellFailed.notInPortfolio")
          : result.reason === "no_capital"
            ? t("sim.pnl.sellFailed.noCapital")
            : t("sim.pnl.sellFailed.generic");
    if (msg && typeof window !== "undefined") window.alert(msg);
    return false;
  }
  if (!result.diskPersisted && typeof window !== "undefined") {
    window.alert(t("sim.pnl.sellDiskPersistFailed"));
  }
  return true;
}
