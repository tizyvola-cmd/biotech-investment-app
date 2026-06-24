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
import {
  SHEET_GRID_TABLE_CLASS,
  sheetGridAlignForColumn,
  sheetGridTdClassAlign,
  sheetGridThClassAlign,
} from "../sheet/sheetGridTable";

import { sheetCellPlainText } from "../sheet/cellLinks";
import { useLang } from "../shared/i18n";



export type SheetCellRenderResult = {

  text: string;

  /** If set, replaces the text in the cell (e.g. hyperlink from Excel). */

  content?: ReactNode;

  style?: CSSProperties;

  title?: string;

  icon?: string;

  iconColor?: string;

  iconOnly?: boolean;

  cellClassName?: string;

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

  hideToolbarReload = false,

  sheetId,

  headerNote,

  headerClassName = "sticky top-0 bg-surface-elevated text-left text-ink-muted",

  headerCellClassName = "font-medium border border-[rgb(var(--border))]/40",

  tableClassName = `${SHEET_GRID_TABLE_CLASS} whitespace-nowrap`,

  renderCell,

  formatColumnHeader,

  /** Extra class on `<th>` per column (e.g. Financial key metrics). */
  headerCellClassForColumn,

  initialColumnOrder,

  initialHiddenColumns,

  forcedHiddenColumns,

  toolbarExtra,

  filterPlaceholder = "Filter…",

  rowFilter,

  /** Subtle background for the row (e.g. Simulation portfolio P&L). */

  rowStyle,

  rowClassName,

  rowId,

  onClearToolbarFilters,

  zebraRows = false,

  /** Verdino chiaro — readable table in blue/dark theme (legacy sheets). */
  mintPresentation = false,

  /** Violet/indigo skin allineato a Catalyst Feed (Financial). */
  feedPresentation = false,

  /** Skip CF rules on these columns (Financial uses built-in Simulation-style cells). */
  skipConditionalFormatColumns,

  /** Override column width/min-width (e.g. Financial horizontal scroll). */
  columnWidthStyleFn,

}: {

  table: SheetTable | null;

  loading: boolean;

  error: string | null;

  onReload: () => void;

  hideToolbarReload?: boolean;

  sheetId: string;

  headerNote?: ReactNode;

  headerClassName?: string;

  headerCellClassName?: string;

  tableClassName?: string;

  renderCell?: SheetCellRenderer;

  /** Header label (default: newline → space). */

  formatColumnHeader?: (column: string) => string;

  headerCellClassForColumn?: (column: string) => string | undefined;

  /** Column order at first use (if no saved layout exists). */

  initialColumnOrder?: string[];

  /** Hidden columns at first use (if no saved layout exists). */
  initialHiddenColumns?: string[];
  /** Always hidden columns (applied even with saved layouts). */
  forcedHiddenColumns?: string[];

  toolbarExtra?: ReactNode;

  filterPlaceholder?: string;

  rowFilter?: (row: Record<string, unknown>) => boolean;

  rowStyle?: (row: Record<string, unknown>) => CSSProperties | undefined;

  /** Extra class names per data row (e.g. Financial portfolio stripe). */
  rowClassName?: (row: Record<string, unknown>, index: number) => string | undefined;

  /** Returns a string id placed as data-row-id on each <tr> for external scroll targeting. */
  rowId?: (row: Record<string, unknown>) => string | undefined;

  /** Called when the user clears filters from the empty state (e.g. ticker/sector on Financial). */
  onClearToolbarFilters?: () => void;

  /** Alternating row backgrounds for readability. */
  zebraRows?: boolean;

  mintPresentation?: boolean;

  feedPresentation?: boolean;

  skipConditionalFormatColumns?: ReadonlySet<string>;

  columnWidthStyleFn?: typeof columnWidthStyle;

}) {
  const { lang } = useLang();

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

  const resolveColWidth = columnWidthStyleFn ?? columnWidthStyle;
  const wideTableScroll = Boolean(columnWidthStyleFn);



  const allColumns = table?.columns ?? [];



  useEffect(() => {

    setCfPrefs(loadConditionalFormatPrefs(sheetId));

  }, [sheetId]);



  useEffect(() => {

    const loaded = loadTableViewPrefs(sheetId);

    setFilter(loaded.tableFilter);

    if (loaded.columnOrder.length === 0 && allColumns.length > 0) {
      const order = initialColumnOrder?.length
        ? initialColumnOrder.filter((c) => allColumns.includes(c))
        : [...allColumns];
      for (const c of allColumns) {
        if (!order.includes(c)) order.push(c);
      }
      const hidden = (initialHiddenColumns ?? []).filter((c) => allColumns.includes(c));
      const seeded = {
        ...loaded,
        columnOrder: order,
        hiddenColumns: hidden.length > 0 ? hidden : loaded.hiddenColumns,
      };
      setPrefs(seeded);
      saveTableViewPrefs(sheetId, seeded);
    } else {

      setPrefs(loaded);

    }

  }, [sheetId, initialColumnOrder, initialHiddenColumns, allColumns.join("\0")]);



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
    const hidden = new Set([...prefs.hiddenColumns, ...(forcedHiddenColumns ?? [])]);
    const order =
      sheetId === "Simulation"
        ? orderSimulationColumns(resolved.mergedPrefs.columnOrder)
        : resolved.mergedPrefs.columnOrder;
    if (
      order.join("\0") === resolved.mergedPrefs.columnOrder.join("\0") &&
      hidden.size === prefs.hiddenColumns.length
    ) {
      return resolved;
    }
    return {
      visibleColumns: order.filter((c) => !hidden.has(c)),
      mergedPrefs: {
        ...resolved.mergedPrefs,
        columnOrder: order,
        hiddenColumns: Array.from(hidden),
      },
    };
  }, [allColumns, prefs, sheetId, forcedHiddenColumns]);



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



  const sheetSkin = feedPresentation ? "feed" : mintPresentation ? "mint" : "default";
  const sectionCls =
    sheetSkin === "feed"
      ? "card sheet-feed-surface flex flex-col min-h-0 flex-1 overflow-hidden"
      : sheetSkin === "mint"
        ? "card sheet-mint-surface flex flex-col min-h-0 flex-1 overflow-hidden"
        : "card flex flex-col min-h-0 flex-1 overflow-hidden";
  const toolbarCls =
    sheetSkin === "feed"
      ? "sheet-feed-toolbar flex flex-wrap items-center gap-3 border-b px-4 py-3"
      : sheetSkin === "mint"
        ? "sheet-mint-toolbar flex flex-wrap items-center gap-3 border-b px-4 py-3"
        : "flex flex-wrap items-center gap-3 border-b border-[rgb(var(--border))] px-4 py-3";
  const scrollCls =
    sheetSkin === "feed"
      ? `sheet-feed-scroll overflow-x-auto${resizingCol ? " select-none cursor-col-resize" : ""}`
      : sheetSkin === "mint"
        ? `sheet-mint-scroll overflow-x-auto${resizingCol ? " select-none cursor-col-resize" : ""}`
        : `overflow-x-auto${resizingCol ? " select-none cursor-col-resize" : ""}`;
  const resolvedHeaderClass =
    sheetSkin === "feed"
      ? "sticky top-0 z-10 text-left sheet-feed-muted sheet-feed-thead"
      : sheetSkin === "mint"
        ? "sticky top-0 z-10 text-left sheet-mint-muted sheet-mint-thead"
        : headerClassName;
  const resolvedHeaderCellClass =
    sheetSkin === "feed"
      ? "font-semibold border sheet-feed-border sheet-feed-text"
      : sheetSkin === "mint"
        ? "font-semibold border sheet-mint-border sheet-mint-text"
        : headerCellClassName;
  const useZebra = zebraRows || sheetSkin !== "default";
  const sheetTextCls = sheetSkin === "feed" ? "sheet-feed-text" : sheetSkin === "mint" ? "sheet-mint-text" : "";
  const sheetMutedCls = sheetSkin === "feed" ? "sheet-feed-muted" : sheetSkin === "mint" ? "sheet-mint-muted" : "text-ink-muted";

  return (

    <section className={sectionCls}>

      <div className={toolbarCls}>

        <div>

          <h2 className={`text-lg font-semibold ${sheetTextCls}`}>{table?.sheet ?? sheetId}</h2>

          <span className={`text-xs block ${sheetMutedCls}`}>

            {loading ? "Loading…" : `${filteredRows.length} / ${total} rows`}

            {visibleColumns.length < allColumns.length &&

              ` · ${visibleColumns.length}/${allColumns.length} columns`}

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

        {!hideToolbarReload ? (
        <button type="button" className="btn-ghost text-xs" onClick={onReload}>

          Reload

        </button>
        ) : null}

      </div>



      {headerNote}



      {error && <p className="px-4 py-2 text-sm text-negative">{error}</p>}

      {loading && filteredRows.length === 0 ? (

        <p className="p-6 text-sm text-ink-muted text-center space-y-2 max-w-lg mx-auto">

          <span className="block font-medium text-ink">Loading data…</span>

          {table?.sheet === "Accuracy" && (

            <span className="block text-xs leading-relaxed">

              The Accuracy sheet is large: the first read can take ~30 seconds. As an

              alternative run <code className="text-[10px]">Export_Accuracy_Snapshot.bat</code>.

            </span>

          )}

        </p>

      ) : !loading && filteredRows.length === 0 ? (

        <div className="p-6 text-sm text-ink-muted text-center space-y-3 max-w-md mx-auto">

          {total > 0 ? (
            <>
              <p>
                {lang === "it" ? "Nessuna riga corrisponde ai filtri attivi" : "No rows match active filters"}{" "}
                <span className="tabular-nums font-medium text-ink">
                  (0 / {total})
                </span>
                .
              </p>
              <button
                type="button"
                className="seg-btn-outline text-xs"
                onClick={() => {
                  setFilter("");
                  debouncedSaveFilter("");
                  onClearToolbarFilters?.();
                }}
              >
                {lang === "it" ? "Cancella filtri" : "Clear filters"}
              </button>
            </>
          ) : (
            <p>No rows — run the orchestrator and close Excel.</p>
          )}

        </div>

      ) : visibleColumns.length === 0 ? (

        <p className="p-6 text-sm text-ink-muted text-center">

          No visible columns — open <strong>Table layout</strong> and select at least one

          column.

        </p>

      ) : (

        <div className={scrollCls}>

          <table className={`${tableClassName} ${fontCls}`}>

            <thead className={resolvedHeaderClass}>

              <tr>

                {visibleColumns.map((c) => {

                  const headerLabel = formatColumnHeader

                    ? formatColumnHeader(c)

                    : c.replace(/\n/g, " ");

                  const headerExtraClass = headerCellClassForColumn?.(c) ?? "";

                  const headerTitle = `${c.replace(/\n/g, " ")} — drag to reorder`;

                  const colStyle = resolveColWidth(c, prefs);

                  return (

                    <th

                      key={c}

                      draggable={!resizingCol}

                      onDragStart={() => setDragCol(c)}

                      onDragEnd={() => setDragCol(null)}

                      onDragOver={(e) => e.preventDefault()}

                      onDrop={() => onHeaderDrop(c)}

                      className={`relative ${sheetGridThClassAlign(sheetGridAlignForColumn(c))} ${dens.head} ${resolvedHeaderCellClass} ${headerExtraClass} cursor-grab active:cursor-grabbing select-none ${

                        formatColumnHeader ? "whitespace-nowrap" : "truncate"

                      }`}

                      style={colStyle}

                      title={headerTitle}

                    >

                      {headerLabel}

                      <span

                        role="separator"

                        aria-orientation="vertical"

                        aria-label={`Resize column ${headerLabel}`}

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
                const rowDataId = rowId?.(row);

                return (

                <tr

                  key={i}

                  className={`${
                    sheetSkin !== "default"
                      ? ""
                      : "border-t border-[rgb(var(--border))]/60 hover:bg-surface/80"
                  } ${
                    useZebra && sheetSkin === "default"
                      ? i % 2 === 0
                        ? "bg-[rgb(var(--surface))]"
                        : "bg-[rgb(var(--surface-3))]/12"
                      : ""
                  } ${rowClassName?.(row, i) ?? ""}`}

                  style={rowBg}

                  {...(rowDataId ? { "data-row-id": rowDataId } : {})}

                >

                  {visibleColumns.map((c) => {

                    const raw = row[c];

                    const base = renderCell
                      ? renderCell(c, raw, row)
                      : sharedTableCellRenderer(c, raw, row);

                    const cf = skipConditionalFormatColumns?.has(c)
                      ? null
                      : applyConditionalFormatToCell(c, raw, cfPrefs, cfStatsMap);

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

                        className={`${sheetGridTdClassAlign(sheetGridAlignForColumn(c))} ${dens.cell} ${wideTableScroll ? "" : "truncate"} ${base.cellClassName ?? ""} ${
                          sheetSkin !== "default" ? "" : "border border-[rgb(var(--border))]/30"
                        }`}

                        style={{

                          ...resolveColWidth(c, prefs),

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


