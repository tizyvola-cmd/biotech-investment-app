/**
 * One-click approve for patterns synthesized from Step 3 manual allocation.
 */
import { describePattern } from "./lossRiskPattern";
import { approvePatternProposal } from "./patternProposalEngine";
import {
  loadApprovedPattern,
  persistProposal,
} from "./patternProposalStore";
import type { PatternProposal, RiskPattern } from "./riskPatternTypes";

let manualSeq = 0;

function persistManualProposal(args: {
  pattern: RiskPattern;
  currentPattern: RiskPattern | null;
  lang: "it" | "en";
  source: "manual_allocation_step3" | "auto_apply";
}): string {
  manualSeq += 1;
  const id = `pat-prop-manual-${Date.now().toString(36)}-${manualSeq.toString(36)}`;
  const reason: PatternProposal["reason"] = args.currentPattern
    ? "betterPatternFound"
    : "firstPattern";
  const isIt = args.lang === "it";
  const sourceLabel =
    args.source === "manual_allocation_step3"
      ? isIt
        ? "Sintetizzatore allocazione manuale (Step 3)"
        : "Manual allocation synthesizer (Step 3)"
      : isIt
        ? "Applicazione diretta dal pannello errori"
        : "One-click apply from errors panel";
  const rationale = `${sourceLabel}. Pattern: ${describePattern(args.pattern)}.`;
  persistProposal({
    id,
    createdAt: new Date().toISOString(),
    triggeredByTradeId: null,
    reason,
    currentPattern: args.currentPattern
      ? { pattern: args.currentPattern, outOfSampleStats: null }
      : null,
    proposedPattern: {
      pattern: args.pattern,
      inSampleStats: args.pattern.inSampleStats,
    },
    rationale,
    drivenByTradeIds: [],
    status: "pending",
  });
  return id;
}

/** Persist + immediately approve a synthesized manual-allocation pattern. */
export function applyManualAllocationPattern(
  pattern: RiskPattern,
  lang: "it" | "en",
  source: "manual_allocation_step3" | "auto_apply" = "manual_allocation_step3",
): boolean {
  const currentPattern = loadApprovedPattern().current;
  const id = persistManualProposal({ pattern, currentPattern, lang, source });
  const result = approvePatternProposal(
    id,
    lang === "it"
      ? "Approvato dal sintetizzatore allocazione manuale (Step 3)."
      : "Approved from manual allocation synthesizer (Step 3).",
    "user_oneclick",
  );
  return result?.approvedPattern != null;
}
