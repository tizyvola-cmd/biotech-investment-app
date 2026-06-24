import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";
import { buyPriceLooksInconsistent } from "./portfolioGainLossStyle";
import {
  buyPriceForPnl,
  currentPriceFromRow,
  mergedSimInputs,
  resolveEffectiveBuyPrice,
  sheetBuyPriceFromRow,
  sheetPnlPct,
  type SimulationPosition,
} from "./simulationPosition";

export type BuyPriceAuditSource =
  | "local"
  | "sheet"
  | "inferred_pnl"
  | "inferred_value"
  | "history"
  | "reconciled"
  | "missing";

export type SimulationBuyPriceAudit = {
  key: string;
  ticker: string;
  localBuy: number;
  sheetBuy: number | null;
  curr: number | null;
  effectiveBuy: number;
  displayedBuy: number;
  source: BuyPriceAuditSource;
  /** Buy used for P&L differs from what user saved locally. */
  driftFromLocal: boolean;
  /** Buy vs spot ratio looks wrong (stale high buy or bad inference). */
  inconsistentWithSpot: boolean;
  sheetPnlPct: number | null;
  note: string;
};

const BUY_CURR_EPS = 0.001;

function buyAnchored(buy: number, curr: number | null): boolean {
  if (buy <= 0 || curr == null || curr <= 0) return false;
  return Math.abs(buy - curr) / curr <= BUY_CURR_EPS;
}

function inferBuyFromSheetPnl(curr: number, sheetPct: number): number {
  return curr / (1 + sheetPct / 100);
}

/**
 * Explains which buy price drives P&L for a Simulation row (debug / UI tooltips).
 */
export function auditSimulationBuyPrice(
  row: Record<string, unknown>,
  rawInp: InvestSimInputEntry | undefined,
  position: Pick<SimulationPosition, "key" | "ticker" | "buyPrice" | "capital" | "currPrice" | "pnlPct">,
  history?: InvestSimHistoryPoint[] | null,
): SimulationBuyPriceAudit {
  const inp = rawInp ?? { buyPrice: 0, capital: 0 };
  const merged = mergedSimInputs(row, inp);
  const localBuy = buyPriceForPnl(merged);
  const sheetBuy = sheetBuyPriceFromRow(row);
  const curr = currentPriceFromRow(row);
  const sheetPct = sheetPnlPct(row);
  const effective = resolveEffectiveBuyPrice(row, merged, position.key, history);
  const displayed = position.buyPrice > 0 ? position.buyPrice : effective;

  let source: BuyPriceAuditSource = "missing";
  let note = "";

  if (localBuy > 0 && Math.abs(localBuy - displayed) < 0.02) {
    source = "local";
    note = "Prezzo salvato in Simulation (Buy $).";
  } else if (sheetBuy != null && sheetBuy > 0 && Math.abs(sheetBuy - displayed) < 0.02) {
    source = "sheet";
    note = "Prezzo da foglio Excel «Prezzo Acquisto ($)».";
  } else if (
    curr != null &&
    curr > 0 &&
    sheetPct != null &&
    Math.abs(sheetPct) > 0.05 &&
    Math.abs(inferBuyFromSheetPnl(curr, sheetPct) - displayed) < 0.15
  ) {
    source = "inferred_pnl";
    note = `Ricostruito da P&L foglio (${sheetPct.toFixed(1)}%) — può essere obsoleto se hai comprato oggi.`;
  } else if (localBuy > 0) {
    source = "reconciled";
    note = `Buy locale $${localBuy.toFixed(2)} sostituito da $${displayed.toFixed(2)} (mark-to-market / storico).`;
  } else if (displayed > 0) {
    source = "reconciled";
    note = "Prezzo di carico da riconciliazione automatica.";
  } else {
    note = "Nessun prezzo acquisto — inserisci Buy $ in Simulation.";
  }

  const driftFromLocal = localBuy > 0 && Math.abs(localBuy - displayed) > 0.02;
  const inconsistentWithSpot = buyPriceLooksInconsistent(displayed, curr);

  if (driftFromLocal && buyAnchored(localBuy, curr) && source === "inferred_pnl") {
    note =
      "Ingresso al prezzo di oggi ma P&L % del foglio è ancora vecchio → buy gonfiato. Usa Buy $ corretto o refresh foglio.";
  }

  return {
    key: position.key,
    ticker: position.ticker,
    localBuy,
    sheetBuy,
    curr,
    effectiveBuy: effective,
    displayedBuy: displayed,
    source,
    driftFromLocal,
    inconsistentWithSpot,
    sheetPnlPct: sheetPct,
    note,
  };
}
