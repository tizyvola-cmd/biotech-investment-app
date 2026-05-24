import type { SheetCellRenderer } from "./ConfigurableSheetGrid";
import type { SheetTable } from "../types";
import { ConfigurableSheetGrid } from "./ConfigurableSheetGrid";

export function SheetDataGrid({
  table,
  loading,
  error,
  onReload,
  sheetId: sheetIdOverride,
  renderCell,
  formatColumnHeader,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Chiave layout stabile (prima che `table` sia caricato). */
  sheetId?: string;
  renderCell?: SheetCellRenderer;
  formatColumnHeader?: (column: string) => string;
}) {
  const sheetId = sheetIdOverride ?? table?.sheet ?? "sheet";

  return (
    <ConfigurableSheetGrid
      table={table}
      loading={loading}
      error={error}
      onReload={onReload}
      sheetId={sheetId}
      renderCell={renderCell}
      formatColumnHeader={formatColumnHeader}
    />
  );
}
