import type { MobileDashboardAiFeedRow } from "./dashboardTypes";
import type { GainStarSnapshot } from "./gainStarDisplay";

/** Structured research tags from desktop Manual EIS (optional; score still via ledger/rough). */
export type MobileManualMoveAttribution = {
  causeClass?: string | null;
  confidence?: string | null;
  explainsMove?: string | null;
  eventSubtype?: string | null;
  peerXbiSameDayPct?: number | null;
  learningTag?: string | null;
  geopoliticalOrMacro?: string | null;
  drugOrAsset?: string | null;
  nctOrFiling?: string | null;
};

export type ManualFeedEventDraft = {
  id: string;
  createdAt: string;
  ticker: string;
  eventDate: string;
  source: string;
  title: string;
  body: string;
  sentiment?: number | null;
  deltaP1d?: number | null;
  deltaP3d?: number | null;
  link?: string | null;
  priceDropPct?: number | null;
  investigationOutcome?: "no_catalyst" | "negative_catalyst" | "positive_catalyst" | "neutral" | null;
  investigationContext?: "loss" | "gain" | null;
  attribution?: MobileManualMoveAttribution | null;
};

export type GainStarLedgerEntry = {
  date: string;
  source: "manual";
  eisScore: number;
  colorIndex: number;
  context: "loss" | "gain";
  anchorMovePct?: number | null;
};

export type ManualFeedStoreFile = {
  version: 1;
  updated_at: string;
  events: ManualFeedEventDraft[];
  gain_star_ledger?: Record<string, GainStarLedgerEntry[]>;
};

export type MobileManualEisRow = {
  score: number;
  showProvisionalStar: boolean;
  polarity: "positive" | "negative";
  context: "loss" | "gain";
  title: string;
  eventDate: string;
};

const GAIN_STAR_COLORS = ["#eab308", "#f97316", "#ec4899", "#8b5cf6", "#06b6d4"] as const;

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export async function fetchManualFeedStore(apiBase: string): Promise<ManualFeedStoreFile | null> {
  const base = apiBase.replace(/\/$/, "");
  const url = base ? `${base}/project-data/manual_feed_store.json` : "/project-data/manual_feed_store.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as ManualFeedStoreFile;
    if (!data || data.version !== 1 || !Array.isArray(data.events)) return null;
    return data;
  } catch {
    return null;
  }
}

export function gainStarsFromStore(
  store: ManualFeedStoreFile | null | undefined,
): Record<string, GainStarSnapshot[]> {
  const ledger = store?.gain_star_ledger;
  if (!ledger) return {};
  const out: Record<string, GainStarSnapshot[]> = {};
  for (const [tk, entries] of Object.entries(ledger)) {
    const list = Array.isArray(entries) ? entries : [];
    const active = list[list.length - 1];
    if (!active) continue;
    const colorIndex = active.colorIndex ?? 0;
    out[normalizeTicker(tk)] = [
      {
        date: active.date,
        source: "manual",
        eisScore: active.eisScore,
        colorIndex,
        color: GAIN_STAR_COLORS[((colorIndex % 5) + 5) % 5]!,
        context: active.context,
      },
    ];
  }
  return out;
}

function roughManualEisScore(draft: ManualFeedEventDraft): number {
  const move = draft.priceDropPct ?? draft.deltaP1d ?? null;
  const outcome = draft.investigationOutcome;
  if (outcome === "positive_catalyst") return Math.max(3, move != null && move > 0 ? Math.min(12, 4 + move * 0.4) : 5);
  if (outcome === "negative_catalyst") return Math.min(-3, move != null && move < 0 ? Math.max(-12, move * 0.5) : -5);
  if (outcome === "no_catalyst" && move != null && move < -0.5) return Math.min(4, 1.5 + Math.abs(move) * 0.08);
  if (draft.sentiment != null && Number.isFinite(draft.sentiment)) return draft.sentiment * 3;
  if (move != null && Number.isFinite(move)) return move >= 0 ? 2 : -2;
  return 0;
}

function latestManualDraftByTicker(store: ManualFeedStoreFile): Map<string, ManualFeedEventDraft> {
  const map = new Map<string, ManualFeedEventDraft>();
  for (const draft of store.events) {
    const tk = normalizeTicker(draft.ticker);
    if (!tk || !draft.eventDate) continue;
    const prev = map.get(tk);
    if (!prev || draft.eventDate > prev.eventDate || draft.createdAt > prev.createdAt) {
      map.set(tk, draft);
    }
  }
  return map;
}

export function buildManualEisByTicker(
  store: ManualFeedStoreFile | null | undefined,
): Record<string, MobileManualEisRow> {
  if (!store?.events?.length) return {};
  const stars = gainStarsFromStore(store);
  const out: Record<string, MobileManualEisRow> = {};
  for (const [tk, draft] of latestManualDraftByTicker(store)) {
    const ledgerStar = stars[tk]?.[0];
    const score = ledgerStar?.eisScore ?? roughManualEisScore(draft);
    if (!Number.isFinite(score) || score === 0) continue;
    const context: "loss" | "gain" =
      draft.investigationContext ??
      (draft.investigationOutcome === "positive_catalyst" || score > 0 ? "gain" : "loss");
    const polarity = score > 0 ? "positive" : "negative";
    out[tk] = {
      score,
      showProvisionalStar: score > 0 && !ledgerStar,
      polarity,
      context,
      title: draft.title?.trim() || draft.body?.slice(0, 120) || tk,
      eventDate: draft.eventDate,
    };
  }
  return out;
}

export function manualAiFeedRowsFromStore(
  store: ManualFeedStoreFile | null | undefined,
  scopeTickers: ReadonlySet<string>,
  limit = 6,
): MobileDashboardAiFeedRow[] {
  if (!store?.events?.length) return [];
  const stars = gainStarsFromStore(store);
  const rows: MobileDashboardAiFeedRow[] = [];
  for (const [tk, draft] of latestManualDraftByTicker(store)) {
    if (!scopeTickers.has(tk)) continue;
    const star = stars[tk]?.[0];
    const eis = star?.eisScore ?? roughManualEisScore(draft);
    rows.push({
      id: `manual_${draft.id}`,
      ticker: tk,
      eventDate: draft.eventDate,
      title: draft.title?.trim() || draft.body?.slice(0, 160) || "Manual news",
      delta1d: draft.priceDropPct ?? draft.deltaP1d ?? null,
      eis: Number.isFinite(eis) ? eis : null,
      verified: true,
      manual: true,
    });
  }
  return rows
    .sort((a, b) => {
      const ea = Math.abs(a.eis ?? 0);
      const eb = Math.abs(b.eis ?? 0);
      if (eb !== ea) return eb - ea;
      return b.eventDate.localeCompare(a.eventDate);
    })
    .slice(0, limit);
}

export function enrichSnapshotFromManualStore<T extends {
  gainStarsByTicker?: Record<string, GainStarSnapshot[]>;
  manualEisByTicker?: Record<string, MobileManualEisRow>;
  medtechTickers?: string[];
  aiFeed?: MobileDashboardAiFeedRow[];
}>(
  snapshot: T,
  store: ManualFeedStoreFile | null | undefined,
  scopeTickers: ReadonlySet<string>,
): T {
  if (!store) return snapshot;
  const gainStars = gainStarsFromStore(store);
  const manualEis = buildManualEisByTicker(store);
  const manualFeed = manualAiFeedRowsFromStore(store, scopeTickers, 6);
  const mergedFeed = [...manualFeed, ...(snapshot.aiFeed ?? [])]
    .filter((row, idx, arr) => arr.findIndex((x) => x.id === row.id) === idx)
    .slice(0, 10);
  return {
    ...snapshot,
    gainStarsByTicker: { ...(snapshot.gainStarsByTicker ?? {}), ...gainStars },
    manualEisByTicker: { ...(snapshot.manualEisByTicker ?? {}), ...manualEis },
    aiFeed: mergedFeed.length ? mergedFeed : snapshot.aiFeed,
  };
}
