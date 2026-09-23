import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SheetTable } from "../types";

interface VirtualSheetGridProps {
  table: SheetTable | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  sheetId: string;
  rowHeight: number;
  visibleRowCount: number;
  bufferRowCount?: number;
  renderRow: (row: Record<string, unknown>, index: number) => ReactNode;
  renderHeader: () => ReactNode;
  className?: string;
}

export function VirtualSheetGrid({
  table,
  loading,
  error,
  onReload,
  sheetId,
  rowHeight = 40,
  visibleRowCount = 20,
  bufferRowCount = 5,
  renderRow,
  renderHeader,
  className = "",
}: VirtualSheetGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(visibleRowCount * rowHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = table?.rows ?? [];

  // Calcola range di righe visibili
  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRowCount);
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + containerHeight) / rowHeight) + bufferRowCount
    );
    return { startIndex: start, endIndex: end };
  }, [scrollTop, containerHeight, rowHeight, rows.length, bufferRowCount]);

  // Righe visibili
  const visibleRows = useMemo(() => {
    return rows.slice(startIndex, endIndex);
  }, [rows, startIndex, endIndex]);

  // Aggiorna altezza container
  useEffect(() => {
    if (containerRef.current) {
      setContainerHeight(containerRef.current.clientHeight);
    }
  }, []);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-ink-muted">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <div className="text-rose-600">{error}</div>
        <button
          onClick={onReload}
          className="px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!table || rows.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-ink-muted">
        No data available
      </div>
    );
  }

  return (
    <div className={`virtual-sheet-grid ${className}`}>
      {/* Header fisso */}
      <div className="sticky top-0 z-10 bg-surface-elevated">
        {renderHeader()}
      </div>

      {/* Container scrollabile */}
      <div
        ref={containerRef}
        className="overflow-auto"
        style={{ height: `${visibleRowCount * rowHeight}px` }}
        onScroll={handleScroll}
      >
        {/* Spacer per offset iniziale */}
        <div style={{ height: `${startIndex * rowHeight}px` }} />

        {/* Righe visibili */}
        {visibleRows.map((row, i) => (
          <div
            key={`${sheetId}-${startIndex + i}`}
            style={{ height: `${rowHeight}px` }}
            data-row-index={startIndex + i}
          >
            {renderRow(row, startIndex + i)}
          </div>
        ))}

        {/* Spacer per finale */}
        <div style={{ height: `${(rows.length - endIndex) * rowHeight}px` }} />
      </div>

      {/* Info debug */}
      <div className="text-[10px] text-ink-muted px-2 py-1 border-t">
        Showing {visibleRows.length} of {rows.length} rows (index { startIndex }-{ endIndex - 1 })
      </div>
    </div>
  );
}
