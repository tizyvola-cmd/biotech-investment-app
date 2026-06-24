import type {
  InvestSimHistoryPoint,
  InvestSimInputEntry,
  InvestSimInputs,
} from "./investSimStorage";
import { loadInvestSimHistory, resolveInvestedAt } from "./investSimStorage";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import type { SheetTable } from "../types";
import { buyPriceLooksInconsistent } from "./portfolioGainLossStyle";
import { isUsEquitySessionDay } from "./marketSession";

export const SIM_PNL_NA_TOOLTIP =
  "Current price not available — refresh the Simulation sheet or wait for the price refresh.";

export const SIM_BUY_PRICE_MISSING_TOOLTIP =
  "Enter a buy price (Buy €) to calculate P&L. Use Refresh data (not Reload) to update market prices from Yahoo.";

export const SIM_COMPUTED_COLUMNS = [
  "N° Azioni Implicite",
  "Valore Attuale ($)",
  "P&L ($)",
  "P&L (%)",
] as const;

const PNL_EPS_EUR = 0.01;
const PNL_EPS_PCT = 0.05;
/** Buy ≈ current (same-day backfill) — prefer sheet / history entry. */
const BUY_CURR_EPS_RATIO = 0.001;

/** Storico coerente (value = cap·(1+p%)) faceva degenerare sqrt(cap²·(1+p)/v) → √cap. */
function buyIsStaleSpotBackfill(
  buy: number,
  curr: number,
  investedAtIso?: string | null,
): boolean {
  return buyAnchoredToCurrentPrice(buy, curr) && !isInvestedToday(investedAtIso);
}

/** buy × shares = capital, shares × spot = valueNow, pnl = valueNow − capital. */
function enforceMarkToMarketCoherence(
  draft: MarkToMarketDraft,
  curr: number,
): MarkToMarketDraft {
  const { buyPrice, capital } = draft;
  if (buyPrice <= 0 || capital <= 0 || curr <= 0) return draft;
  const shares = capital / buyPrice;
  const valueNow = Math.round(shares * curr * 100) / 100;
  const pnlEur = Math.round((valueNow - capital) * 100) / 100;
  const pnlPct = positionCapitalPnlPct(pnlEur, capital) ?? 0;
  return { ...draft, shares, valueNow, pnlEur, pnlPct };
}

/** P&L % on invested capital — allineato a Σ€ / capitale (tab P&L, bar chart, card). */
export function positionCapitalPnlPct(
  pnlEur: number | null | undefined,
  capital: number,
): number | null {
  if (capital <= 0 || pnlEur == null || !Number.isFinite(pnlEur)) return null;
  return Math.round((pnlEur / capital) * 10000) / 100;
}

/** Gain/perdita totale posizione in $ (shares × Δ prezzo). */
export function positionGainUsd(
  pos: Pick<SimulationPosition, "shares" | "currPrice" | "buyPrice"> | null | undefined,
): number | null {
  if (!pos || pos.shares <= 0 || pos.buyPrice <= 0) return null;
  const curr = pos.currPrice;
  if (curr == null || !Number.isFinite(curr) || curr <= 0) return null;
  return Math.round(pos.shares * (curr - pos.buyPrice) * 100) / 100;
}

function buyInferenceIsDegenerateSqrtCap(buy: number, capital: number): boolean {
  if (buy <= 0 || capital <= 0) return true;
  const root = Math.sqrt(capital);
  return Math.abs(buy - root) / root <= 0.03;
}

/** Buy implicito da snapshot portfolio: shares = cap/buy, value = shares·price. */
function inferredBuyFromHistorySnap(
  capital: number,
  curr: number,
  snap: { value: number; pnlPct: number },
): number | null {
  if (capital <= 0 || curr <= 0 || snap.value <= 0) return null;
  const buy = (capital * curr) / snap.value;
  if (!Number.isFinite(buy) || buy <= 0) return null;
  if (buyAnchoredToCurrentPrice(buy, curr)) return null;
  if (buyInferenceIsDegenerateSqrtCap(buy, capital)) return null;
  if (buyPriceLooksInconsistent(buy, curr)) return null;
  return buy;
}

export type SimulationPositionContext = {
  history?: InvestSimHistoryPoint[] | null;
};

export type SimulationPosition = {
  key: string;
  ticker: string;
  name: string;
  completionDate: string;
  currPrice: number | null;
  buyPrice: number;
  capital: number;
  shares: number;
  valueNow: number;
  pnlEur: number;
  pnlPct: number;
  /** P&L not computable: current price missing. */
  pnlUnavailable: boolean;
};

export function rowKey(ticker: string, cd: string) {
  return normalizedRowKey(ticker, cd);
}

export function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(String(v).replace(/\s/g, "").replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** First numeric cell among alternate Simulation column headers (export casing varies). */
export function firstParseNumFromRow(
  r: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const n = parseNum(r[k]);
    if (n != null) return n;
  }
  return null;
}

export function isSheetCellEmpty(v: unknown): boolean {
  return v == null || v === "" || v === "—" || v === "-" || v === "N/D";
}

/** Buy price for display placeholders (may fall back to current price). */
export function effectiveBuyPrice(
  inp: InvestSimInputEntry,
  curr: number | null
): number {
  if (inp.buyPrice > 0) return inp.buyPrice;
  if (curr != null && curr > 0) return curr;
  return 0;
}

/** Buy price used for P&L — never implicit current price. */
export function buyPriceForPnl(merged: { buyPrice: number }): number {
  return merged.buyPrice > 0 ? merged.buyPrice : 0;
}

/**
 * Buy € entered in Pick stocks — not a same-day spot backfill placeholder.
 * When present, MTM must use this price instead of inferring from Excel P&L columns.
 */
export function trustedUserEntryBuyUsd(
  rawInp: InvestSimInputEntry | undefined,
  curr: number | null,
  investedAtIso: string | null | undefined,
): number | null {
  if (!rawInp || rawInp.ignoreSheet) return null;
  const local = rawInp.buyPrice;
  if (local <= 0) return null;
  if (curr != null && curr > 0 && buyIsStaleSpotBackfill(local, curr, investedAtIso)) {
    return null;
  }
  return local;
}

/**
 * Entry buy for portfolio MTM — sheet Prezzo Acquisto, then Pick stocks Buy €.
 * Never infer from Excel P&L (%) / Valore Attuale or history snapshots.
 */
export function resolvePortfolioEntryBuyUsd(
  row: Record<string, unknown>,
  rawInp: InvestSimInputEntry | undefined,
  curr: number | null,
  investedAtIso: string | null | undefined,
): number {
  const sheetBuy = sheetBuyPriceFromRow(row);
  if (
    sheetBuy != null &&
    sheetBuy > 0 &&
    (curr == null || curr <= 0 || !buyAnchoredToCurrentPrice(sheetBuy, curr))
  ) {
    return sheetBuy;
  }

  const trusted = trustedUserEntryBuyUsd(rawInp, curr, investedAtIso);
  if (trusted != null) {
    if (curr != null && curr > 0) {
      const pricePct = ((curr - trusted) / trusted) * 100;
      const sheetPct = sheetPnlPct(row);
      if (
        sheetPct != null &&
        Math.abs(sheetPct) > 20 &&
        Math.abs(pricePct - sheetPct) < 8 &&
        Math.abs(pricePct) > 20
      ) {
        if (
          sheetBuy != null &&
          sheetBuy > 0 &&
          !buyAnchoredToCurrentPrice(sheetBuy, curr)
        ) {
          return sheetBuy;
        }
      }
    }
    return trusted;
  }

  if (sheetBuy != null && sheetBuy > 0) return sheetBuy;
  const local = rawInp?.buyPrice ?? 0;
  if (
    local > 0 &&
    (curr == null || curr <= 0 || !buyIsStaleSpotBackfill(local, curr, investedAtIso))
  ) {
    return local;
  }
  return 0;
}

/** @deprecated Use resolvePortfolioEntryBuyUsd — kept for callers that imported the old name. */
export function resolveEntryBuyForMarkToMarket(
  row: Record<string, unknown>,
  rawInp: InvestSimInputEntry | undefined,
  _capital: number,
  curr: number | null,
  investedAtIso: string | null | undefined,
  _history: InvestSimHistoryPoint[] | null | undefined,
  _key: string,
): number | null {
  const buy = resolvePortfolioEntryBuyUsd(row, rawInp, curr, investedAtIso);
  return buy > 0 ? buy : null;
}

export function priceMarkValueFromEntryBuy(
  capital: number,
  entryBuy: number | null,
  curr: number | null,
): number | null {
  if (capital <= 0 || entryBuy == null || entryBuy <= 0 || curr == null || curr <= 0) {
    return null;
  }
  return roundEur((capital / entryBuy) * curr);
}

/** Drift (pp) above which history is treated as contaminated (forces MTM total). */
export const HISTORY_CONTAMINATION_DRIFT_PP = 12;
/** Gray zone: drift above this but ≤ DRIFT → uncertain + MTM + UI flag. */
export const HISTORY_CONTAMINATION_UNCERTAIN_DRIFT_PP = 8;
/** Without buy/price, absolute |histPct| above this → contaminated. */
export const HISTORY_CONTAMINATION_NO_BUY_PP = 35;
/** Without buy/price, |histPct| in (UNCERTAIN_NO_BUY, NO_BUY] → uncertain. */
export const HISTORY_CONTAMINATION_UNCERTAIN_NO_BUY_PP = 25;

export type HistoryContaminationAssessment = {
  contaminated: boolean;
  uncertainContamination: boolean;
  histPct: number | null;
  pricePct: number | null;
  driftPp: number | null;
};

/**
 * Conservative contamination check — when buy+price exist, drift vs MTM wins over
 * the old «histPct must exceed 20%» gate (which missed moderate contamination).
 */
export function assessHistoryContamination(
  capital: number,
  closeSeries: TickerDailyClosePoint[],
  entryBuy: number | null,
  curr: number | null,
): HistoryContaminationAssessment {
  const empty = {
    contaminated: false,
    uncertainContamination: false,
    histPct: null as number | null,
    pricePct: null as number | null,
    driftPp: null as number | null,
  };
  if (capital <= 0) return empty;
  const todayKey = calendarDayKey(new Date());
  const prior = closeSeries
    .filter((pt) => pt.dayKey < todayKey)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (!prior.length) return empty;
  const lastClose = prior[prior.length - 1]!.value;
  const histPct = ((lastClose - capital) / capital) * 100;
  const priceMtm = priceMarkValueFromEntryBuy(capital, entryBuy, curr);
  if (priceMtm == null) {
    const absHist = Math.abs(histPct);
    return {
      contaminated: absHist > HISTORY_CONTAMINATION_NO_BUY_PP,
      uncertainContamination:
        absHist > HISTORY_CONTAMINATION_UNCERTAIN_NO_BUY_PP &&
        absHist <= HISTORY_CONTAMINATION_NO_BUY_PP,
      histPct,
      pricePct: null,
      driftPp: null,
    };
  }
  const pricePct = ((priceMtm - capital) / capital) * 100;
  const driftPp = Math.abs(histPct - pricePct);
  const contaminated = driftPp > HISTORY_CONTAMINATION_DRIFT_PP;
  const uncertainContamination =
    !contaminated &&
    driftPp > HISTORY_CONTAMINATION_UNCERTAIN_DRIFT_PP &&
    Math.abs(histPct) > 3;
  return { contaminated, uncertainContamination, histPct, pricePct, driftPp };
}

function historyCloseSeriesLooksContaminated(
  capital: number,
  closeSeries: TickerDailyClosePoint[],
  entryBuy: number | null,
  curr: number | null,
): boolean {
  const a = assessHistoryContamination(capital, closeSeries, entryBuy, curr);
  return a.contaminated || a.uncertainContamination;
}

/** Mark value aligned to audit export — history closes + Var.% for today. */
export function auditAlignedMarkValueEur(
  closeSeries: TickerDailyClosePoint[],
  dailyPct: number | null,
  fallbackValueNow: number,
): number {
  const todayKey = calendarDayKey(new Date());
  const prior = closeSeries
    .filter((pt) => pt.dayKey < todayKey)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (prior.length > 0) {
    const lastClose = prior[prior.length - 1]!.value;
    if (
      dailyPct != null &&
      Number.isFinite(dailyPct) &&
      isUsEquitySessionDay()
    ) {
      return roundEur(lastClose * (1 + dailyPct / 100));
    }
    if (fallbackValueNow > 0) return roundEur(fallbackValueNow);
    return roundEur(lastClose);
  }
  return roundEur(fallbackValueNow);
}

function resolveMtmValueForPositionLegs(
  pos: Pick<SimulationPosition, "key" | "valueNow" | "capital" | "currPrice">,
  row: Record<string, unknown> | undefined,
  inputs: InvestSimInputs | undefined,
  hist: InvestSimHistoryPoint[],
  investedAtIso: string | null | undefined,
): number {
  const dailyPct = row ? dailyChangePctFromRow(row) : null;
  const rawInp = inputs?.[pos.key];
  const curr = pos.currPrice ?? (row ? currentPriceFromRow(row) : null);
  const entryBuy = resolvePortfolioEntryBuyUsd(
    row ?? {},
    rawInp,
    curr,
    investedAtIso,
  );
  const priceMtm =
    priceMarkValueFromEntryBuy(pos.capital, entryBuy > 0 ? entryBuy : null, curr) ??
    pos.valueNow;
  const closeSeriesRaw = tickerDailyCloseSeries(hist, pos.key, investedAtIso);
  const histEntry = inferEntryCapitalFromHistory(hist, pos.key);
  const closeSeries = scaleCloseSeriesToEntryCapital(
    closeSeriesRaw,
    pos.capital,
    histEntry,
  );
  if (historyCloseSeriesLooksContaminated(pos.capital, closeSeries, entryBuy, curr)) {
    return priceMtm;
  }
  return auditAlignedMarkValueEur(closeSeries, dailyPct, priceMtm);
}

export function mergedSimInputs(
  r: Record<string, unknown>,
  inp: InvestSimInputEntry
): { buyPrice: number; capital: number } {
  if (inp.ignoreSheet) {
    return { buyPrice: 0, capital: 0 };
  }
  const hasLocal = inp.buyPrice > 0 || inp.capital > 0;
  if (hasLocal) {
    return {
      buyPrice: inp.buyPrice > 0 ? inp.buyPrice : 0,
      capital: inp.capital > 0 ? inp.capital : 0,
    };
  }
  const sheetBuy = firstParseNumFromRow(r, [
    "Prezzo Acquisto ($)",
    "Prezzo acquisto ($)",
  ]);
  const sheetCap = firstParseNumFromRow(r, [
    "Capitale Investito ($)",
    "Capitale investito ($)",
  ]);
  return {
    buyPrice: sheetBuy ?? 0,
    capital: sheetCap ?? 0,
  };
}

export function sheetPnlPct(r: Record<string, unknown>): number | null {
  const raw = parseNum(r["P&L (%)"]);
  if (raw === null) return null;
  return Math.abs(raw) <= 1.5 ? raw * 100 : raw;
}

export function currentPriceFromRow(r: Record<string, unknown>): number | null {
  return firstParseNumFromRow(r, [
    "Prezzo Corrente ($)",
    "Prezzo corrente ($)",
    "Prezzo Corrente",
    "Prezzo Attuale",
    "currentPrice",
  ]);
}

/** Nasdaq session open from Simulation row (live refresh / Yahoo). */
export function nasdaqOpenFromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Prezzo Apertura ($)"]) ??
    parseNum(r["Prezzo Apertura"]) ??
    parseNum(r["nasdaq_open_usd"]) ??
    parseNum(r["session_open_usd"]) ??
    parseNum(r["regularMarketOpen"]) ??
    null
  );
}

/** Last price refresh timestamp on the row (live signals or snapshot export). */
export function priceRefreshAtFromRow(r: Record<string, unknown>): string | null {
  for (const k of ["live_updated_at", "price_refresh_at", "live_signals_updated_at"]) {
    const raw = r[k];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

/** Prezzo acquisto da foglio Simulation (se valorizzato). */
export function sheetBuyPriceFromRow(r: Record<string, unknown>): number | null {
  return firstParseNumFromRow(r, ["Prezzo Acquisto ($)", "Prezzo acquisto ($)"]);
}

/** Daily price change % from Simulation sheet (Yahoo: vs previous close). */
export function dailyChangePctFromRow(r: Record<string, unknown>): number | null {
  const raw =
    parseNum(r["Var. Giorn. %"]) ??
    parseNum(r["Var. Giorn.%"]) ??
    parseNum(r["dailyChange_%"]) ??
    parseNum(r["Variazione giornaliera %"]);
  if (raw === null) return null;
  // «Var. Giorn. %» is already in percentage points (e.g. -0.47 = -0.47%, 1.82 = +1.82%).
  // Do not apply the pred5-style ×100 heuristic (|v|≤1.5) — it turns -0.47 into -47%.
  return raw;
}

/** € P&L from a daily % move on an open position (exact for price % = r). */
export function pnlEurFromDailyPct(valueNow: number, dailyPct: number): number {
  const denom = 100 + dailyPct;
  if (!Number.isFinite(valueNow) || !Number.isFinite(dailyPct) || denom === 0) return 0;
  return Math.round(((valueNow * dailyPct) / denom) * 100) / 100;
}

function calendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isHistoryPointFromToday(ts: string | null | undefined): boolean {
  if (!ts?.trim()) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return calendarDayKey(d) === calendarDayKey(new Date());
}

function buyAnchoredToCurrentPrice(buyPrice: number, curr: number | null): boolean {
  if (buyPrice <= 0 || curr == null || curr <= 0) return false;
  return Math.abs(buyPrice - curr) / curr <= BUY_CURR_EPS_RATIO;
}

function positionPnlIsFlat(pnlEur: number, pnlPct: number): boolean {
  return Math.abs(pnlEur) <= PNL_EPS_EUR && Math.abs(pnlPct) <= PNL_EPS_PCT;
}

/**
 * Prezzo di carico effettivo: evita buy=current (backfill) quando il foglio
 * o lo storico portfolio hanno un ingresso reale.
 */
export function resolveEffectiveBuyPrice(
  row: Record<string, unknown>,
  inp: { buyPrice: number; capital: number },
  key: string,
  history?: InvestSimHistoryPoint[] | null,
  investedAtIso?: string | null,
): number {
  const local = buyPriceForPnl(inp);
  const curr = currentPriceFromRow(row);
  const sheetBuy = sheetBuyPriceFromRow(row);

  if (local > 0) {
    if (curr == null || curr <= 0) return local;
    const anchored = buyAnchoredToCurrentPrice(local, curr);
    if (!anchored && !buyPriceLooksInconsistent(local, curr)) return local;
    if (anchored && isInvestedToday(investedAtIso)) return local;
  }

  if (sheetBuy != null && sheetBuy > 0) {
    if (!buyAnchoredToCurrentPrice(sheetBuy, curr) || buyAnchoredToCurrentPrice(local, curr)) {
      return sheetBuy;
    }
  }

  const sheetPct = sheetPnlPct(row);
  const dailyPctForBuy = dailyChangePctFromRow(row);
  if (
    buyAnchoredToCurrentPrice(local, curr) &&
    sheetPct != null &&
    Math.abs(sheetPct) > PNL_EPS_PCT &&
    curr != null &&
    curr > 0 &&
    (dailyPctForBuy == null || Math.abs(dailyPctForBuy) <= PNL_EPS_PCT) &&
    !buyIsStaleSpotBackfill(local, curr, investedAtIso)
  ) {
    const inferred = curr / (1 + sheetPct / 100);
    if (inferred > 0 && Number.isFinite(inferred) && !buyAnchoredToCurrentPrice(inferred, curr)) {
      return inferred;
    }
  }

  if (
    history?.length &&
    key &&
    curr != null &&
    curr > 0 &&
    !buyIsStaleSpotBackfill(local, curr, investedAtIso)
  ) {
    let best: { ts: number; buy: number } | null = null;
    for (const h of history) {
      const snap = h.byTicker[key];
      if (!snap || snap.pnlPct == null || Math.abs(snap.pnlPct) <= PNL_EPS_PCT) continue;
      const cap = inp.capital > 0 ? inp.capital : snap.value - snap.pnl;
      if (cap <= 0 || snap.value <= 0 || curr == null || curr <= 0) continue;
      const ts = Date.parse(h.ts);
      if (!Number.isFinite(ts)) continue;
      const buyFromSnap = inferredBuyFromHistorySnap(cap, curr, snap);
      if (buyFromSnap != null) {
        if (!best || ts < best.ts) best = { ts, buy: buyFromSnap };
      }
    }
    if (best) return best.buy;
  }

  const sheetVal = firstParseNumFromRow(row, [
    "Valore Attuale ($)",
    "Valore attuale ($)",
  ]);
  if (
    buyAnchoredToCurrentPrice(local, curr) &&
    sheetVal != null &&
    sheetVal > 0 &&
    inp.capital > 0 &&
    curr != null &&
    curr > 0
  ) {
    const buyFromVal = (inp.capital * curr) / sheetVal;
    if (
      buyFromVal > 0 &&
      Number.isFinite(buyFromVal) &&
      !buyAnchoredToCurrentPrice(buyFromVal, curr)
    ) {
      return buyFromVal;
    }
  }

  return local;
}

type MarkToMarketDraft = {
  buyPrice: number;
  capital: number;
  curr: number;
  valueNow: number;
  pnlEur: number;
  pnlPct: number;
  shares: number;
  key: string;
};

/**
 * When buy ≈ current (backfill / buy-today) but sheet or history show real P&L,
 * restore mark-to-market totals so «Total from entry» is not stuck at 0.
 */
function reconcileAnchoredBuyMarkToMarket(
  row: Record<string, unknown>,
  draft: MarkToMarketDraft,
  history?: InvestSimHistoryPoint[] | null,
  opts?: { explicitLocalBuy?: boolean; investedAtIso?: string | null },
): MarkToMarketDraft {
  const { buyPrice, capital, curr, key } = draft;
  if (capital <= 0 || curr <= 0) return draft;
  const anchored = buyAnchoredToCurrentPrice(buyPrice, curr);
  const dailyPctRow = dailyChangePctFromRow(row);
  const sheetPctRow = sheetPnlPct(row);
  /** Buy≈spot + Var. Giorn. attiva → non usare P&L % Excel spesso obsoleto (resta 0% totale vs giornata forte). */
  const preferDailyOverStaleSheet =
    anchored &&
    dailyPctRow != null &&
    Math.abs(dailyPctRow) > PNL_EPS_PCT &&
    (positionPnlIsFlat(draft.pnlEur, draft.pnlPct) ||
      (sheetPctRow != null && Math.abs(sheetPctRow) > PNL_EPS_PCT));

  if (anchored && !preferDailyOverStaleSheet) {
    if (sheetPctRow != null && Math.abs(sheetPctRow) > PNL_EPS_PCT) return draft;
    if (opts?.explicitLocalBuy && positionPnlIsFlat(draft.pnlEur, draft.pnlPct)) return draft;
  } else if (!anchored && !positionPnlIsFlat(draft.pnlEur, draft.pnlPct)) {
    return draft;
  }

  const preserveEntryBuy = Boolean(
    opts?.explicitLocalBuy &&
      buyPrice > 0 &&
      curr > 0 &&
      !buyPriceLooksInconsistent(buyPrice, curr) &&
      !buyIsStaleSpotBackfill(buyPrice, curr, opts?.investedAtIso),
  );

  const apply = (next: Partial<MarkToMarketDraft>): MarkToMarketDraft => {
    if (preserveEntryBuy) {
      return enforceMarkToMarketCoherence({ ...draft, buyPrice }, curr);
    }
    const buy = next.buyPrice ?? buyPrice;
    const shares = next.shares ?? (buy > 0 ? capital / buy : draft.shares);
    return { ...draft, ...next, buyPrice: buy, shares };
  };

  const sheetPct = sheetPnlPct(row);
  const sheetEur = parseNum(row["P&L ($)"]);
  const sheetVal = firstParseNumFromRow(row, [
    "Valore Attuale ($)",
    "Valore attuale ($)",
  ]);
  const hasPriorDayHistory = Boolean(
    history?.some(
      (h) =>
        !isHistoryPointFromToday(h.ts) &&
        (h.byTicker[key]?.value ?? 0) > 0,
    ),
  );

  /** Storico + Var. Giorn. % prima di Valore Attuale Excel — evita salti MTM con 24h invariato. */
  if (
    hasPriorDayHistory &&
    history?.length &&
    dailyPctRow != null &&
    Number.isFinite(dailyPctRow) &&
    !buyIsStaleSpotBackfill(buyPrice, curr, opts?.investedAtIso)
  ) {
    let priorValue: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const snap = history[i].byTicker[key];
      if (!snap || snap.value <= 0) continue;
      if (isHistoryPointFromToday(history[i].ts)) continue;
      priorValue = snap.value;
      break;
    }
    if (priorValue != null) {
      const valueNow = Math.round(priorValue * (1 + dailyPctRow / 100) * 100) / 100;
      const pnlEur = Math.round((valueNow - capital) * 100) / 100;
      const pnlPct = Math.round((pnlEur / capital) * 10000) / 100;
      if (!positionPnlIsFlat(pnlEur, pnlPct)) {
        const inferredBuy = (capital * curr) / valueNow;
        if (
          inferredBuy > 0 &&
          Number.isFinite(inferredBuy) &&
          !buyAnchoredToCurrentPrice(inferredBuy, curr)
        ) {
          return apply({
            buyPrice: inferredBuy,
            pnlEur,
            pnlPct,
            valueNow,
            shares: capital / inferredBuy,
          });
        }
        return apply({
          pnlEur,
          pnlPct,
          valueNow,
          shares: valueNow / curr,
        });
      }
    }
  }

  if (
    !hasPriorDayHistory &&
    !preferDailyOverStaleSheet &&
    sheetPct != null &&
    Math.abs(sheetPct) > PNL_EPS_PCT &&
    !buyIsStaleSpotBackfill(buyPrice, curr, opts?.investedAtIso)
  ) {
    const pnlPct = sheetPct;
    const pnlEur =
      sheetEur != null && Math.abs(sheetEur) > PNL_EPS_EUR
        ? sheetEur
        : Math.round(((capital * pnlPct) / 100) * 100) / 100;
    const valueNow =
      sheetVal != null && sheetVal > 0
        ? sheetVal
        : Math.round((capital + pnlEur) * 100) / 100;
    const inferredBuy = curr / (1 + pnlPct / 100);
    const buy =
      inferredBuy > 0 &&
      Number.isFinite(inferredBuy) &&
      !buyAnchoredToCurrentPrice(inferredBuy, curr)
        ? inferredBuy
        : buyPrice;
    return apply({
      buyPrice: buy,
      pnlPct,
      pnlEur,
      valueNow,
      shares: buy > 0 ? capital / buy : draft.shares,
    });
  }

  if (
    !hasPriorDayHistory &&
    sheetVal != null &&
    sheetVal > 0 &&
    Math.abs(sheetVal - capital) > PNL_EPS_EUR &&
    (!preferDailyOverStaleSheet || preserveEntryBuy)
  ) {
    const valueNow = sheetVal;
    const pnlEur = Math.round((valueNow - capital) * 100) / 100;
    const pnlPct = Math.round((pnlEur / capital) * 10000) / 100;
    const inferredBuy = (capital * curr) / valueNow;
    if (
      inferredBuy > 0 &&
      Number.isFinite(inferredBuy) &&
      !buyAnchoredToCurrentPrice(inferredBuy, curr)
    ) {
      return apply({
        buyPrice: inferredBuy,
        pnlEur,
        pnlPct,
        valueNow,
        shares: capital / inferredBuy,
      });
    }
    if (!positionPnlIsFlat(pnlEur, pnlPct)) {
      return apply({ pnlEur, pnlPct, valueNow, shares: valueNow / curr });
    }
  }

  if (history?.length && !buyIsStaleSpotBackfill(buyPrice, curr, opts?.investedAtIso)) {
    const dailyPct = dailyPctRow;
    let priorValue: number | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const snap = history[i].byTicker[key];
      if (!snap || snap.value <= 0) continue;
      if (isHistoryPointFromToday(history[i].ts)) continue;
      priorValue = snap.value;
      break;
    }
    if (
      !hasPriorDayHistory &&
      priorValue != null &&
      dailyPct != null &&
      Number.isFinite(dailyPct)
    ) {
      const valueNow = Math.round(priorValue * (1 + dailyPct / 100) * 100) / 100;
      const pnlEur = Math.round((valueNow - capital) * 100) / 100;
      const pnlPct = Math.round((pnlEur / capital) * 10000) / 100;
      if (!positionPnlIsFlat(pnlEur, pnlPct)) {
        const inferredBuy = (capital * curr) / valueNow;
        if (
          inferredBuy > 0 &&
          Number.isFinite(inferredBuy) &&
          !buyAnchoredToCurrentPrice(inferredBuy, curr)
        ) {
          return apply({
            buyPrice: inferredBuy,
            pnlEur,
            pnlPct,
            valueNow,
            shares: capital / inferredBuy,
          });
        }
        return apply({
          pnlEur,
          pnlPct,
          valueNow,
          shares: valueNow / curr,
        });
      }
    }

    for (let i = history.length - 1; i >= 0; i--) {
      const snap = history[i].byTicker[key];
      if (!snap || snap.value <= 0 || snap.pnlPct == null) continue;
      if (Math.abs(snap.pnlPct) <= PNL_EPS_PCT) continue;
      const buyFromSnap = inferredBuyFromHistorySnap(capital, curr, snap);
      if (buyFromSnap != null) {
        const shares = capital / buyFromSnap;
        const valueNow = Math.round(shares * curr * 100) / 100;
        const pnlEur = Math.round((valueNow - capital) * 100) / 100;
        const pnlPct =
          Math.round(((curr - buyFromSnap) / buyFromSnap) * 10000) / 100;
        return apply({
          buyPrice: buyFromSnap,
          valueNow,
          pnlEur,
          pnlPct,
          shares,
        });
      }
    }
  }

  const dailyPct = dailyPctRow;
  if (
    dailyPct != null &&
    Math.abs(dailyPct) > PNL_EPS_PCT &&
    (positionPnlIsFlat(draft.pnlEur, draft.pnlPct) || preferDailyOverStaleSheet) &&
    (!hasPriorDayHistory || preferDailyOverStaleSheet)
  ) {
    const basis = draft.valueNow > 0 ? draft.valueNow : capital;
    const pnlEur = pnlEurFromDailyPct(basis, dailyPct);
    const pnlPct = Math.round(dailyPct * 100) / 100;
    if (!positionPnlIsFlat(pnlEur, pnlPct)) {
      const valueNow = Math.round((capital + pnlEur) * 100) / 100;
      const keepEntryBuy =
        preferDailyOverStaleSheet &&
        opts?.explicitLocalBuy &&
        !buyIsStaleSpotBackfill(buyPrice, curr, opts?.investedAtIso);
      const inferredBuy = curr / (1 + pnlPct / 100);
      const buy = keepEntryBuy
        ? buyPrice
        : inferredBuy > 0 &&
            Number.isFinite(inferredBuy) &&
            !buyAnchoredToCurrentPrice(inferredBuy, curr) &&
            !buyInferenceIsDegenerateSqrtCap(inferredBuy, capital)
          ? inferredBuy
          : buyPrice;
      const shares =
        buy > 0 ? capital / buy : valueNow > 0 && curr > 0 ? valueNow / curr : draft.shares;
      const mtmValue =
        buy > 0 && curr > 0
          ? Math.round(shares * curr * 100) / 100
          : valueNow;
      const mtmPnlEur = Math.round((mtmValue - capital) * 100) / 100;
      const finalPnlEur = keepEntryBuy ? mtmPnlEur : pnlEur;
      const finalPnlPct = positionCapitalPnlPct(finalPnlEur, capital) ?? pnlPct;
      return apply({
        buyPrice: buy,
        pnlEur: finalPnlEur,
        pnlPct: finalPnlPct,
        valueNow: keepEntryBuy ? mtmValue : valueNow,
        shares,
      });
    }
  }

  return enforceMarkToMarketCoherence(draft, curr);
}

/** True se la posizione è stata aperta nel giorno di calendario corrente (locale). */
export function isInvestedToday(investedAtIso: string | null | undefined): boolean {
  if (!investedAtIso?.trim()) return false;
  const d = new Date(investedAtIso);
  if (Number.isNaN(d.getTime())) return false;
  return calendarDayKey(d) === calendarDayKey(new Date());
}

export type PositionDailyPnlSource = "entry_today" | "history" | "sheet" | "none";

export type PositionHistoryBaseline = {
  value: number;
  pnl?: number;
  pnlPct?: number;
  /** ISO dello snapshot — baseline intraday (oggi) non è «giornata trading». */
  ts?: string;
};

export type PositionPnlTotalSource =
  | "daily_close_sum"
  | "entry_today"
  | "price_mtm_contaminated_history"
  | "price_mtm_uncertain_history";

export type TickerDailyClosePoint = {
  dayKey: string;
  value: number;
  ts: string;
};

export type PositionPnlBreakdown = {
  /** Somma gain giornalieri (chiusure) oppure mark-to-market se storico insufficiente. */
  totalEur: number;
  totalPct: number;
  pnlEurToday: number | null;
  pnlPctToday: number | null;
  hasToday: boolean;
  todaySource: PositionDailyPnlSource;
  totalSource: PositionPnlTotalSource;
  /** Numero di delta giornalieri inclusi nel totale (ultimo = oggi). */
  dailyLegCount: number;
  /** Valore posizione all'ingresso (capitale). */
  entryValue: number;
  /** Valore a inizio ultima giornata (chiusura precedente). */
  priorValue: number | null;
  /** Somma gain giorni prima dell'ultimo delta (total − today). */
  priorLegEur: number | null;
  /** Chiusure storiche registrate prima di oggi (per ticker). */
  priorCloseCount: number;
  /** Last stored close % disagrees with price MTM beyond drift threshold. */
  historyContaminated: boolean;
  /** Gray-zone drift — MTM forced and UI should warn. */
  historyUncertainContamination: boolean;
  /** `priorLegEur` is total − today, not Σ verified daily closes. */
  priorLegIsImplicitEstimate: boolean;
  /** Δ valore vs ultimo snapshot portfolio salvato (trend tra letture). */
  pnlEurSinceReading: number | null;
  pnlPctSinceReading: number | null;
  priorReadingTs: string | null;
  hasReadingDelta: boolean;
};

/** Prior leg is an algebraic residual (total − today), not verified daily closes. */
export function priorLegIsImplicitEstimate(
  breakdown: Pick<
    PositionPnlBreakdown,
    | "totalSource"
    | "priorCloseCount"
    | "historyContaminated"
    | "historyUncertainContamination"
    | "priorLegIsImplicitEstimate"
  >,
): boolean {
  if (breakdown.priorLegIsImplicitEstimate) return true;
  if (breakdown.historyContaminated || breakdown.historyUncertainContamination) return true;
  if (
    breakdown.totalSource === "price_mtm_contaminated_history" ||
    breakdown.totalSource === "price_mtm_uncertain_history"
  ) {
    return true;
  }
  return breakdown.priorCloseCount === 0 && breakdown.totalSource !== "entry_today";
}

export type PositionReadingDelta = {
  pnlEur: number;
  pnlPct: number;
  priorValue: number;
  priorTs: string;
};

const READING_VALUE_EPS_EUR = 0.02;

/** Baseline = ultimo snapshot storico con valore diverso dal mark attuale. */
export function computePositionReadingDelta(
  valueNow: number,
  history: InvestSimHistoryPoint[],
  key: string,
): PositionReadingDelta | null {
  if (valueNow <= 0 || !history.length || !key.trim()) return null;

  for (let i = history.length - 1; i >= 0; i--) {
    const snap = history[i].byTicker[key];
    if (!snap || snap.value <= 0) continue;
    if (Math.abs(snap.value - valueNow) <= READING_VALUE_EPS_EUR) continue;
    const pnlEur = roundEur(valueNow - snap.value);
    const pnlPct = Math.round((pnlEur / snap.value) * 10000) / 100;
    return {
      pnlEur,
      pnlPct,
      priorValue: snap.value,
      priorTs: history[i].ts,
    };
  }
  return null;
}

function attachReadingDelta(
  breakdown: Omit<
    PositionPnlBreakdown,
    "pnlEurSinceReading" | "pnlPctSinceReading" | "priorReadingTs" | "hasReadingDelta"
  >,
  valueNow: number,
  history: InvestSimHistoryPoint[] | null | undefined,
  key: string,
): PositionPnlBreakdown {
  const reading = computePositionReadingDelta(valueNow, history ?? [], key);
  return {
    ...breakdown,
    pnlEurSinceReading: reading?.pnlEur ?? null,
    pnlPctSinceReading: reading?.pnlPct ?? null,
    priorReadingTs: reading?.priorTs ?? null,
    hasReadingDelta: reading != null,
  };
}

/** Serie valori posizione (€) a chiusura per giorno di calendario, dall'ingresso. */
export function tickerDailyCloseSeries(
  history: InvestSimHistoryPoint[],
  key: string,
  investedAtIso: string | null | undefined,
): TickerDailyClosePoint[] {
  if (!history.length || !key) return [];
  const investDay = investedAtIso?.trim()
    ? calendarDayKey(new Date(investedAtIso))
    : "";
  const byDay = new Map<string, TickerDailyClosePoint>();
  for (const h of history) {
    const snap = h.byTicker[key];
    if (!snap || snap.value <= 0) continue;
    const d = new Date(h.ts);
    if (Number.isNaN(d.getTime())) continue;
    const dayKey = calendarDayKey(d);
    if (!dayKey) continue;
    if (investDay && dayKey < investDay) continue;
    byDay.set(dayKey, { dayKey, value: snap.value, ts: h.ts });
  }
  return [...byDay.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

export type SumDailyCloseResult = {
  totalEur: number;
  totalPct: number;
  pnlEurToday: number | null;
  pnlPctToday: number | null;
  hasToday: boolean;
  priorValue: number | null;
  priorLegEur: number | null;
  dailyLegCount: number;
  /** Chiusure registrate prima di oggi (no lump inventati). */
  priorCloseCount: number;
  todayFromSheet: boolean;
};

export type PositionDailyPnlLeg = {
  dayKey: string;
  pnlEur: number;
  pnlPct: number | null;
  isToday: boolean;
};

/** Delta P&L giorno per giorno (chiusure storico + oggi). */
export function buildPositionDailyPnlLegs(
  entryValue: number,
  valueNow: number,
  series: TickerDailyClosePoint[],
  opts?: { investDayKey?: string; dailyPct?: number | null },
): PositionDailyPnlLeg[] {
  const todayKey = calendarDayKey(new Date());
  const investDayKey = opts?.investDayKey?.trim() ?? "";
  const priorSeries = series
    .filter((pt) => pt.dayKey < todayKey)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  let prev = entryValue;
  const legs: PositionDailyPnlLeg[] = [];
  let seededFromFirstSnap = false;

  for (const pt of priorSeries) {
    if (!seededFromFirstSnap && investDayKey && pt.dayKey > investDayKey) {
      prev = pt.value;
      seededFromFirstSnap = true;
      continue;
    }
    const pnlEur = roundEur(pt.value - prev);
    legs.push({
      dayKey: pt.dayKey,
      pnlEur,
      pnlPct: prev > 0 ? Math.round((pnlEur / prev) * 10000) / 100 : null,
      isToday: false,
    });
    prev = pt.value;
    seededFromFirstSnap = true;
  }

  if (!isUsEquitySessionDay()) {
    return legs;
  }

  const sheetDailyToday =
    opts?.dailyPct != null && Number.isFinite(opts.dailyPct) && valueNow > 0
      ? pnlEurFromDailyPct(valueNow, opts.dailyPct)
      : null;
  const closeDeltaToday =
    priorSeries.length > 0
      ? roundEur(valueNow - prev)
      : roundEur(valueNow - entryValue);

  let pnlEurToday: number;
  let priorForTodayPct = priorSeries.length > 0 ? prev : entryValue;
  // Var. Giorn. % (Yahoo) è la fonte per il gain 24h; valueNow può coincidere
  // con l'ultima chiusura storico se il refresh prezzi non ha aggiornato il mark.
  if (sheetDailyToday != null) {
    pnlEurToday = sheetDailyToday;
    priorForTodayPct = roundEur(valueNow - pnlEurToday);
  } else {
    pnlEurToday = closeDeltaToday;
    if (priorSeries.length === 0) priorForTodayPct = entryValue;
  }

  legs.push({
    dayKey: todayKey,
    pnlEur: pnlEurToday,
    pnlPct:
      priorForTodayPct > 0
        ? Math.round((pnlEurToday / priorForTodayPct) * 10000) / 100
        : entryValue > 0 && priorSeries.length === 0
          ? Math.round((pnlEurToday / entryValue) * 10000) / 100
          : null,
    isToday: true,
  });

  return legs;
}

/**
 * Total = Σ delta tra chiusure consecutive **registrate** + oggi.
 * - Ogni snapshot pre-oggi = una chiusura; il primo dopo l'ingresso non crea lump fittizio.
 * - Senza chiusure precedenti: oggi da Var. Giorn. % (se presente), total = oggi (prior = 0).
 */
export function sumPnlFromDailyCloseSeries(
  entryValue: number,
  valueNow: number,
  series: TickerDailyClosePoint[],
  opts?: { investDayKey?: string; dailyPct?: number | null },
): SumDailyCloseResult {
  const priorSeries = series
    .filter((pt) => pt.dayKey < calendarDayKey(new Date()))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const legs = buildPositionDailyPnlLegs(entryValue, valueNow, series, opts);
  const priorLegs = legs.filter((l) => !l.isToday);
  const todayLeg = legs.find((l) => l.isToday);
  const priorLegEur =
    priorLegs.length > 0 ? roundEur(priorLegs.reduce((a, l) => a + l.pnlEur, 0)) : 0;
  const pnlEurToday = todayLeg?.pnlEur ?? null;
  const totalEur = roundEur(priorLegEur + (pnlEurToday ?? 0));
  const totalPct =
    entryValue > 0 ? Math.round((totalEur / entryValue) * 10000) / 100 : 0;
  const priorValue =
    pnlEurToday != null ? roundEur(valueNow - pnlEurToday) : null;
  const todayFromSheet =
    opts?.dailyPct != null &&
    Number.isFinite(opts.dailyPct) &&
    valueNow > 0;

  return {
    totalEur,
    totalPct,
    pnlEurToday,
    pnlPctToday: todayLeg?.pnlPct ?? null,
    hasToday: pnlEurToday != null,
    priorValue,
    priorLegEur,
    dailyLegCount: legs.length,
    priorCloseCount: priorSeries.length,
    todayFromSheet,
  };
}

/** Ultimo snapshot per ticker prima di oggi (non solo «ieri» a livello portfolio). */
export function priorTickerSnapshotBeforeToday(
  history: InvestSimHistoryPoint[],
  key: string,
): PositionHistoryBaseline | null {
  if (!history.length || !key) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (isHistoryPointFromToday(h.ts)) continue;
    const snap = h.byTicker[key];
    if (!snap || snap.value <= 0) continue;
    return {
      value: snap.value,
      pnl: snap.pnl,
      pnlPct: snap.pnlPct,
      ts: h.ts,
    };
  }
  return null;
}

/**
 * Motore unico tab P&L — somma delta giornalieri (chiusure storico + oggi).
 * Identità: total = priorLeg + today; senza chiusure precedenti total = today.
 */
export function resolvePositionPnlBreakdown(
  pos: Pick<
    SimulationPosition,
    "key" | "valueNow" | "pnlEur" | "pnlPct" | "pnlUnavailable" | "buyPrice" | "capital" | "currPrice"
  >,
  simRow: Record<string, unknown> | undefined,
  investedAtIso: string | null | undefined,
  history?: InvestSimHistoryPoint[] | null,
  inputs?: InvestSimInputs,
): PositionPnlBreakdown {
  const entryValue = pos.capital > 0 ? pos.capital : 0;
  const emptyHistoryFlags = {
    historyContaminated: false,
    historyUncertainContamination: false,
    priorLegIsImplicitEstimate: false,
  };
  const emptyToday = {
    pnlEurToday: null as number | null,
    pnlPctToday: null as number | null,
    hasToday: false,
    todaySource: "none" as const,
    totalSource: "daily_close_sum" as const,
    dailyLegCount: 0,
    priorValue: null as number | null,
    priorLegEur: null as number | null,
    priorCloseCount: 0,
    ...emptyHistoryFlags,
  };
  if (pos.pnlUnavailable || pos.buyPrice <= 0 || entryValue <= 0) {
    return attachReadingDelta(
      {
        totalEur: 0,
        totalPct: 0,
        entryValue,
        ...emptyToday,
      },
      pos.valueNow,
      history,
      pos.key,
    );
  }

  if (isInvestedToday(investedAtIso)) {
    const totalEur = roundEur(pos.valueNow - entryValue);
    const totalPct =
      entryValue > 0 ? Math.round((totalEur / entryValue) * 10000) / 100 : 0;
    return attachReadingDelta(
      {
        totalEur,
        totalPct,
        entryValue,
        pnlEurToday: totalEur,
        pnlPctToday: totalPct,
        hasToday: true,
        todaySource: "entry_today",
        totalSource: "entry_today",
        dailyLegCount: 1,
        priorValue: entryValue,
        priorLegEur: 0,
        priorCloseCount: 0,
        historyContaminated: false,
        historyUncertainContamination: false,
        priorLegIsImplicitEstimate: false,
      },
      pos.valueNow,
      history,
      pos.key,
    );
  }

  const hist = resolvePortfolioHistory(history);
  const investDayKey = investedAtIso?.trim()
    ? calendarDayKey(new Date(investedAtIso))
    : "";
  const dailyPct = simRow ? dailyChangePctFromRow(simRow) : null;
  const mtmValue = resolveMtmValueForPositionLegs(
    pos,
    simRow,
    inputs,
    hist,
    investedAtIso,
  );
  const closeSeriesRaw = tickerDailyCloseSeries(hist, pos.key, investedAtIso);
  const histEntry = inferEntryCapitalFromHistory(hist, pos.key);
  const closeSeries = scaleCloseSeriesToEntryCapital(closeSeriesRaw, entryValue, histEntry);
  const summed = sumPnlFromDailyCloseSeries(entryValue, mtmValue, closeSeries, {
    investDayKey,
    dailyPct,
  });
  const todaySource: PositionDailyPnlSource = summed.todayFromSheet
    ? "sheet"
    : summed.priorCloseCount > 0
      ? "history"
      : dailyPct != null
        ? "sheet"
        : "history";

  const rawInp = inputs?.[pos.key];
  const curr = pos.currPrice ?? (simRow ? currentPriceFromRow(simRow) : null);
  const entryBuy = resolvePortfolioEntryBuyUsd(
    simRow ?? {},
    rawInp,
    curr,
    investedAtIso,
  );
  const assessment = assessHistoryContamination(
    entryValue,
    closeSeries,
    entryBuy > 0 ? entryBuy : null,
    curr,
  );
  const forceMtmTotal =
    assessment.contaminated ||
    assessment.uncertainContamination ||
    (summed.priorCloseCount === 0 && !isInvestedToday(investedAtIso));

  let totalEur = summed.totalEur;
  let totalPct = summed.totalPct;
  let priorLegEur = summed.priorLegEur;
  let totalSource: PositionPnlTotalSource = "daily_close_sum";
  if (forceMtmTotal) {
    totalEur = roundEur(mtmValue - entryValue);
    totalPct =
      entryValue > 0 ? Math.round((totalEur / entryValue) * 10000) / 100 : 0;
    if (summed.hasToday && summed.pnlEurToday != null) {
      priorLegEur = roundEur(totalEur - summed.pnlEurToday);
    }
    if (assessment.contaminated) {
      totalSource = "price_mtm_contaminated_history";
    } else if (assessment.uncertainContamination) {
      totalSource = "price_mtm_uncertain_history";
    }
  }

  const priorLegIsImplicitEstimate =
    forceMtmTotal &&
    summed.hasToday &&
    summed.pnlEurToday != null &&
    (summed.priorCloseCount === 0 ||
      assessment.contaminated ||
      assessment.uncertainContamination);

  return attachReadingDelta(
    {
      totalEur,
      totalPct,
      entryValue,
      pnlEurToday: summed.pnlEurToday,
      pnlPctToday: summed.pnlPctToday,
      hasToday: summed.hasToday,
      todaySource,
      totalSource,
      dailyLegCount: summed.dailyLegCount,
      priorValue: summed.priorValue,
      priorLegEur,
      priorCloseCount: summed.priorCloseCount,
      historyContaminated: assessment.contaminated,
      historyUncertainContamination: assessment.uncertainContamination,
      priorLegIsImplicitEstimate,
    },
    mtmValue,
    hist,
    pos.key,
  );
}

/** Totali riga per Σ portafoglio — identità total = prior + today; MTM solo senza storico. */
export function resolveAggregatePositionPnl(
  pos: Pick<SimulationPosition, "pnlEur" | "pnlUnavailable" | "capital">,
  breakdown: Pick<
    PositionPnlBreakdown,
    "hasToday" | "pnlEurToday" | "priorLegEur" | "priorCloseCount" | "totalEur" | "dailyLegCount"
  >,
): { totalEur: number; priorLegEur: number; pnlEurToday: number } | null {
  if (pos.pnlUnavailable || pos.capital <= 0) return null;
  const hasToday = breakdown.hasToday && breakdown.pnlEurToday != null;
  const today = hasToday ? breakdown.pnlEurToday! : 0;
  const priorFromLegs = breakdown.priorLegEur ?? 0;
  const legTotal = roundEur(priorFromLegs + (hasToday ? today : 0));

  if (hasToday) {
    return { totalEur: legTotal, priorLegEur: priorFromLegs, pnlEurToday: today };
  }
  if (breakdown.priorCloseCount > 0) {
    return { totalEur: legTotal, priorLegEur: priorFromLegs, pnlEurToday: 0 };
  }
  return { totalEur: roundEur(pos.pnlEur), priorLegEur: 0, pnlEurToday: 0 };
}

export type PortfolioTickerDailyRow = {
  key: string;
  ticker: string;
  completionDate: string;
  capital: number;
  legs: PositionDailyPnlLeg[];
  /** Somma di tutte le gambe giornaliere — deve coincidere con Σ colonne giorno. */
  totalEur: number;
  pnlByDay: Record<string, number | null>;
  /** Posizione chiusa — colonne giornaliere da snapshot storici (non mark-to-market oggi). */
  archived?: boolean;
  /** MTM da ingresso (aperte) — solo se diverge dalla somma gambe (es. Var. Giorn. % oggi). */
  mtmTotalEur?: number;
};

export type PortfolioDailyPnlLedger = {
  dayKeys: string[];
  rows: PortfolioTickerDailyRow[];
  dayTotals: Record<string, number>;
  grandTotal: number;
  /** Totali solo posizioni aperte — allineati alle card P&L. */
  openDayTotals: Record<string, number>;
  openGrandTotal: number;
  /** True when at least one row lacks prior close snapshots — daily cols may not sum to TOTAL. */
  incompleteDailyHistory: boolean;
  /** Almeno una aperta ha Σ gambe ≠ MTM (Var. Giorn. % oggi vs prezzo corrente). */
  legTotalDiffersFromMtm: boolean;
  openRowCount: number;
  archivedRowCount: number;
};

/** Formato ``YYYY-MM-DD`` → etichetta tabella. */
export function formatLedgerDayKey(dayKey: string, lang: "it" | "en" = "it"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const [, y, mo, d] = m;
  return lang === "it" ? `${d}/${mo}/${y}` : `${mo}/${d}/${y}`;
}

function collectHistoryTickerKeys(history: InvestSimHistoryPoint[]): Set<string> {
  const keys = new Set<string>();
  for (const h of history) {
    for (const k of Object.keys(h.byTicker ?? {})) keys.add(k);
  }
  return keys;
}

function inferEntryCapitalFromHistory(
  history: InvestSimHistoryPoint[],
  key: string,
): number | null {
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (!snap) continue;
    const entry = roundEur(snap.value - snap.pnl);
    if (entry > 0) return entry;
  }
  return null;
}

/** When Capital € changes (e.g. synth sync), history snapshots stay at old scale — rescale closes. */
export function scaleCloseSeriesToEntryCapital(
  series: TickerDailyClosePoint[],
  entryValue: number,
  historyEntryCapital: number | null,
): TickerDailyClosePoint[] {
  if (
    !series.length ||
    entryValue <= 0 ||
    historyEntryCapital == null ||
    historyEntryCapital <= 0
  ) {
    return series;
  }
  const ratio = entryValue / historyEntryCapital;
  if (Math.abs(ratio - 1) < 0.015) return series;
  return series.map((pt) => ({
    ...pt,
    value: roundEur(pt.value * ratio),
  }));
}

/** Delta giornalieri solo da chiusure storiche (posizione già venduta). */
function buildClosedPositionDailyPnlLegs(
  entryValue: number,
  series: TickerDailyClosePoint[],
  investDayKey: string,
): PositionDailyPnlLeg[] {
  const priorSeries = [...series].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  let prev = entryValue;
  const legs: PositionDailyPnlLeg[] = [];
  let seededFromFirstSnap = false;

  for (const pt of priorSeries) {
    if (!seededFromFirstSnap && investDayKey && pt.dayKey > investDayKey) {
      prev = pt.value;
      seededFromFirstSnap = true;
      continue;
    }
    const pnlEur = roundEur(pt.value - prev);
    legs.push({
      dayKey: pt.dayKey,
      pnlEur,
      pnlPct: prev > 0 ? Math.round((pnlEur / prev) * 10000) / 100 : null,
      isToday: false,
    });
    prev = pt.value;
    seededFromFirstSnap = true;
  }
  return legs;
}

function parseSimRowKeyParts(key: string): { ticker: string; cd: string } {
  const pipe = key.indexOf("|");
  if (pipe <= 0) return { ticker: key.trim().toUpperCase(), cd: "—" };
  return {
    ticker: key.slice(0, pipe).trim().toUpperCase(),
    cd: key.slice(pipe + 1).trim() || "—",
  };
}

/** Matrice gain/loss giorno per giorno — righe aperte in UI; chiuse in `archived` per salvadanaio. */
export function buildPortfolioDailyPnlLedger(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioDailyPnlLedger {
  const hist = resolvePortfolioHistory(history);
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const positions = buildPositions(simTable, inputs, hist);
  const dayKeySet = new Set<string>();
  const rows: PortfolioTickerDailyRow[] = [];
  const todayKey = calendarDayKey(new Date());
  let incompleteDailyHistory = false;
  let legTotalDiffersFromMtm = false;

  for (const p of positions) {
    const row = rowByKey.get(p.key);
    if (!row || !rowHasActivePortfolio(row, inputs) || p.capital <= 0 || p.pnlUnavailable) {
      continue;
    }
    const investedAt = resolveInvestedAt(p.key, inputs[p.key], hist);
    const investDayKey = investedAt?.trim() ? calendarDayKey(new Date(investedAt)) : "";
    const dailyPct = dailyChangePctFromRow(row);
    let legs: PositionDailyPnlLeg[];

    let priorCloseCount = 0;
    if (isInvestedToday(investedAt)) {
      const pnlEur = roundEur(p.valueNow - p.capital);
      const pnlPct =
        p.capital > 0 ? Math.round((pnlEur / p.capital) * 10000) / 100 : null;
      legs = [{ dayKey: todayKey, pnlEur, pnlPct, isToday: true }];
    } else {
      const closeSeriesRaw = tickerDailyCloseSeries(hist, p.key, investedAt);
      const histEntry = inferEntryCapitalFromHistory(hist, p.key);
      const closeSeries = scaleCloseSeriesToEntryCapital(
        closeSeriesRaw,
        p.capital,
        histEntry,
      );
      priorCloseCount = closeSeries.filter((pt) => pt.dayKey < todayKey).length;
      const mtmValue = resolveMtmValueForPositionLegs(p, row, inputs, hist, investedAt);
      legs = buildPositionDailyPnlLegs(p.capital, mtmValue, closeSeries, {
        investDayKey,
        dailyPct,
      });
    }

    const pnlByDay: Record<string, number | null> = {};
    let dailySumEur = 0;
    for (const leg of legs) {
      dayKeySet.add(leg.dayKey);
      pnlByDay[leg.dayKey] = leg.pnlEur;
      dailySumEur += leg.pnlEur;
    }

    const mtmValueForRow = resolveMtmValueForPositionLegs(
      p,
      row,
      inputs,
      hist,
      investedAt,
    );
    const mtmTotalEur = roundEur(mtmValueForRow - p.capital);
    let totalEur = roundEur(dailySumEur);
    if (!isInvestedToday(investedAt)) {
      const rawInp = inputs[p.key];
      const curr = p.currPrice ?? currentPriceFromRow(row);
      const entryBuy = resolvePortfolioEntryBuyUsd(row, rawInp, curr, investedAt);
      const closeSeriesRaw = tickerDailyCloseSeries(hist, p.key, investedAt);
      const histEntry = inferEntryCapitalFromHistory(hist, p.key);
      const closeSeriesForCheck = scaleCloseSeriesToEntryCapital(
        closeSeriesRaw,
        p.capital,
        histEntry,
      );
      const contaminated = historyCloseSeriesLooksContaminated(
        p.capital,
        closeSeriesForCheck,
        entryBuy > 0 ? entryBuy : null,
        curr,
      );
      if (contaminated || priorCloseCount === 0) {
        totalEur = mtmTotalEur;
      }
    }
    if (!isInvestedToday(investedAt) && priorCloseCount === 0) {
      incompleteDailyHistory = true;
    }
    if (Math.abs(mtmTotalEur - totalEur) > PNL_EPS_EUR) {
      legTotalDiffersFromMtm = true;
    }

    rows.push({
      key: p.key,
      ticker: p.ticker,
      completionDate: p.completionDate,
      capital: p.capital,
      legs,
      totalEur,
      pnlByDay,
      ...(Math.abs(mtmTotalEur - totalEur) > PNL_EPS_EUR ? { mtmTotalEur } : {}),
    });
  }

  rows.sort((a, b) => {
    if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
    return a.ticker.localeCompare(b.ticker);
  });
  const openRowCount = rows.filter((r) => !r.archived).length;

  const openKeys = new Set(rows.map((r) => r.key));
  const closedCandidateKeys = new Set<string>(collectHistoryTickerKeys(hist));
  for (const [key, inp] of Object.entries(inputs)) {
    if (inp?.ignoreSheet && inp.soldAt) closedCandidateKeys.add(key);
  }

  for (const key of closedCandidateKeys) {
    if (openKeys.has(key)) continue;
    const row = rowByKey.get(key);
    const parts = parseSimRowKeyParts(key);
    const inp = inputs[key];
    const investedAt = resolveInvestedAt(key, inp, hist);
    const entryCapital =
      inp?.closedCapital != null && inp.closedCapital > 0
        ? inp.closedCapital
        : (inp?.capital ?? 0) > 0
          ? inp!.capital
          : inferEntryCapitalFromHistory(hist, key);
    if (entryCapital == null || entryCapital <= 0) continue;

    const investDayKey = investedAt?.trim() ? calendarDayKey(new Date(investedAt)) : "";
    const closeSeries = tickerDailyCloseSeries(hist, key, investedAt);
    let legs =
      closeSeries.length > 0
        ? buildClosedPositionDailyPnlLegs(entryCapital, closeSeries, investDayKey)
        : [];

    const storedPnl =
      inp?.closedPnlEur != null && Number.isFinite(inp.closedPnlEur)
        ? roundEur(inp.closedPnlEur)
        : null;

    if (legs.length === 0 && storedPnl != null) {
      const soldDay = inp?.soldAt?.trim()
        ? calendarDayKey(new Date(inp.soldAt))
        : todayKey;
      const pnlPct =
        entryCapital > 0 ? Math.round((storedPnl / entryCapital) * 10000) / 100 : null;
      legs = [
        {
          dayKey: soldDay,
          pnlEur: storedPnl,
          pnlPct,
          isToday: soldDay === todayKey,
        },
      ];
    }

    if (!legs.length) continue;

    const pnlByDay: Record<string, number | null> = {};
    let dailySumEur = 0;
    for (const leg of legs) {
      dayKeySet.add(leg.dayKey);
      pnlByDay[leg.dayKey] = leg.pnlEur;
      dailySumEur += leg.pnlEur;
    }

    rows.push({
      key,
      ticker: row ? String(row["Ticker"] ?? parts.ticker).trim().toUpperCase() : parts.ticker,
      completionDate: row ? String(row["Completion Date"] ?? parts.cd).trim() || "—" : parts.cd,
      capital: entryCapital,
      legs,
      totalEur: storedPnl != null ? storedPnl : roundEur(dailySumEur),
      pnlByDay,
      archived: true,
    });
  }

  rows.sort((a, b) => {
    if (Boolean(a.archived) !== Boolean(b.archived)) return a.archived ? 1 : -1;
    return a.ticker.localeCompare(b.ticker);
  });
  const archivedRowCount = rows.filter((r) => r.archived).length;

  const dayKeys = [...dayKeySet].sort();
  const openRows = rows.filter((r) => !r.archived);
  const dayTotals: Record<string, number> = {};
  const openDayTotals: Record<string, number> = {};
  for (const dk of dayKeys) {
    dayTotals[dk] = roundEur(
      rows.reduce((sum, r) => sum + (r.pnlByDay[dk] ?? 0), 0),
    );
    openDayTotals[dk] = roundEur(
      openRows.reduce((sum, r) => sum + (r.pnlByDay[dk] ?? 0), 0),
    );
  }
  const grandTotal = roundEur(rows.reduce((sum, r) => sum + r.totalEur, 0));
  const openGrandTotal = roundEur(openRows.reduce((sum, r) => sum + r.totalEur, 0));

  return {
    dayKeys,
    rows,
    dayTotals,
    grandTotal,
    openDayTotals,
    openGrandTotal,
    incompleteDailyHistory,
    legTotalDiffersFromMtm,
    openRowCount,
    archivedRowCount,
  };
}

/** Σ gambe giornaliere di una riga — deve coincidere con `row.totalEur`. */
export function sumLedgerRowDailyLegs(row: PortfolioTickerDailyRow): number {
  return roundEur(
    Object.values(row.pnlByDay).reduce<number>((sum, v) => sum + (v ?? 0), 0),
  );
}

/** Subtotale finestra visibile (solo i dayKey passati). */
export function sumLedgerRowsForDayKeys(
  rows: PortfolioTickerDailyRow[],
  dayKeys: string[],
): number {
  return roundEur(
    rows.reduce(
      (sum, row) =>
        sum +
        dayKeys.reduce((daySum, dk) => daySum + (row.pnlByDay[dk] ?? 0), 0),
      0,
    ),
  );
}

/** Mostra «prima di oggi» quando il totale è somma di più giornate di chiusura. */
export function pnlTabNeedsPriorLegNote(
  breakdown: Pick<PositionPnlBreakdown, "priorLegEur" | "dailyLegCount" | "totalSource">,
  holdDaysElapsed: number | null | undefined,
): boolean {
  if (holdDaysElapsed == null || holdDaysElapsed < 1) return false;
  if (breakdown.dailyLegCount < 2) return false;
  if (breakdown.priorLegEur == null) return false;
  return Math.abs(breakdown.priorLegEur) > PNL_EPS_EUR;
}

/**
 * P&L «giornata» — wrapper su {@link resolvePositionPnlBreakdown}.
 */
export function positionDailyPnlForPnlTab(
  pos: Pick<
    SimulationPosition,
    "key" | "valueNow" | "pnlEur" | "pnlPct" | "pnlUnavailable" | "buyPrice" | "capital" | "currPrice"
  >,
  simRow: Record<string, unknown> | undefined,
  investedAtIso: string | null | undefined,
  _historyBaseline?: PositionHistoryBaseline | null,
  history?: InvestSimHistoryPoint[] | null,
): {
  pnlEurToday: number | null;
  pnlPctToday: number | null;
  hasToday: boolean;
  source: PositionDailyPnlSource;
} {
  const b = resolvePositionPnlBreakdown(pos, simRow, investedAtIso, history);
  return {
    pnlEurToday: b.pnlEurToday,
    pnlPctToday: b.pnlPctToday,
    hasToday: b.hasToday,
    source: b.todaySource,
  };
}

/** P&L giornaliero da riga Simulation (Var. Giorn. %) per tono display. */
export function portfolioDailyPnlFromRow(
  pos: { valueNow: number; pnlUnavailable: boolean },
  row: Record<string, unknown> | undefined,
): { pnlEur24h: number | null; pnlPct24h: number | null } {
  if (pos.pnlUnavailable || pos.valueNow <= 0 || !row) {
    return { pnlEur24h: null, pnlPct24h: null };
  }
  const dailyPct = dailyChangePctFromRow(row);
  if (dailyPct == null || !Number.isFinite(dailyPct)) {
    return { pnlEur24h: null, pnlPct24h: null };
  }
  return {
    pnlPct24h: Math.round(dailyPct * 100) / 100,
    pnlEur24h: pnlEurFromDailyPct(pos.valueNow, dailyPct),
  };
}

/** Position metrics (same logic as Investment Simulation). */
export function computeSimulationPosition(
  r: Record<string, unknown>,
  inputs: InvestSimInputs,
  ctx?: SimulationPositionContext,
): SimulationPosition | null {
  const ticker = String(r.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return null;
  const cd = String(r["Completion Date"] ?? "—");
  const key = rowKey(ticker, cd);
  const curr = currentPriceFromRow(r);
  const rawInp = inputs[key] ?? { buyPrice: 0, capital: 0 };
  const inp = mergedSimInputs(r, rawInp);
  const explicitLocalBuy = rawInp.buyPrice > 0 && !rawInp.ignoreSheet;
  const investedAt = resolveInvestedAt(key, rawInp, ctx?.history ?? []);
  const entryBuy = resolvePortfolioEntryBuyUsd(r, rawInp, curr, investedAt);
  let buyPrice =
    entryBuy > 0
      ? entryBuy
      : resolveEffectiveBuyPrice(r, inp, key, ctx?.history, investedAt);
  const capital = inp.capital > 0 ? inp.capital : 0;
  let shares = 0;
  let valueNow = 0;
  let pnlEur = 0;
  let pnlPct = 0;
  let pnlUnavailable = false;
  if (capital > 0 && buyPrice <= 0) {
    pnlUnavailable = true;
  } else if (buyPrice > 0 && capital > 0) {
    shares = capital / buyPrice;
    if (curr != null && curr > 0) {
      valueNow = shares * curr;
      pnlEur = valueNow - capital;
      pnlPct = ((curr - buyPrice) / buyPrice) * 100;
      if (entryBuy <= 0) {
        const reconciled = reconcileAnchoredBuyMarkToMarket(
          r,
          {
            buyPrice,
            capital,
            curr,
            valueNow,
            pnlEur,
            pnlPct,
            shares,
            key,
          },
          ctx?.history,
          { explicitLocalBuy, investedAtIso: investedAt },
        );
        buyPrice = reconciled.buyPrice;
        shares = reconciled.shares;
        valueNow = reconciled.valueNow;
        pnlEur = reconciled.pnlEur;
        pnlPct = reconciled.pnlPct;
      }
    } else {
      pnlUnavailable = true;
      const sheetPct = sheetPnlPct(r);
      const sheetEur = parseNum(r["P&L ($)"]);
      if (sheetPct !== null) pnlPct = sheetPct;
      if (sheetEur !== null) pnlEur = sheetEur;
    }
  }
  return {
    key,
    ticker,
    name: String(r.Nome ?? r.Company ?? r["Società"] ?? ""),
    completionDate: cd,
    currPrice: curr,
    buyPrice,
    capital,
    shares,
    valueNow,
    pnlEur,
    pnlPct,
    pnlUnavailable,
  };
}

/** Row with an active simulated position (local or sheet, respecting ignoreSheet). */
export function rowHasActivePortfolio(
  row: Record<string, unknown>,
  inputs: InvestSimInputs
): boolean {
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return false;
  const key = rowKey(ticker, String(row["Completion Date"] ?? "—"));
  if (inputs[key]?.ignoreSheet) return false;
  const pos = computeSimulationPosition(row, inputs, {
    history: resolvePortfolioHistory(),
  });
  return pos != null && pos.capital > 0;
}

/** Azioni implicite da capitale ÷ prezzo acquisto (aggiorna con l'input Capital). */
export function impliedSharesFromCapital(
  capital: number,
  buyPrice: number,
): number | null {
  if (capital <= 0 || buyPrice <= 0 || !Number.isFinite(capital) || !Number.isFinite(buyPrice)) {
    return null;
  }
  return capital / buyPrice;
}

/**
 * When capital is set but buy price is missing, lock entry at the current
 * sheet price so P&L / history / Simulation table stay aligned.
 */
export function backfillEntryBuyPrices(
  inputs: InvestSimInputs,
  positions: SimulationPosition[]
): InvestSimInputs {
  let changed = false;
  const out: InvestSimInputs = { ...inputs };
  for (const p of positions) {
    if (p.capital <= 0) continue;
    const prev = out[p.key] ?? { buyPrice: 0, capital: 0 };
    if (prev.ignoreSheet) continue;
    // Check the raw stored entry (not the computed effective price, which always
    // falls back to currPrice making the p.buyPrice check always > 0).
    if (prev.buyPrice > 0) continue;
    const curr = p.currPrice;
    if (curr == null || curr <= 0) continue;
    out[p.key] = {
      ...prev,
      buyPrice: curr,
      capital: prev.capital > 0 ? prev.capital : p.capital,
      ignoreSheet: false,
    };
    changed = true;
  }
  return changed ? out : inputs;
}

/** Stesso storico del tab Simulation → P&L (localStorage). */
export function resolvePortfolioHistory(
  history?: InvestSimHistoryPoint[] | null,
): InvestSimHistoryPoint[] {
  return history ?? loadInvestSimHistory();
}

export function buildPositions(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): SimulationPosition[] {
  const rows = simTable?.rows ?? [];
  const out: SimulationPosition[] = [];
  const ctx: SimulationPositionContext = {
    history: resolvePortfolioHistory(history),
  };
  for (const r of rows) {
    const p = computeSimulationPosition(r, inputs, ctx);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Fills empty formula columns in the JSON snapshot (Excel: formulas unevaluated with data_only).
 */
export function enrichSimulationRow(
  r: Record<string, unknown>,
  inputs: InvestSimInputs,
  ctx?: SimulationPositionContext,
): Record<string, unknown> {
  const pos = computeSimulationPosition(r, inputs, ctx);
  if (!pos || pos.buyPrice <= 0 || pos.capital <= 0) return r;

  const out: Record<string, unknown> = { ...r };

  if (isSheetCellEmpty(r["N° Azioni Implicite"])) {
    out["N° Azioni Implicite"] = pos.shares;
  }

  if (pos.pnlUnavailable) {
    if (isSheetCellEmpty(r["Valore Attuale ($)"])) out["Valore Attuale ($)"] = "N/D";
    if (isSheetCellEmpty(r["P&L ($)"])) out["P&L ($)"] = "N/D";
    if (isSheetCellEmpty(r["P&L (%)"])) out["P&L (%)"] = "N/D";
    out.__simPnlMissing = true;
  } else if (pos.shares > 0) {
    if (isSheetCellEmpty(r["Valore Attuale ($)"])) out["Valore Attuale ($)"] = pos.valueNow;
    if (isSheetCellEmpty(r["P&L ($)"])) out["P&L ($)"] = pos.pnlEur;
    if (isSheetCellEmpty(r["P&L (%)"])) out["P&L (%)"] = pos.pnlPct;
  }

  return out;
}

export type DashboardPortfolioChip = {
  ticker: string;
  key: string;
  capitalEur: number;
  pnlEur: number;
  pnlPct: number;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
};

export type OpenRowPnlMetrics = {
  pos: SimulationPosition | null;
  pnlEur: number | null;
  pnlPct: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  pnlEurSinceReading: number | null;
  pnlPctSinceReading: number | null;
  priorReadingTs: string | null;
  buyPriceUsd: number | null;
};

/**
 * P&L apertura — stesso motore del tab Simulation → P&L (history + Var. Giorn.).
 * Non usare colonne P&L foglio se la posizione è attiva in portafoglio simulato.
 */
export function positionPnlForOpenRow(
  row: Record<string, unknown>,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): OpenRowPnlMetrics {
  const empty: OpenRowPnlMetrics = {
    pos: null,
    pnlEur: null,
    pnlPct: null,
    pnlEur24h: null,
    pnlPct24h: null,
    pnlEurSinceReading: null,
    pnlPctSinceReading: null,
    priorReadingTs: null,
    buyPriceUsd: null,
  };
  if (!rowHasActivePortfolio(row, inputs)) return empty;
  const hist = resolvePortfolioHistory(history);
  const pos = computeSimulationPosition(row, inputs, { history: hist });
  if (!pos || pos.capital <= 0 || pos.buyPrice <= 0) {
    return { ...empty, pos };
  }
  const buyPriceUsd = pos.buyPrice;
  if (pos.pnlUnavailable) {
    return { ...empty, pos, buyPriceUsd };
  }
  const key = pos.key;
  const investedAt = resolveInvestedAt(key, inputs[key], hist);
    const b = resolvePositionPnlBreakdown(pos, row, investedAt, hist, inputs);
  const agg = resolveAggregatePositionPnl(pos, b);
  const totalEur = agg?.totalEur ?? b.totalEur;
  const totalPct =
    positionCapitalPnlPct(totalEur, pos.capital) ?? b.totalPct;
  return {
    pos,
    pnlEur: Math.round(totalEur * 100) / 100,
    pnlPct: Math.round(totalPct * 100) / 100,
    pnlEur24h: b.hasToday ? b.pnlEurToday : null,
    pnlPct24h: b.hasToday ? b.pnlPctToday : null,
    pnlEurSinceReading: b.pnlEurSinceReading,
    pnlPctSinceReading: b.pnlPctSinceReading,
    priorReadingTs: b.priorReadingTs,
    buyPriceUsd,
  };
}

/** Ultimo snapshot portfolio prima di oggi (stesso criterio del tab P&L). */
export function portfolioDailyHistoryBaseline(
  history: InvestSimHistoryPoint[],
): InvestSimHistoryPoint | null {
  if (!history.length) return null;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dayKey = (iso: string): string => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  for (let i = history.length - 1; i >= 0; i--) {
    const dk = dayKey(history[i].ts);
    if (dk && dk < todayKey) return history[i];
  }
  return null;
}

/**
 * Metriche Piggy Bank / Dashboard — allineate a Simulation → P&L
 * (MTM totale + var. 24h da resolvePositionPnlBreakdown / Var. Giorn. %).
 */
export function buildDashboardPortfolioChips(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[],
): DashboardPortfolioChip[] {
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const positions = buildPositions(simTable, inputs, history);
  const out: DashboardPortfolioChip[] = [];
  for (const pos of positions) {
    const row = rowByKey.get(pos.key);
    if (!row || !rowHasActivePortfolio(row, inputs)) continue;
    if (pos.capital <= 0 || pos.pnlUnavailable) continue;
    const investedAt = resolveInvestedAt(pos.key, inputs[pos.key], history);
    const b = resolvePositionPnlBreakdown(pos, row, investedAt, history, inputs);
    const agg = resolveAggregatePositionPnl(pos, b);
    const chipPnlEur = agg?.totalEur ?? pos.pnlEur;
    out.push({
      ticker: pos.ticker,
      key: pos.key,
      capitalEur: pos.capital,
      pnlEur: chipPnlEur,
      pnlPct: positionCapitalPnlPct(chipPnlEur, pos.capital) ?? pos.pnlPct,
      pnlEur24h: b.hasToday ? b.pnlEurToday : null,
      pnlPct24h: b.hasToday ? b.pnlPctToday : null,
    });
  }
  return out;
}

/** Open positions — same engine as Simulation → P&L tab (live mark-to-market). */
export type PortfolioPnlTotals = {
  pnlEur: number;
  pnlPct: number;
  pnlEurToday: number;
  pnlPctToday: number | null;
  /** Somma «prima di oggi» per ticker (delta giornalieri registrati). */
  priorLegEur: number;
  /** Any open row uses MTM fallback or gray-zone history drift. */
  anyHistoryContaminated: boolean;
  anyHistoryUncertainContamination: boolean;
  /** Portfolio «before today» is total − 24h, not verified closes. */
  priorLegIsImplicitEstimate: boolean;
  capital: number;
  valueNow: number;
  todayCovered: number;
  todayTotal: number;
  /** P&L realizzato sulle posizioni già chiuse (ignoreSheet=true con closedPnlEur). */
  closedPnlEur: number;
  /** Numero di posizioni chiuse con closedPnlEur valorizzato. */
  closedCount: number;
};

/** Totali portafoglio aperto — stessa logica delle card Simulation → P&L. */
export function aggregateOpenPortfolioPnl(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioPnlTotals {
  const hist = resolvePortfolioHistory(history);
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const positions = buildPositions(simTable, inputs, hist);
  let pnlEur = 0;
  let pnlEurToday = 0;
  let priorLegEur = 0;
  let capital = 0;
  let valueNow = 0;
  let baselineValue = 0;
  let todayCovered = 0;
  let todayTotal = 0;
  let anyHistoryContaminated = false;
  let anyHistoryUncertainContamination = false;
  let portfolioPriorLegImplicit = false;
  for (const p of positions) {
    const row = rowByKey.get(p.key);
    if (!row || !rowHasActivePortfolio(row, inputs) || p.capital <= 0) continue;
    todayTotal++;
    const investedAt = resolveInvestedAt(p.key, inputs[p.key], hist);
    const b = resolvePositionPnlBreakdown(p, row, investedAt, hist, inputs);
    if (b.historyContaminated) anyHistoryContaminated = true;
    if (b.historyUncertainContamination) anyHistoryUncertainContamination = true;
    if (priorLegIsImplicitEstimate(b)) portfolioPriorLegImplicit = true;
    const agg = resolveAggregatePositionPnl(p, b);
    if (agg) {
      capital += p.capital;
      valueNow += p.valueNow;
      pnlEur += agg.totalEur;
      if (b.hasToday && b.pnlEurToday != null) {
        pnlEurToday += agg.pnlEurToday;
        priorLegEur += agg.priorLegEur;
        todayCovered++;
        if (b.priorValue != null && b.priorValue > 0) {
          baselineValue += b.priorValue;
        } else if (p.valueNow > 0) {
          baselineValue += p.valueNow - b.pnlEurToday;
        }
      }
    }
  }
  // Closed positions P&L — sum closedPnlEur for all sold entries
  let closedPnlEur = 0;
  let closedCount = 0;
  for (const entry of Object.values(inputs)) {
    if (entry?.ignoreSheet && entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)) {
      closedPnlEur += entry.closedPnlEur;
      closedCount++;
    }
  }

  const roundedPnl = roundEur(pnlEur);
  const roundedToday = roundEur(pnlEurToday);
  const roundedPrior =
    todayCovered > 0 ? roundEur(priorLegEur) : 0;
  return {
    pnlEur: roundedPnl,
    pnlPct: capital > 0 ? (roundedPnl / capital) * 100 : 0,
    pnlEurToday: roundedToday,
    pnlPctToday: baselineValue > 0 ? (roundedToday / baselineValue) * 100 : null,
    priorLegEur: roundedPrior,
    anyHistoryContaminated,
    anyHistoryUncertainContamination,
    priorLegIsImplicitEstimate: portfolioPriorLegImplicit,
    capital,
    valueNow,
    todayCovered,
    todayTotal,
    closedPnlEur: roundEur(closedPnlEur),
    closedCount,
  };
}

export function buildActivePortfolioPositions(
  rows: Record<string, unknown>[] | undefined,
  inputs: InvestSimInputs,
  ctx?: SimulationPositionContext,
): SimulationPosition[] {
  const resolvedCtx: SimulationPositionContext = {
    history: resolvePortfolioHistory(ctx?.history),
  };
  const out: SimulationPosition[] = [];
  for (const row of rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const pos = computeSimulationPosition(row, inputs, resolvedCtx);
    if (pos && pos.capital > 0) out.push(pos);
  }
  return out;
}

export function enrichSimulationRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs,
  ctx?: SimulationPositionContext,
): Record<string, unknown>[] {
  return rows.map((r) => enrichSimulationRow(r, inputs, ctx));
}

export function enrichSimulationTable(
  table: SheetTable | null,
  inputs: InvestSimInputs,
  ctx?: SimulationPositionContext,
): SheetTable | null {
  if (!table) return null;
  const rows = enrichSimulationRows(table.rows ?? [], inputs, ctx);
  return { ...table, rows, row_count: rows.length };
}
