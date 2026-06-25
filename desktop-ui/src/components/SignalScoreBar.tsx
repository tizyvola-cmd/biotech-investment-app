import { scoreBarFillClass, scoreReliabilityTier } from "../sheet/investSignalScore";

export { scoreBarFillClass };

export function SignalScoreBar({
  score,
  detailTitle,
  barClassName = "w-[4.5rem]",
  stacked = false,
  showLabel = false,
  lang = "it",
  onClick,
}: {
  score: number;
  detailTitle?: string;
  barClassName?: string;
  stacked?: boolean;
  /** Mostra fascia testuale sotto il numero (es. «Alta», «Buona»). */
  showLabel?: boolean;
  lang?: "it" | "en";
  onClick?: () => void;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const rel = scoreReliabilityTier(clamped);
  const tierLabel = lang === "it" ? rel.labelIt : rel.labelEn;
  const Wrapper = onClick ? "button" : "div";
  const bar = (
    <div
      className={`${stacked ? "w-full" : barClassName} h-2 rounded-full bg-slate-200/90 overflow-hidden shrink-0`}
      aria-hidden
    >
      <div
        className={`h-full rounded-full ${rel.barClass}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
  const num = (
    <span className={`text-[11px] tabular-nums shrink-0 ${rel.textClass}`}>{clamped}</span>
  );
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      className={`min-w-0 text-left ${
        stacked ? "flex flex-col items-start gap-1.5 w-full" : "flex items-center gap-2"
      } ${onClick ? "cursor-pointer hover:opacity-90" : "cursor-help"}`}
      title={detailTitle}
      onClick={onClick}
    >
      {bar}
      <div className={stacked ? "flex flex-col items-start gap-0.5" : "flex items-baseline gap-1.5"}>
        {num}
        {showLabel ? (
          <span
            className={`text-[11px] font-semibold uppercase tracking-wide leading-none ${rel.textClass}`}
          >
            {tierLabel}
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
