import { useRef } from "react";

/** True when URL has ?debugRenders=1 (or &debugRenders=1). */
export function isDebugRendersEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("debugRenders") === "1";
  } catch {
    return false;
  }
}

/** Persist counts across remounts so idle tests are not confused by key churn. */
const renderTotals = new Map<string, number>();
const mountTotals = new Map<string, number>();

/**
 * Increments once per render of the calling component.
 * Pass a stable `id` (row key) so remounts keep the total and bump mount count.
 * Badge text: `r:12` or `r:12 m2` when remounted.
 */
export function useDebugRenderCount(enabled: boolean, id?: string | null): number {
  const n = useRef(0);
  const mounted = useRef(false);
  if (enabled && id) {
    if (!mounted.current) {
      mounted.current = true;
      mountTotals.set(id, (mountTotals.get(id) ?? 0) + 1);
    }
    n.current += 1;
    const total = (renderTotals.get(id) ?? 0) + 1;
    renderTotals.set(id, total);
    return total;
  }
  if (enabled) n.current += 1;
  return n.current;
}

export function debugMountCount(id: string | null | undefined): number {
  if (!id) return 1;
  return mountTotals.get(id) ?? 1;
}

export function formatDebugRenderBadge(renders: number, id?: string | null): string {
  const mounts = debugMountCount(id);
  return mounts > 1 ? `r:${renders} m${mounts}` : `r:${renders}`;
}
