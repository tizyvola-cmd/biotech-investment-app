/**
 * Urgent Soft SELL banner — «vendi di botto» when Home publishes Soft/Urgent sells.
 */

const ACK_KEY = "sn_mobile_urgent_sell_ack_v1";

export type UrgentSellBannerItem = {
  key: string;
  ticker: string;
  tag?: string | null;
  capitalEur: number | null;
  pnlEur: number | null;
};

export function urgentSellSig(items: UrgentSellBannerItem[]): string {
  return items
    .map((i) => i.key.toUpperCase())
    .sort()
    .join("|");
}

export function loadUrgentSellAck(): string | null {
  try {
    return localStorage.getItem(ACK_KEY);
  } catch {
    return null;
  }
}

export function saveUrgentSellAck(items: UrgentSellBannerItem[]): void {
  try {
    localStorage.setItem(ACK_KEY, urgentSellSig(items));
  } catch {
    /* ignore */
  }
}

export function urgentSellNeedsBanner(items: UrgentSellBannerItem[]): boolean {
  if (!items.length) return false;
  return loadUrgentSellAck() !== urgentSellSig(items);
}

/** Prefer G2 / hard / giveback first — same urgency ranking as desktop ops. */
export function sortUrgentSellItems(
  items: UrgentSellBannerItem[],
): UrgentSellBannerItem[] {
  const rank = (tag: string | null | undefined): number => {
    const t = (tag ?? "").toLowerCase();
    if (t === "g2") return 0;
    if (t === "hard") return 1;
    if (t === "giveback") return 2;
    if (t === "soft_g1") return 3;
    if (t === "cont_exh") return 4;
    return 5;
  };
  return [...items].sort((a, b) => {
    const d = rank(a.tag) - rank(b.tag);
    if (d !== 0) return d;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function buildUrgentSellItemsFromSnapshot(opts: {
  softSells?: Array<{
    key: string;
    ticker: string;
    tag?: string | null;
    capitalEur?: number | null;
    pnlEur?: number | null;
  }> | null;
  openByKey?: Map<string, { capitalEur: number; pnlEur: number | null }>;
}): UrgentSellBannerItem[] {
  const sells = opts.softSells ?? [];
  if (!sells.length) return [];
  const items: UrgentSellBannerItem[] = sells.map((s) => {
    const open = opts.openByKey?.get(s.key);
    const capital =
      s.capitalEur != null && Number.isFinite(s.capitalEur)
        ? s.capitalEur
        : open?.capitalEur ?? null;
    const pnl =
      s.pnlEur != null && Number.isFinite(s.pnlEur)
        ? s.pnlEur
        : open?.pnlEur ?? null;
    return {
      key: s.key,
      ticker: String(s.ticker ?? s.key.split("|")[0] ?? "").toUpperCase(),
      tag: s.tag ?? null,
      capitalEur: capital,
      pnlEur: pnl,
    };
  });
  return sortUrgentSellItems(items);
}
