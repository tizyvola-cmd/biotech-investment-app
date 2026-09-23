/** Legenda colonna target modello (ROI atteso verso CD). */

export function PipelineTrendLegend({
  className = "",
  it = false,
}: {
  className?: string;
  it?: boolean;
}) {
  return (
    <p
      className={`text-[10px] text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-0.5 ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <span className="text-[10px] font-semibold tabular-nums text-[rgb(var(--signal-up))]">
          $12
        </span>
        <span>{it ? "Target rialzo modello" : "Model rise target"}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="text-[rgb(var(--signal-down))] font-bold text-sm leading-none">↓</span>
        <span>{it ? "Curva in calo" : "Declining curve"}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="text-ink-muted/50 text-[10px] font-medium">~</span>
        <span>{it ? "Neutro (~0%)" : "Flat (~0%)"}</span>
      </span>
    </p>
  );
}
