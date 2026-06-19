import type { TranslationKey } from "../shared/i18n";

export type HistoryBadgeVariant = "green" | "blue" | "orange";

export type HistoryCaseField = {
  labelKey: TranslationKey;
  valueKey: TranslationKey;
};

export type HistoryCaseCardSpec = {
  id: string;
  ticker: string;
  /** Membro k-means cluster 1 (μ SuperNova) vs caso di riferimento esterno. */
  clusterRole: "member" | "candidate";
  gainKey: TranslationKey;
  gainTone: "green" | "amber";
  badges: { key: TranslationKey; variant: HistoryBadgeVariant }[];
  dateKey: TranslationKey;
  left: HistoryCaseField[];
  right: HistoryCaseField[];
  noteTitleKey: TranslationKey;
  noteBodyKey: TranslationKey;
};

export const SDS_HISTORY_CASE_CARDS: HistoryCaseCardSpec[] = [
  {
    id: "acrs-2021",
    ticker: "ACRS",
    clusterRole: "member",
    gainKey: "decisionLab.sds.history.case.acrs.gain",
    gainTone: "green",
    badges: [
      { key: "decisionLab.sds.history.case.acrs.badge1", variant: "green" },
      { key: "decisionLab.sds.history.case.acrs.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.acrs.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.drug", valueKey: "decisionLab.sds.history.case.acrs.drug" },
      { labelKey: "decisionLab.sds.history.field.keyResult", valueKey: "decisionLab.sds.history.case.acrs.keyResult" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.acrs.cdIndicated" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.indication", valueKey: "decisionLab.sds.history.case.acrs.indication" },
      { labelKey: "decisionLab.sds.history.field.safety", valueKey: "decisionLab.sds.history.case.acrs.safety" },
      { labelKey: "decisionLab.sds.history.field.surgeTiming", valueKey: "decisionLab.sds.history.case.acrs.surgeTiming" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.acrs.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.acrs.noteBody",
  },
  {
    id: "mdgl-p2-2017",
    ticker: "MDGL",
    clusterRole: "member",
    gainKey: "decisionLab.sds.history.case.mdglP2.gain",
    gainTone: "green",
    badges: [
      { key: "decisionLab.sds.history.case.mdglP2.badge1", variant: "green" },
      { key: "decisionLab.sds.history.case.mdglP2.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.mdglP2.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.drug", valueKey: "decisionLab.sds.history.case.mdglP2.drug" },
      { labelKey: "decisionLab.sds.history.field.keyResult", valueKey: "decisionLab.sds.history.case.mdglP2.keyResult" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.mdglP2.cdIndicated" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.indication", valueKey: "decisionLab.sds.history.case.mdglP2.indication" },
      { labelKey: "decisionLab.sds.history.field.marketPotential", valueKey: "decisionLab.sds.history.case.mdglP2.marketPotential" },
      { labelKey: "decisionLab.sds.history.field.buyoutNarrative", valueKey: "decisionLab.sds.history.case.mdglP2.buyoutNarrative" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.mdglP2.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.mdglP2.noteBody",
  },
  {
    id: "mdgl-p3-2022",
    ticker: "MDGL",
    clusterRole: "member",
    gainKey: "decisionLab.sds.history.case.mdglP3.gain",
    gainTone: "green",
    badges: [
      { key: "decisionLab.sds.history.case.mdglP3.badge1", variant: "green" },
      { key: "decisionLab.sds.history.case.mdglP3.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.mdglP3.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.drug", valueKey: "decisionLab.sds.history.case.mdglP3.drug" },
      { labelKey: "decisionLab.sds.history.field.endpoint1", valueKey: "decisionLab.sds.history.case.mdglP3.endpoint1" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.mdglP3.cdIndicated" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.patients", valueKey: "decisionLab.sds.history.case.mdglP3.patients" },
      { labelKey: "decisionLab.sds.history.field.endpoint2", valueKey: "decisionLab.sds.history.case.mdglP3.endpoint2" },
      { labelKey: "decisionLab.sds.history.field.outcome", valueKey: "decisionLab.sds.history.case.mdglP3.outcome" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.mdglP3.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.mdglP3.noteBody",
  },
  {
    id: "antx-2026",
    ticker: "ANTX",
    clusterRole: "member",
    gainKey: "decisionLab.sds.history.case.antx.gain",
    gainTone: "green",
    badges: [
      { key: "decisionLab.sds.history.case.antx.badge1", variant: "orange" },
      { key: "decisionLab.sds.history.case.antx.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.antx.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.event", valueKey: "decisionLab.sds.history.case.antx.event" },
      { labelKey: "decisionLab.sds.history.field.runway", valueKey: "decisionLab.sds.history.case.antx.runway" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.antx.cdIndicated" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.investors", valueKey: "decisionLab.sds.history.case.antx.investors" },
      { labelKey: "decisionLab.sds.history.field.newProgram", valueKey: "decisionLab.sds.history.case.antx.newProgram" },
      { labelKey: "decisionLab.sds.history.field.noteShort", valueKey: "decisionLab.sds.history.case.antx.noteShort" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.antx.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.antx.noteBody",
  },
  {
    id: "ctmx-2026",
    ticker: "CTMX",
    clusterRole: "member",
    gainKey: "decisionLab.sds.history.case.ctmx.gain",
    gainTone: "green",
    badges: [
      { key: "decisionLab.sds.history.case.ctmx.badge1", variant: "green" },
      { key: "decisionLab.sds.history.case.ctmx.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.ctmx.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.drug", valueKey: "decisionLab.sds.history.case.ctmx.drug" },
      { labelKey: "decisionLab.sds.history.field.orr", valueKey: "decisionLab.sds.history.case.ctmx.orr" },
      { labelKey: "decisionLab.sds.history.field.volume", valueKey: "decisionLab.sds.history.case.ctmx.volume" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.indication", valueKey: "decisionLab.sds.history.case.ctmx.indication" },
      { labelKey: "decisionLab.sds.history.field.dcr", valueKey: "decisionLab.sds.history.case.ctmx.dcr" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.ctmx.cdIndicated" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.ctmx.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.ctmx.noteBody",
  },
  {
    id: "btai-2020",
    ticker: "BTAI",
    clusterRole: "candidate",
    gainKey: "decisionLab.sds.history.case.btai.gain",
    gainTone: "amber",
    badges: [
      { key: "decisionLab.sds.history.case.btai.badge1", variant: "orange" },
      { key: "decisionLab.sds.history.case.btai.badge2", variant: "blue" },
    ],
    dateKey: "decisionLab.sds.history.case.btai.date",
    left: [
      { labelKey: "decisionLab.sds.history.field.drug", valueKey: "decisionLab.sds.history.case.btai.drug" },
      { labelKey: "decisionLab.sds.history.field.context", valueKey: "decisionLab.sds.history.case.btai.context" },
      { labelKey: "decisionLab.sds.history.field.cdIndicated", valueKey: "decisionLab.sds.history.case.btai.cdIndicated" },
    ],
    right: [
      { labelKey: "decisionLab.sds.history.field.indication", valueKey: "decisionLab.sds.history.case.btai.indication" },
      { labelKey: "decisionLab.sds.history.field.then", valueKey: "decisionLab.sds.history.case.btai.then" },
      { labelKey: "decisionLab.sds.history.field.specificData", valueKey: "decisionLab.sds.history.case.btai.specificData" },
    ],
    noteTitleKey: "decisionLab.sds.history.case.btai.noteTitle",
    noteBodyKey: "decisionLab.sds.history.case.btai.noteBody",
  },
];

export const SDS_HISTORY_PATTERN_BULLETS = {
  amplifiers: [
    "decisionLab.sds.history.patterns.amp1",
    "decisionLab.sds.history.patterns.amp2",
    "decisionLab.sds.history.patterns.amp3",
    "decisionLab.sds.history.patterns.amp4",
    "decisionLab.sds.history.patterns.amp5",
  ] as TranslationKey[],
  preSurge: [
    "decisionLab.sds.history.patterns.pre1",
    "decisionLab.sds.history.patterns.pre2",
    "decisionLab.sds.history.patterns.pre3",
    "decisionLab.sds.history.patterns.pre4",
    "decisionLab.sds.history.patterns.pre5",
  ] as TranslationKey[],
};
