import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Becomes true once the observed element enters (or nears) the viewport.
 * Used to defer heavy chart mounts until the user scrolls near a card.
 */
export function useInViewOnce(
  force = false,
  rootMargin = "280px 0px",
): { ref: RefObject<HTMLDivElement>; inView: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(force);

  useEffect(() => {
    if (inView || force) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [force, inView, rootMargin]);

  return { ref, inView: inView || force };
}
