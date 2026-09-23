/** Scroll `target` to the top of `container`, keeping a small leading gap. */
export function scrollElementInContainer(
  container: HTMLElement,
  target: HTMLElement,
  opts?: { offset?: number; behavior?: ScrollBehavior },
): void {
  const gap = opts?.offset ?? 12;
  const cTop = container.getBoundingClientRect().top;
  const tTop = target.getBoundingClientRect().top;
  const nextTop = container.scrollTop + (tTop - cTop) - gap;
  container.scrollTo({
    top: Math.max(0, nextTop),
    behavior: opts?.behavior ?? "smooth",
  });
}

function isScrollableOverflowY(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1;
}

/** Offset of `el` from the top of `scrollParent`'s scrollable content. */
export function offsetInScrollContent(
  el: HTMLElement,
  scrollParent: HTMLElement,
): number {
  return (
    el.getBoundingClientRect().top -
    scrollParent.getBoundingClientRect().top +
    scrollParent.scrollTop
  );
}

/** Nearest ancestor that can scroll vertically (e.g. app main `overflow-y-auto`). */
export function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    if (isScrollableOverflowY(node)) return node;
    node = node.parentElement;
  }
  return null;
}

/** All vertically scrollable ancestors, innermost → outermost. */
export function collectScrollableAncestors(target: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node: HTMLElement | null = target.parentElement;
  while (node) {
    if (isScrollableOverflowY(node)) out.push(node);
    node = node.parentElement;
  }
  return out;
}

/**
 * Scroll to a DOM id.
 * Nested scrollports (e.g. Evaluation Lab `panel-stack-scroll` inside app main)
 * must be adjusted innermost→outermost — outermost-only left the deep-dive card
 * off-screen and looked like a jump back to the Top KPI table.
 */
export function scrollToDomId(
  id: string,
  opts?: {
    scrollContainer?: HTMLElement | null;
    offset?: number;
    behavior?: ScrollBehavior;
  },
): boolean {
  const target = document.getElementById(id);
  if (!target) return false;

  const behavior = opts?.behavior ?? "smooth";
  const gap = opts?.offset ?? 12;

  const preferred =
    opts?.scrollContainer && isScrollableOverflowY(opts.scrollContainer)
      ? opts.scrollContainer
      : null;
  const ancestors = collectScrollableAncestors(target);
  const chain: HTMLElement[] = [];
  if (preferred) chain.push(preferred);
  for (const a of ancestors) {
    if (!chain.includes(a)) chain.push(a);
  }

  if (!chain.length) {
    target.scrollIntoView({ behavior, block: "start" });
    return true;
  }

  // Inner nests first (instant), outermost last (honour smooth).
  for (let i = 0; i < chain.length; i += 1) {
    const container = chain[i]!;
    const isLast = i === chain.length - 1;
    scrollElementInContainer(container, target, {
      offset: gap,
      behavior: isLast ? behavior : "auto",
    });
  }
  return true;
}

/** Retry scroll until target mounts (lazy cards) or attempts exhausted. */
export function scrollToDomIdWhenReady(
  id: string,
  opts?: {
    scrollContainer?: HTMLElement | null;
    offset?: number;
    behavior?: ScrollBehavior;
    maxAttempts?: number;
    intervalMs?: number;
    onReady?: (el: HTMLElement) => void;
  },
): void {
  const maxAttempts = opts?.maxAttempts ?? 8;
  const intervalMs = opts?.intervalMs ?? 60;

  const attempt = (n: number) => {
    if (scrollToDomId(id, opts)) {
      const el = document.getElementById(id);
      if (el) opts?.onReady?.(el);
      return;
    }
    if (n + 1 >= maxAttempts) return;
    window.setTimeout(() => attempt(n + 1), intervalMs);
  };

  attempt(0);
}
