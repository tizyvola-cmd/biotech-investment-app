import { useCallback, useEffect, useRef, useState } from "react";

interface UseVisibleRowsOptions {
  /** Root element to observe (default: viewport) */
  root?: Element | null;
  /** Margin around the viewport to preload (default: 100px) */
  rootMargin?: string;
  /** Threshold for intersection (default: 0) */
  threshold?: number | number[];
  /** Debounce delay in ms (default: 100) */
  debounceMs?: number;
}

interface UseVisibleRowsResult {
  /** Set of visible row indices */
  visibleIndices: Set<number>;
  /** Register a row element for observation */
  registerRow: (index: number, element: HTMLElement | null) => void;
  /** Unregister a row element */
  unregisterRow: (index: number) => void;
}

/**
 * Hook to track which rows are currently visible in the viewport.
 * Uses Intersection Observer for efficient tracking.
 */
export function useVisibleRows(options: UseVisibleRowsOptions = {}): UseVisibleRowsResult {
  const {
    root = null,
    rootMargin = "100px",
    threshold = 0,
    debounceMs = 100,
  } = options;

  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());
  const rowElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update visible indices with debounce
  const updateVisible = useCallback((entries: IntersectionObserverEntry[]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setVisibleIndices((prev) => {
        const next = new Set(prev);

        for (const entry of entries) {
          const index = parseInt(entry.target.getAttribute("data-row-index") || "-1");
          if (index >= 0) {
            if (entry.isIntersecting) {
              next.add(index);
            } else {
              next.delete(index);
            }
          }
        }

        return next;
      });
    }, debounceMs);
  }, [debounceMs]);

  // Setup Intersection Observer
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      console.warn("IntersectionObserver not supported, falling back to all rows visible");
      setVisibleIndices(new Set(Array.from(rowElementsRef.current.keys())));
      return;
    }

    observerRef.current = new IntersectionObserver(updateVisible, {
      root,
      rootMargin,
      threshold,
    });

    // Observe all registered rows
    rowElementsRef.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      observerRef.current?.disconnect();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [root, rootMargin, threshold, updateVisible]);

  // Register a row for observation
  const registerRow = useCallback((_index: number, element: HTMLElement | null) => {
    if (!element) {
      rowElementsRef.current.delete(_index);
      return;
    }

    rowElementsRef.current.set(_index, element);
    observerRef.current?.observe(element);
  }, []);

  // Unregister a row
  const unregisterRow = useCallback((_index: number) => {
    const element = rowElementsRef.current.get(_index);
    if (element) {
      observerRef.current?.unobserve(element);
      rowElementsRef.current.delete(_index);
    }
  }, []);

  return {
    visibleIndices,
    registerRow,
    unregisterRow,
  };
}
