import type { EisAutoPriceCorrelation } from "../sheet/eisAutoPriceCorrelation";

const BAR_HEIGHTS = ["35%", "50%", "65%", "80%", "100%"] as const;

export function EisAutoPriceSignalBars({
  corr,
  title,
  className = "",
}: {
  corr: EisAutoPriceCorrelation;
  title?: string;
  className?: string;
}) {
  const filled = corr.bars;
  const tone =
    corr.pearsonR != null
      ? corr.pearsonR >= 0
        ? "fill-[rgb(var(--signal-up))]"
        : "fill-[rgb(var(--signal-down))]"
      : corr.aligned24h === true
        ? "fill-[rgb(var(--signal-up))]"
        : corr.aligned24h === false
          ? "fill-[rgb(var(--signal-down))]"
          : "fill-[rgb(var(--accent))]";

  if (corr.nEvents === 0) {
    return (
      <span className={`text-ink-muted/50 text-[9px] ${className}`.trim()} title={title}>
        —
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-end justify-center gap-[2px] h-[14px] ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-[1px] transition-colors ${
            i < filled ? tone : "bg-[rgb(var(--border))]/40"
          }`}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}
