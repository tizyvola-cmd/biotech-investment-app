/**
 * Deal ranking visuals for Top BUY / SELL and opportunity lists.
 * Sorted by ROI target; tier icons: crown pig → pig → small pig → worst (🐔).
 */
import { resolvePrimaryReturnPct } from "./canonicalRoi";

/** Peggiore tier — 🐴 assomiglia a cavallo su Windows; 🐔 = «pollo/sfigato» leggibile ovunque. */
export const WORST_RANK_EMOJI = "🐔";

export type DealRankIconKind = "crown_pig" | "pig" | "small_pig" | "worst";

export type DealRankVisual = {
  kind: DealRankIconKind;
  emoji: string;
  crown: boolean;
  scale: number;
  titleIt: string;
  titleEn: string;
};

export type DealRankSignal = {
  planReturnPct?: number | null;
  precatExpectedReturn: number | null;
  pred5: number | null;
  upsideScore: number;
};

/** Primary gain metric for BUY ranking (higher = better deal). */
export function dealGainPctForBuy(s: DealRankSignal): number {
  const primary = resolvePrimaryReturnPct(s);
  if (primary != null && Number.isFinite(primary)) return primary;
  if (s.planReturnPct != null && Number.isFinite(s.planReturnPct)) {
    return s.planReturnPct;
  }
  if (s.precatExpectedReturn != null && Number.isFinite(s.precatExpectedReturn)) {
    return s.precatExpectedReturn;
  }
  if (s.pred5 != null && Number.isFinite(s.pred5)) return s.pred5;
  return s.upsideScore;
}

/** For SELL: most negative expected move = strongest exit case (sort ascending). */
export function dealGainPctForSell(s: DealRankSignal): number {
  const primary = resolvePrimaryReturnPct(s);
  if (primary != null && Number.isFinite(primary)) return primary;
  if (s.planReturnPct != null && Number.isFinite(s.planReturnPct)) {
    return s.planReturnPct;
  }
  if (s.precatExpectedReturn != null && Number.isFinite(s.precatExpectedReturn)) {
    return s.precatExpectedReturn;
  }
  if (s.pred5 != null && Number.isFinite(s.pred5)) return s.pred5;
  return -s.upsideScore;
}

export function sortByDealRank<T extends DealRankSignal>(
  items: T[],
  side: "buy" | "sell",
): T[] {
  return [...items].sort((a, b) => {
    const ga = side === "buy" ? dealGainPctForBuy(a) : dealGainPctForSell(a);
    const gb = side === "buy" ? dealGainPctForBuy(b) : dealGainPctForSell(b);
    return side === "buy" ? gb - ga : ga - gb;
  });
}

export function dealRankVisual(rankIndex: number, total: number): DealRankVisual {
  if (total <= 0) {
    return {
      kind: "worst",
      emoji: WORST_RANK_EMOJI,
      crown: false,
      scale: 0.85,
      titleIt: "—",
      titleEn: "—",
    };
  }

  if (rankIndex === 0) {
    return {
      kind: "crown_pig",
      emoji: "🐷",
      crown: true,
      scale: 1.55,
      titleIt: "Miglior deal — maiale con corona (maggior guadagno atteso)",
      titleEn: "Best deal — crowned pig (largest expected gain)",
    };
  }

  if (total === 2) {
    return {
      kind: "pig",
      emoji: "🐷",
      crown: false,
      scale: 1.05,
      titleIt: "Secondo deal — maiale",
      titleEn: "Second deal — pig",
    };
  }

  const pigUntil = Math.max(1, Math.ceil(total * 0.35));
  const smallUntil = Math.max(pigUntil + 1, Math.ceil(total * 0.7));

  if (rankIndex < pigUntil) {
    return {
      kind: "pig",
      emoji: "🐷",
      crown: false,
      scale: 1.15,
      titleIt: "Buon deal — maiale",
      titleEn: "Good deal — pig",
    };
  }

  if (rankIndex < smallUntil) {
    return {
      kind: "small_pig",
      emoji: "🐷",
      crown: false,
      scale: 0.88,
      titleIt: "Deal medio — maialino",
      titleEn: "Average deal — small pig",
    };
  }

  return {
    kind: "worst",
    emoji: WORST_RANK_EMOJI,
    crown: false,
    scale: 0.95,
    titleIt: "Peggiore — pollo (sfigato)",
    titleEn: "Worst — chicken (underperformer)",
  };
}

export function dealRankLabel(lang: "it" | "en", rankIndex: number, total: number): string {
  const v = dealRankVisual(rankIndex, total);
  const n = rankIndex + 1;
  if (lang === "it") {
    if (v.kind === "crown_pig") return `#${n} miglior deal`;
    if (v.kind === "worst") return `#${n} peggiore`;
    return `#${n}`;
  }
  if (v.kind === "crown_pig") return `#${n} best deal`;
  if (v.kind === "worst") return `#${n} worst`;
  return `#${n}`;
}

/** Etichette ranking P&L portfolio (non gain atteso pre-CD). */
export function dealRankLabelPnl(lang: "it" | "en", rankIndex: number, total: number): string {
  const v = dealRankVisual(rankIndex, total);
  const n = rankIndex + 1;
  if (lang === "it") {
    if (v.kind === "crown_pig") return `#${n} migliore P&L`;
    if (v.kind === "worst") return `#${n} peggiore P&L`;
    return `#${n}`;
  }
  if (v.kind === "crown_pig") return `#${n} best P&L`;
  if (v.kind === "worst") return `#${n} worst P&L`;
  return `#${n}`;
}

export function dealRankTitlePnl(
  lang: "it" | "en",
  rankIndex: number,
  total: number,
  scope: "today" | "total",
): string {
  const v = dealRankVisual(rankIndex, total);
  const scopeIt = scope === "today" ? "P&L giornata" : "P&L totale";
  const scopeEn = scope === "today" ? "daily P&L" : "total P&L";
  const base = lang === "it" ? v.titleIt : v.titleEn;
  return lang === "it"
    ? `${base} · ranking ${scopeIt} tra posizioni aperte`
    : `${base} · ${scopeEn} rank among open positions`;
}

/** Row fields for P&L ranking (Simulation snapshot / portfolio cards). */
export type PnlRankRow = {
  pnlPctToday?: number | null;
  pnlPct?: number | null;
  pnlEurToday?: number | null;
  pnlEur?: number | null;
  pnlPctSinceReading?: number | null;
  pnlEurSinceReading?: number | null;
  hasReadingDelta?: boolean;
  pnlUnavailable?: boolean;
  hasToday?: boolean;
};

export function pnlRankMetric(
  row: PnlRankRow,
  scope: "today" | "total" | "reading",
): number {
  if (
    scope === "reading" &&
    row.hasReadingDelta &&
    row.pnlPctSinceReading != null &&
    Number.isFinite(row.pnlPctSinceReading)
  ) {
    return row.pnlPctSinceReading;
  }
  if (scope === "today" && row.hasToday && row.pnlPctToday != null && Number.isFinite(row.pnlPctToday)) {
    return row.pnlPctToday;
  }
  if (row.pnlPct != null && Number.isFinite(row.pnlPct) && !row.pnlUnavailable) {
    return row.pnlPct;
  }
  if (scope === "reading" && row.pnlEurSinceReading != null && Number.isFinite(row.pnlEurSinceReading)) {
    return row.pnlEurSinceReading;
  }
  if (scope === "today" && row.pnlEurToday != null && Number.isFinite(row.pnlEurToday)) {
    return row.pnlEurToday;
  }
  if (row.pnlEur != null && Number.isFinite(row.pnlEur)) {
    return row.pnlEur;
  }
  return Number.NEGATIVE_INFINITY;
}

/** Best P&L first (crowned pig at top), worst last (🐔). */
export function sortByPnlRank<T extends PnlRankRow>(
  items: T[],
  scope: "today" | "total" | "reading",
): T[] {
  return [...items].sort((a, b) => pnlRankMetric(b, scope) - pnlRankMetric(a, scope));
}

/**
 * P&L card list (best → worst): #1 = 👑🐷, last = 🐔, middle = pig tiers.
 * Unlike generic dealRankVisual, last place is always rooster when n ≥ 2.
 */
export function dealRankVisualPnlList(rankIndex: number, total: number): DealRankVisual {
  if (total <= 0) return dealRankVisual(0, 1);
  if (rankIndex === 0) {
    return dealRankVisual(0, Math.max(3, total));
  }
  if (total > 1 && rankIndex === total - 1) {
    return {
      kind: "worst",
      emoji: WORST_RANK_EMOJI,
      crown: false,
      scale: total === 2 ? 1.05 : 0.95,
      titleIt: "Peggiore P&L in portafoglio — gallo",
      titleEn: "Worst portfolio P&L — rooster",
    };
  }
  return dealRankVisual(rankIndex, total);
}

export function dealRankLabelPnlList(lang: "it" | "en", rankIndex: number, total: number): string {
  const v = dealRankVisualPnlList(rankIndex, total);
  const n = rankIndex + 1;
  if (lang === "it") {
    if (v.kind === "crown_pig") return `#${n} migliore`;
    if (v.kind === "worst") return `#${n} peggiore`;
    return `#${n}`;
  }
  if (v.kind === "crown_pig") return `#${n} best`;
  if (v.kind === "worst") return `#${n} worst`;
  return `#${n}`;
}

export function dealRankTitlePnlList(
  lang: "it" | "en",
  rankIndex: number,
  total: number,
  scope: "today" | "total",
): string {
  const v = dealRankVisualPnlList(rankIndex, total);
  const scopeIt = scope === "today" ? "P&L giornata" : "P&L totale";
  const scopeEn = scope === "today" ? "daily P&L" : "total P&L";
  const base = lang === "it" ? v.titleIt : v.titleEn;
  return lang === "it"
    ? `${base} · ranking ${scopeIt} (${rankIndex + 1}/${total})`
    : `${base} · ${scopeEn} rank (${rankIndex + 1}/${total})`;
}

/** Visual tier when list is sorted worst → best (listIndex 0 = worst tier). */
export function dealRankVisualWorstFirst(listIndex: number, total: number): DealRankVisual {
  return dealRankVisual(Math.max(0, total - 1 - listIndex), total);
}

export function dealRankLabelWorstFirst(lang: "it" | "en", listIndex: number, total: number): string {
  const v = dealRankVisualWorstFirst(listIndex, total);
  const n = listIndex + 1;
  if (lang === "it") {
    if (v.kind === "crown_pig") return `#${n} migliore`;
    if (v.kind === "worst") return `#${n} peggiore`;
    return `#${n}`;
  }
  if (v.kind === "crown_pig") return `#${n} best`;
  if (v.kind === "worst") return `#${n} worst`;
  return `#${n}`;
}

/** Rank index per key after sorting best → worst (crown = index 0). */
export function buildPnlRankIndexMap<T extends PnlRankRow>(
  items: T[],
  scope: "today" | "total" | "reading",
  getKey: (item: T) => string,
): { rankByKey: Map<string, number>; total: number } {
  const sorted = sortByPnlRank(items, scope);
  const rankByKey = new Map<string, number>();
  sorted.forEach((item, i) => rankByKey.set(getKey(item), i));
  return { rankByKey, total: sorted.length };
}

/**
 * Portfolio / single-name % P&L → same tier icons as ranked deals
 * (crowned pig = strong gain, chicken = heavy loss / worst tier).
 */
export function dealRankVisualFromGainPct(gainPct: number): DealRankVisual {
  if (!Number.isFinite(gainPct)) {
    return dealRankVisual(0, 1);
  }
  const virtualTotal = 10;
  if (gainPct <= -8) return dealRankVisual(virtualTotal - 1, virtualTotal);
  if (gainPct < 0) return dealRankVisual(Math.ceil(virtualTotal * 0.75), virtualTotal);
  if (gainPct < 3) return dealRankVisual(Math.ceil(virtualTotal * 0.55), virtualTotal);
  if (gainPct < 12) return dealRankVisual(1, virtualTotal);
  return dealRankVisual(0, virtualTotal);
}

import type { PortfolioPnlTone } from "./portfolioGainLossStyle";
import type { PortfolioPositionAction } from "./portfolioPositionAction";

/** Tab P&L: solo 👑🐷 al top deal (se non in loss) e 🐔 su tutte le righe in perdita. */
export function pnlTableRankIcon(
  rankIndex: number,
  rankTotal: number,
  pnlTone: PortfolioPnlTone,
): DealRankVisual | null {
  if (pnlTone === "loss") {
    return {
      kind: "worst",
      emoji: WORST_RANK_EMOJI,
      crown: false,
      scale: 1.05,
      titleIt: "In perdita",
      titleEn: "In loss",
    };
  }
  if (rankIndex === 0 && rankTotal > 0) {
    return dealRankVisual(0, rankTotal);
  }
  return null;
}

/**
 * Icona chip Piggy Bank — allineata a Top 2 SELL / tab In Loss:
 * · 👑🐷 = miglior P&L positivo
 * · 🐷   = altri in guadagno
 * · 🐔   = in perdita + vendita raccomandata (pendenza ↓)
 * · ⏳   = in perdita + attendi risalita (curva ↑ verso target)
 * · nessuna icona = pari (~0)
 */
export function piggyBankChipRankVisual(
  rankIndex: number | null | undefined,
  rankTotal: number,
  action: PortfolioPositionAction,
  _pnlPct: number,
): DealRankVisual | null {
  if (action === "sell") {
    return {
      kind: "worst",
      emoji: WORST_RANK_EMOJI,
      crown: false,
      scale: 1.05,
      titleIt: "Vendita raccomandata — pendenza in calo",
      titleEn: "Sell recommended — declining slope",
    };
  }
  if (action === "hold") {
    return {
      kind: "pig",
      emoji: "⏳",
      crown: false,
      scale: 1.05,
      titleIt: "In perdita — attendi risalita verso target",
      titleEn: "In loss — wait for recovery toward target",
    };
  }
  if (action === "gain" && rankTotal > 0 && rankIndex === 0) {
    return dealRankVisual(0, Math.max(2, rankTotal));
  }
  if (action === "gain") {
    return {
      kind: "pig",
      emoji: "🐷",
      crown: false,
      scale: 1.05,
      titleIt: "In guadagno (totale positivo) — maiale",
      titleEn: "Winning position (positive total) — pig",
    };
  }
  return null;
}
