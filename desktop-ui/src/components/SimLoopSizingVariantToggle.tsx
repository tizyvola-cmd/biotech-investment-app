import type { SimLoopSizingVariant } from "../sheet/simLoopSizingVariant";
import {
  SIM_LOOP_SIZING_VARIANTS,
  simLoopSizingVariantLabel,
  simLoopSizingVariantTip,
} from "../sheet/simLoopSizingVariant";
import { useLang } from "../shared/i18n";

export function SimLoopSizingVariantToggle({
  value,
  onChange,
  compact = false,
  className = "",
}: {
  value: SimLoopSizingVariant;
  onChange: (v: SimLoopSizingVariant) => void;
  compact?: boolean;
  className?: string;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  return (
    <div
      className={`inline-flex rounded-full border border-[rgb(var(--panel-feed-border))]/60 bg-white/90 dark:bg-slate-900/40 overflow-hidden ${className}`}
      role="group"
      aria-label={it ? "Sizing sim loop" : "Sim loop sizing"}
    >
      {SIM_LOOP_SIZING_VARIANTS.map((v) => {
        const active = value === v;
        const accent =
          v === "equal"
            ? active
              ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
              : ""
            : v === "weight"
              ? active
                ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                : ""
              : active
                ? "bg-pink-50 text-pink-900 dark:bg-pink-950/40 dark:text-pink-100"
                : "";
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            title={simLoopSizingVariantTip(v, lang)}
            onClick={() => onChange(v)}
            className={`font-semibold tabular-nums transition-colors ${
              compact ? "text-[9px] px-2 py-0.5" : "text-[10px] px-2.5 py-1"
            } ${active ? accent : "text-[rgb(var(--panel-feed-accent-strong))] hover:bg-[rgb(var(--panel-feed-row-hover))]/45"}`}
          >
            {simLoopSizingVariantLabel(v, lang)}
          </button>
        );
      })}
    </div>
  );
}
