import type { TranslationKey } from "../shared/i18n";

export type LegendScoreRow = {
  label: TranslationKey;
  points: string;
};

export type LegendScoreTable = {
  rows: LegendScoreRow[];
  bonus?: TranslationKey;
  example?: TranslationKey;
  footnote?: TranslationKey;
};

/** Scoring tables keyed by metric name translation key */
export const SDS_LEGEND_SCORE_TABLES: Partial<Record<TranslationKey, LegendScoreTable>> = {
  "decisionLab.sds.legend.a.phase.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.phase.p3pivotal", points: "10" },
      { label: "decisionLab.sds.legend.rows.phase.p3nonpivotal", points: "7" },
      { label: "decisionLab.sds.legend.rows.phase.p2b", points: "5" },
      { label: "decisionLab.sds.legend.rows.phase.p2", points: "3–4" },
      { label: "decisionLab.sds.legend.rows.phase.p1b2", points: "2" },
    ],
    bonus: "decisionLab.sds.legend.rows.phase.bonus",
  },
  "decisionLab.sds.legend.a.endpoint.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.endpoint.os", points: "10" },
      { label: "decisionLab.sds.legend.rows.endpoint.biopsy", points: "9" },
      { label: "decisionLab.sds.legend.rows.endpoint.pfsEfs", points: "8" },
      { label: "decisionLab.sds.legend.rows.endpoint.composite", points: "6" },
      { label: "decisionLab.sds.legend.rows.endpoint.orr", points: "5" },
      { label: "decisionLab.sds.legend.rows.endpoint.biomarker", points: "3" },
      { label: "decisionLab.sds.legend.rows.endpoint.pro", points: "2" },
    ],
  },
  "decisionLab.sds.legend.a.unmet.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.unmet.none", points: "10" },
      { label: "decisionLab.sds.legend.rows.unmet.oneTwo", points: "5" },
      { label: "decisionLab.sds.legend.rows.unmet.crowded", points: "1" },
    ],
    bonus: "decisionLab.sds.legend.rows.unmet.bonus",
    example: "decisionLab.sds.legend.rows.unmet.example",
  },
  "decisionLab.sds.legend.a.market.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.market.gt8b", points: "10" },
      { label: "decisionLab.sds.legend.rows.market.5to8b", points: "8" },
      { label: "decisionLab.sds.legend.rows.market.3to5b", points: "6" },
      { label: "decisionLab.sds.legend.rows.market.1to3b", points: "3" },
      { label: "decisionLab.sds.legend.rows.market.lt1b", points: "1" },
    ],
    example: "decisionLab.sds.legend.rows.market.example",
  },
  "decisionLab.sds.legend.b.short.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.short.squeeze", points: "+10" },
      { label: "decisionLab.sds.legend.rows.short.gt20Pos", points: "+7" },
      { label: "decisionLab.sds.legend.rows.short.gt15", points: "+5" },
      { label: "decisionLab.sds.legend.rows.short.gt10", points: "+3" },
      { label: "decisionLab.sds.legend.rows.short.gt5", points: "+1" },
      { label: "decisionLab.sds.legend.rows.short.gt20Neg", points: "−5" },
    ],
    footnote: "decisionLab.sds.legend.rows.short.footnote",
  },
  "decisionLab.sds.legend.b.analyst.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.analyst.t1Init", points: "8" },
      { label: "decisionLab.sds.legend.rows.analyst.t1Upgrade", points: "+4" },
      { label: "decisionLab.sds.legend.rows.analyst.boutiqueInit", points: "+3" },
      { label: "decisionLab.sds.legend.rows.analyst.boutiqueUpgrade", points: "+2" },
      { label: "decisionLab.sds.legend.rows.analyst.t1Reiterated", points: "+2" },
      { label: "decisionLab.sds.legend.rows.analyst.downgrades", points: "−3" },
    ],
    footnote: "decisionLab.sds.legend.rows.analyst.footnote",
  },
  "decisionLab.sds.legend.b.instOwn.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.instOwn.premiumDelta", points: "+8" },
      { label: "decisionLab.sds.legend.rows.instOwn.premiumPresent", points: "+6" },
      { label: "decisionLab.sds.legend.rows.instOwn.deltaGt15", points: "+7" },
      { label: "decisionLab.sds.legend.rows.instOwn.deltaGt8", points: "+5" },
      { label: "decisionLab.sds.legend.rows.instOwn.deltaGt3", points: "+3" },
      { label: "decisionLab.sds.legend.rows.instOwn.delta0to3", points: "+1" },
      { label: "decisionLab.sds.legend.rows.instOwn.exit", points: "−2" },
    ],
    footnote: "decisionLab.sds.legend.rows.instOwn.footnote",
  },
  "decisionLab.sds.legend.c.bb.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.bb.lt10", points: "10" },
      { label: "decisionLab.sds.legend.rows.bb.lt20", points: "8" },
      { label: "decisionLab.sds.legend.rows.bb.lt35", points: "5" },
      { label: "decisionLab.sds.legend.rows.bb.lt50", points: "2" },
      { label: "decisionLab.sds.legend.rows.bb.gt50", points: "0" },
    ],
    footnote: "decisionLab.sds.legend.rows.bb.footnote",
  },
  "decisionLab.sds.legend.c.obv.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.obv.risingFlat", points: "8" },
      { label: "decisionLab.sds.legend.rows.obv.risingDiv", points: "6" },
      { label: "decisionLab.sds.legend.rows.obv.risingUp", points: "5" },
      { label: "decisionLab.sds.legend.rows.obv.risingWeak", points: "2" },
      { label: "decisionLab.sds.legend.rows.obv.downFlat", points: "0" },
      { label: "decisionLab.sds.legend.rows.obv.bothDown", points: "0" },
    ],
    footnote: "decisionLab.sds.legend.rows.obv.footnote",
  },
  "decisionLab.sds.legend.c.xbi.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.xbi.gt20", points: "+5" },
      { label: "decisionLab.sds.legend.rows.xbi.gt10", points: "+4" },
      { label: "decisionLab.sds.legend.rows.xbi.gt3", points: "+3" },
      { label: "decisionLab.sds.legend.rows.xbi.neutral", points: "+1" },
      { label: "decisionLab.sds.legend.rows.xbi.mildNeg", points: "0" },
      { label: "decisionLab.sds.legend.rows.xbi.ltNeg10", points: "−2" },
    ],
  },
  "decisionLab.sds.legend.c.volRatio.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.volRatio.gt25", points: "+5" },
      { label: "decisionLab.sds.legend.rows.volRatio.gt18", points: "+4" },
      { label: "decisionLab.sds.legend.rows.volRatio.gt13", points: "+3" },
      { label: "decisionLab.sds.legend.rows.volRatio.gt10", points: "+1" },
      { label: "decisionLab.sds.legend.rows.volRatio.normal", points: "0" },
      { label: "decisionLab.sds.legend.rows.volRatio.lt07", points: "−1" },
    ],
  },
  "decisionLab.sds.legend.d.cash.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.cash.positive", points: "+8" },
      { label: "decisionLab.sds.legend.rows.cash.gte24", points: "+8" },
      { label: "decisionLab.sds.legend.rows.cash.18to24", points: "+7" },
      { label: "decisionLab.sds.legend.rows.cash.12to18", points: "+5" },
      { label: "decisionLab.sds.legend.rows.cash.9to12", points: "+3" },
      { label: "decisionLab.sds.legend.rows.cash.6to9", points: "+1" },
      { label: "decisionLab.sds.legend.rows.cash.3to6", points: "−3" },
      { label: "decisionLab.sds.legend.rows.cash.lt3", points: "−8" },
    ],
    footnote: "decisionLab.sds.legend.rows.cash.footnote",
  },
  "decisionLab.sds.legend.d.pipeline.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.pipeline.lt02", points: "+8" },
      { label: "decisionLab.sds.legend.rows.pipeline.lt04", points: "+6" },
      { label: "decisionLab.sds.legend.rows.pipeline.lt07", points: "+4" },
      { label: "decisionLab.sds.legend.rows.pipeline.lt10", points: "+2" },
      { label: "decisionLab.sds.legend.rows.pipeline.lt15", points: "+1" },
      { label: "decisionLab.sds.legend.rows.pipeline.gte15", points: "0" },
    ],
    example: "decisionLab.sds.legend.rows.pipeline.example",
  },
  "decisionLab.sds.legend.d.ma.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.ma.firstInClass", points: "+3" },
      { label: "decisionLab.sds.legend.rows.ma.p3Momentum", points: "+2" },
      { label: "decisionLab.sds.legend.rows.ma.smallCap", points: "+1" },
      { label: "decisionLab.sds.legend.rows.ma.bigPharma", points: "+1" },
    ],
    example: "decisionLab.sds.legend.rows.ma.example",
  },
  "decisionLab.sds.legend.e.window.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.window.t14to30", points: "6" },
      { label: "decisionLab.sds.legend.rows.window.t30to45", points: "5" },
      { label: "decisionLab.sds.legend.rows.window.t7to14", points: "4" },
      { label: "decisionLab.sds.legend.rows.window.t45to60", points: "3" },
      { label: "decisionLab.sds.legend.rows.window.lt7", points: "2" },
      { label: "decisionLab.sds.legend.rows.window.t60to90", points: "1" },
      { label: "decisionLab.sds.legend.rows.window.passed", points: "0" },
    ],
    footnote: "decisionLab.sds.legend.rows.window.footnote",
  },
  "decisionLab.sds.legend.e.sequential.name": {
    rows: [
      { label: "decisionLab.sds.legend.rows.sequential.gte4", points: "4" },
      { label: "decisionLab.sds.legend.rows.sequential.eq3", points: "3" },
      { label: "decisionLab.sds.legend.rows.sequential.eq2", points: "2" },
      { label: "decisionLab.sds.legend.rows.sequential.eq1", points: "1" },
      { label: "decisionLab.sds.legend.rows.sequential.none", points: "0" },
    ],
    footnote: "decisionLab.sds.legend.rows.sequential.footnote",
    example: "decisionLab.sds.legend.rows.sequential.example",
  },
};
