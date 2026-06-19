import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Keeps the right-hand KPI strip as tall as the left panel's pre-chart block. */
export function useDecisionSimPairPrechartHeight(active = true): {
  preChartRef: RefObject<HTMLDivElement>;
  preChartHeight: number | null;
} {
  const preChartRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setHeight(null);
      return;
    }

    let ro: ResizeObserver | null = null;

    const attach = () => {
      const el = preChartRef.current;
      if (!el) return;
      const sync = () => {
        const h = el.getBoundingClientRect().height;
        if (Number.isFinite(h) && h > 0) setHeight(Math.round(h));
      };
      sync();
      ro?.disconnect();
      ro = new ResizeObserver(() => sync());
      ro.observe(el);
    };

    attach();
    const raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [active]);

  return { preChartRef, preChartHeight: height };
}
