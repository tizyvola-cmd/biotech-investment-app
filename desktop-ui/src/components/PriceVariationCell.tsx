import {
  formatPriceVariationPct,
  priceVariationTone,
} from "../sheet/priceVariationHorizons";

const TONE_CLS = {
  up: "text-[rgb(var(--signal-up))]",
  down: "text-[rgb(var(--signal-down))]",
  flat: "text-ink-muted",
  muted: "text-ink-muted/60",
} as const;

export function PriceVariationCell({ pct }: { pct: number | null }) {
  const tone = priceVariationTone(pct);
  return (
    <span className={`font-medium tabular-nums text-xs ${TONE_CLS[tone]}`}>
      {formatPriceVariationPct(pct)}
    </span>
  );
}
