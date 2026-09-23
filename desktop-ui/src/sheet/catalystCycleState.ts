import type {
  CatalystCyclePhase,
  CatalystCyclePrimary,
  CatalystPatternConfidence,
  CatalystTickerCycleAlert,
} from "../api/catalystPatterns";
import { resolveCycleDisplayPrimary } from "../api/catalystPatterns";

export type CycleOperationalRec = "buy" | "sell" | "hold" | "review" | "none";

export type CycleOperationalContext = {
  /** Same Buy / Hold / Review / Sell as Decision Chart / Pulse Rec. */
  operationalRec?: CycleOperationalRec | null;
  /** Open book — entry vs exit cycle phases apply differently. */
  hasPosition?: boolean;
};

/** Cycle phases that imply expected rebound / growth (entry side). */
export function cyclePhaseImpliesGrowth(phase: CatalystCyclePhase): boolean {
  return (
    phase === "dump_entry" ||
    phase === "pre_volume_watch" ||
    phase === "exhaustion_exit"
  );
}

/** Legacy exit phase = multi-horizon At High (peak), not Soft BUY and not decline. */
export function cyclePhaseImpliesDecline(_phase: CatalystCyclePhase): boolean {
  return false;
}

/**
 * Hide catalyst cycle badges that contradict operational direction:
 * - Growth phases (Catalyst / Drop / At High) → never alongside operational SELL;
 *   Drop (dump_entry) never when already in portfolio.
 * Dedup of same-bar Cycle markers lives in priceCycleChartMarkers.ts (Map per index),
 * not here.
 */
export function filterCyclePrimaryForOperationalContext(
  primary: CatalystCyclePrimary | null | undefined,
  ctx: CycleOperationalContext,
): CatalystCyclePrimary | null {
  if (!primary) return null;
  const rec = ctx.operationalRec ?? null;
  const hasPosition = ctx.hasPosition ?? false;

  if (cyclePhaseImpliesGrowth(primary.phase)) {
    if (rec === "sell") return null;
    if (primary.phase === "dump_entry" && hasPosition) return null;
  }

  return primary;
}

export function resolveOperationalAlignedCyclePrimary(
  alert: CatalystTickerCycleAlert | null | undefined,
  ctx: CycleOperationalContext,
): CatalystCyclePrimary | null {
  return filterCyclePrimaryForOperationalContext(resolveCycleDisplayPrimary(alert), ctx);
}

export function cyclePhaseToneClass(phase: CatalystCyclePhase): string {
  switch (phase) {
    case "pre_volume_watch":
      return "bg-amber-100 text-amber-900 border-amber-300/80 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700/60";
    case "dump_entry":
      // Amber — Cycle badges must not use Soft BUY emerald / Soft SELL red.
      return "bg-amber-100 text-amber-900 border-amber-300/80 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700/60";
    case "exhaustion_exit":
      // Amber tone — must not match Soft BUY emerald pills.
      return "bg-amber-100 text-amber-900 border-amber-300/80 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700/60";
    default:
      return "bg-[rgb(var(--surface-3))]/80 text-ink-muted border-[rgb(var(--border))]/50";
  }
}

export function cycleConfidenceDotClass(conf: CatalystPatternConfidence): string {
  switch (conf) {
    case "high":
      return "bg-emerald-500";
    case "medium":
      return "bg-amber-500";
    case "low":
      return "bg-orange-400";
    default:
      return "bg-ink-muted/40";
  }
}

export function cycleTooltip(
  primary: CatalystCyclePrimary,
  it: boolean,
  meta?: { lift?: number | null; n?: number | null },
): string {
  const reason = it ? primary.reason_it : primary.reason_en;
  const lift = meta?.lift;
  const n = meta?.n;
  const hist =
    lift != null && n != null
      ? it
        ? ` · storico n=${n}, lift=${lift.toFixed(2)}×`
        : ` · history n=${n}, lift=${lift.toFixed(2)}×`
      : "";
  const conf =
    primary.confidence === "high"
      ? it
        ? "Alta confidenza"
        : "High confidence"
      : primary.confidence === "medium"
        ? it
          ? "Confidenza media"
          : "Medium confidence"
        : primary.confidence === "low"
          ? it
            ? "Bassa confidenza — ipotesi"
            : "Low confidence — hypothesis"
          : it
            ? "Solo ricerca — non operativo"
            : "Research only — not operational";
  return `${reason}${hist} · ${conf}`;
}
