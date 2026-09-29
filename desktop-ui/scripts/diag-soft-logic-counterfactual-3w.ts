/**
 * Counterfactual: apply Gen 0–3 Soft Soft rules to the SAME market (Yahoo daily
 * closes) over the last ~3 weeks. Structural scores (SDS / P(plan) / Top2 /
 * P(cont) / edge / precat) come from today's sheet snapshot — price path,
 * rising streak, g10, and MTM exits are computed from the shared quotes.
 *
 *   npx tsx scripts/diag-soft-logic-counterfactual-3w.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { softBuyTop2Allows } from "../src/sheet/investDecisionSimLoop";
import {
  resolveContSellEdge,
  resolveDisplayPContinuation,
  softBuyContinuationAllows,
  P_CONT_SELL_MIN_G10,
  SOFT_BUY_MIN_PCONT,
} from "../src/sheet/continuationScore";
import { SOFT_LOGIC_ERAS } from "../src/sheet/softLogicChronology";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = resolve(ROOT, "data");

const START_CAPITAL = 24_000;
const MAX_POSITIONS = 8;
const SLOT = START_CAPITAL / MAX_POSITIONS;
const LOOKBACK_CAL_DAYS = 21;
const G2_WIN_FRAC = 0.2;

type GenId = 0 | 1 | 2 | 3;

type GenConfig = {
  gen: GenId;
  label: string;
  sdsMin: number;
  pplanMin: number;
  top2: "yes_only" | "not_no" | "ignore";
  requireRising2d: boolean;
  usePcontFilter: boolean;
  softSellMtm: number | null; // e.g. -2.5
  deepSellMtm: number; // e.g. -12 or -4
  urgentG2: boolean;
  contTakeProfit: boolean;
};

const GEN_CFGS: GenConfig[] = [
  {
    gen: 0,
    label: SOFT_LOGIC_ERAS[0]!.labelEn,
    sdsMin: 25,
    pplanMin: 60,
    top2: "yes_only",
    requireRising2d: false,
    usePcontFilter: false,
    softSellMtm: null,
    deepSellMtm: -4,
    urgentG2: false,
    contTakeProfit: false,
  },
  {
    gen: 1,
    label: SOFT_LOGIC_ERAS[1]!.labelEn,
    sdsMin: 25,
    pplanMin: 50,
    top2: "not_no",
    requireRising2d: true,
    usePcontFilter: false,
    softSellMtm: -2.5,
    deepSellMtm: -12,
    urgentG2: false,
    contTakeProfit: false,
  },
  {
    gen: 2,
    label: SOFT_LOGIC_ERAS[2]!.labelEn,
    sdsMin: 20,
    pplanMin: 50,
    top2: "not_no",
    requireRising2d: true,
    usePcontFilter: false,
    softSellMtm: -2.5,
    deepSellMtm: -12,
    urgentG2: true,
    contTakeProfit: false,
  },
  {
    gen: 3,
    label: SOFT_LOGIC_ERAS[3]!.labelEn,
    sdsMin: 20,
    pplanMin: 50,
    top2: "not_no",
    requireRising2d: true,
    usePcontFilter: true,
    softSellMtm: -2.5,
    deepSellMtm: -12,
    urgentG2: true,
    contTakeProfit: true,
  },
];

type NameFeat = {
  key: string;
  ticker: string;
  sds: number | null;
  pplan: number | null;
  investVerdict: string;
  precatKind: string | null;
  simRow: Record<string, unknown>;
  pCont: number | null;
  edge: number | null;
};

type Pos = {
  ticker: string;
  key: string;
  shares: number;
  entry: number;
  entryDay: string;
};

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA, file), "utf8")) as T;
}

async function fetchYahooCloses(ticker: string): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 SuperNova-diag" },
  });
  if (!res.ok) return new Map();
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const r0 = json.chart?.result?.[0];
  const ts = r0?.timestamp ?? [];
  const closes = r0?.indicators?.quote?.[0]?.close ?? [];
  const out = new Map<string, number>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    const d = new Date(ts[i]! * 1000);
    const day = d.toISOString().slice(0, 10);
    out.set(day, c);
  }
  return out;
}

function tradingDays(maps: Map<string, number>[], fromDay: string): string[] {
  const set = new Set<string>();
  for (const m of maps) for (const d of m.keys()) if (d >= fromDay) set.add(d);
  return [...set].sort();
}

function closeOn(m: Map<string, number>, day: string): number | null {
  if (m.has(day)) return m.get(day)!;
  // previous close fallback
  const days = [...m.keys()].filter((d) => d <= day).sort();
  const last = days[days.length - 1];
  return last != null ? m.get(last)! : null;
}

function g10At(m: Map<string, number>, day: string, allDays: string[]): number | null {
  const idx = allDays.indexOf(day);
  if (idx < 0) return null;
  const cur = closeOn(m, day);
  const prevIdx = Math.max(0, idx - 10);
  const prevDay = allDays[prevIdx]!;
  const prev = closeOn(m, prevDay);
  if (cur == null || prev == null || !(prev > 0)) return null;
  return ((cur - prev) / prev) * 100;
}

function risingStreakOk(
  m: Map<string, number>,
  day: string,
  allDays: string[],
  minDays: number,
): boolean {
  const idx = allDays.indexOf(day);
  if (idx < minDays) return false;
  let greens = 0;
  for (let k = 0; k < minDays; k++) {
    const d1 = allDays[idx - k]!;
    const d0 = allDays[idx - k - 1];
    if (!d0) return false;
    const c1 = closeOn(m, d1);
    const c0 = closeOn(m, d0);
    if (c1 == null || c0 == null || !(c0 > 0)) return false;
    if ((c1 - c0) / c0 * 100 <= 0) return false;
    greens += 1;
  }
  return greens >= minDays;
}

function dayRet(
  m: Map<string, number>,
  day: string,
  allDays: string[],
): number | null {
  const idx = allDays.indexOf(day);
  if (idx <= 0) return null;
  const c1 = closeOn(m, day);
  const c0 = closeOn(m, allDays[idx - 1]!);
  if (c1 == null || c0 == null || !(c0 > 0)) return null;
  return ((c1 - c0) / c0) * 100;
}

function top2Ok(verdict: string, mode: GenConfig["top2"]): boolean {
  const v = verdict.trim().toLowerCase();
  if (mode === "ignore") return true;
  if (mode === "yes_only") return v === "yes";
  return softBuyTop2Allows({ investVerdict: v as "yes" | "no" | "wait" });
}

function softBuyOk(
  cfg: GenConfig,
  feat: NameFeat,
  prices: Map<string, number>,
  day: string,
  allDays: string[],
): boolean {
  if (feat.sds == null || feat.sds < cfg.sdsMin) return false;
  if (feat.pplan == null || feat.pplan < cfg.pplanMin) return false;
  if (feat.precatKind === "sell" || feat.precatKind === "avoid") return false;
  if (!top2Ok(feat.investVerdict, cfg.top2)) return false;
  if (cfg.requireRising2d && !risingStreakOk(prices, day, allDays, 2)) return false;
  if (cfg.usePcontFilter) {
    // Recompute g10 from live path; use sheet P(cont)/edge (structural).
    const g10 = g10At(prices, day, allDays);
    const row = {
      ...feat.simRow,
      cont_g10: g10 ?? feat.simRow.cont_g10,
    };
    if (!softBuyContinuationAllows(row)) return false;
  }
  return true;
}

function shouldSell(
  cfg: GenConfig,
  feat: NameFeat,
  pos: Pos,
  px: number,
  prices: Map<string, number>,
  day: string,
  allDays: string[],
): { sell: boolean; reason: string } {
  const mtm = ((px - pos.entry) / pos.entry) * 100;
  if (mtm <= cfg.deepSellMtm) return { sell: true, reason: `deep ${mtm.toFixed(1)}%` };
  if (cfg.softSellMtm != null && mtm <= cfg.softSellMtm) {
    // Soft SELL G1 proxies: weak plan OR always on soft threshold (volume era).
    if (feat.pplan == null || feat.pplan < 50 || mtm <= cfg.softSellMtm) {
      return { sell: true, reason: `soft ${mtm.toFixed(1)}%` };
    }
  }
  if (cfg.contTakeProfit && mtm > 0) {
    const g10 = g10At(prices, day, allDays);
    const edge = feat.edge;
    if (
      g10 != null &&
      g10 >= P_CONT_SELL_MIN_G10 &&
      edge != null &&
      edge > 0
    ) {
      return { sell: true, reason: `cont_tp edge=${edge.toFixed(1)}` };
    }
  }
  return { sell: false, reason: "" };
}

function runGen(
  cfg: GenConfig,
  feats: NameFeat[],
  priceByTk: Map<string, Map<string, number>>,
  days: string[],
): {
  gen: GenId;
  label: string;
  finalEquity: number;
  pnl: number;
  pnlPct: number;
  trades: number;
  wins: number;
  losses: number;
  maxPositions: number;
  buys: string[];
  sells: string[];
  equityCurve: { day: string; equity: number; pnl: number }[];
} {
  let cash = START_CAPITAL;
  const open = new Map<string, Pos>();
  let trades = 0;
  let wins = 0;
  let losses = 0;
  const buys: string[] = [];
  const sells: string[] = [];
  const equityCurve: { day: string; equity: number; pnl: number }[] = [];
  let maxPositions = 0;

  const featByTk = new Map(feats.map((f) => [f.ticker, f]));
  // Full calendar of closes for g10/rising (include pre-window history)
  const allDaysSet = new Set<string>();
  for (const m of priceByTk.values()) for (const d of m.keys()) allDaysSet.add(d);
  const allDays = [...allDaysSet].sort();

  for (const day of days) {
    // Mark + exits
    for (const [tk, pos] of [...open.entries()]) {
      const m = priceByTk.get(tk);
      const feat = featByTk.get(tk);
      if (!m || !feat) continue;
      const px = closeOn(m, day);
      if (px == null) continue;
      const dec = shouldSell(cfg, feat, pos, px, m, day, allDays);
      if (dec.sell) {
        const proceeds = pos.shares * px;
        const pnl = proceeds - SLOT;
        cash += proceeds;
        open.delete(tk);
        trades += 1;
        if (pnl >= 0) wins += 1;
        else losses += 1;
        sells.push(`${day}:${tk}:${dec.reason}`);
      }
    }

    // Urgent G2 — cut day losers if day losses > 20% of day wins (open book)
    if (cfg.urgentG2 && open.size > 0) {
      type Leg = { tk: string; pos: Pos; dayPct: number; px: number };
      const legs: Leg[] = [];
      for (const [tk, pos] of open) {
        const m = priceByTk.get(tk);
        if (!m) continue;
        const px = closeOn(m, day);
        const dr = dayRet(m, day, allDays);
        if (px == null || dr == null) continue;
        legs.push({ tk, pos, dayPct: dr, px });
      }
      const dayWins = legs.filter((l) => l.dayPct > 0).reduce((s, l) => s + l.dayPct * (l.pos.shares * l.px) / 100, 0);
      let dayLosses = legs
        .filter((l) => l.dayPct < 0)
        .reduce((s, l) => s + Math.abs(l.dayPct * (l.pos.shares * l.px) / 100), 0);
      const budget = G2_WIN_FRAC * dayWins;
      if (dayLosses > budget && budget >= 0) {
        const losers = legs
          .filter((l) => l.dayPct < 0)
          .sort((a, b) => a.dayPct - b.dayPct);
        for (const l of losers) {
          if (dayLosses <= budget) break;
          if (!open.has(l.tk)) continue;
          const proceeds = l.pos.shares * l.px;
          const pnl = proceeds - SLOT;
          cash += proceeds;
          open.delete(l.tk);
          trades += 1;
          if (pnl >= 0) wins += 1;
          else losses += 1;
          sells.push(`${day}:${l.tk}:G2`);
          dayLosses -= Math.abs((l.dayPct * (l.pos.shares * l.px)) / 100);
        }
      }
    }

    // Entries
    if (open.size < MAX_POSITIONS && cash >= SLOT * 0.99) {
      const candidates = feats
        .filter((f) => !open.has(f.ticker))
        .filter((f) => {
          const m = priceByTk.get(f.ticker);
          if (!m) return false;
          return softBuyOk(cfg, f, m, day, allDays);
        })
        .sort((a, b) => (b.sds ?? 0) - (a.sds ?? 0));

      for (const f of candidates) {
        if (open.size >= MAX_POSITIONS || cash < SLOT * 0.99) break;
        const m = priceByTk.get(f.ticker)!;
        const px = closeOn(m, day);
        if (px == null || !(px > 0)) continue;
        const shares = SLOT / px;
        cash -= SLOT;
        open.set(f.ticker, {
          ticker: f.ticker,
          key: f.key,
          shares,
          entry: px,
          entryDay: day,
        });
        buys.push(`${day}:${f.ticker}@${px.toFixed(2)}`);
        trades += 1;
      }
    }

    maxPositions = Math.max(maxPositions, open.size);
    let mtm = cash;
    for (const [tk, pos] of open) {
      const m = priceByTk.get(tk);
      const px = m ? closeOn(m, day) : null;
      mtm += pos.shares * (px ?? pos.entry);
    }
    equityCurve.push({
      day,
      equity: Math.round(mtm * 100) / 100,
      pnl: Math.round((mtm - START_CAPITAL) * 100) / 100,
    });
  }

  const last = equityCurve[equityCurve.length - 1];
  const finalEquity = last?.equity ?? START_CAPITAL;
  const pnl = finalEquity - START_CAPITAL;
  return {
    gen: cfg.gen,
    label: cfg.label,
    finalEquity,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / START_CAPITAL) * 1000) / 10,
    trades,
    wins,
    losses,
    maxPositions,
    buys,
    sells,
    equityCurve,
  };
}

/** Equal-weight buy&hold of structurally eligible names (no rising timing). */
function basketHold(
  cfg: GenConfig,
  feats: NameFeat[],
  priceByTk: Map<string, Map<string, number>>,
  days: string[],
): {
  gen: GenId;
  n: number;
  tickers: string[];
  pnlPct: number;
  pnlEur: number;
  avgNameRet: number;
} {
  const eligible = feats.filter((f) => {
    if (!priceByTk.has(f.ticker)) return false;
    if (f.sds == null || f.sds < cfg.sdsMin) return false;
    if (f.pplan == null || f.pplan < cfg.pplanMin) return false;
    if (f.precatKind === "sell" || f.precatKind === "avoid") return false;
    if (!top2Ok(f.investVerdict, cfg.top2)) return false;
    if (cfg.usePcontFilter) {
      // Structural P(cont) filter using sheet g10/edge/pcont (Gen 3 differentiator).
      if (!softBuyContinuationAllows(f.simRow)) return false;
    }
    return true;
  });

  const first = days[0]!;
  const last = days[days.length - 1]!;
  const held: { ticker: string; ret: number; sds: number }[] = [];
  for (const f of eligible) {
    const m = priceByTk.get(f.ticker)!;
    const p0 = closeOn(m, first);
    const p1 = closeOn(m, last);
    if (p0 == null || p1 == null || !(p0 > 0)) continue;
    held.push({
      ticker: f.ticker,
      ret: ((p1 - p0) / p0) * 100,
      sds: f.sds ?? 0,
    });
  }
  if (!held.length) {
    return {
      gen: cfg.gen,
      n: 0,
      tickers: [],
      pnlPct: 0,
      pnlEur: 0,
      avgNameRet: 0,
    };
  }
  const ranked = [...held].sort((a, b) => b.sds - a.sds).slice(0, MAX_POSITIONS);
  const avg = ranked.reduce((s, x) => s + x.ret, 0) / ranked.length;
  const pnlEur = (START_CAPITAL * avg) / 100;
  return {
    gen: cfg.gen,
    n: ranked.length,
    tickers: ranked.map((x) => x.ticker),
    pnlPct: Math.round(avg * 10) / 10,
    pnlEur: Math.round(pnlEur * 100) / 100,
    avgNameRet: Math.round(avg * 10) / 10,
  };
}

async function main() {
  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows ?? [],
  };
  const inputs =
    readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json").inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json").rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const pointsBySeriesKey = chartPointsMapFromBundle(charts);
  const migSolidityByKey = buildMigSolidityByKey(simTable, charts, sdsRows);

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = `${tk}|${String(r["Completion Date"] ?? "").trim()}`;
    rowByKey.set(key, r as Record<string, unknown>);
  }

  // Universe = hot opportunities + current book names (same sheet).
  const opp = buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    "en",
    null,
    { sdsRows, migSolidityByKey },
    "hot",
  );
  const port = buildLossAnalysisItems(
    "portfolio",
    simTable,
    inputs,
    pointsBySeriesKey,
    "en",
    null,
    { sdsRows, migSolidityByKey },
    "hot",
  );

  const byKey = new Map<string, (typeof opp)[number]>();
  for (const it of [...opp, ...port]) byKey.set(it.key, it);

  const feats: NameFeat[] = [];
  for (const item of byKey.values()) {
    const simRow = rowByKey.get(item.key) ?? {};
    const tk = item.ticker.trim().toUpperCase();
    if (!tk || tk.endsWith("W")) continue; // skip warrants
    feats.push({
      key: item.key,
      ticker: tk,
      sds: item.sdsScore ?? null,
      pplan: item.recoveryProbabilityPct ?? null,
      investVerdict: String(item.investVerdict ?? ""),
      precatKind: item.precatKind ?? null,
      simRow,
      pCont: resolveDisplayPContinuation(simRow),
      edge: resolveContSellEdge(simRow),
    });
  }

  // Dedupe by ticker (keep highest SDS)
  const featByTk = new Map<string, NameFeat>();
  for (const f of feats) {
    const prev = featByTk.get(f.ticker);
    if (!prev || (f.sds ?? 0) > (prev.sds ?? 0)) featByTk.set(f.ticker, f);
  }
  const universe = [...featByTk.values()];
  console.log(`Universe: ${universe.length} tickers (sheet hot+book, no warrants)`);

  console.log("Fetching Yahoo daily closes…");
  const priceByTk = new Map<string, Map<string, number>>();
  for (const f of universe) {
    const m = await fetchYahooCloses(f.ticker);
    if (m.size) priceByTk.set(f.ticker, m);
    await new Promise((r) => setTimeout(r, 80));
  }
  console.log(`Quotes ok: ${priceByTk.size}/${universe.length}`);

  const lastDay = [...priceByTk.values()]
    .flatMap((m) => [...m.keys()])
    .sort()
    .at(-1);
  if (!lastDay) {
    console.error("No price data");
    process.exit(1);
  }
  const end = new Date(lastDay + "T12:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_CAL_DAYS);
  const fromDay = start.toISOString().slice(0, 10);
  const days = tradingDays([...priceByTk.values()], fromDay);
  console.log(`Window: ${days[0]} → ${days[days.length - 1]} (${days.length} sessions)`);
  console.log(
    `Paper: $${START_CAPITAL} · max ${MAX_POSITIONS} pos · $${SLOT}/slot · same quotes for all Gens\n`,
  );

  const uniPriced = universe.filter((f) => priceByTk.has(f.ticker));

  // --- A) Static baskets (primary apples-to-apples) ---
  console.log("=== A) Equal-weight baskets · buy first session · hold to last (same quotes) ===");
  console.log("Structural gates only (SDS/P/Top2/precat[/P(cont)]); no ↑2d timing.\n");
  const baskets = GEN_CFGS.map((cfg) => basketHold(cfg, uniPriced, priceByTk, days));
  console.log("Gen | n | basket % | on $24k | tickers");
  console.log("-".repeat(90));
  const basketRanked = [...baskets].sort((a, b) => b.pnlPct - a.pnlPct);
  for (const b of basketRanked) {
    const sign = b.pnlPct >= 0 ? "+" : "";
    console.log(
      `Gen ${b.gen} | ${String(b.n).padStart(2)} | ${sign}${b.pnlPct.toFixed(1).padStart(5)}% | ${sign}$${b.pnlEur.toFixed(0).padStart(5)} | ${b.tickers.join(",") || "—"}`,
    );
  }

  // --- B) Dynamic Soft Soft paper (rising + exits + G2) ---
  console.log("\n=== B) Dynamic paper Soft Soft (↑2d entry + Soft/deep[/G2/cont] exits) ===");
  const results = GEN_CFGS.map((cfg) => runGen(cfg, uniPriced, priceByTk, days));
  console.log("Gen | P&L $ | P&L % | trades | W/L | maxPos");
  console.log("-".repeat(70));
  const ranked = [...results].sort((a, b) => b.pnl - a.pnl);
  for (const r of ranked) {
    const sign = r.pnl >= 0 ? "+" : "";
    console.log(
      `Gen ${r.gen} | ${sign}$${r.pnl.toFixed(0).padStart(6)} | ${sign}${r.pnlPct.toFixed(1).padStart(5)}% | ${String(r.trades).padStart(3)} | ${r.wins}/${r.losses} | ${r.maxPositions}`,
    );
  }
  for (const r of results) {
    console.log(
      `  Gen ${r.gen} buys: ${r.buys.slice(0, 6).join(", ") || "—"}`,
    );
  }

  const bestBasket = basketRanked[0]!;
  const bestDyn = ranked[0]!;
  console.log(
    `\nVerdict A (same market baskets ${days[0]}→${days[days.length - 1]}): strongest Gen ${bestBasket.gen} at ${bestBasket.pnlPct >= 0 ? "+" : ""}${bestBasket.pnlPct}% (${bestBasket.pnlEur >= 0 ? "+" : ""}$${bestBasket.pnlEur.toFixed(0)} on $24k).`,
  );
  console.log(
    `Verdict B (dynamic Soft Soft): strongest Gen ${bestDyn.gen} at ${bestDyn.pnl >= 0 ? "+" : ""}$${bestDyn.pnl.toFixed(0)} (${bestDyn.pnlPct}%).`,
  );
  console.log(
    "Caveat: SDS/P(plan)/Top2/P(cont)/edge = today's sheet (not PIT). Yahoo closes shared across Gens.",
  );

  const outPath = resolve(DATA, "diag_soft_logic_counterfactual_3w.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        fromDay: days[0],
        toDay: days[days.length - 1],
        sessions: days.length,
        startCapital: START_CAPITAL,
        maxPositions: MAX_POSITIONS,
        universe: universe.map((u) => u.ticker),
        baskets,
        dynamic: results.map(({ equityCurve, ...r }) => ({
          ...r,
          equityCurve,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
