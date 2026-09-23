/**
 * Export non-crown control populations for Grade 3 / signal-bucket validation.
 *
 * Populations (separate, not mixed):
 *   - strong_offbook: Strong (same what-if logic as crown) but NOT in PF that session
 *   - pf_nonstrong:   in PF that session but NOT Strong
 *
 * Requires crown log for session-date anchor + exclusion of crown hits.
 *
 *   cd desktop-ui
 *   npx tsx scripts/export-noncrown-control.ts
 *   npx tsx scripts/export-noncrown-control.ts --crown ../data/whatif_crown_hits_export.json
 *   npx tsx scripts/export-noncrown-control.ts --dry-run   # skip Yahoo intraday fetch
 *
 * Output: data/whatif_noncrown_export.json
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildSdsByTicker } from "../src/sheet/sdsTopOppGate";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import {
  commonTickersOnSheet,
  shouldHideRedundantWarrantRow,
} from "../src/sheet/simulationPosition";
import {
  buildWhatIfHourlyPnlSeries,
  computeWhatIfCurveStats,
  isWhatIfStrongNow,
  resolveWhatIfPriceBaselines,
  type WhatIfCurveStats,
  type WhatIfHourlyCurvePoint,
} from "../src/sheet/simUniverse24hWhatIf";
import {
  buildWhatIfCrownReadoutContext,
  buildWhatIfCrownReadoutFromSimRow,
  whatIfCrownReadoutNeedsEnrichment,
  type WhatIfCrownReadout,
} from "../src/sheet/whatIfCrownReadout";
import {
  emptyWhatIfReadoutDailySnapshotStore,
  lookupDailyReadoutAsCrown,
  type WhatIfReadoutDailySnapshotStore,
} from "../src/sheet/whatIfReadoutDailySnapshot";
import {
  crownHitDedupeKey,
  type WhatIfCrownHitEvent,
  type WhatIfCrownHitStore,
} from "../src/sheet/whatIfCrownHitStore";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");
const SCHEMA_VERSION = 1;
const FWD_SESSIONS = 5;
const CAPITAL = 5000;

type Population = "strong_offbook" | "pf_nonstrong";
type OutcomeType = "simPnl" | "fwdReturnPct";

export type NonCrownControlEvent = WhatIfCrownHitEvent & {
  population: Population;
  outcomeType: OutcomeType;
  /** Set when outcomeType === "fwdReturnPct" (+5 chart sessions, same as diag-signal-bucket-compare). */
  fwdReturnPct?: number | null;
};

type UniverseRow = {
  ticker: string;
  simKey: string;
  row: Record<string, unknown>;
};

type HistPoint = {
  ts: string;
  byTicker?: Record<string, { pnl?: number; pnlPct?: number; value?: number }>;
};

function readJson<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw) as T;
}

function readJsonPath<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw) as T;
}

function loadCrownStore(argPath: string | null): WhatIfCrownHitEvent[] {
  if (argPath) {
    const doc = readJsonPath<WhatIfCrownHitStore | { events?: WhatIfCrownHitEvent[] }>(argPath);
    if (doc && "events" in doc && Array.isArray(doc.events)) return doc.events;
  }
  for (const rel of ["whatif_crown_hits_export.json", "diag_crown_hits.json"]) {
    const doc = readJson<WhatIfCrownHitStore>(rel);
    if (doc?.events?.length) return doc.events;
  }
  return [];
}

function buildUniverse(
  simTable: SheetTable,
  inputs: InvestSimInputs,
): UniverseRow[] {
  const commons = commonTickersOnSheet(simTable.rows ?? []);
  const out: UniverseRow[] = [];
  for (const r of simTable.rows ?? []) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE") || tk.length > 8 || /\s/.test(tk)) continue;
    if (shouldHideRedundantWarrantRow(r, commons, inputs)) continue;
    const cd = String(r["Completion Date"] ?? "");
    out.push({
      ticker: tk,
      simKey: normalizedRowKey(tk, cd),
      row: r as Record<string, unknown>,
    });
  }
  return out;
}

function wasInPortfolioOnSession(
  simKey: string,
  sessionDate: string,
  inputs: InvestSimInputs,
  hist: HistPoint[],
): boolean {
  const inp = inputs[simKey];
  const invested =
    inp?.purchaseDate?.trim()?.slice(0, 10) ||
    inp?.investedAt?.trim()?.slice(0, 10) ||
    null;
  if (invested && invested > sessionDate) return false;
  if (inp?.ignoreSheet && inp.soldAt) {
    const soldDay = inp.soldAt.trim().slice(0, 10);
    if (soldDay && soldDay <= sessionDate) return false;
  }

  const snap = hist
    .filter((p) => p.ts.slice(0, 10) <= sessionDate && p.byTicker?.[simKey])
    .sort((a, b) => b.ts.localeCompare(a.ts))[0];
  if (snap?.byTicker?.[simKey]) return true;

  // Recent sessions: history may lag; trust current open book if invested before session.
  if (invested && invested <= sessionDate && inp && !inp.ignoreSheet && (inp.capital ?? 0) > 0) {
    return true;
  }
  return false;
}

type ChartPt = { data_cal?: string; label?: string; price_usd?: number | null };

function chartSeriesForRow(
  charts: ChartBundle | null,
  ticker: string,
  simKey: string,
): ChartPt[] {
  if (!charts?.series) return [];
  const cd = simKey.split("|").slice(1).join("|");
  const sk = simulationRowSeriesKey(ticker, cd);
  const series =
    charts.series[sk] ??
    Object.values(charts.series).find((s) => s.label?.includes(ticker));
  if (!series?.points?.length) return [];
  return [...series.points]
    .filter((p) => p.price_usd != null && Number.isFinite(p.price_usd))
    .sort((a, b) =>
      String(a.data_cal ?? a.label ?? "").localeCompare(String(b.data_cal ?? b.label ?? "")),
    );
}

function sessionDayFromPoint(p: ChartPt): string | null {
  const d = String(p.data_cal ?? p.label ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function dailyPctOnSession(pts: ChartPt[], sessionDate: string): number | null {
  const idx = pts.findIndex((p) => sessionDayFromPoint(p) === sessionDate);
  if (idx <= 0) return null;
  const prev = pts[idx - 1]!.price_usd!;
  const cur = pts[idx]!.price_usd!;
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function forwardReturnPct(pts: ChartPt[], sessionDate: string, sessions = FWD_SESSIONS): number | null {
  const idx = pts.findIndex((p) => sessionDayFromPoint(p) === sessionDate);
  if (idx < 0 || idx + sessions >= pts.length) return null;
  const p0 = pts[idx]!.price_usd!;
  const pN = pts[idx + sessions]!.price_usd!;
  if (!(p0 > 0)) return null;
  return Math.round(((pN - p0) / p0) * 1000) / 10;
}

function prevCloseForSession(pts: ChartPt[], sessionDate: string): number | null {
  const idx = pts.findIndex((p) => sessionDayFromPoint(p) === sessionDate);
  if (idx <= 0) return null;
  const prev = pts[idx - 1]!.price_usd!;
  return prev > 0 ? prev : null;
}

function fetchSessionIntraday(
  tickers: string[],
  sessionDate: string,
  dryRun: boolean,
): Record<string, { t: string; price: number }[]> {
  if (dryRun || !tickers.length) return {};
  const pyScript = path.join(import.meta.dirname, "fetch_session_intraday.py");
  if (!fs.existsSync(pyScript)) {
    console.warn("  ⚠ fetch_session_intraday.py missing — skipping Yahoo fetch");
    return {};
  }
  try {
    const raw = execFileSync("python", [pyScript, tickers.join(","), sessionDate], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
    const parsed = JSON.parse(raw) as {
      series?: Record<string, { t: string; price: number }[]>;
    };
    return parsed.series ?? {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`  ⚠ intraday fetch failed for ${sessionDate}: ${msg.slice(0, 120)}`);
    return {};
  }
}

function readoutCompleteness(r: WhatIfCrownReadout | null | undefined): "full" | "partial" | "missing" {
  if (!r) return "missing";
  if (whatIfCrownReadoutNeedsEnrichment(r)) return "partial";
  return "full";
}

function buildReadout(
  u: UniverseRow,
  inPf: boolean,
  ctx: ReturnType<typeof buildWhatIfCrownReadoutContext>,
  frozenAt: string,
  sessionDate: string,
  dailySnapshot: WhatIfReadoutDailySnapshotStore,
): WhatIfCrownReadout | null {
  const fromDaily = lookupDailyReadoutAsCrown(dailySnapshot, sessionDate, u.ticker);
  if (fromDaily && !whatIfCrownReadoutNeedsEnrichment(fromDaily)) return fromDaily;
  const live = buildWhatIfCrownReadoutFromSimRow(u.row, {
    source: "backfill",
    frozenAt,
    hasPosition: inPf,
    ticker: u.ticker,
    simKey: u.simKey,
    ctx,
  });
  if (fromDaily && live) {
    return {
      ...fromDaily,
      sds: fromDaily.sds ?? live.sds,
      eis: fromDaily.eis ?? live.eis,
      pPlan: fromDaily.pPlan ?? live.pPlan,
      precatKind: fromDaily.precatKind ?? live.precatKind,
      pCont: fromDaily.pCont ?? live.pCont,
      contG10: fromDaily.contG10 ?? live.contG10,
      exhaustEdge: fromDaily.exhaustEdge ?? live.exhaustEdge,
      dailyPct24h: fromDaily.dailyPct24h ?? live.dailyPct24h,
      miiAngleDeg: fromDaily.miiAngleDeg ?? live.miiAngleDeg,
      source: "snapshot",
    };
  }
  return fromDaily ?? live;
}

export type NonCrownExportResult = {
  events: NonCrownControlEvent[];
  sessionDates: string[];
  byPop: Record<Population, number>;
};

/** Build historical non-crown control rows anchored on crown session dates. */
export function buildNonCrownControlExport(
  crownEvents: WhatIfCrownHitEvent[],
  opts: { dryRun?: boolean; verbose?: boolean } = {},
): NonCrownExportResult {
  const dryRun = opts.dryRun ?? false;
  const verbose = opts.verbose ?? true;
  const log = verbose ? console.log.bind(console) : () => {};

  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  if (!simSnap?.rows?.length) {
    throw new Error("Missing data/simulation_sheet_snapshot.json");
  }

  const simTable: SheetTable = {
    sheet: "Simulation",
    columns: simSnap.columns ?? [],
    rows: simSnap.rows,
  };
  const inputs =
    readJson<{ inputs?: InvestSimInputs }>("invest_sim_inputs.json")?.inputs ?? {};
  const sdsRows = readJson<{ rows?: SdsRow[] }>("sds_snapshot.json")?.rows ?? [];
  const charts = readJson<ChartBundle>("simulation_charts_snapshot.json");
  const hist =
    readJson<{ history?: HistPoint[]; points?: HistPoint[] }>("invest_sim_history.json")
      ?.history ??
    readJson<{ points?: HistPoint[] }>("invest_sim_history.json")?.points ??
    [];

  const universe = buildUniverse(simTable, inputs);
  const tickers = [...new Set(universe.map((u) => u.ticker))];
  const readoutCtx = buildWhatIfCrownReadoutContext({
    sdsRows,
    simTable,
    chartBundle: charts,
    inputs,
  });
  const dailySnapshot =
    readJson<WhatIfReadoutDailySnapshotStore>("whatif_readout_daily_snapshot.json") ??
    emptyWhatIfReadoutDailySnapshotStore();
  const dailyDayCount = Object.keys(dailySnapshot.days ?? {}).length;
  if (dailyDayCount > 0) {
    log(`Daily readout snapshot: ${dailyDayCount} session day(s) on disk`);
  } else {
    log(`NOTE: no whatif_readout_daily_snapshot.json — readouts fall back to current SDS/EIS (backfill)`);
  }

  const crownKeys = new Set(
    crownEvents.map((e) => crownHitDedupeKey(e.sessionDate, e.ticker)),
  );
  const sessionDates = [...new Set(crownEvents.map((e) => e.sessionDate))].sort();
  const chartByKey = new Map(universe.map((u) => [u.simKey, chartSeriesForRow(charts, u.ticker, u.simKey)]));

  const events: NonCrownControlEvent[] = [];
  const seen = new Set<string>();

  log(`Crown anchor: ${crownEvents.length} hits · ${sessionDates.length} session days`);
  log(`Universe: ${universe.length} rows · ${tickers.length} tickers`);
  if (dryRun) log("DRY-RUN: skipping Yahoo intraday fetch — no events will be classified (Strong requires hourly replay)\n");

  for (const sessionDate of sessionDates) {
    process.stdout.write(`Session ${sessionDate} … `);
    const intradaySeries = fetchSessionIntraday(tickers, sessionDate, dryRun);

    const dailyPctByTicker: Record<string, number | null> = {};
    const prevCloseByTicker: Record<string, number | null> = {};
    for (const u of universe) {
      const pts = chartByKey.get(u.simKey) ?? [];
      dailyPctByTicker[u.ticker] = dailyPctOnSession(pts, sessionDate);
      prevCloseByTicker[u.ticker] = prevCloseForSession(pts, sessionDate);
    }

    const priceSeries: Record<string, { t: string; price: number }[]> = {};
    for (const tk of tickers) {
      const pts = intradaySeries[tk];
      if (pts?.length) priceSeries[tk] = pts;
    }

    let curveStats = new Map<string, WhatIfCurveStats>();
    let hasHourly = false;

    if (Object.keys(priceSeries).length > 0) {
      const baselines = resolveWhatIfPriceBaselines(tickers, priceSeries, {
        prevCloseByTicker,
        dailyPctByTicker,
      });
      const { chartRows, tickersWithData } = buildWhatIfHourlyPnlSeries(
        tickers,
        priceSeries,
        CAPITAL,
        baselines,
      );
      if (chartRows.length && tickersWithData.length) {
        curveStats = computeWhatIfCurveStats(chartRows as WhatIfHourlyCurvePoint[], tickersWithData);
        hasHourly = curveStats.size > 0;
      }
    }

    let nStrongOff = 0;
    let nPfNon = 0;

    for (const u of universe) {
      const dedupe = crownHitDedupeKey(sessionDate, u.ticker);
      if (crownKeys.has(dedupe) || seen.has(dedupe)) continue;

      const st = curveStats.get(u.ticker);
      if (!st) continue; // Strong classification requires hourly what-if path replay

      const inPf = wasInPortfolioOnSession(u.simKey, sessionDate, inputs, hist);
      const dailyPct = dailyPctByTicker[u.ticker] ?? null;
      const strongNow = isWhatIfStrongNow(st.strong, dailyPct);

      let population: Population | null = null;
      if (strongNow && !inPf) population = "strong_offbook";
      else if (inPf && !strongNow) population = "pf_nonstrong";
      else continue;

      const frozenAt = new Date().toISOString();
      const readout = buildReadout(u, inPf, readoutCtx, frozenAt, sessionDate, dailySnapshot);

      let outcomeType: OutcomeType = "simPnl";
      let endPnl = st.endPnl;
      let pathMax = st.pathMax;
      let pathMin = st.pathMin;
      let oscillating = st.oscillating;
      let fwdReturnPct: number | null = null;

      // Supplementary forward label (same +5 session horizon as diag-signal-bucket-compare)
      const pts = chartByKey.get(u.simKey) ?? [];
      fwdReturnPct = forwardReturnPct(pts, sessionDate);
      if (fwdReturnPct != null) {
        // Keep simPnl as primary outcome; store fwd for cross-check columns in downstream analysis
      }

      seen.add(dedupe);
      if (population === "strong_offbook") nStrongOff += 1;
      else nPfNon += 1;

      events.push({
        sessionDate,
        ticker: u.ticker,
        simKey: u.simKey,
        population,
        outcomeType,
        ...(fwdReturnPct != null ? { fwdReturnPct } : {}),
        endPnl,
        pathMax,
        pathMin,
        oscillating,
        capturedAt: frozenAt,
        updatedAt: frozenAt,
        readout,
      });
    }

    log(
      `strong_offbook +${nStrongOff} · pf_nonstrong +${nPfNon} · hourly ${hasHourly ? "yes" : "no"}`,
    );
  }

  events.sort((a, b) => {
    const d = b.sessionDate.localeCompare(a.sessionDate);
    if (d !== 0) return d;
    return a.ticker.localeCompare(b.ticker);
  });

  const byPop: Record<Population, number> = { strong_offbook: 0, pf_nonstrong: 0 };
  const uniqueSimKeys = new Set<string>();
  let fullReadout = 0;
  let partialReadout = 0;
  let missingReadout = 0;
  let simPnlOutcomes = 0;
  let fwdOutcomes = 0;

  for (const e of events) {
    byPop[e.population] += 1;
    uniqueSimKeys.add(`${e.sessionDate}|${e.simKey}`);
    const c = readoutCompleteness(e.readout);
    if (c === "full") fullReadout += 1;
    else if (c === "partial") partialReadout += 1;
    else missingReadout += 1;
    if (e.outcomeType === "simPnl") simPnlOutcomes += 1;
    else fwdOutcomes += 1;
  }

  if (verbose) {
    console.log("\n=== Non-crown control export summary ===");
    console.log(`Total events:        ${events.length}`);
    console.log(`Unique session|simKey: ${uniqueSimKeys.size}`);
    console.log(`  strong_offbook:    ${byPop.strong_offbook}`);
    console.log(`  pf_nonstrong:      ${byPop.pf_nonstrong}`);
    console.log(`Readout complete:    ${fullReadout} (SDS+EIS+P(plan) present)`);
    console.log(`Readout partial:     ${partialReadout}`);
    console.log(`Readout missing:     ${missingReadout}`);
    console.log(`Outcome simPnl:      ${simPnlOutcomes} (hourly what-if path replay)`);
    console.log(`Outcome fwdReturnPct:${fwdOutcomes} (+${FWD_SESSIONS} chart sessions fallback)`);
    console.log(`\nNOTE: rows without daily snapshot use current SDS/EIS (backfill); snapshot rows marked source=snapshot.`);
    console.log(`      Each event has individual frozenAt for bias tracking.`);
  }

  return { events, sessionDates, byPop };
}

function writeNonCrownExportJson(events: NonCrownControlEvent[]): string {
  const outDoc = { schemaVersion: SCHEMA_VERSION, events };
  const outPath = path.join(DATA, "whatif_noncrown_export.json");
  fs.writeFileSync(outPath, JSON.stringify(outDoc, null, 2));
  return outPath;
}

function main() {
  const crownArg = process.argv.find((a, i) => process.argv[i - 1] === "--crown") ?? null;
  const dryRun = process.argv.includes("--dry-run");

  const crownEvents = loadCrownStore(crownArg);
  if (!crownEvents.length) {
    console.error(
      "Missing crown export. Export from Grado 3 panel or:\n" +
        "  copy(localStorage.getItem('supernova.whatIf.crownHits.v1'))\n" +
        "  → data/whatif_crown_hits_export.json\n" +
        "Or pass --crown PATH",
    );
    process.exit(1);
  }

  const { events } = buildNonCrownControlExport(crownEvents, { dryRun, verbose: true });
  const outPath = writeNonCrownExportJson(events);
  console.log(`\nWrote ${outPath}`);
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").includes("export-noncrown-control");
if (isDirectRun) main();
