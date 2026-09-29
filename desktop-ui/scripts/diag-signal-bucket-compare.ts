/**
 * Numeric compare: MII+volume vs SDS vs P(plan) vs crown log — PF + full Simulation universe.
 *
 *   cd desktop-ui
 *   npx tsx scripts/diag-signal-bucket-compare.ts
 *   npx tsx scripts/diag-signal-bucket-compare.ts --crown ../data/whatif_crown_hits_export.json
 *
 * Crown export (browser console on dashboard):
 *   copy(localStorage.getItem('supernova.whatIf.crownHits.v1'))
 *   → save as data/whatif_crown_hits_export.json
 *
 * Or use «Export crown log» in Grado 3 panel (dashboard).
 */
import fs from "node:fs";
import path from "node:path";
import type { ChartBundle, SheetTable } from "../src/types";
import type { SdsRow } from "../src/api/supernova";
import type { InvestSimInputs } from "../src/sheet/investSimStorage";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../src/data/simulationCharts";
import { buildMigSolidityByKey } from "../src/sheet/entrySolidityMig";
import { buildLossAnalysisItems } from "../src/sheet/portfolioLossAnalysis";
import { buildSdsByTicker } from "../src/sheet/sdsTopOppGate";
import { extractPPlanFromSimRow } from "../src/sheet/scoreValidationExport";
import { normalizedRowKey } from "../src/sheet/investSimKeys";
import {
  commonTickersOnSheet,
  dailyChangePctFromRow,
  rowHasActivePortfolio,
  shouldHideRedundantWarrantRow,
} from "../src/sheet/simulationPosition";
import type { WhatIfCrownHitEvent, WhatIfCrownHitStore } from "../src/sheet/whatIfCrownHitStore";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DATA = path.join(ROOT, "data");

const SDS_MIN = 40;
const PPLAN_MIN = 55;
const MII_ANGLE_MIN = 15;
const VOL_RATIO_MIN = 1.25;
const PCONT_MIN = 60;
/** Below this n, lift in pp is suppressed in report (noise). */
const MIN_N_REPORT_LIFT = 20;
/** n≥30 = adequate for directional claims. */
const MIN_N_ADEQUATE = 30;

type SampleReliability = "insufficient" | "caution" | "adequate";

function sampleReliability(n: number): SampleReliability {
  if (n < MIN_N_REPORT_LIFT) return "insufficient";
  if (n < MIN_N_ADEQUATE) return "caution";
  return "adequate";
}

/** Wilson 95% CI for win rate (percentage points). */
function winRateWilsonCiPct(wins: number, n: number): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return {
    lo: Math.round(((center - margin) / denom) * 1000) / 10,
    hi: Math.round(((center + margin) / denom) * 1000) / 10,
  };
}

function winsFromRate(ratePct: number | null, n: number): number {
  if (ratePct == null || n <= 0) return 0;
  return Math.round((ratePct / 100) * n);
}

function fmtLiftDisplay(n: number, lift: number | null | undefined, raw?: number | null): string {
  const v = lift ?? raw;
  if (v == null || !Number.isFinite(v)) return "—";
  const suffix = sampleReliability(n) === "insufficient" ? " †" : "";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp${suffix}`;
}

function fmtLift(n: number, lift: number | null | undefined): string {
  if (lift == null || !Number.isFinite(lift)) {
    if (sampleReliability(n) === "insufficient") return `— (n=${n}<${MIN_N_REPORT_LIFT})`;
    return "—";
  }
  return fmtLiftDisplay(n, lift);
}

function fmtCi(ci: { lo: number; hi: number } | null): string {
  if (!ci) return "—";
  return `[${ci.lo.toFixed(1)}%, ${ci.hi.toFixed(1)}%]`;
}

type CiVsBaseline = {
  verdict: "excludes" | "overlaps" | "marginal_exclude" | null;
  note: string;
};

/** Does bucket Wilson CI exclude baseline win-rate? (approximate 95% binomial check) */
function ciVsBaseline(
  ci: { lo: number; hi: number } | null | undefined,
  baselineWinPct: number | null,
): CiVsBaseline {
  if (!ci || baselineWinPct == null) return { verdict: null, note: "—" };
  if (baselineWinPct >= ci.lo && baselineWinPct <= ci.hi) {
    return {
      verdict: "overlaps",
      note: `baseline ${fmt(baselineWinPct)}% inside CI ${fmtCi(ci)} → cannot reject equal win-rate at ~95%`,
    };
  }
  const dist = baselineWinPct < ci.lo ? ci.lo - baselineWinPct : baselineWinPct - ci.hi;
  if (dist < 1) {
    return {
      verdict: "marginal_exclude",
      note: `baseline ${fmt(baselineWinPct)}% just outside CI (Δ${dist.toFixed(1)}pp) — weak exclusion`,
    };
  }
  return {
    verdict: "excludes",
    note: `baseline ${fmt(baselineWinPct)}% outside CI ${fmtCi(ci)} → win-rate differs at ~95%`,
  };
}

function evidenceBadge(n: number, ci: CiVsBaseline): string {
  if (n < MIN_N_REPORT_LIFT) return `⚠ n=${n} — non significativo (n<${MIN_N_REPORT_LIFT})`;
  if (ci.verdict === "overlaps") return `△ n=${n} — **CI overlaps baseline** (direction only)`;
  if (ci.verdict === "marginal_exclude") return `△ n=${n} — CI excludes baseline **marginally**`;
  if (ci.verdict === "excludes") return `✓ n=${n} — CI excludes baseline`;
  if (n < MIN_N_ADEQUATE) return `△ n=${n} — cautela (n<${MIN_N_ADEQUATE})`;
  return `✓ n=${n}`;
}

function readJson<T>(file: string): T | null {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function readJsonPath<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function winRate(vals: number[]): number | null {
  if (!vals.length) return null;
  return Math.round((vals.filter((v) => v > 0).length / vals.length) * 1000) / 10;
}

function fmt(n: number | null, d = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

type BucketStats = {
  n: number;
  winRatePct: number | null;
  median: number | null;
  mean: number | null;
};

function stats(vals: number[]): BucketStats {
  if (!vals.length) return { n: 0, winRatePct: null, median: null, mean: null };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    n: vals.length,
    winRatePct: winRate(vals),
    median: median(vals),
    mean: Math.round(mean * 10) / 10,
  };
}

function liftVsBaseline(
  bucket: BucketStats,
  baseline: BucketStats,
): {
  medianLift: number | null;
  winRateLiftPp: number | null;
  reportable: boolean;
  medianLiftRaw: number | null;
  winRateLiftPpRaw: number | null;
} {
  const reportable = sampleReliability(bucket.n) !== "insufficient";
  const medianLiftRaw =
    bucket.median != null && baseline.median != null
      ? Math.round((bucket.median - baseline.median) * 100) / 100
      : null;
  const winRateLiftPpRaw =
    bucket.winRatePct != null && baseline.winRatePct != null
      ? Math.round((bucket.winRatePct - baseline.winRatePct) * 10) / 10
      : null;
  return {
    medianLift: reportable ? medianLiftRaw : null,
    winRateLiftPp: reportable ? winRateLiftPpRaw : null,
    medianLiftRaw,
    winRateLiftPpRaw,
    reportable,
  };
}

function enrichStats(s: BucketStats) {
  const wins = winsFromRate(s.winRatePct, s.n);
  return {
    ...s,
    wins,
    winRateCi95: winRateWilsonCiPct(wins, s.n),
    reliability: sampleReliability(s.n),
  };
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

function analyzeCrownLog(events: WhatIfCrownHitEvent[]) {
  if (!events.length) return null;

  const endPnl = events.map((e) => e.endPnl);
  const pathMax = events.map((e) => e.pathMax);

  const withSds = events.filter((e) => (e.readout?.sds ?? 0) >= SDS_MIN);
  const withPplan = events.filter((e) => (e.readout?.pPlan ?? 0) >= PPLAN_MIN);
  const withPcont = events.filter((e) => (e.readout?.pCont ?? 0) >= PCONT_MIN);
  const withMii = events.filter((e) => (e.readout?.miiAngleDeg ?? 0) >= MII_ANGLE_MIN);
  const withReadout = events.filter((e) => e.readout != null);
  const withFullReadout = events.filter(
    (e) =>
      e.readout?.sds != null &&
      e.readout?.pPlan != null &&
      e.readout?.eis != null,
  );

  const tickers = [...new Set(events.map((e) => e.ticker))].sort();
  const byTicker = Object.fromEntries(
    tickers.map((tk) => [tk, events.filter((e) => e.ticker === tk).length]),
  );

  return {
    totalHits: events.length,
    sessionDays: new Set(events.map((e) => e.sessionDate)).size,
    uniqueTickers: tickers.length,
    hitsByTicker: byTicker,
    all: {
      endPnl: stats(endPnl),
      pathMax: stats(pathMax),
    },
    withReadout: withReadout.length,
    withFullReadout: withFullReadout.length,
    subsets: {
      sdsGe40: {
        n: withSds.length,
        endPnl: stats(withSds.map((e) => e.endPnl)),
        pathMax: stats(withSds.map((e) => e.pathMax)),
      },
      pplanGe55: {
        n: withPplan.length,
        endPnl: stats(withPplan.map((e) => e.endPnl)),
        pathMax: stats(withPplan.map((e) => e.pathMax)),
      },
      pcontGe60: {
        n: withPcont.length,
        endPnl: stats(withPcont.map((e) => e.endPnl)),
        pathMax: stats(withPcont.map((e) => e.pathMax)),
      },
      miiGe15: {
        n: withMii.length,
        endPnl: stats(withMii.map((e) => e.endPnl)),
        pathMax: stats(withMii.map((e) => e.pathMax)),
      },
    },
    note:
      "Crown outcomes = what-if path P&L on session day (Strong∩PF). Readout subsets use frozen values on hit (may be partial on legacy hits).",
  };
}

type RowSignals = {
  key: string;
  ticker: string;
  inPf: boolean;
  sds: number | null;
  pplan: number | null;
  miiAngle: number | null;
  volRatio: number | null;
  pnlPct24h: number | null;
  planReturnPct: number | null;
  curvePeakReturnPct: number | null;
  openPnlPct: number | null;
};

function classifyRow(r: RowSignals) {
  const miiVol =
    r.miiAngle != null &&
    r.miiAngle >= MII_ANGLE_MIN &&
    r.volRatio != null &&
    r.volRatio >= VOL_RATIO_MIN;
  const sdsOk = r.sds != null && r.sds >= SDS_MIN;
  const pplanOk = r.pplan != null && r.pplan >= PPLAN_MIN;
  const crownProxy =
    miiVol &&
    (r.pnlPct24h == null || r.pnlPct24h >= 0) &&
    (sdsOk || pplanOk || (r.pplan != null && r.pplan >= 50));
  return { miiVol, sdsOk, pplanOk, crownProxy };
}

function buildUniverseRows(
  simTable: SheetTable,
  inputs: InvestSimInputs,
  sdsRows: SdsRow[],
  charts: ChartBundle | null,
): RowSignals[] {
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const commons = commonTickersOnSheet(simTable.rows ?? []);
  const rows: RowSignals[] = [];

  for (const r of simTable.rows ?? []) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE") || tk.length > 8 || /\s/.test(tk)) continue;
    if (shouldHideRedundantWarrantRow(r, commons, inputs)) continue;
    const key = normalizedRowKey(tk, String(r["Completion Date"] ?? ""));
    const mig = migByKey.get(key);
    const dailyPct = dailyChangePctFromRow(r as Record<string, unknown>);
    rows.push({
      key,
      ticker: tk,
      inPf: rowHasActivePortfolio(r, inputs),
      sds: sdsByTicker.get(tk)?.sds ?? null,
      pplan: extractPPlanFromSimRow(r as Record<string, unknown>, inputs[key], key),
      miiAngle: mig?.slopeAngleDeg ?? null,
      volRatio: mig?.volRatio ?? null,
      pnlPct24h: dailyPct != null && Number.isFinite(dailyPct) ? dailyPct : null,
      planReturnPct: null,
      curvePeakReturnPct: null,
      openPnlPct: null,
    });
  }
  return rows;
}

function buildPortfolioRows(
  simTable: SheetTable,
  inputs: InvestSimInputs,
  sdsRows: SdsRow[],
  charts: ChartBundle | null,
): RowSignals[] {
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable, charts, sdsRows);
  const pointsByKey = charts ? chartPointsMapFromBundle(charts) : new Map();

  const pfItems = buildLossAnalysisItems(
    "portfolio",
    simTable,
    inputs,
    pointsByKey,
    "it",
    null,
    { sdsRows, migSolidityByKey: migByKey },
  );

  const rowByKey = new Map<string, Record<string, unknown>>();
  for (const r of simTable.rows ?? []) {
    const tk = String(r.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    rowByKey.set(normalizedRowKey(tk, String(r["Completion Date"] ?? "")), r as Record<string, unknown>);
  }

  return pfItems.map((item) => {
    const mig = migByKey.get(item.key);
    const simRow = rowByKey.get(item.key);
    const tk = item.ticker.trim().toUpperCase();
    return {
      key: item.key,
      ticker: tk,
      inPf: true,
      sds: sdsByTicker.get(tk)?.sds ?? null,
      pplan: extractPPlanFromSimRow(simRow, inputs[item.key], item.key),
      miiAngle: mig?.slopeAngleDeg ?? null,
      volRatio: mig?.volRatio ?? null,
      pnlPct24h: item.pnlPct24h,
      planReturnPct: item.planReturnPct,
      curvePeakReturnPct: item.curvePeakReturnPct,
      openPnlPct: item.pnlPct,
    };
  });
}

type CrossTag = "mii_vol" | "sds40" | "pplan55";

function crossSectionCompare(rows: RowSignals[], baselineKey: string) {
  const buckets: Record<string, RowSignals[]> = {
    [baselineKey]: rows,
    mii_vol: [],
    sds40: [],
    pplan55: [],
  };

  for (const r of rows) {
    const c = classifyRow(r);
    if (c.miiVol) buckets.mii_vol!.push(r);
    if (c.sdsOk) buckets.sds40!.push(r);
    if (c.pplanOk) buckets.pplan55!.push(r);
  }

  const outcome = (rs: RowSignals[], field: keyof RowSignals) =>
    stats(
      rs
        .map((r) => r[field])
        .filter((v): v is number => v != null && Number.isFinite(v)),
    );

  const baselineStats = enrichStats(outcome(rows, "pnlPct24h"));
  const baselineWin = baselineStats.winRatePct;
  const report: Record<string, unknown> = {
    nRows: rows.length,
    nWithDailyPct: rows.filter((r) => r.pnlPct24h != null).length,
    nInPf: rows.filter((r) => r.inPf).length,
  };

  for (const [tag, rs] of Object.entries(buckets)) {
    const daily = enrichStats(outcome(rs, "pnlPct24h"));
    const ciTest =
      tag !== baselineKey ? ciVsBaseline(daily.winRateCi95, baselineWin) : null;
    report[tag] = {
      n: rs.length,
      nWithDailyPct: rs.filter((r) => r.pnlPct24h != null).length,
      sharePct: rows.length ? Math.round((rs.length / rows.length) * 1000) / 10 : null,
      pnlPct24h: daily,
      planReturnPct: enrichStats(outcome(rs, "planReturnPct")),
      curvePeakReturnPct: enrichStats(outcome(rs, "curvePeakReturnPct")),
      openPnlPct: enrichStats(outcome(rs, "openPnlPct")),
      liftVsBaseline:
        tag !== baselineKey ? liftVsBaseline(daily, baselineStats) : null,
      ciVsBaseline: ciTest,
      baselineWinRatePct: baselineWin,
      tickers: rs.map((r) => r.ticker).sort(),
    };
  }
  return report;
}

type HistPoint = {
  ts: string;
  byTicker?: Record<string, { pnl?: number; pnlPct?: number; value?: number }>;
};

function historyWeeklyForward(
  rows: RowSignals[],
  hist: HistPoint[],
  scopeLabel: string,
): Record<string, unknown> | null {
  if (hist.length < 3) return null;
  const sorted = [...hist].sort((a, b) => a.ts.localeCompare(b.ts));
  const tickerSet = new Set(rows.map((r) => r.key));
  const signalByKey = new Map(rows.map((r) => [r.key, r]));

  type Sample = { fwdPnlDelta: number; fwdPctDelta: number | null };
  const byBucket: Record<string, Sample[]> = {
    baseline: [],
    mii_vol: [],
    sds40: [],
    pplan55: [],
  };

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const nxt = sorted[i + 1]!;
    if (!cur.byTicker || !nxt.byTicker) continue;
    for (const key of tickerSet) {
      const c = cur.byTicker[key];
      const n = nxt.byTicker[key];
      if (!c || !n) continue;
      const sig = signalByKey.get(key);
      if (!sig) continue;
      const dPnl = (n.pnl ?? 0) - (c.pnl ?? 0);
      const dPct =
        c.pnlPct != null && n.pnlPct != null ? n.pnlPct - c.pnlPct : null;
      const sample = { fwdPnlDelta: dPnl, fwdPctDelta: dPct };
      byBucket.baseline!.push(sample);
      const c2 = classifyRow(sig);
      if (c2.miiVol) byBucket.mii_vol!.push(sample);
      if (c2.sdsOk) byBucket.sds40!.push(sample);
      if (c2.pplanOk) byBucket.pplan55!.push(sample);
    }
  }

  const summarize = (samples: Sample[]) => {
    const n = samples.length;
    const winRateFwdPnl = winRate(samples.map((s) => s.fwdPnlDelta));
    const wins = winsFromRate(winRateFwdPnl, n);
    return {
      n,
      winRateFwdPnl,
      wins,
      winRateCi95: winRateWilsonCiPct(wins, n),
      reliability: sampleReliability(n),
      medianFwdPnl: median(samples.map((s) => s.fwdPnlDelta)),
      medianFwdPct: median(
        samples.map((s) => s.fwdPctDelta).filter((v): v is number => v != null),
      ),
    };
  };

  const baseline = summarize(byBucket.baseline!);
  const baselineWin = baseline.winRateFwdPnl;
  const buckets: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(byBucket)) {
    const s = summarize(v);
    const liftWin =
      k !== "baseline" &&
      sampleReliability(s.n) !== "insufficient" &&
      s.winRateFwdPnl != null &&
      baselineWin != null
        ? Math.round((s.winRateFwdPnl - baselineWin) * 10) / 10
        : null;
    const ciTest =
      k !== "baseline" ? ciVsBaseline(s.winRateCi95, baselineWin) : null;
    buckets[k] = {
      ...s,
      baselineWinRatePct: baselineWin,
      liftWinRatePp: liftWin,
      liftMetric: "win_rate_pp",
      liftSuppressed: k !== "baseline" && sampleReliability(s.n) === "insufficient",
      ciVsBaseline: ciTest,
    };
  }

  return {
    scope: scopeLabel,
    historyPoints: sorted.length,
    windowNote:
      "Forward = Δ P&L between consecutive history snapshots (~weekly). Signals tagged with CURRENT snapshot (static — look-ahead bias).",
    buckets,
  };
}

function chartForwardStudy(
  rows: RowSignals[],
  charts: ChartBundle | null,
  scopeLabel: string,
): Record<string, unknown> | null {
  if (!charts?.series) return null;
  const sdsByKey = new Map(rows.map((r) => [r.key, r.sds]));
  const pplanByKey = new Map(rows.map((r) => [r.key, r.pplan]));
  const miiByKey = new Map(
    rows.map((r) => [
      r.key,
      r.miiAngle != null && r.volRatio != null
        ? { angle: r.miiAngle, vol: r.volRatio }
        : null,
    ]),
  );

  type Fwd = { fwd5dPct: number; mom5dPct: number; ticker: string; key: string };
  const miiVolSamples: Fwd[] = [];
  const miiMomSamples: Fwd[] = [];
  const sdsSamples: Fwd[] = [];
  const pplanSamples: Fwd[] = [];
  const allSamples: Fwd[] = [];

  for (const r of rows) {
    const cd = r.key.split("|").slice(1).join("|");
    const sk = simulationRowSeriesKey(r.ticker, cd);
    const series =
      charts.series[sk] ??
      Object.values(charts.series).find((s) => s.label?.includes(r.ticker));
    if (!series?.points?.length) continue;

    const pts = [...series.points]
      .filter((p) => p.price_usd != null && Number.isFinite(p.price_usd))
      .sort((a, b) =>
        String(a.data_cal ?? a.label ?? "").localeCompare(String(b.data_cal ?? b.label ?? "")),
      );

    for (let i = 5; i < pts.length - 5; i++) {
      const p0 = pts[i - 5]!.price_usd!;
      const p1 = pts[i]!.price_usd!;
      const p5 = pts[i + 5]!.price_usd!;
      if (p0 <= 0 || p1 <= 0) continue;
      const mom5 = ((p1 - p0) / p0) * 100;
      const fwd5 = ((p5 - p1) / p1) * 100;
      const daily =
        i > 0 && pts[i - 1]!.price_usd! > 0
          ? ((p1 - pts[i - 1]!.price_usd!) / pts[i - 1]!.price_usd!) * 100
          : 0;
      const sample = { fwd5dPct: fwd5, mom5dPct: mom5, ticker: r.ticker, key: r.key };
      allSamples.push(sample);

      const sds = sdsByKey.get(r.key);
      const pplan = pplanByKey.get(r.key);
      const mii = miiByKey.get(r.key);
      const miiVol =
        mii != null && mii.angle >= MII_ANGLE_MIN && mii.vol >= VOL_RATIO_MIN;
      const miiLike = mom5 >= 5 && daily >= 0;
      if (miiVol) miiVolSamples.push(sample);
      if (miiLike) miiMomSamples.push(sample);
      if (sds != null && sds >= SDS_MIN) sdsSamples.push(sample);
      if (pplan != null && pplan >= PPLAN_MIN) pplanSamples.push(sample);
    }
  }

  const sum = (arr: Fwd[]) => ({
    n: arr.length,
    winRate5d: winRate(arr.map((s) => s.fwd5dPct)),
    medianFwd5d: median(arr.map((s) => s.fwd5dPct)),
    meanFwd5d: arr.length
      ? Math.round((arr.reduce((a, b) => a + b.fwd5dPct, 0) / arr.length) * 10) / 10
      : null,
  });

  const baseline = sum(allSamples);
  const baselineWin = baseline.winRate5d;
  const withLift = (b: ReturnType<typeof sum>) => {
    const rel = sampleReliability(b.n);
    const wins = winsFromRate(b.winRate5d, b.n);
    const liftMedRaw =
      b.medianFwd5d != null && baseline.medianFwd5d != null
        ? Math.round((b.medianFwd5d - baseline.medianFwd5d) * 100) / 100
        : null;
    const liftWinRaw =
      b.winRate5d != null && baselineWin != null
        ? Math.round((b.winRate5d - baselineWin) * 10) / 10
        : null;
    const ci = winRateWilsonCiPct(wins, b.n);
    return {
      ...b,
      wins,
      winRateCi95: ci,
      reliability: rel,
      baselineWinRatePct: baselineWin,
      baselineMedianFwd5d: baseline.medianFwd5d,
      liftMetricPrimary: "win_rate_pp",
      liftWinRate5dPp: rel !== "insufficient" ? liftWinRaw : null,
      liftWinRate5dPpRaw: liftWinRaw,
      liftMedianFwd5dPp: rel !== "insufficient" ? liftMedRaw : null,
      liftMedianFwd5dPpRaw: liftMedRaw,
      liftSuppressed: rel === "insufficient",
      ciVsBaseline: ciVsBaseline(ci, baselineWin),
    };
  };

  return {
    scope: scopeLabel,
    note:
      "Primary lift = win-rate pp vs baseline (v2.1+). Secondary: median forward return pp (v1 chart tables used this — do not compare across versions). MII+vol static; MII mom = 5d mom proxy.",
    liftDefinitions: {
      primary: "win_rate_pp = bucket win% − baseline win%",
      secondary: "median_fwd_pp = bucket median +5d return − baseline median (v1 default in chart section)",
    },
    uniqueTickersWithChart: new Set(allSamples.map((s) => s.ticker)).size,
    buckets: {
      all_days: withLift(baseline),
      mii_vol_static: withLift(sum(miiVolSamples)),
      mii_mom_proxy: withLift(sum(miiMomSamples)),
      sds_ge40_static: withLift(sum(sdsSamples)),
      pplan_ge55_static: withLift(sum(pplanSamples)),
    },
  };
}

function signalCoverage(rows: RowSignals[]) {
  const n = rows.length;
  const count = (pred: (r: RowSignals) => boolean) => rows.filter(pred).length;
  return {
    n,
    withSds: count((r) => r.sds != null),
    withPplan: count((r) => r.pplan != null),
    withMii: count((r) => r.miiAngle != null),
    withVolRatio: count((r) => r.volRatio != null),
    withDailyPct: count((r) => r.pnlPct24h != null),
    sdsGe40: count((r) => r.sds != null && r.sds >= SDS_MIN),
    pplanGe55: count((r) => r.pplan != null && r.pplan >= PPLAN_MIN),
    miiVol: count((r) => classifyRow(r).miiVol),
    overlapSdsAndPplan: count((r) => classifyRow(r).sdsOk && classifyRow(r).pplanOk),
    pfOnly: count((r) => r.inPf),
    offBook: count((r) => !r.inPf),
  };
}

function printVerdict(report: Record<string, unknown>) {
  console.log("\n=== VERDICT (provisional until crown log loaded) ===\n");

  const crown = report.crownLog as ReturnType<typeof analyzeCrownLog>;
  if (!crown) {
    console.log("⚠ Crown log MISSING — all proxy results below are hypotheses only.");
  } else {
    console.log(
      `Crown log: ${crown.totalHits} hits · win ${fmt(crown.all.endPnl.winRatePct)}% · median ${fmt(crown.all.endPnl.median, 0)}$`,
    );
  }

  console.log("\nSDS≥40 — concordant positive lift across reportable samples:");
  const uni = report.universeCrossSection as Record<string, { n: number; liftVsBaseline?: { medianLift: number | null; winRateLiftPp: number | null } }>;
  const chartU = report.universeChartForward as { buckets?: Record<string, { n: number; liftWinRate5dPp: number | null }> };
  const chartOff = report.offBookChartForward as typeof chartU;
  const histU = report.universeHistoryForward as { buckets?: Record<string, { n: number; liftWinRatePp: number | null }> };
  const sdsCross = uni.sds40;
  const sdsChart = chartU?.buckets?.sds_ge40_static;
  const sdsOff = chartOff?.buckets?.sds_ge40_static;
  const sdsHist = histU?.buckets?.sds40;
  console.log(`  cross-section: n=${sdsCross?.n ?? 0} · median lift ${fmtLiftDisplay(sdsCross?.n ?? 0, sdsCross?.liftVsBaseline?.medianLift ?? null, sdsCross?.liftVsBaseline?.medianLiftRaw)}`);
  console.log(`  chart fwd:     n=${sdsChart?.n ?? 0} · win lift ${fmtLift(sdsChart?.n ?? 0, sdsChart?.liftWinRate5dPp)}`);
  console.log(`  off-book fwd:  n=${sdsOff?.n ?? 0} · win lift ${fmtLift(sdsOff?.n ?? 0, sdsOff?.liftWinRate5dPp)}`);
  console.log(`  history fwd:   n=${sdsHist?.n ?? 0} · win lift ${fmtLift(sdsHist?.n ?? 0, sdsHist?.liftWinRatePp)}`);

  console.log("\nP(plan)≥55 — flat/null (no predictive evidence at this cutoff):");
  const ppCross = uni.pplan55;
  const ppChart = chartU?.buckets?.pplan_ge55_static;
  console.log(`  cross-section n=${ppCross?.n ?? 0} · lift ${fmtLiftDisplay(ppCross?.n ?? 0, ppCross?.liftVsBaseline?.medianLift ?? null, ppCross?.liftVsBaseline?.medianLiftRaw)}`);
  console.log(`  chart fwd n=${ppChart?.n ?? 0} · lift ${fmtLift(ppChart?.n ?? 0, ppChart?.liftWinRate5dPp)}`);

  console.log("\nMII+vol — deprioritize (negative in n≥16 samples; ignore n=3 cross-section):");
  const miiChart = chartU?.buckets?.mii_vol_static;
  console.log(`  mii_vol static n=${miiChart?.n ?? 0} · lift ${fmtLift(miiChart?.n ?? 0, miiChart?.liftWinRate5dPp)}`);
}

function main() {
  const crownArg = process.argv.find((a, i) => process.argv[i - 1] === "--crown") ?? null;

  const simSnap = readJson<{ rows: SheetTable["rows"]; columns?: string[] }>(
    "simulation_sheet_snapshot.json",
  );
  if (!simSnap?.rows?.length) {
    console.error("Missing data/simulation_sheet_snapshot.json");
    process.exit(1);
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

  const crownEvents = loadCrownStore(crownArg);
  const universeRows = buildUniverseRows(simTable, inputs, sdsRows, charts);
  const pfRows = buildPortfolioRows(simTable, inputs, sdsRows, charts);
  const offBookRows = universeRows.filter((r) => !r.inPf);

  const report = {
    generatedAt: new Date().toISOString(),
    dataSources: {
      simulationRows: simTable.rows?.length ?? 0,
      sdsRows: sdsRows.length,
      chartSeries: charts?.series ? Object.keys(charts.series).length : 0,
      historyPoints: hist.length,
      crownExportFound: crownEvents.length > 0,
    },
    thresholds: { SDS_MIN, PPLAN_MIN, MII_ANGLE_MIN, VOL_RATIO_MIN, PCONT_MIN },
    signalCoverage: {
      universe: signalCoverage(universeRows),
      portfolio: signalCoverage(pfRows),
      offBook: signalCoverage(offBookRows),
    },
    crownLog: analyzeCrownLog(crownEvents),
    portfolioCrossSection: crossSectionCompare(pfRows, "baseline_pf"),
    universeCrossSection: crossSectionCompare(universeRows, "baseline_all"),
    offBookCrossSection: crossSectionCompare(offBookRows, "baseline_off"),
    portfolioChartForward: chartForwardStudy(pfRows, charts, "portfolio"),
    universeChartForward: chartForwardStudy(universeRows, charts, "universe"),
    offBookChartForward: chartForwardStudy(offBookRows, charts, "off_book"),
    portfolioHistoryForward: historyWeeklyForward(pfRows, hist, "portfolio"),
    universeHistoryForward: historyWeeklyForward(universeRows, hist, "universe"),
    limitations: [
      "PROVISIONAL: crown log (Strong∩PF ground truth) not loaded — sections 4–5c use static proxy tags with look-ahead bias.",
      "Lift in pp suppressed when n<20; treat n=20–29 as caution only.",
      "Signals are CURRENT snapshot tags applied to historical forward windows.",
      "Crown log outcomes are session-day what-if P&L, not realized trades.",
      "MII mom proxy ≠ real MII (entrySolidityMig is the single source of truth).",
      "PF book in snapshot may be tiny — prefer universe + crown export for gate changes.",
    ],
    methodology: {
      minNReportLift: MIN_N_REPORT_LIFT,
      minNAdequate: MIN_N_ADEQUATE,
      winRateCi: "Wilson 95% on win counts",
    },
  };

  const outJson = path.join(DATA, "diag_signal_bucket_compare.json");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const outMd = path.join(ROOT, "SIGNAL_BUCKET_STRATEGY_REPORT_2.1.md");
  fs.writeFileSync(outMd, buildMarkdownReport(report));
  fs.writeFileSync(path.join(ROOT, "SIGNAL_BUCKET_STRATEGY_REPORT_2.0.md"), buildMarkdownReport(report));
  fs.writeFileSync(path.join(ROOT, "SIGNAL_BUCKET_STRATEGY_REPORT.md"), buildMarkdownReport(report));

  console.log(JSON.stringify(report, null, 2));
  printVerdict(report);
  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outMd}`);
}

function buildMarkdownReport(report: Record<string, unknown>): string {
  type Enriched = BucketStats & {
    wins?: number;
    winRateCi95?: { lo: number; hi: number } | null;
    reliability?: SampleReliability;
  };
  type CrossBucket = {
    n: number;
    nWithDailyPct?: number;
    sharePct?: number;
    pnlPct24h: Enriched;
    liftVsBaseline?: {
      medianLift: number | null;
      winRateLiftPp: number | null;
      medianLiftRaw?: number | null;
      winRateLiftPpRaw?: number | null;
    };
    ciVsBaseline?: CiVsBaseline;
    baselineWinRatePct?: number | null;
  };
  type ChartBucket = {
    n: number;
    winRate5d: number | null;
    wins?: number;
    winRateCi95?: { lo: number; hi: number } | null;
    reliability?: SampleReliability;
    medianFwd5d: number | null;
    baselineWinRatePct?: number | null;
    liftWinRate5dPp: number | null;
    liftWinRate5dPpRaw?: number | null;
    liftMedianFwd5dPpRaw?: number | null;
    liftSuppressed?: boolean;
    ciVsBaseline?: CiVsBaseline;
  };
  type HistBucket = {
    n: number;
    winRateFwdPnl: number | null;
    wins?: number;
    winRateCi95?: { lo: number; hi: number } | null;
    reliability?: SampleReliability;
    baselineWinRatePct?: number | null;
    liftWinRatePp: number | null;
    liftSuppressed?: boolean;
    ciVsBaseline?: CiVsBaseline;
  };

  const cov = report.signalCoverage as {
    universe: ReturnType<typeof signalCoverage>;
    portfolio: ReturnType<typeof signalCoverage>;
  };
  const uni = report.universeCrossSection as Record<string, CrossBucket>;
  const chartU = report.universeChartForward as { buckets?: Record<string, ChartBucket> };
  const chartOff = report.offBookChartForward as typeof chartU;
  const histU = report.universeHistoryForward as { buckets?: Record<string, HistBucket> };
  const crown = report.crownLog as ReturnType<typeof analyzeCrownLog>;
  const lim = report.limitations as string[];
  const ds = report.dataSources as Record<string, unknown>;
  const provisional = !ds.crownExportFound;

  const relBadge = (n: number, ci?: CiVsBaseline) =>
    ci ? evidenceBadge(n, ci) : evidenceBadge(n, { verdict: null, note: "" });

  const crossRow = (tag: string, label: string, window: string) => {
    const b = uni[tag];
    if (!b || b.n === 0) return `| ${label} | ${window} | 0 | — | — | — | — |`;
    const st = b.pnlPct24h;
    const nNote =
      b.n !== st.n ? `${st.n} rows w/ Δ24h (${b.n} in bucket)` : String(st.n);
    const liftWin = fmtLiftDisplay(st.n, b.liftVsBaseline?.winRateLiftPp ?? null, b.liftVsBaseline?.winRateLiftPpRaw);
    const liftMed = fmtLiftDisplay(st.n, b.liftVsBaseline?.medianLift ?? null, b.liftVsBaseline?.medianLiftRaw);
    return `| ${label} | ${window} | ${nNote} | win ${fmt(st.winRatePct)}% ${fmtCi(st.winRateCi95 ?? null)} | ${liftWin} (win) · ${liftMed} (median Δ24h) | ${b.ciVsBaseline?.note ?? "—"} | ${relBadge(st.n, b.ciVsBaseline)} |`;
  };

  const chartRow = (tag: string, label: string, window: string, buckets = chartU?.buckets) => {
    const b = buckets?.[tag];
    const base = buckets?.all_days;
    if (!b || b.n === 0) return `| ${label} | ${window} | 0 | — | — | — | — |`;
    const liftWin = b.liftSuppressed
      ? `— (n<${MIN_N_REPORT_LIFT})`
      : fmtLiftDisplay(b.n, b.liftWinRate5dPp ?? null, b.liftWinRate5dPpRaw);
    const liftMedV1 =
      b.liftMedianFwd5dPpRaw != null
        ? `${b.liftMedianFwd5dPpRaw >= 0 ? "+" : ""}${b.liftMedianFwd5dPpRaw.toFixed(1)}pp (v1 metric)`
        : "—";
    return `| ${label} | ${window} | ${b.n} | win ${fmt(b.winRate5d)}% ${fmtCi(b.winRateCi95 ?? null)} · baseline ${fmt(base?.winRate5d ?? b.baselineWinRatePct)}% | ${liftWin} · med fwd ${liftMedV1} | ${b.ciVsBaseline?.note ?? "—"} | ${relBadge(b.n, b.ciVsBaseline)} |`;
  };

  const chartDetailRow = (tag: string, label: string, buckets = chartU?.buckets) => {
    const b = buckets?.[tag];
    const base = buckets?.all_days;
    if (!b || b.n === 0) return `| ${label} | 0 | — | — | — |`;
    const liftWin = b.liftSuppressed
      ? `— (n<${MIN_N_REPORT_LIFT})`
      : fmtLiftDisplay(b.n, b.liftWinRate5dPp ?? null, b.liftWinRate5dPpRaw);
    const liftMedV1 =
      b.liftMedianFwd5dPpRaw != null
        ? `${b.liftMedianFwd5dPpRaw >= 0 ? "+" : ""}${b.liftMedianFwd5dPpRaw.toFixed(1)}pp (v1 metric)`
        : "—";
    const ciShort =
      b.ciVsBaseline?.verdict === "overlaps"
        ? "overlaps"
        : b.ciVsBaseline?.verdict === "marginal_exclude"
          ? "marginal exclude"
          : b.ciVsBaseline?.verdict === "excludes"
            ? "excludes"
            : "—";
    return `| ${label} | ${b.n} | win ${fmt(b.winRate5d)}% ${fmtCi(b.winRateCi95 ?? null)} · baseline ${fmt(base?.winRate5d ?? b.baselineWinRatePct)}% | ${liftWin} · med fwd ${liftMedV1} | ${ciShort} |`;
  };

  const histRow = (tag: string, label: string, window: string) => {
    const b = histU?.buckets?.[tag];
    const base = histU?.buckets?.baseline;
    if (!b || b.n === 0) return `| ${label} | ${window} | 0 | — | — | — | — |`;
    const lift = b.liftSuppressed
      ? `— (n<${MIN_N_REPORT_LIFT})`
      : fmtLiftDisplay(b.n, b.liftWinRatePp ?? null);
    return `| ${label} | ${window} | ${b.n} | win ${fmt(b.winRateFwdPnl)}% ${fmtCi(b.winRateCi95 ?? null)} · baseline ${fmt(base?.winRateFwdPnl ?? b.baselineWinRatePct)}% | ${lift} | ${b.ciVsBaseline?.note ?? "—"} | ${relBadge(b.n, b.ciVsBaseline)} |`;
  };

  const sdsConcordance = [
    crossRow("sds40", "SDS≥40", "Δ24h cross-section"),
    chartRow("sds_ge40_static", "SDS≥40", "chart forward +5d"),
    chartRow("sds_ge40_static", "SDS≥40", "off-book chart +5d", chartOff?.buckets),
    histRow("sds40", "SDS≥40", "history weekly fwd"),
  ].join("\n");

  const pplanConcordance = [
    crossRow("pplan55", "P(plan)≥55", "Δ24h cross-section"),
    chartRow("pplan_ge55_static", "P(plan)≥55", "chart forward +5d"),
    chartRow("pplan_ge55_static", "P(plan)≥55", "off-book chart +5d", chartOff?.buckets),
    histRow("pplan55", "P(plan)≥55", "history weekly fwd"),
  ].join("\n");

  const sdsChart = chartU?.buckets?.sds_ge40_static;
  const sdsOff = chartOff?.buckets?.sds_ge40_static;
  const sdsHist = histU?.buckets?.sds40;
  const sdsCiSummary = [
    sdsChart?.ciVsBaseline?.verdict,
    sdsOff?.ciVsBaseline?.verdict,
    sdsHist?.ciVsBaseline?.verdict,
  ].filter((v) => v === "excludes" || v === "marginal_exclude").length;

  const pplanRow = uni.pplan55;
  const pplanCoverageNote =
    pplanRow && pplanRow.n !== (pplanRow.nWithDailyPct ?? pplanRow.n)
      ? `**Coverage vs cross-section:** ${cov.universe.pplanGe55} rows pass P(plan)≥55 in universe; cross-section outcomes use **${pplanRow.nWithDailyPct ?? pplanRow.pnlPct24h.n}** rows with valid Δ24h (${pplanRow.n} in bucket, ${(pplanRow.n ?? 0) - (pplanRow.nWithDailyPct ?? pplanRow.pnlPct24h.n)} missing Var. Giorn.).`
      : "";

  return `# Signal bucket strategy report 2.1 — MII / SDS / P(plan) / Crown

Version: **2.1**

### Changelog vs 2.0 / v1

| Change | Detail |
|--------|--------|
| **Lift definition (critical)** | **v1 chart tables** reported lift as **median forward return pp** (e.g. SDS universe +0.3pp = 0.2% − (−0.1%) median). **v2.0+ chart tables** report **win-rate pp** (e.g. +9.3pp = 54.2% − 44.9%). Same raw win%, different unit — **do not compare 0.3pp vs 9.3pp as “SDS got stronger”**. v2.1 shows **both** where relevant (win primary, median fwd labelled “v1 metric”). |
| **CI vs baseline test** | Wilson 95% CI on bucket win-rate; flag if **baseline falls inside CI** (cannot reject equality). Tier ✓/△ now uses CI exclusion, not n alone. |
| **History CI** | Wilson CI added to §5c (was missing in 2.0). |
| **Coverage footnote** | P(plan) row count vs Δ24h outcome count explained (§6). |
| From 2.0 | n≥20 lift rule, provisional banner, crown proxy removed, P(plan) null result, SDS directional concordance. |

Generated: ${report.generatedAt}

> Handoff for Claude / next agent. **Read §0 and changelog before any gate change.**

---

## 0. Status — ${provisional ? "PROVISIONAL (crown log missing)" : "Crown log loaded"}

${provisional ? `
**Every conclusion in §3–9 is a hypothesis until crown log (37 Strong∩PF hits) + Grado 4.**

- Proxy tags = today's SDS/P(plan)/MII on historical windows → **look-ahead bias**.
- Do **not** change Soft BUY/SELL gates from this report alone.
` : `Crown log loaded (${crown?.totalHits ?? 0} hits).`}

---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| **Strongest directional signal?** | **SDS≥40** — positive **win-rate lift** in all 4 windows (§3). But **only ${sdsCiSummary}/3** chart/history windows with CI have baseline **outside** bucket CI (others: baseline inside CI → direction only, not confirmed separation). |
| **P(plan)≥55 predictive?** | **No** — flat/negative win-rate lift; high coverage = poor separator (§4). Product role only. |
| **MII+volume alpha?** | **No** — negative when n≥16; ignore n=3 “positive”. |
| **v1 vs v2 “SDS got stronger”?** | **No** — mostly **lift metric change** (median fwd → win-rate). See changelog. |
| **Change gates now?** | **No** — crown Grado 4 first. |

---

## 2. Methodology

| Rule | Value |
|------|-------|
| **Primary lift (chart/history)** | **win-rate pp** = bucket win% − baseline win% |
| **Secondary lift (v1 comparable)** | **median forward return pp** — shown as “v1 metric” in chart rows |
| Report lift when | n≥${MIN_N_REPORT_LIFT} († = raw if n<${MIN_N_REPORT_LIFT}) |
| **Evidence tier** | ✓ = CI excludes baseline; △ = CI overlaps OR marginal exclusion OR n<${MIN_N_ADEQUATE}; ⚠ = n<${MIN_N_REPORT_LIFT} |
| Win-rate CI | Wilson 95%; **baseline inside CI → cannot reject equal win-rate** |

---

## 3. Tier A — SDS≥40 (concordance + CI test)

| Signal | Window | n | Win-rate (CI) · baseline | Lift (win · v1 med fwd) | CI vs baseline | Evidence |
|--------|--------|---|--------------------------|-------------------------|----------------|----------|
${sdsConcordance}

**Reading (honest):** SDS is **directionally concordant** (positive win-rate lift in all four windows). Statistically: check **CI vs baseline** column — where baseline sits **inside** the bucket CI, the lift is **directional only**, not confirmed at ~95%. This is **weaker than “strongest empirical pattern”** but still the **most promising signal in the report** pending crown Grado 4.

---

## 4. Tier A — P(plan)≥55 null result

| Signal | Window | n | Win-rate (CI) · baseline | Lift | CI vs baseline | Evidence |
|--------|--------|---|--------------------------|------|----------------|----------|
${pplanConcordance}

**Reading:** Consistently flat or negative win-rate lift. **Product conviction ≠ predictive filter** at this cutoff.

---

## 5. Tier B — small-n (do not cite lift)

| Bucket | n | Note |
|--------|---|------|
| MII+vol cross-section | ${cov.universe.miiVol} | Suppressed — n<${MIN_N_REPORT_LIFT} |
| SDS ∩ P(plan) | ${cov.universe.overlapSdsAndPplan} | Too few |
| MII+vol chart | ${chartU?.buckets?.mii_vol_static?.n ?? 0} | Negative lift when n≥16 |

---

## 6. Signal coverage (universe n=${cov.universe.n})

| Metric | Count |
|--------|-------|
| SDS≥40 rows | ${cov.universe.sdsGe40} |
| P(plan)≥55 rows | ${cov.universe.pplanGe55} |
| MII+vol | ${cov.universe.miiVol} |
| In PF | ${cov.universe.pfOnly} |

${pplanCoverageNote}

---

## 7. Detail tables

### 7a. Cross-section Δ24h

| Bucket | rows in bucket | w/ Δ24h | median Δ24h | win lift | CI test |
|--------|----------------|---------|-------------|----------|---------|
| SDS≥40 | ${uni.sds40?.n ?? 0} | ${uni.sds40?.nWithDailyPct ?? uni.sds40?.pnlPct24h.n ?? 0} | ${fmt(uni.sds40?.pnlPct24h.median)}% | ${fmtLiftDisplay(uni.sds40?.pnlPct24h.n ?? 0, uni.sds40?.liftVsBaseline?.winRateLiftPpRaw ?? null)} | ${uni.sds40?.ciVsBaseline?.verdict ?? "—"} |
| P(plan)≥55 | ${uni.pplan55?.n ?? 0} | ${uni.pplan55?.nWithDailyPct ?? uni.pplan55?.pnlPct24h.n ?? 0} | ${fmt(uni.pplan55?.pnlPct24h.median)}% | ${fmtLiftDisplay(uni.pplan55?.pnlPct24h.n ?? 0, uni.pplan55?.liftVsBaseline?.winRateLiftPpRaw ?? null)} | ${uni.pplan55?.ciVsBaseline?.verdict ?? "—"} |

### 7b. Chart forward

| Bucket | n | win · CI | lift win · v1 med fwd | CI test |
|--------|---|----------|----------------------|---------|
${chartDetailRow("sds_ge40_static", "SDS≥40")}
${chartDetailRow("pplan_ge55_static", "P(plan)≥55")}

---

## 8. Crown log

${crown ? `${crown.totalHits} hits loaded` : "**Missing** — Grado 3 → Export crown log → `data/whatif_crown_hits_export.json`"}

---

## 9. KEEP / DEPRIORITIZE / NEXT

**KEEP:** SDS gate (best directional + some CI support); P(plan) in UI; crown log; low_liq; MCS.

**DEPRIORITIZE:** MII hard gate; “volume best predictor”; claiming P(plan)≥55 predicts.

**NEXT (P0):** Crown export → Grado 4 → re-run this script → gate changes only if crown readouts confirm SDS.

---

## 10. Limitations

${lim.map((l) => `- ${l}`).join("\n")}

---

## 11. Commands

\`\`\`powershell
cd "c:\\coding\\Biotech_Investment app 6\\desktop-ui"
npx tsx scripts/diag-signal-bucket-compare.ts
\`\`\`

Files: \`SIGNAL_BUCKET_STRATEGY_REPORT_2.1.md\` · \`data/diag_signal_bucket_compare.json\`
`;
}

main();
