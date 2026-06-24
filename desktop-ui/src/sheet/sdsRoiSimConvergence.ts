import type {
  SdsRoiBacktestScoresDoc,
  SdsRoiForecastEvent,
  SdsRoiForecastLogDoc,
  SdsRoiHorizonKey,
  SdsSnapshotDoc,
} from "./sdsRoiForecast";
import {
  loadSdsRoiBacktestScores,
  loadSdsRoiForecastLog,
  loadSdsSnapshotDoc,
} from "./sdsRoiForecast";
import { fetchProjectJson } from "../data/projectData";
import { simulationRowPredAtOffset } from "../data/simulationCharts";
import { normalizeCompletionDateForKey } from "./investSimKeys";

export type SdsRoiSimEventPoint = {
  key: string;
  ticker: string;
  completionDate: string;
  scoredAt: string | null;
  sds: number | null;
  predicted: number | null;
  actual: number | null;
  errorPp: number | null;
  status: "scored" | "pending";
  sortTs: number;
  chartLabel: string;
};

export type SdsRoiSimMaeTrendPoint = {
  chartLabel: string;
  sortTs: number;
  maePp: number;
  n: number;
  ticker: string;
};

export type SdsRoiSimScatterPoint = {
  ticker: string;
  predicted: number;
  actual: number;
  errorPp: number;
  completionDate: string;
};

export type SdsRoiSimConvergenceView = {
  horizon: SdsRoiHorizonKey;
  events: SdsRoiSimEventPoint[];
  maeTrend: SdsRoiSimMaeTrendPoint[];
  scatter: SdsRoiSimScatterPoint[];
  summary: {
    nSimTracked: number;
    nScored: number;
    nPending: number;
    maePp: number | null;
    meanSignedErrPp: number | null;
  };
  hasTimeline: boolean;
  hasScatter: boolean;
};

type SimSheetRow = Record<string, unknown>;

export type SimulationSheetSnapshotDoc = {
  rows?: SimSheetRow[];
};

function parseNum(v: unknown): number | null {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDay(v: unknown): string | null {
  const cd = normalizeCompletionDateForKey(v);
  return cd && cd !== "—" && /^\d{4}-\d{2}-\d{2}$/.test(cd) ? cd : null;
}

function dayTs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(t) ? 0 : t;
}

function rowTicker(row: SimSheetRow): string {
  return String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
}

function rowCompletionDate(row: SimSheetRow): string | null {
  return parseIsoDay(row["Completion Date"] ?? row.CD ?? row.completion_date);
}

/** SDS snapshot row may omit completion_date — resolve from Simulation sheet. */
export function resolveSdsRowCompletionDate(
  row: { ticker?: string; completion_date?: string },
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): string | null {
  const direct = parseIsoDay(row.completion_date);
  if (direct) return direct;
  const tk = String(row.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!tk) return null;
  for (const simRow of simSnap?.rows ?? []) {
    if (rowTicker(simRow) !== tk) continue;
    const cd = rowCompletionDate(simRow);
    if (cd) return cd;
  }
  return null;
}

function looksLikeTicker(sym: string): boolean {
  if (!sym || sym.startsWith("──")) return false;
  if (sym.includes(" ") || sym.includes("TOTALE") || sym.includes("PORTAFOGLIO")) return false;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(sym);
}

/** Keys ``TICKER|YYYY-MM-DD`` from Simulation sheet rows. */
export function buildSimulationEventKeys(
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const row of simSnap?.rows ?? []) {
    const tk = rowTicker(row);
    const cd = rowCompletionDate(row);
    if (tk && cd && looksLikeTicker(tk)) keys.add(`${tk}|${cd}`);
  }
  return keys;
}

export function buildSimulationTickerSet(
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): Set<string> {
  const tickers = new Set<string>();
  for (const row of simSnap?.rows ?? []) {
    const tk = rowTicker(row);
    if (tk && looksLikeTicker(tk)) tickers.add(tk);
  }
  return tickers;
}

function isSimulationEvent(
  ev: SdsRoiForecastEvent,
  simKeys: Set<string>,
  simTickers: Set<string>,
): boolean {
  const key = ev.key ?? "";
  if (key && simKeys.has(key)) return true;
  const tk = String(ev.ticker ?? "").trim().toUpperCase();
  const cd = parseIsoDay(ev.completion_date);
  if (tk && cd && simKeys.has(`${tk}|${cd}`)) return true;
  return tk.length > 0 && simTickers.has(tk);
}

function latestSnapshot(ev: SdsRoiForecastEvent) {
  const snaps = ev.snapshots ?? [];
  return snaps.length ? snaps[snaps.length - 1] : undefined;
}

function eventPointFromForecast(
  ev: SdsRoiForecastEvent,
  horizon: SdsRoiHorizonKey,
): SdsRoiSimEventPoint | null {
  const ticker = String(ev.ticker ?? "").trim().toUpperCase();
  const completionDate = parseIsoDay(ev.completion_date);
  if (!ticker || !completionDate) return null;

  const snap = latestSnapshot(ev);
  const predicted = parseNum(snap?.predicted?.[horizon]);
  const actual = parseNum(ev.actual?.[horizon]);
  const errorPp = parseNum(ev.error_pp?.[horizon]);
  const scored =
    Boolean(ev.scored_at) && actual != null && predicted != null && errorPp != null;

  if (predicted == null && actual == null) return null;

  const sortTs = scored ? dayTs(ev.scored_at ?? completionDate) : dayTs(completionDate);

  return {
    key: ev.key ?? `${ticker}|${completionDate}`,
    ticker,
    completionDate,
    scoredAt: ev.scored_at ?? null,
    sds: parseNum(snap?.sds),
    predicted,
    actual: scored ? actual : null,
    errorPp: scored ? errorPp : null,
    status: scored ? "scored" : "pending",
    sortTs,
    chartLabel: ticker,
  };
}

function eventPointFromSimSheet(
  row: SimSheetRow,
  horizon: SdsRoiHorizonKey,
  simKeys: Set<string>,
): SdsRoiSimEventPoint | null {
  const ticker = rowTicker(row);
  const completionDate = rowCompletionDate(row);
  if (!ticker || !completionDate) return null;
  const key = `${ticker}|${completionDate}`;
  if (!simKeys.has(key)) return null;

  const offsetByHorizon: Record<SdsRoiHorizonKey, number> = {
    pre_10: -10,
    pre_5: -5,
    post_4: 4,
  };
  const predicted = simulationRowPredAtOffset(row, offsetByHorizon[horizon]);
  if (predicted == null) return null;

  return {
    key,
    ticker,
    completionDate,
    scoredAt: null,
    sds: parseNum(row.SDS ?? row.sds),
    predicted,
    actual: null,
    errorPp: null,
    status: "pending",
    sortTs: dayTs(completionDate),
    chartLabel: ticker,
  };
}

function eventPointFromSdsRow(
  row: NonNullable<SdsSnapshotDoc["rows"]>[number],
  horizon: SdsRoiHorizonKey,
  simKeys: Set<string>,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): SdsRoiSimEventPoint | null {
  const ticker = String(row.ticker ?? "")
    .trim()
    .toUpperCase();
  const completionDate = resolveSdsRowCompletionDate(row, simSnap);
  if (!ticker || !completionDate) return null;
  const key = `${ticker}|${completionDate}`;
  if (!simKeys.has(key)) return null;

  const predicted = parseNum(row.curve_roi?.horizons?.[horizon]?.pct_vs_m60);
  if (predicted == null) return null;

  return {
    key,
    ticker,
    completionDate,
    scoredAt: null,
    sds: parseNum(row.sds),
    predicted,
    actual: null,
    errorPp: null,
    status: "pending",
    sortTs: dayTs(completionDate),
    chartLabel: ticker,
  };
}

function eventPointFromBacktest(
  row: NonNullable<SdsRoiBacktestScoresDoc["sample_rows"]>[number],
  horizon: SdsRoiHorizonKey,
  simKeys: Set<string>,
): SdsRoiSimEventPoint | null {
  const ticker = String(row.ticker ?? "")
    .trim()
    .toUpperCase();
  const completionDate = parseIsoDay(row.completion_date);
  if (!ticker || !completionDate) return null;
  const key = row.key ?? `${ticker}|${completionDate}`;
  if (!simKeys.has(key)) return null;

  const predicted = parseNum(row.predicted?.[horizon]);
  const actual = parseNum(row.actual?.[horizon]);
  const errorPp = parseNum(row.error_pp?.[horizon]);
  if (predicted == null || actual == null || errorPp == null) return null;

  return {
    key,
    ticker,
    completionDate,
    scoredAt: completionDate,
    sds: parseNum(row.sds),
    predicted,
    actual,
    errorPp,
    status: "scored",
    sortTs: dayTs(completionDate),
    chartLabel: ticker,
  };
}

function buildMaeTrend(scored: SdsRoiSimEventPoint[]): SdsRoiSimMaeTrendPoint[] {
  const ordered = [...scored]
    .filter((e) => e.errorPp != null)
    .sort((a, b) => a.sortTs - b.sortTs || a.ticker.localeCompare(b.ticker));

  const out: SdsRoiSimMaeTrendPoint[] = [];
  const errs: number[] = [];
  for (const ev of ordered) {
    errs.push(Math.abs(ev.errorPp!));
    out.push({
      chartLabel: ev.chartLabel,
      sortTs: ev.sortTs,
      maePp: Math.round((errs.reduce((s, v) => s + v, 0) / errs.length) * 10) / 10,
      n: errs.length,
      ticker: ev.ticker,
    });
  }
  return out;
}

export function buildSdsRoiSimConvergenceView(
  forecast: SdsRoiForecastLogDoc | null | undefined,
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  backtest: SdsRoiBacktestScoresDoc | null | undefined,
  horizon: SdsRoiHorizonKey = "pre_5",
): SdsRoiSimConvergenceView {
  const simKeys = buildSimulationEventKeys(simSnap);
  const simTickers = buildSimulationTickerSet(simSnap);

  const byKey = new Map<string, SdsRoiSimEventPoint>();

  for (const row of backtest?.sample_rows ?? []) {
    const pt = eventPointFromBacktest(row, horizon, simKeys);
    if (pt) byKey.set(pt.key, pt);
  }

  for (const ev of Object.values(forecast?.events ?? {})) {
    if (!isSimulationEvent(ev, simKeys, simTickers)) continue;
    const pt = eventPointFromForecast(ev, horizon);
    if (pt) byKey.set(pt.key, pt);
  }

  for (const row of sdsSnap?.rows ?? []) {
    const pt = eventPointFromSdsRow(row, horizon, simKeys, simSnap);
    if (!pt) continue;
    const existing = byKey.get(pt.key);
    if (!existing || existing.status === "pending") {
      byKey.set(pt.key, existing?.status === "scored" ? existing : pt);
    }
  }

  for (const row of simSnap?.rows ?? []) {
    const pt = eventPointFromSimSheet(row, horizon, simKeys);
    if (!pt) continue;
    if (!byKey.has(pt.key)) byKey.set(pt.key, pt);
  }

  const events = [...byKey.values()].sort(
    (a, b) => a.sortTs - b.sortTs || a.ticker.localeCompare(b.ticker),
  );

  const scored = events.filter((e) => e.status === "scored" && e.errorPp != null);
  const pending = events.filter((e) => e.status === "pending");

  const absErrs = scored.map((e) => Math.abs(e.errorPp!));
  const signedErrs = scored.map((e) => e.errorPp!);

  const scatter: SdsRoiSimScatterPoint[] = scored
    .filter((e) => e.predicted != null && e.actual != null)
    .map((e) => ({
      ticker: e.ticker,
      predicted: e.predicted!,
      actual: e.actual!,
      errorPp: e.errorPp!,
      completionDate: e.completionDate,
    }));

  return {
    horizon,
    events,
    maeTrend: buildMaeTrend(scored),
    scatter,
    summary: {
      nSimTracked: events.length,
      nScored: scored.length,
      nPending: pending.length,
      maePp:
        absErrs.length > 0
          ? Math.round((absErrs.reduce((s, v) => s + v, 0) / absErrs.length) * 10) / 10
          : null,
      meanSignedErrPp:
        signedErrs.length > 0
          ? Math.round((signedErrs.reduce((s, v) => s + v, 0) / signedErrs.length) * 10) / 10
          : null,
    },
    hasTimeline: events.some((e) => e.predicted != null),
    hasScatter: scatter.length >= 2,
  };
}

export async function loadSimulationSheetSnapshot(): Promise<SimulationSheetSnapshotDoc | null> {
  const { data } = await fetchProjectJson<SimulationSheetSnapshotDoc>("simulation_sheet_snapshot.json");
  return data;
}

export async function loadSdsRoiConvergenceSources(): Promise<{
  backtest: SdsRoiBacktestScoresDoc | null;
  forecast: SdsRoiForecastLogDoc | null;
  sdsSnap: SdsSnapshotDoc | null;
  simSnap: SimulationSheetSnapshotDoc | null;
}> {
  const [backtest, forecast, sdsSnap, simSnap] = await Promise.all([
    loadSdsRoiBacktestScores(),
    loadSdsRoiForecastLog(),
    loadSdsSnapshotDoc(),
    loadSimulationSheetSnapshot(),
  ]);
  return { backtest, forecast, sdsSnap, simSnap };
}
