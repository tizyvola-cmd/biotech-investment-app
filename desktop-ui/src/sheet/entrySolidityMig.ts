/**
 * MII + Calib → input per RAscore (Recommendation Score).
 */
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  DEFAULT_MIG_CONFIG,
  evaluateBatch,
  miiModelGapPct,
  type MIGResult,
  type MIGVerdict,
} from "./marketInterestGate";
import {
  buildMarketInterestSnapshotsFromSimulation,
  sdsRowsToMap,
} from "./marketInterestFromSimulation";
import { loadMigMinSlopeAngleDeg } from "./marketInterestPrefs";
import { normalizedRowKey } from "./investSimKeys";

export type MigSoliditySnapshot = {
  slopeAngleDeg: number;
  deltaPricePct: number;
  volRatio: number;
  deltaSource?: string | null;
  calibPreScore: number | null;
  gapPrePct: number | null;
  verdict: MIGVerdict;
};

/** Chiave canonica allineata a Simulation / invest_sim (YYYY-MM-DD). */
export function migSolidityKey(ticker: string, cd: string): string {
  return normalizedRowKey(ticker, cd);
}

let _migCacheKey = "";
let _migCacheMap = new Map<string, MigSoliditySnapshot>();

function migSolidityCacheKey(
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null | undefined,
  sdsRows: SdsRow[] | null | undefined,
  minAngleDeg?: number,
): string {
  const n = simTable?.rows?.length ?? 0;
  const first = simTable?.rows?.[0];
  const last = simTable?.rows?.[n - 1];
  const tk0 = first ? String(first.Ticker ?? "") : "";
  const tkN = last ? String(last.Ticker ?? "") : "";
  const seriesN = chartsBundle?.series ? Object.keys(chartsBundle.series).length : 0;
  return `${n}|${tk0}|${tkN}|${seriesN}|${sdsRows?.length ?? 0}|${minAngleDeg ?? ""}`;
}

export function buildMigSolidityByKey(
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null | undefined,
  sdsRows: SdsRow[] | null | undefined,
  minAngleDeg?: number,
): Map<string, MigSoliditySnapshot> {
  const cacheKey = migSolidityCacheKey(simTable, chartsBundle, sdsRows, minAngleDeg);
  if (cacheKey === _migCacheKey && _migCacheMap.size > 0) {
    return _migCacheMap;
  }

  const map = new Map<string, MigSoliditySnapshot>();
  if (!simTable?.rows?.length) {
    _migCacheKey = cacheKey;
    _migCacheMap = map;
    return map;
  }

  const minAngle = minAngleDeg ?? loadMigMinSlopeAngleDeg();
  const sdsMap = sdsRowsToMap(sdsRows ?? null);
  const snapshots = buildMarketInterestSnapshotsFromSimulation(simTable, sdsMap, {
    chartsBundle: chartsBundle ?? null,
  });
  const batch = evaluateBatch(snapshots, {
    ...DEFAULT_MIG_CONFIG,
    minSlopeAngleDeg: minAngle,
  });

  for (const r of batch.all) {
    map.set(migSolidityKey(r.ticker, r.cd ?? ""), {
      slopeAngleDeg: r.slopeAngleDeg,
      deltaPricePct: r.deltaPricePct,
      volRatio: r.volRatio,
      deltaSource: r.deltaSource,
      calibPreScore: r.calibPreDaily.calibrationScore,
      gapPrePct: miiModelGapPct(r.slopeAngleDeg, r.calibPreDaily.modelSlopeAngleDeg),
      verdict: r.verdict,
    });
  }
  _migCacheKey = cacheKey;
  _migCacheMap = map;
  return map;
}

export function buildMigResultByKey(
  simTable: SheetTable | null,
  chartsBundle: ChartBundle | null | undefined,
  sdsRows: SdsRow[] | null | undefined,
  minAngleDeg?: number,
): Map<string, MIGResult> {
  const map = new Map<string, MIGResult>();
  if (!simTable?.rows?.length) return map;

  const minAngle = minAngleDeg ?? loadMigMinSlopeAngleDeg();
  const sdsMap = sdsRowsToMap(sdsRows ?? null);
  const snapshots = buildMarketInterestSnapshotsFromSimulation(simTable, sdsMap, {
    chartsBundle: chartsBundle ?? null,
  });
  const batch = evaluateBatch(snapshots, {
    ...DEFAULT_MIG_CONFIG,
    minSlopeAngleDeg: minAngle,
  });

  for (const r of batch.all) {
    map.set(migSolidityKey(r.ticker, r.cd ?? ""), r);
  }
  return map;
}
