/**
 * Pattern Proposal Engine — the learning loop.
 *
 * Triggered at each new trade close. Generates a PatternProposal ONLY IF one
 * of two conditions holds:
 *   (a) the currently approved pattern has degraded out-of-sample
 *       (precision_oos < degradationRatio * inSamplePrecision, with min OOS n)
 *   (b) a candidate pattern (re-built via Phase A on the full pool) improves
 *       precision out-of-sample by at least minPrecisionMarginPP percentage
 *       points over the current approved pattern, with n ≥ minFiredNForProposal
 *
 * "firstPattern" reason fires when there is no approved pattern yet and a
 * candidate can be built with sufficient data.
 *
 * The engine ALWAYS marks numbers as in-sample or out-of-sample. It NEVER
 * applies a change — it only persists a `pending` proposal.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { normalizedRowKey } from "../sheet/investSimKeys";
import {
  extractAllRowFeatures,
  runUnivariateScreening,
} from "./lossRiskScreening";
import {
  buildPatternFromTopBuckets,
  conditionLabel,
  evaluatePatternStats,
  searchBestPatternEmpirical,
  splitInVsOutOfSample,
} from "./lossRiskPattern";
import {
  loadApprovedPattern,
  persistProposal,
  promotePatternToApproved,
  updateProposalStatus,
  tagAsUsedForValidation,
  clearApprovedPattern,
} from "./patternProposalStore";
import {
  DEFAULT_PATTERN_PROPOSAL_CONFIG,
  type PatternApprovalSource,
  type PatternProposal,
  type PatternProposalConfig,
  type PatternProposalReason,
  type PatternStats,
  type RiskPattern,
} from "./riskPatternTypes";

export type RationaleLang = "it" | "en";

export type PatternProposalGenerationOptions = {
  triggeredByTradeId?: string | null;
  config?: PatternProposalConfig;
  lang?: RationaleLang;
  /** Max AND-conditions for the empirical search. Default 3.
   *  (Replaces the legacy `topK` parameter which only selected features by
   *  univariate lift rather than searching combinations.) */
  maxConditions?: number;
  /** If true, use the legacy "top buckets by univariate lift" heuristic
   *  instead of the empirical combinatorial search. Default false. */
  useLegacyHeuristic?: boolean;
};

let proposalIdSeq = 0;
function nextProposalId(): string {
  proposalIdSeq += 1;
  return `pat-prop-${Date.now().toString(36)}-${proposalIdSeq.toString(36)}`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function describeConditions(p: RiskPattern, lang: RationaleLang): string {
  if (!p.conditions || p.conditions.length === 0) return "(no conditions)";
  return p.conditions.map((c) => conditionLabel(c, lang)).join(" AND ");
}

function generateRationale(args: {
  reason: PatternProposalReason;
  currentPattern: RiskPattern | null;
  currentOosStats: PatternStats | null;
  proposed: RiskPattern | null;
  proposedInSampleStats: PatternStats | null;
  drivenByTradeIds: string[];
  lang: RationaleLang;
}): string {
  const it = args.lang === "it";
  const pieces: string[] = [];

  if (args.reason === "firstPattern" && args.proposed && args.proposedInSampleStats) {
    pieces.push(
      it
        ? `Prima proposta di pattern di rischio: ${describeConditions(args.proposed, "it")}.`
        : `First risk pattern proposal: ${describeConditions(args.proposed, "en")}.`,
    );
    pieces.push(
      it
        ? `In-sample: precision ${pct(args.proposedInSampleStats.precision)}, recall ${pct(args.proposedInSampleStats.recall)}, lift ${args.proposedInSampleStats.lift.toFixed(2)}, n=${args.proposedInSampleStats.firedN} (confidence ${args.proposedInSampleStats.confidence.toUpperCase()}).`
        : `In-sample: precision ${pct(args.proposedInSampleStats.precision)}, recall ${pct(args.proposedInSampleStats.recall)}, lift ${args.proposedInSampleStats.lift.toFixed(2)}, n=${args.proposedInSampleStats.firedN} (confidence ${args.proposedInSampleStats.confidence.toUpperCase()}).`,
    );
  }

  if (args.reason === "currentPatternDegraded" && args.currentPattern) {
    const oos = args.currentOosStats;
    pieces.push(
      it
        ? `⚠️ Il pattern approvato (${describeConditions(args.currentPattern, "it")}) sta perdendo precisione out-of-sample.`
        : `⚠️ The approved pattern (${describeConditions(args.currentPattern, "en")}) is losing precision out-of-sample.`,
    );
    if (oos) {
      pieces.push(
        it
          ? `OOS: precision ${pct(oos.precision)} su n=${oos.firedN} (era ${pct(args.currentPattern.inSampleStats.precision)} in-sample al momento dell'approvazione).`
          : `OOS: precision ${pct(oos.precision)} on n=${oos.firedN} (was ${pct(args.currentPattern.inSampleStats.precision)} in-sample at approval time).`,
      );
    }
    if (args.proposed && args.proposedInSampleStats) {
      pieces.push(
        it
          ? `Pattern alternativo trovato: ${describeConditions(args.proposed, "it")} (precision in-sample ${pct(args.proposedInSampleStats.precision)} su n=${args.proposedInSampleStats.firedN}).`
          : `Alternative pattern found: ${describeConditions(args.proposed, "en")} (in-sample precision ${pct(args.proposedInSampleStats.precision)} on n=${args.proposedInSampleStats.firedN}).`,
      );
    } else {
      pieces.push(
        it
          ? `Nessun pattern alternativo migliore trovato in questo trigger — questa è una segnalazione, non una sostituzione. Da rivedere manualmente.`
          : `No better alternative pattern found in this trigger — this is an alarm, not a replacement. Manual review required.`,
      );
    }
  }

  if (args.reason === "betterPatternFound" && args.currentPattern && args.proposed && args.proposedInSampleStats) {
    pieces.push(
      it
        ? `Trovato pattern con precision più alta del pattern approvato.`
        : `Found a pattern with higher precision than the approved one.`,
    );
    pieces.push(
      it
        ? `Approvato (${describeConditions(args.currentPattern, "it")}): in-sample precision ${pct(args.currentPattern.inSampleStats.precision)}.`
        : `Approved (${describeConditions(args.currentPattern, "en")}): in-sample precision ${pct(args.currentPattern.inSampleStats.precision)}.`,
    );
    pieces.push(
      it
        ? `Proposto (${describeConditions(args.proposed, "it")}): in-sample precision ${pct(args.proposedInSampleStats.precision)} su n=${args.proposedInSampleStats.firedN} (confidence ${args.proposedInSampleStats.confidence.toUpperCase()}).`
        : `Proposed (${describeConditions(args.proposed, "en")}): in-sample precision ${pct(args.proposedInSampleStats.precision)} on n=${args.proposedInSampleStats.firedN} (confidence ${args.proposedInSampleStats.confidence.toUpperCase()}).`,
    );
  }

  if (args.drivenByTradeIds.length > 0) {
    const sample = args.drivenByTradeIds.slice(0, 5).join(", ");
    pieces.push(
      it
        ? `Trade rilevanti per questa proposta: ${sample}${args.drivenByTradeIds.length > 5 ? ` (e ${args.drivenByTradeIds.length - 5} altri)` : ""}.`
        : `Trades driving this proposal: ${sample}${args.drivenByTradeIds.length > 5 ? ` (and ${args.drivenByTradeIds.length - 5} more)` : ""}.`,
    );
  }

  return pieces.join(" ");
}

// ── Main entry point ──────────────────────────────────────────────────────

export type GenerationResult = {
  proposal: PatternProposal | null;
  /** When a proposal was generated, this is the OOS stats of the current approved pattern at trigger time. */
  currentOosStats: PatternStats | null;
};

/**
 * Top-level: from outcomes → optional PatternProposal.
 *
 * NEVER applies. Persists a `pending` proposal if generated.
 */
export function generatePatternProposalFromOutcomes(
  outcomes: SimOutcomeRow[],
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
  opts: PatternProposalGenerationOptions = {},
): GenerationResult {
  const config = opts.config ?? DEFAULT_PATTERN_PROPOSAL_CONFIG;
  const lang = opts.lang ?? "en";
  const maxConditions = opts.maxConditions ?? 3;
  const useLegacyHeuristic = opts.useLegacyHeuristic ?? false;

  const approved = loadApprovedPattern();
  const currentPattern = approved.current;

  // Build features for the full pool (used by stats + candidate construction)
  const features = extractAllRowFeatures(outcomes, ctx);

  // 1. If we have a current approved pattern: validate it on the trades closed
  //    AFTER its approvedAt (rolling holdout) → out-of-sample stats.
  let currentOosStats: PatternStats | null = null;
  if (currentPattern && currentPattern.approvedAt) {
    const { outOfSample } = splitInVsOutOfSample(outcomes, currentPattern.approvedAt);
    if (outOfSample.length > 0) {
      currentOosStats = evaluatePatternStats(currentPattern, outOfSample, features);
      // Tag each OOS trade as used-for-validation (idempotent)
      for (const r of outOfSample) {
        tagAsUsedForValidation(normalizedRowKey(r.ticker, r.completion_date), currentPattern.id);
      }
    }
  }

  // 2. Build a candidate pattern from the full pool (in-sample).
  //    Default path: empirical combinatorial search across (dimension, bucket)
  //    combinations — for every AND-combination of up to `maxConditions`
  //    distinct dimensions, we recompute precision/recall/lift on the same
  //    closed trades and keep the highest-scoring one (precision-weighted).
  //    This is what the user means by "calcola empiricamente il pattern
  //    associato al fallimento": the candidate is the combination that
  //    actually best predicts loss on this dataset, not just the union of
  //    each feature's worst bucket.
  const phaseA = runUnivariateScreening(outcomes, ctx);
  let candidate: RiskPattern | null;
  if (useLegacyHeuristic) {
    candidate = buildPatternFromTopBuckets(phaseA, maxConditions, outcomes, features);
  } else {
    const search = searchBestPatternEmpirical(phaseA, outcomes, features, {
      maxConditions,
      minFiredN: config.minFiredNForProposal,
      minLift: 1.0,
    });
    candidate = search?.pattern ?? null;
  }

  // 3. Decide whether to generate a proposal and with which reason
  let reason: PatternProposalReason | null = null;
  let chosenCandidate: RiskPattern | null = null;
  const drivenIds: string[] = [];

  // Case "firstPattern": no current pattern yet, candidate has enough firedN
  if (!currentPattern) {
    if (candidate && candidate.inSampleStats.firedN >= config.minFiredNForProposal) {
      reason = "firstPattern";
      chosenCandidate = candidate;
    }
  } else {
    // We have a current pattern. Two sub-cases to check:
    // 2a. currentPatternDegraded
    const oosN = currentOosStats?.firedN ?? 0;
    const inSamplePrec = currentPattern.inSampleStats.precision;
    const oosPrec = currentOosStats?.precision ?? null;
    const degraded =
      oosN >= config.minOutOfSampleNForDegradation &&
      oosPrec != null &&
      oosPrec < inSamplePrec * config.outOfSampleDegradationRatio;

    if (degraded) {
      reason = "currentPatternDegraded";
      // The alternative (if any) is the candidate IF it has enough data
      if (candidate && candidate.inSampleStats.firedN >= config.minFiredNForProposal) {
        chosenCandidate = candidate;
      }
    } else {
      // 2b. betterPatternFound: candidate beats current by minPrecisionMarginPP
      if (
        candidate &&
        candidate.inSampleStats.firedN >= config.minFiredNForProposal &&
        candidate.inSampleStats.precision * 100 >=
          inSamplePrec * 100 + config.minPrecisionMarginPP &&
        // Avoid re-proposing the exact same pattern
        describeConditionsKey(candidate) !== describeConditionsKey(currentPattern)
      ) {
        reason = "betterPatternFound";
        chosenCandidate = candidate;
      }
    }
  }

  if (reason == null) {
    return { proposal: null, currentOosStats };
  }

  // 4. Build the proposal record
  const proposal: PatternProposal = {
    id: nextProposalId(),
    createdAt: new Date().toISOString(),
    triggeredByTradeId: opts.triggeredByTradeId ?? null,
    reason,
    currentPattern: currentPattern
      ? { pattern: currentPattern, outOfSampleStats: currentOosStats }
      : null,
    proposedPattern: chosenCandidate
      ? { pattern: chosenCandidate, inSampleStats: chosenCandidate.inSampleStats }
      : null,
    rationale: generateRationale({
      reason,
      currentPattern,
      currentOosStats,
      proposed: chosenCandidate,
      proposedInSampleStats: chosenCandidate?.inSampleStats ?? null,
      drivenByTradeIds: drivenIds,
      lang,
    }),
    drivenByTradeIds: drivenIds,
    status: "pending",
  };

  persistProposal(proposal);
  return { proposal, currentOosStats };
}

function describeConditionsKey(p: RiskPattern): string {
  // Order-insensitive key so two patterns with the same condition set are equal
  return p.conditions
    .map((c) => `${c.dimension}:${[...c.values].sort().join(",")}`)
    .sort()
    .join("|");
}

// ── Approval / rejection ──────────────────────────────────────────────────

export function inferApprovalSource(proposal: PatternProposal): PatternApprovalSource {
  if (proposal.id.startsWith("pcse-prop-")) return "pcse";
  if (proposal.id.startsWith("pat-prop-manual-")) {
    if (
      proposal.rationale.includes("Manual allocation synthesizer") ||
      proposal.rationale.includes("Sintetizzatore allocazione manuale")
    ) {
      return "manual";
    }
    if (
      proposal.rationale.includes("One-click apply from errors panel") ||
      proposal.rationale.includes("Applicazione diretta dal pannello errori")
    ) {
      return "auto_apply";
    }
    return "manual";
  }
  return "engine";
}

export function approvePatternProposal(
  proposalId: string,
  reviewNote?: string,
  reviewedBy?: string,
): {
  proposal: PatternProposal;
  approvedPattern: RiskPattern | null;
} | null {
  const updated = updateProposalStatus(proposalId, "approved", reviewNote, reviewedBy);
  if (!updated) return null;
  // If the proposal has a proposed pattern, promote it. Otherwise (alarm-only
  // currentPatternDegraded with no alternative), do nothing to the approved
  // record — the operator may choose to clear it via clearApprovedPattern().
  if (updated.proposedPattern) {
    const record = promotePatternToApproved(updated.proposedPattern.pattern, {
      source: inferApprovalSource(updated),
      proposalId: updated.id,
    });
    return { proposal: updated, approvedPattern: record.current };
  }
  return { proposal: updated, approvedPattern: null };
}

export function rejectPatternProposal(
  proposalId: string,
  reviewNote?: string,
  reviewedBy?: string,
): PatternProposal | null {
  return updateProposalStatus(proposalId, "rejected", reviewNote, reviewedBy);
}

/** Convenience: explicitly remove the approved pattern (clears filter). */
export function clearApprovedPatternExplicit(): void {
  clearApprovedPattern();
}

// Re-export for UI convenience
export { dimensionLabel } from "./lossRiskScreening";
export { conditionLabel } from "./lossRiskPattern";
