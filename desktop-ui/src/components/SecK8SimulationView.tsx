import type { SheetTable } from "../types";
import { formatSecK8ColumnHeader, secK8SheetCellRenderer } from "../sheet/secK8CellRender";
import { SimulationPortfolioSheetView } from "./SimulationPortfolioSheetView";

export function SecK8SimulationView({
  simTable,
  secK8Table,
  loading,
  error,
  onReload,
  initialTicker,
  onInitialTickerConsumed,
}: {
  simTable: SheetTable | null;
  secK8Table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  initialTicker?: string | null;
  onInitialTickerConsumed?: () => void;
}) {
  return (
    <SimulationPortfolioSheetView
      title="SEC Form 8-K — Simulation portfolio"
      sourceHint={
        <>
          8-K filings from the{" "}
          <code className="text-accent">SEC 8-K</code> sheet in the orchestrated workbook
        </>
      }
      countLabel="filings"
      simTable={simTable}
      dataTable={secK8Table}
      loading={loading}
      error={error}
      onReload={onReload}
      layoutSheetId="SEC K-8"
      renderCell={secK8SheetCellRenderer}
      formatColumnHeader={formatSecK8ColumnHeader}
      initialSelectedTicker={initialTicker}
      onInitialSelectionConsumed={onInitialTickerConsumed}
    />
  );
}
