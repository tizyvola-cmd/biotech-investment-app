/**
 * Green tick marks for Soft BUY gate strength (Suggested BUY + portfolio chips).
 */
import type { SoftBuyGateStrength } from "../sheet/softBuyGateStrength";

export function SoftBuyGateStrengthMarks({
  strength,
  dense = false,
}: {
  strength: SoftBuyGateStrength;
  dense?: boolean;
}) {
  const ticks = Math.max(0, Number(strength?.ticks) || 0);
  const maxTicks = Math.max(1, Number(strength?.maxTicks) || 1);
  const tier = strength?.tier ?? "weak";
  const filled =
    tier === "strong"
      ? "bg-emerald-700 dark:bg-emerald-400"
      : tier === "mid"
        ? "bg-emerald-600 dark:bg-emerald-500"
        : "bg-emerald-500/70 dark:bg-emerald-500/60";
  const empty = "bg-emerald-900/15 dark:bg-white/15";
  const h = dense ? "h-1 w-1.5" : "h-1.5 w-2";
  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0"
      aria-label={`${ticks}/${maxTicks}`}
    >
      {Array.from({ length: maxTicks }, (_, i) => (
        <span
          key={i}
          className={`${h} rounded-[1px] ${i < ticks ? filled : empty}`}
        />
      ))}
    </span>
  );
}
