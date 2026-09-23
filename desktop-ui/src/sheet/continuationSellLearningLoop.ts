/**
 * Continuation sell learning loop — freeze G10/edge signals, score the
 * 5-session drawdown label (same as prediction/continuation_score.py), and
 * stretch the live edge threshold from realised hit rates.
 */

import type { ChartPoint } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import {
  P_CONT_SELL_MIN_G10,
  resolveContG10,
  resolveContPBase,
  resolveContSellEdge,
  resolvePContinuation,
} from "./continuationScore";
import {
  CONT_SELL_STRETCH_BASELINE,
  clipContSellEdgeMin,
  clipContSellEdgeStretch,
  contSellPassesStretch,
  defaultContSellStretchState,
  emitContSellLearningChanged,
  loadContSellStretchState,
  resolveContSellStretchThresholds,
  saveContSellStretchState,
  type ContSellStretchProposal,
  type ContSellStretchState,
  type ContSellStretchThresholds,
} from "./continuationSellStretchStore";
import { parseMonitorIsoWeek } from "./modelEvolution";

export {
  CONT_SELL_LEARNING_CHANGED_EVENT,
  CONT_SELL_STRETCH_BASELINE,
  contSellPassesStretch,
  loadContSellStretchState,
  resolveContSellStretchThresholds,
  type ContSellStretchProposal,
  type ContSellStretchState,
  type ContSellStretchThresholds,
} from "./continuationSellStretchStore";

export const CONT_SELL_LEARNING_SIGNALS_KEY = "supernova.contSellLearning.signals.v1";

/** Match Python FORWARD_H / DRAWDOWN_Y_PCT. */
export const CONT_SELL_FORWARD_H = 5;
export const CONT_SELL_DRAWDOWN_Y_PCT = 5;
export const CONT_SELL_LEARNING_MIN_SCORED = 8;
export const CONT_SELL_LEARNING_LOW_HIT = 0.45;
export const CONT_SELL_LEARNING_HIGH_HIT = 0.65;
export const CONT_SELL_EDGE_MIN_STEP = 1;
export const CONT_SELL_MAX_SIGNALS = 500;

export type ContSellSignalKind = "exhaustion" | "declining_loss" | "not_run_loss";

export type ContSellSignalFreeze = {
  id: string;
  key: string;
  ticker: string;
  asofDay: string;
  kind: ContSellSignalKind;
  g10: number;
  edge: number | null;
  pCont: number | null;
  pBase: number | null;
  priceAtFreeze: number;
  freezeOffset: number;
  /** True when max drawdown from freeze close ≤ −5% within 5 sessions. */
  hit: boolean | null;
  maxDrawdownPct: number | null;
  forwardMovePct: number | null;
  scoredAt: string | null;
};

export type ContSellDayQualityPoint = {
  day: string;
  label: string;
  rawHitPct: number | null;
  stretchHitPct: number | null;
  rawN: number;
  stretchN: number;
};

export type ContSellLearningView = {
  signals: ContSellSignalFreeze[];
  pendingScoreN: number;
  scoredN: number;
  rawHitPct: number | null;
  stretchHitPct: number | null;
  stretch: ContSellStretchState;
  daySeries: ContSellDayQualityPoint[];
  verdict: "improved" | "worse" | "neutral" | "unknown";
  deltaPp: number | null;
};

function calendarDayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pricePtsFromChart(
  points: ChartPoint[] | null | undefined,
): Array<{ offset: number; y: number }> {
  if (!points?.length) return [];
  return points
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));
}

function rate(good: number, n: number): number | null {
  if (n < 1) return null;
  return Math.round((good / n) * 1000) / 10;
}

function ls(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function loadContSellSignals(): ContSellSignalFreeze[] {
  const store = ls();
  if (!store) return [];
  try {
    const raw = store.getItem(CONT_SELL_LEARNING_SIGNALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContSellSignalFreeze[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveContSellSignals(rows: ContSellSignalFreeze[]): void {
  const store = ls();
  if (!store) return;
  store.setItem(
    CONT_SELL_LEARNING_SIGNALS_KEY,
    JSON.stringify(rows.slice(-CONT_SELL_MAX_SIGNALS)),
  );
}

export function scoreContSellDrawdownFromChart(
  chartPts: ChartPoint[] | null | undefined,
  freezeOffset: number,
  priceAtFreeze: number,
): { maxDrawdownPct: number; forwardMovePct: number | null; hit: boolean } | null {
  if (!(priceAtFreeze > 0) || !Number.isFinite(freezeOffset)) return null;
  const pricePts = pricePtsFromChart(chartPts);
  if (pricePts.length < 2) return null;
  // Next CONT_SELL_FORWARD_H session bars after freeze (no interpolate fill).
  const after = pricePts
    .filter((p) => p.offset > freezeOffset)
    .sort((a, b) => a.offset - b.offset);
  if (after.length < CONT_SELL_FORWARD_H) return null;
  const window = after.slice(0, CONT_SELL_FORWARD_H);
  let minP = priceAtFreeze;
  for (const p of window) {
    if (p.y < minP) minP = p.y;
  }
  const endP = window[CONT_SELL_FORWARD_H - 1]!.y;
  const maxDrawdownPct = Math.round((minP / priceAtFreeze - 1) * 1000) / 10;
  const forwardMovePct = Math.round((endP / priceAtFreeze - 1) * 1000) / 10;
  return {
    maxDrawdownPct,
    forwardMovePct,
    hit: maxDrawdownPct <= -CONT_SELL_DRAWDOWN_Y_PCT,
  };
}

function resolveFreezePrice(
  row: Record<string, unknown>,
  chartPts: ChartPoint[] | null | undefined,
): { price: number; offset: number } | null {
  const offset = completionDateToNowOffset(row["Completion Date"]);
  if (offset == null || !Number.isFinite(offset)) return null;
  const pricePts = pricePtsFromChart(chartPts);
  const fromChart = interpolateAtOffset(pricePts, offset);
  if (fromChart != null && fromChart > 0) return { price: fromChart, offset };
  const sheet = Number(row["Current Price"] ?? row["Price"] ?? row["Last"]);
  if (Number.isFinite(sheet) && sheet > 0) return { price: sheet, offset };
  return null;
}

function classifyFreezeKind(
  g10: number,
  hasPosition: boolean,
  pnlPct: number | null,
): ContSellSignalKind | null {
  if (g10 >= P_CONT_SELL_MIN_G10) return "exhaustion";
  if (!hasPosition || pnlPct == null || pnlPct >= 0) return null;
  if (g10 < 0) return "declining_loss";
  if (g10 < P_CONT_SELL_MIN_G10) return "not_run_loss";
  return null;
}

export type ContSellFreezeInput = {
  key: string;
  ticker: string;
  simRow: Record<string, unknown>;
  chartPts?: ChartPoint[] | null;
  hasPosition?: boolean;
  pnlPct?: number | null;
};

/** Upsert today's freezes from live Simulation rows. */
export function freezeContSellSignalsFromRows(
  rows: readonly ContSellFreezeInput[],
  asofDay: string = calendarDayKey(),
): ContSellSignalFreeze[] {
  const existing = loadContSellSignals();
  const byId = new Map(existing.map((s) => [s.id, s]));
  let changed = false;

  for (const row of rows) {
    const g10 = resolveContG10(row.simRow);
    if (g10 == null) continue;
    const kind = classifyFreezeKind(
      g10,
      Boolean(row.hasPosition),
      row.pnlPct ?? null,
    );
    if (!kind) continue;
    if (kind === "exhaustion") {
      const edge = resolveContSellEdge(row.simRow);
      if (edge == null) continue;
    }
    const px = resolveFreezePrice(row.simRow, row.chartPts);
    if (!px) continue;
    const id = `${row.key}|${asofDay}|${kind}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      key: row.key,
      ticker: row.ticker.trim().toUpperCase(),
      asofDay,
      kind,
      g10,
      edge: resolveContSellEdge(row.simRow),
      pCont: resolvePContinuation(row.simRow),
      pBase: resolveContPBase(row.simRow),
      priceAtFreeze: px.price,
      freezeOffset: px.offset,
      hit: null,
      maxDrawdownPct: null,
      forwardMovePct: null,
      scoredAt: null,
    });
    changed = true;
  }

  const next = [...byId.values()].sort((a, b) => a.asofDay.localeCompare(b.asofDay));
  if (changed) {
    saveContSellSignals(next);
    emitContSellLearningChanged();
  }
  return next;
}

/** Score pending freezes when 5 forward sessions exist on the chart. */
export function scorePendingContSellSignals(
  chartByKey: Map<string, ChartPoint[] | null | undefined>,
): ContSellSignalFreeze[] {
  const signals = loadContSellSignals();
  let changed = false;
  const next = signals.map((s) => {
    if (s.hit != null) return s;
    const pts = chartByKey.get(s.key) ?? null;
    const scored = scoreContSellDrawdownFromChart(pts, s.freezeOffset, s.priceAtFreeze);
    if (!scored) return s;
    changed = true;
    const hit =
      s.kind === "exhaustion"
        ? scored.hit
        : scored.forwardMovePct != null && scored.forwardMovePct <= -0.5
          ? true
          : scored.maxDrawdownPct <= -2;
    return {
      ...s,
      hit,
      maxDrawdownPct: scored.maxDrawdownPct,
      forwardMovePct: scored.forwardMovePct,
      scoredAt: new Date().toISOString(),
    };
  });
  if (changed) {
    saveContSellSignals(next);
    emitContSellLearningChanged();
  }
  return next;
}

function hitRateFor(
  signals: ContSellSignalFreeze[],
  predicate: (s: ContSellSignalFreeze) => boolean,
): { hitPct: number | null; n: number; good: number } {
  let good = 0;
  let n = 0;
  for (const s of signals) {
    if (s.hit == null || !predicate(s)) continue;
    n += 1;
    if (s.hit) good += 1;
  }
  return { hitPct: rate(good, n), n, good };
}

export function proposeContSellStretch(
  signals: ContSellSignalFreeze[] = loadContSellSignals(),
  current: ContSellStretchThresholds = resolveContSellStretchThresholds(),
): ContSellStretchProposal | null {
  const exhaustion = signals.filter(
    (s) => s.kind === "exhaustion" && s.hit != null && s.edge != null,
  );
  if (exhaustion.length < CONT_SELL_LEARNING_MIN_SCORED) return null;

  const underApplied = exhaustion.filter((s) =>
    contSellPassesStretch({ g10: s.g10, edge: s.edge }, current, P_CONT_SELL_MIN_G10),
  );
  const { hitPct, n, good } = hitRateFor(underApplied, () => true);
  if (n < CONT_SELL_LEARNING_MIN_SCORED || hitPct == null) return null;

  const hitRate = good / n;
  let nextEdgeMin = current.edgeMin;
  let nextStretch = current.edgeStretch;
  let reason = "";
  let reasonIt = "";

  if (hitRate < CONT_SELL_LEARNING_LOW_HIT) {
    nextEdgeMin = clipContSellEdgeMin(current.edgeMin + CONT_SELL_EDGE_MIN_STEP);
    reason = `Hit rate ${hitPct}% on n=${n} sell-edge signals — raise edge min to cut false positives.`;
    reasonIt = `Hit rate ${hitPct}% su n=${n} segnali edge — alza edge min per ridurre falsi positivi.`;
  } else if (hitRate > CONT_SELL_LEARNING_HIGH_HIT && current.edgeMin > 0) {
    nextEdgeMin = clipContSellEdgeMin(current.edgeMin - CONT_SELL_EDGE_MIN_STEP);
    reason = `Hit rate ${hitPct}% on n=${n} — edge min can ease slightly.`;
    reasonIt = `Hit rate ${hitPct}% su n=${n} — edge min può allentarsi.`;
  } else if (hitRate > CONT_SELL_LEARNING_HIGH_HIT && current.edgeStretch < 1.15) {
    nextStretch = clipContSellEdgeStretch(current.edgeStretch + 0.05);
    reason = `Strong hit rate ${hitPct}% — slight edge stretch to catch more exhaustion.`;
    reasonIt = `Hit rate forte ${hitPct}% — lieve stretch edge per catturare più esaurimento.`;
  } else {
    return null;
  }

  const to: ContSellStretchThresholds = {
    edgeMin: nextEdgeMin,
    edgeStretch: nextStretch,
    g10MinOffset: current.g10MinOffset,
  };
  if (
    to.edgeMin === current.edgeMin &&
    to.edgeStretch === current.edgeStretch &&
    to.g10MinOffset === current.g10MinOffset
  ) {
    return null;
  }

  return {
    from: { ...current },
    to,
    reason,
    reasonIt,
    evidenceN: n,
    hitRate,
    computedAt: new Date().toISOString(),
  };
}

export function evaluateContSellStretchProposals(
  signals: ContSellSignalFreeze[] = loadContSellSignals(),
): ContSellStretchState {
  const state = loadContSellStretchState();
  const pending = proposeContSellStretch(signals, state.applied);
  const scoredN = signals.filter((s) => s.hit != null).length;
  const next: ContSellStretchState = {
    ...state,
    pending,
    lastEvaluatedAt: new Date().toISOString(),
    lastScoredN: scoredN,
  };
  saveContSellStretchState(next);
  emitContSellLearningChanged();
  return next;
}

export function applyContSellStretchProposal(): ContSellStretchState {
  const state = loadContSellStretchState();
  if (!state.pending) return state;
  const next: ContSellStretchState = {
    ...state,
    applied: { ...state.pending.to },
    pending: null,
    lastEvaluatedAt: new Date().toISOString(),
  };
  saveContSellStretchState(next);
  emitContSellLearningChanged();
  return next;
}

export function revertContSellStretch(): ContSellStretchState {
  const next: ContSellStretchState = {
    ...defaultContSellStretchState(),
    lastEvaluatedAt: new Date().toISOString(),
  };
  saveContSellStretchState(next);
  emitContSellLearningChanged();
  return next;
}

function buildDaySeries(
  signals: ContSellSignalFreeze[],
  stretch: ContSellStretchThresholds,
): ContSellDayQualityPoint[] {
  const byDay = new Map<string, ContSellSignalFreeze[]>();
  for (const s of signals) {
    if (s.hit == null || s.kind !== "exhaustion") continue;
    const arr = byDay.get(s.asofDay) ?? [];
    arr.push(s);
    byDay.set(s.asofDay, arr);
  }
  return [...byDay.keys()]
    .sort()
    .slice(-28)
    .map((day) => {
      const rows = byDay.get(day) ?? [];
      const raw = hitRateFor(rows, (s) =>
        contSellPassesStretch(
          { g10: s.g10, edge: s.edge },
          CONT_SELL_STRETCH_BASELINE,
          P_CONT_SELL_MIN_G10,
        ),
      );
      const stretched = hitRateFor(rows, (s) =>
        contSellPassesStretch({ g10: s.g10, edge: s.edge }, stretch, P_CONT_SELL_MIN_G10),
      );
      const [, m, d] = day.split("-");
      return {
        day,
        label: `${d}/${m}`,
        rawHitPct: raw.hitPct,
        stretchHitPct: stretched.hitPct,
        rawN: raw.n,
        stretchN: stretched.n,
      };
    });
}

export function buildContSellLearningView(
  signals: ContSellSignalFreeze[] = loadContSellSignals(),
  stretchState: ContSellStretchState = loadContSellStretchState(),
): ContSellLearningView {
  const scored = signals.filter((s) => s.hit != null);
  const pendingScoreN = signals.filter((s) => s.hit == null).length;
  const exhaustionScored = scored.filter((s) => s.kind === "exhaustion");
  const raw = hitRateFor(exhaustionScored, (s) =>
    contSellPassesStretch(
      { g10: s.g10, edge: s.edge },
      CONT_SELL_STRETCH_BASELINE,
      P_CONT_SELL_MIN_G10,
    ),
  );
  const stretched = hitRateFor(exhaustionScored, (s) =>
    contSellPassesStretch(
      { g10: s.g10, edge: s.edge },
      stretchState.applied,
      P_CONT_SELL_MIN_G10,
    ),
  );
  let deltaPp: number | null = null;
  let verdict: ContSellLearningView["verdict"] = "unknown";
  if (raw.hitPct != null && stretched.hitPct != null) {
    deltaPp = Math.round((stretched.hitPct - raw.hitPct) * 10) / 10;
    if (deltaPp >= 2) verdict = "improved";
    else if (deltaPp <= -2) verdict = "worse";
    else verdict = "neutral";
  }
  return {
    signals,
    pendingScoreN,
    scoredN: scored.length,
    rawHitPct: raw.hitPct,
    stretchHitPct: stretched.hitPct,
    stretch: stretchState,
    daySeries: buildDaySeries(signals, stretchState.applied),
    verdict,
    deltaPp,
  };
}

/** Full tick: freeze → score → propose → view. */
export function runContSellLearningLoop(opts: {
  rows: readonly ContSellFreezeInput[];
  chartByKey: Map<string, ChartPoint[] | null | undefined>;
}): ContSellLearningView {
  freezeContSellSignalsFromRows(opts.rows);
  const scored = scorePendingContSellSignals(opts.chartByKey);
  const stretch = evaluateContSellStretchProposals(scored);
  return buildContSellLearningView(scored, stretch);
}

export function contSellLearningWeekKey(iso: string = new Date().toISOString()): string | null {
  return parseMonitorIsoWeek(iso)?.key ?? null;
}
