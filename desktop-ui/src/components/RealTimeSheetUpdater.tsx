import { useEffect, useRef } from "react";
import { useVisibleRows } from "../hooks/useVisibleRows";
import { useWebSocket } from "../hooks/useWebSocket";

/**
 * FASE 1 — Step 4 decision (explicit): sheet WebSocket quote path is OFF.
 *
 * Why not "finish wiring" registerRow / getRowProps as-is:
 * - Backend `/ws/quotes` only echoes client messages; it does not push `quote_update`.
 * - Parents (Top KPI, Financial sheet) never call `registerRow`, so visibleIndices stays empty.
 * - `onUpdate` clones row arrays by index — incompatible with Step 1 per-ticker isolation.
 *
 * Re-enable only after all of:
 * 1) real server-side quote_update feed,
 * 2) granular keyed store for price/pnl (same pattern as kpiLiveStores / deskLiveStores),
 * 3) visible-row registerRow wired on the virtualized tbody.
 */
export const SHEET_WS_REALTIME_ENABLED = false;

interface RealTimeSheetUpdaterProps {
  /** Columns to update in real-time */
  realTimeColumns: string[];
  /** Current table data */
  tableData: Record<string, unknown>[];
  /** Callback to update table data */
  onUpdate: (updates: Map<number, Record<string, unknown>>) => void;
  /** Intersection observer options */
  observerOptions?: Parameters<typeof useVisibleRows>[0];
}

/**
 * Logic-only component. When {@link SHEET_WS_REALTIME_ENABLED} is false, renders nothing
 * and does not open a WebSocket (no half-wired "almost live" path).
 */
export function RealTimeSheetUpdater(props: RealTimeSheetUpdaterProps) {
  if (!SHEET_WS_REALTIME_ENABLED) {
    return null;
  }
  return <RealTimeSheetUpdaterActive {...props} />;
}

function RealTimeSheetUpdaterActive({
  realTimeColumns,
  tableData,
  onUpdate,
  observerOptions,
}: RealTimeSheetUpdaterProps) {
  const { visibleIndices, registerRow, unregisterRow } = useVisibleRows(observerOptions);
  const { subscribe, lastMessage, status } = useWebSocket();
  const subscribedTickersRef = useRef<Set<string>>(new Set());
  const tableDataRef = useRef(tableData);
  tableDataRef.current = tableData;

  // Subscribe to visible tickers via WebSocket
  useEffect(() => {
    if (visibleIndices.size === 0 || realTimeColumns.length === 0 || status !== "connected") {
      return;
    }

    const visibleTickers = new Set<string>();

    for (const index of visibleIndices) {
      const row = tableData[index];
      if (!row) continue;

      const ticker = String(row.symbol ?? row.ticker ?? row.Ticker ?? "").trim().toUpperCase();
      if (ticker) {
        visibleTickers.add(ticker);
      }
    }

    if (visibleTickers.size === 0) {
      return;
    }

    const tickersToSubscribe = Array.from(visibleTickers).filter(
      (t) => !subscribedTickersRef.current.has(t),
    );

    if (tickersToSubscribe.length > 0) {
      tickersToSubscribe.forEach((t) => subscribedTickersRef.current.add(t));
      subscribe(tickersToSubscribe);
    }
  }, [visibleIndices, tableData, realTimeColumns, status, subscribe]);

  // Apply each quote_update once — do not re-fire when tableData identity churns.
  const appliedMessageRef = useRef<unknown>(null);
  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "quote_update") {
      return;
    }
    if (appliedMessageRef.current === lastMessage) return;
    appliedMessageRef.current = lastMessage;

    const quoteData = lastMessage.data as Record<string, Record<string, unknown>>;
    const updates = new Map<number, Record<string, unknown>>();

    for (const index of visibleIndices) {
      const row = tableDataRef.current[index];
      if (!row) continue;

      const ticker = String(row.symbol ?? row.ticker ?? row.Ticker ?? "").trim().toUpperCase();
      const quote = quoteData[ticker];
      if (!quote) continue;

      const rowUpdate: Record<string, unknown> = {};

      for (const col of realTimeColumns) {
        if (col === "currentPrice" || col === "Prezzo Corrente ($)") {
          rowUpdate[col] = quote.currentPrice ?? quote.price;
        } else if (
          col === "dailyChange_%" ||
          col === "Var. Giorn. %" ||
          col === "pnlPct24h"
        ) {
          rowUpdate[col] = quote.dailyChangePercent ?? quote.dailyChange;
        } else if (col === "previousClose") {
          rowUpdate[col] = quote.previousClose;
        } else if (col === "volume") {
          rowUpdate[col] = quote.volume;
        }
      }

      if (Object.keys(rowUpdate).length > 0) {
        updates.set(index, rowUpdate);
      }
    }

    if (updates.size > 0) {
      onUpdate(updates);
    }
  }, [lastMessage, visibleIndices, realTimeColumns, onUpdate]);

  // Parent must call registerRow when SHEET_WS_REALTIME_ENABLED is turned back on.
  useEffect(() => {
    return () => {
      // Cleanup is handled by unregisterRow calls from parent
    };
  }, [registerRow, unregisterRow]);

  return null;
}

/**
 * Hook to integrate RealTimeSheetUpdater with a table component.
 * Unused while {@link SHEET_WS_REALTIME_ENABLED} is false — kept for a future granular rewrite.
 */
export function useRealTimeSheetIntegration() {
  const { visibleIndices, registerRow, unregisterRow } = useVisibleRows({
    rootMargin: "200px",
  });

  return {
    visibleIndices,
    getRowProps: (index: number) => ({
      "data-row-index": index,
      ref: (element: HTMLElement | null) => registerRow(index, element),
    }),
    cleanupRow: (index: number) => unregisterRow(index),
  };
}
