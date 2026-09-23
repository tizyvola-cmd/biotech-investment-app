import type { ChartPoint, SheetTable } from "../types";
import type { RegulatoryRiskSnapshot } from "../api/supernova";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossAnalysisProbOptions } from "./portfolioLossAnalysis";
import {
  loadInvestSimHistory,
  loadInvestSimInputs,
  type InvestSimInputs,
} from "./investSimStorage";
import { runFlashTestTick } from "./flashTestEngine";
import {
  isFlashTestRunExpired,
  loadFlashTestState,
  stopFlashTestRun,
} from "./flashTestStorage";
import { FLASH_TEST_AUTO_TICK_MS } from "./flashTestTypes";

/** Min gap between Flash Test auto ticks (ms). Manual "Run tick" ignores this. */
export { FLASH_TEST_AUTO_TICK_MS };

export type FlashTestAutoTickContext = {
  simTable: SheetTable;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions?: LossAnalysisProbOptions | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
  inputs?: InvestSimInputs | null;
};

let inFlight = false;

function shouldAutoTick(lastTickAt: string | null): boolean {
  if (!lastTickAt) return true;
  const t = Date.parse(lastTickAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= FLASH_TEST_AUTO_TICK_MS;
}

/**
 * Hands-off Flash Test tick while the 7-day experiment is armed.
 * Unlike Decision Sim, does NOT wait for Rome market hours — the experiment
 * must keep applying Soft BUY/SELL lists whenever the app is open.
 */
export function tryRunFlashTestAutoTick(ctx: FlashTestAutoTickContext): boolean {
  if (inFlight || !ctx.simTable.rows?.length) return false;
  if (!(ctx.probOptions?.sdsRows?.length)) return false;

  let state = loadFlashTestState();
  if (!state.enabled) return false;
  if (isFlashTestRunExpired(state)) {
    stopFlashTestRun(state);
    return false;
  }
  if (!shouldAutoTick(state.lastTickAt)) return false;

  inFlight = true;
  try {
    state = loadFlashTestState();
    if (!state.enabled) return false;
    runFlashTestTick(state, {
      simTable: ctx.simTable,
      pointsBySeriesKey: ctx.pointsBySeriesKey,
      lang: ctx.lang,
      probOptions: ctx.probOptions,
      history: loadInvestSimHistory(),
      lossRiskCatalog: ctx.lossRiskCatalog,
      catalogByRowKey: ctx.catalogByRowKey,
      autoRegSnap: ctx.autoRegSnap,
      priorSessionPctByTicker: ctx.priorSessionPctByTicker,
      inputs: ctx.inputs ?? loadInvestSimInputs(),
    });
    return true;
  } finally {
    inFlight = false;
  }
}
