/**
 * Virtualized table body helpers — spacer rows + @tanstack/react-virtual.
 * Keeps sticky <thead> intact; only visible (+ overscan) <tr> mount in the DOM.
 *
 * When the scrollport is a page container (.desk-page-scroll) that also holds
 * content above the table, pass scrollMargin = offset of the table wrap inside
 * that scroll content — otherwise paddingTop invents a huge white gap.
 */
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useMemo } from "react";

export type VirtualTableBody = {
  virtualizer: Virtualizer<HTMLElement, Element>;
  virtualRows: ReturnType<Virtualizer<HTMLElement, Element>["getVirtualItems"]>;
  paddingTop: number;
  paddingBottom: number;
  totalSize: number;
};

export function useVirtualTableBody(opts: {
  count: number;
  scrollElement: HTMLElement | null;
  estimateSize?: number;
  overscan?: number;
  /**
   * Distance (px) from the start of the scrollable content to the list.
   * Required when scrollElement contains chrome above the table.
   */
  scrollMargin?: number;
  /** When false, returns empty virtual rows — caller should render the full list. */
  enabled?: boolean;
}): VirtualTableBody {
  const enabled = opts.enabled !== false && opts.count > 0;
  const scrollMargin = Math.max(0, opts.scrollMargin ?? 0);
  const virtualizer = useVirtualizer({
    count: enabled ? opts.count : 0,
    getScrollElement: () => opts.scrollElement,
    estimateSize: () => opts.estimateSize ?? 48,
    overscan: opts.overscan ?? 10,
    scrollMargin,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const { paddingTop, paddingBottom } = useMemo(() => {
    if (!virtualRows.length) return { paddingTop: 0, paddingBottom: 0 };
    const first = virtualRows[0]!;
    const last = virtualRows[virtualRows.length - 1]!;
    // first.start / last.end include scrollMargin — subtract for <tbody> pads
    return {
      paddingTop: Math.max(0, first.start - scrollMargin),
      paddingBottom: Math.max(0, totalSize - last.end),
    };
  }, [virtualRows, totalSize, scrollMargin]);

  return { virtualizer, virtualRows, paddingTop, paddingBottom, totalSize };
}

/** Spacer <tr> for table virtualization (top or bottom pad). */
export function VirtualTablePadRow({
  height,
  colSpan,
}: {
  height: number;
  colSpan: number;
}) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden="true" style={{ height }}>
      <td
        colSpan={colSpan}
        style={{ padding: 0, border: 0, height, lineHeight: 0 }}
      />
    </tr>
  );
}
