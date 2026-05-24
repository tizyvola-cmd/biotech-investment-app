import {

  useCallback,

  useEffect,

  useMemo,

  useRef,

  useState,

  type CSSProperties,

  type ReactNode,

} from "react";

import type { SheetTable } from "../types";

import {

  columnWidthStyle,

  densityClasses,

  fontSizeClass,

  loadTableViewPrefs,

  moveColumn,

  resolveTableColumns,

  saveTableViewPrefs,

  type TableViewPrefs,

} from "../sheet/tableViewPrefs";

import { ConditionalFormatSettings } from "./ConditionalFormatSettings";

import { TableViewSettings } from "./TableViewSettings";

import {

  applyConditionalFormatToCell,

  buildStatsMap,

  mergeCellStyles,

} from "../sheet/applyConditionalFormat";

import {

  loadConditionalFormatPrefs,

  type ConditionalFormatPrefs,

} from "../sheet/conditionalFormat";

import { orderSimulationColumns } from "../sheet/simulationStyles";
import { sharedTableCellRenderer } from "../sheet/sharedTableCellRenderer";

import { sheetCellPlainText } from "../sheet/cellLinks";



export type SheetCellRenderResult = {

  text: string;

  /** Se impostato, sostituisce il testo nella cella (es. hyperlink da Excel). */

  content?: ReactNode;

  style?: CSSProperties;

  title?: string;

  icon?: string;

  iconColor?: string;

  iconOnly?: boolean;

};



export type SheetCellRenderer = (

  column: string,

  raw: unknown,

  row: Record<string, unknown>

) => SheetCellRenderResult;



function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delayMs: number) {

  const fnRef = useRef(fn);

  fnRef.current = fn;

  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const debounced = useCallback(

    (...args: Parameters<T>) => {

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);

    },

    [delayMs]

  );

  useEffect(

    () => () => {

      if (timerRef.current) clearTimeout(timerRef.current);

    },

    []

  );

  return debounced;

}



export function ConfigurableSheetGrid({

  table,

  loading,

  error,

  onReload,

  sheetId,

  headerNote,

  headerClassName = "sticky top-0 bg-surface-elevated text-left text-ink-muted",

  headerCellClassName = "font-medium border border-[rgb(var(--border))]/40",

  tableClassName = "w-full whitespace-nowrap border-collapse",

  renderCell,

  formatColumnHeader,

  initialColumnOrder,

  toolbarExtra,

  filterPlaceholder = "Filtra…",

  rowFilter,

  /** Sfondo tenue per riga (es. P&L portafoglio Simulation). */

  rowStyle,

}: {

  table: SheetTable | null;

  loading: boolean;

  error: string | null;

  onReload: () => void;

  sheetId: string;

  headerNote?: ReactNode;

  headerClassName?: string;

  headerCellClassName?: string;

  tableClassName?: string;

  renderCell?: SheetCellRenderer;

  /** Etichetta header (default: newline → spazio). */

  formatColumnHeader?: (column: string) => string;

  /** Ordine colonne al primo utilizzo (se non c'è layout salvato). */

  initialColumnOrder?: string[];

  toolbarExtra?: ReactNode;

  filterPlaceholder?: string;

  rowFilter?: (row: Record<string, unknown>) => boolean;

  rowStyle?: (row: Record<string, unknown>) => CSSProperties | undefined;

}) {

  const [filter, setFilter] = useState(() => loadTableViewPrefs(sheetId).tableFilter);

  const [prefs, setPrefs] = useState<TableViewPrefs>(() => loadTableViewPrefs(sheetId));

  const [cfPrefs, setCfPrefs] = useState<ConditionalFormatPrefs>(() =>

    loadConditionalFormatPrefs(sheetId)

  );

  const [dragCol, setDragCol] = useState<string | null>(null);

  const [resizingCol, setResizingCol] = useState<string | null>(null);

  const resizeStartRef = useRef<{ col: string; startX: number; startRem: number } | null>(null);

  const prefsRef = useRef(prefs);

  prefsRef.current = prefs;



  const allColumns = table?.columns ?? [];



  useEffect(() => {

    setCfPrefs(loadConditionalFormatPrefs(sheetId));

  }, [sheetId]);



  useEffect(() => {

    const loaded = loadTableViewPrefs(sheetId);

    setFilter(loaded.tableFilter);

    if (

      initialColumnOrder?.length &&

      loaded.columnOrder.length === 0 &&

      allColumns.length > 0

    ) {

      const order = initialColumnOrder.filter((c) => allColumns.includes(c));

      for (const c of allColumns) {

        if (!order.includes(c)) order.push(c);

      }

      const seeded = { ...loaded, columnOrder: order };

      setPrefs(seeded);

      saveTableViewPrefs(sheetId, seeded);

    } else {

      setPrefs(loaded);

    }

  }, [sheetId, initialColumnOrder, allColumns.join("\0")]);



  useEffect(() => {

    if (!allColumns.length) return;

    setPrefs((prev) => {

      const { mergedPrefs } = resolveTableColumns(allColumns, prev);

      if (mergedPrefs.columnOrder.join("\0") !== prev.columnOrder.join("\0")) {

        saveTableViewPrefs(sheetId, mergedPrefs);

      }

      return mergedPrefs;

    });

  }, [allColumns.join("\0"), sheetId]);



  const persistPrefs = useCallback(

    (next: TableViewPrefs) => {

      const normalized = { ...next, tableFilter: filter };

      setPrefs(normalized);

      saveTableViewPrefs(sheetId, normalized);

    },

    [sheetId, filter]

  );



  const debouncedSaveWidths = useDebouncedCallback((columnWidths: Record<string, number>) => {

    const next = { ...prefsRef.current, columnWidths };

    setPrefs(next);

    saveTableViewPrefs(sheetId, next);

  }, 300);



  const debouncedSaveFilter = useDebouncedCallback((tableFilter: string) => {

    const next = { ...prefsRef.current, tableFilter };

    setPrefs(next);

    saveTableViewPrefs(sheetId, next);

  }, 400);



  const onFilterChange = useCallback(

    (value: string) => {

      setFilter(value);

      debouncedSaveFilter(value);

    },

    [debouncedSaveFilter]

  );



  const { visibleColumns } = useMemo(() => {
    const resolved = resolveTableColumns(allColumns, prefs);
    if (sheetId !== "Simulation") return resolved;
    const order = orderSimulationColumns(resolved.mergedPrefs.columnOrder);
    if (order.join("\0") === resolved.mergedPrefs.columnOrder.join("\0")) return resolved;
    const hidden = new Set(prefs.hiddenColumns);
    return {
      visibleColumns: order.filter((c) => !hidden.has(c)),
      mergedPrefs: { ...resolved.mergedPrefs, columnOrder: order },
    };
  }, [allColumns, prefs, sheetId]);



  const filteredRows = useMemo(() => {

    const rows = table?.rows ?? [];

    let out = rows;

    if (rowFilter) out = out.filter(rowFilter);

    const q = filter.trim().toUpperCase();

    if (!q) return out;

    return out.filter((row) =>

      Object.values(row).some((v) => sheetCellPlainText(v).toUpperCase().includes(q))

    );

  }, [table, filter, rowFilter]);



  const cfStatsMap = useMemo(

    () => buildStatsMap(filteredRows, visibleColumns, cfPrefs.rules),

    [filteredRows, visibleColumns, cfPrefs.rules]

  );



  const total = table?.row_count ?? table?.rows.length ?? 0;

  const dens = densityClasses(prefs.density);

  const fontCls = fontSizeClass(prefs.fontSize);



  function onHeaderDrop(targetCol: string) {

    if (!dragCol || dragCol === targetCol) return;

    const { mergedPrefs } = resolveTableColumns(allColumns, prefs);

    persistPrefs({

      ...mergedPrefs,

      columnOrder: moveColumn(mergedPrefs.columnOrder, dragCol, targetCol),

    });

    setDragCol(null);

  }



  function startColumnResize(col: string, clientX: number) {

    const current =

      prefs.columnWidths[col] ?? prefs.maxColWidthRem;

    resizeStartRef.current = { col, startX: clientX, startRem: current };

    setResizingCol(col);

  }



  useEffect(() => {

    if (!resizingCol) return;

    const onMove = (e: MouseEvent) => {

      const start = resizeStartRef.current;

      if (!start) return;

      const deltaPx = e.clientX - start.startX;

      const deltaRem = deltaPx / 16;

      const nextRem = Math.min(48, Math.max(4, Math.round((start.startRem + deltaRem) * 4) / 4));

      const columnWidths = { ...prefsRef.current.columnWidths, [start.col]: nextRem };

      setPrefs((prev) => ({ ...prev, columnWidths }));

      debouncedSaveWidths(columnWidths);

    };

    const onUp = () => {

      resizeStartRef.current = null;

      setResizingCol(null);

    };

    document.addEventListener("mousemove", onMove);

    document.addEventListener("mouseup", onUp);

    return () => {

      document.removeEventListener("mousemove", onMove);

      document.removeEventListener("mouseup", onUp);

    };

  }, [resizingCol, debouncedSaveWidths]);



  return (

    <section className="card flex flex-col min-h-0 flex-1 overflow-hidden">

      <div className="flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3">

        <div>

          <h2 className="text-lg font-semibold">{table?.sheet ?? sheetId}</h2>

          <span className="text-xs text-ink-muted block">

            {loading ? "Caricamento…" : `${filteredRows.length} / ${total} righe`}

            {visibleColumns.length < allColumns.length &&

              ` · ${visibleColumns.length}/${allColumns.length} colonne`}

          </span>

        </div>

        {toolbarExtra}

        <input

          className={`input max-w-xs ${toolbarExtra ? "" : "ml-auto"}`}

          placeholder={filterPlaceholder}

          value={filter}

          onChange={(e) => onFilterChange(e.target.value)}

        />

        <ConditionalFormatSettings

          sheetId={sheetId}

          allColumns={allColumns}

          onChange={setCfPrefs}

        />

        <TableViewSettings

          sheetId={sheetId}

          allColumns={allColumns}

          prefs={prefs}

          onChange={persistPrefs}

        />

        <button type="button" className="btn-ghost text-xs" onClick={onReload}>

          Ricarica

        </button>

      </div>



      {headerNote}



      {error && <p className="px-4 py-2 text-sm text-negative">{error}</p>}

      {loading && filteredRows.length === 0 ? (

        <p className="p-6 text-sm text-ink-muted text-center space-y-2 max-w-lg mx-auto">

          <span className="block font-medium text-ink">Caricamento dati…</span>

          {table?.sheet === "Accuracy" && (

            <span className="block text-xs leading-relaxed">

              Il foglio Accuracy è grande: la prima lettura può richiedere ~30 secondi. In

              alternativa esegui <code className="text-[10px]">Export_Accuracy_Snapshot.bat</code>.

            </span>

          )}

        </p>

      ) : !loading && filteredRows.length === 0 ? (

        <p className="p-6 text-sm text-ink-muted text-center">

          Nessuna riga — eseguire l&apos;orchestrator e chiudere Excel.

        </p>

      ) : visibleColumns.length === 0 ? (

        <p className="p-6 text-sm text-ink-muted text-center">

          Nessuna colonna visibile — apri <strong>Layout tabella</strong> e seleziona almeno una

          colonna.

        </p>

      ) : (

        <div className={`overflow-auto flex-1 ${resizingCol ? "select-none cursor-col-resize" : ""}`}>

          <table className={`${tableClassName} ${fontCls}`}>

            <thead className={headerClassName}>

              <tr>

                {visibleColumns.map((c) => {

                  const headerLabel = formatColumnHeader

                    ? formatColumnHeader(c)

                    : c.replace(/\n/g, " ");

                  const headerTitle = `${c.replace(/\n/g, " ")} — trascina per riordinare`;

                  const colStyle = columnWidthStyle(c, prefs);

                  return (

                    <th

                      key={c}

                      draggable={!resizingCol}

                      onDragStart={() => setDragCol(c)}

                      onDragEnd={() => setDragCol(null)}

                      onDragOver={(e) => e.preventDefault()}

                      onDrop={() => onHeaderDrop(c)}

                      className={`relative ${dens.head} ${headerCellClassName} cursor-grab active:cursor-grabbing select-none ${

                        formatColumnHeader ? "whitespace-nowrap" : "truncate"

                      }`}

                      style={colStyle}

                      title={headerTitle}

                    >

                      {headerLabel}

                      <span

                        role="separator"

                        aria-orientation="vertical"

                        aria-label={`Ridimensiona colonna ${headerLabel}`}

                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/40"

                        onMouseDown={(e) => {

                          e.preventDefault();

                          e.stopPropagation();

                          startColumnResize(c, e.clientX);

                        }}

                      />

                    </th>

                  );

                })}

              </tr>

            </thead>

            <tbody>

              {filteredRows.map((row, i) => {

                const rowBg = rowStyle?.(row);

                return (

                <tr

                  key={i}

                  className="border-t border-[rgb(var(--border))]/60 hover:bg-surface/80"

                  style={rowBg}

                >

                  {visibleColumns.map((c) => {

                    const raw = row[c];

                    const base = renderCell
                      ? renderCell(c, raw, row)
                      : sharedTableCellRenderer(c, raw, row);

                    const cf = applyConditionalFormatToCell(c, raw, cfPrefs, cfStatsMap);

                    const style = mergeCellStyles(

                      base.style,

                      cf,

                      cfPrefs.overrideBuiltInBackground

                    );

                    const displayIcon = cf?.icon ?? base.icon;

                    const displayIconColor = cf?.iconColor ?? base.iconColor;

                    const showText = cf?.iconOnly ? "" : base.text;

                    return (

                      <td

                        key={c}

                        className={`${dens.cell} truncate border border-[rgb(var(--border))]/30`}

                        style={{

                          ...columnWidthStyle(c, prefs),

                          ...style,

                        }}

                        title={base.title ?? base.text}

                      >

                        {displayIcon && (

                          <span

                            className="mr-0.5 inline-block font-semibold"

                            style={{ color: displayIconColor }}

                            aria-hidden

                          >

                            {displayIcon}

                          </span>

                        )}

                        {base.content ?? showText}

                      </td>

                    );

                  })}

                </tr>

              );})}

            </tbody>

          </table>

        </div>

      )}

    </section>

  );

}


