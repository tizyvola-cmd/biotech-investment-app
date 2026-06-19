import type { SdsRow } from "../api/supernova";
import type { TranslationKey } from "../shared/i18n";
import type { SdsSnapshotDoc } from "./sdsRoiForecast";
import { buildSimulationTickerSet, type SimulationSheetSnapshotDoc } from "./sdsRoiSimConvergence";

export type SdsClusterLetter = "A" | "B" | "C" | "D" | "E";

export type SdsClusterComponentSpec = {
  key: string;
  labelKey: TranslationKey;
  max: number;
  coverageKey?: keyof NonNullable<SdsRow["coverage_fields"]>;
  notImplemented?: boolean;
  clusterBKey?: keyof NonNullable<SdsRow["cluster_b"]>;
  clusterCKey?: keyof NonNullable<SdsRow["cluster_c"]>;
  clusterDKey?: keyof NonNullable<SdsRow["cluster_d"]>;
  clusterEKey?: keyof NonNullable<SdsRow["cluster_e"]>;
};

export type SdsClusterSpec = {
  letter: SdsClusterLetter;
  titleKey: TranslationKey;
  clusterKey: keyof NonNullable<SdsRow["cluster_scores"]>;
  clusterMax: number;
  components: SdsClusterComponentSpec[];
};

export const SDS_CLUSTER_SPECS: SdsClusterSpec[] = [
  {
    letter: "A",
    titleKey: "decisionLab.sds.clusterA.title",
    clusterKey: "catalyst_quality",
    clusterMax: 30,
    components: [
      { key: "phase_credibility", labelKey: "decisionLab.sds.comp.phaseCred", max: 14 },
      { key: "endpoint_credibility", labelKey: "decisionLab.sds.comp.endpointCred", max: 10 },
      { key: "unmet_need", labelKey: "decisionLab.sds.comp.unmetNeed", max: 13 },
      { key: "market_size", labelKey: "decisionLab.sds.comp.marketSize", max: 10 },
    ],
  },
  {
    letter: "B",
    titleKey: "decisionLab.sds.clusterB.title",
    clusterKey: "institutional_signal",
    clusterMax: 25,
    components: [
      { key: "institutional_delta", labelKey: "decisionLab.sds.comp.instDelta", max: 8, clusterBKey: "institutional_delta" },
      {
        key: "short_interest",
        labelKey: "decisionLab.sds.comp.shortInterest",
        max: 10,
        coverageKey: "short_interest",
        clusterBKey: "short_interest",
      },
      { key: "analyst_upgrade", labelKey: "decisionLab.sds.comp.analystUpgrade", max: 8, clusterBKey: "analyst_upgrades" },
    ],
  },
  {
    letter: "C",
    titleKey: "decisionLab.sds.clusterC.title",
    clusterKey: "price_structure",
    clusterMax: 20,
    components: [
      { key: "bb_squeeze", labelKey: "decisionLab.sds.comp.bbSqueeze", max: 10, coverageKey: "price", clusterCKey: "bollinger_squeeze" },
      { key: "obv_accumulation", labelKey: "decisionLab.sds.comp.obv", max: 8, coverageKey: "volume", clusterCKey: "obv_accumulation" },
      { key: "xbi_rs_90d", labelKey: "decisionLab.sds.comp.xbiRs", max: 5, coverageKey: "xbi", clusterCKey: "xbi_relative_strength" },
      { key: "volume_ratio", labelKey: "decisionLab.sds.comp.volRatio", max: 5, coverageKey: "volume", clusterCKey: "volume_ratio" },
    ],
  },
  {
    letter: "D",
    titleKey: "decisionLab.sds.clusterD.title",
    clusterKey: "fundamentals",
    clusterMax: 15,
    components: [
      { key: "cash_runway", labelKey: "decisionLab.sds.comp.cashRunway", max: 8, coverageKey: "cash_runway", clusterDKey: "cash_runway" },
      { key: "mc_pipeline_ratio", labelKey: "decisionLab.sds.comp.mcPipeline", max: 8, clusterDKey: "mc_pipeline_ratio" },
      { key: "ma_attractiveness", labelKey: "decisionLab.sds.comp.maAttr", max: 7, clusterDKey: "ma_attractiveness" },
    ],
  },
  {
    letter: "E",
    titleKey: "decisionLab.sds.clusterE.title",
    clusterKey: "timing",
    clusterMax: 10,
    components: [
      { key: "catalyst_window", labelKey: "decisionLab.sds.comp.catWindow", max: 6, coverageKey: "days_to_cd", clusterEKey: "catalyst_window" },
      { key: "sequential_catalyst", labelKey: "decisionLab.sds.comp.seqCat", max: 4, clusterEKey: "sequential_catalysts" },
    ],
  },
];

export type SdsComponentPopulationStatus = "present" | "missing" | "insufficient" | "na" | "notImplemented";

export function classifySdsComponentPopulation(
  row: SdsRow,
  spec: SdsClusterComponentSpec,
): SdsComponentPopulationStatus {
  const raw = row.component_raw ?? {};
  const coverage = row.coverage_fields;
  const missingReason = row.missing_data?.[spec.key];
  const value = raw[spec.key] as number | null | undefined;
  const v = value ?? 0;

  const covExplicitlyMissing =
    spec.coverageKey != null && coverage != null && coverage[spec.coverageKey] === false;

  const bBlock =
    spec.clusterBKey && row.cluster_b ? row.cluster_b[spec.clusterBKey] : undefined;
  const unavailable =
    value == null &&
    bBlock &&
    typeof bBlock === "object" &&
    "status" in bBlock &&
    (bBlock as { status?: string }).status === "unavailable";

  if (missingReason === "insufficient_history" || missingReason === "no_price_data") {
    return "insufficient";
  }
  if (unavailable) return "na";
  if (value == null && spec.key === "institutional_delta") return "na";
  if (spec.notImplemented && v === 0) return "notImplemented";
  if (v === 0 && covExplicitlyMissing) return "missing";
  return "present";
}

export type SdsComponentPopulationStat = {
  key: string;
  labelKey: TranslationKey;
  nPresent: number;
  nMissing: number;
  nInsufficient: number;
  nNa: number;
  nNotImplemented: number;
  pctPresent: number;
  weakest: boolean;
};

export type SdsClusterPopulationSummary = {
  letter: SdsClusterLetter;
  titleKey: TranslationKey;
  clusterKey: keyof NonNullable<SdsRow["cluster_scores"]>;
  nCohort: number;
  nWithClusterScore: number;
  avgComponentFillPct: number;
  minComponentFillPct: number;
  components: SdsComponentPopulationStat[];
  gapTickers: string[];
};

export type SdsClusterCoverageView = {
  nSimCohort: number;
  nInSdsSnapshot: number;
  nMissingFromSnapshot: number;
  missingTickers: string[];
  clusters: SdsClusterPopulationSummary[];
  allClustersComplete: boolean;
  sparseComponents: Array<{ clusterLetter: SdsClusterLetter; key: string; labelKey: TranslationKey; pctPresent: number }>;
};

function rowAsSds(row: Record<string, unknown>): SdsRow {
  return row as unknown as SdsRow;
}

function simRowsInSnapshot(
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simTickers: Set<string>,
): SdsRow[] {
  const out: SdsRow[] = [];
  const seen = new Set<string>();
  for (const row of sdsSnap?.rows ?? []) {
    const tk = String(row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || !simTickers.has(tk) || seen.has(tk)) continue;
    seen.add(tk);
    out.push(rowAsSds(row as Record<string, unknown>));
  }
  return out;
}

const SPARSE_THRESHOLD_PCT = 50;

export function buildSdsClusterCoverageView(
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): SdsClusterCoverageView {
  const simTickers = buildSimulationTickerSet(simSnap);
  const nSimCohort = simTickers.size;
  const rows = simRowsInSnapshot(sdsSnap, simTickers);
  const inSnapshot = new Set(rows.map((r) => r.ticker.toUpperCase()));
  const missingTickers = [...simTickers].filter((tk) => !inSnapshot.has(tk)).sort();
  const nCohort = rows.length;

  const clusters: SdsClusterPopulationSummary[] = SDS_CLUSTER_SPECS.map((clusterSpec) => {
    const componentStats: SdsComponentPopulationStat[] = clusterSpec.components.map((compSpec) => {
      let nPresent = 0;
      let nMissing = 0;
      let nInsufficient = 0;
      let nNa = 0;
      let nNotImplemented = 0;

      for (const row of rows) {
        const status = classifySdsComponentPopulation(row, compSpec);
        if (status === "present") nPresent += 1;
        else if (status === "missing") nMissing += 1;
        else if (status === "insufficient") nInsufficient += 1;
        else if (status === "na") nNa += 1;
        else nNotImplemented += 1;
      }

      const pctPresent = nCohort > 0 ? Math.round((nPresent / nCohort) * 100) : 0;
      return {
        key: compSpec.key,
        labelKey: compSpec.labelKey,
        nPresent,
        nMissing,
        nInsufficient,
        nNa,
        nNotImplemented,
        pctPresent,
        weakest: false,
      };
    });

    const fillPcts = componentStats.map((c) => c.pctPresent);
    const minPct = fillPcts.length ? Math.min(...fillPcts) : 0;
    const avgPct = fillPcts.length
      ? Math.round(fillPcts.reduce((s, v) => s + v, 0) / fillPcts.length)
      : 0;

    for (const stat of componentStats) {
      stat.weakest = stat.pctPresent === minPct && nCohort > 0;
    }

    const nWithClusterScore = rows.filter((row) => {
      const score = row.cluster_scores?.[clusterSpec.clusterKey];
      return score != null && Number.isFinite(score);
    }).length;

    const gapTickers = rows
      .filter((row) =>
        clusterSpec.components.some((comp) => classifySdsComponentPopulation(row, comp) !== "present"),
      )
      .map((r) => r.ticker)
      .sort();

    return {
      letter: clusterSpec.letter,
      titleKey: clusterSpec.titleKey,
      clusterKey: clusterSpec.clusterKey,
      nCohort,
      nWithClusterScore,
      avgComponentFillPct: avgPct,
      minComponentFillPct: minPct,
      components: componentStats,
      gapTickers,
    };
  });

  const sparseComponents = clusters.flatMap((c) =>
    c.components
      .filter((comp) => comp.pctPresent < SPARSE_THRESHOLD_PCT && c.nCohort > 0)
      .map((comp) => ({
        clusterLetter: c.letter,
        key: comp.key,
        labelKey: comp.labelKey,
        pctPresent: comp.pctPresent,
      })),
  );

  const allClustersComplete =
    nSimCohort > 0 &&
    missingTickers.length === 0 &&
    sparseComponents.length === 0;

  return {
    nSimCohort,
    nInSdsSnapshot: rows.length,
    nMissingFromSnapshot: missingTickers.length,
    missingTickers,
    clusters,
    allClustersComplete,
    sparseComponents,
  };
}
