import type { ChartPoint, SheetTable } from "../types";
import type { RegulatoryRiskSnapshot } from "../api/supernova";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossAnalysisProbOptions } from "./portfolioLossAnalysis";
import type { InvestSimInputs } from "./investSimStorage";
import { runDecisionSimTick, runDecisionSimMarkTick } from "./investDecisionSimLoop";
import {
  appendDecisionSimTick,
  appendDecisionSimMarkTick,
  DECISION_SIM_TICK_FAILED_EVENT,
  isDecisionSimRunExpired,
  loadDecisionSimState,
  shouldRunDecisionSimTick,
  stopDecisionSimRun,
} from "./investDecisionSimStorage";
import { buildDailySimLoopExecution } from "./simLoopDailyEvaluation";
import { loadAdviceFeedback } from "./adviceFeedback";
import { loadInvestSimHistory } from "./investSimStorage";
import { publishSimLoopTradeAlerts } from "./simLoopTradeAlerts";
import { scheduleGapInvestigationAfterTick } from "./gapInvestigationGate";
import {
  clearPendingSimTradeBatch,
  isPendingSimTradeDue,
  loadPendingSimTradeBatch,
  previewDecisionSimTrades,
  stagePendingSimTrades,
} from "./decisionSimResponseWindow";

export type DecisionSimAutoTickContext = {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions: LossAnalysisProbOptions | null;
  /** Same Soft SELL enhance inputs as Home Pulse / Cutoff. */
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
};

let tickInFlight = false;

function buildAutoTickContext(
  fresh: ReturnType<typeof loadDecisionSimState>,
  ctx: DecisionSimAutoTickContext,
) {
  const simLoopExecution = buildDailySimLoopExecution(fresh.config.capitalPerTrade, {
    probOptions: ctx.probOptions,
    simTable: ctx.simTable,
    inputs: ctx.inputs,
    pointsBySeriesKey: ctx.pointsBySeriesKey,
    lang: ctx.lang,
  });
  return {
    simTable: ctx.simTable,
    inputs: ctx.inputs,
    pointsBySeriesKey: ctx.pointsBySeriesKey,
    lang: ctx.lang,
    probOptions: ctx.probOptions,
    paperPortfolio: fresh.paperPortfolio,
    capitalPerTrade: fresh.config.capitalPerTrade,
    maxOpenPositions: fresh.config.maxOpenPositions,
    closedTradeCount: fresh.closedTradeCount,
    cumulativeClosedPnlEur: fresh.cumulativePaperPnlEur,
    badBuyScoredKeys: new Set(fresh.badBuyScoredKeys),
    adviceFeedback: loadAdviceFeedback(),
    simLoopExecution,
    history: loadInvestSimHistory(),
    lossRiskCatalog: ctx.lossRiskCatalog ?? null,
    catalogByRowKey: ctx.catalogByRowKey ?? null,
    autoRegSnap: ctx.autoRegSnap ?? null,
  };
}

/** Runs one sim tick when due (market window + interval). Returns true if a tick was saved. */
export async function tryRunDecisionSimAutoTick(ctx: DecisionSimAutoTickContext): Promise<boolean> {
  if (tickInFlight || !ctx.simTable.rows?.length) return false;

  let fresh = loadDecisionSimState();
  if (!fresh.config.enabled) return false;

  if (isDecisionSimRunExpired(fresh)) {
    stopDecisionSimRun(fresh);
    return false;
  }

  tickInFlight = true;
  try {
    fresh = loadDecisionSimState();
    if (!fresh.config.enabled) return false;

    const tickCtx = buildAutoTickContext(fresh, ctx);
    const alertOpts = {
      lang: ctx.lang,
      simTable: ctx.simTable,
      inputs: ctx.inputs,
      pointsBySeriesKey: ctx.pointsBySeriesKey,
      probOptions: ctx.probOptions,
    };

    const pending = loadPendingSimTradeBatch();
    if (pending) {
      if (!isPendingSimTradeDue(pending)) {
        // Response window still open — do not re-mark / re-publish the same
        // pending SELL/BUY alert (Close would appear broken if we re-queue it).
        return false;
      }
      const tick = runDecisionSimTick(tickCtx);
      appendDecisionSimTick(fresh, tick);
      scheduleGapInvestigationAfterTick(tick);
      clearPendingSimTradeBatch();
      publishSimLoopTradeAlerts(tick, { ...alertOpts, pending: false });
      return true;
    }

    if (!shouldRunDecisionSimTick(fresh)) return false;

    const markTick = runDecisionSimMarkTick(tickCtx);
    appendDecisionSimMarkTick(fresh, markTick);
    scheduleGapInvestigationAfterTick(markTick);

    // Preview against marked book so pending SELL P&L uses stamped MTM, not 0.
    const proposed = previewDecisionSimTrades(
      markTick.evaluations,
      markTick.portfolioAfter,
      markTick.at,
      fresh.config.capitalPerTrade,
      fresh.config.maxOpenPositions,
      { resolveBuyCapital: tickCtx.simLoopExecution?.resolveBuyCapital },
    );

    if (proposed.length) {
      const before = loadPendingSimTradeBatch();
      const batch = stagePendingSimTrades(proposed, markTick.at);
      // Only alert when a new pending batch is staged (not on signature dedupe).
      const isNewBatch =
        batch != null &&
        (before == null ||
          before.tradeSig !== batch.tradeSig ||
          before.detectedAt !== batch.detectedAt);
      if (batch && isNewBatch) {
        publishSimLoopTradeAlerts(markTick, {
          ...alertOpts,
          pending: true,
          executeAfter: batch.executeAfter ?? null,
          previewTrades: proposed,
        });
      }
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DecisionSim] auto tick failed", err);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(DECISION_SIM_TICK_FAILED_EVENT, { detail: { error: message } }),
      );
    }
    return false;
  } finally {
    tickInFlight = false;
  }
}
