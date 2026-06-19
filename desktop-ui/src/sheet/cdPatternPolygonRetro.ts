/**
 * Retro polygon match for watch-enter backtest — loads Python export or falls back to score_v4 proxy.
 */
import type { BacktestAnchorId } from "./watchZoneEnterBacktest";

export type PolygonMatchRow = {
  ticker?: string;
  completion_date?: string;
  match_m60?: number | null;
  match_m30?: number | null;
  match_m10?: number | null;
};

export type BacktestPolygonMatchMap = Record<string, PolygonMatchRow>;

const ANCHOR_MATCH_FIELD: Record<BacktestAnchorId, keyof PolygonMatchRow> = {
  "T-90": "match_m60",
  "T-30": "match_m30",
  "T-14": "match_m10",
};

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** score_v4 overstates polygon match — dampen when retro export is missing. */
export function matchPctFromScoreProxy(scoreV4: number | null | undefined): number | null {
  const score = num(scoreV4);
  if (score == null) return null;
  return Math.round(Math.min(100, score * 0.88));
}

export function resolveBacktestPolygonMatchPct(
  ticker: string,
  completionDate: string,
  anchor: BacktestAnchorId,
  map: BacktestPolygonMatchMap | null | undefined,
  fallbackScoreV4?: number | null,
): { matchPct: number | null; source: "polygon" | "proxy" | "none" } {
  const key = `${ticker.trim().toUpperCase()}|${completionDate.slice(0, 10)}`;
  const field = ANCHOR_MATCH_FIELD[anchor];
  const hit = map?.[key];
  const retro = hit ? num(hit[field]) : null;
  if (retro != null) {
    return { matchPct: Math.round(retro * 10) / 10, source: "polygon" };
  }
  const proxy = matchPctFromScoreProxy(fallbackScoreV4);
  if (proxy != null) {
    return { matchPct: proxy, source: "proxy" };
  }
  return { matchPct: null, source: "none" };
}

export function parseBacktestPolygonMatchDoc(raw: unknown): BacktestPolygonMatchMap {
  if (!raw || typeof raw !== "object") return {};
  const doc = raw as { rows?: Record<string, PolygonMatchRow> };
  return doc.rows && typeof doc.rows === "object" ? doc.rows : {};
}
