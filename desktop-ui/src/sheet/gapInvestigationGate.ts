import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import type { DecisionSimTick } from "./investDecisionSimLoop";
import {
  applyGapSizeDecisionToPortfolio,
  appendGapInvestigationRecord,
} from "./gapInvestigationAudit";
import { detectGapEvents } from "./gapInvestigationDetect";
import { getGapContextProvider } from "./gapInvestigationProvider";
import {
  GAP_INVESTIGATION_EVENT,
  type DetectedGapEvent,
  type GapInvestigationModalPayload,
  type GapInvestigationRecord,
  type GapInvestigationUserDecision,
} from "./gapInvestigationTypes";
import {
  loadDecisionSimState,
  saveDecisionSimState,
  type DecisionSimState,
} from "./investDecisionSimStorage";

export type GapMarkContext = {
  portfolioBefore: PaperPosition[];
  portfolioAfter: PaperPosition[];
  tickTimestamp: string;
  evaluations: TickerSimEvaluation[];
};

function publishGapInvestigationModal(payload: GapInvestigationModalPayload): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GAP_INVESTIGATION_EVENT, { detail: payload }));
}

/** Phase 1+2+4: detect gaps, stub investigate, persist audit, queue modal (non-blocking). */
export async function processGapInvestigationAfterMark(ctx: GapMarkContext): Promise<void> {
  const events = detectGapEvents(
    ctx.portfolioBefore,
    ctx.portfolioAfter,
    ctx.tickTimestamp,
    ctx.evaluations,
  );
  if (!events.length) return;

  const provider = getGapContextProvider();
  let state = loadDecisionSimState();
  let log = state.gapInvestigationLog ?? [];

  for (const detected of events) {
    const { rowKey, ...event } = detected as DetectedGapEvent;

    const dup = log.some(
      (r) =>
        r.rowKey === rowKey &&
        r.status === "pending" &&
        r.event.tickTimestamp === event.tickTimestamp,
    );
    if (dup) continue;

    const finding = await provider.investigate(event);
    const record: GapInvestigationRecord = {
      id: `gap_${Date.now()}_${rowKey}`,
      rowKey,
      event,
      finding,
      status: "pending",
      userDecision: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
    };
    log = appendGapInvestigationRecord(log, record);
    state = saveDecisionSimState({ ...state, gapInvestigationLog: log });
    publishGapInvestigationModal({
      recordId: record.id,
      event,
      rowKey,
      finding,
    });
  }
}

/** Phase 3+4: user decision — adjusts paper size only; never auto-trades. */
export function commitGapInvestigationDecision(
  recordId: string,
  decision: GapInvestigationUserDecision,
): DecisionSimState {
  let state = loadDecisionSimState();
  const log = state.gapInvestigationLog ?? [];
  const record = log.find((r) => r.id === recordId);
  if (!record) return state;

  let paperPortfolio = state.paperPortfolio;
  if (decision.kind === "reduce" || decision.kind === "add") {
    paperPortfolio = applyGapSizeDecisionToPortfolio(
      paperPortfolio,
      record.rowKey,
      decision,
    );
  }

  const nextLog = log.map((r) =>
    r.id === recordId
      ? {
          ...r,
          status: "decided" as const,
          userDecision: decision,
          decidedAt: new Date().toISOString(),
        }
      : r,
  );

  return saveDecisionSimState({
    ...state,
    paperPortfolio,
    gapInvestigationLog: nextLog,
  });
}

/** Fire-and-forget hook after any mark/trade tick is persisted. */
export function scheduleGapInvestigationAfterTick(tick: DecisionSimTick): void {
  void processGapInvestigationAfterMark({
    portfolioBefore: tick.portfolioBefore,
    portfolioAfter: tick.portfolioAfter,
    tickTimestamp: tick.at,
    evaluations: tick.evaluations,
  });
}
