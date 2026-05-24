import { useCallback, useEffect, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import { loadTableViewPrefs, saveTableViewPrefs } from "../sheet/tableViewPrefs";
import { ConfigurableSheetGrid } from "./ConfigurableSheetGrid";

const FINANCIAL_SHEET_ID = "Financial";

const KEY_COLUMNS = [
  "symbol",
  "companyName",
  "sector",
  "industry",
  "marketCap",
  "liquidita_fy",
  "beta",
  "currentPrice",
  "last_close",
  "variation_6m_%_variations",
  "variation_3m_%_variations",
  "variation_1m_%_variations",
  "dailyChange_%",
  "variation_9m_%_variations",
];

function orderColumns(columns: string[]): string[] {
  const keys = KEY_COLUMNS.filter((c) => columns.includes(c));
  const rest = columns.filter((c) => !keys.includes(c));
  return [...keys, ...rest];
}

export function FinancialSheetView({
  table,
  loading,
  error,
  onReload,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const savedToolbar = loadTableViewPrefs(FINANCIAL_SHEET_ID).toolbarFilters;
  const [symbolFilter, setSymbolFilter] = useState(savedToolbar.symbol ?? "");
  const [sectorFilter, setSectorFilter] = useState(savedToolbar.sector ?? "");

  const persistToolbarFilters = useCallback((symbol: string, sector: string) => {
    const prefs = loadTableViewPrefs(FINANCIAL_SHEET_ID);
    saveTableViewPrefs(FINANCIAL_SHEET_ID, {
      ...prefs,
      toolbarFilters: { symbol, sector },
    });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      persistToolbarFilters(symbolFilter, sectorFilter);
    }, 400);
    return () => clearTimeout(t);
  }, [symbolFilter, sectorFilter, persistToolbarFilters]);

  const initialColumnOrder = useMemo(
    () => orderColumns(table?.columns ?? []),
    [table?.columns]
  );

  const rowFilter = useMemo(() => {
    const symQ = symbolFilter.trim().toUpperCase();
    const secQ = sectorFilter.trim().toLowerCase();
    if (!symQ && !secQ) return undefined;
    return (row: Record<string, unknown>) => {
      const sym = String(row.symbol ?? row.ticker ?? "").toUpperCase();
      const sec = String(row.sector ?? "").toLowerCase();
      if (symQ && !sym.includes(symQ)) return false;
      if (secQ && !sec.includes(secQ)) return false;
      return true;
    };
  }, [symbolFilter, sectorFilter]);

  return (
    <ConfigurableSheetGrid
      table={table}
      loading={loading}
      error={error}
      onReload={onReload}
      sheetId={FINANCIAL_SHEET_ID}
      initialColumnOrder={initialColumnOrder}
      rowFilter={rowFilter}
      filterPlaceholder="Filtra testo…"
      toolbarExtra={
        <>
          <input
            className="input max-w-[8rem]"
            placeholder="Ticker…"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            aria-label="Filtra per ticker"
          />
          <input
            className="input max-w-[10rem]"
            placeholder="Settore…"
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            aria-label="Filtra per settore"
          />
        </>
      }
    />
  );
}

