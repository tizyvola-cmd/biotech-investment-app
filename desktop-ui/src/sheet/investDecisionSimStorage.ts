/**
 * Persistenza loop simulazione invest/disinvest — localStorage, run settimanale / esperimento long-run.
 */
import type { DecisionSimRunConfig, DecisionSimState, DecisionSimTick } from "./investDecisionSimLoop";
import { GAP_INVESTIGATION_LOG_MAX, type GapInvestigationRecord } from "./gapInvestigationTypes";
import {
  DEFAULT_MAX_OPEN_POSITIONS,
  defaultExperimentPiggyBank,
  defaultExperimentScorecard,
  mergeScorecardDelta,
  openPaperMtmFromPortfolio,
  sanitizePaperMovePct,
} from "./investDecisionSimExperiment";
import { sanitizeLiveExperimentPiggy } from "./decisionSimPnlResolve";
import { repairDecisionSimState } from "./simLoopDiagnostics";
import {
  effectiveDecisionSimIntervalHours,
  isDecisionSimMarketWindow,
} from "./investDecisionSimSchedule";
import {
  isPendingSimTradeDue,
  loadPendingSimTradeBatch,
} from "./decisionSimResponseWindow";

export type { DecisionSimRunConfig, DecisionSimState, DecisionSimTick } from "./investDecisionSimLoop";

export const DECISION_SIM_STORAGE_KEY = "invest_decision_sim_v1";
export const DECISION_SIM_CHANGED_EVENT = "invest-decision-sim-changed";
export const DECISION_SIM_SAVE_FAILED_EVENT = "invest-decision-sim-save-failed";
export const DECISION_SIM_TICK_FAILED_EVENT = "invest-decision-sim-tick-failed";

export const DECISION_SIM_DEFAULT_INTERVAL_H = 1;
export const DECISION_SIM_RUN_DAYS = 7;
export const DECISION_SIM_MAX_TICKS = 120;
export const DECISION_SIM_ADVICE_LOG_MAX = 120;

const DEFAULT_CONFIG: DecisionSimRunConfig = {
  enabled: false,
  intervalHours: DECISION_SIM_DEFAULT_INTERVAL_H,
  startedAt: null,
  endsAt: null,
  capitalPerTrade: 5000,
  maxOpenPositions: DEFAULT_MAX_OPEN_POSITIONS,
  experimentMode: false,
};

export function defaultDecisionSimState(): DecisionSimState {
  return {
    version: 2,
    config: { ...DEFAULT_CONFIG },
    paperPortfolio: [],
    ticks: [],
    lastTickAt: null,
    cumulativePaperPnlEur: 0,
    closedTradeCount: 0,
    experimentStartedAt: null,
    scorecard: defaultExperimentScorecard(),
    piggyBank: defaultExperimentPiggyBank(),
    adviceLog: [],
    badBuyScoredKeys: [],
    gapInvestigationLog: [],
  };
}

function normalizeMaxOpen(_raw: unknown): number {
  // The sim loop now always invests in every BUY suggestion — there is no
  // UI to set a per-loop cap, and any finite value saved in older states was
  // a leftover from a previous default. We force-coerce all stored values to
  // `Number.POSITIVE_INFINITY` so the loop matches the documented intent:
  // the paper portfolio holds every reliable BUY signal, and the "capture vs
  // recs" / fair-recs baselines stay apples-to-apples.
  return DEFAULT_MAX_OPEN_POSITIONS;
}

function normalizeConfig(raw: Partial<DecisionSimRunConfig> | undefined): DecisionSimRunConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...raw,
    maxOpenPositions: normalizeMaxOpen(raw?.maxOpenPositions),
    experimentMode: raw?.experimentMode ?? false,
  };
  if (merged.experimentMode && merged.intervalHours === 6) {
    merged.intervalHours = DECISION_SIM_DEFAULT_INTERVAL_H;
  }
  return merged;
}

function normalizeScorecard(raw: Partial<ReturnType<typeof defaultExperimentScorecard>> | undefined) {
  const base = defaultExperimentScorecard();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    missedBuyCount: Number(raw.missedBuyCount ?? base.missedBuyCount) || 0,
    missedBuyEurEst: Number.isFinite(Number(raw.missedBuyEurEst))
      ? Number(raw.missedBuyEurEst)
      : base.missedBuyEurEst,
    badBuyCount: Number(raw.badBuyCount ?? base.badBuyCount) || 0,
    badSellCount: Number(raw.badSellCount ?? base.badSellCount) || 0,
    goodBuyCount: Number(raw.goodBuyCount ?? base.goodBuyCount) || 0,
    goodSellCount: Number(raw.goodSellCount ?? base.goodSellCount) || 0,
  };
}

function migrateState(parsed: Record<string, unknown>): DecisionSimState {
  const base = defaultDecisionSimState();
  const config = normalizeConfig(parsed.config as Partial<DecisionSimRunConfig> | undefined);
  return {
    ...base,
    ...parsed,
    version: 2,
    config,
    paperPortfolio: Array.isArray(parsed.paperPortfolio) ? (parsed.paperPortfolio as DecisionSimState["paperPortfolio"]) : [],
    ticks: Array.isArray(parsed.ticks)
      ? (parsed.ticks as DecisionSimTick[]).slice(-DECISION_SIM_MAX_TICKS).map(compactTickForStorage)
      : [],
    cumulativePaperPnlEur:
      typeof parsed.cumulativePaperPnlEur === "number" && Number.isFinite(parsed.cumulativePaperPnlEur)
        ? parsed.cumulativePaperPnlEur
        : 0,
    closedTradeCount: typeof parsed.closedTradeCount === "number" ? parsed.closedTradeCount : 0,
    experimentStartedAt:
      typeof parsed.experimentStartedAt === "string" ? parsed.experimentStartedAt : null,
    scorecard: normalizeScorecard(parsed.scorecard as Partial<ReturnType<typeof defaultExperimentScorecard>>),
    piggyBank: (() => {
      const raw = { ...defaultExperimentPiggyBank(), ...(parsed.piggyBank as object) };
      const cum =
        typeof parsed.cumulativePaperPnlEur === "number" && Number.isFinite(parsed.cumulativePaperPnlEur)
          ? parsed.cumulativePaperPnlEur
          : 0;
      return sanitizeLiveExperimentPiggy(raw, cum).piggy;
    })(),
    adviceLog: Array.isArray(parsed.adviceLog) ? (parsed.adviceLog as DecisionSimState["adviceLog"]).slice(-DECISION_SIM_ADVICE_LOG_MAX) : [],
    badBuyScoredKeys: Array.isArray(parsed.badBuyScoredKeys) ? (parsed.badBuyScoredKeys as string[]) : [],
    gapInvestigationLog: Array.isArray(parsed.gapInvestigationLog)
      ? (parsed.gapInvestigationLog as GapInvestigationRecord[]).slice(-GAP_INVESTIGATION_LOG_MAX)
      : [],
  };
}

export function loadDecisionSimState(): DecisionSimState {
  if (typeof window === "undefined") return defaultDecisionSimState();
  try {
    const raw = localStorage.getItem(DECISION_SIM_STORAGE_KEY);
    if (!raw) return defaultDecisionSimState();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) return defaultDecisionSimState();
    const migrated = migrateState(parsed);
    const repaired = repairDecisionSimState(migrated);
    const needsCompact = repaired.ticks.some((t) => (t.evaluations?.length ?? 0) > 0);
    const piggyChanged =
      repaired.piggyBank.totalPnlEur !== migrated.piggyBank.totalPnlEur ||
      repaired.cumulativePaperPnlEur !== migrated.cumulativePaperPnlEur ||
      repaired.closedTradeCount !== migrated.closedTradeCount;
    if (needsCompact || piggyChanged) return saveDecisionSimState(repaired);
    return repaired;
  } catch {
    return defaultDecisionSimState();
  }
}

function roundPiggyEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** §1.1 — ensure tick piggy carries open MTM before evaluations are stripped. */
export function ensureTickPiggyOpenMtmForStorage(tick: DecisionSimTick): DecisionSimTick {
  const positions = tick.portfolioAfter ?? [];
  if (!positions.length) return tick;

  const piggy = { ...defaultExperimentPiggyBank(), ...(tick.summary?.piggyBank ?? {}) };
  const storedOpen = piggy.openMtmPnlEur;
  const marksSuggestOpen =
    tick.evaluations.length > 0 ||
    positions.some((p) => sanitizePaperMovePct(p.lastMarkPct) != null);
  const openMissing =
    !Number.isFinite(storedOpen) ||
    (Math.abs(storedOpen) < 0.01 && marksSuggestOpen);

  const totalMismatch =
    Number.isFinite(piggy.totalPnlEur) &&
    Number.isFinite(piggy.closedPnlEur) &&
    Number.isFinite(storedOpen) &&
    Math.abs(piggy.totalPnlEur - (piggy.closedPnlEur + storedOpen)) >
      Math.max(50, Math.abs(piggy.closedPnlEur + storedOpen) * 0.08 + 25);

  if (!openMissing && !totalMismatch) return tick;

  const openMtmPnlEur = openMissing
    ? openPaperMtmFromPortfolio(positions, tick.evaluations)
    : roundPiggyEur(storedOpen);
  const openCapitalEur = roundPiggyEur(
    positions.reduce((s, p) => s + (p.capital > 0 ? p.capital : 0), 0),
  );
  const closedPnlEur = roundPiggyEur(
    Number.isFinite(piggy.closedPnlEur) ? piggy.closedPnlEur : 0,
  );
  const totalPnlEur = roundPiggyEur(closedPnlEur + openMtmPnlEur);

  const nextPiggy = {
    ...piggy,
    openCapitalEur,
    openMtmPnlEur,
    closedPnlEur,
    totalPnlEur,
    openPositionCount: positions.length,
  };

  return {
    ...tick,
    summary: {
      ...tick.summary,
      piggyBank: nextPiggy,
    },
  };
}

function compactTickForStorage(tick: DecisionSimTick): DecisionSimTick {
  const repaired = ensureTickPiggyOpenMtmForStorage(tick);
  return {
    ...repaired,
    evaluations: [],
  };
}

export function saveDecisionSimState(state: DecisionSimState): DecisionSimState {
  const trimmed: DecisionSimState = {
    ...state,
    version: 2,
    ticks: state.ticks.slice(-DECISION_SIM_MAX_TICKS).map(compactTickForStorage),
    adviceLog: state.adviceLog.slice(-DECISION_SIM_ADVICE_LOG_MAX),
    gapInvestigationLog: (state.gapInvestigationLog ?? []).slice(-GAP_INVESTIGATION_LOG_MAX),
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DECISION_SIM_STORAGE_KEY, JSON.stringify(trimmed));
      window.dispatchEvent(new CustomEvent(DECISION_SIM_CHANGED_EVENT, { detail: trimmed }));
    } catch (err) {
      console.error("[DecisionSim] localStorage save failed — state may not persist", err);
      window.dispatchEvent(
        new CustomEvent(DECISION_SIM_SAVE_FAILED_EVENT, {
          detail: { error: err instanceof Error ? err.message : String(err) },
        }),
      );
    }
  }
  return trimmed;
}

export function appendDecisionSimTick(
  state: DecisionSimState,
  tick: DecisionSimTick,
): DecisionSimState {
  const pnlDelta = tick.trades.reduce((s, t) => s + (t.pnlEurSimulated ?? 0), 0);
  const sellCount = tick.trades.filter((t) => t.side === "sell").length;
  const adviceLog = [...state.adviceLog, ...(tick.adviceEvents ?? [])].slice(
    -DECISION_SIM_ADVICE_LOG_MAX,
  );
  const scorecard = tick.experimentDelta
    ? mergeScorecardDelta(state.scorecard, tick.experimentDelta)
    : state.scorecard;

  return saveDecisionSimState({
    ...state,
    paperPortfolio: tick.portfolioAfter,
    ticks: [...state.ticks, tick],
    lastTickAt: tick.at,
    cumulativePaperPnlEur: Math.round((state.cumulativePaperPnlEur + pnlDelta) * 100) / 100,
    closedTradeCount: state.closedTradeCount + sellCount,
    scorecard,
    piggyBank: tick.summary.piggyBank ?? state.piggyBank,
    adviceLog,
    badBuyScoredKeys: tick.badBuyScoredKeys ?? state.badBuyScoredKeys,
  });
}

/** Mark-only tick — updates open MTM history; advances signal interval but not closed P&L. */
export function appendDecisionSimMarkTick(
  state: DecisionSimState,
  tick: DecisionSimTick,
): DecisionSimState {
  return saveDecisionSimState({
    ...state,
    paperPortfolio: tick.portfolioAfter,
    ticks: [...state.ticks, tick],
    lastTickAt: tick.at,
    piggyBank: tick.summary.piggyBank ?? state.piggyBank,
  });
}

/** Run rapido 7 giorni (reset portfolio). */
export function startDecisionSimWeek(
  state: DecisionSimState,
  intervalHours = DECISION_SIM_DEFAULT_INTERVAL_H,
): DecisionSimState {
  const now = new Date();
  const ends = new Date(now.getTime() + DECISION_SIM_RUN_DAYS * 86_400_000);
  return saveDecisionSimState({
    ...defaultDecisionSimState(),
    config: {
      enabled: true,
      intervalHours,
      startedAt: now.toISOString(),
      endsAt: ends.toISOString(),
      capitalPerTrade: state.config.capitalPerTrade,
      maxOpenPositions: state.config.maxOpenPositions,
      experimentMode: false,
    },
  });
}

/** Esperimento long-run: tick automatici senza scadenza, mantiene storico scorecard. */
export function startDecisionSimExperiment(
  state: DecisionSimState,
  intervalHours = DECISION_SIM_DEFAULT_INTERVAL_H,
): DecisionSimState {
  const now = new Date();
  return saveDecisionSimState({
    ...defaultDecisionSimState(),
    experimentStartedAt: now.toISOString(),
    config: {
      enabled: true,
      intervalHours,
      startedAt: now.toISOString(),
      endsAt: null,
      capitalPerTrade: state.config.capitalPerTrade,
      maxOpenPositions: state.config.maxOpenPositions,
      experimentMode: true,
    },
  });
}

export function stopDecisionSimRun(state: DecisionSimState): DecisionSimState {
  return saveDecisionSimState({
    ...state,
    config: { ...state.config, enabled: false },
  });
}

export function shouldRunDecisionSimTick(state: DecisionSimState, at: Date = new Date()): boolean {
  if (!state.config.enabled) return false;
  if (!isDecisionSimMarketWindow(at)) return false;
  const pending = loadPendingSimTradeBatch();
  if (pending && !isPendingSimTradeDue(pending, at)) return false;
  if (
    !state.config.experimentMode &&
    state.config.endsAt &&
    at.getTime() > new Date(state.config.endsAt).getTime()
  ) {
    return false;
  }
  if (!state.lastTickAt) return true;
  const intervalMs =
    effectiveDecisionSimIntervalHours(state.config.intervalHours, state.config.experimentMode) *
    3_600_000;
  return at.getTime() - new Date(state.lastTickAt).getTime() >= intervalMs * 0.95;
}

export function isDecisionSimRunExpired(state: DecisionSimState): boolean {
  if (state.config.experimentMode) return false;
  if (!state.config.endsAt) return false;
  return Date.now() > new Date(state.config.endsAt).getTime();
}

export function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type DecisionSimWeekRollup = {
  weekKey: string;
  tickCount: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  misalignmentRatePct: number | null;
  signalAgreementPct: number | null;
  paperPnlEur: number;
  winSellCount: number;
  lossSellCount: number;
  missedBuyCount: number;
  totalPnlEur: number | null;
};

export function rollupDecisionSimByWeek(ticks: DecisionSimTick[]): DecisionSimWeekRollup[] {
  const byWeek = new Map<string, DecisionSimTick[]>();
  for (const t of ticks) {
    const wk = isoWeekKey(t.at);
    const arr = byWeek.get(wk) ?? [];
    arr.push(t);
    byWeek.set(wk, arr);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekKey, wTicks]) => {
      let tradeCount = 0;
      let buyCount = 0;
      let sellCount = 0;
      let winSell = 0;
      let lossSell = 0;
      let paperPnl = 0;
      let misalignedSum = 0;
      let misalignedDenom = 0;
      let agreeSum = 0;
      let agreeDenom = 0;
      let missedBuy = 0;
      let lastTotalPnl: number | null = null;
      for (const t of wTicks) {
        tradeCount += t.trades.length;
        buyCount += t.summary.buySignals;
        sellCount += t.summary.sellSignals;
        paperPnl += t.trades.reduce((s, tr) => s + (tr.pnlEurSimulated ?? 0), 0);
        missedBuy += t.summary.missedBuyCount ?? 0;
        if (t.summary.piggyBank) lastTotalPnl = t.summary.piggyBank.totalPnlEur;
        for (const tr of t.trades) {
          if (tr.side === "sell") {
            if ((tr.pnlEurSimulated ?? 0) > 0) winSell += 1;
            else if ((tr.pnlEurSimulated ?? 0) < 0) lossSell += 1;
          }
        }
        misalignedSum += t.summary.misalignedTickers;
        misalignedDenom += t.summary.evaluatedTickers;
        agreeSum += t.summary.precatVerdictAgree;
        agreeDenom += t.summary.evaluatedTickers;
      }
      return {
        weekKey,
        tickCount: wTicks.length,
        tradeCount,
        buyCount,
        sellCount,
        misalignmentRatePct:
          misalignedDenom > 0 ? Math.round((misalignedSum / misalignedDenom) * 1000) / 10 : null,
        signalAgreementPct:
          agreeDenom > 0 ? Math.round((agreeSum / agreeDenom) * 1000) / 10 : null,
        paperPnlEur: Math.round(paperPnl * 100) / 100,
        winSellCount: winSell,
        lossSellCount: lossSell,
        missedBuyCount: missedBuy,
        totalPnlEur: lastTotalPnl,
      };
    });
}
