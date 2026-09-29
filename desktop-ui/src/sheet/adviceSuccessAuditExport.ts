/**
 * Excel audit export for dashboard «Success efficiency» KPI —
 * explains headline source, live vs frozen display, and per-ticker drivers.
 */
import type { SheetTable } from "../types";
import type { DecisionSimState } from "./investDecisionSimStorage";
import {
  ADVICE_CALIB_MIN_SCORED_FOR_RATE,
  buildAdviceCalibrationFromLiveRows,
  summarizeAdviceCalibrationFromLiveRows,
  type LiveAdviceCalibRow,
} from "./investDecisionSimAdviceCalibration";
import {
  buildAdviceSuccessFreezeKey,
  buildAdviceSuccessFreezeTickerRows,
  loadAdviceSuccessCloseSnapshot,
  type AdviceSuccessCloseSnapshot,
} from "./adviceSuccessCloseSnapshot";
import { loadAdviceLearningHistory } from "./adviceLearningHistory";
import { sanitizeStoredCapturePct } from "./adviceComplementKpis";
import { buildDashboardRecEfficiencySub } from "./dashboardHeroEfficiency";
import type { PortfolioSuccessBridge } from "./portfolioSuccessBridge";
import {
  buildUnifiedAdviceSuccess,
  type UnifiedAdviceSuccess,
} from "./unifiedAdviceSuccess";

export type AdviceSuccessAuditExport = {
  generatedAt: string;
  lang: "it" | "en";
  freezeKey: string;
  cachedSnapshot: AdviceSuccessCloseSnapshot | null;
  liveUnified: UnifiedAdviceSuccess;
  liveAdvicePct: number | null;
  displayedHeadlinePct: number | null;
  displayedFrozen: boolean;
  portfolioMtmEur: number | null;
  portfolioSuccessBridge: PortfolioSuccessBridge;
  simLoopScorecard: DecisionSimState["scorecard"];
  calibrationPoints: ReturnType<typeof buildAdviceCalibrationFromLiveRows>;
  monitorRows: LiveAdviceCalibRow[];
  freezeTickers: AdviceSuccessFreezeTickerRow[];
};

export type AdviceSuccessFreezeTickerRow = {
  ticker: string;
  price: string;
  dailyVarPct: string;
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

function rowCells(values: (string | number | null | undefined)[], types?: ("String" | "Number")[]): string {
  return `<Row>${values
    .map((v, i) => xmlCell(v, types?.[i] ?? (typeof v === "number" ? "Number" : "String")))
    .join("")}</Row>`;
}

function worksheet(name: string, rows: string): string {
  const safe = xmlEscape(name.slice(0, 31));
  return `<Worksheet ss:Name="${safe}"><Table>${rows}</Table></Worksheet>`;
}

export function parseAdviceSuccessFreezeKey(freezeKey: string): AdviceSuccessFreezeTickerRow[] {
  if (!freezeKey) return [];
  const parts = freezeKey.split("|");
  if (parts.length < 3) return [];
  const out: AdviceSuccessFreezeTickerRow[] = [];
  for (let i = 2; i < parts.length; i += 1) {
    const seg = parts[i]!;
    const colon = seg.indexOf(":");
    if (colon <= 0) continue;
    const ticker = seg.slice(0, colon);
    const rest = seg.slice(colon + 1);
    const colon2 = rest.indexOf(":");
    if (colon2 < 0) {
      out.push({ ticker, price: rest, dailyVarPct: "" });
    } else {
      out.push({
        ticker,
        price: rest.slice(0, colon2),
        dailyVarPct: rest.slice(colon2 + 1),
      });
    }
  }
  return out;
}

function parseHeadlinePct(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(String(value).replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

export function buildAdviceSuccessAuditExport(args: {
  lang: "it" | "en";
  simTable: SheetTable | null | undefined;
  monitorRows: LiveAdviceCalibRow[];
  decisionSimState: Pick<DecisionSimState, "scorecard" | "paperPortfolio">;
  portfolioSuccessBridge: PortfolioSuccessBridge;
  portfolioMtmEur: number | null;
}): AdviceSuccessAuditExport {
  const lang = args.lang;
  const freezeKey = buildAdviceSuccessFreezeKey(lang);
  const cachedSnapshot = loadAdviceSuccessCloseSnapshot();

  const entryProbByKey = new Map(
    args.decisionSimState.paperPortfolio
      .filter((p) => p.entryProbPct != null && Number.isFinite(p.entryProbPct))
      .map((p) => [p.key, p.entryProbPct!]),
  );

  const liveRows = args.monitorRows.map((row) => ({
    ...row,
    probPctAtAdvice: row.inPaperPortfolio
      ? (entryProbByKey.get(row.key) ?? row.probPct)
      : row.probPct,
  }));

  const liveSummary = summarizeAdviceCalibrationFromLiveRows(liveRows, lang);
  const liveUnified = buildUnifiedAdviceSuccess({
    live: liveSummary,
    paperPrecisionPct: args.decisionSimState.scorecard.advicePrecisionPct,
    paperGood:
      args.decisionSimState.scorecard.goodBuyCount +
      args.decisionSimState.scorecard.goodSellCount,
    paperBad:
      args.decisionSimState.scorecard.badBuyCount +
      args.decisionSimState.scorecard.badSellCount,
    closed: args.portfolioSuccessBridge.closed,
  });

  const displayedFrozen = Boolean(cachedSnapshot && cachedSnapshot.freezeKey === freezeKey);
  const displayedHeadlinePct = displayedFrozen
    ? parseHeadlinePct(cachedSnapshot!.value)
    : liveUnified.headlinePct;

  return {
    generatedAt: new Date().toISOString(),
    lang,
    freezeKey,
    cachedSnapshot,
    liveUnified,
    liveAdvicePct: liveSummary.overallSuccessRatePct,
    displayedHeadlinePct,
    displayedFrozen: displayedFrozen,
    portfolioMtmEur: args.portfolioMtmEur,
    portfolioSuccessBridge: args.portfolioSuccessBridge,
    simLoopScorecard: args.decisionSimState.scorecard,
    calibrationPoints: buildAdviceCalibrationFromLiveRows(liveRows, lang),
    monitorRows: liveRows,
    freezeTickers: buildAdviceSuccessFreezeTickerRows(args.simTable),
  };
}

function legendSheet(lang: "it" | "en", exp: AdviceSuccessAuditExport): string {
  const it = lang === "it";
  const lines: string[][] = [
    [it ? "SuperNova — audit Efficienza successo" : "SuperNova — success efficiency audit"],
    [it ? "Generato" : "Generated", exp.generatedAt],
    [
      it ? "Headline KPI" : "Headline KPI",
      it
        ? "Gerarchia: (1) live ≥3 scored → raccom.%; (2) else paper sim tick; (3) else sim chiusi ≥8 round-trip."
        : "Priority: (1) live ≥3 scored → advice%; (2) else paper sim ticks; (3) else closed sim ≥8 round-trips.",
    ],
    [
      it ? "Oscillazioni interne" : "Internal oscillation",
      it
        ? "Var.%24h e prezzi sheet cambiano outcome live → headline si muove. Con freezeKey invariato il dashboard mostra snapshot congelato."
        : "24h % and sheet prices change live outcomes → headline moves. With unchanged freezeKey dashboard shows frozen snapshot.",
    ],
    [
      it ? "Min scored live" : "Min live scored",
      String(ADVICE_CALIB_MIN_SCORED_FOR_RATE),
    ],
    [
      it ? "Freeze attivo" : "Freeze active",
      exp.displayedFrozen ? (it ? "sì" : "yes") : it ? "no" : "no",
    ],
    [
      it ? "Headline mostrato" : "Displayed headline",
      exp.displayedHeadlinePct != null ? `${exp.displayedHeadlinePct}%` : "—",
    ],
    [
      it ? "Headline live (ora)" : "Live headline (now)",
      exp.liveUnified.headlinePct != null ? `${exp.liveUnified.headlinePct}%` : "—",
    ],
    [
      it ? "Delta display vs live" : "Display vs live delta",
      exp.displayedHeadlinePct != null && exp.liveUnified.headlinePct != null
        ? `${Math.round((exp.displayedHeadlinePct - exp.liveUnified.headlinePct) * 10) / 10} pp`
        : "—",
    ],
  ];
  return worksheet(
    it ? "Legenda" : "Legend",
    lines.map((cells) => rowCells(cells)).join(""),
  );
}

function summarySheet(lang: "it" | "en", exp: AdviceSuccessAuditExport): string {
  const it = lang === "it";
  const u = exp.liveUnified;
  const sc = exp.simLoopScorecard;
  const closed = exp.portfolioSuccessBridge.closed;
  const rows = [
    rowCells([it ? "Campo" : "Field", it ? "Valore" : "Value"]),
    rowCells([it ? "Headline mostrato (%)" : "Displayed headline (%)", exp.displayedHeadlinePct]),
    rowCells([it ? "Headline live (%)" : "Live headline (%)", u.headlinePct]),
    rowCells([
      it ? "Fonte headline live" : "Live headline source",
      u.primarySource,
    ]),
    rowCells([it ? "KPI congelato?" : "KPI frozen?", exp.displayedFrozen ? (it ? "Sì" : "Yes") : (it ? "No" : "No")]),
    rowCells([it ? "Snapshot salvato" : "Cached snapshot at", exp.cachedSnapshot?.savedAt ?? ""]),
    rowCells([it ? "Freeze key" : "Freeze key", exp.freezeKey]),
    rowCells([it ? "MTM portafoglio (€)" : "Portfolio MTM (€)", exp.portfolioMtmEur]),
    rowCells([it ? "Live good / bad / pending" : "Live good / bad / pending", `${u.live.good} / ${u.live.bad} / ${u.live.pending}`]),
    rowCells([it ? "Live scored / rate (%)" : "Live scored / rate (%)", `${u.live.scored} / ${u.live.pct ?? "—"}`]),
    rowCells([
      it ? "Paper sim good / bad / rate (%)" : "Paper sim good / bad / rate (%)",
      `${u.paper.good} / ${u.paper.bad} / ${u.paper.pct ?? "—"}`,
    ]),
    rowCells([
      it ? "Sim loop scorecard precision (%)" : "Sim loop scorecard precision (%)",
      sc.advicePrecisionPct,
    ]),
    rowCells([
      it ? "Sim chiusi win / loss / n / rate (%)" : "Closed sim win / loss / n / rate (%)",
      closed
        ? `${closed.winCount} / ${closed.lossCount} / ${closed.sampleSize} / ${closed.winRatePct ?? "—"}`
        : "—",
    ]),
    rowCells([
      it ? "Chiusi pesano headline?" : "Closed counts toward headline?",
      u.closed.countsTowardHeadline ? (it ? "Sì" : "Yes") : (it ? "No" : "No"),
    ]),
    rowCells([
      it ? "Sub-line dashboard" : "Dashboard sub-line",
      buildDashboardRecEfficiencySub({
        lang,
        portfolioMtmEur: exp.portfolioMtmEur,
        portfolioClosedWinPct: closed?.winRatePct ?? null,
        simLoopPct: sc.advicePrecisionPct,
        advicePct: exp.liveAdvicePct,
      }),
    ]),
  ];
  return worksheet(it ? "Riepilogo" : "Summary", rows.join(""));
}

function liveScoredSheet(lang: "it" | "en", exp: AdviceSuccessAuditExport): string {
  const it = lang === "it";
  const headers = it
    ? [
        "Ticker",
        "Key",
        "Azione",
        "Esito",
        "P(plan) %",
        "Var usata %",
        "Atteso %",
        "Errore forecast %",
        "P&L pos %",
        "Bucket",
        "Fonte",
        "Tipo",
      ]
    : [
        "Ticker",
        "Key",
        "Action",
        "Outcome",
        "P(plan) %",
        "Price chg %",
        "Expected %",
        "Forecast err %",
        "Position P&L %",
        "Bucket",
        "Source",
        "Kind",
      ];
  const data = exp.calibrationPoints.map((p) =>
    rowCells(
      [
        p.ticker,
        p.id,
        p.suggestedAction,
        p.outcome,
        p.probPct,
        p.priceChangePct,
        p.expectedReturnPct,
        p.forecastErrorPct,
        p.pnlPct,
        p.bucketLabel,
        p.source,
        p.kind,
      ],
      [
        "String",
        "String",
        "String",
        "String",
        "Number",
        "Number",
        "Number",
        "Number",
        "Number",
        "String",
        "String",
        "String",
      ],
    ),
  );
  return worksheet(
    it ? "Live_scored" : "Live_scored",
    rowCells(headers) + data.join(""),
  );
}

function monitorSheet(lang: "it" | "en", exp: AdviceSuccessAuditExport): string {
  const it = lang === "it";
  const headers = it
    ? [
        "Ticker",
        "Key",
        "Raccom.",
        "In paper",
        "In portafoglio",
        "P(plan) live",
        "P(plan) advice",
        "Var 24h %",
        "P&L %",
        "Plan ret %",
        "Conta nel KPI",
      ]
    : [
        "Ticker",
        "Key",
        "Suggested",
        "In paper",
        "In portfolio",
        "P(plan) live",
        "P(plan) at advice",
        "Var 24h %",
        "P&L %",
        "Plan ret %",
        "Counts in KPI",
      ];
  const data = exp.monitorRows.map((r) => {
    const inKpi = exp.calibrationPoints.some((p) => p.id.includes(`|${r.key}|`));
    return rowCells([
      r.ticker,
      r.key,
      r.suggestedAction,
      r.inPaperPortfolio ? (it ? "sì" : "yes") : (it ? "no" : "no"),
      r.hasPosition ? (it ? "sì" : "yes") : (it ? "no" : "no"),
      r.probPct,
      r.probPctAtAdvice ?? r.probPct,
      r.pnlPct24h,
      r.pnlPct,
      r.planReturnPct,
      inKpi ? (it ? "sì" : "yes") : (it ? "no" : "no"),
    ]);
  });
  return worksheet(it ? "Monitor" : "Monitor", rowCells(headers) + data.join(""));
}

function freezeSheet(lang: "it" | "en", exp: AdviceSuccessAuditExport): string {
  const it = lang === "it";
  const headers = it
    ? ["Ticker", "Prezzo sheet ($)", "Var. Giorn. %"]
    : ["Ticker", "Sheet price ($)", "Daily var %"];
  const data = exp.freezeTickers.map((r) =>
    rowCells([r.ticker, r.price, r.dailyVarPct]),
  );
  return worksheet(it ? "Prezzi_freeze" : "Price_freeze", rowCells(headers) + data.join(""));
}

function timelineSheet(lang: "it" | "en"): string {
  const it = lang === "it";
  const hist = loadAdviceLearningHistory();
  const headers = it
    ? ["Data", "Unified %", "Live rate %", "Scored", "Capture %", "Chiusi %", "Paper book %", "Manuale"]
    : ["Day", "Unified %", "Live rate %", "Scored", "Capture %", "Closed %", "Paper book %", "Manual"];
  const data = [...hist.snapshots]
    .slice(-120)
    .reverse()
    .map((s) =>
      rowCells([
        s.day,
        s.unifiedAdviceSuccessPct,
        s.overallSuccessRatePct,
        s.scoredPoints,
        sanitizeStoredCapturePct(s.capturePct),
        s.closedPnlWinRatePct,
        s.paperBookReturnPct,
        s.manual ? (it ? "sì" : "yes") : (it ? "no" : "no"),
      ]),
    );
  return worksheet(it ? "Timeline" : "Timeline", rowCells(headers) + data.join(""));
}

export function buildAdviceSuccessAuditSpreadsheetXml(
  exp: AdviceSuccessAuditExport,
  lang: "it" | "en" = exp.lang,
): string {
  const sheets = [
    legendSheet(lang, exp),
    summarySheet(lang, exp),
    liveScoredSheet(lang, exp),
    monitorSheet(lang, exp),
    freezeSheet(lang, exp),
    timelineSheet(lang),
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

export function downloadAdviceSuccessAuditExcel(
  exp: AdviceSuccessAuditExport,
  lang: "it" | "en" = exp.lang,
): void {
  const xml = buildAdviceSuccessAuditSpreadsheetXml(exp, lang);
  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `supernova-success-efficiency-audit_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
