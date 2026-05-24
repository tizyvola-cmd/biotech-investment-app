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
      title="SEC Form 8-K — portafoglio Simulation"
      sourceHint={
        <>
          filing 8-K dal foglio{" "}
          <code className="text-accent">SEC K-8</code> nel workbook orchestrato
        </>
      }
      countLabel="filing"
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
