import type { ExperimentAdviceEvent } from "./investDecisionSimExperiment";
import type { DecisionSimTick } from "./investDecisionSimLoop";
import { miiGainScale } from "./recommendationGainIdea";

/** Legacy open-position thresholds (experiment log). */
export const ADVICE_CALIB_GOOD_PNL_PCT = 2;
export const ADVICE_CALIB_BAD_PNL_PCT = -3;
/** BUY: stock must rise at least this much to count as correct. */
export const ADVICE_CALIB_BUY_MIN_UP_PCT = 0.5;
/** SELL: stock must fall at least this much to count as correct. */
export const ADVICE_CALIB_SELL_MIN_DOWN_PCT = -0.5;
/** HOLD / review: |move| must stay within this band to count as correct. */
export const ADVICE_CALIB_HOLD_FLAT_BAND_PCT = 2;
export const ADVICE_CALIB_LOW_PROB_MAX = 59;
export const ADVICE_CALIB_HIGH_PROB_MIN = 70;

export const ADVICE_CALIB_MIN_SCORED_FOR_RATE = 3;

export type AdviceOutcomeClass = "good" | "bad" | "pending";

export type AdviceCalibBucketId = "lt50" | "50-59" | "60-69" | "70-79" | "80+";

export type AdviceCalibBucketDef = {
  id: AdviceCalibBucketId;
  labelEn: string;
  labelIt: string;
  min: number;
  max: number;
  mid: number;
};

export const ADVICE_CALIB_BUCKETS: AdviceCalibBucketDef[] = [
  { id: "lt50", labelEn: "<50%", labelIt: "<50%", min: 0, max: 49.999, mid: 45 },
  { id: "50-59", labelEn: "50–59%", labelIt: "50–59%", min: 50, max: 59.999, mid: 55 },
  { id: "60-69", labelEn: "60–69%", labelIt: "60–69%", min: 60, max: 69.999, mid: 65 },
  { id: "70-79", labelEn: "70–79%", labelIt: "70–79%", min: 70, max: 79.999, mid: 75 },
  { id: "80+", labelEn: "80%+", labelIt: "80%+", min: 80, max: 100, mid: 85 },
];

export type AdviceActionKind = "buy" | "sell" | "hold" | "review";

export type AdviceCalibrationPoint = {
  id: string;
  ticker: string;
  probPct: number;
  bucketId: AdviceCalibBucketId;
  bucketLabel: string;
  outcome: AdviceOutcomeClass;
  pnlPct: number | null;
  /** Stock move used to score the advice (usually 24h %). */
  priceChangePct: number | null;
  /** Signed expected move at advice time (%). */
  expectedReturnPct: number | null;
  /** actual − expected (%): positive = beat forecast, negative = missed. */
  forecastErrorPct: number | null;
  suggestedAction: AdviceActionKind;
  source: "experiment" | "live";
  kind: string;
  at: string;
};

export type AdviceCalibrationBucketRow = {
  bucketId: AdviceCalibBucketId;
  bucketLabel: string;
  bucketMid: number;
  count: number;
  goodCount: number;
  badCount: number;
  pendingCount: number;
  /** % buoni su (buoni + cattivi) — null se nessun esito netto. */
  successRatePct: number | null;
  /** P(plan) media nel bucket. */
  avgProbPct: number | null;
};

export type AdviceCalibrationSummary = {
  lowProb: { count: number; good: number; bad: number; successRatePct: number | null };
  highProb: { count: number; good: number; bad: number; successRatePct: number | null };
  scoredCount: number;
  pendingCount: number;
  goodCount: number;
  badCount: number;
  /** % buoni su (buoni + cattivi) — stesso criterio del grafico P(plan) vs forecast error. */
  overallSuccessRatePct: number | null;
};

/** One dot in the forecast-error scatter (X = P(plan), Y = forecast error %). */
export type AdviceForecastErrorDot = {
  id: string;
  ticker: string;
  probPct: number;
  x: number;
  y: number;
  forecastErrorPct: number;
  expectedReturnPct: number;
  actualReturnPct: number;
  outcome: AdviceOutcomeClass;
  suggestedAction: AdviceActionKind;
  bucketLabel: string;
};

/** @deprecated Use AdviceForecastErrorDot — legacy good/bad jitter plot. */
export type AdviceCalibrationDotRow = {
  id: string;
  ticker: string;
  probPct: number;
  x: number;
  y: number;
  outcome: "good" | "bad";
  pnlPct: number | null;
  priceChangePct: number | null;
  suggestedAction: AdviceActionKind;
  bucketLabel: string;
};

/** Signed expected stock move implied by the recommendation. */
export function signedExpectedReturnForAdvice(
  action: AdviceActionKind,
  planReturnPct: number | null | undefined,
  miiAngleDeg?: number | null,
): number | null {
  if (action === "hold" || action === "review") return 0;
  if (planReturnPct == null || !Number.isFinite(planReturnPct)) return null;

  if (action === "buy") {
    if (planReturnPct <= 0) return null;
    const scale =
      miiAngleDeg != null && Number.isFinite(miiAngleDeg) ? miiGainScale(miiAngleDeg) : 1;
    return Math.round(planReturnPct * scale * 10) / 10;
  }
  if (action === "sell") {
    if (planReturnPct < 0) return Math.round(planReturnPct * 10) / 10;
    return Math.round(-Math.abs(planReturnPct) * 0.35 * 10) / 10;
  }
  return null;
}

/** Forecast error = actual stock move − signed expected move (%). */
export function computeAdviceForecastErrorPct(
  action: AdviceActionKind,
  planReturnPct: number | null | undefined,
  actualReturnPct: number | null | undefined,
  miiAngleDeg?: number | null,
): { expectedReturnPct: number | null; forecastErrorPct: number | null } {
  const expectedReturnPct = signedExpectedReturnForAdvice(action, planReturnPct, miiAngleDeg);
  if (expectedReturnPct == null || actualReturnPct == null || !Number.isFinite(actualReturnPct)) {
    return { expectedReturnPct, forecastErrorPct: null };
  }
  return {
    expectedReturnPct,
    forecastErrorPct: Math.round((actualReturnPct - expectedReturnPct) * 10) / 10,
  };
}

function resolveExpectedReturnFromTick(
  event: Pick<ExperimentAdviceEvent, "tickId" | "key">,
  ticks: DecisionSimTick[],
  action: AdviceActionKind,
): number | null {
  const tick = ticks.find((t) => t.id === event.tickId);
  const ev = tick?.evaluations.find((e) => e.key === event.key);
  const raw = ev?.planReturnPct ?? ev?.readings.planTargetPct ?? null;
  return signedExpectedReturnForAdvice(action, raw);
}

/** Y-axis value for scatter — uses forecast error when available, else scored SELL/BUY fallback. */
export function scatterYForAdvicePoint(p: AdviceCalibrationPoint): number | null {
  if (p.forecastErrorPct != null && Number.isFinite(p.forecastErrorPct)) {
    return p.forecastErrorPct;
  }
  if (p.outcome !== "good" && p.outcome !== "bad") return null;
  if (p.priceChangePct == null || !Number.isFinite(p.priceChangePct)) return null;
  const expected = p.expectedReturnPct ?? (p.suggestedAction === "sell" ? 0 : null);
  if (expected == null || !Number.isFinite(expected)) return null;
  return Math.round((p.priceChangePct - expected) * 10) / 10;
}

function applySellForecastFallback(
  action: AdviceActionKind,
  priceChangePct: number | null,
  expectedReturnPct: number | null,
  forecastErrorPct: number | null,
): { expectedReturnPct: number | null; forecastErrorPct: number | null } {
  if (
    action !== "sell" ||
    forecastErrorPct != null ||
    priceChangePct == null ||
    !Number.isFinite(priceChangePct)
  ) {
    return { expectedReturnPct, forecastErrorPct };
  }
  const expected = expectedReturnPct ?? 0;
  return {
    expectedReturnPct: expected,
    forecastErrorPct: Math.round((priceChangePct - expected) * 10) / 10,
  };
}

/** Only use live Var. Giorn. % when the sell is too recent for a follow-up tick. */
const POST_SELL_LIVE_FALLBACK_MAX_AGE_MS = 36 * 3_600_000;

function resolvePostSellMove24h(
  ticks: DecisionSimTick[],
  tickIdx: number,
  key: string,
  liveFallback: (key: string) => number | null,
): number | null {
  const tick = ticks[tickIdx];
  if (!tick) return null;

  // Post-sell move must come from a *later* tick — never the sell tick itself
  // (at-sell pnlPct24h is pre-exit momentum and wrongly inflates ✗ counts).
  for (let j = tickIdx + 1; j < ticks.length; j++) {
    const nextEv = ticks[j]?.evaluations.find((e) => e.key === key);
    if (nextEv?.pnlPct24h != null && Number.isFinite(nextEv.pnlPct24h)) {
      return nextEv.pnlPct24h;
    }
  }

  const sellAt = tick.at ?? tick.trades.find((tr) => tr.key === key && tr.side === "sell")?.at;
  if (sellAt) {
    const ageMs = Date.now() - Date.parse(sellAt);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= POST_SELL_LIVE_FALLBACK_MAX_AGE_MS) {
      return liveFallback(key);
    }
  }
  return null;
}

export function buildAdviceForecastErrorScatter(
  points: AdviceCalibrationPoint[],
): AdviceForecastErrorDot[] {
  const eligible = points.filter((p) => {
    const y = scatterYForAdvicePoint(p);
    return y != null && Number.isFinite(y);
  });
  const sorted = [...eligible].sort((a, b) => a.probPct - b.probPct);
  const out: AdviceForecastErrorDot[] = [];
  let group: AdviceCalibrationPoint[] = [];
  let groupCenter = -999;

  const flush = () => {
    if (!group.length) return;
    const n = group.length;
    group.forEach((p, i) => {
      const y = scatterYForAdvicePoint(p)!;
      const xSpread = n <= 1 ? 0 : ((i / (n - 1)) * 2 - 1) * 2.5;
      out.push({
        id: p.id,
        ticker: p.ticker,
        probPct: p.probPct,
        x: Math.max(0, Math.min(100, p.probPct + xSpread)),
        y,
        forecastErrorPct: y,
        expectedReturnPct: p.expectedReturnPct ?? 0,
        actualReturnPct: p.priceChangePct ?? 0,
        outcome: p.outcome,
        suggestedAction: p.suggestedAction,
        bucketLabel: p.bucketLabel,
      });
    });
  };

  for (const p of sorted) {
    if (group.length === 0 || Math.abs(p.probPct - groupCenter) <= 3) {
      group.push(p);
      groupCenter = group.reduce((s, x) => s + x.probPct, 0) / group.length;
      continue;
    }
    flush();
    group = [p];
    groupCenter = p.probPct;
  }
  flush();
  return out.sort((a, b) => a.x - b.x);
}

function jitterAdviceDotGroup(group: AdviceCalibrationPoint[]): AdviceCalibrationDotRow[] {
  const sorted = [...group].sort((a, b) => a.probPct - b.probPct);
  const n = sorted.length;
  const maxXJitter = 5;
  const maxYJitter = 10;
  return sorted.map((p, i) => {
    const baseY = p.outcome === "good" ? 100 : 0;
    const xSpread = n <= 1 ? 0 : ((i / (n - 1)) * 2 - 1) * maxXJitter;
    const ySpread =
      n <= 1 ? 0 : (Math.floor(i / 2) % 2 === 0 ? 1 : -1) * ((i % 3) + 1) * (maxYJitter / 3);
    return {
      id: p.id,
      ticker: p.ticker,
      probPct: p.probPct,
      x: Math.max(0, Math.min(100, p.probPct + xSpread)),
      y: Math.max(-8, Math.min(108, baseY + ySpread)),
      outcome: p.outcome === "good" ? "good" : "bad",
      pnlPct: p.pnlPct,
      priceChangePct: p.priceChangePct,
      suggestedAction: p.suggestedAction,
      bucketLabel: p.bucketLabel,
    };
  });
}

export function buildAdviceCalibrationDotplot(
  points: AdviceCalibrationPoint[],
): AdviceCalibrationDotRow[] {
  const scored = points.filter((p) => p.outcome === "good" || p.outcome === "bad");
  const sorted = [...scored].sort((a, b) => a.probPct - b.probPct);
  const out: AdviceCalibrationDotRow[] = [];
  let group: AdviceCalibrationPoint[] = [];
  let groupCenter = -999;

  for (const p of sorted) {
    if (group.length === 0 || Math.abs(p.probPct - groupCenter) <= 4) {
      group.push(p);
      groupCenter = group.reduce((s, x) => s + x.probPct, 0) / group.length;
      continue;
    }
    out.push(...jitterAdviceDotGroup(group));
    group = [p];
    groupCenter = p.probPct;
  }
  if (group.length) out.push(...jitterAdviceDotGroup(group));
  return out.sort((a, b) => a.x - b.x);
}

const SCORED_KINDS = new Set<ExperimentAdviceEvent["kind"]>([
  "good_buy",
  "bad_buy",
  "good_sell",
  "bad_sell",
]);

export function adviceKindToOutcome(kind: ExperimentAdviceEvent["kind"]): AdviceOutcomeClass | null {
  if (kind === "good_buy" || kind === "good_sell") return "good";
  if (kind === "bad_buy" || kind === "bad_sell") return "bad";
  return null;
}

export function normalizeAdviceAction(action: string | null | undefined): AdviceActionKind | null {
  if (action == null || typeof action !== "string") return null;
  const act = action.trim().toLowerCase();
  if (act === "buy" || act === "sell" || act === "hold" || act === "review") return act;
  return null;
}

/** Score advice correctness from stock move vs recommendation type. */
export function classifyAdviceOutcome(
  action: string,
  priceChangePct: number | null | undefined,
): AdviceOutcomeClass | null {
  const act = normalizeAdviceAction(action);
  if (!act || priceChangePct == null || !Number.isFinite(priceChangePct)) return null;

  if (act === "buy") {
    if (priceChangePct >= ADVICE_CALIB_BUY_MIN_UP_PCT) return "good";
    if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "bad";
    return "pending";
  }
  if (act === "sell") {
    if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "good";
    if (priceChangePct >= ADVICE_CALIB_BUY_MIN_UP_PCT) return "bad";
    return "pending";
  }
  if (Math.abs(priceChangePct) <= ADVICE_CALIB_HOLD_FLAT_BAND_PCT) return "good";
  // Recovery HOLD: mild rally still supports the thesis (not a 24h "miss").
  if (priceChangePct > 0 && priceChangePct <= 5) return "good";
  if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "bad";
  return "pending";
}

/** @deprecated Use classifyAdviceOutcome — kept for legacy P&L-only checks. */
export function classifyPnlOutcome(pnlPct: number | null | undefined): AdviceOutcomeClass | null {
  return classifyAdviceOutcome("buy", pnlPct);
}

export function resolveAdvicePriceChangePct(row: {
  priceChangePct?: number | null;
  pnlPct24h?: number | null;
  pnlPct?: number | null;
  suggestedAction: string;
  inPaperPortfolio?: boolean;
  hasPosition?: boolean;
}): number | null {
  if (row.priceChangePct != null && Number.isFinite(row.priceChangePct)) return row.priceChangePct;
  if (row.pnlPct24h != null && Number.isFinite(row.pnlPct24h)) return row.pnlPct24h;
  const act = normalizeAdviceAction(row.suggestedAction);
  if ((act === "hold" || act === "review") && row.pnlPct != null && Number.isFinite(row.pnlPct)) {
    return row.pnlPct;
  }
  if ((row.inPaperPortfolio || row.hasPosition) && row.pnlPct != null && Number.isFinite(row.pnlPct)) {
    return row.pnlPct;
  }
  return null;
}

function adviceActionFromKind(kind: ExperimentAdviceEvent["kind"]): AdviceActionKind {
  if (kind === "good_sell" || kind === "bad_sell") return "sell";
  return "buy";
}

export function probToAdviceBucket(probPct: number): AdviceCalibBucketDef {
  const clamped = Math.max(0, Math.min(100, probPct));
  for (const b of ADVICE_CALIB_BUCKETS) {
    if (clamped >= b.min && clamped <= b.max) return b;
  }
  return ADVICE_CALIB_BUCKETS[ADVICE_CALIB_BUCKETS.length - 1];
}

export function resolveAdviceProbPct(
  event: Pick<ExperimentAdviceEvent, "tickId" | "key" | "probPctAtAdvice">,
  ticks: DecisionSimTick[],
): number | null {
  if (event.probPctAtAdvice != null && Number.isFinite(event.probPctAtAdvice)) {
    return event.probPctAtAdvice;
  }
  const tick = ticks.find((t) => t.id === event.tickId);
  const atTick = tick?.evaluations.find((e) => e.key === event.key)?.probPct ?? null;
  if (atTick != null && Number.isFinite(atTick)) return atTick;

  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  for (const tk of sorted) {
    const pos =
      tk.portfolioAfter.find((p) => p.key === event.key) ??
      tk.portfolioBefore.find((p) => p.key === event.key);
    if (pos?.entryProbPct != null && Number.isFinite(pos.entryProbPct)) return pos.entryProbPct;

    const bought = tk.trades.some((tr) => tr.key === event.key && tr.side === "buy");
    if (!bought) continue;
    const prob = tk.evaluations.find((e) => e.key === event.key)?.probPct ?? null;
    if (prob != null && Number.isFinite(prob)) return prob;
  }
  return null;
}

export function buildAdviceCalibrationFromLog(
  adviceLog: ExperimentAdviceEvent[],
  ticks: DecisionSimTick[],
  lang: "it" | "en",
): AdviceCalibrationPoint[] {
  const out: AdviceCalibrationPoint[] = [];
  for (const ev of adviceLog) {
    if (!SCORED_KINDS.has(ev.kind)) continue;
    const outcome = adviceKindToOutcome(ev.kind);
    if (!outcome) continue;
    const probPct = resolveAdviceProbPct(ev, ticks);
    if (probPct == null) continue;
    const bucket = probToAdviceBucket(probPct);
    const suggestedAction = adviceActionFromKind(ev.kind);
    const expectedReturnPct = resolveExpectedReturnFromTick(ev, ticks, suggestedAction);
    const actualReturnPct = ev.pnlPct;
    const forecastErrorPct =
      expectedReturnPct != null && actualReturnPct != null && Number.isFinite(actualReturnPct)
        ? Math.round((actualReturnPct - expectedReturnPct) * 10) / 10
        : null;
    out.push({
      id: `${ev.tickId}|${ev.key}|${ev.kind}|${ev.at}`,
      ticker: ev.ticker,
      probPct,
      bucketId: bucket.id,
      bucketLabel: lang === "it" ? bucket.labelIt : bucket.labelEn,
      outcome,
      pnlPct: ev.pnlPct,
      priceChangePct: ev.pnlPct,
      expectedReturnPct,
      forecastErrorPct,
      suggestedAction,
      source: "experiment",
      kind: ev.kind,
      at: ev.at,
    });
  }
  return out;
}

export type LiveAdviceCalibRow = {
  key: string;
  ticker: string;
  suggestedAction: string;
  inPaperPortfolio: boolean;
  hasPosition?: boolean;
  exitDecision?: string;
  probPct: number | null;
  /** P(plan) al consiglio/ingresso — preferita per posizioni paper aperte. */
  probPctAtAdvice?: number | null;
  planReturnPct?: number | null;
  miiAngleDeg?: number | null;
  pnlPct?: number | null;
  pnlPct24h?: number | null;
  priceChangePct?: number | null;
};

function resolveLiveCalibAction(row: LiveAdviceCalibRow): AdviceActionKind | null {
  const action = normalizeAdviceAction(row.suggestedAction);
  if (
    action === "review" &&
    row.exitDecision === "exit" &&
    (row.inPaperPortfolio || row.hasPosition)
  ) {
    return "sell";
  }
  return action;
}

function isLiveAdviceScorable(row: LiveAdviceCalibRow, action: AdviceActionKind): boolean {
  if (action === "buy") return true;
  if (action === "sell") return Boolean(row.inPaperPortfolio || row.hasPosition);
  return Boolean(row.inPaperPortfolio || row.hasPosition);
}

export function buildAdviceCalibrationFromLiveRows(
  rows: LiveAdviceCalibRow[],
  lang: "it" | "en",
): AdviceCalibrationPoint[] {
  const out: AdviceCalibrationPoint[] = [];
  for (const row of rows) {
    const action = resolveLiveCalibAction(row);
    if (!action || !isLiveAdviceScorable(row, action)) continue;
    const probAtAdvice =
      row.probPctAtAdvice != null && Number.isFinite(row.probPctAtAdvice)
        ? row.probPctAtAdvice
        : row.probPct;
    if (probAtAdvice == null || !Number.isFinite(probAtAdvice)) continue;
    const priceChangePct = resolveAdvicePriceChangePct({
      ...row,
      suggestedAction: action,
    });
    let { expectedReturnPct, forecastErrorPct } = computeAdviceForecastErrorPct(
      action,
      row.planReturnPct,
      priceChangePct,
      row.miiAngleDeg,
    );
    ({ expectedReturnPct, forecastErrorPct } = applySellForecastFallback(
      action,
      priceChangePct,
      expectedReturnPct,
      forecastErrorPct,
    ));
    const outcome = classifyAdviceOutcome(action, priceChangePct);
    if (forecastErrorPct == null && outcome !== "good" && outcome !== "bad") continue;
    const bucket = probToAdviceBucket(probAtAdvice);
    out.push({
      id: `live|${row.key}|${action}`,
      ticker: row.ticker,
      probPct: probAtAdvice,
      bucketId: bucket.id,
      bucketLabel: lang === "it" ? bucket.labelIt : bucket.labelEn,
      outcome: outcome ?? "pending",
      pnlPct: row.pnlPct ?? null,
      priceChangePct,
      expectedReturnPct,
      forecastErrorPct,
      suggestedAction: action,
      source: "live",
      kind: row.inPaperPortfolio ? "paper_open" : `${action}_rec`,
      at: "",
    });
  }
  return out;
}

/** Paper SELL eseguiti — valutati con Var. 24h post-vendita (titolo scende = ✓, sale = ✗). */
export function buildAdviceCalibrationFromPaperSells(
  ticks: DecisionSimTick[],
  resolvePostMove24h: (key: string) => number | null,
  lang: "it" | "en",
): AdviceCalibrationPoint[] {
  const out: AdviceCalibrationPoint[] = [];
  const seen = new Set<string>();
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));

  for (let ti = 0; ti < sorted.length; ti++) {
    const tick = sorted[ti]!;
    for (const tr of tick.trades) {
      if (tr.side !== "sell") continue;
      const dedupe = `${tr.key}|${tr.at}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const entryPos = tick.portfolioBefore.find((p) => p.key === tr.key);
      const ev = tick.evaluations.find((e) => e.key === tr.key);
      const probPct = entryPos?.entryProbPct ?? ev?.probPct ?? null;
      if (probPct == null || !Number.isFinite(probPct)) continue;

      const planReturnPct = ev?.planReturnPct ?? ev?.readings?.planTargetPct ?? entryPos?.entryPlanReturnPct ?? null;
      const priceChangePct = resolvePostSellMove24h(sorted, ti, tr.key, resolvePostMove24h);
      const outcome = classifyAdviceOutcome("sell", priceChangePct);
      let { expectedReturnPct, forecastErrorPct } = computeAdviceForecastErrorPct(
        "sell",
        planReturnPct,
        priceChangePct,
        null,
      );
      ({ expectedReturnPct, forecastErrorPct } = applySellForecastFallback(
        "sell",
        priceChangePct,
        expectedReturnPct,
        forecastErrorPct,
      ));
      if (forecastErrorPct == null && outcome !== "good" && outcome !== "bad") continue;

      const bucket = probToAdviceBucket(probPct);
      out.push({
        id: `paper-sell|${tr.key}|${tr.at}`,
        ticker: tr.ticker,
        probPct,
        bucketId: bucket.id,
        bucketLabel: lang === "it" ? bucket.labelIt : bucket.labelEn,
        outcome: outcome ?? "pending",
        pnlPct: tr.pnlPctSimulated,
        priceChangePct,
        expectedReturnPct,
        forecastErrorPct,
        suggestedAction: "sell",
        source: "live",
        kind: "paper_sell",
        at: tr.at,
      });
    }
  }
  return out;
}

export function mergeAdviceCalibrationPoints(
  ...groups: AdviceCalibrationPoint[][]
): AdviceCalibrationPoint[] {
  const byId = new Map<string, AdviceCalibrationPoint>();
  for (const group of groups) {
    for (const p of group) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}

export function aggregateAdviceCalibrationBuckets(
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
): AdviceCalibrationBucketRow[] {
  return ADVICE_CALIB_BUCKETS.map((def) => {
    const inBucket = points.filter((p) => p.bucketId === def.id);
    const goodCount = inBucket.filter((p) => p.outcome === "good").length;
    const badCount = inBucket.filter((p) => p.outcome === "bad").length;
    const pendingCount = inBucket.filter((p) => p.outcome === "pending").length;
    const scored = goodCount + badCount;
    const avgProb =
      inBucket.length > 0
        ? Math.round((inBucket.reduce((s, p) => s + p.probPct, 0) / inBucket.length) * 10) / 10
        : null;
    return {
      bucketId: def.id,
      bucketLabel: lang === "it" ? def.labelIt : def.labelEn,
      bucketMid: def.mid,
      count: inBucket.length,
      goodCount,
      badCount,
      pendingCount,
      successRatePct: scored > 0 ? Math.round((goodCount / scored) * 1000) / 10 : null,
      avgProbPct: avgProb,
    };
  });
}

export function summarizeAdviceCalibration(points: AdviceCalibrationPoint[]): AdviceCalibrationSummary {
  const scored = points.filter((p) => p.outcome === "good" || p.outcome === "bad");
  const pendingCount = points.filter((p) => p.outcome === "pending").length;

  const low = scored.filter((p) => p.probPct <= ADVICE_CALIB_LOW_PROB_MAX);
  const high = scored.filter((p) => p.probPct >= ADVICE_CALIB_HIGH_PROB_MIN);

  const rate = (rows: AdviceCalibrationPoint[]) => {
    const good = rows.filter((p) => p.outcome === "good").length;
    const bad = rows.filter((p) => p.outcome === "bad").length;
    const n = good + bad;
    return n > 0 ? Math.round((good / n) * 1000) / 10 : null;
  };

  return {
    lowProb: {
      count: low.length,
      good: low.filter((p) => p.outcome === "good").length,
      bad: low.filter((p) => p.outcome === "bad").length,
      successRatePct: rate(low),
    },
    highProb: {
      count: high.length,
      good: high.filter((p) => p.outcome === "good").length,
      bad: high.filter((p) => p.outcome === "bad").length,
      successRatePct: rate(high),
    },
    scoredCount: scored.length,
    pendingCount,
    goodCount: scored.filter((p) => p.outcome === "good").length,
    badCount: scored.filter((p) => p.outcome === "bad").length,
    overallSuccessRatePct:
      scored.length >= ADVICE_CALIB_MIN_SCORED_FOR_RATE ? rate(scored) : null,
  };
}

export function summarizeAdviceCalibrationFromLiveRows(
  rows: LiveAdviceCalibRow[],
  lang: "it" | "en",
): AdviceCalibrationSummary {
  return summarizeAdviceCalibration(buildAdviceCalibrationFromLiveRows(rows, lang));
}

export type BadAdviceCategory =
  | "horizon_mismatch"
  | "forward_overconfidence"
  | "spot_above_model"
  | "hold_false_negative"
  | "noise_24h"
  | "direction_wrong";

export type BadAdviceDiagnosis = {
  category: BadAdviceCategory;
  summaryIt: string;
  summaryEn: string;
};

export type BadAdviceMonitorContext = {
  planReturnPct?: number | null;
  curveGapPct?: number | null;
  misalignmentLabels?: string[];
  buyReason?: string | null;
  holdThesis?: string | null;
  rationale?: string | null;
};

export function diagnoseBadAdviceRootCause(
  point: Pick<
    AdviceCalibrationPoint,
    "suggestedAction" | "probPct" | "expectedReturnPct" | "priceChangePct" | "forecastErrorPct"
  >,
  monitor: BadAdviceMonitorContext | null | undefined,
): BadAdviceDiagnosis {
  const action = point.suggestedAction;
  const actual = point.priceChangePct;
  const expected = point.expectedReturnPct;
  const misalign = monitor?.misalignmentLabels ?? [];
  const gap = monitor?.curveGapPct ?? null;
  const spotMisalign = misalign.some((m) => /spot.*model|model.*today/i.test(m));
  const rationale = monitor?.rationale ?? monitor?.buyReason ?? monitor?.holdThesis ?? "";

  if (
    (action === "hold" || action === "review") &&
    actual != null &&
    actual > ADVICE_CALIB_HOLD_FLAT_BAND_PCT &&
    actual <= 5
  ) {
    return {
      category: "hold_false_negative",
      summaryIt:
        "Falso ✗: HOLD/recovery — il titolo è salito leggermente (+24h), coerente con la tesi multi-giorno. P(plan) misura il piano, non “resta fermo oggi”.",
      summaryEn:
        "False ✗: HOLD/recovery — stock rallied mildly (24h), aligned with multi-day thesis. P(plan) scores the plan, not “flat today”.",
    };
  }

  if (spotMisalign || (gap != null && gap > 4)) {
    const gapTxt = gap != null ? ` (+${gap.toFixed(1)}%)` : "";
    return {
      category: "spot_above_model",
      summaryIt: `Overconfidence: spot già sopra la curva modello${gapTxt} — P(plan) non era stata abbassata abbastanza prima del fix curve_gap.`,
      summaryEn: `Overconfidence: spot already above model curve${gapTxt} — P(plan) was not damped enough (curve_gap logic).`,
    };
  }

  if (
    action === "buy" &&
    expected != null &&
    expected >= 5 &&
    actual != null &&
    actual < ADVICE_CALIB_BUY_MIN_UP_PCT
  ) {
    return {
      category: "forward_overconfidence",
      summaryIt: `Target piano alto (+${expected.toFixed(1)}% atteso) gonfia P(plan) ${point.probPct.toFixed(0)}% — in 24h il mercato non ha seguito (${actual.toFixed(1)}%).`,
      summaryEn: `High plan target (+${expected.toFixed(1)}% expected) inflates P(plan) ${point.probPct.toFixed(0)}% — market did not follow in 24h (${actual.toFixed(1)}%).`,
    };
  }

  if (
    action === "buy" &&
    actual != null &&
    actual > ADVICE_CALIB_SELL_MIN_DOWN_PCT &&
    actual < ADVICE_CALIB_BUY_MIN_UP_PCT
  ) {
    return {
      category: "noise_24h",
      summaryIt: `Rumore 24h: movimento ${actual.toFixed(1)}% nella zona neutra BUY (soglia ±0.5%) — P(plan) resta valida su orizzonte multi-giorno.`,
      summaryEn: `24h noise: move ${actual.toFixed(1)}% in BUY neutral band (±0.5%) — P(plan) may still hold on multi-day horizon.`,
    };
  }

  if (action === "buy" || action === "sell") {
    return {
      category: "direction_wrong",
      summaryIt:
        action === "buy"
          ? `Direzione sbagliata in 24h con P(plan) ${point.probPct.toFixed(0)}% — verifica Top2/precat/momentum (${rationale || "—"}).`
          : `SELL/review ma titolo salito in 24h — possibile rimbalzo vs tesi exit.`,
      summaryEn:
        action === "buy"
          ? `Wrong 24h direction at P(plan) ${point.probPct.toFixed(0)}% — check Top2/precat/momentum (${rationale || "—"}).`
          : `SELL/review but stock rose in 24h — possible bounce vs exit thesis.`,
    };
  }

  return {
    category: "horizon_mismatch",
    summaryIt:
      "Mismatch orizzonte: P(plan)/P(recovery) su giorni/settimane, grafico giudica solo Var. 24h.",
    summaryEn: "Horizon mismatch: P(plan)/P(recovery) is multi-day; chart scores 24h only.",
  };
}

export function badAdviceDiagnosisLabel(
  diagnosis: BadAdviceDiagnosis,
  lang: "it" | "en",
): string {
  return lang === "it" ? diagnosis.summaryIt : diagnosis.summaryEn;
}
