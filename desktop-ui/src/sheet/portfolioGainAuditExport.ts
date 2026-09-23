import type { SheetTable } from "../types";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { buildSimRowByKeyMap } from "./investSimKeys";
import { calendarDayKeyFromDate } from "./ledgerDayWindow";
import {
  buildPortfolioDailyPnlLedger,
  computeSimulationPosition,
  scaleCloseSeriesToEntryCapital,
  sheetBuyPriceFromRow,
  tickerDailyCloseSeries,
  type PortfolioTickerDailyRow,
} from "./simulationPosition";

export type PortfolioGainAuditRow = {
  ticker: string;
  completionDate: string;
  status: "open" | "closed";
  purchaseDate: string;
  buyPriceUsd: number | null;
  shares: number | null;
  day: string;
  closePriceUsd: number | null;
  cumulativePnlPct: number | null;
  rowKind: "entry" | "day" | "exit";
  /** True when buyPrice=0 in both sheet and inputs — shares/closePriceUsd non calcolabili. */
  buyPriceMissing?: boolean;
};

export type PortfolioGainAuditExport = {
  generatedAt: string;
  rows: PortfolioGainAuditRow[];
  incompleteDailyHistory: boolean;
  legTotalDiffersFromMtm: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Returns false for Saturday (6) and Sunday (0) — NASDAQ market closed. */
function isMarketDay(dayKey: string): boolean {
  const dow = new Date(dayKey + "T12:00:00Z").getUTCDay();
  return dow !== 0 && dow !== 6;
}

function fmtNum(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return round2(n);
}

function purchaseDateForEntry(
  inp: InvestSimInputs[string] | undefined,
  investedAt: string | null,
): string {
  if (inp?.purchaseDate?.trim()) return inp.purchaseDate.trim().slice(0, 10);
  if (investedAt?.trim()) {
    const d = new Date(investedAt);
    if (!Number.isNaN(d.getTime())) return calendarDayKeyFromDate(d);
  }
  return "";
}

function inferHistoryEntryCapital(
  history: InvestSimHistoryPoint[],
  key: string,
): number | null {
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (!snap) continue;
    const entry = round2(snap.value - snap.pnl);
    if (entry > 0) return entry;
  }
  return null;
}

function valueForDayKey(
  dayKey: string,
  lr: PortfolioTickerDailyRow,
  closeSeries: { dayKey: string; value: number }[],
  liveValue: number | null,
  todayKey: string,
): number | null {
  if (dayKey === todayKey && liveValue != null && !lr.archived) {
    return round2(liveValue);
  }
  const hit = closeSeries.find((pt) => pt.dayKey === dayKey);
  return hit ? round2(hit.value) : null;
}

function closeUsdFromValue(
  valueEur: number | null,
  shares: number | null,
  fallbackPrice: number | null,
): number | null {
  if (shares != null && shares > 0 && valueEur != null) {
    return round2(valueEur / shares);
  }
  return fallbackPrice != null && fallbackPrice > 0 ? round2(fallbackPrice) : null;
}

function buildAuditRowsForLedgerRow(args: {
  lr: PortfolioTickerDailyRow;
  simRow: Record<string, unknown> | undefined;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
}): PortfolioGainAuditRow[] {
  const { lr, simRow, inputs, history } = args;
  const inp = inputs[lr.key];
  const investedAt = resolveInvestedAt(lr.key, inp, history);
  const purchaseDate = purchaseDateForEntry(inp, investedAt);
  const pos = simRow
    ? computeSimulationPosition(simRow, inputs, { history })
    : null;
  // Fix B: per le posizioni archived (closed) il buyPrice viene inferito da history usando
  // il prezzo CORRENTE come denominatore — risultato sistematicamente sbagliato se il
  // prezzo è cambiato dall'acquisto. Si usa solo il buyPrice esplicito da inputs.
  // Per le posizioni open si mantiene il fallback a pos.buyPrice + sheetBuy.
  const sheetBuy = simRow ? (sheetBuyPriceFromRow(simRow) ?? null) : null;
  const buyPriceUsd: number | null = (() => {
    if (inp?.buyPrice && inp.buyPrice > 0) return inp.buyPrice;
    if (lr.archived) return null; // Fix B: non inferire per posizioni chiuse
    if (pos?.buyPrice && pos.buyPrice > 0) return pos.buyPrice;
    if (sheetBuy && sheetBuy > 0) return sheetBuy;
    return null;
  })();
  const buyPriceMissing = buyPriceUsd == null;
  const shares =
    buyPriceUsd != null && buyPriceUsd > 0 && lr.capital > 0
      ? lr.capital / buyPriceUsd
      : !lr.archived && pos?.shares && pos.shares > 0
        ? pos.shares
        : null;
  const todayKey = calendarDayKeyFromDate(new Date());
  const closeSeriesRaw = tickerDailyCloseSeries(history, lr.key, investedAt);
  const closeSeries = scaleCloseSeriesToEntryCapital(
    closeSeriesRaw,
    lr.capital,
    inferHistoryEntryCapital(history, lr.key),
  );
  const liveValue =
    pos && !pos.pnlUnavailable && !lr.archived
      ? round2(lr.totalEur + lr.capital)
      : null;
  const livePrice =
    pos?.currPrice != null && pos.currPrice > 0 ? pos.currPrice : null;

  const dayKeys = new Set<string>();
  if (purchaseDate) dayKeys.add(purchaseDate);
  // Fix E: filter weekend dates from legs (snapshots taken on Sat/Sun bypass the market-day
  // check and would otherwise generate rows with forward-filled prices attributed to the wrong day).
  for (const leg of lr.legs) {
    if (isMarketDay(leg.dayKey)) dayKeys.add(leg.dayKey);
  }
  // Bug #3 fix: esclude snapshot di sabato/domenica — NASDAQ chiuso, prezzi non affidabili.
  for (const pt of closeSeries) {
    if (isMarketDay(pt.dayKey)) dayKeys.add(pt.dayKey);
  }
  if (!lr.archived && isMarketDay(todayKey)) dayKeys.add(todayKey);

  const sortedDays = [...dayKeys].sort();
  const out: PortfolioGainAuditRow[] = [];
  const status: "open" | "closed" = lr.archived ? "closed" : "open";

  if (purchaseDate) {
    out.push({
      ticker: lr.ticker,
      completionDate: lr.completionDate,
      status,
      purchaseDate,
      buyPriceUsd: fmtNum(buyPriceUsd),
      shares: fmtNum(shares),
      day: purchaseDate,
      closePriceUsd: fmtNum(buyPriceUsd),
      cumulativePnlPct: 0,
      rowKind: "entry",
      ...(buyPriceMissing ? { buyPriceMissing: true } : {}),
    });
  }

  for (const day of sortedDays) {
    if (day === purchaseDate) continue;
    const positionValueEur = valueForDayKey(day, lr, closeSeries, liveValue, todayKey);
    const cumulativePnlEur =
      positionValueEur != null ? round2(positionValueEur - lr.capital) : null;
    const cumulativePnlPct =
      cumulativePnlEur != null && lr.capital > 0
        ? round2((cumulativePnlEur / lr.capital) * 100)
        : null;
    const closePriceUsd = closeUsdFromValue(
      positionValueEur,
      shares,
      day === todayKey ? livePrice : null,
    );

    out.push({
      ticker: lr.ticker,
      completionDate: lr.completionDate,
      status,
      purchaseDate,
      buyPriceUsd: fmtNum(buyPriceUsd),
      shares: fmtNum(shares),
      day,
      closePriceUsd: fmtNum(closePriceUsd),
      cumulativePnlPct: fmtNum(cumulativePnlPct),
      rowKind: "day",
    });
  }

  // Fix D + Bug #5: riga "exit" esplicita per posizioni chiuse.
  // Genera la riga se soldAt è noto OPPURE se closedValue è impostato (CCCC ha closedValue
  // ma soldAt mancante per un bug di scrittura al momento della vendita).
  if (lr.archived && (inp?.soldAt || inp?.closedValue != null)) {
    const exitDayKey = inp?.soldAt
      ? inp.soldAt.slice(0, 10)
      : (out[out.length - 1]?.day ?? purchaseDate); // fallback: ultimo giorno già in output
    const closedValueEur = inp?.closedValue ?? null;
    const closedPnlEur = inp?.closedPnlEur ?? null;
    const closedPnlPct =
      closedPnlEur != null && lr.capital > 0
        ? round2((closedPnlEur / lr.capital) * 100)
        : null;
    // Fix C: se closedPnl=0 e closedValue=capital il dato è fittizio (fetch fallito al close).
    // exitCloseUsd rimane null (buyPriceMissing=true già imposto da Fix B).
    const exitCloseUsd = closeUsdFromValue(closedValueEur, shares, null);
    out.push({
      ticker: lr.ticker,
      completionDate: lr.completionDate,
      status: "closed",
      purchaseDate,
      buyPriceUsd: fmtNum(buyPriceUsd),
      shares: fmtNum(shares),
      day: exitDayKey,
      closePriceUsd: fmtNum(exitCloseUsd),
      cumulativePnlPct: fmtNum(closedPnlPct),
      rowKind: "exit",
      ...(buyPriceMissing ? { buyPriceMissing: true } : {}),
    });
  }

  return out;
}

/** Day-by-day audit rows for external gain reconciliation (open + closed). */
export function buildPortfolioGainAuditExport(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  /** When set, export only open portfolio rows. */
  portfolioOnly?: boolean;
}): PortfolioGainAuditExport {
  const { simTable, inputs, history = [], portfolioOnly = false } = opts;
  const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, history);
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const rows: PortfolioGainAuditRow[] = [];

  for (const lr of ledger.rows) {
    if (portfolioOnly && lr.archived) continue;
    rows.push(
      ...buildAuditRowsForLedgerRow({
        lr,
        simRow: rowByKey.get(lr.key),
        inputs,
        history: history ?? [],
      }),
    );
  }

  rows.sort((a, b) => {
    const ta = `${a.ticker}|${a.completionDate}|${a.day}|${a.rowKind}`;
    const tb = `${b.ticker}|${b.completionDate}|${b.day}|${b.rowKind}`;
    return ta.localeCompare(tb);
  });

  return {
    generatedAt: new Date().toISOString(),
    rows,
    incompleteDailyHistory: ledger.incompleteDailyHistory,
    legTotalDiffersFromMtm: ledger.legTotalDiffersFromMtm,
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

function auditHeaders(lang: "it" | "en"): string[] {
  if (lang === "it") {
    return [
      "Ticker",
      "CD",
      "Stato",
      "Data acquisto",
      "Prezzo acquisto ($)",
      "Azioni",
      "Giorno",
      "Tipo riga",
      "Prezzo chiusura ($)",
      "P&L cumul. (%)",
    ];
  }
  return [
    "Ticker",
    "CD",
    "Status",
    "Purchase date",
    "Buy price ($)",
    "Shares",
    "Day",
    "Row type",
    "Close price ($)",
    "Cumulative P&L (%)",
  ];
}

function legendRows(lang: "it" | "en", exp: PortfolioGainAuditExport): string[][] {
  const it = lang === "it";
  const lines: string[][] = [
    [it ? "SuperNova — audit gain portafoglio" : "SuperNova — portfolio gain audit"],
    [it ? "Generato" : "Generated", exp.generatedAt],
    [
      it ? "Formula azioni" : "Shares formula",
      it ? "azioni = capitale investito / prezzo acquisto ($)" : "shares = invested capital / buy price ($)",
    ],
    [
      it ? "P&L cumul. (%)" : "Cumulative P&L (%)",
      it
        ? "(prezzo chiusura − prezzo acquisto) / prezzo acquisto × 100"
        : "(close price − buy price) / buy price × 100",
    ],
  ];
  if (exp.incompleteDailyHistory) {
    lines.push([
      it ? "Avviso" : "Warning",
      it
        ? "Storico giornaliero incompleto per almeno una posizione — verificare le righe senza prezzo chiusura."
        : "Daily history incomplete for at least one position — check rows missing close price.",
    ]);
  }
  if (exp.legTotalDiffersFromMtm) {
    lines.push([
      it ? "Avviso" : "Warning",
      it
        ? "Oggi il P&L da Var.% può differire dal MTM live — usa valore posizione per la riconciliazione."
        : "Today P&L from daily % may differ from live MTM — use position value for reconciliation.",
    ]);
  }
  return lines;
}

/** Build Excel-compatible SpreadsheetML workbook (opens in Excel without extra libs). */
export function buildPortfolioGainAuditSpreadsheetXml(
  exp: PortfolioGainAuditExport,
  lang: "it" | "en" = "it",
): string {
  const headers = auditHeaders(lang);
  const headerRow = `<Row>${headers.map((h) => xmlCell(h, "String")).join("")}</Row>`;
  const dataRows = exp.rows
    .map((r) => {
      const statusLabel =
        r.status === "open"
          ? lang === "it"
            ? "aperta"
            : "open"
          : lang === "it"
            ? "chiusa"
            : "closed";
      const kindLabel =
        r.rowKind === "entry"
          ? lang === "it" ? "ingresso" : "entry"
          : r.rowKind === "exit"
            ? lang === "it" ? "uscita" : "exit"
            : lang === "it" ? "giorno" : "day";
      return `<Row>${[
        xmlCell(r.ticker, "String"),
        xmlCell(r.completionDate, "String"),
        xmlCell(statusLabel, "String"),
        xmlCell(r.purchaseDate, "String"),
        xmlCell(r.buyPriceUsd, "Number"),
        xmlCell(r.shares, "Number"),
        xmlCell(r.day, "String"),
        xmlCell(kindLabel, "String"),
        xmlCell(r.closePriceUsd, "Number"),
        xmlCell(r.cumulativePnlPct, "Number"),
      ].join("")}</Row>`;
    })
    .join("");

  const legend = legendRows(lang, exp)
    .map((cells) => {
      const padded = [...cells];
      while (padded.length < 2) padded.push("");
      return `<Row>${xmlCell(padded[0], "String")}${xmlCell(padded[1], "String")}</Row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${lang === "it" ? "Legenda" : "Legend"}">
<Table>${legend}</Table>
</Worksheet>
<Worksheet ss:Name="${lang === "it" ? "Movimenti" : "Movements"}">
<Table>${headerRow}${dataRows}</Table>
</Worksheet>
</Workbook>`;
}

export function downloadPortfolioGainAuditExcel(
  exp: PortfolioGainAuditExport,
  lang: "it" | "en" = "it",
): void {
  const xml = buildPortfolioGainAuditSpreadsheetXml(exp, lang);
  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `supernova-gain-audit_${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
