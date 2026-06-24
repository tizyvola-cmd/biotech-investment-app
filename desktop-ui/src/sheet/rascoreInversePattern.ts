import type { SdsRow } from "../api/supernova";
import { simulationRowSeriesKey, chartPointsMapFromBundle } from "../data/simulationCharts";
import type { ChartBundle, SheetTable } from "../types";
import { buildMigSolidityByKey } from "./entrySolidityMig";
import {
  SOLIDITY_COMPONENT_MAX,
  type SolidityCompositeComponent,
  type SolidityCompositeComponentId,
} from "./entrySolidityComposite";
import { normalizedRowKey, reconcileInvestSimInputs } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { buildSdsByTicker } from "./sdsTopOppGate";
import { pickSignalFromSimRow } from "./top2FromSimulation";
import {
  computeRaCompositeAsOfAnchor,
} from "./rascoreAnchorSolidity";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
} from "./simulationEntrySolidity";
import type { RaCalibrationSignal } from "./rascoreCalibrationCompute";
import { RA_CALIB_CD_OFFSETS, raCalibOffsetLabel } from "./rascoreCdHorizons";
import type { RascoreCohortSummary } from "./rascoreSignalImpactView";
import {
  groupComparisonSignificance,
  type SignificanceStars,
} from "./statSignificance";

const PRICE_MOVE_EPS_PP = 0.05;

export const RA_INVERSE_COMPONENT_IDS: SolidityCompositeComponentId[] = [
  "reliability",
  "timing",
  "align",
  "roi_target",
  "sds",
  "precat",
  "mii",
  "calib",
  "momentum_accel",
];

/** Curve + timing as-of CD anchor — temporally aligned with price outcome. */
export const RA_INVERSE_CURVE_COMPONENT_IDS: SolidityCompositeComponentId[] = [
  "reliability",
  "timing",
  "align",
  "roi_target",
  "precat",
];

/** Current snapshot only — excluded from curve-only inverse pattern. */
export const RA_INVERSE_SNAPSHOT_COMPONENT_IDS: SolidityCompositeComponentId[] = [
  "sds",
  "mii",
  "calib",
];

export type RaInverseScoreMode = "full" | "curve_only";

export function raInverseComponentIdsForMode(
  mode: RaInverseScoreMode,
): SolidityCompositeComponentId[] {
  return mode === "curve_only" ? RA_INVERSE_CURVE_COMPONENT_IDS : RA_INVERSE_COMPONENT_IDS;
}

export type RaInverseTickerRow = {
  ticker: string;
  raScore: number;
  components: Record<SolidityCompositeComponentId, { points: number; maxPoints: number }>;
};

export type RaInverseGroupMember = {
  ticker: string;
  group: "up" | "down";
  priceChgPct: number;
  raScore: number;
  componentPts: Record<SolidityCompositeComponentId, number>;
  componentFillPct: Record<SolidityCompositeComponentId, number>;
};

export type RaInverseComponentCompare = {
  id: SolidityCompositeComponentId;
  upMeanPct: number | null;
  downMeanPct: number | null;
  deltaPct: number | null;
  upMeanPts: number | null;
  downMeanPts: number | null;
  maxPoints: number;
  pValue: number | null;
  stars: SignificanceStars;
};

export type RaInversePatternResult = {
  offset: number;
  offsetLabel: string;
  horizon: "long" | "short";
  scoreMode: RaInverseScoreMode;
  activeComponentIds: SolidityCompositeComponentId[];
  upN: number;
  downN: number;
  flatN: number;
  upMeanRa: number | null;
  downMeanRa: number | null;
  raDelta: number | null;
  raPValue: number | null;
  raStars: SignificanceStars;
  /** Full composite totals when scoreMode is curve_only (for comparison). */
  fullUpMeanRa?: number | null;
  fullDownMeanRa?: number | null;
  fullRaDelta?: number | null;
  components: RaInverseComponentCompare[];
  topDiscriminators: SolidityCompositeComponentId[];
  members: RaInverseGroupMember[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round1(values.reduce((s, v) => s + v, 0) / values.length);
}

function componentFillPct(points: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  return round1(Math.min(100, Math.max(0, (points / maxPoints) * 100)));
}

function inverseRaTotalFromComponents(
  components: RaInverseTickerRow["components"],
  ids: readonly SolidityCompositeComponentId[] = RA_INVERSE_COMPONENT_IDS,
): number {
  return round1(ids.reduce((s, id) => s + components[id].points, 0));
}

function raScoreForRow(row: RaInverseTickerRow, mode: RaInverseScoreMode): number {
  return inverseRaTotalFromComponents(row.components, raInverseComponentIdsForMode(mode));
}

export function buildRaInverseTickerRows(args: {
  simTable: SheetTable | null | undefined;
  chartBundle: ChartBundle | null | undefined;
  sdsRows: SdsRow[] | null | undefined;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
  /** When set, RA/components reflect curve+timing as-of this CD anchor (v2). */
  asOfOffset?: number | null;
}): RaInverseTickerRow[] {
  const {
    simTable,
    chartBundle,
    sdsRows,
    inputs,
    history = null,
    lang = "it",
    asOfOffset = null,
  } = args;

  const rows = simTable?.rows ?? [];
  if (!rows.length) return [];

  const merged = reconcileInvestSimInputs(inputs, rows);
  const pointsByKey = chartPointsMapFromBundle(chartBundle);
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable ?? null, chartBundle, sdsRows);

  const seenKeys = new Set<string>();
  const out: RaInverseTickerRow[] = [];

  for (const simRow of rows) {
    const ticker = String(simRow.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const cd = simRow["Completion Date"];
    const key = normalizedRowKey(ticker, cd);
    if (seenKeys.has(key)) continue;

    const seriesKey = simulationRowSeriesKey(simRow);
    const chartPts = seriesKey ? pointsByKey.get(seriesKey) ?? null : null;
    const pick = pickSignalFromSimRow(simRow, merged, chartPts, history);
    if (!pick) continue;

    const strictOpts = { sdsByTicker, migByKey };
    let componentSource: SolidityCompositeComponent[];

    if (asOfOffset != null && Number.isFinite(asOfOffset)) {
      const asOfComposite = computeRaCompositeAsOfAnchor({
        simRow,
        mergedInputs: merged,
        chartPts,
        history,
        anchor: asOfOffset,
        opts: strictOpts,
        lang,
      });
      if (!asOfComposite) continue;
      componentSource = asOfComposite.components;
    } else {
      const sol = resolveSimulationEntrySolidity(pick, strictOpts, lang, "rascore");
      if (!simulationSolidityVisible(sol)) continue;
      componentSource = sol.composite.components;
    }

    seenKeys.add(key);
    const components = {} as RaInverseTickerRow["components"];
    for (const id of RA_INVERSE_COMPONENT_IDS) {
      const hit = componentSource.find((c) => c.id === id);
      components[id] = {
        points: hit?.points ?? 0,
        maxPoints: hit?.maxPoints ?? SOLIDITY_COMPONENT_MAX[id],
      };
    }

    out.push({
      ticker,
      raScore: inverseRaTotalFromComponents(components),
      components,
    });
  }

  return out;
}

export type RaInverseAnchorEligibility = {
  offset: number;
  offsetLabel: string;
  total: number;
  upN: number;
  downN: number;
  flatN: number;
  /** True when ↑+↓ ≥ 4 (flat excluded) — table can render. */
  tableReady: boolean;
};

function splitRaInverseGroups(
  inverseRows: RaInverseTickerRow[],
  signals: RaCalibrationSignal[],
  opts: { offset: number; horizon?: "long" | "short" },
):
  | {
      up: RaInverseTickerRow[];
      down: RaInverseTickerRow[];
      flat: RaInverseTickerRow[];
      priceChgByTicker: Map<string, number>;
      horizon: "long" | "short";
    }
  | null {
  const horizon = opts.horizon ?? "long";
  const signalByTicker = new Map(
    signals
      .map((s) => [s.ticker?.trim().toUpperCase() ?? "", s] as const)
      .filter(([tk]) => tk.length > 0),
  );

  const up: RaInverseTickerRow[] = [];
  const down: RaInverseTickerRow[] = [];
  const flat: RaInverseTickerRow[] = [];
  const priceChgByTicker = new Map<string, number>();

  for (const row of inverseRows) {
    const sig = signalByTicker.get(row.ticker);
    if (!sig) continue;
    const chgMap =
      horizon === "long" ? sig.priceChgLongByOffset : sig.priceChgShortByOffset;
    const chg = chgMap[opts.offset];
    if (chg == null || !Number.isFinite(chg)) continue;
    priceChgByTicker.set(row.ticker, chg);
    if (chg > PRICE_MOVE_EPS_PP) up.push(row);
    else if (chg < -PRICE_MOVE_EPS_PP) down.push(row);
    else flat.push(row);
  }

  if (up.length + down.length + flat.length === 0) return null;

  return { up, down, flat, priceChgByTicker, horizon };
}

export function listRaInverseAnchorEligibility(
  inverseRows: RaInverseTickerRow[],
  signals: RaCalibrationSignal[],
  horizon: "long" | "short" = "long",
): RaInverseAnchorEligibility[] {
  return RA_CALIB_CD_OFFSETS.map((offset) => {
    const split = splitRaInverseGroups(inverseRows, signals, { offset, horizon });
    if (!split) {
      return {
        offset,
        offsetLabel: raCalibOffsetLabel(offset),
        total: 0,
        upN: 0,
        downN: 0,
        flatN: 0,
        tableReady: false,
      };
    }
    const total = split.up.length + split.down.length + split.flat.length;
    return {
      offset,
      offsetLabel: raCalibOffsetLabel(offset),
      total,
      upN: split.up.length,
      downN: split.down.length,
      flatN: split.flat.length,
      tableReady: split.up.length + split.down.length >= 4,
    };
  }).filter((row) => row.total > 0);
}

export function buildRaInversePatternAnalysis(
  inverseRows: RaInverseTickerRow[],
  signals: RaCalibrationSignal[],
  opts: { offset: number; horizon?: "long" | "short"; scoreMode?: RaInverseScoreMode },
): RaInversePatternResult | null {
  const scoreMode = opts.scoreMode ?? "curve_only";
  const activeComponentIds = raInverseComponentIdsForMode(scoreMode);
  const split = splitRaInverseGroups(inverseRows, signals, opts);
  if (!split || split.up.length + split.down.length < 4) return null;

  const grouped = { up: split.up, down: split.down, flat: split.flat };
  const priceChgByTicker = split.priceChgByTicker;
  const horizon = split.horizon;

  const upRa = grouped.up.map((r) => raScoreForRow(r, scoreMode));
  const downRa = grouped.down.map((r) => raScoreForRow(r, scoreMode));
  const upMeanRa = mean(upRa);
  const downMeanRa = mean(downRa);
  const raDelta =
    upMeanRa != null && downMeanRa != null ? round1(upMeanRa - downMeanRa) : null;
  const raSig = groupComparisonSignificance(upRa, downRa);

  let fullUpMeanRa: number | null | undefined;
  let fullDownMeanRa: number | null | undefined;
  let fullRaDelta: number | null | undefined;
  if (scoreMode === "curve_only") {
    const upFull = grouped.up.map((r) => raScoreForRow(r, "full"));
    const downFull = grouped.down.map((r) => raScoreForRow(r, "full"));
    fullUpMeanRa = mean(upFull);
    fullDownMeanRa = mean(downFull);
    fullRaDelta =
      fullUpMeanRa != null && fullDownMeanRa != null
        ? round1(fullUpMeanRa - fullDownMeanRa)
        : null;
  }

  const members: RaInverseGroupMember[] = [];
  for (const bucket of ["up", "down"] as const) {
    for (const row of grouped[bucket]) {
      const componentPts = {} as Record<SolidityCompositeComponentId, number>;
      const fillPctByComponent = {} as Record<SolidityCompositeComponentId, number>;
      for (const id of RA_INVERSE_COMPONENT_IDS) {
        componentPts[id] = row.components[id].points;
        fillPctByComponent[id] = componentFillPct(
          row.components[id].points,
          row.components[id].maxPoints,
        );
      }
      members.push({
        ticker: row.ticker,
        group: bucket,
        priceChgPct: round1(priceChgByTicker.get(row.ticker) ?? 0),
        raScore: raScoreForRow(row, scoreMode),
        componentPts,
        componentFillPct: fillPctByComponent,
      });
    }
  }

  const components: RaInverseComponentCompare[] = activeComponentIds.map((id) => {
    const maxPoints = SOLIDITY_COMPONENT_MAX[id];
    const upFill = grouped.up.map((r) =>
      componentFillPct(r.components[id].points, r.components[id].maxPoints),
    );
    const downFill = grouped.down.map((r) =>
      componentFillPct(r.components[id].points, r.components[id].maxPoints),
    );
    const upPts = grouped.up.map((r) => r.components[id].points);
    const downPts = grouped.down.map((r) => r.components[id].points);
    const upMeanPct = mean(upFill);
    const downMeanPct = mean(downFill);
    const sig = groupComparisonSignificance(upFill, downFill);
    return {
      id,
      upMeanPct,
      downMeanPct,
      deltaPct:
        upMeanPct != null && downMeanPct != null
          ? round1(upMeanPct - downMeanPct)
          : null,
      upMeanPts: mean(upPts),
      downMeanPts: mean(downPts),
      maxPoints,
      pValue: sig.p,
      stars: sig.stars,
    };
  });

  const topDiscriminators = [...components]
    .filter((c) => c.deltaPct != null)
    .sort((a, b) => {
      const aSig = a.stars !== "ns" ? 1 : 0;
      const bSig = b.stars !== "ns" ? 1 : 0;
      if (aSig !== bSig) return bSig - aSig;
      return Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0);
    })
    .slice(0, 3)
    .map((c) => c.id);

  return {
    offset: opts.offset,
    offsetLabel: raCalibOffsetLabel(opts.offset),
    horizon,
    scoreMode,
    activeComponentIds,
    upN: grouped.up.length,
    downN: grouped.down.length,
    flatN: grouped.flat.length,
    upMeanRa,
    downMeanRa,
    raDelta,
    raPValue: raSig.p,
    raStars: raSig.stars,
    fullUpMeanRa,
    fullDownMeanRa,
    fullRaDelta,
    components,
    topDiscriminators,
    members,
  };
}

export function raInverseDefaultOffset(
  inverseRows: RaInverseTickerRow[],
  signals: RaCalibrationSignal[],
): number {
  return resolveRaInverseAnchorSelection(
    Number.NaN,
    listRaInverseAnchorEligibility(inverseRows, signals),
  );
}

/** Keep user anchor when still valid; otherwise first table-ready or first with data. */
export function resolveRaInverseAnchorSelection(
  previousOffset: number,
  eligibility: RaInverseAnchorEligibility[],
): number {
  if (
    Number.isFinite(previousOffset) &&
    eligibility.some((row) => row.offset === previousOffset && row.total > 0)
  ) {
    return previousOffset;
  }
  const ready = eligibility.find((r) => r.tableReady);
  if (ready) return ready.offset;
  const withData = eligibility.find((r) => r.total > 0);
  return withData?.offset ?? RA_CALIB_CD_OFFSETS[0] ?? -30;
}

export function raInverseEligibilityKey(eligibility: RaInverseAnchorEligibility[]): string {
  return eligibility
    .map(
      (r) =>
        `${r.offset}:${r.total}:${r.upN}:${r.downN}:${r.flatN}:${r.tableReady ? 1 : 0}`,
    )
    .join("|");
}

export function cohortRaCompressionHint(cohort: RascoreCohortSummary | null | undefined): boolean {
  if (!cohort) return false;
  return cohort.missingHighRa || (cohort.scoreMax != null && cohort.scoreMax < 58);
}

const CSV_COMPONENT_HEADERS = [
  "reliability_pts",
  "timing_pts",
  "align_pts",
  "roi_target_pts",
  "sds_pts",
  "precat_pts",
  "mii_pts",
  "calib_pts",
  "reliability_fill_pct",
  "timing_fill_pct",
  "align_fill_pct",
  "roi_target_fill_pct",
  "sds_fill_pct",
  "precat_fill_pct",
  "mii_fill_pct",
  "calib_fill_pct",
] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One row per ticker in the price-up / price-down groups (for export). */
export function buildRaInversePatternCsv(result: RaInversePatternResult): string {
  const header = [
    "anchor",
    "horizon",
    "ticker",
    "price_group",
    "price_chg_pct",
    "ra_total",
    ...CSV_COMPONENT_HEADERS,
  ];
  const lines = [header.join(",")];
  for (const m of result.members) {
    const row = [
      result.offsetLabel,
      result.horizon,
      m.ticker,
      m.group,
      m.priceChgPct,
      m.raScore,
      ...RA_INVERSE_COMPONENT_IDS.flatMap((id) => [
        m.componentPts[id],
        m.componentFillPct[id],
      ]),
    ].map(csvCell);
    lines.push(row.join(","));
  }
  lines.push("");
  lines.push(
    [
      "summary",
      result.offsetLabel,
      "score_mode",
      result.scoreMode,
      "up_n",
      result.upN,
      "down_n",
      result.downN,
      "ra_delta",
      result.raDelta ?? "",
      "ra_p",
      result.raPValue ?? "",
    ].map(csvCell).join(","),
  );
  for (const c of result.components) {
    lines.push(
      [
        "component_summary",
        c.id,
        "up_mean_fill_pct",
        c.upMeanPct ?? "",
        "down_mean_fill_pct",
        c.downMeanPct ?? "",
        "delta_fill_pct",
        c.deltaPct ?? "",
        "p_value",
        c.pValue ?? "",
        "stars",
        c.stars,
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadRaInversePatternCsv(result: RaInversePatternResult): void {
  if (typeof document === "undefined") return;
  const csv = buildRaInversePatternCsv(result);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safe = result.offsetLabel.replace(/[^a-zA-Z0-9+-]/g, "_");
  const link = document.createElement("a");
  link.href = url;
  link.download = `ra_inverse_${safe}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
