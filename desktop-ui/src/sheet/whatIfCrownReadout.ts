/**
 * Grado 3 — freeze readout (MII / SDS / EIS / Precat / P(cont)) at crown-hit capture.
 */
import type { SdsRow } from "../api/supernova";
import type { EisSuperScoreState } from "../api/eisSuperScore";
import type { SheetTable, ChartBundle } from "../types";
import { daysFromToday } from "./simulationPlanGain";
import {
  resolveContG10,
  resolveContSellEdge,
  resolveDisplayPContinuation,
} from "./continuationScore";
import { buildPrecatEntry, extractCurveInputs } from "./precatCurve";
import { resolveNearestEisForTicker } from "./cdPatternRecommendation";
import { eisToDecisionDisplayScale } from "./decisionChartBuild";
import { buildMigSolidityByKey } from "./entrySolidityMig";
import type { InvestSimInputs } from "./investSimStorage";
import { extractPPlanFromSimRow } from "./scoreValidationExport";
import { buildSdsByTicker } from "./sdsTopOppGate";
import {
  dailyChangePctFromRow,
  firstParseNumFromRow,
  parseNum,
} from "./simulationPosition";
import type { WhatIfCrownHitEvent } from "./whatIfCrownHitStore";

export type WhatIfCrownReadoutSource = "capture" | "snapshot" | "backfill";

/** Snapshot of decision readouts at crown-hit time (frozen on first insert only). */
export type WhatIfCrownReadout = {
  sds: number | null;
  eis: number | null;
  pPlan: number | null;
  precatKind: string | null;
  pCont: number | null;
  contG10: number | null;
  exhaustEdge: number | null;
  dailyPct24h: number | null;
  miiAngleDeg: number | null;
  frozenAt: string;
  source: WhatIfCrownReadoutSource;
};

export type WhatIfCrownReadoutContext = {
  sdsByTicker?: Map<string, { sds: number }>;
  eisSuperScoreState?: EisSuperScoreState | null;
  inputs?: InvestSimInputs;
  migByKey?: Map<string, { slopeAngleDeg: number }>;
};

export function buildWhatIfCrownReadoutContext(opts: {
  sdsRows?: SdsRow[] | null;
  eisSuperScoreState?: EisSuperScoreState | null;
  simTable?: SheetTable | null;
  chartBundle?: ChartBundle | null;
  inputs?: InvestSimInputs;
}): WhatIfCrownReadoutContext {
  return {
    sdsByTicker: buildSdsByTicker(opts.sdsRows),
    eisSuperScoreState: opts.eisSuperScoreState ?? null,
    inputs: opts.inputs,
    migByKey:
      opts.simTable?.rows?.length && opts.chartBundle
        ? buildMigSolidityByKey(opts.simTable, opts.chartBundle, opts.sdsRows)
        : undefined,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function readMiiFromRow(row: Record<string, unknown>): number | null {
  const direct = firstParseNumFromRow(row, ["MII", "MII °", "MII angle", "MII°"]);
  if (direct != null) return round1(direct);
  for (const [key, val] of Object.entries(row)) {
    const k = key.toLowerCase();
    if (k.includes("mii")) {
      const n = parseNum(val);
      if (n != null) return round1(n);
    }
  }
  return null;
}

function resolveSds(
  ticker: string,
  simRow: Record<string, unknown>,
  ctx?: WhatIfCrownReadoutContext,
): number | null {
  const tk = ticker.trim().toUpperCase();
  const fromSnap = ctx?.sdsByTicker?.get(tk)?.sds;
  if (fromSnap != null && Number.isFinite(fromSnap)) return Math.round(fromSnap);
  const fromRow = firstParseNumFromRow(simRow, ["SDS", "sds"]);
  return fromRow != null ? Math.round(fromRow) : null;
}

function resolveEis(
  ticker: string,
  simRow: Record<string, unknown>,
  ctx?: WhatIfCrownReadoutContext,
): number | null {
  const tk = ticker.trim().toUpperCase();
  const cd = String(simRow["Completion Date"] ?? "").trim() || null;
  const nearest = resolveNearestEisForTicker({
    ticker: tk,
    completionDate: cd,
    eisSuperScoreState: ctx?.eisSuperScoreState,
  });
  const raw = nearest?.superScore ?? nearest?.score ?? null;
  if (raw != null && Number.isFinite(raw)) {
    return eisToDecisionDisplayScale(raw);
  }
  const fromRow = firstParseNumFromRow(simRow, [
    "EIS",
    "eis",
    "EIS Score",
    "EIS score",
    "EIS Super",
  ]);
  return fromRow != null ? Math.round(fromRow) : null;
}

function resolveMii(
  simKey: string | null | undefined,
  simRow: Record<string, unknown>,
  ctx?: WhatIfCrownReadoutContext,
): number | null {
  const key = simKey?.trim();
  if (key && ctx?.migByKey?.has(key)) {
    const deg = ctx.migByKey.get(key)!.slopeAngleDeg;
    if (Number.isFinite(deg)) return round1(deg);
  }
  return readMiiFromRow(simRow);
}

/** True when core decision scores are still missing (partial legacy readout). */
export function whatIfCrownReadoutNeedsEnrichment(r: WhatIfCrownReadout | null | undefined): boolean {
  if (!r) return true;
  return r.sds == null || r.eis == null || r.pPlan == null;
}

const READOUT_SOURCE_RANK: Record<WhatIfCrownReadoutSource, number> = {
  capture: 3,
  snapshot: 2,
  backfill: 1,
};

function readoutSourceRank(source: WhatIfCrownReadoutSource | undefined): number {
  if (!source) return 0;
  return READOUT_SOURCE_RANK[source] ?? 0;
}

/** Live capture > daily snapshot > backfill — never downgrade. */
export function stickyWhatIfCrownReadoutSource(
  prev: WhatIfCrownReadout | null | undefined,
  fresh: WhatIfCrownReadout | null | undefined,
): WhatIfCrownReadoutSource {
  const prevRank = readoutSourceRank(prev?.source);
  const freshRank = readoutSourceRank(fresh?.source);
  if (prevRank >= freshRank) return prev?.source ?? fresh?.source ?? "backfill";
  return fresh?.source ?? "backfill";
}

/** Merge readouts filling null fields only; never overwrite non-null scores or downgrade source. */
export function mergeWhatIfCrownReadouts(
  prev: WhatIfCrownReadout | null | undefined,
  fresh: WhatIfCrownReadout | null,
): WhatIfCrownReadout | null {
  if (!prev) return fresh;
  if (!fresh) return prev;
  return {
    sds: prev.sds ?? fresh.sds,
    eis: prev.eis ?? fresh.eis,
    pPlan: prev.pPlan ?? fresh.pPlan,
    precatKind: prev.precatKind ?? fresh.precatKind,
    pCont: prev.pCont ?? fresh.pCont,
    contG10: prev.contG10 ?? fresh.contG10,
    exhaustEdge: prev.exhaustEdge ?? fresh.exhaustEdge,
    dailyPct24h: prev.dailyPct24h ?? fresh.dailyPct24h,
    miiAngleDeg: prev.miiAngleDeg ?? fresh.miiAngleDeg,
    frozenAt: prev.frozenAt || fresh.frozenAt,
    source: stickyWhatIfCrownReadoutSource(prev, fresh),
  };
}

/** Build readout from Simulation row + score context (SDS snap, EIS feed, P(plan) columns). */
export function buildWhatIfCrownReadoutFromSimRow(
  simRow: Record<string, unknown> | null | undefined,
  opts?: {
    source?: WhatIfCrownReadoutSource;
    frozenAt?: string;
    hasPosition?: boolean;
    ticker?: string;
    simKey?: string | null;
    ctx?: WhatIfCrownReadoutContext;
  },
): WhatIfCrownReadout | null {
  if (!simRow) return null;

  const ticker =
    (opts?.ticker ?? String(simRow.Ticker ?? simRow.ticker ?? "")).trim().toUpperCase() ||
    "—";
  const simKey = opts?.simKey?.trim() || null;
  const ctx = opts?.ctx;

  const { slope5d, slope20d, runUp30d } = extractCurveInputs(simRow);
  const cd = String(simRow["Completion Date"] ?? "").trim();
  const days = cd ? daysFromToday(cd) : null;
  const precat = buildPrecatEntry(slope5d, slope20d, runUp30d, days, {
    hasPosition: opts?.hasPosition ?? true,
  });

  const daily = dailyChangePctFromRow(simRow);
  const pCont = resolveDisplayPContinuation(simRow);
  const contG10 = resolveContG10(simRow);
  const exhaustEdge = resolveContSellEdge(simRow);
  const sds = resolveSds(ticker, simRow, ctx);
  const eis = resolveEis(ticker, simRow, ctx);
  const inp = simKey && ctx?.inputs ? ctx.inputs[simKey] : undefined;
  const pPlanRaw = extractPPlanFromSimRow(simRow, inp, simKey ?? undefined);
  const pPlan = pPlanRaw != null ? Math.round(pPlanRaw) : null;
  const miiAngleDeg = resolveMii(simKey, simRow, ctx);

  const hasAny =
    sds != null ||
    eis != null ||
    pPlan != null ||
    precat.kind != null ||
    pCont != null ||
    contG10 != null ||
    daily != null ||
    miiAngleDeg != null;

  if (!hasAny) return null;

  return {
    sds,
    eis,
    pPlan,
    precatKind: precat.kind ?? null,
    pCont: pCont != null && Number.isFinite(pCont) ? Math.round(pCont) : null,
    contG10:
      contG10 != null && Number.isFinite(contG10) ? round1(contG10) : null,
    exhaustEdge:
      exhaustEdge != null && Number.isFinite(exhaustEdge)
        ? round1(exhaustEdge)
        : null,
    dailyPct24h:
      daily != null && Number.isFinite(daily) ? round1(daily) : null,
    miiAngleDeg,
    frozenAt: opts?.frozenAt ?? new Date().toISOString(),
    source: opts?.source ?? "capture",
  };
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : round1((s[mid - 1]! + s[mid]!) / 2);
}

export type WhatIfGrade3Analysis = {
  totalHits: number;
  withReadout: number;
  backfillCount: number;
  snapshotCount: number;
  /** Hits with readout but missing SDS/EIS/P(plan). */
  partialReadout: number;
  medians: {
    sds: number | null;
    eis: number | null;
    pPlan: number | null;
    pCont: number | null;
    endPnl: number | null;
    pathMax: number | null;
  };
  precatBreakdown: Record<string, number>;
};

export function summarizeWhatIfGrade3Analysis(
  events: readonly WhatIfCrownHitEvent[],
): WhatIfGrade3Analysis {
  const withReadout = events.filter((e) => e.readout != null);
  const sds: number[] = [];
  const eis: number[] = [];
  const pPlan: number[] = [];
  const pCont: number[] = [];
  const endPnl: number[] = [];
  const pathMax: number[] = [];
  const precatBreakdown: Record<string, number> = {};
  let backfillCount = 0;
  let snapshotCount = 0;
  let partialReadout = 0;

  for (const e of withReadout) {
    const r = e.readout!;
    if (whatIfCrownReadoutNeedsEnrichment(r)) partialReadout += 1;
    if (r.source === "backfill") backfillCount += 1;
    if (r.source === "snapshot") snapshotCount += 1;
    if (r.sds != null) sds.push(r.sds);
    if (r.eis != null) eis.push(r.eis);
    if (r.pPlan != null) pPlan.push(r.pPlan);
    if (r.pCont != null) pCont.push(r.pCont);
    if (r.precatKind) {
      precatBreakdown[r.precatKind] = (precatBreakdown[r.precatKind] ?? 0) + 1;
    }
    endPnl.push(e.endPnl);
    pathMax.push(e.pathMax);
  }

  return {
    totalHits: events.length,
    withReadout: withReadout.length,
    backfillCount,
    snapshotCount,
    partialReadout,
    medians: {
      sds: median(sds),
      eis: median(eis),
      pPlan: median(pPlan),
      pCont: median(pCont),
      endPnl: median(endPnl),
      pathMax: median(pathMax),
    },
    precatBreakdown,
  };
}

export function fmtReadoutCell(v: number | null | undefined, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 && suffix === "%" ? "+" : ""}${v}${suffix}`;
}
