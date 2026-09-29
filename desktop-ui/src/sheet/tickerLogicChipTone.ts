/**
 * Soft BUY / Soft SELL chip tone for open-ticker buttons on the Home
 * breakeven chart — pair gate logic with live equity return.
 */
import {
  collectBuyIndexClearances,
  collectSellIndexClearances,
  meanClearance,
  type BreakevenLogicPosition,
} from "./breakevenRecLogicFill";
import { weekLogicGainAlign, type WeekLogicGainAlign } from "./breakevenWeekSessions";

export type TickerLogicChipTone = {
  dominant: "buy" | "sell" | "mixed";
  buyStrength: number;
  sellStrength: number;
  align: WeekLogicGainAlign;
  /** Tailwind-ish class bundle for the chip surface. */
  className: string;
  barBuyPct: number;
  barSellPct: number;
};

export function tickerLogicChipTone(
  pos: BreakevenLogicPosition | null | undefined,
  equity: number | null | undefined,
): TickerLogicChipTone | null {
  if (!pos) return null;
  const buyStrength = meanClearance(collectBuyIndexClearances([pos]));
  const sellStrength = meanClearance(collectSellIndexClearances([pos]));
  let dominant: "buy" | "sell" | "mixed" = "mixed";
  if (buyStrength < 0.12 && sellStrength < 0.12) dominant = "mixed";
  else if (Math.abs(buyStrength - sellStrength) < 0.08) dominant = "mixed";
  else dominant = buyStrength > sellStrength ? "buy" : "sell";

  // Equity vs $0 (= capital recovered) stands in for return direction.
  const align = weekLogicGainAlign(dominant, equity ?? 0);

  const max = Math.max(buyStrength + sellStrength, 0.01);
  const barBuyPct = Math.round((buyStrength / max) * 100);
  const barSellPct = Math.max(0, 100 - barBuyPct);

  const className =
    dominant === "buy"
      ? align === "aligned"
        ? "border-emerald-500/70 bg-emerald-100/95 text-emerald-950 ring-1 ring-emerald-500/30"
        : align === "mismatch"
          ? "border-emerald-400/40 bg-amber-50/95 text-emerald-950 ring-1 ring-amber-400/35"
          : "border-emerald-400/45 bg-emerald-50/90 text-emerald-900"
      : dominant === "sell"
        ? align === "aligned"
          ? "border-rose-500/70 bg-rose-100/95 text-rose-950 ring-1 ring-rose-500/30"
          : align === "mismatch"
            ? "border-rose-400/40 bg-amber-50/95 text-rose-950 ring-1 ring-amber-400/35"
            : "border-rose-400/45 bg-rose-50/90 text-rose-900"
        : "border-[rgb(var(--border))]/55 bg-[rgb(var(--surface-2))]/85 text-ink";

  return {
    dominant,
    buyStrength,
    sellStrength,
    align,
    className,
    barBuyPct,
    barSellPct,
  };
}
