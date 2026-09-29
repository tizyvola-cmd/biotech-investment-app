/**
 * Residual-guided move attribution — quantifies how much of a price move is
 * explained by market (XBI alignment), known EIS events, and model curve gap.
 * Unexplained remainder drives manual investigation / index discovery.
 */
import type { ClinicalPreCdRecord } from "../api/supernova";
import type { SdsRow } from "../api/supernova";
import { hydrateClinicalPreCdRecords } from "./clinicalPreCdSnapshotCache";
import { buildTickerEisDetail } from "./tickerEisSummary";
import {
  computeEisFeedWindowScore,
  deriveCauseInputFromSdsRow,
} from "./lossRescueEngine";
import { latestTickerAttribution } from "./manualAttributionMemory";
import {
  loadManualFeedEvents,
  mergeManualEventsIntoRecords,
  resolveManualEventAttribution,
} from "./manualFeedEvents";
import {
  manualAttributionCompanyBoostShare,
  manualAttributionMarketBoostShare,
} from "./manualMoveAttribution";

/** |residual| above this with low explained share → investigation queue. */
export const RESIDUAL_INVESTIGATION_THRESHOLD_PCT = 3;
/** Below this explained % of |observed| → treat as unexplained move. */
export const RESIDUAL_EXPLAINED_MIN_SHARE_PCT = 55;
/** Single-day move above this may be split/reverse-split contamination. */
export const SPLIT_CONTAMINATION_ABS_PCT = 35;

export type ResidualMoveFlags = {
  needsInvestigation: boolean;
  splitContaminationSuspect: boolean;
  lowConfidence: boolean;
  /**
   * Only the market channel has magnitude — and it comes from SDS external
   * alignment share, not measured XBI 1d / EIS / model. Do not treat high
   * explainedSharePct as strong justification.
   */
  marketOnly: boolean;
};

export type ResidualMoveBreakdown = {
  observedPct: number;
  marketExplainedPct: number;
  /**
   * News/EIS channel total (= priced ΔP T+1 + optional manual company share).
   * Not the EIS composite score (e.g. +2.9) — that is a different metric.
   */
  eisExplainedPct: number;
  /** Portion from sum of event ΔP T+1 in the 7d window (measured). */
  eisPricedPct: number;
  /** Portion from manual company attribution (dilution / M&A note share). */
  eisManualBoostPct: number;
  modelExplainedPct: number;
  explainedPct: number;
  unexplainedPct: number;
  /** 0–100 — share of |observed| accounted for by components. */
  explainedSharePct: number;
  eventCountInWindow: number;
  manualNoteCount: number;
  flags: ResidualMoveFlags;
};

/** Which channel contributes most to |explainedPct| (for clearer summaries). */
export function residualDominantChannel(
  b: ResidualMoveBreakdown,
): "market" | "eis" | "model" | "mixed" | "none" {
  const parts = [
    { id: "market" as const, v: Math.abs(b.marketExplainedPct) },
    { id: "eis" as const, v: Math.abs(b.eisExplainedPct) },
    { id: "model" as const, v: Math.abs(b.modelExplainedPct) },
  ].sort((a, b) => b.v - a.v);
  const top = parts[0]!;
  const total = parts.reduce((s, p) => s + p.v, 0);
  if (total < 0.05) return "none";
  if (top.v / total >= 0.85) return top.id;
  return "mixed";
}

export function residualDominantChannelLabel(
  b: ResidualMoveBreakdown,
  lang: "it" | "en",
): string | null {
  const dom = residualDominantChannel(b);
  const it = lang === "it";
  switch (dom) {
    case "market":
      return it ? "soprattutto mercato (XBI)" : "mostly market (XBI)";
    case "eis":
      return it ? "soprattutto feed EIS" : "mostly EIS feed";
    case "model":
      return it ? "soprattutto gap modello" : "mostly model gap";
    case "mixed":
      return it ? "mix mercato · EIS · modello" : "mix market · EIS · model";
    default:
      return null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function finiteOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** Heuristic reverse-split / bad-tick guard before residual discovery. */
export function detectSplitContaminationSuspect(
  observedPct: number,
  recentDailyPcts?: (number | null | undefined)[],
): boolean {
  if (!Number.isFinite(observedPct)) return false;
  if (Math.abs(observedPct) >= SPLIT_CONTAMINATION_ABS_PCT) return true;
  const recent = (recentDailyPcts ?? [])
    .map((p) => (p != null && Number.isFinite(p) ? Math.abs(p) : null))
    .filter((p): p is number => p != null);
  if (recent.length < 3) return false;
  const sorted = [...recent].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.abs(observedPct) > Math.max(8, median * 3);
}

function sumSignedEisEventDelta(
  ticker: string,
  lang: "it" | "en",
  windowDays = 7,
  records?: ClinicalPreCdRecord[] | null,
): { sum: number; count: number; manualCount: number } {
  const merged = mergeManualEventsIntoRecords(records ?? hydrateClinicalPreCdRecords());
  const detail = buildTickerEisDetail(ticker, lang, undefined, merged);
  const cutoff = Date.now() - windowDays * 86400000;
  let sum = 0;
  let count = 0;
  let manualCount = 0;
  for (const ev of detail.events) {
    if (!ev.eventDate) continue;
    const ms = Date.parse(`${ev.eventDate}T12:00:00`);
    if (!Number.isFinite(ms) || ms < cutoff) continue;
    const d1 = ev.breakdown.delta_p_1d;
    if (d1 == null || !Number.isFinite(d1)) continue;
    sum += d1;
    count += 1;
    if (ev.sourceType === "manual") manualCount += 1;
  }
  return { sum: round1(sum), count, manualCount };
}

/**
 * Decompose observed move into explained channels + residual.
 * v1 heuristics — CAR/surprise weights land in Phase 2–3.
 */
export function buildResidualMoveBreakdown(args: {
  observedPct: number | null | undefined;
  externalAlignmentScore?: number | null;
  eisWindowScore?: number | null;
  eisEventDeltaSum?: number | null;
  curveGapPct?: number | null;
  eventCountInWindow?: number;
  manualNoteCount?: number;
  recentDailyPcts?: (number | null | undefined)[];
  /** Extra market share 0…0.55 from Manual EIS attribution (noise/geo). */
  manualMarketBoostShare?: number | null;
  /** Extra company/EIS share 0…0.5 from Manual EIS (dilution / M&A). */
  manualCompanyBoostShare?: number | null;
}): ResidualMoveBreakdown | null {
  const observed = finiteOrNull(args.observedPct);
  if (observed == null || Math.abs(observed) < 0.05) return null;

  const splitContaminationSuspect = detectSplitContaminationSuspect(
    observed,
    args.recentDailyPcts,
  );

  const extAlign = finiteOrNull(args.externalAlignmentScore);
  const boost = clamp(finiteOrNull(args.manualMarketBoostShare) ?? 0, 0, 0.55);
  const companyBoost = clamp(finiteOrNull(args.manualCompanyBoostShare) ?? 0, 0, 0.5);
  const marketShare = clamp(
    (extAlign != null ? clamp(extAlign / 100, 0, 0.92) : 0) + boost,
    0,
    0.95,
  );
  const marketExplainedPct = round1(observed * marketShare);

  let afterMarket = observed - marketExplainedPct;

  let eisPricedPct = 0;
  if (args.eisEventDeltaSum != null && Number.isFinite(args.eisEventDeltaSum)) {
    // Keep the natural sign of measured ΔP — do NOT flip to the day's sign.
    // A +ΔP news window cannot "explain" a −47% crash by flipping negative.
    const raw = args.eisEventDeltaSum;
    const sameDir = Math.sign(raw) === 0 || Math.sign(raw) === Math.sign(afterMarket || raw);
    if (sameDir) {
      const mag = Math.min(Math.abs(afterMarket), Math.abs(raw));
      eisPricedPct = round1(Math.sign(raw || afterMarket) * mag);
    } else {
      // Opposite to today's move → news does not explain this move (leave at 0).
      eisPricedPct = 0;
    }
  } else if (args.eisWindowScore != null && Number.isFinite(args.eisWindowScore)) {
    const score = args.eisWindowScore;
    const sameDir = Math.sign(score) === 0 || Math.sign(score) === Math.sign(afterMarket || score);
    if (sameDir) {
      const scaled = (Math.abs(score) / 50) * Math.min(Math.abs(afterMarket), 12);
      eisPricedPct = round1(Math.sign(score || afterMarket) * scaled);
    }
  }

  // Manual dilution/M&A share — only when the day is NOT a split-suspect mechanical crash.
  // Otherwise a 25% "company" slice of −47% looks like a priced news impact and confuses EIS +score.
  let eisManualBoostPct = 0;
  if (
    !splitContaminationSuspect &&
    companyBoost > 0.05 &&
    Math.abs(afterMarket - eisPricedPct) > 0.2
  ) {
    const remain = afterMarket - eisPricedPct;
    const add = remain * companyBoost;
    // Cap absolute manual claim so it cannot dominate extreme days.
    const capped = Math.sign(add) * Math.min(Math.abs(add), 8);
    if (Math.abs(capped) > 0.05) {
      eisManualBoostPct = round1(capped);
    }
  }

  const eisExplainedPct = round1(eisPricedPct + eisManualBoostPct);

  afterMarket = observed - marketExplainedPct - eisExplainedPct;

  let modelExplainedPct = 0;
  const curveGap = finiteOrNull(args.curveGapPct);
  if (curveGap != null && Math.abs(afterMarket) > 0.2) {
    const towardModel = -curveGap * 0.15;
    const mag = Math.min(Math.abs(afterMarket), Math.abs(towardModel));
    if (mag > 0.1) {
      modelExplainedPct = round1(Math.sign(afterMarket || towardModel) * mag);
    }
  }

  const explainedPct = round1(marketExplainedPct + eisExplainedPct + modelExplainedPct);
  const unexplainedPct = round1(observed - explainedPct);
  const explainedSharePct =
    Math.abs(observed) > 0.05
      ? round1((Math.abs(explainedPct) / Math.abs(observed)) * 100)
      : 0;

  const eventCountInWindow = args.eventCountInWindow ?? 0;
  const manualNoteCount = args.manualNoteCount ?? 0;
  const marketOnly =
    Math.abs(marketExplainedPct) >= 0.05 &&
    Math.abs(eisExplainedPct) < 0.05 &&
    Math.abs(modelExplainedPct) < 0.05 &&
    eventCountInWindow === 0;
  const missingMarketAndEis =
    extAlign == null && eventCountInWindow === 0 && args.eisWindowScore == null;
  const lowConfidence = missingMarketAndEis || marketOnly;

  const needsInvestigation =
    !splitContaminationSuspect &&
    Math.abs(unexplainedPct) >= RESIDUAL_INVESTIGATION_THRESHOLD_PCT &&
    explainedSharePct < RESIDUAL_EXPLAINED_MIN_SHARE_PCT &&
    Math.abs(observed) >= 1.5;

  return {
    observedPct: round1(observed),
    marketExplainedPct,
    eisExplainedPct,
    eisPricedPct,
    eisManualBoostPct,
    modelExplainedPct,
    explainedPct,
    unexplainedPct,
    explainedSharePct,
    eventCountInWindow,
    manualNoteCount,
    flags: {
      needsInvestigation,
      splitContaminationSuspect,
      lowConfidence,
      marketOnly,
    },
  };
}

export function buildResidualMoveBreakdownForTicker(args: {
  ticker: string;
  observedPct: number | null | undefined;
  curveGapPct?: number | null;
  sdsRow?: SdsRow | null;
  lang?: "it" | "en";
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  recentDailyPcts?: (number | null | undefined)[];
}): ResidualMoveBreakdown | null {
  const lang = args.lang ?? "it";
  const cause = deriveCauseInputFromSdsRow(args.sdsRow ?? null);
  const eisWindowScore = computeEisFeedWindowScore(
    args.ticker,
    lang,
    null,
    null,
    args.clinicalRecords ?? null,
  );
  const eisWindow = sumSignedEisEventDelta(
    args.ticker,
    lang,
    7,
    args.clinicalRecords ?? null,
  );
  const manualDrafts = loadManualFeedEvents();
  const tk = args.ticker.trim().toUpperCase();
  const manualNoteCount =
    manualDrafts.filter((e) => e.ticker.trim().toUpperCase() === tk).length +
    eisWindow.manualCount;
  const latestAttr =
    latestTickerAttribution(
      manualDrafts.map((d) => ({
        ticker: d.ticker,
        createdAt: d.createdAt,
        attribution: resolveManualEventAttribution(d),
      })),
      args.ticker,
    ) ?? null;

  return buildResidualMoveBreakdown({
    observedPct: args.observedPct,
    externalAlignmentScore: cause?.externalAlignmentScore ?? null,
    eisWindowScore,
    eisEventDeltaSum: eisWindow.count > 0 ? eisWindow.sum : null,
    curveGapPct: args.curveGapPct,
    eventCountInWindow: eisWindow.count,
    manualNoteCount,
    recentDailyPcts: args.recentDailyPcts,
    manualMarketBoostShare: manualAttributionMarketBoostShare(latestAttr),
    manualCompanyBoostShare: manualAttributionCompanyBoostShare(latestAttr),
  });
}

export function formatResidualSummary(
  b: ResidualMoveBreakdown,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  if (b.flags.splitContaminationSuspect) {
    return it
      ? "Possibile split/reverse-split — verifica prezzi prima di attribuire"
      : "Possible split/reverse-split — validate prices before attributing";
  }
  const explained = b.explainedSharePct.toFixed(0);
  const resid = b.unexplainedPct >= 0 ? `+${b.unexplainedPct.toFixed(1)}` : b.unexplainedPct.toFixed(1);
  // Market-only = alignment score re-labeled as "% explained" — do not claim strong justification.
  if (b.flags.marketOnly) {
    const base = it
      ? `Quota XBI ~${explained}% (solo allineamento) · residuo ${resid}%`
      : `XBI share ~${explained}% (alignment only) · residual ${resid}%`;
    if (b.flags.needsInvestigation) {
      return it ? `${base} → indagine` : `${base} → investigate`;
    }
    return base;
  }
  const domLabel = residualDominantChannelLabel(b, lang);
  const domSuffix =
    domLabel != null
      ? it
        ? ` (${domLabel})`
        : ` (${domLabel})`
      : "";
  if (b.flags.needsInvestigation) {
    return it
      ? `Spiegato ${explained}%${domSuffix} · residuo ${resid}% → indagine`
      : `Explained ${explained}%${domSuffix} · residual ${resid}% → investigate`;
  }
  return it
    ? `Spiegato ${explained}%${domSuffix} · residuo ${resid}%`
    : `Explained ${explained}%${domSuffix} · residual ${resid}%`;
}

/**
 * Ultra-compact one-liner for dense tables (KPI Snapshot / Actions):
 *   EN → "Expl 108% · Res +0.1%"   (~20 chars)
 *   IT → "Spieg 108% · Res +0.1%"  (~22 chars)
 *   Market-only → "XBI ~81% · Res -0.2%" (honest label)
 *
 * Drops the dominant-channel breakdown and the "→ investigate" suffix —
 * both are already conveyed by the badge tone (rose/amber/emerald/slate) and
 * the full breakdown remains available in the `title` tooltip.
 */
export function formatResidualCompactSummary(
  b: ResidualMoveBreakdown,
  lang: "it" | "en",
): string {
  const it = lang === "it";
  if (b.flags.splitContaminationSuspect) {
    return it ? "Split? verifica" : "Split? verify";
  }
  const explained = b.explainedSharePct.toFixed(0);
  const resid = b.unexplainedPct >= 0 ? `+${b.unexplainedPct.toFixed(1)}` : b.unexplainedPct.toFixed(1);
  if (b.flags.marketOnly) {
    return `XBI ~${explained}% · Res ${resid}%`;
  }
  return it
    ? `Spieg ${explained}% · Res ${resid}%`
    : `Expl ${explained}% · Res ${resid}%`;
}
