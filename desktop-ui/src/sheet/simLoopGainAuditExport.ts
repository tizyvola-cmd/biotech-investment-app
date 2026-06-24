/**
 * Excel audit export for sim loop gains — equal, weight, and synth sizing.
 */
import type { DecisionSimTick } from "./investDecisionSimLoop";
import type { PaperClosedDeal } from "./paperSimMaturation";
import { buildPaperMaturationSeries } from "./paperSimMaturation";
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import type { SimLoopSynthMaturationPoint } from "./simLoopSynthMaturation";

export type SimLoopGainAuditTickRow = {
  tickAt: string;
  tickLabel: string;
  equalClosedEur: number;
  equalOpenEur: number;
  equalTotalEur: number;
  weightClosedEur: number | null;
  weightOpenEur: number | null;
  weightTotalEur: number | null;
  synthClosedEur: number | null;
  synthOpenEur: number | null;
  synthTotalEur: number | null;
  openPositions: number;
  sellEvent: string;
};

export type SimLoopGainAuditDealRow = {
  ticker: string;
  key: string;
  entryAt: string;
  exitAt: string;
  holdDays: number;
  capitalEur: number;
  pnlEur: number;
  pnlPct: number | null;
};

export type SimLoopGainAuditExport = {
  generatedAt: string;
  capitalPerTrade: number;
  maxOpenPositions: number | null;
  totalCapitalPotEur: number | null;
  tickRows: SimLoopGainAuditTickRow[];
  dealRows: SimLoopGainAuditDealRow[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtIso(iso: string): string {
  try {
    return new Date(iso).toISOString();
  } catch {
    return iso;
  }
}

function lookupSizingPoint(
  series: SimLoopSynthMaturationPoint[] | null | undefined,
  at: string,
  isLive?: boolean,
): SimLoopSynthMaturationPoint | null {
  if (!series?.length) return null;
  const sorted = [...series].sort((a, b) => a.at.localeCompare(b.at));
  if (isLive) return sorted[sorted.length - 1] ?? null;
  let last: SimLoopSynthMaturationPoint | null = null;
  for (const pt of sorted) {
    if (pt.at > at) break;
    last = pt;
  }
  return last;
}

export function buildSimLoopGainAuditExport(args: {
  ticks: DecisionSimTick[];
  weightMaturation?: SimLoopSynthMaturationPoint[] | null;
  synthMaturation?: SimLoopSynthMaturationPoint[] | null;
  closedDeals: PaperClosedDeal[];
  live?: {
    piggyBank: ExperimentPiggyBank;
    paperPortfolio: PaperPosition[];
    evaluations: TickerSimEvaluation[];
  } | null;
  capitalPerTrade: number;
  maxOpenPositions?: number | null;
  totalCapitalPotEur?: number | null;
}): SimLoopGainAuditExport {
  const equalSeries = buildPaperMaturationSeries(args.ticks, args.live ?? null);

  const tickRows: SimLoopGainAuditTickRow[] = equalSeries.map((eq) => {
    const tk = args.ticks.find((t) => t.at === eq.at);
    const weight = lookupSizingPoint(args.weightMaturation, eq.at, eq.isLive);
    const synth = lookupSizingPoint(args.synthMaturation, eq.at, eq.isLive);
    return {
      tickAt: fmtIso(eq.at),
      tickLabel: eq.atLabel,
      equalClosedEur: round2(eq.closedPnlEur),
      equalOpenEur: round2(eq.openMtmEur),
      equalTotalEur: round2(eq.totalPnlEur),
      weightClosedEur: weight ? round2(weight.simLoopSynthClosedPnlEur) : null,
      weightOpenEur: weight ? round2(weight.simLoopSynthOpenMtmEur) : null,
      weightTotalEur: weight ? round2(weight.simLoopSynthTotalPnlEur) : null,
      synthClosedEur: synth ? round2(synth.simLoopSynthClosedPnlEur) : null,
      synthOpenEur: synth ? round2(synth.simLoopSynthOpenMtmEur) : null,
      synthTotalEur: synth ? round2(synth.simLoopSynthTotalPnlEur) : null,
      openPositions: tk?.portfolioAfter.length ?? 0,
      sellEvent: eq.sellTicker
        ? `${eq.sellTicker} ${eq.sellPnlEur != null ? round2(eq.sellPnlEur) : ""}`.trim()
        : "",
    };
  });

  const dealRows: SimLoopGainAuditDealRow[] = args.closedDeals.map((d) => ({
    ticker: d.ticker,
    key: d.key,
    entryAt: fmtIso(d.entryAt),
    exitAt: fmtIso(d.exitAt),
    holdDays: d.holdDays,
    capitalEur: round2(d.capitalEur),
    pnlEur: round2(d.pnlEur),
    pnlPct: d.pnlPct != null ? round2(d.pnlPct) : null,
  }));

  return {
    generatedAt: new Date().toISOString(),
    capitalPerTrade: args.capitalPerTrade,
    maxOpenPositions: args.maxOpenPositions ?? null,
    totalCapitalPotEur: args.totalCapitalPotEur ?? null,
    tickRows,
    dealRows,
  };
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(value: string | number | null | undefined, type: "String" | "Number"): string {
  if (value == null || value === "") {
    return "<Cell><Data ss:Type=\"String\"></Data></Cell>";
  }
  if (type === "Number" && typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

function legendRows(lang: "it" | "en", exp: SimLoopGainAuditExport): string[][] {
  const it = lang === "it";
  return [
    [it ? "SuperNova — audit gain sim loop" : "SuperNova — sim loop gain audit"],
    [it ? "Generato" : "Generated", exp.generatedAt],
    [it ? "Capitale per deal (equal)" : "Capital per deal (equal)", String(exp.capitalPerTrade)],
    [
      it ? "Max posizioni aperte" : "Max open positions",
      exp.maxOpenPositions != null ? String(exp.maxOpenPositions) : "—",
    ],
    [
      it ? "Pot capitale totale (weight/synth)" : "Total capital pot (weight/synth)",
      exp.totalCapitalPotEur != null ? String(exp.totalCapitalPotEur) : "—",
    ],
    [
      it ? "Equal" : "Equal",
      it
        ? "Stesso € per deal paper — colonna equal*."
        : "Same € per paper deal — equal* columns.",
    ],
    [
      it ? "Weight" : "Weight",
      it
        ? "Quote Learning Lab / Step 2 — colonna weight*."
        : "Learning Lab / Step 2 shares — weight* columns.",
    ],
    [
      it ? "Synth" : "Synth",
      it
        ? "Weight Sim Exp (Step 3) — colonna synth*."
        : "Weight Sim Exp (Step 3) — synth* columns.",
    ],
    [
      it ? "P&L totale" : "Total P&L",
      it ? "chiuso + aperto (MTM)" : "closed + open (MTM)",
    ],
  ];
}

export function buildSimLoopGainAuditSpreadsheetXml(
  exp: SimLoopGainAuditExport,
  lang: "it" | "en" = "it",
): string {
  const it = lang === "it";
  const tickHeaders = it
    ? [
        "Tick ISO",
        "Etichetta",
        "Equal chiuso €",
        "Equal aperto €",
        "Equal totale €",
        "Weight chiuso €",
        "Weight aperto €",
        "Weight totale €",
        "Synth chiuso €",
        "Synth aperto €",
        "Synth totale €",
        "Pos. aperte",
        "SELL evento",
      ]
    : [
        "Tick ISO",
        "Label",
        "Equal closed €",
        "Equal open €",
        "Equal total €",
        "Weight closed €",
        "Weight open €",
        "Weight total €",
        "Synth closed €",
        "Synth open €",
        "Synth total €",
        "Open pos.",
        "SELL event",
      ];

  const dealHeaders = it
    ? ["Ticker", "Key", "Ingresso", "Uscita", "Giorni", "Capitale €", "P&L €", "P&L %"]
    : ["Ticker", "Key", "Entry", "Exit", "Days", "Capital €", "P&L €", "P&L %"];

  const legend = legendRows(lang, exp)
    .map((cells) => {
      const padded = [...cells];
      while (padded.length < 2) padded.push("");
      return `<Row>${xmlCell(padded[0], "String")}${xmlCell(padded[1], "String")}</Row>`;
    })
    .join("");

  const tickHeaderRow = `<Row>${tickHeaders.map((h) => xmlCell(h, "String")).join("")}</Row>`;
  const tickData = exp.tickRows
    .map(
      (r) =>
        `<Row>${[
          xmlCell(r.tickAt, "String"),
          xmlCell(r.tickLabel, "String"),
          xmlCell(r.equalClosedEur, "Number"),
          xmlCell(r.equalOpenEur, "Number"),
          xmlCell(r.equalTotalEur, "Number"),
          xmlCell(r.weightClosedEur, "Number"),
          xmlCell(r.weightOpenEur, "Number"),
          xmlCell(r.weightTotalEur, "Number"),
          xmlCell(r.synthClosedEur, "Number"),
          xmlCell(r.synthOpenEur, "Number"),
          xmlCell(r.synthTotalEur, "Number"),
          xmlCell(r.openPositions, "Number"),
          xmlCell(r.sellEvent, "String"),
        ].join("")}</Row>`,
    )
    .join("");

  const dealHeaderRow = `<Row>${dealHeaders.map((h) => xmlCell(h, "String")).join("")}</Row>`;
  const dealData = exp.dealRows
    .map(
      (r) =>
        `<Row>${[
          xmlCell(r.ticker, "String"),
          xmlCell(r.key, "String"),
          xmlCell(r.entryAt, "String"),
          xmlCell(r.exitAt, "String"),
          xmlCell(r.holdDays, "Number"),
          xmlCell(r.capitalEur, "Number"),
          xmlCell(r.pnlEur, "Number"),
          xmlCell(r.pnlPct, "Number"),
        ].join("")}</Row>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${it ? "Legenda" : "Legend"}">
<Table>${legend}</Table>
</Worksheet>
<Worksheet ss:Name="${it ? "Tick" : "Ticks"}">
<Table>${tickHeaderRow}${tickData}</Table>
</Worksheet>
<Worksheet ss:Name="${it ? "Deal chiusi" : "Closed deals"}">
<Table>${dealHeaderRow}${dealData}</Table>
</Worksheet>
</Workbook>`;
}

export function downloadSimLoopGainAuditExcel(
  exp: SimLoopGainAuditExport,
  lang: "it" | "en" = "it",
): void {
  const xml = buildSimLoopGainAuditSpreadsheetXml(exp, lang);
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `supernova-simloop-gain-audit_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
