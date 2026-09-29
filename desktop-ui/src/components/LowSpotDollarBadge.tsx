import type { LowSpotSignal } from "../sheet/earlyPeakBuyMinTarget";
import { LOW_NEAR_SPOT_MAX_PREMIUM_PCT } from "../sheet/earlyPeakBuyMinTarget";

function lowSpotDollarTip(signal: Extract<LowSpotSignal, "below" | "near">, it: boolean): string {
  if (signal === "below") {
    return it
      ? "Prezzo sotto il min 7g o 24h — possibile ingresso"
      : "Price below 7d or 24h low — possible entry";
  }
  return it
    ? `Prezzo vicino al min 7g/24h (≤${LOW_NEAR_SPOT_MAX_PREMIUM_PCT}% sopra)`
    : `Price near 7d/24h low (≤${LOW_NEAR_SPOT_MAX_PREMIUM_PCT}% above)`;
}

/** Green $ — spot below weekly/24h low; yellow $ — within 2% above low. */
export function LowSpotDollarBadge({
  signal,
  it,
}: {
  signal: Extract<LowSpotSignal, "below" | "near"> | null;
  it: boolean;
}) {
  if (!signal) return null;
  const tip = lowSpotDollarTip(signal, it);
  const cls =
    signal === "below"
      ? "ml-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"
      : "ml-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400";
  return (
    <span className={cls} title={tip} aria-label={tip}>
      $
    </span>
  );
}
