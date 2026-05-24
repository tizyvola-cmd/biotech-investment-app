import { useMemo } from "react";
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { loadInvestSimInputs } from "../sheet/investSimStorage";
import {
  enrichSimulationTable,
  SIM_PNL_NA_TOOLTIP,
} from "../sheet/simulationPosition";
import {
  buildSimulationStyleContext,
  fmtSimulationCell,
  formatSimulationColumnHeader,
  orderSimulationColumns,
  simulationCellStyle,
  simulationRowStyle,
} from "../sheet/simulationStyles";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { ConfigurableSheetGrid } from "./ConfigurableSheetGrid";

const CURVA_COLUMN = "__curva_pred__";

export function SimulationSheetGrid({
  table,
  loading,
  error,
  onReload,
  rowFilter,
  labChrome,
  inputs: inputsProp,
}: {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  rowFilter?: (row: Record<string, unknown>) => boolean;
  labChrome?: boolean;
  /** Input simulazione locale; se assente usa localStorage al caricamento tabella. */
  inputs?: InvestSimInputs;
}) {
  const fallbackInputs = useMemo(() => loadInvestSimInputs(), [table]);
  const resolvedInputs = inputsProp ?? fallbackInputs;

  const enrichedTable = useMemo(
    () => enrichSimulationTable(table, resolvedInputs),
    [table, resolvedInputs]
  );

  const tableWithCurva = useMemo((): SheetTable | null => {
    if (!enrichedTable) return null;
    if (enrichedTable.columns.includes(CURVA_COLUMN)) {
      return enrichedTable;
    }
    const tickerIdx = enrichedTable.columns.findIndex((c) => c === "Ticker");
    const cols = [...enrichedTable.columns];
    if (tickerIdx >= 0) {
      cols.splice(tickerIdx + 1, 0, CURVA_COLUMN);
    } else {
      cols.push(CURVA_COLUMN);
    }
    return { ...enrichedTable, columns: cols };
  }, [enrichedTable]);

  const filteredRows = enrichedTable?.rows ?? [];
  const styleCtx = useMemo(
    () => buildSimulationStyleContext(filteredRows),
    [filteredRows]
  );

  const initialColumnOrder = useMemo(
    () => orderSimulationColumns(tableWithCurva?.columns ?? []),
    [tableWithCurva?.columns]
  );

  return (
    <ConfigurableSheetGrid
      table={tableWithCurva}
      loading={loading}
      error={error}
      onReload={onReload}
      sheetId="Simulation"
      initialColumnOrder={initialColumnOrder}
      rowFilter={rowFilter}
      formatColumnHeader={(column) =>
        column === CURVA_COLUMN ? "Curva" : formatSimulationColumnHeader(column)
      }
      headerClassName="sticky top-0 z-10 bg-surface-elevated text-left text-ink-muted"
      headerCellClassName="font-medium border border-[rgb(var(--border))]/40"
      rowStyle={TABLE_COLORS_ENABLED ? simulationRowStyle : undefined}
      headerNote={undefined}
      renderCell={(column, raw, row) => {
        if (column === CURVA_COLUMN) {
          return {
            content: (
              <div className="flex justify-center py-0.5">
                <SimulationSparkline row={row} />
              </div>
            ),
            text: "—",
          };
        }
        if (labChrome && column === "Ticker") {
          return {
            content: (
              <span className="font-semibold">{fmtSimulationCell(column, raw)}</span>
            ),
            text: fmtSimulationCell(column, raw),
          };
        }
        if (labChrome && column === "Inferenza modello") {
          const v = String(raw ?? "");
          if (v) return { text: v };
        }
        const extras = TABLE_COLORS_ENABLED
          ? simulationCellStyle(column, raw, row, styleCtx)
          : undefined;
        const text = fmtSimulationCell(column, raw);
        const pnlMissing =
          row.__simPnlMissing === true &&
          (column === "P&L ($)" || column === "P&L (%)" || column === "Valore Attuale ($)");
        return {
          text,
          style: extras?.style,
          icon: extras?.icon,
          iconColor: extras?.iconColor,
          title: pnlMissing ? SIM_PNL_NA_TOOLTIP : text,
        };
      }}
    />
  );
}
