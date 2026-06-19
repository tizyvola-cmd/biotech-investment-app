export type EisCorrelationStrengthTier = "strong" | "moderate" | "weak" | "none";

export function classifyPearsonR(r: number | null | undefined): EisCorrelationStrengthTier {
  if (r == null || !Number.isFinite(r)) return "none";
  const abs = Math.abs(r);
  if (abs >= 0.7) return "strong";
  if (abs >= 0.4) return "moderate";
  return "weak";
}

/** R² as 0–100 (one decimal). */
export function pearsonVarianceExplainedPct(r: number | null | undefined): number | null {
  if (r == null || !Number.isFinite(r)) return null;
  return Math.round(r * r * 1000) / 10;
}

export const EIS_CORRELATION_STRENGTH_COLORS: Record<EisCorrelationStrengthTier, string> = {
  strong: "#059669",
  moderate: "#d97706",
  weak: "#64748b",
  none: "#94a3b8",
};

export const EIS_CORRELATION_STRENGTH_BG: Record<EisCorrelationStrengthTier, string> = {
  strong: "bg-emerald-50 border-emerald-200/70",
  moderate: "bg-amber-50 border-amber-200/70",
  weak: "bg-slate-50 border-slate-200/70",
  none: "bg-slate-50 border-slate-200/60",
};
