/** Sim loop capital sizing: equal €/deal, Learning Lab weight, Weight Sim Exp synth. */
export type SimLoopSizingVariant = "equal" | "weight" | "synth";

export const SIM_LOOP_SIZING_VARIANTS: SimLoopSizingVariant[] = [
  "equal",
  "weight",
  "synth",
];

export function simLoopSizingVariantLabel(
  variant: SimLoopSizingVariant,
  lang: "it" | "en",
): string {
  if (variant === "equal") return lang === "it" ? "Equal" : "Equal";
  if (variant === "weight") return lang === "it" ? "Weight" : "Weight";
  return lang === "it" ? "Synth" : "Synth";
}

export function simLoopSizingVariantTip(
  variant: SimLoopSizingVariant,
  lang: "it" | "en",
): string {
  if (variant === "equal") {
    return lang === "it"
      ? "Sim loop paper — stesso capitale per deal (es. €5k)."
      : "Paper sim loop — equal capital per deal (e.g. €5k).";
  }
  if (variant === "weight") {
    return lang === "it"
      ? "Sim loop — quote proporzionali al weighting Step 2 / Learning Lab."
      : "Sim loop — shares from Step 2 / Learning Lab approved weights.";
  }
  return lang === "it"
    ? "Sim loop — capitale da Weight Sim Exp (synthesizer Step 3)."
    : "Sim loop — Weight Sim Exp synthesizer sizing (Step 3).";
}
