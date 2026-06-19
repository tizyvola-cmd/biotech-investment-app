import type { LossExitDecision } from "./portfolioLossAnalysis";

/** Pill badge (ticker row) — aligned with PlanProbHero text colors. */
export function exitDecisionBadgeClass(decision: LossExitDecision): string {
  switch (decision) {
    case "exit":
      return "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/40";
    case "hold":
      return "bg-[rgb(var(--signal-up))]/12 text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/35";
    default:
      return "bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/35";
  }
}

/** Hero / inline readout text color. */
export function exitDecisionTextClass(decision: LossExitDecision): string {
  switch (decision) {
    case "hold":
      return "text-emerald-700 dark:text-emerald-400";
    case "exit":
      return "text-red-700 dark:text-red-400";
    default:
      return "text-amber-700 dark:text-amber-400";
  }
}
