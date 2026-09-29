/**
 * Soft BUY gate strength — shared by Home Suggested BUY chips and portfolio
 * piggy tickers so entry indices/gates stay visible vs investment outcome.
 *
 * Ticks = how many Soft BUY quality gates currently pass.
 * Wind-only (10d + P(cont)) → fewer ticks / lighter green.
 */
import { softBuyWindOrEarlyPeakHit } from "./continuationScore";
import {
  softBuyRisingStreakAllows,
  softBuyDayNotRed,
  softBuyTapeNotCatastrophic,
  softBuyTop2Allows,
  type SuggestedActionEnhanceCtx,
} from "./investDecisionSimLoop";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import {
  evaluateSoftBuyGrade1,
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1_SDS_MIN,
} from "./softSignalGrades";
import { dailyChangePctFromRow } from "./simulationPosition";

export type SoftBuyGateId =
  | "sds_p"
  | "wind"
  | "top2"
  | "rising"
  | "clean";

export type SoftBuyGateFlag = {
  id: SoftBuyGateId;
  pass: boolean;
};

export type SoftBuyGateTier = "weak" | "mid" | "strong";

export type SoftBuyGateStrength = {
  gates: SoftBuyGateFlag[];
  /** Passed gate count (0…maxTicks). */
  ticks: number;
  maxTicks: number;
  tier: SoftBuyGateTier;
  /** Short tooltip fragment (IT/EN). */
  summaryIt: string;
  summaryEn: string;
};

/** Lightweight input — Suggested BUY items or open-book piggy rows. */
export type SoftBuyGateEvalInput = {
  ticker: string;
  key: string;
  sdsScore?: number | null;
  pplan?: number | null;
  investVerdict?: string | null;
  precatKind?: string | null;
  pnlPct24h?: number | null;
};

const GATE_ORDER: SoftBuyGateId[] = ["sds_p", "wind", "top2", "rising", "clean"];

const GATE_LABEL: Record<SoftBuyGateId, { it: string; en: string }> = {
  sds_p: { it: "SDS/P", en: "SDS/P" },
  wind: { it: "10g/P(cont)/picco", en: "10d/P(cont)/peak" },
  top2: { it: "Top2", en: "Top2" },
  rising: { it: "↑2d", en: "↑2d" },
  clean: { it: "tape/cooldown", en: "tape/cooldown" },
};

export function softBuyGateTier(ticks: number): SoftBuyGateTier {
  if (ticks >= 4) return "strong";
  if (ticks >= 3) return "mid";
  return "weak";
}

/**
 * Gen 4 Grade 3 — demoted Soft BUY (Top2 NO / weak P(cont) / …) keeps BUY
 * but sizes down. Strong = full base; mid ≈70%; weak ≈40%.
 */
export const SOFT_BUY_CAPITAL_MULT: Record<SoftBuyGateTier, number> = {
  strong: 1,
  mid: 0.7,
  weak: 0.4,
};

export function softBuyCapitalMultFromTier(tier: SoftBuyGateTier): number {
  return SOFT_BUY_CAPITAL_MULT[tier];
}

/** Scale base capital by Soft BUY gate tier; round to €50 like synth sizing. */
export function softBuyCapitalFromGateStrength(
  baseCapitalEur: number,
  strength: SoftBuyGateStrength | SoftBuyGateTier | null | undefined,
): number {
  if (!(baseCapitalEur > 0)) return 0;
  const tier: SoftBuyGateTier =
    strength == null
      ? "mid"
      : typeof strength === "string"
        ? strength
        : strength.tier;
  const mult = softBuyCapitalMultFromTier(tier);
  return Math.max(50, Math.round((baseCapitalEur * mult) / 50) * 50);
}

function asLossItem(input: SoftBuyGateEvalInput): PortfolioLossAnalysisItem {
  return {
    key: input.key,
    ticker: input.ticker,
    hasPosition: false,
    sdsScore: input.sdsScore ?? null,
    recoveryProbabilityPct: input.pplan ?? null,
    investVerdict: (input.investVerdict ?? "wait") as PortfolioLossAnalysisItem["investVerdict"],
    precatKind: input.precatKind ?? "neutral",
    pnlPct24h: input.pnlPct24h ?? null,
  } as PortfolioLossAnalysisItem;
}

/**
 * Evaluate Soft BUY gate stack for a name (off-book suggestion or open book
 * monitoring). Does not require current action === BUY.
 */
export function evaluateSoftBuyGateStrength(
  input: SoftBuyGateEvalInput | PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): SoftBuyGateStrength {
  const item =
    "recoveryProbabilityPct" in input && "sdsScore" in input && "investVerdict" in input
      ? (input as PortfolioLossAnalysisItem)
      : asLossItem(input as SoftBuyGateEvalInput);

  const simRow = enhanceCtx?.simRow ?? null;
  const dayPct =
    item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)
      ? item.pnlPct24h
      : simRow
        ? dailyChangePctFromRow(simRow)
        : null;

  const soft = evaluateSoftBuyGrade1({
    hasPosition: false,
    sdsScore: item.sdsScore,
    pplan: item.recoveryProbabilityPct,
  });
  const sdsOk =
    soft.hit ||
    (item.sdsScore != null &&
      item.sdsScore >= SOFT_BUY_G1_SDS_MIN &&
      item.recoveryProbabilityPct != null &&
      item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN);

  const byId: Record<SoftBuyGateId, boolean> = {
    sds_p: sdsOk,
    wind: softBuyWindOrEarlyPeakHit(simRow, dayPct),
    top2: softBuyTop2Allows(item),
    rising: softBuyRisingStreakAllows(item, dayPct, enhanceCtx),
    clean:
      softBuyDayNotRed(item, dayPct) &&
      softBuyTapeNotCatastrophic(item, dayPct) &&
      item.precatKind !== "sell" &&
      !enhanceCtx?.recentlySoldBlocked,
  };

  const gates: SoftBuyGateFlag[] = GATE_ORDER.map((id) => ({
    id,
    pass: byId[id],
  }));
  const ticks = gates.filter((g) => g.pass).length;
  const maxTicks = GATE_ORDER.length;
  const tier = softBuyGateTier(ticks);
  const passed = gates.filter((g) => g.pass).map((g) => GATE_LABEL[g.id]);
  const failed = gates.filter((g) => !g.pass).map((g) => GATE_LABEL[g.id]);
  const summaryIt =
    `Gate Soft BUY ${ticks}/${maxTicks}` +
    (passed.length ? ` · ok: ${passed.map((p) => p.it).join(", ")}` : "") +
    (failed.length ? ` · no: ${failed.map((p) => p.it).join(", ")}` : "");
  const summaryEn =
    `Soft BUY gates ${ticks}/${maxTicks}` +
    (passed.length ? ` · ok: ${passed.map((p) => p.en).join(", ")}` : "") +
    (failed.length ? ` · no: ${failed.map((p) => p.en).join(", ")}` : "");

  return { gates, ticks, maxTicks, tier, summaryIt, summaryEn };
}

/** Emerald chip surface by tier (Suggested BUY). */
export function softBuyGateChipClass(tier: SoftBuyGateTier, interactive: boolean): string {
  const base =
    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums";
  const hover = interactive ? " hover:brightness-95 transition" : "";
  if (tier === "strong") {
    return `${base} bg-emerald-600/25 text-emerald-950 dark:text-emerald-100 border border-emerald-600/40${hover}`;
  }
  if (tier === "mid") {
    return `${base} bg-emerald-500/18 text-emerald-900 dark:text-emerald-200 border border-emerald-500/30${hover}`;
  }
  return `${base} bg-emerald-400/10 text-emerald-800/90 dark:text-emerald-300/90 border border-emerald-400/25${hover}`;
}

/** Extra class for portfolio piggy chips — green intensity of Soft BUY thesis. */
export function softBuyGatePiggyTintClass(tier: SoftBuyGateTier, ticks: number): string {
  if (ticks <= 0) return "";
  if (tier === "strong") return "ring-1 ring-emerald-600/55 bg-emerald-600/12";
  if (tier === "mid") return "ring-1 ring-emerald-500/40 bg-emerald-500/8";
  return "ring-1 ring-emerald-400/30 bg-emerald-400/5";
}
