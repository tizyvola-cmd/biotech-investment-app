/**
 * Dashboard what-if: stake a flat capital in every Simulation name,
 * compare portfolio vs full universe on Var. Giorn. % (24h) and hourly curves.
 */
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import {
  commonTickersOnSheet,
  dailyChangePctFromRow,
  rowHasActivePortfolio,
  shouldHideRedundantWarrantRow,
} from "./simulationPosition";
import { computeCapturePct } from "./adviceComplementKpis";
import {
  EARLY_PEAK_MIN_DAY_PCT,
  P_CONT_SELL_MIN_G10,
  SOFT_BUY_MIN_PCONT,
  resolveContG10,
  resolveContSellEdge,
  resolveDisplayPContinuation,
} from "./continuationScore";
import { MISSED_OPP_CAPITAL_EUR, pnlEurFrom24hPct } from "./missedOpportunityAudit";
import { normalizedRowKey } from "./investSimKeys";
import { looksLikeTicker } from "./simulationTickers";

/**
 * What-if column: exhaustion edge (pp). edge > 0 = more exhaustion than bucket
 * (sell pressure → red); edge ≤ 0 → green.
 */
export const WHATIF_EXHAUST_EDGE_SELL_PP = 0;

/**
 * Early-run breakout in what-if table: 0 ≤ 10d % &lt; +5%, Δ24h ≥ {@link EARLY_PEAK_MIN_DAY_PCT}%,
 * not declining, edge ≤ 0.
 */
export function isWhatIfEarlyPeakWind(opts: {
  contG10: number | null | undefined;
  dailyPct24h?: number | null;
  exhaustEdge?: number | null;
}): boolean {
  const g10 = opts.contG10;
  if (g10 == null || !Number.isFinite(g10) || g10 < 0 || g10 >= P_CONT_SELL_MIN_G10) {
    return false;
  }
  const day = opts.dailyPct24h;
  if (day == null || !Number.isFinite(day) || day < EARLY_PEAK_MIN_DAY_PCT) {
    return false;
  }
  const edge = opts.exhaustEdge;
  if (edge != null && Number.isFinite(edge) && edge > WHATIF_EXHAUST_EDGE_SELL_PP) {
    return false;
  }
  return true;
}

/**
 * Strong wind (10d % ≥ +5% · P(cont) ≥ 50%) or early-peak breakout (10d &lt; 5% · Δ24h strong).
 * Day not red + not exhausted (edge ≤ 0). UI: green underline in what-if table.
 */
export function isWhatIfStrongWindContinuation(opts: {
  contG10: number | null | undefined;
  pCont: number | null | undefined;
  dailyPct24h?: number | null;
  exhaustEdge?: number | null;
}): boolean {
  if (isWhatIfEarlyPeakWind(opts)) return true;
  const g10 = opts.contG10;
  const pCont = opts.pCont;
  if (g10 == null || !Number.isFinite(g10) || g10 < P_CONT_SELL_MIN_G10) {
    return false;
  }
  if (pCont == null || !Number.isFinite(pCont) || pCont < SOFT_BUY_MIN_PCONT) {
    return false;
  }
  const day = opts.dailyPct24h;
  if (day != null && Number.isFinite(day) && day < 0) return false;
  const edge = opts.exhaustEdge;
  if (edge != null && Number.isFinite(edge) && edge > WHATIF_EXHAUST_EDGE_SELL_PP) {
    return false;
  }
  return true;
}

/** Equal-weight hypothetical stake per Simulation ticker (user asked $5k). */
export const SIM_UNIVERSE_WHATIF_CAPITAL = MISSED_OPP_CAPITAL_EUR; // 5000

export type SimUniverse24hWhatIfRow = {
  key: string;
  ticker: string;
  company: string | null;
  /** null when sheet has no usable Var. Giorn. % (still listed for curves). */
  dailyPct24h: number | null;
  pnlEur: number | null;
  inPortfolio: boolean;
  /**
   * Exhaustion edge pp (cont_sell_edge = P − p_base bucket).
   * Kept for Soft SELL logic / P(continuation) panel — not shown in what-if table.
   */
  exhaustEdge: number | null;
  /** 10-session growth % (cont_g10). Null if missing. */
  contG10: number | null;
  /** Display P(continuation) % when in sell regime (g10≥5%); else null. */
  pCont: number | null;
};

export type SimUniverse24hGroupTotals = {
  n: number;
  /** Tickers with a usable 24h %. */
  nWith24h: number;
  /** Names with Var. Giorn. % > 0. */
  nUp24h: number;
  capitalEur: number;
  pnlEur: number;
  /** Sum of positive 24h € only (upside potential in the group). */
  upsideEur: number;
  /** Mean 24h % across names with a reading. */
  meanPct: number | null;
  /** Mean 10-session run % (cont_g10). */
  meanG10: number | null;
  /** Mean display P(continuation) among names that have one. */
  meanPCont: number | null;
};

export type SimUniverse24hWhatIf = {
  capitalPerTicker: number;
  /** All Simulation names (including those without 24h %). */
  rows: SimUniverse24hWhatIfRow[];
  all: SimUniverse24hGroupTotals;
  portfolio: SimUniverse24hGroupTotals;
  offPortfolio: SimUniverse24hGroupTotals;
  /** Portfolio upside / universe upside × 100. */
  capturePct: number | null;
  /** Universe upside not held in portfolio. */
  missedUpsideEur: number;
};

export type IntradayPricePoint = { t: string; price: number };

export type WhatIfHourlyCurvePoint = {
  /** Hour label for X axis */
  hour: string;
  ts: string;
  /** ticker → equal-weight $5k P&L at that hour */
  [ticker: string]: string | number | null | undefined;
};

function emptyGroup(): SimUniverse24hGroupTotals {
  return {
    n: 0,
    nWith24h: 0,
    nUp24h: 0,
    capitalEur: 0,
    pnlEur: 0,
    upsideEur: 0,
    meanPct: null,
    meanG10: null,
    meanPCont: null,
  };
}

function meanFinite(vals: Array<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of vals) {
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  return n ? Math.round((sum / n) * 100) / 100 : null;
}

function finalizeGroup(
  rows: SimUniverse24hWhatIfRow[],
  capitalPerTicker: number,
): SimUniverse24hGroupTotals {
  const with24h = rows.filter((r) => r.dailyPct24h != null && r.pnlEur != null);
  const nUp24h = rows.filter((r) => isWhatIf24hGainer(r)).length;
  const meanG10 = meanFinite(rows.map((r) => r.contG10));
  const meanPCont = meanFinite(rows.map((r) => r.pCont));
  if (!with24h.length) {
    return { ...emptyGroup(), n: rows.length, nUp24h, meanG10, meanPCont };
  }
  let pnlEur = 0;
  let upsideEur = 0;
  let pctSum = 0;
  for (const r of with24h) {
    pnlEur += r.pnlEur!;
    if (r.pnlEur! > 0) upsideEur += r.pnlEur!;
    pctSum += r.dailyPct24h!;
  }
  return {
    n: rows.length,
    nWith24h: with24h.length,
    nUp24h,
    capitalEur: with24h.length * capitalPerTicker,
    pnlEur: Math.round(pnlEur),
    upsideEur: Math.round(upsideEur),
    meanPct: Math.round((pctSum / with24h.length) * 100) / 100,
    meanG10,
    meanPCont,
  };
}

export function buildSimUniverse24hWhatIf(
  simTable: SheetTable | null | undefined,
  inputs: InvestSimInputs,
  capitalPerTicker: number = SIM_UNIVERSE_WHATIF_CAPITAL,
): SimUniverse24hWhatIf | null {
  const rowsIn = simTable?.rows ?? [];
  if (!rowsIn.length) return null;
  const commons = commonTickersOnSheet(rowsIn);

  const rows: SimUniverse24hWhatIfRow[] = [];
  for (const r of rowsIn) {
    const ticker = String(r.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!looksLikeTicker(ticker)) continue;
    if (shouldHideRedundantWarrantRow(r, commons, inputs)) continue;
    const dailyPct = dailyChangePctFromRow(r);
    const key = normalizedRowKey(ticker, r["Completion Date"]);
    const companyRaw = String(r.Company ?? r.Società ?? r.Name ?? "").trim();
    const hasPct = dailyPct != null && Number.isFinite(dailyPct);
    const exhaustEdge = resolveContSellEdge(r);
    const contG10 = resolveContG10(r);
    const pCont = resolveDisplayPContinuation(r);
    rows.push({
      key,
      ticker,
      company: companyRaw || null,
      dailyPct24h: hasPct ? Math.round(dailyPct! * 100) / 100 : null,
      pnlEur: hasPct ? pnlEurFrom24hPct(capitalPerTicker, dailyPct!) : null,
      inPortfolio: rowHasActivePortfolio(r, inputs),
      exhaustEdge:
        exhaustEdge != null && Number.isFinite(exhaustEdge)
          ? Math.round(exhaustEdge * 10) / 10
          : null,
      contG10:
        contG10 != null && Number.isFinite(contG10)
          ? Math.round(contG10 * 100) / 100
          : null,
      pCont: pCont != null && Number.isFinite(pCont) ? Math.round(pCont) : null,
    });
  }

  if (!rows.length) return null;

  const portfolioRows = rows.filter((r) => r.inPortfolio);
  const offRows = rows.filter((r) => !r.inPortfolio);
  const all = finalizeGroup(rows, capitalPerTicker);
  const portfolio = finalizeGroup(portfolioRows, capitalPerTicker);
  const offPortfolio = finalizeGroup(offRows, capitalPerTicker);
  const capturePct = computeCapturePct(portfolio.upsideEur, all.upsideEur);
  const missedUpsideEur = Math.max(0, all.upsideEur - portfolio.upsideEur);

  return {
    capitalPerTicker,
    rows: rows.sort((a, b) => (b.dailyPct24h ?? -Infinity) - (a.dailyPct24h ?? -Infinity)),
    all,
    portfolio,
    offPortfolio,
    capturePct,
    missedUpsideEur,
  };
}

/** Top N bars for legacy charts (largest |P&L| first). */
export function simUniverseWhatIfTopBars(
  rows: SimUniverse24hWhatIfRow[],
  limit = 18,
): SimUniverse24hWhatIfRow[] {
  return [...rows]
    .filter((r) => r.pnlEur != null)
    .sort(
      (a, b) =>
        Math.abs(b.pnlEur!) - Math.abs(a.pnlEur!) || (b.pnlEur ?? 0) - (a.pnlEur ?? 0),
    )
    .slice(0, limit);
}

/**
 * Resolve P&L baselines so curves share the same direction as sheet
 * ``Var. Giorn. %`` (Yahoo vs previous regular close) — not session open.
 */
export function resolveWhatIfPriceBaselines(
  tickers: string[],
  sessionSeries: Record<string, IntradayPricePoint[] | undefined>,
  opts?: {
    /** Explicit previous close from API (preferred). */
    prevCloseByTicker?: Record<string, number | null | undefined>;
    /** Last print of the prior session (fallback for live). */
    priorSeries?: Record<string, IntradayPricePoint[] | undefined>;
    /** Sheet Var. Giorn. % — infer prev close from last session price. */
    dailyPctByTicker?: Record<string, number | null | undefined>;
  },
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of tickers) {
    const tk = raw.trim().toUpperCase();
    if (!tk) continue;
    const pts = sessionSeries[tk] ?? [];
    if (!pts.length) continue;

    const explicit = opts?.prevCloseByTicker?.[tk];
    if (explicit != null && Number.isFinite(explicit) && explicit > 0) {
      out[tk] = explicit;
      continue;
    }

    const prior = opts?.priorSeries?.[tk] ?? [];
    const priorClose = prior.length ? prior[prior.length - 1]!.price : null;
    if (priorClose != null && priorClose > 0) {
      out[tk] = priorClose;
      continue;
    }

    const last = pts[pts.length - 1]!.price;
    const pct = opts?.dailyPctByTicker?.[tk];
    if (
      last > 0 &&
      pct != null &&
      Number.isFinite(pct) &&
      pct > -99.9 &&
      pct < 500
    ) {
      const inferred = last / (1 + pct / 100);
      if (inferred > 0 && Number.isFinite(inferred)) {
        out[tk] = inferred;
        continue;
      }
    }

    // Last resort: session first print (can disagree with Var. Giorn. after gaps).
    const open = pts[0]!.price;
    if (open > 0) out[tk] = open;
  }
  return out;
}

/**
 * Build equal-weight $5k P&L curves from hourly prices.
 * Baseline = previous regular close when provided (aligns with Var. Giorn. %);
 * otherwise first print of the session.
 */
export function buildWhatIfHourlyPnlSeries(
  tickers: string[],
  priceSeries: Record<string, IntradayPricePoint[] | undefined>,
  capitalPerTicker: number = SIM_UNIVERSE_WHATIF_CAPITAL,
  baselineByTicker?: Record<string, number | null | undefined>,
): { chartRows: WhatIfHourlyCurvePoint[]; tickersWithData: string[] } {
  const uniq = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const baselines = new Map<string, number>();
  const byHour = new Map<string, WhatIfHourlyCurvePoint>();
  const withData: string[] = [];

  for (const tk of uniq) {
    const pts = priceSeries[tk] ?? [];
    if (!pts.length) continue;
    const override = baselineByTicker?.[tk];
    const base =
      override != null && Number.isFinite(override) && override > 0
        ? override
        : pts[0]!.price;
    if (!(base > 0)) continue;
    baselines.set(tk, base);
    withData.push(tk);
    for (const p of pts) {
      if (!(p.price > 0)) continue;
      const hourKey = p.t.slice(0, 13); // YYYY-MM-DDTHH
      let row = byHour.get(hourKey);
      if (!row) {
        const d = new Date(p.t);
        const hourLabel = Number.isFinite(d.getTime())
          ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
          : hourKey.slice(-2) + ":00";
        row = { hour: hourLabel, ts: p.t };
        byHour.set(hourKey, row);
      }
      const pnl = Math.round(capitalPerTicker * (p.price / base - 1) * 100) / 100;
      row[tk] = pnl;
    }
  }

  const chartRows = [...byHour.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);

  // Forward-fill missing ticker values so lines don't break mid-session.
  let prev: WhatIfHourlyCurvePoint | null = null;
  for (const row of chartRows) {
    for (const tk of withData) {
      if (row[tk] == null && prev && prev[tk] != null) row[tk] = prev[tk];
    }
    prev = row;
  }

  return { chartRows, tickersWithData: withData };
}

/**
 * Hourly % vs previous close (same baseline as Var. Giorn. %).
 * Values are percent points — not equal-weight € P&L.
 */
export function buildWindHourlyPctSeries(
  tickers: string[],
  priceSeries: Record<string, IntradayPricePoint[] | undefined>,
  baselineByTicker?: Record<string, number | null | undefined>,
): { chartRows: WhatIfHourlyCurvePoint[]; tickersWithData: string[] } {
  return buildWhatIfHourlyPnlSeries(tickers, priceSeries, 100, baselineByTicker);
}

export type WhatIfBookFilter = "all" | "portfolio" | "off";

/** Extra curve lens: all paths · strong risers · crown (Strong ∩ portfolio) · 24h gainers. */
export type WhatIfPathFilter = "all" | "strong" | "crown" | "up24h";

export function isWhatIf24hGainer(row: {
  dailyPct24h: number | null | undefined;
}): boolean {
  const pct = row.dailyPct24h;
  return pct != null && Number.isFinite(pct) && pct > 0;
}

/** Portfolio name that is also a Strong continuous riser — UI crown badge. */
export function isWhatIfPortfolioStrongHit(
  inPortfolio: boolean | null | undefined,
  strong: boolean | null | undefined,
): boolean {
  return Boolean(inPortfolio) && Boolean(strong);
}

/**
 * Strong for chips / filter / crown: path Strong must not disagree with a red day.
 * Sheet Var. Giorn. % can diverge from hourly P&L — a name finishing the path
 * “strong” but Δ 24h < 0 is a fade, not Strong-now.
 */
export function isWhatIfStrongNow(
  pathStrong: boolean | null | undefined,
  dailyPct24h: number | null | undefined,
): boolean {
  if (!pathStrong) return false;
  if (dailyPct24h != null && Number.isFinite(dailyPct24h) && dailyPct24h < 0) {
    return false;
  }
  return true;
}

/** Path looked Strong but the day (sheet) is red — surface as fade, not Strong. */
export function isWhatIfStrongFaded(
  pathStrong: boolean | null | undefined,
  dailyPct24h: number | null | undefined,
): boolean {
  return (
    Boolean(pathStrong) &&
    dailyPct24h != null &&
    Number.isFinite(dailyPct24h) &&
    dailyPct24h < 0
  );
}

export type WhatIfCurveStats = {
  ticker: string;
  /** Last hourly P&L (€ @ equal stake). */
  endPnl: number;
  pathMin: number;
  pathMax: number;
  /** pathMax − pathMin */
  range: number;
  /** True when the path swung a lot vs net move (chop / round-trip). */
  oscillating: boolean;
  /**
   * Continuous uptrend: finishes green, keeps most of the session high,
   * and most hourly steps are non-negative (not a spike→dump).
   */
  strong: boolean;
  /** Share of hourly steps with Δ ≥ 0 (0…1). */
  upStepShare: number;
};

/**
 * Per-ticker path stats from hourly P&L chart rows.
 *
 * Strong = continuous riser (user intent), not merely a high closing P&L:
 *  - end P&L ≥ +€150 (@ $5k ≈ +3%)
 *  - not oscillating (range ≫ |net|)
 *  - finish keeps ≥70% of session pathMax (little give-back)
 *  - ≥60% of hourly steps are flat/up
 *
 * Oscillating = range ≫ |net| (choppy day / round-trip).
 */
export function computeWhatIfCurveStats(
  chartRows: WhatIfHourlyCurvePoint[],
  tickers: string[],
): Map<string, WhatIfCurveStats> {
  const out = new Map<string, WhatIfCurveStats>();
  if (!chartRows.length || !tickers.length) return out;

  type Acc = {
    ticker: string;
    endPnl: number;
    pathMin: number;
    pathMax: number;
    range: number;
    upStepShare: number;
  };
  const ends: Acc[] = [];
  for (const tk of tickers) {
    let pathMin = Infinity;
    let pathMax = -Infinity;
    let endPnl: number | null = null;
    let prev: number | null = null;
    let steps = 0;
    let upSteps = 0;
    for (const row of chartRows) {
      const v = row[tk];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      pathMin = Math.min(pathMin, v);
      pathMax = Math.max(pathMax, v);
      if (prev != null) {
        steps += 1;
        if (v + 1e-9 >= prev) upSteps += 1;
      }
      prev = v;
      endPnl = v;
    }
    if (endPnl == null || steps < 1 || !Number.isFinite(pathMin)) continue;
    const range = pathMax - pathMin;
    ends.push({
      ticker: tk,
      endPnl,
      pathMin,
      pathMax,
      range,
      upStepShare: steps > 0 ? upSteps / steps : 0,
    });
  }

  const strongFloor = 150; // € @ $5k equal-weight ≈ +3%

  for (const e of ends) {
    const net = Math.abs(e.endPnl);
    const oscillating =
      e.range >= 100 && e.range >= Math.max(2.5 * Math.max(net, 40), 200);
    const keptPeak =
      e.pathMax > 0 ? e.endPnl >= 0.7 * e.pathMax : e.endPnl >= strongFloor;
    const continuousSteps = e.upStepShare >= 0.6;
    const strong =
      e.endPnl >= strongFloor && !oscillating && keptPeak && continuousSteps;
    out.set(e.ticker, {
      ticker: e.ticker,
      endPnl: e.endPnl,
      pathMin: e.pathMin,
      pathMax: e.pathMax,
      range: e.range,
      oscillating,
      strong,
      upStepShare: e.upStepShare,
    });
  }
  return out;
}

/** Blue (weak/down) → yellow (mid) → red (strong up). */
export function whatIfPerformanceColor(
  endPnl: number,
  domainMin: number,
  domainMax: number,
): string {
  const lo = Number.isFinite(domainMin) ? domainMin : -200;
  const hi = Number.isFinite(domainMax) && domainMax > lo ? domainMax : Math.max(lo + 1, 400);
  const t = Math.max(0, Math.min(1, (endPnl - lo) / (hi - lo)));
  // 0→blue, 0.5→yellow, 1→red
  if (t <= 0.5) {
    const u = t / 0.5;
    return lerpRgb([37, 99, 235], [234, 179, 8], u); // blue → yellow
  }
  const u = (t - 0.5) / 0.5;
  return lerpRgb([234, 179, 8], [220, 38, 38], u); // yellow → red
}

function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r} ${g} ${bl})`;
}

export function whatIfColorDomain(stats: Iterable<WhatIfCurveStats>): {
  min: number;
  max: number;
} {
  let min = 0;
  let max = 200;
  let any = false;
  for (const s of stats) {
    if (!any) {
      min = s.endPnl;
      max = s.endPnl;
      any = true;
    } else {
      min = Math.min(min, s.endPnl);
      max = Math.max(max, s.endPnl);
    }
  }
  if (!any) return { min: -200, max: 400 };
  // Keep some spread so flat books don't all look identical.
  if (max - min < 80) {
    const mid = (min + max) / 2;
    return { min: mid - 100, max: mid + 100 };
  }
  return { min, max };
}

export function filterWhatIfRowsByBook(
  rows: SimUniverse24hWhatIfRow[],
  book: WhatIfBookFilter,
): SimUniverse24hWhatIfRow[] {
  if (book === "portfolio") return rows.filter((r) => r.inPortfolio);
  if (book === "off") return rows.filter((r) => !r.inPortfolio);
  return rows;
}

/** Last N finite hourly equal-weight P&L points for a ticker (sparkline). */
export function whatIfLastHourlyValues(
  chartRows: WhatIfHourlyCurvePoint[],
  ticker: string,
  n = 7,
): number[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk || n <= 0) return [];
  const vals: number[] = [];
  for (const row of chartRows) {
    const v = row[tk];
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  return vals.length <= n ? vals : vals.slice(-n);
}

/** Compact SVG path for a 1-D series (width×height viewBox). */
export function whatIfSparklinePath(
  values: number[],
  width: number,
  height: number,
  pad = 1.5,
): string | null {
  if (values.length < 2 || width <= 0 || height <= 0) return null;
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const parts: string[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const x = pad + (i / (values.length - 1)) * innerW;
    const y = pad + (1 - (values[i]! - min) / span) * innerH;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return parts.join(" ");
}
