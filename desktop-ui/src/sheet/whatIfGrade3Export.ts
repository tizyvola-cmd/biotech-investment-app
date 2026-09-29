/**
 * Grade 3 — Excel (.xls Spreadsheet XML) export for crown + non-crown control rows.
 */
import {
  listAllWhatIfCrownHits,
  type WhatIfCrownHitEvent,
} from "./whatIfCrownHitStore";
import {
  fetchNonCrownControlExport,
  loadNonCrownControlFromLocalStorage,
  mergeGrade3AnalysisRows,
  populationLabel,
  saveNonCrownControlToLocalStorage,
  type Grade3AnalysisRow,
  type NonCrownControlEvent,
} from "./whatIfNonCrownControlStore";
import {
  summarizeWhatIfGrade3Analysis,
  type WhatIfGrade3Analysis,
} from "./whatIfCrownReadout";

export type WhatIfGrade3Export = {
  generatedAt: string;
  lang: "it" | "en";
  rows: Grade3AnalysisRow[];
  crownAnalysis: WhatIfGrade3Analysis;
  nonCrownAnalysis: WhatIfGrade3Analysis;
  /** Row counts by source layer (export = offline replay). */
  layerCounts: { crown: number; controlExport: number; controlImport: number; controlLive: number };
  populationCounts: { strong_offbook: number; pf_nonstrong: number };
};

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(value: string | number | null | undefined, type: "String" | "Number"): string {
  if (value == null || value === "") {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (type === "Number" && typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

function rowCells(
  values: (string | number | null | undefined)[],
  types?: ("String" | "Number")[],
): string {
  return `<Row>${values
    .map((v, i) => xmlCell(v, types?.[i] ?? (typeof v === "number" ? "Number" : "String")))
    .join("")}</Row>`;
}

function worksheet(name: string, rows: string): string {
  const safe = xmlEscape(name.slice(0, 31));
  return `<Worksheet ss:Name="${safe}"><Table>${rows}</Table></Worksheet>`;
}

function fmtNum(v: number | null | undefined): number | string {
  if (v == null || !Number.isFinite(v)) return "";
  return Math.round(v * 10) / 10;
}

function fmtUsd(v: number | null | undefined): number | string {
  if (v == null || !Number.isFinite(v)) return "";
  return Math.round(v);
}

function rowsToEvents(rows: Grade3AnalysisRow[]): WhatIfCrownHitEvent[] {
  return rows.map((r) => ({
    sessionDate: r.sessionDate,
    ticker: r.ticker,
    simKey: r.simKey,
    endPnl: r.endPnl,
    pathMax: r.pathMax,
    pathMin: r.pathMin,
    oscillating: r.oscillating,
    capturedAt: "",
    updatedAt: "",
    readout: r.readout,
  }));
}

export function buildWhatIfGrade3Export(opts: {
  lang?: "it" | "en";
  crownEvents?: readonly WhatIfCrownHitEvent[];
  importedNonCrown?: readonly NonCrownControlEvent[];
  exportedNonCrown?: readonly NonCrownControlEvent[];
  liveNonCrown?: readonly NonCrownControlEvent[];
}): WhatIfGrade3Export {
  const lang = opts.lang ?? "en";
  const crownEvents = opts.crownEvents ?? listAllWhatIfCrownHits();
  const rows = mergeGrade3AnalysisRows({
    crownEvents,
    importedNonCrown: opts.importedNonCrown ?? loadNonCrownControlFromLocalStorage(),
    exportedNonCrown: opts.exportedNonCrown ?? [],
    liveNonCrown: opts.liveNonCrown ?? [],
  });
  const crownRows = rows.filter((r) => r.kind === "crown");
  const nonCrownRows = rows.filter((r) => r.kind !== "crown");
  const layerCounts = {
    crown: crownRows.length,
    controlExport: nonCrownRows.filter((r) => r.sourceLayer === "export").length,
    controlImport: nonCrownRows.filter((r) => r.sourceLayer === "import").length,
    controlLive: nonCrownRows.filter((r) => r.sourceLayer === "live").length,
  };
  const populationCounts = {
    strong_offbook: nonCrownRows.filter((r) => r.kind === "strong_offbook").length,
    pf_nonstrong: nonCrownRows.filter((r) => r.kind === "pf_nonstrong").length,
  };
  return {
    generatedAt: new Date().toISOString(),
    lang,
    rows,
    crownAnalysis: summarizeWhatIfGrade3Analysis(rowsToEvents(crownRows)),
    nonCrownAnalysis: summarizeWhatIfGrade3Analysis(rowsToEvents(nonCrownRows)),
    layerCounts,
    populationCounts,
  };
}

function legendSheet(it: boolean): string {
  const rows = [
    rowCells([it ? "SuperNova — Grado 3 (corona + controllo)" : "SuperNova — Grade 3 (crown + control)"]),
    rowCells([]),
    rowCells([
      it ? "Giallo / Crown" : "Yellow / Crown",
      it ? "Primo hit Strong∩PF per giorno di sessione (dedup)." : "First Strong∩PF hit per session day (dedup).",
    ]),
    rowCells([
      it ? "Azzurrino / Controllo" : "Light blue / Control",
      it
        ? "strong_offbook = Strong ma non in PF · pf_nonstrong = in PF ma non Strong."
        : "strong_offbook = Strong but not in PF · pf_nonstrong = in PF but not Strong.",
    ]),
    rowCells([
      it ? "Readout congelato" : "Frozen readout",
      "SDS · EIS · P(plan) · P(cont) · Precat al momento del hit (capture o backfill).",
    ]),
    rowCells([
      it ? "Controllo offline" : "Offline control",
      "npx tsx scripts/export-noncrown-control.ts → data/whatif_noncrown_export.json",
    ]),
  ].join("");
  return worksheet(it ? "Legenda" : "Legend", rows);
}

function summarySheet(exp: WhatIfGrade3Export): string {
  const it = exp.lang === "it";
  const hdr = rowCells([
    it ? "Gruppo" : "Group",
    "N",
    "SDS med",
    "EIS med",
    "P(plan) med",
    "P(cont) med",
    it ? "P&L fine med $" : "End P&L med $",
    it ? "Picco med $" : "Path max med $",
  ]);

  const rowFor = (label: string, a: WhatIfGrade3Analysis) =>
    rowCells(
      [
        label,
        a.totalHits,
        fmtNum(a.medians.sds),
        fmtNum(a.medians.eis),
        fmtNum(a.medians.pPlan),
        fmtNum(a.medians.pCont),
        fmtUsd(a.medians.endPnl),
        fmtUsd(a.medians.pathMax),
      ],
      ["String", "Number", "Number", "Number", "Number", "Number", "Number", "Number"],
    );

  const rows = [
    rowCells([it ? "Generato" : "Generated", exp.generatedAt.slice(0, 19)]),
    rowCells([]),
    hdr,
    rowFor(it ? "Corona" : "Crown", exp.crownAnalysis),
    rowFor(it ? "Controllo (totale)" : "Control (total)", exp.nonCrownAnalysis),
    rowCells([]),
    rowCells([
      it ? "Controllo · export offline" : "Control · offline export",
      exp.layerCounts.controlExport,
    ]),
    rowCells([
      it ? "Controllo · import/localStorage" : "Control · import/localStorage",
      exp.layerCounts.controlImport,
    ]),
    rowCells([
      it ? "Controllo · sessione live" : "Control · live session",
      exp.layerCounts.controlLive,
    ]),
    rowCells([
      it ? "Strong off-PF" : "Strong off-PF",
      exp.populationCounts.strong_offbook,
    ]),
    rowCells([
      it ? "PF non-Strong" : "PF non-Strong",
      exp.populationCounts.pf_nonstrong,
    ]),
    rowCells([]),
    rowCells([
      it ? "Corona con readout" : "Crown with readout",
      `${exp.crownAnalysis.withReadout}/${exp.crownAnalysis.totalHits}`,
    ]),
    rowCells([
      it ? "Backfill readout" : "Backfill readout",
      exp.crownAnalysis.backfillCount,
    ]),
  ].join("");
  return worksheet(it ? "Riepilogo" : "Summary", rows);
}

function dataSheetForRows(
  exp: WhatIfGrade3Export,
  filter: "crown" | "control",
  sheetName: string,
): string {
  const it = exp.lang === "it";
  const subset =
    filter === "crown"
      ? exp.rows.filter((r) => r.kind === "crown")
      : exp.rows.filter((r) => r.kind !== "crown");
  return dataSheet(subset, sheetName, it);
}

function dataSheet(
  subset: Grade3AnalysisRow[],
  sheetName: string,
  it: boolean,
): string {
  const hdr = rowCells([
    it ? "Gruppo" : "Group",
    it ? "Data" : "Date",
    "Ticker",
    "SDS",
    "EIS",
    "P(plan)",
    "P(cont)",
    "Precat",
    "Δ24h %",
    it ? "P&L fine $" : "End P&L $",
    it ? "Picco $" : "Path max $",
    it ? "Min $" : "Path min $",
    "Osc",
    "Src",
    "Layer",
  ]);

  const data = subset.map((row) => {
    const r = row.readout;
    return rowCells(
      [
        populationLabel(row.kind, it),
        row.sessionDate,
        row.ticker,
        fmtNum(r?.sds ?? null),
        fmtNum(r?.eis ?? null),
        fmtNum(r?.pPlan ?? null),
        fmtNum(r?.pCont ?? null),
        r?.precatKind ?? "",
        fmtNum(r?.dailyPct24h ?? null),
        fmtUsd(row.endPnl),
        fmtUsd(row.pathMax),
        fmtUsd(row.pathMin),
        row.oscillating ? (it ? "sì" : "yes") : (it ? "no" : "no"),
        r?.source ?? "",
        row.sourceLayer,
      ],
      [
        "String",
        "String",
        "String",
        "Number",
        "Number",
        "Number",
        "Number",
        "String",
        "Number",
        "Number",
        "Number",
        "Number",
        "String",
        "String",
        "String",
      ],
    );
  });

  return worksheet(sheetName, hdr + data.join(""));
}

export function buildWhatIfGrade3SpreadsheetXml(exp: WhatIfGrade3Export): string {
  const it = exp.lang === "it";
  const sheets = [
    legendSheet(it),
    summarySheet(exp),
    dataSheetForRows(exp, "crown", it ? "Corona" : "Crown"),
    dataSheetForRows(exp, "control", it ? "Controllo" : "Control"),
    dataSheet(exp.rows, it ? "Tutti" : "All", it),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${sheets}
</Workbook>`;
}

export function downloadWhatIfGrade3ExcelBlob(exp: WhatIfGrade3Export): Blob {
  return new Blob([buildWhatIfGrade3SpreadsheetXml(exp)], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
}

export function triggerBrowserDownload(blob: Blob, filename: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function downloadWhatIfGrade3Excel(opts?: {
  lang?: "it" | "en";
  liveNonCrown?: NonCrownControlEvent[];
}): Promise<{ ok: boolean; controlExportCount: number }> {
  const exportedNonCrown = await fetchNonCrownControlExport();
  if (exportedNonCrown.length > 0) {
    saveNonCrownControlToLocalStorage(exportedNonCrown);
  }
  const importedNonCrown = loadNonCrownControlFromLocalStorage();
  const exp = buildWhatIfGrade3Export({
    lang: opts?.lang ?? "en",
    exportedNonCrown,
    importedNonCrown,
    liveNonCrown: opts?.liveNonCrown ?? [],
  });
  const stamp = exp.generatedAt.slice(0, 10);
  const blob = downloadWhatIfGrade3ExcelBlob(exp);
  const ok = triggerBrowserDownload(blob, `supernova-grade3_${stamp}.xls`);
  return { ok, controlExportCount: exp.layerCounts.controlExport };
}
