import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SheetTable } from "../types";
import { loadTableViewPrefs, saveTableViewPrefs } from "../sheet/tableViewPrefs";
import { ConfigurableSheetGrid, type SheetCellRenderer } from "./ConfigurableSheetGrid";
import { NewBioIpoModal } from "./NewBioIpoModal";
import { mergeYfIntoFinancialSnapshot } from "../api/supernova";
import { RefreshControls } from "./RefreshControls";
import { useT } from "../shared/i18n";
import { sharedTableCellRenderer } from "../sheet/sharedTableCellRenderer";
import {
  FIN_CF_SKIP_COLUMNS,
  buildFinancialStyleContext,
  financialHeaderCellClass,
  financialMetricCell,
  formatFinancialColumnHeader,
  orderFinancialColumns,
} from "../sheet/financialStyles";
import { getLang } from "../shared/i18n";
import { FINANCIAL_SHEET_TABLE_CLASS } from "../sheet/sheetGridTable";
import { financialColumnWidthStyle } from "../sheet/financialStyles";
import { FinancialIndicatorGuide } from "./FinancialIndicatorGuide";
import { isMedtechTicker } from "../sheet/medtechSymbols";
import { RealTimeSheetUpdater } from "./RealTimeSheetUpdater";
import { VirtualSheetGrid } from "./VirtualSheetGrid";

const FINANCIAL_SHEET_ID = "Financial";

function rowTicker(row: Record<string, unknown>): string {
  return String(row.symbol ?? row.ticker ?? "").trim().toUpperCase();
}

function getPortfolioTickers(simTable: SheetTable | null): Set<string> {
  const s = new Set<string>();
  for (const row of simTable?.rows ?? []) {
    const cap = Number(row["Capitale Investito ($)"] ?? 0);
    if (cap > 0) {
      const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (tk) s.add(tk);
    }
  }
  return s;
}

function getWatchTickers(simTable: SheetTable | null, portfolioTickers: Set<string>): Set<string> {
  const s = new Set<string>();
  for (const row of simTable?.rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    if (tk && !portfolioTickers.has(tk)) s.add(tk);
  }
  return s;
}

function rowPriority(tk: string, portfolio: Set<string>, watch: Set<string>): number {
  if (portfolio.has(tk)) return 0;
  if (watch.has(tk)) return 1;
  return 2;
}

function fmtMktCap(v: number | null): string {
  if (v == null || v <= 0) return "";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function SummaryStrip({
  portfolioCount,
  watchCount,
  totalCount,
  portfolioValue,
}: {
  portfolioCount: number;
  watchCount: number;
  totalCount: number;
  portfolioValue: number | null;
}) {
  return (
    <div className="sheet-feed-summary financial-summary-strip flex items-center gap-3 flex-wrap text-[11px] px-4 py-2 border-b">
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: "rgb(var(--signal-up))" }}
        />
        <span className="font-semibold text-[rgb(var(--signal-up))]">Portfolio</span>
        <span className="sheet-feed-text tabular-nums font-bold">{portfolioCount}</span>
        {portfolioValue != null && portfolioValue > 0 && (
          <span className="sheet-feed-muted">
            · {fmtMktCap(portfolioValue)} invested
          </span>
        )}
      </div>
      <span className="sheet-feed-muted opacity-50">|</span>
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-sm shrink-0"
          style={{ background: "rgb(var(--panel-feed-accent-strong))" }}
        />
        <span className="font-semibold text-[rgb(var(--panel-feed-accent-strong))]">Watchlist</span>
        <span className="sheet-feed-text tabular-nums font-bold">{watchCount}</span>
      </div>
      <span className="sheet-feed-muted opacity-50">|</span>
      <div className="flex items-center gap-1.5">
        <span className="sheet-feed-muted">{totalCount.toLocaleString()} companies total</span>
      </div>
    </div>
  );
}

export function FinancialSheetView({
  table,
  loading,
  error,
  onReload,
  simTable,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  simTable?: SheetTable | null;
}) {
  const lang = getLang();
  const it = lang === "it";
  const t = useT();
  const savedToolbar = loadTableViewPrefs(FINANCIAL_SHEET_ID).toolbarFilters;
  const [symbolFilter, setSymbolFilter] = useState(savedToolbar.symbol ?? "");
  const [sectorFilter, setSectorFilter] = useState(savedToolbar.sector ?? "");
  const [medtechOnly, setMedtechOnly] = useState(savedToolbar.medtechOnly === "1");
  const [ipoModalOpen, setIpoModalOpen] = useState(false);
  const [tableWithRealTime, setTableWithRealTime] = useState<SheetTable | null>(null);

  const persistToolbarFilters = useCallback(
    (symbol: string, sector: string, medtech: boolean) => {
      const prefs = loadTableViewPrefs(FINANCIAL_SHEET_ID);
      saveTableViewPrefs(FINANCIAL_SHEET_ID, {
        ...prefs,
        toolbarFilters: {
          symbol,
          sector,
          medtechOnly: medtech ? "1" : "",
        },
      });
    },
    [],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      persistToolbarFilters(symbolFilter, sectorFilter, medtechOnly);
    }, 400);
    return () => clearTimeout(t);
  }, [symbolFilter, sectorFilter, medtechOnly, persistToolbarFilters]);

  const portfolioTickers = useMemo(() => getPortfolioTickers(simTable ?? null), [simTable]);
  const watchTickers = useMemo(
    () => getWatchTickers(simTable ?? null, portfolioTickers),
    [simTable, portfolioTickers],
  );

  const portfolioInvested = useMemo(() => {
    let total = 0;
    for (const row of simTable?.rows ?? []) {
      const cap = Number(row["Capitale Investito ($)"] ?? 0);
      if (cap > 0) total += cap;
    }
    return total > 0 ? total : null;
  }, [simTable]);

  const sortedTable = useMemo((): SheetTable | null => {
    if (!table) return null;
    const rows = [...(table.rows ?? [])].sort((a, b) => {
      const pa = rowPriority(rowTicker(a), portfolioTickers, watchTickers);
      const pb = rowPriority(rowTicker(b), portfolioTickers, watchTickers);
      if (pa !== pb) return pa - pb;
      return rowTicker(a).localeCompare(rowTicker(b));
    });
    return { ...table, rows };
  }, [table, portfolioTickers, watchTickers]);

  const initialColumnOrder = useMemo(
    () => orderFinancialColumns(table?.columns ?? []),
    [table?.columns],
  );

  const simRowByTicker = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const row of simTable?.rows ?? []) {
      const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
      if (tk) map.set(tk, row);
    }
    return map;
  }, [simTable]);

  const medtechCount = useMemo(
    () => (table?.rows ?? []).filter((row) => isMedtechTicker(rowTicker(row))).length,
    [table],
  );

  const finStyleCtx = useMemo(
    () => ({
      ...buildFinancialStyleContext(sortedTable?.rows ?? []),
      portfolioTickers,
      watchTickers,
      simRowByTicker,
    }),
    [sortedTable?.rows, portfolioTickers, watchTickers, simRowByTicker],
  );

  const rowClassName = useCallback(
    (row: Record<string, unknown>): string | undefined => {
      const tk = rowTicker(row);
      if (portfolioTickers.has(tk)) return "fin-row-portfolio";
      if (watchTickers.has(tk)) return "fin-row-watch";
      return undefined;
    },
    [portfolioTickers, watchTickers],
  );

  const renderCell = useCallback<SheetCellRenderer>(
    (column, raw, row) => {
      const fin = financialMetricCell(column, raw, row, finStyleCtx, it ? "it" : "en");
      if (fin) {
        return {
          text: fin.text,
          content: fin.content,
          style: fin.style,
          title: fin.title,
          icon: fin.icon,
          iconColor: fin.iconColor,
          cellClassName: fin.cellClassName,
        };
      }
      return sharedTableCellRenderer(column, raw, row);
    },
    [finStyleCtx, it],
  );

  const rowFilter = useMemo(() => {
    const symQ = symbolFilter.trim().toUpperCase();
    const secQ = sectorFilter.trim().toLowerCase();
    if (!symQ && !secQ && !medtechOnly) return undefined;
    return (row: Record<string, unknown>) => {
      const sym = String(row.symbol ?? row.ticker ?? "").toUpperCase();
      const sec = String(row.sector ?? "").toLowerCase();
      if (symQ && !sym.includes(symQ)) return false;
      if (secQ && !sec.includes(secQ)) return false;
      if (medtechOnly && !isMedtechTicker(sym)) return false;
      return true;
    };
  }, [symbolFilter, sectorFilter, medtechOnly]);

  const totalCount = table?.rows?.length ?? 0;

  const headerNote = <FinancialIndicatorGuide it={it} /> as ReactNode;

  /** Dormant while SHEET_WS_REALTIME_ENABLED is false (FASE 1 Step 4). */
  const handleRealTimeUpdate = useCallback((updates: Map<number, Record<string, unknown>>) => {
    if (!sortedTable) return;
    const nextRows = [...sortedTable.rows];
    for (const [index, update] of updates) {
      if (index < nextRows.length) {
        nextRows[index] = { ...nextRows[index], ...update };
      }
    }
    setTableWithRealTime({ ...sortedTable, rows: nextRows });
  }, [sortedTable]);

  const realTimeColumns = useMemo(() => [
    "currentPrice",
    "Prezzo Corrente ($)",
    "dailyChange_%",
    "Var. Giorn. %",
  ], []);

  // Use virtual scrolling for large datasets (>500 rows)
  const useVirtualScroll = (sortedTable?.rows?.length ?? 0) > 500;

  // Use real-time updated table if available, otherwise use sorted table
  const displayTable = tableWithRealTime || sortedTable;

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex items-center justify-end gap-2 mb-2 shrink-0">
        <RefreshControls
          onLocalReload={onReload}
          localLoading={loading}
          reloadTooltip={t("refresh.page.financial.tooltip")}
          extraInfo={totalCount ? `${totalCount} rows` : undefined}
        />
      </div>
      {!loading && (portfolioTickers.size > 0 || watchTickers.size > 0) && (
        <SummaryStrip
          portfolioCount={portfolioTickers.size}
          watchCount={watchTickers.size}
          totalCount={totalCount}
          portfolioValue={portfolioInvested}
        />
      )}

      {useVirtualScroll ? (
        <VirtualSheetGrid
          table={displayTable}
          loading={loading}
          error={error}
          onReload={onReload}
          sheetId={FINANCIAL_SHEET_ID}
          rowHeight={36}
          visibleRowCount={25}
          bufferRowCount={5}
          renderRow={(row, _index) => {
            const cell = renderCell("", row, row);
            return (
              <div className="flex items-center border-b border-[rgb(var(--border))]/20 px-4 py-2 text-[11px]">
                <div className="flex-1">{cell.content || cell.text}</div>
              </div>
            );
          }}
          renderHeader={() => (
            <div className="flex items-center bg-slate-100 px-4 py-2 text-[11px] font-semibold border-b">
              <div className="flex-1">Financial Data (Virtual Scroll)</div>
            </div>
          )}
          className="h-[600px]"
        />
      ) : (
        <ConfigurableSheetGrid
          table={displayTable}
          loading={loading}
          error={error}
          onReload={onReload}
          hideToolbarReload
          sheetId={FINANCIAL_SHEET_ID}
          feedPresentation
          skipConditionalFormatColumns={FIN_CF_SKIP_COLUMNS}
          tableClassName={FINANCIAL_SHEET_TABLE_CLASS}
          columnWidthStyleFn={financialColumnWidthStyle}
          headerNote={headerNote}
          formatColumnHeader={formatFinancialColumnHeader}
          headerCellClassForColumn={financialHeaderCellClass}
          initialColumnOrder={initialColumnOrder}
          rowFilter={rowFilter}
          rowClassName={rowClassName}
          rowId={(row) => rowTicker(row) || undefined}
          renderCell={renderCell}
          onClearToolbarFilters={() => {
            setSymbolFilter("");
            setSectorFilter("");
            setMedtechOnly(false);
          }}
          filterPlaceholder={it ? "Filtra testo…" : "Filter text…"}
          toolbarExtra={
            <>
              <input
                className="input max-w-[8rem]"
                placeholder={it ? "Ticker…" : "Ticker…"}
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                aria-label="Filter by ticker"
              />
              <input
                className="input max-w-[10rem]"
                placeholder={it ? "Settore…" : "Sector…"}
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                aria-label="Filter by sector"
              />
              <button
                type="button"
                className={medtechOnly ? "chip-btn-active" : "chip-btn"}
                onClick={() => setMedtechOnly((v) => !v)}
                title={
                  it
                    ? "Mostra solo ticker MedTech (monitor ECG)"
                    : "Show MedTech tickers only (ECG monitor icon)"
                }
                aria-pressed={medtechOnly}
              >
                {it ? "Solo MedTech" : "MedTech only"}
                {medtechCount > 0 ? (
                  <span className="tabular-nums opacity-80"> · {medtechCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs flex items-center gap-1"
                onClick={() => setIpoModalOpen(true)}
                title={
                  it
                    ? "Scansiona nuove IPO biotech e uniscile all'universo"
                    : "Scan new biotech IPO and merge into the universe"
                }
              >
                <span aria-hidden>🧬</span> New Bio IPO
              </button>
            </>
          }
        />
      )}
      <NewBioIpoModal
        open={ipoModalOpen}
        onClose={() => setIpoModalOpen(false)}
        onCompleted={async () => {
          try {
            await mergeYfIntoFinancialSnapshot();
          } catch {
            /* reload anyway */
          }
          onReload();
        }}
      />
      {/* No-op until SHEET_WS_REALTIME_ENABLED — see RealTimeSheetUpdater FASE 1 Step 4 note. */}
      <RealTimeSheetUpdater
        realTimeColumns={realTimeColumns}
        tableData={displayTable?.rows ?? []}
        onUpdate={handleRealTimeUpdate}
      />
    </div>
  );
}
