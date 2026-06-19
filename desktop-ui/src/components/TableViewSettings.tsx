import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TableDensity, TableFontSize, TableViewPrefs } from "../sheet/tableViewPrefs";
import { DEFAULT_TABLE_VIEW_PREFS, moveColumn } from "../sheet/tableViewPrefs";

export function TableViewSettings({
  sheetId,
  allColumns,
  prefs,
  onChange,
}: {
  sheetId: string;
  allColumns: string[];
  prefs: TableViewPrefs;
  onChange: (next: TableViewPrefs) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reposition panel after it mounts to keep it within the viewport.
  useEffect(() => {
    if (!open || !btnRef.current || !panelRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const panelW = Math.min(352, window.innerWidth * 0.92);
    const vw = window.innerWidth;
    let left = btn.left;
    if (left + panelW > vw - 8) left = Math.max(8, vw - panelW - 8);
    const style: CSSProperties = {
      position: "fixed",
      top: btn.bottom + 4,
      left,
      width: panelW,
      zIndex: 50,
    };
    Object.assign(panelRef.current.style, style);
  }, [open]);
  const hidden = useMemo(() => new Set(prefs.hiddenColumns), [prefs.hiddenColumns]);

  const ordered = useMemo(() => {
    const o: string[] = [];
    for (const c of prefs.columnOrder) {
      if (allColumns.includes(c) && !o.includes(c)) o.push(c);
    }
    for (const c of allColumns) {
      if (!o.includes(c)) o.push(c);
    }
    return o;
  }, [allColumns, prefs.columnOrder]);

  function toggleColumn(col: string) {
    const nextHidden = hidden.has(col)
      ? prefs.hiddenColumns.filter((c) => c !== col)
      : [...prefs.hiddenColumns, col];
    onChange({ ...prefs, hiddenColumns: nextHidden });
  }

  function shiftColumn(col: string, dir: -1 | 1) {
    const idx = ordered.indexOf(col);
    if (idx < 0) return;
    const swap = ordered[idx + dir];
    if (!swap) return;
    onChange({
      ...prefs,
      columnOrder: moveColumn(ordered, col, swap),
    });
  }

  function reset() {
    onChange({
      ...DEFAULT_TABLE_VIEW_PREFS,
      columnOrder: [...allColumns],
      tableFilter: prefs.tableFilter,
      toolbarFilters: prefs.toolbarFilters,
    });
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setOpen((v) => !v)}
        title="Colonne, ordine e dimensioni testo"
      >
        Layout tabella
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Chiudi pannello layout"
            onClick={() => setOpen(false)}
          />
          <div ref={panelRef} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-elevated))] shadow-xl p-4 space-y-4 max-h-[min(70vh,32rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Layout — {sheetId}</p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  Trascina le intestazioni in tabella o riordina qui. Le preferenze restano
                  salvate su questo dispositivo.
                </p>
              </div>
              <button type="button" className="btn-ghost text-xs px-2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">Dimensione testo</span>
                <select
                  className="input text-xs py-1.5"
                  value={prefs.fontSize}
                  onChange={(e) =>
                    onChange({ ...prefs, fontSize: e.target.value as TableFontSize })
                  }
                >
                  <option value="xs">Piccolo (10px)</option>
                  <option value="sm">Medio (14px)</option>
                  <option value="base">Grande (16px)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-ink-muted">Spaziatura celle</span>
                <select
                  className="input text-xs py-1.5"
                  value={prefs.density}
                  onChange={(e) =>
                    onChange({ ...prefs, density: e.target.value as TableDensity })
                  }
                >
                  <option value="compact">Compatta</option>
                  <option value="normal">Normale</option>
                  <option value="comfortable">Ampia</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink-muted">
                Larghezza max colonna: {prefs.maxColWidthRem} rem
              </span>
              <input
                type="range"
                min={6}
                max={24}
                step={1}
                value={prefs.maxColWidthRem}
                onChange={(e) =>
                  onChange({ ...prefs, maxColWidthRem: Number(e.target.value) })
                }
              />
            </label>

            <div>
              <p className="text-xs font-medium mb-2">Colonne ({ordered.length})</p>
              <ul className="space-y-1 max-h-48 overflow-y-auto border border-[rgb(var(--border))]/60 rounded-lg p-1">
                {ordered.map((col) => (
                  <li
                    key={col}
                    className="flex items-center gap-1 rounded-md hover:bg-surface/80 px-1 py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(col)}
                      onChange={() => toggleColumn(col)}
                      title="Mostra colonna"
                    />
                    <span
                      className="flex-1 truncate text-[11px] leading-tight"
                      title={col.replace(/\n/g, " ")}
                    >
                      {col.replace(/\n/g, " ")}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost px-1 py-0 text-[10px]"
                      disabled={ordered.indexOf(col) === 0}
                      onClick={() => shiftColumn(col, -1)}
                      title="Sposta a sinistra"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-1 py-0 text-[10px]"
                      disabled={ordered.indexOf(col) === ordered.length - 1}
                      onClick={() => shiftColumn(col, 1)}
                      title="Sposta a destra"
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={reset}>
                Ripristina default
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() =>
                  onChange({
                    ...prefs,
                    hiddenColumns: [],
                    columnOrder: [...allColumns],
                    columnWidths: {},
                  })
                }
              >
                Mostra tutte
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
