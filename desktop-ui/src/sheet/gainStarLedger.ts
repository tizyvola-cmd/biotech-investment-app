/**
 * Manual EIS confirmation ★ — one active star per ticker until a new material
 * 24h price move (gain or drop) is detected.
 */
import {
  loadManualFeedEvents,
  resolveManualEventClassification,
  resolveManualEventEis,
  resolveManualEventPriceMovePct,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import { normalizeManualEisSessionDayKey } from "./manualEisMarkVisibility";
import { MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT } from "./manualFeedDropPrompt";
import { calendarDayKeyInTimeZone } from "./marketSession";

export const GAIN_STAR_LEDGER_STORAGE_KEY = "biotech.gain_star_ledger.v2";
export const GAIN_STAR_LEDGER_CHANGED_EVENT = "supernova:gain-star-ledger-changed";

export type GainStarSource = "manual";

export type GainStarEntry = {
  date: string;
  source: GainStarSource;
  eisScore: number;
  /** 0…4 — rotates through {@link GAIN_STAR_COLORS} */
  colorIndex: number;
  /** loss | gain — 24h investigation context when the star was earned */
  context: "loss" | "gain";
  /** Var.24h / price move when the star was earned — cleared on new material move. */
  anchorMovePct?: number | null;
};

export type GainStarDisplay = GainStarEntry & {
  color: string;
};

/** Five rotating colors — wraps after the fifth star. */
export const GAIN_STAR_COLORS = [
  "#eab308",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
] as const;

export const GAIN_STAR_COLOR_COUNT = GAIN_STAR_COLORS.length;

export function gainStarColorForIndex(colorIndex: number): string {
  return GAIN_STAR_COLORS[
    ((colorIndex % GAIN_STAR_COLOR_COUNT) + GAIN_STAR_COLOR_COUNT) % GAIN_STAR_COLOR_COUNT
  ]!;
}

export function toGainStarDisplay(entry: GainStarEntry): GainStarDisplay {
  return { ...entry, color: gainStarColorForIndex(entry.colorIndex) };
}

export type GainStarLedger = Record<string, GainStarEntry[]>;

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function normalizeEventDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function movePctFromManual(draft: ManualFeedEventDraft): number | null {
  const v = resolveManualEventPriceMovePct(draft);
  return v != null && Number.isFinite(v) ? v : null;
}

/** Resolve 24h investigation context (explicit field, price move, or cited +% in text). */
export function resolveManualInvestigationContext(
  draft: ManualFeedEventDraft,
): "loss" | "gain" | null {
  if (draft.investigationContext === "loss" || draft.investigationContext === "gain") {
    return draft.investigationContext;
  }
  const move = movePctFromManual(draft);
  if (move != null) {
    if (move > 0.5) return "gain";
    if (move < -0.5) return "loss";
  }
  const { investigationOutcome } = resolveManualEventClassification(draft);
  const eis = resolveManualEventEis(draft).score;
  if (investigationOutcome === "positive_catalyst" && eis > 0 && move != null && move > 0.5) {
    return "gain";
  }
  return null;
}

/**
 * Manual EIS from 24h tab qualifies for a daily ★ when a material catalyst was identified
 * for the detected loss or gain move.
 */
export function manualEventQualifiesForGainStarDay(draft: ManualFeedEventDraft): boolean {
  const context = resolveManualInvestigationContext(draft);
  if (!context) return false;

  const { investigationOutcome } = resolveManualEventClassification(draft);
  if (investigationOutcome === "no_catalyst" || investigationOutcome === "neutral") {
    return false;
  }

  const eis = resolveManualEventEis(draft).score;
  const move = movePctFromManual(draft);

  if (context === "gain") {
    if (investigationOutcome !== "positive_catalyst") return false;
    if (eis <= 0) return false;
    if (move != null) return move > 0.5;
    return true;
  }

  // loss investigation — material catalyst identified (negative explains drop, or positive recovery thesis)
  if (investigationOutcome === "negative_catalyst") {
    if (eis >= 0) return false;
    if (move != null) return move < -0.5;
    return true;
  }
  if (investigationOutcome === "positive_catalyst") {
    if (eis <= 0) return false;
    return true;
  }
  return false;
}

export function loadGainStarLedger(): GainStarLedger {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(GAIN_STAR_LEDGER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GainStarLedger;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveGainStarLedger(ledger: GainStarLedger): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GAIN_STAR_LEDGER_STORAGE_KEY, JSON.stringify(ledger));
  window.dispatchEvent(new CustomEvent(GAIN_STAR_LEDGER_CHANGED_EVENT));
  void import("./manualFeedPersistence").then((m) => m.scheduleManualFeedStoreDiskFlush());
}

/** Same ±% as manual-news flagging — checklist/★ clear on next material 24h move. */
const MATERIAL_MOVE_THRESHOLD_PCT = MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT;

/** True when current 24h move diverges materially from the anchored move (±threshold pp). */
export function isNewMaterialPriceMove(
  anchorMovePct: number,
  currentMovePct: number,
  threshold = MATERIAL_MOVE_THRESHOLD_PCT,
): boolean {
  if (!Number.isFinite(anchorMovePct) || !Number.isFinite(currentMovePct)) return false;
  return Math.abs(currentMovePct - anchorMovePct) >= threshold;
}

/** Star stays until a new material price move (gain or drop) is detected. */
export function gainStarStillAnchored(
  entry: GainStarEntry,
  currentMovePct: number | null | undefined,
): boolean {
  const anchor = entry.anchorMovePct;
  if (anchor == null || !Number.isFinite(anchor)) return true;
  if (currentMovePct == null || !Number.isFinite(currentMovePct)) return true;
  return !isNewMaterialPriceMove(anchor, currentMovePct);
}

function todayDateKey(ref = new Date()): string {
  return calendarDayKeyInTimeZone(ref, "America/New_York");
}

function ensureStarEntry(
  ledger: GainStarLedger,
  ticker: string,
  date: string,
  context: "loss" | "gain",
  eisScore: number,
  anchorMovePct: number | null,
): boolean {
  const tk = normalizeTicker(ticker);
  if (!tk || !date) return false;
  const list = [...(ledger[tk] ?? [])];
  const existingIdx = list.findIndex((s) => s.date === date);
  if (existingIdx >= 0) {
    const existing = list[existingIdx]!;
    if (
      existing.eisScore !== eisScore ||
      existing.context !== context ||
      existing.anchorMovePct !== anchorMovePct
    ) {
      list[existingIdx] = { ...existing, eisScore, context, anchorMovePct };
      ledger[tk] = list;
      return true;
    }
    return false;
  }
  const colorIndex = list.length % GAIN_STAR_COLOR_COUNT;
  list.push({
    date,
    source: "manual",
    eisScore,
    colorIndex,
    context,
    anchorMovePct,
  });
  list.sort((a, b) => a.date.localeCompare(b.date));
  ledger[tk] = list;
  return true;
}

/** Scan manual 24h EIS entries and rebuild daily stars (idempotent per session date). */
export function refreshGainStarLedger(): boolean {
  const prev = loadGainStarLedger();
  const ledger: GainStarLedger = {};

  for (const draft of loadManualFeedEvents()) {
    if (!manualEventQualifiesForGainStarDay(draft)) continue;
    const rawDate = normalizeEventDate(draft.eventDate);
    const context = resolveManualInvestigationContext(draft);
    if (!rawDate || !context) continue;
    const date = normalizeManualEisSessionDayKey(rawDate);
    const eis = resolveManualEventEis(draft).score;
    if (eis <= 0) continue;
    const anchor = movePctFromManual(draft);
    ensureStarEntry(ledger, draft.ticker, date, context, eis, anchor);
  }

  const changed = JSON.stringify(prev) !== JSON.stringify(ledger);
  if (changed) saveGainStarLedger(ledger);
  return changed;
}

function latestAnchoredEntry(
  entries: GainStarEntry[],
  currentMovePct?: number | null,
): GainStarEntry | null {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of sorted) {
    if (entry.eisScore <= 0) continue;
    if (gainStarStillAnchored(entry, currentMovePct)) return entry;
  }
  return null;
}

/** Latest ★ for ticker — persists until a new material 24h price move. */
export function getTickerGainStars(
  ticker: string,
  currentMovePct24h?: number | null,
  ref: Date = new Date(),
): GainStarDisplay[] {
  void ref;
  refreshGainStarLedger();
  const tk = normalizeTicker(ticker);
  if (!tk) return [];
  const entry = latestAnchoredEntry(loadGainStarLedger()[tk] ?? [], currentMovePct24h);
  return entry ? [toGainStarDisplay(entry)] : [];
}

export function buildGainStarByTickerMap(
  ref: Date = new Date(),
  movePctByTicker?: Map<string, number | null>,
): Map<string, GainStarDisplay[]> {
  refreshGainStarLedger();
  const ledger = loadGainStarLedger();
  const out = new Map<string, GainStarDisplay[]>();
  for (const [tk, entries] of Object.entries(ledger)) {
    const move = movePctByTicker?.get(tk) ?? null;
    const active = latestAnchoredEntry(entries, move);
    if (active) out.set(tk, [toGainStarDisplay(active)]);
  }
  void ref;
  return out;
}

/** @deprecated Use getTickerGainStars(ticker).length > 0 */
export function tickerHasGainStar(
  ticker: string,
  currentMovePct24h?: number | null,
  ref?: Date,
): boolean {
  return getTickerGainStars(ticker, currentMovePct24h, ref).length > 0;
}

/** Snapshot payload for mobile sync — anchored stars only. */
export function exportGainStarsForSnapshot(ref: Date = new Date()): Record<string, GainStarDisplay[]> {
  refreshGainStarLedger();
  const ledger = loadGainStarLedger();
  const out: Record<string, GainStarDisplay[]> = {};
  for (const [tk, entries] of Object.entries(ledger)) {
    const active = latestAnchoredEntry(entries, null);
    if (active) out[tk] = [toGainStarDisplay(active)];
  }
  void ref;
  return out;
}

export { todayDateKey as gainStarTodayDateKey };
